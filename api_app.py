"""
FastAPI backend for WeatherRoute.

Serves JSON-only /api/* endpoints for the React SPA frontend.
Keeps all computation logic in module.py; this file handles HTTP + job management.
"""

from __future__ import annotations

import json
import os
import queue as _queue
import threading
import uuid
from datetime import date, datetime, timedelta, time as _time_cls
from pathlib import Path

import difflib
import math
import xml.etree.ElementTree as ET
import pycountry
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

import requests

from module import (
    find_optimal_route,
    load_data,
    load_city_ids_by_country,
    get_interpolated_weather,
    create_loading_route_map,
    check_route_feasibility,
    calculate_temperature_score,
    get_osrm_route,
    compute_distances_from_chunks,
    build_combined_elevation_profile,
    sample_chunk_fixed_density,
    select_forecast_points,
    fetch_open_meteo_forecast,
)

OPEN_ELEV = "https://api.open-elevation.com/api/v1/lookup"

SAVED_ROUTES_DIR = Path("data/saved_routes")
SAVED_ROUTES_DIR.mkdir(parents=True, exist_ok=True)

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
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
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
        "jobType": job.get("jobType", "route"),
        "osrmDone": job["osrm_done"],
        "osrmTotal": job["osrm_total"],
        "roughMap": rough_map,
        "error": job.get("error"),
        "elevationBatchDone": job.get("elevation_batch_done", 0),
        "elevationBatchTotal": job.get("elevation_batch_total", 0),
        "forecastDone": job.get("forecast_done", 0),
        "forecastTotal": job.get("forecast_total", 0),
    }


@app.get("/api/jobs/{job_id}/results")
def job_results(job_id: str):
    job = jobs.get(job_id)
    if not job or job["status"] not in ("done", "preview") or not job.get("result"):
        raise HTTPException(404, "Results not available")
    return job["result"]


@app.post("/api/gpx/jobs")
async def submit_gpx_job(
    file: UploadFile = File(...),
    startDate: str = Form(...),
    dailyConfigs: str = Form("[]"),
):
    content = await file.read()
    latlons = parse_gpx(content)
    if len(latlons) < 2:
        raise HTTPException(400, "GPX-Datei enthält keine gültige Route")
    try:
        configs = json.loads(dailyConfigs)
        if not isinstance(configs, list) or len(configs) == 0:
            raise ValueError("empty")
    except Exception:
        configs = [{"startTime": "09:00", "speed": 15.0, "dailyKm": 90.0}]
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": "elevation",
        "message": "Starte Analyse...",
        "jobType": "gpx",
        "osrm_done": 0,
        "osrm_total": 0,
        "rough_map": None,
        "result": None,
        "error": None,
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
    }
    t = threading.Thread(
        target=run_gpx_analysis,
        args=(job_id, latlons, startDate, configs),
        daemon=True,
    )
    t.start()
    return {"jobId": job_id}


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


# ---------------------------------------------------------------------------
# GPX helpers
# ---------------------------------------------------------------------------


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    lat1r, lon1r, lat2r, lon2r = (math.radians(x) for x in [lat1, lon1, lat2, lon2])
    dlat = lat2r - lat1r
    dlon = lon2r - lon1r
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(max(0.0, a)))


def parse_gpx(content: bytes) -> List[tuple]:
    """Parse GPX XML, return list of (lat, lon) tuples."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return []
    ns = "{http://www.topografix.com/GPX/1/1}"
    trkpts = root.findall(f".//{ns}trkpt")
    if not trkpts:
        trkpts = root.findall(".//trkpt")
    if not trkpts:
        wpts = root.findall(f".//{ns}wpt") or root.findall(".//wpt")
        trkpts = wpts
    latlons: List[tuple] = []
    for pt in trkpts:
        try:
            lat = float(pt.get("lat"))  # type: ignore
            lon = float(pt.get("lon"))  # type: ignore
            latlons.append((lat, lon))
        except (TypeError, ValueError):
            continue
    return latlons


def gpx_subsample(latlons: List[tuple], n_target: int) -> tuple:
    """Subsample lat/lon list to n_target evenly distributed points.
    Returns (sampled_latlons, sampled_km)."""
    if len(latlons) == 0:
        return [], []
    cum_km = [0.0]
    for i in range(1, len(latlons)):
        cum_km.append(cum_km[-1] + _haversine_km(
            latlons[i - 1][0], latlons[i - 1][1], latlons[i][0], latlons[i][1]
        ))
    total_km = cum_km[-1]
    if len(latlons) <= n_target or total_km == 0:
        return list(latlons), list(cum_km)
    target_kms = [total_km * i / (n_target - 1) for i in range(n_target)]
    sampled_latlons: List[tuple] = []
    sampled_km: List[float] = []
    j = 0
    for tkm in target_kms:
        while j < len(cum_km) - 2 and cum_km[j + 1] < tkm:
            j += 1
        if j >= len(latlons) - 1:
            sampled_latlons.append(latlons[-1])
            sampled_km.append(cum_km[-1])
        elif cum_km[j + 1] == cum_km[j]:
            sampled_latlons.append(latlons[j])
            sampled_km.append(cum_km[j])
        else:
            t = (tkm - cum_km[j]) / (cum_km[j + 1] - cum_km[j])
            lat = latlons[j][0] + t * (latlons[j + 1][0] - latlons[j][0])
            lon = latlons[j][1] + t * (latlons[j + 1][1] - latlons[j][1])
            sampled_latlons.append((lat, lon))
            sampled_km.append(tkm)
    return sampled_latlons, sampled_km


def select_gpx_weather_points(
    profile: List[tuple], spacing_km: float = 10.0, peak_interval_km: float = 50.0
) -> List[tuple]:
    """Select weather points along the GPX profile.

    Strategy:
    - 'regular' every spacing_km (default 10 km) – evenly spaced, index-based
      zoom filtering on the frontend guarantees uniform thinning.
    - 'pass'    the highest-elevation point in each peak_interval_km (50 km)
      block – shown at medium zoom levels to highlight major climbs.
    - 'start' / 'end' always.

    Returns list of (profile_index, type) tuples sorted by index.
    """
    n = len(profile)
    if n == 0:
        return []
    if n == 1:
        return [(0, "start")]
    if n == 2:
        return [(0, "start"), (1, "end")]

    total_km = profile[-1][0]
    result: dict = {0: "start", n - 1: "end"}

    # --- Regular points every spacing_km ---
    km_target = spacing_km
    while km_target < total_km - spacing_km * 0.1:
        # Linear interpolation to find approximate index, then local scan
        frac = km_target / total_km
        approx = max(0, min(n - 1, int(frac * (n - 1))))
        best_idx, best_dist = approx, abs(profile[approx][0] - km_target)
        for di in range(-10, 11):
            j = approx + di
            if 0 <= j < n:
                d = abs(profile[j][0] - km_target)
                if d < best_dist:
                    best_dist, best_idx = d, j
        if best_idx not in result:
            result[best_idx] = "regular"
        km_target += spacing_km

    # --- Highest point within each peak_interval_km block ---
    interval_start = 0.0
    while interval_start < total_km:
        interval_end = interval_start + peak_interval_km
        peak_idx, peak_ele = None, -1e9
        for j in range(n):
            km, ele = profile[j]
            if interval_start <= km < interval_end and ele > peak_ele:
                peak_ele, peak_idx = ele, j
        if peak_idx is not None and peak_idx not in result:
            result[peak_idx] = "pass"
        interval_start += peak_interval_km

    return [(k, result[k]) for k in sorted(result.keys())]


def find_nearest_city_id(lat: float, lon: float, graph) -> Optional[str]:
    """Return the city_id of the nearest node in the graph."""
    best_id = None
    best_dist = float("inf")
    for node_id, data in graph.nodes(data=True):
        try:
            nlat = float(data.get("lat", 0))
            nlon = float(data.get("lon", 0))
            d = _haversine_km(lat, lon, nlat, nlon)
            if d < best_dist:
                best_dist = d
                best_id = node_id
        except Exception:
            continue
    return best_id


def _run_elevation_worker(seg_queue, points_per_km, job, result_holder):
    """
    Background thread: consumes (seg_idx, chunk) tuples from seg_queue,
    samples each chunk at a fixed density, and calls Open-Elevation in 512-point
    batches. Terminates on a None sentinel. Results written into result_holder.
    """
    import time as _t

    _BATCH_SIZE = 512
    _MAX_RETRIES = 4
    _RETRY_DELAYS = [5, 15, 30, 60]

    km_offset = 0.0
    pending_latlons = []
    pending_kms = []
    all_latlons = []
    all_kms = []
    api_results = []
    segment_start_kms = {}
    elevation_error = None
    batch_done = 0

    def _fire_batch(latlons, kms):
        nonlocal batch_done, elevation_error
        payload = {"locations": [{"latitude": lat, "longitude": lon} for lat, lon in latlons]}
        for attempt in range(_MAX_RETRIES):
            try:
                resp = requests.post(OPEN_ELEV, json=payload, timeout=45)
                resp.raise_for_status()
                results = resp.json()["results"]
                all_latlons.extend(latlons)
                all_kms.extend(kms)
                api_results.extend(results)
                batch_done += 1
                job["elevation_batch_done"] = batch_done
                return True
            except Exception as err:
                wait = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
                if attempt < _MAX_RETRIES - 1:
                    print(f"[Elevation] Batch {batch_done+1} attempt {attempt+1}: {err} — wait {wait}s", flush=True)
                    _t.sleep(wait)
                else:
                    elevation_error = f"Open-Elevation API fehlgeschlagen (Batch {batch_done+1}): {err}"
                    print(f"[Elevation] Batch {batch_done+1} failed: {err}", flush=True)
                    return False

    while True:
        item = seg_queue.get()
        if item is None:
            break

        seg_idx, chunk = item
        segment_start_kms[seg_idx] = km_offset

        sampled = sample_chunk_fixed_density(chunk, points_per_km)
        if sampled:
            for lat, lon, local_km in sampled:
                pending_latlons.append((lat, lon))
                pending_kms.append(km_offset + local_km)
            km_offset += sampled[-1][2]

        # Drain full batches immediately
        while len(pending_latlons) >= _BATCH_SIZE and not elevation_error:
            batch_latlons = pending_latlons[:_BATCH_SIZE]
            batch_kms = pending_kms[:_BATCH_SIZE]
            pending_latlons = pending_latlons[_BATCH_SIZE:]
            pending_kms = pending_kms[_BATCH_SIZE:]
            if not _fire_batch(batch_latlons, batch_kms):
                pending_latlons = []
                pending_kms = []
                break

    # Flush remaining points
    if pending_latlons and not elevation_error:
        _fire_batch(pending_latlons, pending_kms)

    result_holder["api_results"] = api_results
    result_holder["all_latlons"] = all_latlons
    result_holder["all_kms"] = all_kms
    result_holder["segment_start_kms"] = segment_start_kms
    result_holder["total_km"] = km_offset
    result_holder["elevation_error"] = elevation_error
    result_holder["batch_done"] = batch_done
    print(f"[Elevation] Worker fertig — {batch_done} Batch(es), {len(api_results)} Punkte, {km_offset:.1f} km", flush=True)


def _build_forecast(elev_data, start_day, osrm_distances, route,
                    route_locations, city_graph, params, job):
    """Build forecast_data from elevation data. Also used when restoring saved routes."""
    today = date.today()
    for yr in [today.year, today.year + 1]:
        candidate = date(yr, 1, 1) + timedelta(days=start_day - 1)
        if (candidate - today).days >= 0:
            actual_start = candidate
            cum_km_list = [0.0]
            for d in osrm_distances:
                cum_km_list.append(cum_km_list[-1] + (d or 0))
            route_days_list = [day for _, day, _, _ in route]
            profile = (elev_data or {}).get("profile", [])
            latlons = (elev_data or {}).get("profile_latlons", [])
            if not profile or not latlons or len(profile) != len(latlons):
                return None, "Vorhersage nicht verfügbar: Höhenprofil fehlt"
            fps = select_forecast_points(profile, latlons)
            for fp in fps:
                day_f = interp_route_day(fp["km"], cum_km_list, route_days_list)
                offset = round(day_f - route_days_list[0])
                fp["target_date"] = (actual_start + timedelta(days=offset)).isoformat()
                fp["day_offset"] = offset
            fps_filtered = [fp for fp in fps if (date.fromisoformat(fp["target_date"]) - today).days <= 15]
            if not fps_filtered:
                return None, (
                    f"Alle Routenpunkte liegen mehr als 16 Tage in der Zukunft "
                    f"(Startdatum: {actual_start.isoformat()}, Serverdatum: {today.isoformat()})"
                )
            job["step"] = "forecast"
            job["forecast_total"] = len(fps_filtered)
            job["forecast_done"] = 0
            completed = [0]
            def on_progress():
                completed[0] += 1
                job["forecast_done"] = completed[0]
                job["message"] = f"Vorhersage: {completed[0]}/{len(fps_filtered)} Punkte"
            try:
                fdata = fetch_open_meteo_forecast(fps_filtered, on_progress=on_progress)
            except Exception as fc_exc:
                print(f"[Forecast] Exception: {fc_exc}", flush=True)
                return None, f"Vorhersage-Fehler: {fc_exc}"
            mini_elev = [
                [round(km, 2), round(lat, 5), round(lon, 5), round(ele, 1)]
                for (km, ele), (lat, lon) in zip(profile, latlons)
            ][::3]
            route_stops = []
            for i_s, (city_id, day, city_name, _) in enumerate(route):
                nd = city_graph.nodes.get(city_id, {})
                lat_n = nd.get("lat"); lon_n = nd.get("lon")
                if lat_n is not None and lon_n is not None and i_s < len(cum_km_list):
                    route_stops.append({
                        "name": city_name, "lat": round(float(lat_n), 5),
                        "lon": round(float(lon_n), 5), "km": round(cum_km_list[i_s], 2),
                        "relDay": day - route_days_list[0],
                    })
            return {
                "points": fps_filtered,
                "data": {str(k): v for k, v in fdata.items()},
                "miniElev": mini_elev,
                "routeStops": route_stops,
                "desiredHigh": params["high_temp"],
                "desiredLow": params["low_temp"],
            }, None
    return None, f"Startdatum (Tag {start_day}) liegt nicht in der Zukunft (Serverdatum: {date.today().isoformat()})"


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

        # Estimate elevation batch count for the progress bar (uses graph distances)
        _estimated_total_km = sum(d for _, _, _, d, *_ in all_temps_data if d) or 1000
        _points_per_km = params["elev_points_per_1000km"] / 1000
        _estimated_n_points = max(200, round(_estimated_total_km * _points_per_km))
        job["elevation_batch_total"] = max(1, (_estimated_n_points + 511) // 512)
        job["elevation_batch_done"] = 0

        # Start elevation worker thread before OSRM loop so it can process
        # chunks as they arrive (pipeline: elevation API calls run in parallel
        # with later OSRM segment fetches and post-OSRM CPU work).
        _seg_queue = _queue.Queue()
        _elev_result = {}
        _elev_thread = threading.Thread(
            target=_run_elevation_worker,
            args=(_seg_queue, _points_per_km, job, _elev_result),
            daemon=True,
        )
        _elev_thread.start()

        # OSRM routing — chunk_callback fires after each segment and feeds the queue.
        # Direct-connection segments are inserted in their correct position (by
        # global index) so the worker always receives segments in travel order.
        osrm_counter = [0]
        all_sub_chunks = []
        prev_sub_end = 0

        for start, end in sub_routes:
            # Enqueue any direct segments that precede this sub-route
            for i in range(prev_sub_end, start):
                _seg_queue.put((i, [route_locations[i], route_locations[i + 1]]))
            prev_sub_end = end

            def make_chunk_cb(sub_start):
                def _cb(local_i, chunk):
                    _seg_queue.put((sub_start + local_i, chunk))
                    osrm_counter[0] += 1
                    job["osrm_done"] = osrm_counter[0]
                    job["osrm_total"] = max(osrm_counter[0], len(route) - 1)
                return _cb

            chunks = get_osrm_route(
                route_locations[start : end + 1],
                routing_mode=params["routing_mode"],
                chunk_callback=make_chunk_cb(start),
            )
            all_sub_chunks.append(chunks)

        # Enqueue any trailing direct segments after the last sub-route
        for i in range(prev_sub_end, len(route_locations) - 1):
            _seg_queue.put((i, [route_locations[i], route_locations[i + 1]]))

        # Signal worker: no more segments
        _seg_queue.put(None)

        # Compute OSRM distances
        osrm_distances = [0.0] * (len(route_locations) - 1)
        for (start, end), chunks in zip(sub_routes, all_sub_chunks):
            sub_locs = route_locations[start : end + 1]
            for j, d in enumerate(compute_distances_from_chunks(chunks, sub_locs)):
                osrm_distances[start + j] = d

        city_ids_for_elev = [d[0] for d in all_temps_data]

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

        # --- Helper: format elev_data dict into the JSON result shape ---
        def _fmt_elev(elev_data, city_ids_for_elev):
            if not elev_data:
                return None
            cd_list = elev_data.get("city_data", [])
            profile = elev_data["profile"]
            return {
                "points": [[round(km, 2), round(ele, 1)] for km, ele in profile],
                "cityMarks": [[round(cd["km"], 2), cd["name"]] for cd in cd_list],
                "cityData": [
                    {
                        "km": round(cd["km"], 2),
                        "name": cd["name"],
                        "cityId": city_ids_for_elev[i] if i < len(city_ids_for_elev) else "",
                        "ele": round(float(cd.get("ele") or 0), 1),
                    }
                    for i, cd in enumerate(cd_list)
                ],
                "totalAscent": round(sum(max(0, profile[i+1][1] - profile[i][1]) for i in range(len(profile)-1)), 0),
                "totalDescent": round(sum(max(0, profile[i][1] - profile[i+1][1]) for i in range(len(profile)-1)), 0),
                "totalKm": round(profile[-1][0], 1) if profile else 0,
            }

        # Transition to elevation step — the worker thread is already making
        # API calls in the background (pipeline). The CPU work above ran in
        # parallel with the early elevation batches.
        update("elevation", "Höhenprofil wird geladen...", status="running")

        # Wait for the elevation worker to finish all API calls
        _elev_thread.join()

        # Assemble elevation profile from worker results
        elevation_error = _elev_result.get("elevation_error")
        _api_results     = _elev_result.get("api_results", [])
        _all_kms         = _elev_result.get("all_kms", [])
        _all_latlons     = _elev_result.get("all_latlons", [])
        _seg_start_kms   = _elev_result.get("segment_start_kms", {})
        _worker_total_km = _elev_result.get("total_km", 0.0)

        elev_data = None
        elevation_result = None

        if _api_results and _all_kms:
            _profile = [(km, r["elevation"]) for km, r in zip(_all_kms, _api_results)]

            # City km positions: segment i starts where city i is located.
            # The last city sits at the end of the whole route.
            n_cities = len(all_temps_data)
            _city_kms = [_seg_start_kms.get(i, 0.0) for i in range(n_cities - 1)]
            _city_kms.append(_worker_total_km)

            # Interpolate each city's elevation from the completed profile
            def _interp_ele(km_target):
                for j in range(len(_profile) - 1):
                    km0, e0 = _profile[j]
                    km1, e1 = _profile[j + 1]
                    if km0 <= km_target <= km1:
                        t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
                        return e0 + t * (e1 - e0)
                return _profile[-1][1] if _profile else 0.0

            _city_data = []
            for i, (city_id, day, city_name, _, lat, lon, temps, _score) in enumerate(all_temps_data):
                km = _city_kms[i]
                _city_data.append({
                    "km": km,
                    "name": city_name,
                    "tmin": round(temps[0], 1) if temps[0] is not None else None,
                    "tmax": round(temps[1], 1) if temps[1] is not None else None,
                    "prcp": round(temps[2], 1) if len(temps) > 2 and temps[2] is not None else None,
                    "ele": _interp_ele(km),
                })

            elev_data = {
                "profile": _profile,
                "profile_latlons": _all_latlons,
                "city_marks": [(_cd["km"], _cd["name"]) for _cd in _city_data],
                "city_data": _city_data,
            }
            elevation_result = _fmt_elev(elev_data, city_ids_for_elev)
            if not elevation_result and not elevation_error:
                elevation_error = "Höhenprofil enthält keine Daten"
        elif not elevation_error:
            elevation_error = "Keine Höhenprofil-Daten verfügbar"

        # Build forecast (uses elevation profile if available)
        forecast_data, forecast_error = _build_forecast(
            elev_data, start_day, osrm_distances, route,
            route_locations, city_graph, params, job
        )

        job["result"] = {
            "segments": segments,
            "markers": markers,
            "elevation": elevation_result,
            "elevationError": elevation_error if elevation_result is None else None,
            "elevationComplete": True,
            "weather": weather_stops,
            "route": route_list,
            "startDay": start_day,
            "totalDistance": round(overall_distance, 1),
            "totalDays": total_days,
            "forecast": forecast_data,
            "forecastError": forecast_error,
            "desiredHigh": params["high_temp"],
            "desiredLow": params["low_temp"],
        }
        job["forecast_meta"] = {
            "elev_data": elev_data,
            "start_day": start_day,
            "osrm_distances": osrm_distances,
            "route": [list(t) for t in route],
            "route_locations": list(route_locations),
            "params": {"high_temp": params["high_temp"], "low_temp": params["low_temp"]},
        }
        update("elevation", "Fertig!", status="done")
        job["status"] = "done"
        job["result"]["elevationComplete"] = True

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)


# ---------------------------------------------------------------------------
# GPX background task
# ---------------------------------------------------------------------------


def _gpx_arrival_dt(km: float, daily_configs: List[dict], start_date) -> "datetime":
    """Return the arrival datetime for a point at distance `km` along the route.

    Each config dict has keys: startTime (str HH:MM), speed (float km/h), dailyKm (float).
    """
    cumulative_km = 0.0
    for day_idx, cfg in enumerate(daily_configs):
        day_km = max(0.01, float(cfg.get("dailyKm", 90.0)))
        speed = max(0.01, float(cfg.get("speed", 15.0)))
        start_time_str = cfg.get("startTime", "09:00")
        try:
            h_str, m_str = start_time_str.split(":")
            day_start_time = _time_cls(int(h_str), int(m_str))
        except Exception:
            day_start_time = _time_cls(9, 0)
        day_start_dt = datetime.combine(start_date + timedelta(days=day_idx), day_start_time)
        is_last = day_idx == len(daily_configs) - 1
        if is_last or cumulative_km + day_km >= km - 0.001:
            km_within_day = max(0.0, km - cumulative_km)
            return day_start_dt + timedelta(hours=km_within_day / speed)
        cumulative_km += day_km
    # Fallback (should not happen)
    return datetime.combine(start_date, _time_cls(9, 0))


def _interp_profile_at_km(
    km_target: float, profile: list, sampled_latlons: list
) -> "tuple":
    """Linearly interpolate (lat, lon, ele) at km_target along the elevation profile."""
    n = len(profile)
    if n == 0 or len(sampled_latlons) == 0:
        return 0.0, 0.0, 0.0
    if km_target <= profile[0][0]:
        return sampled_latlons[0][0], sampled_latlons[0][1], profile[0][1]
    for i in range(1, n):
        km0, e0 = profile[i - 1]
        km1, e1 = profile[i]
        if km1 >= km_target or i == n - 1:
            t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
            t = max(0.0, min(1.0, t))
            i0 = min(i - 1, len(sampled_latlons) - 1)
            i1 = min(i, len(sampled_latlons) - 1)
            lat = sampled_latlons[i0][0] + t * (sampled_latlons[i1][0] - sampled_latlons[i0][0])
            lon = sampled_latlons[i0][1] + t * (sampled_latlons[i1][1] - sampled_latlons[i0][1])
            return lat, lon, e0 + t * (e1 - e0)
    j = min(n - 1, len(sampled_latlons) - 1)
    return sampled_latlons[j][0], sampled_latlons[j][1], profile[-1][1]


def run_gpx_analysis(
    job_id: str,
    latlons: List[tuple],
    start_date_str: str,
    daily_configs: List[dict],
):
    import time as _time

    job = jobs[job_id]

    def update(step: str, message: str, **kwargs):
        job["step"] = step
        job["message"] = message
        for k, v in kwargs.items():
            job[k] = v

    try:
        job["status"] = "running"

        # Parse start date
        try:
            start_date = date.fromisoformat(start_date_str)
        except ValueError:
            job["status"] = "error"
            job["error"] = f"Ungültiges Datum: {start_date_str}"
            return

        # Cumulative km of raw track
        cum_km_raw = [0.0]
        for i in range(1, len(latlons)):
            cum_km_raw.append(
                cum_km_raw[-1]
                + _haversine_km(latlons[i - 1][0], latlons[i - 1][1], latlons[i][0], latlons[i][1])
            )
        total_km = cum_km_raw[-1]
        if total_km < 0.01:
            job["status"] = "error"
            job["error"] = "GPX-Track hat keine messbare Länge"
            return

        # Subsample
        n_target = max(100, min(1000, int(total_km * 1.5)))
        sampled_latlons, sampled_km = gpx_subsample(latlons, n_target)
        n_sampled = len(sampled_latlons)

        update("elevation", "Höhenprofil wird geladen...")

        _BATCH_SIZE = 512
        _BATCH_DELAY = 1.5
        _MAX_RETRIES = 4
        _RETRY_DELAYS = [5, 15, 30, 60]

        n_batches = max(1, (n_sampled + _BATCH_SIZE - 1) // _BATCH_SIZE)
        job["elevation_batch_total"] = n_batches

        all_api_results: list = []
        elevation_error = None

        for batch_idx in range(n_batches):
            if batch_idx > 0:
                _time.sleep(_BATCH_DELAY)

            b_start = batch_idx * _BATCH_SIZE
            b_end = min(b_start + _BATCH_SIZE, n_sampled)
            batch = sampled_latlons[b_start:b_end]
            payload = {"locations": [{"latitude": lat, "longitude": lon} for lat, lon in batch]}

            batch_results = None
            for attempt in range(_MAX_RETRIES):
                try:
                    resp = requests.post(OPEN_ELEV, json=payload, timeout=45)
                    resp.raise_for_status()
                    batch_results = resp.json()["results"]
                    break
                except Exception as batch_err:
                    wait = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
                    if attempt < _MAX_RETRIES - 1:
                        print(
                            f"[GPX Elevation] Batch {batch_idx+1} attempt {attempt+1}: {batch_err} — wait {wait}s",
                            flush=True,
                        )
                        _time.sleep(wait)
                    else:
                        elevation_error = (
                            f"Open-Elevation API fehlgeschlagen (Batch {batch_idx+1}/{n_batches}): {batch_err}"
                        )
                        print(f"[GPX Elevation] Batch {batch_idx+1} failed: {batch_err}", flush=True)

            if batch_results is None:
                break
            all_api_results.extend(batch_results)
            job["elevation_batch_done"] = batch_idx + 1
            update("elevation", f"Höhenprofil: Batch {batch_idx+1}/{n_batches}")

        if len(all_api_results) < 2:
            job["status"] = "error"
            job["error"] = elevation_error or "Höhenprofil konnte nicht geladen werden"
            return

        # Build elevation profile
        n_valid = min(len(all_api_results), len(sampled_km))
        raw_eles = [r["elevation"] for r in all_api_results[:n_valid]]
        # Smooth with rolling mean of 3
        smoothed_eles = []
        for i in range(n_valid):
            s = max(0, i - 1)
            e = min(n_valid, i + 2)
            smoothed_eles.append(sum(raw_eles[s:e]) / (e - s))
        profile = [(sampled_km[i], smoothed_eles[i]) for i in range(n_valid)]

        # Select weather points
        weather_point_indices = select_gpx_weather_points(profile)

        update("forecast", f"Wetterdaten für {len(weather_point_indices)} Punkte...")
        job["forecast_total"] = len(weather_point_indices)
        job["forecast_done"] = 0

        today = date.today()
        weather_points: list = []
        # Each entry: (pt_idx, arrival_hour_frac, forecast_point_dict)
        forecast_pts: list = []

        for pt_idx, (idx, label) in enumerate(weather_point_indices):
            km = profile[idx][0]
            ele = profile[idx][1]
            lat, lon = sampled_latlons[idx]
            arrival_dt = _gpx_arrival_dt(km, daily_configs, start_date)
            days_away = (arrival_dt.date() - today).days
            is_forecast = days_away <= 15
            arrival_hour_frac = arrival_dt.hour + arrival_dt.minute / 60.0
            if is_forecast:
                forecast_pts.append((pt_idx, arrival_hour_frac, {
                    "km": km, "lat": lat, "lon": lon, "ele": ele,
                    "target_date": arrival_dt.date().isoformat(),
                    "day_offset": days_away,
                }))
            weather_points.append({
                "km": round(km, 2),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "ele": round(ele, 1),
                "arrivalTime": arrival_dt.isoformat(),
                "type": label,
                "temp": None, "prcp": None,
                "wspd": None, "wdir": None,
                "cloud": None,
                "isForecast": is_forecast,
            })

        done_count = [0]

        # Hourly steps available from fetch_open_meteo_forecast
        _HOUR_STEPS = [0, 6, 12, 18]

        def _nearest_hour_key(hour_frac: float) -> str:
            step = min(_HOUR_STEPS, key=lambda h: abs(hour_frac - h))
            return str(step)

        # Fetch forecast data for points <= 15 days away
        if forecast_pts:
            pts_for_meteo = [fp for _, _, fp in forecast_pts]

            def on_progress():
                done_count[0] += 1
                job["forecast_done"] = done_count[0]
                job["message"] = f"Vorhersage: {done_count[0]}/{job['forecast_total']} Punkte"

            try:
                fdata = fetch_open_meteo_forecast(pts_for_meteo, on_progress=on_progress)
                for i, (pt_idx, arrival_hour_frac, _fp) in enumerate(forecast_pts):
                    pdata = fdata.get(i, {})
                    if pdata.get("ok", False):
                        hourly = pdata.get("hourly") or {}
                        step_key = _nearest_hour_key(arrival_hour_frac)
                        h_data = hourly.get(step_key) or {}
                        weather_points[pt_idx]["temp"] = h_data.get("temp")
                        weather_points[pt_idx]["prcp"] = h_data.get("prcp")
                        weather_points[pt_idx]["wspd"] = h_data.get("wspd")
                        weather_points[pt_idx]["wdir"] = h_data.get("wdir")
                        weather_points[pt_idx]["cloud"] = h_data.get("cloud")
            except Exception as exc:
                print(f"[GPX Forecast] Exception: {exc}", flush=True)

        done_count[0] = len(forecast_pts)

        # Fetch climate data for points > 15 days away
        forecast_pt_set = {pt_idx for pt_idx, _, _ in forecast_pts}
        for pt_idx, (idx, label) in enumerate(weather_point_indices):
            if pt_idx in forecast_pt_set:
                continue
            lat, lon = sampled_latlons[idx]
            km = profile[idx][0]
            arrival_dt = _gpx_arrival_dt(km, daily_configs, start_date)
            day_of_year = arrival_dt.timetuple().tm_yday
            hour_frac = arrival_dt.hour + arrival_dt.minute / 60.0
            nearest_city = find_nearest_city_id(lat, lon, city_graph)
            if nearest_city:
                try:
                    w = get_interpolated_weather(nearest_city, day_of_year, temperatures, 0.0)
                    tmin_c = w[0] if w[0] is not None else 5.0
                    tmax_c = w[1] if w[1] is not None else 15.0
                    # Diurnal model: peak at 14:00, trough at 02:00
                    mean_t = (tmin_c + tmax_c) / 2.0
                    amplitude = (tmax_c - tmin_c) / 2.0
                    temp_at_hour = mean_t + amplitude * math.cos(
                        2 * math.pi * (hour_frac - 14.0) / 24.0
                    )
                    weather_points[pt_idx]["temp"] = round(temp_at_hour, 1)
                    # Daily prcp divided by daylight hours as hourly estimate
                    daily_prcp = w[2] if len(w) > 2 and w[2] is not None else None
                    weather_points[pt_idx]["prcp"] = round(daily_prcp / 24.0, 2) if daily_prcp is not None else None
                    weather_points[pt_idx]["wspd"] = round(w[3], 1) if len(w) > 3 and w[3] is not None else None
                    weather_points[pt_idx]["wdir"] = round(w[4], 0) if len(w) > 4 and w[4] is not None else None
                except Exception as exc:
                    print(f"[GPX Climate] Point {pt_idx} failed: {exc}", flush=True)
            done_count[0] += 1
            job["forecast_done"] = done_count[0]
            job["message"] = f"Klimadaten: {done_count[0]}/{len(weather_point_indices)} Punkte"

        # Add stop weather points for day-change camps
        if len(daily_configs) > 1:
            cum_stop_km = 0.0
            for stop_day_idx in range(len(daily_configs) - 1):
                s_cfg = daily_configs[stop_day_idx]
                s_day_km = max(0.01, float(s_cfg.get("dailyKm", 90.0)))
                cum_stop_km += s_day_km
                stop_km = cum_stop_km
                if stop_km >= total_km - 0.1:
                    break
                stop_lat, stop_lon, stop_ele = _interp_profile_at_km(stop_km, profile, sampled_latlons)
                stop_dt = _gpx_arrival_dt(stop_km, daily_configs, start_date)
                nxt_cfg = daily_configs[stop_day_idx + 1]
                try:
                    _nh, _nm = nxt_cfg.get("startTime", "09:00").split(":")
                    nxt_start_time = _time_cls(int(_nh), int(_nm))
                except Exception:
                    nxt_start_time = _time_cls(9, 0)
                nxt_start_dt = datetime.combine(
                    start_date + timedelta(days=stop_day_idx + 1), nxt_start_time
                )
                stop_is_forecast = (stop_dt.date() - today).days <= 15
                s_city = find_nearest_city_id(stop_lat, stop_lon, city_graph)
                stop_temp = stop_prcp = stop_wspd = None
                if s_city:
                    try:
                        ws = get_interpolated_weather(s_city, stop_dt.timetuple().tm_yday, temperatures, 0.0)
                        s_tmin = ws[0] if ws[0] is not None else 5.0
                        s_tmax = ws[1] if ws[1] is not None else 15.0
                        s_mean = (s_tmin + s_tmax) / 2.0
                        s_amp = (s_tmax - s_tmin) / 2.0
                        s_hf = stop_dt.hour + stop_dt.minute / 60.0
                        stop_temp = round(s_mean + s_amp * math.cos(2 * math.pi * (s_hf - 14.0) / 24.0), 1)
                        s_prcp_day = ws[2] if len(ws) > 2 and ws[2] is not None else None
                        stop_prcp = round(s_prcp_day / 24.0, 2) if s_prcp_day is not None else None
                        stop_wspd = round(ws[3], 1) if len(ws) > 3 and ws[3] is not None else None
                    except Exception:
                        pass
                night_data: list = []
                slot = stop_dt
                while slot <= nxt_start_dt + timedelta(minutes=1):
                    slot_doy = slot.timetuple().tm_yday
                    slot_hf = slot.hour + slot.minute / 60.0
                    sl_temp = sl_prcp = sl_wspd = None
                    if s_city:
                        try:
                            w2 = get_interpolated_weather(s_city, slot_doy, temperatures, 0.0)
                            sl_tmin = w2[0] if w2[0] is not None else 5.0
                            sl_tmax = w2[1] if w2[1] is not None else 15.0
                            sl_mean = (sl_tmin + sl_tmax) / 2.0
                            sl_amp = (sl_tmax - sl_tmin) / 2.0
                            sl_temp = round(sl_mean + sl_amp * math.cos(2 * math.pi * (slot_hf - 14.0) / 24.0), 1)
                            sl_prcp_day = w2[2] if len(w2) > 2 and w2[2] is not None else None
                            sl_prcp = round(sl_prcp_day / 24.0, 2) if sl_prcp_day is not None else None
                            sl_wspd = round(w2[3], 1) if len(w2) > 3 and w2[3] is not None else None
                        except Exception:
                            pass
                    night_data.append({
                        "hour": slot.strftime("%H:%M"),
                        "date": slot.date().isoformat(),
                        "temp": sl_temp,
                        "prcp": sl_prcp,
                        "wspd": sl_wspd,
                    })
                    slot = slot + timedelta(hours=3)
                night_temps_arr = [d["temp"] for d in night_data if d["temp"] is not None]
                night_low = round(min(night_temps_arr), 1) if night_temps_arr else None
                weather_points.append({
                    "km": round(stop_km, 2),
                    "lat": round(stop_lat, 5),
                    "lon": round(stop_lon, 5),
                    "ele": round(stop_ele, 1),
                    "arrivalTime": stop_dt.isoformat(),
                    "type": "stop",
                    "temp": stop_temp,
                    "prcp": stop_prcp,
                    "wspd": stop_wspd,
                    "wdir": None,
                    "cloud": None,
                    "isForecast": stop_is_forecast,
                    "dayNumber": stop_day_idx + 1,
                    "stopTime": stop_dt.isoformat(),
                    "nextStartTime": nxt_start_dt.isoformat(),
                    "nightData": night_data,
                    "nightLow": night_low,
                })

        # Build elevation result
        total_ascent = sum(
            max(0, profile[i + 1][1] - profile[i][1]) for i in range(len(profile) - 1)
        )
        total_descent = sum(
            max(0, profile[i][1] - profile[i + 1][1]) for i in range(len(profile) - 1)
        )
        city_marks = [[round(profile[idx][0], 2), label] for idx, label in weather_point_indices]

        # Downsample track points to max 2000 for the map
        if len(sampled_latlons) > 2000:
            step = len(sampled_latlons) / 2000
            track_pts = [sampled_latlons[int(i * step)] for i in range(2000)]
        else:
            track_pts = list(sampled_latlons)

        job["result"] = {
            "jobType": "gpx",
            "elevation": {
                "points": [[round(km, 2), round(ele, 1)] for km, ele in profile],
                "cityMarks": city_marks,
                "totalAscent": round(total_ascent, 0),
                "totalDescent": round(total_descent, 0),
                "totalKm": round(total_km, 1),
            },
            "weatherPoints": weather_points,
            "totalKm": round(total_km, 1),
            "startDate": start_date_str,
            "startTime": daily_configs[0].get("startTime", "09:00") if daily_configs else "09:00",
            "dailyConfigs": [
                {"startTime": c.get("startTime", "09:00"), "speed": float(c.get("speed", 15.0)), "dailyKm": float(c.get("dailyKm", 90.0))}
                for c in daily_configs
            ],
            "trackPoints": [[round(lat, 5), round(lon, 5)] for lat, lon in track_pts],
        }
        job["status"] = "done"
        update("forecast", "Fertig!")

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)


# ---------------------------------------------------------------------------
# Saved routes
# ---------------------------------------------------------------------------


class SaveRouteRequest(BaseModel):
    jobId: str
    name: str


def run_restore_job(job_id: str, saved_data: dict):
    """Background thread: expose saved result immediately (preview), then refresh forecast."""
    job = jobs[job_id]
    job["result"] = saved_data["result"]
    job["status"] = "preview"
    meta = saved_data.get("forecastMeta")
    if meta and meta.get("elev_data"):
        fresh_forecast, _ = _build_forecast(
            meta["elev_data"],
            meta["start_day"],
            meta["osrm_distances"],
            [tuple(r) for r in meta["route"]],
            meta["route_locations"],
            city_graph,
            meta["params"],
            job,
        )
        if fresh_forecast:
            job["result"] = {**job["result"], "forecast": fresh_forecast}
    job["status"] = "done"


@app.get("/api/saved-routes")
def list_saved_routes():
    routes = []
    for path in sorted(SAVED_ROUTES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            routes.append({
                "id": data["id"],
                "name": data["name"],
                "savedAt": data["savedAt"],
                "totalDistance": data.get("totalDistance", 0),
                "totalDays": data.get("totalDays", 0),
                "startDay": data.get("startDay", 0),
            })
        except Exception:
            continue
    return routes


@app.post("/api/saved-routes")
def save_route(req: SaveRouteRequest):
    job = jobs.get(req.jobId)
    if not job or job["status"] not in ("done", "preview") or not job.get("result"):
        raise HTTPException(404, "Job not found or not completed")
    saved_id = str(uuid.uuid4())
    result = job["result"]
    saved_data = {
        "id": saved_id,
        "name": req.name,
        "savedAt": datetime.utcnow().isoformat(),
        "totalDistance": result.get("totalDistance", 0),
        "totalDays": result.get("totalDays", 0),
        "startDay": result.get("startDay", 0),
        "result": result,
        "forecastMeta": job.get("forecast_meta"),
    }
    path = SAVED_ROUTES_DIR / f"{saved_id}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(saved_data, f, ensure_ascii=False)
    return {"id": saved_id, "name": req.name}


@app.delete("/api/saved-routes/{saved_id}")
def delete_saved_route(saved_id: str):
    path = SAVED_ROUTES_DIR / f"{saved_id}.json"
    if not path.exists():
        raise HTTPException(404, "Saved route not found")
    path.unlink()
    return {"ok": True}


@app.post("/api/saved-routes/{saved_id}/restore")
def restore_saved_route(saved_id: str):
    path = SAVED_ROUTES_DIR / f"{saved_id}.json"
    if not path.exists():
        raise HTTPException(404, "Saved route not found")
    with open(path, encoding="utf-8") as f:
        saved_data = json.load(f)
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": "route",
        "message": "Restoring saved route...",
        "osrm_done": 0,
        "osrm_total": 0,
        "rough_map": None,
        "result": None,
        "error": None,
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
    }
    t = threading.Thread(target=run_restore_job, args=(job_id, saved_data), daemon=True)
    t.start()
    return {"jobId": job_id}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_app:app", host="0.0.0.0", port=8000, reload=False)
