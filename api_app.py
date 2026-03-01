"""
FastAPI backend for WeatherRoute.

Serves JSON-only /api/* endpoints for the React SPA frontend.
Keeps all computation logic in module.py; this file handles HTTP + job management.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import date, timedelta
from pathlib import Path

import difflib
import pycountry
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

from module import (
    find_optimal_route,
    create_route_map,
    load_data,
    load_city_ids_by_country,
    get_interpolated_weather,
    create_loading_route_map,
    check_route_feasibility,
    calculate_temperature_score,
    get_osrm_route,
    compute_distances_from_chunks,
    build_combined_elevation_profile,
    haversine,
    select_forecast_points,
    fetch_open_meteo_forecast,
)

app = FastAPI()

# ---------------------------------------------------------------------------
# Data loading (once at startup)
# ---------------------------------------------------------------------------

DATA_PATH = "data/"
city_graph, temperatures = load_data(DATA_PATH)

city_names: dict[str, str] = {}  # lowercase name -> city_id
for node in city_graph.nodes(data=True):
    cid = node[0]
    name = node[1].get("name", "Unknown City")
    city_names[name.lower()] = cid

german_names_path = os.path.join(DATA_PATH, "german_city_names.json")
if os.path.exists(german_names_path):
    with open(german_names_path, encoding="utf-8") as f:
        german_city_names = json.load(f)
    for de_name, cid in german_city_names.items():
        if de_name not in city_names:
            city_names[de_name] = str(cid)


def _normalize_ascii(s: str) -> str:
    return s.replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")


city_names_ascii: dict[str, str] = {}
for k in city_names:
    ascii_k = _normalize_ascii(k)
    if ascii_k not in city_names_ascii:
        city_names_ascii[ascii_k] = k


def resolve_city_name(raw: str):
    name = raw.strip().lower()
    if not name:
        return None, None
    if name in city_names:
        return city_names[name], name
    ascii_name = _normalize_ascii(name)
    if ascii_name in city_names_ascii:
        orig_key = city_names_ascii[ascii_name]
        return city_names[orig_key], orig_key
    matches = difflib.get_close_matches(
        ascii_name, city_names_ascii.keys(), n=1, cutoff=0.82
    )
    if matches:
        orig_key = city_names_ascii[matches[0]]
        return city_names[orig_key], orig_key
    return None, None


def interp_route_day(km_target, cum_km, route_days):
    """Interpolate the absolute travel day for a km position along the route."""
    for i in range(len(cum_km) - 1):
        km0, km1 = cum_km[i], cum_km[i + 1]
        if km0 <= km_target <= km1:
            t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
            return route_days[i] + t * (route_days[i + 1] - route_days[i])
    if cum_km:
        return route_days[0] if km_target <= cum_km[0] else route_days[-1]
    return route_days[0] if route_days else 0.0


# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------

jobs: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class CityEntry(BaseModel):
    id: str
    name: str
    restDays: int = 0


class Connection(BaseModel):
    fromId: str
    fromName: str
    toId: str
    toName: str


class JobSubmission(BaseModel):
    cities: List[CityEntry]
    startCity: str = ""
    startDay: Optional[int] = None
    autoDetectStart: bool = True
    connections: List[Connection] = []
    desiredDayTemp: float = 25
    desiredNightTemp: float = 15
    dayTempMin: float #= -20
    dayTempMax: float = 50
    nightTempMin: float = -30
    nightTempMax: float = 40
    warmingFactor: float = 1.5
    tempWeight: float = 0.5
    maxDailyKm: float = 120
    maxTravelDays: int = 365
    elevResolution: int = 1000
    blockedCountries: List[str] = []
    sortedInput: bool = False


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


@app.get("/api/cities/search")
def search_cities(q: str = Query("", min_length=0)):
    query = q.lower()
    if len(query) < 2:
        return []
    results = []
    for name_lower, cid in city_names.items():
        if query in name_lower:
            nd = city_graph.nodes.get(cid, {})
            display_name = nd.get("name", name_lower.title())
            results.append(
                {
                    "id": cid,
                    "name": display_name,
                    "country": nd.get("country"),
                    "lat": float(nd.get("lat", 0)),
                    "lon": float(nd.get("lon", 0)),
                }
            )
            if len(results) >= 10:
                break
    return results


@app.get("/api/countries/search")
def search_countries(q: str = Query("", min_length=0)):
    query = q.lower()
    if len(query) < 1:
        return []
    results = []
    for c in pycountry.countries:
        if query in c.name.lower():
            results.append({"code": c.alpha_2, "name": c.name})
            if len(results) >= 10:
                break
    return results


@app.post("/api/jobs")
def submit_job(data: JobSubmission):
    # Resolve city IDs (frontend may send name-only cities)
    city_ids = []
    city_rest_days = {}

    for entry in data.cities:
        cid = entry.id
        if not cid:
            cid, _ = resolve_city_name(entry.name)
        if cid:
            city_ids.append(cid)
            if entry.restDays > 0:
                city_rest_days[cid] = entry.restDays

    if not city_ids:
        raise HTTPException(400, "No valid cities provided.")

    # Resolve connections
    connections = []
    for conn in data.connections:
        fid = conn.fromId or (resolve_city_name(conn.fromName)[0] if conn.fromName else None)
        tid = conn.toId or (resolve_city_name(conn.toName)[0] if conn.toName else None)
        if fid and tid:
            connections.append((fid, tid))

    # Resolve start city
    start_city = None
    if data.startCity:
        start_city, _ = resolve_city_name(data.startCity)

    start_day = None if data.autoDetectStart else data.startDay

    params = dict(
        city_ids=city_ids,
        start_city=start_city,
        connections=connections,
        start_day=start_day,
        low_temp=data.desiredNightTemp,
        high_temp=data.desiredDayTemp,
        high_temp_min=data.dayTempMin,
        high_temp_max=data.dayTempMax,
        low_temp_min=data.nightTempMin,
        low_temp_max=data.nightTempMax,
        daily_km=data.maxDailyKm,
        max_days=data.maxTravelDays,
        elev_points_per_1000km=data.elevResolution,
        temp_weight=data.tempWeight,
        warming_factor=data.warmingFactor,
        routing_mode="car",
        sorted_input=data.sortedInput,
        blocked_countries=data.blockedCountries,
        city_rest_days=city_rest_days,
    )

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": "route",
        "message": "Starting calculation...",
        "osrm_done": 0,
        "osrm_total": 0,
        "rough_map": None,
        "result": None,
        "error": None,
    }

    t = threading.Thread(target=run_calculation, args=(job_id, params), daemon=True)
    t.start()

    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}/status")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    rough_map = job.get("rough_map")
    return {
        "status": job["status"],
        "step": job["step"],
        "message": job["message"],
        "osrmDone": job["osrm_done"],
        "osrmTotal": job["osrm_total"],
        "roughMap": rough_map,
        "error": job.get("error"),
    }


@app.get("/api/jobs/{job_id}/results")
def job_results(job_id: str):
    job = jobs.get(job_id)
    if not job or job["status"] != "done" or not job.get("result"):
        raise HTTPException(404, "Results not available")
    return job["result"]


# ---------------------------------------------------------------------------
# Background calculation
# ---------------------------------------------------------------------------


def _score_color(ns: float) -> str:
    """Normalized score (0=good, 1=bad) to hex color."""
    if ns < 0.5:
        r = int(ns * 2 * 255)
        g = 200
        b = 50
    else:
        r = 255
        g = int((1 - (ns - 0.5) * 2) * 200)
        b = 50
    return f"rgb({r},{g},{b})"


def run_calculation(job_id: str, params: dict):
    job = jobs[job_id]

    def update(step: str, message: str, **kwargs):
        job["step"] = step
        job["message"] = message
        for k, v in kwargs.items():
            job[k] = v

    try:
        update("route", "Running route algorithm...")
        job["status"] = "running"

        city_ids_by_country = load_city_ids_by_country(
            "data/city_ids_by_country.json"
        )

        # Feasibility check
        issues = check_route_feasibility(
            city_graph,
            target_cities=params["city_ids"],
            start_city=params["start_city"],
            connections=params["connections"],
            blocked_countries=params["blocked_countries"],
            city_ids_by_country=city_ids_by_country,
        )
        if issues:
            job["status"] = "error"
            job["error"] = " | ".join(issues)
            return

        # Find optimal route
        route, start_day, fail_reason = find_optimal_route(
            city_graph,
            params["blocked_countries"],
            city_ids_by_country,
            temperatures,
            target_cities=params["city_ids"],
            start_city=params["start_city"],
            connections=params["connections"],
            start_day=params["start_day"],
            desired_low_temp=params["low_temp"],
            desired_high_temp=params["high_temp"],
            temp_weight=params["temp_weight"],
            auto_threshold_percentile=10,
            exp=2,
            low_temp_range=(params["low_temp_min"], params["low_temp_max"]),
            high_temp_range=(params["high_temp_min"], params["high_temp_max"]),
            daily_max_km=params["daily_km"],
            max_days=params["max_days"],
            sorted_input=params["sorted_input"],
            city_rest_days=params["city_rest_days"],
            warming_factor=params["warming_factor"],
        )

        if not route:
            job["status"] = "error"
            job["error"] = fail_reason or "No valid route found."
            return

        # Build rough map preview
        rough = create_loading_route_map(
            city_graph,
            temperatures,
            route,
            2,
            params["low_temp"],
            params["high_temp"],
            params["low_temp_min"],
            params["low_temp_max"],
            params["high_temp_min"],
            params["high_temp_max"],
            warming_factor=params["warming_factor"],
        )
        update(
            "osrm",
            "Route found! Loading street data...",
            rough_map=rough,
            osrm_done=0,
            osrm_total=max(0, len(route) - 1),
        )

        # Collect city data for structured response
        route_locations = []
        all_temps_data = []
        for city_id, day, city_name, distance in route:
            try:
                nd = city_graph.nodes[city_id]
                lat, lon = float(nd["lat"]), float(nd["lon"])
                route_locations.append((lat, lon))
                temps = get_interpolated_weather(
                    city_id, day, temperatures, params["warming_factor"]
                )
                temp_score, violated = calculate_temperature_score(
                    temps,
                    2,
                    params["low_temp"],
                    params["high_temp"],
                    params["low_temp_min"],
                    params["low_temp_max"],
                    params["high_temp_min"],
                    params["high_temp_max"],
                )
                all_temps_data.append(
                    (city_id, day, city_name, distance, lat, lon, temps, temp_score)
                )
            except KeyError:
                continue

        # Normalize scores
        scores = [d[7] for d in all_temps_data]
        mn, mx = min(scores), max(scores)
        rng = mx - mn if mx > mn else 1

        # Identify direct connection segments
        connection_set = set()
        for a, b in params["connections"]:
            connection_set.add((a, b))
            connection_set.add((b, a))

        direct_segments = set()
        for i in range(len(all_temps_data) - 1):
            id_a = all_temps_data[i][0]
            id_b = all_temps_data[i + 1][0]
            if (id_a, id_b) in connection_set:
                direct_segments.add(i)

        # Split into road sub-routes
        sub_routes = []
        current_start = 0
        for i in range(len(route_locations) - 1):
            if i in direct_segments:
                if current_start < i:
                    sub_routes.append((current_start, i))
                current_start = i + 1
        if current_start < len(route_locations) - 1:
            sub_routes.append((current_start, len(route_locations) - 1))

        # OSRM routing
        osrm_counter = [0]

        def osrm_progress(done_in_sub, total_in_sub):
            osrm_counter[0] += 1
            job["osrm_done"] = osrm_counter[0]
            job["osrm_total"] = max(osrm_counter[0], len(route) - 1)

        all_sub_chunks = []
        for start, end in sub_routes:
            chunks = get_osrm_route(
                route_locations[start : end + 1],
                routing_mode=params["routing_mode"],
                progress_callback=osrm_progress,
            )
            all_sub_chunks.append(chunks)

        # Compute OSRM distances
        osrm_distances = [0.0] * (len(route_locations) - 1)
        for (start, end), chunks in zip(sub_routes, all_sub_chunks):
            sub_locs = route_locations[start : end + 1]
            for j, d in enumerate(compute_distances_from_chunks(chunks, sub_locs)):
                osrm_distances[start + j] = d

        update("elevation", "Building elevation profile...", status="running")

        # Build elevation profile
        city_names_ordered = [d[2] for d in all_temps_data]
        sub_route_data = []
        for (start, end), chunks in zip(sub_routes, all_sub_chunks):
            sub_route_data.append(
                {
                    "chunks": chunks,
                    "locations": route_locations[start : end + 1],
                    "city_names": city_names_ordered[start : end + 1],
                    "city_temps": [
                        (
                            all_temps_data[i][6][0],
                            all_temps_data[i][6][1],
                            all_temps_data[i][6][2]
                            if len(all_temps_data[i][6]) > 2
                            else None,
                        )
                        for i in range(start, end + 1)
                    ],
                }
            )

        elev_data = build_combined_elevation_profile(
            sub_route_data, points_per_1000km=params["elev_points_per_1000km"]
        )

        city_ids_for_elev = [d[0] for d in all_temps_data]
        elevation_result = None
        if elev_data:
            cd_list = elev_data.get("city_data", [])
            elevation_result = {
                "points": [
                    [round(km, 2), round(ele, 1)]
                    for km, ele in elev_data["profile"]
                ],
                "cityMarks": [
                    [round(cd["km"], 2), cd["name"]]
                    for cd in cd_list
                ],
                "cityData": [
                    {
                        "km": round(cd["km"], 2),
                        "name": cd["name"],
                        "cityId": city_ids_for_elev[i] if i < len(city_ids_for_elev) else "",
                        "ele": round(float(cd.get("ele") or 0), 1),
                    }
                    for i, cd in enumerate(cd_list)
                ],
                "totalKm": round(elev_data["profile"][-1][0], 1)
                if elev_data["profile"]
                else 0,
                "totalAscent": round(
                    sum(
                        max(0, elev_data["profile"][i + 1][1] - elev_data["profile"][i][1])
                        for i in range(len(elev_data["profile"]) - 1)
                    ),
                    0,
                ),
                "totalDescent": round(
                    sum(
                        max(0, elev_data["profile"][i][1] - elev_data["profile"][i + 1][1])
                        for i in range(len(elev_data["profile"]) - 1)
                    ),
                    0,
                ),
            }

        # Build segments for map
        segments = []
        for (start, end), chunks in zip(sub_routes, all_sub_chunks):
            for ci, chunk in enumerate(chunks):
                seg_idx = start + ci
                ns = (all_temps_data[min(seg_idx, len(all_temps_data) - 1)][7] - mn) / rng
                segments.append(
                    {
                        "coordinates": [[pt[1], pt[0]] for pt in chunk],  # lon, lat for maplibre
                        "color": _score_color(ns),
                        "isDirect": False,
                    }
                )

        # Direct connection segments (straight lines)
        for i in direct_segments:
            d1 = all_temps_data[i]
            d2 = all_temps_data[i + 1]
            segments.append(
                {
                    "coordinates": [[d1[5], d1[4]], [d2[5], d2[4]]],
                    "color": "#4fc3f7",
                    "isDirect": True,
                }
            )

        # Build markers
        markers = []
        rest_days_map = params.get("city_rest_days", {})
        start_day_val = route[0][1]
        cum_dist = 0.0
        for i, (city_id, day, city_name, dist, lat, lon, temps, temp_score) in enumerate(
            all_temps_data
        ):
            if i > 0:
                cum_dist += osrm_distances[i - 1] if i - 1 < len(osrm_distances) else 0
            markers.append(
                {
                    "id": city_id,
                    "cityName": city_name,
                    "lat": lat,
                    "lon": lon,
                    "dayNumber": day - start_day_val,
                    "relDay": day - start_day_val,
                    "tmin": round(temps[0], 1) if temps[0] is not None else 0,
                    "tmax": round(temps[1], 1) if temps[1] is not None else 0,
                    "prcp": round(temps[2], 1) if len(temps) > 2 and temps[2] is not None else 0,
                    "wspd": round(temps[3], 1) if len(temps) > 3 and temps[3] is not None else 0,
                    "wdir": round(temps[4], 0) if len(temps) > 4 and temps[4] is not None else 0,
                    "score": round((temp_score - mn) / rng * 10, 1),
                    "isRestDay": city_id in rest_days_map,
                }
            )

        # Build weather data for start day table (±70 days offset range)
        weather_stops = []
        for city_id, day, city_name, dist, lat, lon, temps, temp_score in all_temps_data:
            rel_day = day - start_day_val
            by_offset: dict = {}
            for offset in range(-70, 71, 1):
                cal_day = ((day + offset - 1) % 365) + 1
                try:
                    w = get_interpolated_weather(
                        city_id, cal_day, temperatures, params["warming_factor"]
                    )
                    by_offset[str(offset)] = {
                        "tmin": round(w[0], 1) if w[0] is not None else None,
                        "tmax": round(w[1], 1) if w[1] is not None else None,
                        "prcp": round(w[2], 1) if len(w) > 2 and w[2] is not None else None,
                        "wspd": round(w[3], 1) if len(w) > 3 and w[3] is not None else None,
                        "wdir": round(w[4], 0) if len(w) > 4 and w[4] is not None else None,
                    }
                except Exception:
                    pass
            weather_stops.append({
                "relDay": rel_day,
                "cityId": city_id,
                "cityName": city_name,
                "isRestDay": city_id in rest_days_map,
                "restDays": rest_days_map.get(city_id, 0),
                "byOffset": by_offset,
            })

        # Build route list
        route_list = []
        cum_dist = 0.0
        for i, (city_id, day, city_name, _dist, lat, lon, temps, temp_score) in enumerate(
            all_temps_data
        ):
            dist_from_prev = osrm_distances[i - 1] if i > 0 and i - 1 < len(osrm_distances) else 0
            cum_dist += dist_from_prev
            route_list.append(
                {
                    "cityId": city_id,
                    "cityName": city_name,
                    "dayNumber": day - start_day_val,
                    "restDays": rest_days_map.get(city_id, 0),
                    "distanceFromPrev": round(dist_from_prev, 1),
                    "cumulativeDistance": round(cum_dist, 1),
                }
            )

        overall_distance = sum(d for d in osrm_distances if d > 0)
        total_days = all_temps_data[-1][1] - start_day_val if all_temps_data else 0

        # --- Live forecast (only when start is within the next 16 days) ---
        forecast_data = None
        today = date.today()
        for yr in [today.year, today.year + 1]:
            candidate = date(yr, 1, 1) + timedelta(days=start_day - 1)
            if 0 <= (candidate - today).days <= 16:
                actual_start = candidate
                cum_km_list = [0.0]
                for d in osrm_distances:
                    cum_km_list.append(cum_km_list[-1] + (d or 0))
                route_days_list = [day for _, day, _, _ in route]

                profile = (elev_data or {}).get("profile", [])
                latlons = (elev_data or {}).get("profile_latlons", [])
                if profile and latlons and len(profile) == len(latlons):
                    fps = select_forecast_points(profile, latlons)
                    for fp in fps:
                        day_f  = interp_route_day(fp["km"], cum_km_list, route_days_list)
                        offset = round(day_f - route_days_list[0])
                        fp["target_date"] = (actual_start + timedelta(days=offset)).isoformat()
                        fp["day_offset"]  = offset
                    fps = [fp for fp in fps
                           if (date.fromisoformat(fp["target_date"]) - today).days <= 15]
                    fdata = fetch_open_meteo_forecast(fps)
                    mini_elev = [
                        [round(km, 2), round(lat, 5), round(lon, 5), round(ele, 1)]
                        for (km, ele), (lat, lon) in zip(profile, latlons)
                    ][::3]
                    route_stops = []
                    for i_s, (city_id, day, city_name, _) in enumerate(route):
                        nd = city_graph.nodes.get(city_id, {})
                        lat_n = nd.get("lat")
                        lon_n = nd.get("lon")
                        if lat_n is not None and lon_n is not None and i_s < len(cum_km_list):
                            route_stops.append({
                                "name":    city_name,
                                "lat":     round(float(lat_n), 5),
                                "lon":     round(float(lon_n), 5),
                                "km":      round(cum_km_list[i_s], 2),
                                "relDay":  day - route_days_list[0],
                            })
                    forecast_data = {
                        "points":     fps,
                        "data":       {str(k): v for k, v in fdata.items()},
                        "miniElev":   mini_elev,
                        "routeStops": route_stops,
                        "desiredHigh": params["high_temp"],
                        "desiredLow":  params["low_temp"],
                    }
                break

        job["result"] = {
            "segments": segments,
            "markers": markers,
            "elevation": elevation_result,
            "weather": weather_stops,
            "route": route_list,
            "startDay": start_day,
            "totalDistance": round(overall_distance, 1),
            "totalDays": total_days,
            "forecast": forecast_data,
            "desiredHigh": params["high_temp"],
            "desiredLow": params["low_temp"],
        }
        update("elevation", "Done!", status="done")

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)


# ---------------------------------------------------------------------------
# Serve React SPA static files (production)
# ---------------------------------------------------------------------------

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Serve static files if they exist, otherwise serve index.html for SPA routing
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
