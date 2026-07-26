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

import concurrent.futures
import difflib
import hashlib
import math
import time
import xml.etree.ElementTree as ET
import pycountry
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Any, List, Optional

import numpy as np
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
    brouter_route_multi,
    compute_distances_from_chunks,
    build_combined_elevation_profile,
    sample_chunk_fixed_density,
    select_forecast_points,
    build_open_meteo_params,
    request_open_meteo,
    parse_open_meteo_data,
    OpenMeteoUnreachableError,
    find_destination_route,
    find_destination_route_hierarchical,
    haversine,
)

# Sentinel forecastError value: the server couldn't reach Open-Meteo after
# retries (e.g. rate-limited on Render's shared outbound IP). The frontend
# reacts to this specific string by fetching Open-Meteo directly from the
# visitor's browser (their own IP) and posting the raw result back to
# /api/forecast/parse (or /api/forecast/parse-gpx-stops for GPX overnight
# stops) to be parsed server-side.
CLIENT_FALLBACK_NEEDED = "CLIENT_FALLBACK_NEEDED"

OPEN_ELEV_SRTM = "https://api.opentopodata.org/v1/srtm30m"        # SRTM: 60°S–60°N
OPEN_ELEV_ASTER= "https://api.opentopodata.org/v1/aster30m"       # ASTER: global to 83°N

def _elev_api(latlons):
    """Return (url, batch_size, payload_fn) for the appropriate elevation API.
    Uses ASTER (opentopodata) for routes above 59°N or below 56°S; SRTM otherwise."""
    if any(lat > 59.0 or lat < -56.0 for lat, lon in latlons):
        return (OPEN_ELEV_ASTER, 100,
                lambda b: {"locations": "|".join(f"{lat},{lon}" for lat, lon in b)})
    return (OPEN_ELEV_SRTM, 100,
            lambda b: {"locations": "|".join(f"{lat},{lon}" for lat, lon in b)})

SAVED_ROUTES_DIR = Path("data/saved_routes")
SAVED_ROUTES_DIR.mkdir(parents=True, exist_ok=True)


def _friendly_error(err, api_name: str = "") -> str:
    """Convert a raw exception into a user-friendly German error message."""
    prefix = f"{api_name}: " if api_name else ""
    err_str = str(err).lower()
    if "ssl" in err_str or "certificate" in err_str:
        return f"{prefix}SSL-Zertifikat-Fehler (abgelaufen oder ungültig)"
    if isinstance(err, requests.exceptions.Timeout):
        return f"{prefix}Zeitüberschreitung – API antwortet nicht"
    if isinstance(err, requests.exceptions.ConnectionError):
        return f"{prefix}Verbindung nicht möglich – API nicht erreichbar"
    if isinstance(err, requests.exceptions.HTTPError):
        code = getattr(getattr(err, "response", None), "status_code", None)
        if code == 429:
            return f"{prefix}Zu viele Anfragen (Rate Limit)"
        if code in (500, 502, 503, 504):
            return f"{prefix}Server nicht verfügbar (HTTP {code})"
        if code:
            return f"{prefix}HTTP-Fehler {code}"
        return f"{prefix}HTTP-Fehler"
    short = str(err)
    if len(short) > 150:
        short = short[:150] + "…"
    return f"{prefix}{short}"


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

# Rehydrate persisted nominatim cities (nodes + edges) into the in-memory graph
_nominatim_cities_path = os.path.join(DATA_PATH, "nominatim_cities.json")
if os.path.exists(_nominatim_cities_path):
    with open(_nominatim_cities_path, encoding="utf-8") as f:
        _nominatim_cities_data = json.load(f)
    for _nid, _nd in _nominatim_cities_data.items():
        city_graph.add_node(
            _nid,
            name=_nd["name"],
            lat=float(_nd["lat"]),
            lon=float(_nd["lon"]),
            population=0,
        )
        for _nb_id, _weight in _nd.get("edges", {}).items():
            if _nb_id in city_graph.nodes:
                city_graph.add_edge(_nid, _nb_id, weight=_weight)
        city_names[_nd["name"].lower()] = _nid
    print(f"[Startup] {len(_nominatim_cities_data)} Nominatim-Städte rehydriert.", flush=True)


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


_OSRM_TABLE_BASE = "https://router.project-osrm.org"

# Coordinate cache for vectorized nearest-neighbor search.
# Built once on first use; nominatim nodes are excluded so they are never
# returned as candidates for edge connections.
_graph_coord_cache: Optional[tuple] = None  # (node_ids, lats_arr, lons_arr)


def _build_graph_coord_cache() -> None:
    global _graph_coord_cache
    node_ids, lats, lons = [], [], []
    for nid, data in city_graph.nodes(data=True):
        if str(nid).startswith("nominatim:"):
            continue
        try:
            lats.append(float(data["lat"]))
            lons.append(float(data["lon"]))
            node_ids.append(nid)
        except (KeyError, ValueError):
            continue
    _graph_coord_cache = (node_ids, np.array(lats, dtype=np.float64), np.array(lons, dtype=np.float64))


def _find_nearest_graph_nodes(lat: float, lon: float, n: int = 12) -> list:
    """Return list of (node_id, nlat, nlon, air_km) for the n nearest original graph nodes."""
    global _graph_coord_cache
    if _graph_coord_cache is None:
        _build_graph_coord_cache()
    node_ids, lats_arr, lons_arr = _graph_coord_cache

    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    dlat = np.radians(lats_arr) - lat_r
    dlon = np.radians(lons_arr) - lon_r
    a = np.sin(dlat / 2) ** 2 + math.cos(lat_r) * np.cos(np.radians(lats_arr)) * np.sin(dlon / 2) ** 2
    distances_km = 2.0 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))

    top_idx = np.argsort(distances_km)[:n]
    result = []
    for i in top_idx:
        nid = node_ids[i]
        result.append((nid, float(lats_arr[i]), float(lons_arr[i]), float(distances_km[i])))
    return result


def _fetch_osrm_road_distances(origin_lat: float, origin_lon: float, neighbors: list) -> list:
    """
    Get road distances from origin to each neighbor in one OSRM Table API request.
    neighbors: list of (node_id, nlat, nlon, air_km)
    Returns: list of road distances in km (None if no route found), same order.
    """
    # OSRM expects lon,lat order
    coords = [f"{origin_lon},{origin_lat}"] + [f"{nlon},{nlat}" for _, nlat, nlon, _ in neighbors]
    try:
        resp = requests.get(
            f"{_OSRM_TABLE_BASE}/table/v1/driving/{';'.join(coords)}",
            params={"sources": "0", "annotations": "distance"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            print(f"[OSRM-Table] Unerwarteter Code: {data.get('code')}", flush=True)
            return [None] * len(neighbors)
        row = data.get("distances", [[]])[0]
        # row[0] = distance to self (0 m), row[1..] = distances to neighbors (in meters)
        return [
            row[i + 1] / 1000.0 if (i + 1 < len(row) and row[i + 1] is not None) else None
            for i in range(len(neighbors))
        ]
    except Exception as exc:
        print(f"[OSRM-Table] Fehler: {exc}", flush=True)
        return [None] * len(neighbors)


def _fetch_climate_normals_openmeteo(lat: float, lon: float) -> Optional[dict]:
    """
    Fetch 1991-2020 monthly climate normals from Open-Meteo Archive API (ERA5).
    Queries daily data in three 10-year chunks and aggregates to monthly means.
    Returns {str(month): [tmin, tmax, prcp, wspd, None, None]} or None on failure.
    """
    buckets: dict = {m: {"tmin": [], "tmax": [], "prcp": [], "wspd": []} for m in range(1, 13)}
    chunks = [("1991-01-01", "2000-12-31"), ("2001-01-01", "2010-12-31"), ("2011-01-01", "2020-12-31")]
    try:
        for start, end in chunks:
            resp = requests.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": round(lat, 4),
                    "longitude": round(lon, 4),
                    "start_date": start,
                    "end_date": end,
                    "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_mean",
                    "timezone": "UTC",
                },
                timeout=60,
            )
            resp.raise_for_status()
            daily = resp.json().get("daily", {})
            times  = daily.get("time", [])
            tmin_v = daily.get("temperature_2m_min", [])
            tmax_v = daily.get("temperature_2m_max", [])
            prcp_v = daily.get("precipitation_sum", [])
            wspd_v = daily.get("wind_speed_10m_mean", [])
            for i, t in enumerate(times):
                m = int(t[5:7])
                if i < len(tmin_v) and tmin_v[i] is not None:
                    buckets[m]["tmin"].append(tmin_v[i])
                if i < len(tmax_v) and tmax_v[i] is not None:
                    buckets[m]["tmax"].append(tmax_v[i])
                if i < len(prcp_v) and prcp_v[i] is not None:
                    buckets[m]["prcp"].append(prcp_v[i])
                if i < len(wspd_v) and wspd_v[i] is not None:
                    buckets[m]["wspd"].append(wspd_v[i])

        result = {}
        for m in range(1, 13):
            b = buckets[m]
            result[str(m)] = [
                round(sum(b["tmin"]) / len(b["tmin"]), 2) if b["tmin"] else None,
                round(sum(b["tmax"]) / len(b["tmax"]), 2) if b["tmax"] else None,
                round(sum(b["prcp"]) / len(b["prcp"]), 2) if b["prcp"] else None,
                round(sum(b["wspd"]) / len(b["wspd"]), 2) if b["wspd"] else None,
                None,  # wdir — not available
                None,  # wspd_resultant
            ]
        # Validate: all months need at least tmin and tmax
        if any(result[str(m)][0] is None or result[str(m)][1] is None for m in range(1, 13)):
            print(f"[OpenMeteo-Archive] Unvollständige Daten für ({lat}, {lon})", flush=True)
            return None
        return result
    except Exception as exc:
        print(f"[OpenMeteo-Archive] Fehler: {exc}", flush=True)
        return None


def _copy_nearest_temperatures(lat: float, lon: float) -> Optional[dict]:
    """Return a copy of temperature data from the nearest city that has entries in temperatures."""
    for nid, _, _, _ in _find_nearest_graph_nodes(lat, lon, n=30):
        if nid in temperatures:
            return {month: list(vals) for month, vals in temperatures[nid].items()}
    return None


def geocode_city_nominatim(name: str, lang: str = "en") -> Optional[dict]:
    """Geocode a city name via Photon (Komoot). Returns dict with name/lat/lon/country_code or None."""
    try:
        resp = requests.get(
            "https://photon.komoot.io/api/",
            params={"q": name, "limit": 1, "lang": lang},
            headers={"User-Agent": "WeatherRoute/1.0"},
            timeout=10,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            return None
        props = features[0].get("properties", {})
        coords = features[0].get("geometry", {}).get("coordinates", [0, 0])
        short_name = props.get("name") or props.get("city") or name
        country_code = props.get("country_code", "").upper()
        return {
            "name": short_name,
            "lat": float(coords[1]),
            "lon": float(coords[0]),
            "country_code": country_code,
        }
    except Exception as exc:
        print(f"[Photon] Geocoding '{name}' (lang={lang}) fehlgeschlagen: {exc}", flush=True)
        return None


def geocode_and_register_city(raw_name: str) -> Optional[str]:
    """
    Geocode a city, connect it to 12 nearest neighbors via OSRM road distances,
    fetch 30-year climate normals, and register it in city_graph / temperatures /
    city_names / german_city_names.json / city_ids_by_country.json.
    Returns the node ID or None on failure.
    """
    # 1. English coordinates + country code
    en = geocode_city_nominatim(raw_name, lang="en")
    if en is None:
        return None
    lat, lon = en["lat"], en["lon"]
    country_code = en["country_code"]

    # 2. German display name (best-effort)
    de = geocode_city_nominatim(raw_name, lang="de")
    de_name = de["name"] if de else None

    node_id = f"nominatim:{raw_name.strip().lower()}"

    # 3. 12 nearest neighbors by air distance (vectorized, no disk read)
    neighbors = _find_nearest_graph_nodes(lat, lon, n=12)

    # 4. Road distances — ONE OSRM Table request for all 12 neighbors
    road_distances = _fetch_osrm_road_distances(lat, lon, neighbors)

    # 5. Add node to graph (lat/lon as float, consistent with GEXF nodes)
    city_graph.add_node(
        node_id,
        name=en["name"],
        lat=lat,
        lon=lon,
        population=0,
    )

    # 6. Add edges for valid road distances
    edges_added = 0
    persisted_edges: dict = {}
    for (nid, _, _, _), dist_km in zip(neighbors, road_distances):
        if dist_km is not None and dist_km > 0:
            city_graph.add_edge(node_id, nid, weight=dist_km)
            persisted_edges[nid] = dist_km
            edges_added += 1

    # Persist node + edges to nominatim_cities.json
    nom_path = os.path.join(DATA_PATH, "nominatim_cities.json")
    try:
        nom_data = json.load(open(nom_path, encoding="utf-8")) if os.path.exists(nom_path) else {}
        nom_data[node_id] = {
            "name": en["name"],
            "lat": lat,
            "lon": lon,
            "country_code": country_code,
            "edges": persisted_edges,
        }
        with open(nom_path, "w", encoding="utf-8") as f:
            json.dump(nom_data, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[Register] nominatim_cities.json update fehlgeschlagen: {exc}", flush=True)

    # 7. Climate normals via Open-Meteo Archive API (1991-2020)
    climate = _fetch_climate_normals_openmeteo(lat, lon)
    if not climate:
        # Fallback: copy data from nearest city that already has temperature data
        climate = _copy_nearest_temperatures(lat, lon)
        if climate:
            print(f"[Register] Klimadaten für '{en['name']}' von nächster Stadt kopiert.", flush=True)
    if climate:
        temperatures[node_id] = climate
        # Persist to JSON so data survives server restarts
        climate_file = os.path.join(DATA_PATH, "european_city_climate_normals.json")
        try:
            with open(climate_file, encoding="utf-8") as f:
                climate_data = json.load(f)
            climate_data[node_id] = climate
            with open(climate_file, "w", encoding="utf-8") as f:
                json.dump(climate_data, f, ensure_ascii=False)
        except Exception as exc:
            print(f"[Register] Klimadaten-Persistenz fehlgeschlagen: {exc}", flush=True)
    else:
        print(f"[Register] Keine Klimadaten für '{en['name']}' verfügbar — Routenoptimierung eingeschränkt.", flush=True)

    # 8. Register in city_names (EN + input name)
    city_names[raw_name.strip().lower()] = node_id
    en_lower = en["name"].lower()
    if en_lower not in city_names:
        city_names[en_lower] = node_id

    # 9. Register German name in memory and persist to german_city_names.json
    if de_name:
        de_lower = de_name.lower()
        if de_lower not in city_names:
            city_names[de_lower] = node_id
        german_names_path = os.path.join(DATA_PATH, "german_city_names.json")
        if os.path.exists(german_names_path):
            try:
                with open(german_names_path, encoding="utf-8") as f:
                    gn_data = json.load(f)
                if de_lower not in gn_data:
                    gn_data[de_lower] = node_id
                    with open(german_names_path, "w", encoding="utf-8") as f:
                        json.dump(gn_data, f, ensure_ascii=False)
            except Exception as exc:
                print(f"[Register] german_city_names update fehlgeschlagen: {exc}", flush=True)

    # 10. Add to city_ids_by_country (in memory via the per-job load is enough;
    #     also persist to disk so optimization jobs see the new city)
    if country_code:
        country_file = os.path.join(DATA_PATH, "city_ids_by_country.json")
        try:
            with open(country_file, encoding="utf-8") as f:
                cibc = json.load(f)
            cibc.setdefault(country_code, [])
            if node_id not in cibc[country_code]:
                cibc[country_code].append(node_id)
                with open(country_file, "w", encoding="utf-8") as f:
                    json.dump(cibc, f, ensure_ascii=False)
        except Exception as exc:
            print(f"[Register] city_ids_by_country update fehlgeschlagen: {exc}", flush=True)

    print(
        f"[Register] '{raw_name}' → EN:'{en['name']}' DE:'{de_name}' "
        f"({lat:.4f}, {lon:.4f}) land={country_code} "
        f"edges={edges_added}/12 klima={'✓' if climate else '✗'}",
        flush=True,
    )
    return node_id


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
    tempWeight: float = 1.0
    windWeight: float = 0.0
    rainWeight: float = 0.0
    distanceWeight: float = 0.5
    maxDailyKm: float = 120
    maxTravelDays: int = 365
    elevResolution: int = 1000
    blockedCountries: List[str] = []
    sortedInput: bool = False
    directOsrm: bool = False
    routingMode: Optional[str] = "car"
    brouterProfile: Optional[str] = "trekking"


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


_nominatim_cache: dict[str, tuple[float, list]] = {}  # query -> (timestamp, results)
_NOMINATIM_CACHE_TTL = 3600  # 1 hour


@app.get("/api/cities/search")
def search_cities(q: str = Query("", min_length=0)):
    query = q.lower()
    if len(query) < 2:
        return []

    # Local graph results first
    results = []
    seen_names: set[str] = set()
    for name_lower, cid in city_names.items():
        if query in name_lower:
            nd = city_graph.nodes.get(cid, {})
            display_name = nd.get("name", name_lower.title())
            results.append({
                "id": cid,
                "name": display_name,
                "country": nd.get("country"),
                "lat": float(nd.get("lat", 0)),
                "lon": float(nd.get("lon", 0)),
                "source": "graph",
            })
            seen_names.add(display_name.lower())
            if len(results) >= 10:
                break

    # Nominatim fallback when local results are sparse
    if len(results) < 5:
        cache_key = q.lower()
        cached = _nominatim_cache.get(cache_key)
        if cached and (time.time() - cached[0]) < _NOMINATIM_CACHE_TTL:
            nom_results = cached[1]
        else:
            nom_results = []
            try:
                resp = requests.get(
                    "https://photon.komoot.io/api/",
                    params={
                        "q": q,
                        "limit": 5,
                        "lang": "en",
                    },
                    headers={"User-Agent": "WeatherRoute/1.0"},
                    timeout=5,
                )
                resp.raise_for_status()
                for feature in resp.json().get("features", []):
                    props = feature.get("properties", {})
                    coords = feature.get("geometry", {}).get("coordinates", [0, 0])
                    short_name = props.get("name") or props.get("city") or q
                    country_code = props.get("country_code", "").upper()
                    nom_results.append({
                        "id": f"nominatim:{short_name.lower()}",
                        "name": short_name,
                        "country": country_code or None,
                        "lat": float(coords[1]),
                        "lon": float(coords[0]),
                        "source": "nominatim",
                    })
                _nominatim_cache[cache_key] = (time.time(), nom_results)
            except Exception as exc:
                print(f"[Search/Photon] Fehler: {exc}", flush=True)
        for hit in nom_results:
            if hit["name"].lower() not in seen_names and len(results) < 10:
                results.append(hit)
                seen_names.add(hit["name"].lower())

    return results


_geocode_cache: dict[str, tuple[float, list]] = {}  # "lang:query" -> (timestamp, results)
_GEOCODE_CACHE_TTL = 3600  # 1 hour


@app.get("/api/geocode/search")
def geocode_search(q: str = Query("", min_length=0), lang: str = Query("en")):
    """Free-text address/place search (Photon) for the route planner."""
    query = q.strip()
    if len(query) < 3:
        return []
    if lang not in ("de", "en", "fr"):
        lang = "en"
    cache_key = f"{lang}:{query.lower()}"
    cached = _geocode_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _GEOCODE_CACHE_TTL:
        return cached[1]
    try:
        resp = requests.get(
            "https://photon.komoot.io/api/",
            params={"q": query, "limit": 6, "lang": lang},
            headers={"User-Agent": "WeatherRoute/1.0"},
            timeout=5,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"[Geocode/Photon] Fehler: {exc}", flush=True)
        raise HTTPException(502, "Adresssuche derzeit nicht erreichbar")

    results = []
    seen_labels: set[str] = set()
    for feature in resp.json().get("features", []):
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        name = props.get("name")
        street = props.get("street")
        if street and props.get("housenumber"):
            street = f"{street} {props['housenumber']}"
        if not name:
            name, street = street, None
        elif street == name:
            street = None
        city = props.get("city")
        if city and props.get("postcode"):
            city = f"{props['postcode']} {city}"
        parts = [name, street, city, props.get("country")]
        label = ", ".join(str(p) for p in parts if p)
        if not label or label.lower() in seen_labels:
            continue
        seen_labels.add(label.lower())
        results.append({
            "label": label,
            "lat": float(coords[1]),
            "lon": float(coords[0]),
            "type": props.get("osm_value"),
        })
    _geocode_cache[cache_key] = (time.time(), results)
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


def _register_pending_cities(job_id: str, params: dict) -> None:
    """Register pending nominatim cities in the background thread with progress updates."""
    pending = params.get("pending_registration", [])
    if not pending:
        return
    job = jobs[job_id]
    total = len(pending)
    for i, entry in enumerate(pending, 1):
        job["message"] = f"{entry['name']} ({i}/{total})"
        cid = geocode_and_register_city(entry["name"])
        job["registering_done"] = i
        if cid:
            params["city_ids"].append(cid)
            if entry.get("restDays", 0) > 0:
                params["city_rest_days"][cid] = entry["restDays"]
        else:
            print(f"[Job] Stadt nicht gefunden: {entry['name']}", flush=True)


@app.post("/api/jobs")
def submit_job(data: JobSubmission):
    # Resolve city IDs — cities needing Nominatim registration are deferred to the background thread
    city_ids = []
    city_rest_days = {}
    pending_registration: list[dict] = []

    for entry in data.cities:
        cid = entry.id
        # Nominatim city not yet in graph → defer registration to background thread
        if cid and str(cid).startswith("nominatim:") and cid not in city_graph.nodes:
            register_name = entry.name or str(cid).removeprefix("nominatim:")
            pending_registration.append({"name": register_name, "restDays": entry.restDays})
            continue
        if not cid:
            cid, _ = resolve_city_name(entry.name)
        # Unknown name not in local graph → defer to background thread
        if not cid and entry.name:
            pending_registration.append({"name": entry.name, "restDays": entry.restDays})
            continue
        if cid:
            city_ids.append(cid)
            if entry.restDays > 0:
                city_rest_days[cid] = entry.restDays

    if not city_ids and not pending_registration:
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

    has_pending = bool(pending_registration)
    initial_step = "registering" if has_pending else ("osrm" if data.directOsrm else "route")

    params = dict(
        city_ids=city_ids,
        pending_registration=pending_registration,
        city_rest_days=city_rest_days,
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
        wind_weight=data.windWeight,
        rain_weight=data.rainWeight,
        distance_weight=data.distanceWeight,
        warming_factor=data.warmingFactor,
        routing_mode=(
            f"brouter_{data.brouterProfile or 'trekking'}"
            if (data.routingMode or "car") == "brouter"
            else (data.routingMode or "car")
        ),
        sorted_input=data.sortedInput,
        blocked_countries=data.blockedCountries,
    )

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": initial_step,
        "message": "Neue Städte werden registriert..." if has_pending else "Starting calculation...",
        "jobType": "weather_route" if data.directOsrm else "route",
        "osrm_done": 0,
        "osrm_total": 0,
        "rough_map": None,
        "result": None,
        "error": None,
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
        "registering_done": 0,
        "registering_total": len(pending_registration),
        "warnings": [],
    }

    if data.directOsrm:
        t = threading.Thread(target=run_direct_osrm_job, args=(job_id, params), daemon=True)
    else:
        t = threading.Thread(target=run_calculation, args=(job_id, params), daemon=True)
    t.start()

    return {"jobId": job_id}


class DestinationFinderSubmission(BaseModel):
    startCity: str
    startDay: int
    desiredDayTemp: float = 25
    desiredNightTemp: float = 15
    dayTempMin: float = -20
    dayTempMax: float = 50
    nightTempMin: float = -30
    nightTempMax: float = 40
    warmingFactor: float = 1.5
    tempWeight: float = 1.0
    windWeight: float = 0.0
    rainWeight: float = 0.0
    maxDailyKm: float = 120
    maxTravelDays: int = 30
    elevResolution: int = 1000
    blockedCountries: List[str] = []
    routingMode: Optional[str] = "car"
    brouterProfile: Optional[str] = "trekking"
    algorithm: Optional[str] = "beam_search"  # "beam_search" or "hierarchical"


@app.post("/api/destination-jobs")
def submit_destination_job(data: DestinationFinderSubmission):
    start_city, _ = resolve_city_name(data.startCity)
    if not start_city:
        raise HTTPException(400, f"Startstadt nicht gefunden: {data.startCity}")

    params = dict(
        start_city=start_city,
        start_day=data.startDay,
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
        wind_weight=data.windWeight,
        rain_weight=data.rainWeight,
        warming_factor=data.warmingFactor,
        routing_mode=(
            f"brouter_{data.brouterProfile or 'trekking'}"
            if (data.routingMode or "car") == "brouter"
            else (data.routingMode or "car")
        ),
        blocked_countries=data.blockedCountries,
        algorithm=data.algorithm or "beam_search",
    )

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": "destination_search",
        "message": "Zielstädte werden gesucht...",
        "jobType": "destination",
        "algorithm": params.get("algorithm", "beam_search"),
        "osrm_done": 0,
        "osrm_total": 0,
        "rough_map": None,
        "result": None,
        "error": None,
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
        "registering_done": 0,
        "registering_total": 0,
        "warnings": [],
        "destination_routes_done": 0,
        "destination_routes_total": 5,
    }

    t = threading.Thread(target=run_destination_job, args=(job_id, params), daemon=True)
    t.start()

    return {"jobId": job_id}


class DestinationDetailRequest(BaseModel):
    """Start a detailed OSRM+elevation+forecast job for one destination route."""
    cityIds: List[str]
    startDay: int
    desiredDayTemp: float = 25
    desiredNightTemp: float = 15
    dayTempMin: float = -20
    dayTempMax: float = 50
    nightTempMin: float = -30
    nightTempMax: float = 40
    warmingFactor: float = 1.5
    tempWeight: float = 1.0
    windWeight: float = 0.0
    rainWeight: float = 0.0
    distanceWeight: float = 0.5
    maxDailyKm: float = 120
    maxTravelDays: int = 365
    elevResolution: int = 1000
    blockedCountries: List[str] = []
    routingMode: Optional[str] = "car"
    brouterProfile: Optional[str] = "trekking"


@app.post("/api/destination-detail-jobs")
def submit_destination_detail_job(data: DestinationDetailRequest):
    """Turn a destination graph-route into a full OSRM+elevation+forecast job."""
    city_ids = [cid for cid in data.cityIds if cid in city_graph.nodes]
    if len(city_ids) < 2:
        raise HTTPException(400, "Mindestens 2 bekannte Städte erforderlich.")

    params = dict(
        city_ids=city_ids,
        pending_registration=[],
        city_rest_days={},
        start_city=city_ids[0],
        connections=[],
        start_day=data.startDay,
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
        wind_weight=data.windWeight,
        rain_weight=data.rainWeight,
        distance_weight=data.distanceWeight,
        warming_factor=data.warmingFactor,
        routing_mode=(
            f"brouter_{data.brouterProfile or 'trekking'}"
            if (data.routingMode or "car") == "brouter"
            else (data.routingMode or "car")
        ),
        sorted_input=True,   # cities are already in order
        blocked_countries=data.blockedCountries,
    )

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "step": "osrm",
        "message": "Straßenrouting wird berechnet...",
        "jobType": "weather_route",
        "osrm_done": 0,
        "osrm_total": max(0, len(city_ids) - 1),
        "rough_map": None,
        "result": None,
        "error": None,
        "elevation_batch_done": 0,
        "elevation_batch_total": 0,
        "forecast_done": 0,
        "forecast_total": 0,
        "registering_done": 0,
        "registering_total": 0,
        "warnings": [],
    }

    t = threading.Thread(target=run_direct_osrm_job, args=(job_id, params), daemon=True)
    t.start()

    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}/status")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    rough_map = job.get("rough_map")
    error_cities = job.get("error_cities")
    return {
        "status": job["status"],
        "step": job["step"],
        "message": job["message"],
        "jobType": job.get("jobType", "route"),
        "algorithm": job.get("algorithm", "beam_search"),
        "osrmDone": job["osrm_done"],
        "osrmTotal": job["osrm_total"],
        "roughMap": rough_map,
        "error": job.get("error"),
        "errorCities": error_cities,
        "elevationBatchDone": job.get("elevation_batch_done", 0),
        "elevationBatchTotal": job.get("elevation_batch_total", 0),
        "forecastDone": job.get("forecast_done", 0),
        "forecastTotal": job.get("forecast_total", 0),
        "registeringDone": job.get("registering_done", 0),
        "registeringTotal": job.get("registering_total", 0),
        "warnings": job.get("warnings", []),
        "destinationRoutesDone": job.get("destination_routes_done", 0),
        "destinationRoutesTotal": job.get("destination_routes_total", 0),
    }


@app.get("/api/jobs/{job_id}/results")
def job_results(job_id: str):
    job = jobs.get(job_id)
    if not job or job["status"] not in ("done", "preview") or not job.get("result"):
        raise HTTPException(404, "Results not available")
    return job["result"]


_ALLOWED_FORECAST_MODELS = {
    "best_match", "ecmwf_ifs025", "ecmwf_ifs04", "ecmwf_aifs025",
    "icon_seamless", "gfs_seamless", "meteofrance_seamless",
    "metno_seamless", "gem_seamless",
}


_GPX_STOP_HOUR_STEPS = [0, 6, 12, 18]


def _nearest_gpx_hour_key(hour_frac):
    step = min(_GPX_STOP_HOUR_STEPS, key=lambda h: abs(hour_frac - h))
    return str(step)


@app.get("/api/jobs/{job_id}/gpx-forecast/{model_name}")
def gpx_forecast_by_model(job_id: str, model_name: str):
    if model_name not in _ALLOWED_FORECAST_MODELS:
        raise HTTPException(400, "Unknown model")
    job = jobs.get(job_id)
    if not job or job["status"] not in ("done", "preview") or not job.get("result"):
        raise HTTPException(404, "Results not available")
    meta = job.get("gpx_forecast_meta")
    if not meta or not meta.get("forecast_pts"):
        return {"weatherPointUpdates": {}}
    forecast_pts = meta["forecast_pts"]
    valid = [(i, fp) for i, (_, _, fp) in enumerate(forecast_pts)]
    try:
        raw = request_open_meteo(build_open_meteo_params(valid, model_name))
    except OpenMeteoUnreachableError:
        raise HTTPException(503, detail=CLIENT_FALLBACK_NEEDED)
    except Exception as exc:
        raise HTTPException(500, f"Forecast error: {exc}")
    fdata = parse_open_meteo_data(valid, raw)
    updates = {}
    for i, (pt_idx, arrival_hour_frac, _fp) in enumerate(forecast_pts):
        pdata = fdata.get(i, {})
        if pdata.get("ok", False):
            h_data = (pdata.get("hourly") or {}).get(_nearest_gpx_hour_key(arrival_hour_frac)) or {}
            updates[str(pt_idx)] = {
                "temp": h_data.get("temp"),
                "prcp": h_data.get("prcp"),
                "wspd": h_data.get("wspd"),
                "wdir": h_data.get("wdir"),
                "cloud": h_data.get("cloud"),
            }
    return {"weatherPointUpdates": updates}


@app.get("/api/jobs/{job_id}/forecast/{model_name}")
def job_forecast_by_model(job_id: str, model_name: str):
    if model_name not in _ALLOWED_FORECAST_MODELS:
        raise HTTPException(400, "Unknown model")
    job = jobs.get(job_id)
    if not job or job["status"] not in ("done", "preview") or not job.get("result"):
        raise HTTPException(404, "Results not available")
    forecast = job["result"].get("forecast")
    if not forecast:
        raise HTTPException(404, "No forecast data")
    valid = list(enumerate(forecast["points"]))
    try:
        raw = request_open_meteo(build_open_meteo_params(valid, model_name))
    except OpenMeteoUnreachableError:
        raise HTTPException(503, detail=CLIENT_FALLBACK_NEEDED)
    except Exception as exc:
        raise HTTPException(500, f"Forecast error: {exc}")
    fdata = parse_open_meteo_data(valid, raw)
    return {"data": {str(k): v for k, v in fdata.items()}}


class ForecastParsePoint(BaseModel):
    lat: float
    lon: float
    ele: Optional[float] = None
    target_date: str


class ForecastParseRequest(BaseModel):
    points: List[ForecastParsePoint]
    rawData: Any


@app.post("/api/forecast/parse")
def forecast_parse(payload: ForecastParseRequest):
    """Stateless: parse a raw Open-Meteo response the browser fetched itself
    (client-side fallback when the server can't reach Open-Meteo). Applies
    the same elevation-correction/parsing logic as the server-side fetch."""
    raw = payload.rawData
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or len(raw) != len(payload.points):
        raise HTTPException(400, "rawData passt nicht zur Anzahl der Punkte")
    valid = [(i, p.dict()) for i, p in enumerate(payload.points)]
    fdata = parse_open_meteo_data(valid, raw)
    return {"data": {str(k): v for k, v in fdata.items()}}


class GpxStopParsePoint(BaseModel):
    lat: float
    lon: float
    ele: float
    stopTime: str
    nextStartTime: str


class GpxStopParseRequest(BaseModel):
    stops: List[GpxStopParsePoint]
    rawData: Any


@app.post("/api/forecast/parse-gpx-stops")
def forecast_parse_gpx_stops(payload: GpxStopParseRequest):
    """Stateless equivalent of /api/forecast/parse for GPX overnight stops,
    which need a full per-3h night-time series rather than fixed hour steps."""
    raw = payload.rawData
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or len(raw) != len(payload.stops):
        raise HTTPException(400, "rawData passt nicht zur Anzahl der Punkte")
    results = []
    for stop, data in zip(payload.stops, raw):
        stop_dt = datetime.fromisoformat(stop.stopTime)
        nxt_start_dt = datetime.fromisoformat(stop.nextStartTime)
        temp, prcp, wspd, night_data = _parse_gpx_stop_raw(data, stop.ele, stop_dt, nxt_start_dt)
        night_temps = [d["temp"] for d in night_data if d["temp"] is not None]
        results.append({
            "temp": temp, "prcp": prcp, "wspd": wspd,
            "nightData": night_data,
            "nightLow": round(min(night_temps), 1) if night_temps else None,
        })
    return {"stops": results}


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
        "warnings": [],
    }
    t = threading.Thread(
        target=run_gpx_analysis,
        args=(job_id, latlons, startDate, configs),
        daemon=True,
    )
    t.start()
    return {"jobId": job_id}


# ---------------------------------------------------------------------------
# Route planner — classic BRouter point-to-point planning with weather overlay
# ---------------------------------------------------------------------------

# BRouter profile name mapping (store key -> BRouter API name), same mapping
# used for get_osrm_route()'s brouter_* routing modes.
_ROUTE_PLANNER_PROFILES = {
    'trekking': 'trekking',
    'fastbike': 'fastbike',
    'mtb': 'MTB',
    'safety': 'safety',
}


def _resolve_brouter_profile(profile_key: str) -> str:
    return _ROUTE_PLANNER_PROFILES.get(profile_key, 'trekking')


class RoutePlannerPoint(BaseModel):
    lat: float
    lon: float


class RoutePlannerPreviewRequest(BaseModel):
    points: List[RoutePlannerPoint]
    profile: str = "trekking"


@app.post("/api/route-planner/preview")
def route_planner_preview(data: RoutePlannerPreviewRequest):
    """Live route preview while the user places/drags waypoints on the map."""
    if len(data.points) < 2:
        raise HTTPException(400, "Mindestens 2 Punkte nötig")
    points = [(p.lat, p.lon) for p in data.points]
    profile = _resolve_brouter_profile(data.profile)
    try:
        result = brouter_route_multi(points, profile)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, f"BRouter nicht erreichbar: {e}")
    return {
        "coordinates": [{"lat": lat, "lon": lon} for lat, lon in result["coordinates"]],
        "distanceKm": result["distance_km"],
        "ascentM": result["ascent_m"],
    }


class RoutePlannerJobRequest(BaseModel):
    points: List[RoutePlannerPoint]
    profile: str = "trekking"
    startDate: str
    dailyConfigs: List[dict] = []


@app.post("/api/route-planner/jobs")
def submit_route_planner_job(data: RoutePlannerJobRequest):
    """Re-fetch the final route from BRouter server-side, then run it through
    the same weather-analysis pipeline as an uploaded GPX track."""
    if len(data.points) < 2:
        raise HTTPException(400, "Mindestens 2 Punkte nötig")
    points = [(p.lat, p.lon) for p in data.points]
    profile = _resolve_brouter_profile(data.profile)
    try:
        result = brouter_route_multi(points, profile)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, f"BRouter nicht erreichbar: {e}")

    configs = data.dailyConfigs or [{"startTime": "09:00", "speed": 15.0, "dailyKm": 90.0}]

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
        "warnings": [],
    }
    t = threading.Thread(
        target=run_gpx_analysis,
        args=(job_id, result["coordinates"], data.startDate, configs),
        daemon=True,
    )
    t.start()
    return {"jobId": job_id}


# ---------------------------------------------------------------------------
# Route planner map features — Overpass POIs + wind-shelter analysis
# ---------------------------------------------------------------------------

# Public Overpass instances, queried in order — the main instance rate-limits
# concurrent queries per IP (the planner fires POIs + wind-shelter together),
# so a mirror serves as fallback.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
_overpass_cache: dict[str, tuple[float, Any]] = {}  # query-hash -> (timestamp, parsed json)
_OVERPASS_CACHE_TTL = 1800  # 30 min
_overpass_lock = threading.Lock()
_overpass_http_lock = threading.Lock()  # serialize outbound query *sessions* (rate limit)
_overpass_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="overpass")
# how long the primary mirror gets before we also fire the next one ("hedged
# request") — short enough that a stalled instance no longer forces the full
# (10s connect + 35s read) wait onto the caller, long enough that a merely
# slow-but-fine response isn't abandoned for nothing.
_OVERPASS_HEDGE_DELAY_S = 8.0

# POI radius around the route (m) — wide enough to catch a detour-worthy
# shelter, narrow enough to keep Overpass results relevant.
_POI_RADIUS_M = 2000
# Landcover polygons only matter right at the track for the shelter test;
# the wider margin is for the forest overlay to not look clipped.
_LANDCOVER_RADIUS_M = 800
_SHELTER_SAMPLE_KM = 0.25
# Snap route points to this grid before querying/hashing — small route edits
# (a dragged point, GPX resampling jitter) then produce a byte-identical
# query and hit the cache instead of forcing a fresh Overpass round trip.
# 0.001° is ~110 m (lat) / ~70-90 m (lon at mid-latitudes), well inside the
# smaller (800 m) landcover radius so results don't visibly shift.
_OVERPASS_GRID_DEG = 0.001


def _simplify_latlons(points: List[tuple], max_points: int = 60) -> List[tuple]:
    """Thin a polyline to at most max_points, always keeping the endpoints."""
    if len(points) <= max_points:
        return points
    step = (len(points) - 1) / (max_points - 1)
    return [points[round(i * step)] for i in range(max_points)]


def _snap_to_grid(value: float, step: float = _OVERPASS_GRID_DEG) -> float:
    return round(round(value / step) * step, 6)


def _around_polyline(points: List[tuple], radius_m: int) -> str:
    """Build an Overpass 'around' filter from a thinned, grid-snapped
    polyline. Snapping (see _OVERPASS_GRID_DEG) also collapses points that
    land in the same cell, which keeps the query itself a bit shorter."""
    snapped = [(_snap_to_grid(lat), _snap_to_grid(lon)) for lat, lon in _simplify_latlons(points)]
    deduped = [p for i, p in enumerate(snapped) if i == 0 or p != snapped[i - 1]]
    coords = ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in deduped)
    return f"(around:{radius_m},{coords})"


def _fetch_overpass_mirror(url: str, query: str) -> dict:
    # short-ish (connect, read) timeout: a hanging instance must fail fast
    # so the hedge/fallback still feels interactive
    resp = requests.post(
        url,
        data={"data": query},
        timeout=(10, 35),
        headers={"User-Agent": "WeatherRoute/1.0"},
    )
    if resp.status_code in (429, 502, 504):  # busy / rate-limited
        raise requests.RequestException(f"Overpass {resp.status_code} ({url})")
    resp.raise_for_status()
    try:
        return resp.json()
    except ValueError as e:
        raise requests.RequestException(f"Ungültige Overpass-Antwort ({url}): {e}") from e


def _overpass_query(query: str) -> dict:
    """POST a query to Overpass, with a small in-memory TTL cache.

    Query *sessions* (one call to this function) are still serialized via
    _overpass_http_lock — the frontend fires a POI + wind-shelter pair per
    route change, and running both at once would trip Overpass's per-IP
    rate limit. Within one session, mirrors are raced instead of tried
    sequentially: the primary mirror gets a _OVERPASS_HEDGE_DELAY_S head
    start, and if it hasn't answered by then, the next mirror is fired
    concurrently too. Whichever answers first (successfully) wins; a
    straggler response is still cached opportunistically for the next call.
    """
    key = hashlib.sha256(query.encode()).hexdigest()

    def _cached() -> Optional[dict]:
        now = time.time()
        with _overpass_lock:
            cached = _overpass_cache.get(key)
            if cached and (now - cached[0]) < _OVERPASS_CACHE_TTL:
                return cached[1]
            # opportunistic cleanup of expired entries
            for k in [k for k, (ts, _) in _overpass_cache.items() if (now - ts) >= _OVERPASS_CACHE_TTL]:
                del _overpass_cache[k]
        return None

    data = _cached()
    if data is not None:
        return data

    with _overpass_http_lock:
        # a request queued behind us may have fetched the same query already
        data = _cached()
        if data is not None:
            return data

        def _cache_result(fut: "concurrent.futures.Future[dict]") -> None:
            try:
                result = fut.result()
            except Exception:
                return
            with _overpass_lock:
                _overpass_cache[key] = (time.time(), result)

        remaining = list(OVERPASS_URLS)
        pending: dict[concurrent.futures.Future, str] = {}

        def _launch_next() -> None:
            url = remaining.pop(0)
            fut = _overpass_executor.submit(_fetch_overpass_mirror, url, query)
            fut.add_done_callback(_cache_result)
            pending[fut] = url

        _launch_next()
        errors: list[Exception] = []
        while pending:
            timeout = _OVERPASS_HEDGE_DELAY_S if remaining else None
            done, _ = concurrent.futures.wait(
                pending, timeout=timeout, return_when=concurrent.futures.FIRST_COMPLETED
            )
            if not done:
                _launch_next()  # primary is slow -> hedge with the next mirror
                continue
            for fut in done:
                pending.pop(fut)
                try:
                    return fut.result()
                except Exception as e:
                    errors.append(e)
                    if remaining:
                        _launch_next()

        raise errors[-1] if errors else requests.RequestException(
            "Overpass: kein Spiegel-Server erreichbar"
        )


# category -> OSM tag matchers as (tag key, tag value, node_only, list_value).
# node_only skips ways/relations where the feature is practically always a
# single node — keeps the Overpass query cheaper. list_value marks tags whose
# value may be a semicolon-separated list (e.g. vending=bicycle_tube;drinks).
_POI_SELECTORS: dict[str, List[tuple]] = {
    "shelter": [("amenity", "shelter", False, False)],
    "picnic": [("tourism", "picnic_site", False, False), ("leisure", "picnic_table", True, False)],
    "water": [("amenity", "drinking_water", True, False)],
    "toilets": [("amenity", "toilets", False, False)],
    "fuel": [("amenity", "fuel", False, False)],
    "supermarket": [("shop", "supermarket", False, False), ("shop", "convenience", False, False)],
    "food": [("amenity", "restaurant", False, False), ("amenity", "fast_food", False, False)],
    "bakery": [("shop", "bakery", False, False)],
    "cafe": [("amenity", "cafe", False, False)],
    "camping": [("tourism", "camp_site", False, False)],
    "atm": [("amenity", "atm", True, False)],
    "bike_repair": [("shop", "bicycle", False, False), ("amenity", "bicycle_repair_station", True, False)],
    "bike_tube": [("vending", "bicycle_tube", True, True)],
    "train": [("railway", "station", False, False), ("railway", "halt", False, False)],
    "park": [("leisure", "park", False, False)],
    "beach": [("natural", "beach", False, False)],
    "attraction": [("tourism", "attraction", False, False), ("tourism", "viewpoint", False, False)],
    "pass": [("mountain_pass", "yes", True, False)],
}
_POI_CATEGORIES = set(_POI_SELECTORS)

# OSM tags worth surfacing in the POI hover tooltip (whitelist — everything
# else stays server-side so untrusted tag soup never reaches the client).
_POI_DETAIL_TAGS = (
    "shelter_type", "covered", "fee", "access", "capacity", "fireplace",
    "bench", "table", "drinking_water", "bottle", "seasonal",
    "opening_hours", "operator", "description",
    "cuisine", "brand", "wheelchair", "ele",
)


def _poi_category(tags: dict, categories: List[str]) -> Optional[str]:
    for cat in categories:
        for key, value, _node_only, list_value in _POI_SELECTORS[cat]:
            tag = tags.get(key)
            if tag is None:
                continue
            if list_value:
                if value in (part.strip() for part in tag.split(";")):
                    return cat
            elif tag == value:
                return cat
    return None


class MapPoisRequest(BaseModel):
    points: List[RoutePlannerPoint]
    categories: List[str]


@app.post("/api/route-planner/pois")
def route_planner_pois(data: MapPoisRequest):
    """POIs (see _POI_SELECTORS: shelters, drinking water, fuel stations,
    supermarkets, campsites, train stations, sights, mountain passes, …) in a
    corridor around the planned route, fetched from OpenStreetMap via Overpass."""
    if len(data.points) < 2:
        raise HTTPException(400, "Mindestens 2 Punkte nötig")
    categories = [c for c in data.categories if c in _POI_CATEGORIES]
    if not categories:
        raise HTTPException(400, "Keine gültige Kategorie angegeben")

    around = _around_polyline([(p.lat, p.lon) for p in data.points], _POI_RADIUS_M)
    selectors = []
    for cat in categories:
        for key, value, node_only, list_value in _POI_SELECTORS[cat]:
            element = "node" if node_only else "nwr"
            # list-valued tags need a substring regex instead of an exact match
            match = f'["{key}"~"{value}"]' if list_value else f'["{key}"="{value}"]'
            selectors.append(f"{element}{match}{around};")
    query = f'[out:json][timeout:30];({"".join(selectors)});out center 3000;'

    try:
        raw = _overpass_query(query)
    except requests.RequestException as e:
        raise HTTPException(502, f"Overpass nicht erreichbar: {e}")

    pois = []
    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        category = _poi_category(tags, categories)
        if category is None:
            continue
        if "lat" in el:
            lat, lon = el["lat"], el["lon"]
        elif "center" in el:
            lat, lon = el["center"]["lat"], el["center"]["lon"]
        else:
            continue
        pois.append({
            "lat": lat,
            "lon": lon,
            "category": category,
            "name": tags.get("name"),
            "subtype": tags.get("shelter_type"),
            "tags": {k: str(tags[k]) for k in _POI_DETAIL_TAGS if tags.get(k)},
        })
    return {"pois": pois}


def _point_in_ring(lat: float, lon: float, ring: List[tuple]) -> bool:
    """Ray-casting point-in-polygon test; ring is a list of (lat, lon)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        lat_i, lon_i = ring[i]
        lat_j, lon_j = ring[j]
        if (lat_i > lat) != (lat_j > lat):
            x = (lon_j - lon_i) * (lat - lat_i) / (lat_j - lat_i) + lon_i
            if lon < x:
                inside = not inside
        j = i
    return inside


def _sample_polyline(points: List[tuple], step_km: float) -> List[tuple]:
    """Pick vertices along a polyline roughly every step_km.
    Returns (lat, lon, cum_km) tuples; always includes both endpoints."""
    samples = [(points[0][0], points[0][1], 0.0)]
    cum = 0.0
    since_last = 0.0
    for prev, cur in zip(points, points[1:]):
        d = _haversine_km(prev[0], prev[1], cur[0], cur[1])
        cum += d
        since_last += d
        if since_last >= step_km:
            samples.append((cur[0], cur[1], round(cum, 3)))
            since_last = 0.0
    last = (points[-1][0], points[-1][1], round(cum, 3))
    if samples[-1][:2] != last[:2]:
        samples.append(last)
    return samples


class WindShelterRequest(BaseModel):
    points: List[RoutePlannerPoint]


@app.post("/api/route-planner/wind-shelter")
def route_planner_wind_shelter(data: WindShelterRequest):
    """Landcover-based wind-shelter analysis: fetches forest and built-up
    polygons around the route from Overpass, then flags evenly spaced route
    samples as sheltered (inside forest/settlement) or exposed (open land).
    The forest polygons are also returned as GeoJSON for the map overlay.

    Note: only OSM ways are evaluated (no multipolygon relations) — large
    forests mapped as relations may be missed, which errs towards 'exposed'.
    """
    if len(data.points) < 2:
        raise HTTPException(400, "Mindestens 2 Punkte nötig")
    latlons = [(p.lat, p.lon) for p in data.points]

    around = _around_polyline(latlons, _LANDCOVER_RADIUS_M)
    query = (
        '[out:json][timeout:30];('
        f'way["natural"="wood"]{around};'
        f'way["landuse"~"^(forest|residential|industrial)$"]{around};'
        ');out geom 1500;'
    )
    try:
        raw = _overpass_query(query)
    except requests.RequestException as e:
        raise HTTPException(502, f"Overpass nicht erreichbar: {e}")

    # (kind, bbox, ring) — bbox as (min_lat, min_lon, max_lat, max_lon)
    polygons = []
    forest_features = []
    for el in raw.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 4:
            continue
        tags = el.get("tags", {})
        kind = "forest" if tags.get("natural") == "wood" or tags.get("landuse") == "forest" else "urban"
        ring = [(g["lat"], g["lon"]) for g in geom]
        lats = [g[0] for g in ring]
        lons = [g[1] for g in ring]
        polygons.append((kind, (min(lats), min(lons), max(lats), max(lons)), ring))
        if kind == "forest":
            forest_features.append({
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[g["lon"], g["lat"]] for g in geom]],
                },
            })

    samples = []
    for lat, lon, km in _sample_polyline(latlons, _SHELTER_SAMPLE_KM):
        sheltered = False
        for _, (min_lat, min_lon, max_lat, max_lon), ring in polygons:
            if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
                continue
            if _point_in_ring(lat, lon, ring):
                sheltered = True
                break
        samples.append({"lat": lat, "lon": lon, "km": km, "sheltered": sheltered})

    return {
        "samples": samples,
        "forest": {"type": "FeatureCollection", "features": forest_features},
    }


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


def _run_elevation_worker(seg_queue, points_per_km, job, result_holder, use_aster=False):
    """
    Background thread: consumes (seg_idx, chunk) tuples from seg_queue,
    samples each chunk at a fixed density, and calls the elevation API in batches.
    Uses SRTM (open-elevation) for routes ≤59°N, ASTER (opentopodata) for higher.
    Terminates on a None sentinel. Results written into result_holder.
    """
    import time as _t

    if use_aster:
        _elev_url, _BATCH_SIZE, _BATCH_DELAY = OPEN_ELEV_ASTER, 100, 1.1
        _mk_payload = lambda latlons: {
            "locations": "|".join(f"{round(lat, 4)},{round(lon, 4)}" for lat, lon in latlons)
        }
    else:
        _elev_url, _BATCH_SIZE, _BATCH_DELAY = OPEN_ELEV_SRTM, 100, 1.1
        _mk_payload = lambda latlons: {
            "locations": "|".join(f"{round(lat, 4)},{round(lon, 4)}" for lat, lon in latlons)
        }

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
    _last_request_t = 0.0

    def _fire_batch(latlons, kms):
        nonlocal batch_done, elevation_error, _last_request_t
        # Proactive rate-limit throttle for ASTER (1 req/s)
        if _BATCH_DELAY > 0:
            elapsed = _t.monotonic() - _last_request_t
            if elapsed < _BATCH_DELAY:
                _t.sleep(_BATCH_DELAY - elapsed)
        payload = _mk_payload(latlons)
        for attempt in range(_MAX_RETRIES):
            try:
                _last_request_t = _t.monotonic()
                resp = requests.post(_elev_url, json=payload, timeout=45)
                resp.raise_for_status()
                results = resp.json()["results"]
                all_latlons.extend(latlons)
                all_kms.extend(kms)
                api_results.extend(results)
                batch_done += 1
                job["elevation_batch_done"] = batch_done
                return True
            except Exception as err:
                is_rate_limit = (
                    hasattr(err, "response")
                    and err.response is not None
                    and err.response.status_code == 429
                )
                wait = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
                if is_rate_limit:
                    wait = max(wait, 10)  # back off harder on 429
                if attempt < _MAX_RETRIES - 1:
                    print(f"[Elevation] Batch {batch_done+1} attempt {attempt+1}: {err} — wait {wait}s", flush=True)
                    warn = _friendly_error(err, "Höhenprofil-API") + f" – Versuch {attempt+2} in {wait}s"
                    warnings = job.setdefault("warnings", [])
                    if not warnings or warnings[-1] != warn:
                        warnings.append(warn)
                        if len(warnings) > 5:
                            warnings.pop(0)
                    _t.sleep(wait)
                    _last_request_t = _t.monotonic()
                else:
                    elevation_error = _friendly_error(err, "Höhenprofil-API") + f" (Batch {batch_done+1})"
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


def _prepare_forecast_points(elev_data, start_day, osrm_distances, route, params):
    """Compute the list of forecast points (with target_date) plus everything
    needed to assemble the final forecast payload once weather data exists.

    Returns (ctx | None, error | None). This step is pure/deterministic
    (no network calls), so it can be re-run cheaply to resume a forecast
    after a client-side fallback fetch.
    """
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
            return {
                "fps_filtered": fps_filtered,
                "profile": profile,
                "latlons": latlons,
                "cum_km_list": cum_km_list,
                "route_days_list": route_days_list,
            }, None
    return None, f"Startdatum (Tag {start_day}) liegt nicht in der Zukunft (Serverdatum: {date.today().isoformat()})"


def _finish_forecast_result(ctx, fdata, route, city_graph, params):
    """Assemble the final forecast payload from prepared ctx + fetched/parsed
    per-point weather data (fdata may have missing/ok:false entries)."""
    profile = ctx["profile"]
    latlons = ctx["latlons"]
    cum_km_list = ctx["cum_km_list"]
    route_days_list = ctx["route_days_list"]
    fps_filtered = ctx["fps_filtered"]

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
    }


def _build_forecast(elev_data, start_day, osrm_distances, route,
                    route_locations, city_graph, params, job):
    """Build forecast_data from elevation data. Also used when restoring saved routes.

    If Open-Meteo is unreachable from the server, this still returns a full
    forecast payload (points/miniElev/routeStops, but no weather data) with
    forecastError=CLIENT_FALLBACK_NEEDED, so the frontend has enough to fetch
    the weather itself via the visitor's browser and patch it in afterwards.
    """
    ctx, error = _prepare_forecast_points(elev_data, start_day, osrm_distances, route, params)
    if error:
        return None, error

    fps_filtered = ctx["fps_filtered"]
    job["step"] = "forecast"
    job["forecast_total"] = len(fps_filtered)
    job["forecast_done"] = 0
    completed = [0]
    def on_progress():
        completed[0] += 1
        job["forecast_done"] = completed[0]
        job["message"] = f"Vorhersage: {completed[0]}/{len(fps_filtered)} Punkte"

    valid = list(enumerate(fps_filtered))
    try:
        raw = request_open_meteo(build_open_meteo_params(valid, "best_match"))
        fdata = parse_open_meteo_data(valid, raw)
        for _ in fps_filtered:
            on_progress()
        return _finish_forecast_result(ctx, fdata, route, city_graph, params), None
    except OpenMeteoUnreachableError:
        job["message"] = "Wetterdienst nicht erreichbar – wird über deinen Browser nachgeladen"
        return _finish_forecast_result(ctx, {}, route, city_graph, params), CLIENT_FALLBACK_NEEDED
    except Exception as fc_exc:
        print(f"[Forecast] Exception: {fc_exc}", flush=True)
        return None, f"Vorhersage-Fehler: {fc_exc}"


def _fmt_elev(elev_data, city_ids_for_elev):
    """Format elevation data dict into the JSON result shape."""
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


def run_calculation(job_id: str, params: dict):
    job = jobs[job_id]

    def update(step: str, message: str, **kwargs):
        job["step"] = step
        job["message"] = message
        for k, v in kwargs.items():
            job[k] = v

    try:
        job["status"] = "running"
        _register_pending_cities(job_id, params)
        update("route", "Running route algorithm...")

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
        route, start_day, fail_reason, error_data = find_optimal_route(
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
            wind_weight=params["wind_weight"],
            rain_weight=params["rain_weight"],
            distance_weight=params["distance_weight"],
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
            if error_data:
                job["error_cities"] = error_data
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
        _use_aster = any(lat > 59.0 or lat < -56.0 for lat, lon in route_locations)
        _est_batch_size = 100 if _use_aster else 512
        job["elevation_batch_total"] = max(1, (_estimated_n_points + _est_batch_size - 1) // _est_batch_size)
        job["elevation_batch_done"] = 0

        # Start elevation worker thread before OSRM loop so it can process
        # chunks as they arrive (pipeline: elevation API calls run in parallel
        # with later OSRM segment fetches and post-OSRM CPU work).
        _seg_queue = _queue.Queue()
        _elev_result = {}
        _elev_thread = threading.Thread(
            target=_run_elevation_worker,
            args=(_seg_queue, _points_per_km, job, _elev_result),
            kwargs={"use_aster": _use_aster},
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

        # Compute km positions where each new cycling day starts (intra-segment)
        _cum_km_seg = 0.0
        day_markers = []
        n_all = len(all_temps_data)
        for _i in range(n_all - 1):
            _cid = all_temps_data[_i][0]
            _sd = osrm_distances[_i] if _i < len(osrm_distances) else 0.0
            _rest = rest_days_map.get(_cid, 0)
            _nd = max(0.001, all_temps_data[_i + 1][1] - all_temps_data[_i][1] - _rest)
            _kpd = _sd / _nd if _nd > 0 else 0.0
            _dep_rel = all_temps_data[_i][1] - start_day_val + _rest
            _first_int = math.ceil(_dep_rel + 1e-9)
            _last_int = math.floor(_dep_rel + _nd - 1e-9)
            for _d in range(_first_int, _last_int + 1):
                day_markers.append((round(_cum_km_seg + (_d - _dep_rel) * _kpd, 2), _d))
            _cum_km_seg += _sd

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
                        "wspdResultant": round(w[5], 1) if len(w) > 5 and w[5] is not None else None,
                    }
                except Exception:
                    pass
            weather_stops.append({
                "relDay": rel_day,
                "cityId": city_id,
                "cityName": city_name,
                "lat": lat,
                "lon": lon,
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
            _profile = [(km, r["elevation"] or 0) for km, r in zip(_all_kms, _api_results)]

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
            if elevation_result and day_markers:
                elevation_result["dayMarkers"] = [[km, rd] for km, rd in day_markers]
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
        job["error"] = _friendly_error(e)


# ---------------------------------------------------------------------------
# Destination Finder background task
# ---------------------------------------------------------------------------


def run_destination_job(job_id: str, params: dict):
    """Find destination cities + beam-search routes, then OSRM + elevation + forecast."""
    job = jobs[job_id]

    def update(step: str, message: str, **kwargs):
        job["step"] = step
        job["message"] = message
        for k, v in kwargs.items():
            job[k] = v

    try:
        job["status"] = "running"
        update("destination_search", "Zielstädte werden gesucht...")

        city_ids_by_country = load_city_ids_by_country("data/city_ids_by_country.json")

        algorithm = params.get("algorithm", "beam_search")

        def on_beam_progress(step, total):
            pct = int(step / max(1, total) * 100)
            update("beam_search", f"Beam-Search... {pct}%")

        def on_hierarchical_progress(step, total):
            pct = int(step / max(1, total) * 100)
            update("hierarchical_search", f"Hierarchische Wegpunktsuche... {pct}%")

        route_kwargs = dict(
            start_city=params["start_city"],
            start_day=params["start_day"],
            max_days=params["max_days"],
            daily_km=params["daily_km"],
            desired_low_temp=params["low_temp"],
            desired_high_temp=params["high_temp"],
            min_low_temp=params["low_temp_min"],
            max_low_temp=params["low_temp_max"],
            min_high_temp=params["high_temp_min"],
            max_high_temp=params["high_temp_max"],
            warming_factor=params["warming_factor"],
            temp_weight=params["temp_weight"],
            wind_weight=params["wind_weight"],
            rain_weight=params["rain_weight"],
            blocked_countries=params["blocked_countries"],
            city_ids_by_country=city_ids_by_country,
        )

        if algorithm == "hierarchical":
            update("hierarchical_search", "Hierarchische Wegpunktsuche wird gestartet...")
            destinations, routes = find_destination_route_hierarchical(
                city_graph, temperatures,
                **route_kwargs,
                on_progress=on_hierarchical_progress,
            )
        else:
            destinations, routes = find_destination_route(
                city_graph, temperatures,
                **route_kwargs,
                on_progress=on_beam_progress,
            )

        if not routes:
            job["status"] = "error"
            job["error"] = "Keine Routen gefunden."
            return

        # Build destination cities info for response
        dest_info = []
        for cid, score, dist in destinations:
            nd = city_graph.nodes[cid]
            target_day = ((params["start_day"] + params["max_days"] - 1) % 365) + 1
            weather = get_interpolated_weather(cid, target_day, temperatures, params["warming_factor"])
            dest_info.append({
                "id": cid,
                "name": nd.get("name", cid),
                "lat": float(nd["lat"]),
                "lon": float(nd["lon"]),
                "score": round(score, 2),
                "distance": round(dist, 1),
                "tmin": round(weather[0], 1) if weather[0] is not None else None,
                "tmax": round(weather[1], 1) if weather[1] is not None else None,
            })

        # Build graph-only routes (no OSRM — straight lines between nodes)
        update("building_routes", "Routen werden zusammengestellt...")
        route_results = []
        for ri, route_data in enumerate(routes):
            route_cities = route_data['cities']  # list of (city_id, day)

            # Collect city data + weather for each node
            all_temps_data = []
            for city_id, day in route_cities:
                try:
                    nd = city_graph.nodes[city_id]
                    lat, lon = float(nd["lat"]), float(nd["lon"])
                    weather = get_interpolated_weather(
                        city_id, ((day - 1) % 365) + 1, temperatures, params["warming_factor"]
                    )
                    temp_score, _ = calculate_temperature_score(
                        weather, 2,
                        params["low_temp"], params["high_temp"],
                        params["low_temp_min"], params["low_temp_max"],
                        params["high_temp_min"], params["high_temp_max"],
                    )
                    city_name = nd.get("name", city_id)
                    all_temps_data.append(
                        (city_id, day, city_name, lat, lon, weather, temp_score)
                    )
                except KeyError:
                    continue

            if len(all_temps_data) < 2:
                continue

            # Scores for color normalization
            scores = [d[6] for d in all_temps_data]
            mn, mx = min(scores), max(scores)
            rng = mx - mn if mx > mn else 1

            # Straight-line segments between consecutive nodes, colored by score
            segments = []
            for i in range(len(all_temps_data) - 1):
                _, _, _, lat1, lon1, _, score1 = all_temps_data[i]
                _, _, _, lat2, lon2, _, score2 = all_temps_data[i + 1]
                ns = ((score1 + score2) / 2 - mn) / rng
                segments.append({
                    "coordinates": [[lon1, lat1], [lon2, lat2]],
                    "color": _score_color(ns),
                })

            # Markers with full weather info
            start_day_val = all_temps_data[0][1]
            markers = []
            for city_id, day, city_name, lat, lon, temps, temp_score in all_temps_data:
                markers.append({
                    "id": city_id,
                    "cityName": city_name,
                    "lat": lat,
                    "lon": lon,
                    "dayNumber": day - start_day_val,
                    "tmin": round(temps[0], 1) if temps[0] is not None else 0,
                    "tmax": round(temps[1], 1) if temps[1] is not None else 0,
                    "prcp": round(temps[2], 1) if len(temps) > 2 and temps[2] is not None else 0,
                    "wspd": round(temps[3], 1) if len(temps) > 3 and temps[3] is not None else 0,
                    "score": round((temp_score - mn) / rng * 10, 1),
                })

            # Air-distance total (sum of haversine segments)
            total_air_km = sum(
                haversine((all_temps_data[i][3], all_temps_data[i][4]),
                          (all_temps_data[i+1][3], all_temps_data[i+1][4]))
                for i in range(len(all_temps_data) - 1)
            )
            total_days = all_temps_data[-1][1] - start_day_val

            route_results.append({
                "routeIndex": ri,
                "score": round(route_data['score'], 2),
                "segments": segments,
                "markers": markers,
                "cities": [
                    {
                        "cityId": d[0],
                        "cityName": d[2],
                        "lat": d[3],
                        "lon": d[4],
                        "dayNumber": d[1] - start_day_val,
                        "tmin": round(d[5][0], 1) if d[5][0] is not None else None,
                        "tmax": round(d[5][1], 1) if d[5][1] is not None else None,
                        "prcp": round(d[5][2], 1) if len(d[5]) > 2 and d[5][2] is not None else None,
                        "wspd": round(d[5][3], 1) if len(d[5]) > 3 and d[5][3] is not None else None,
                    }
                    for d in all_temps_data
                ],
                "totalAirKm": round(total_air_km, 1),
                "totalDays": total_days,
                "startDay": params["start_day"],
            })

        job["result"] = {
            "type": "destination",
            "destinations": dest_info,
            "routes": route_results,
            "startDay": params["start_day"],
            "desiredHigh": params["high_temp"],
            "desiredLow": params["low_temp"],
        }
        job["destination_routes_done"] = len(routes)
        update("done", "Fertig!", status="done")
        job["status"] = "done"

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = _friendly_error(e)


# ---------------------------------------------------------------------------
# Direct OSRM background task (no graph / TSP)
# ---------------------------------------------------------------------------


def _auto_start_day_direct(city_ids, travel_days, rest_days_map, params):
    """Find optimal start day for a direct-order OSRM route.

    Evaluates 52 weekly candidates across the year and fine-tunes ±3 days
    around the best weekly candidate. Returns the day-of-year (1–365) with
    the minimum average weather score across all cities.
    """
    best_day = 1
    best_score = float("inf")
    candidates = set(range(1, 366, 7))

    def _score_start(start):
        total = 0.0
        current_day = start
        for i, city_id in enumerate(city_ids):
            try:
                day = ((current_day - 1) % 365) + 1
                temps = get_interpolated_weather(city_id, day, temperatures, params["warming_factor"])
                score, _ = calculate_temperature_score(
                    temps, 2,
                    params["low_temp"], params["high_temp"],
                    params["low_temp_min"], params["low_temp_max"],
                    params["high_temp_min"], params["high_temp_max"],
                )
                total += score
            except Exception:
                total += 1000.0
            if i < len(travel_days):
                current_day += travel_days[i]
                current_day += rest_days_map.get(city_id, 0)
        return total / len(city_ids) if city_ids else 0.0

    for start in candidates:
        avg = _score_start(start)
        if avg < best_score:
            best_score = avg
            best_day = start

    # Fine-tune ±3 days around best weekly candidate
    for offset in range(-3, 4):
        candidate = ((best_day + offset - 1) % 365) + 1
        if candidate in candidates:
            continue
        avg = _score_start(candidate)
        if avg < best_score:
            best_score = avg
            best_day = candidate

    return best_day


def run_direct_osrm_job(job_id: str, params: dict):
    """Direct OSRM route: connect cities A→B→C in input order, no graph algorithm."""
    job = jobs[job_id]

    def update(step: str, message: str, **kwargs):
        job["step"] = step
        job["message"] = message
        for k, v in kwargs.items():
            job[k] = v

    try:
        job["status"] = "running"
        _register_pending_cities(job_id, params)
        update("osrm", "Straßendaten werden geladen...")

        # Resolve city coordinates in input order
        city_ids = params["city_ids"]
        route_locations = []
        valid_city_ids = []
        city_name_map = {}
        for cid in city_ids:
            try:
                nd = city_graph.nodes[cid]
                lat, lon = float(nd["lat"]), float(nd["lon"])
                route_locations.append((lat, lon))
                valid_city_ids.append(cid)
                city_name_map[cid] = nd.get("name", cid)
            except KeyError:
                print(f"[DirectOSRM] Stadt-ID '{cid}' nicht im Graph — wird übersprungen.", flush=True)
                continue

        if len(valid_city_ids) < 2:
            job["status"] = "error"
            job["error"] = "Mindestens 2 gültige Städte erforderlich."
            return

        n_cities = len(valid_city_ids)
        n_segments = n_cities - 1
        rest_days_map = params.get("city_rest_days", {})

        # Show cities on preview map immediately (before OSRM runs)
        _preview_start = date.today().timetuple().tm_yday
        _preview_route = [
            (cid, _preview_start + i, city_name_map[cid], 0.0)
            for i, cid in enumerate(valid_city_ids)
        ]
        try:
            job["rough_map"] = create_loading_route_map(
                city_graph, temperatures, _preview_route,
                2,
                params["low_temp"], params["high_temp"],
                params["low_temp_min"], params["low_temp_max"],
                params["high_temp_min"], params["high_temp_max"],
                warming_factor=params["warming_factor"],
            )
        except Exception:
            pass  # preview map is optional

        job["osrm_total"] = n_segments
        job["osrm_done"] = 0

        # Estimate elevation batch total for progress bar
        _points_per_km = params["elev_points_per_1000km"] / 1000
        _estimated_n_points = max(200, round(500 * n_segments * _points_per_km))
        _use_aster = any(lat > 59.0 or lat < -56.0 for lat, lon in route_locations)
        _est_batch_size = 100 if _use_aster else 512
        job["elevation_batch_total"] = max(1, (_estimated_n_points + _est_batch_size - 1) // _est_batch_size)
        job["elevation_batch_done"] = 0

        # Start elevation worker before OSRM so they run in parallel
        _seg_queue = _queue.Queue()
        _elev_result = {}
        _elev_thread = threading.Thread(
            target=_run_elevation_worker,
            args=(_seg_queue, _points_per_km, job, _elev_result),
            kwargs={"use_aster": _use_aster},
            daemon=True,
        )
        _elev_thread.start()

        # OSRM routing for the full route at once
        osrm_counter = [0]

        def _chunk_cb(local_i, chunk):
            _seg_queue.put((local_i, chunk))
            osrm_counter[0] += 1
            job["osrm_done"] = osrm_counter[0]

        chunks = get_osrm_route(
            route_locations,
            routing_mode=params["routing_mode"],
            chunk_callback=_chunk_cb,
        )
        _seg_queue.put(None)  # signal elevation worker: done

        # Compute actual road distances per segment
        osrm_distances = compute_distances_from_chunks(chunks, route_locations)

        # Travel days per segment: ceil(distance / daily_km), minimum 1
        travel_days = [
            max(1, math.ceil(d / params["daily_km"])) if d > 0 else 1
            for d in osrm_distances
        ]

        # Determine start day — direct routes default to TODAY (not climatological optimum),
        # because the user is planning an imminent trip and forecast data is the only
        # meaningful temperature source.
        today_date = date.today()
        start_day = params.get("start_day")
        if start_day is None:
            start_day = today_date.timetuple().tm_yday

        # Build route: [(city_id, arrival_day, city_name, dist_from_prev), ...]
        route = []
        current_day = start_day
        for i, cid in enumerate(valid_city_ids):
            dist = osrm_distances[i - 1] if i > 0 else 0.0
            route.append((cid, current_day, city_name_map[cid], dist))
            if i < n_segments:
                current_day += travel_days[i]
                current_day += rest_days_map.get(cid, 0)

        # Compute actual calendar start date for forecast-window filtering
        actual_start_date = today_date
        for yr in [today_date.year, today_date.year + 1]:
            candidate = date(yr, 1, 1) + timedelta(days=start_day - 1)
            if (candidate - today_date).days >= 0:
                actual_start_date = candidate
                break

        start_day_val = route[0][1]

        # Compute km positions where each new cycling day starts (intra-segment)
        _cum_km_seg = 0.0
        day_markers = []
        for _i in range(n_segments):
            _cid = valid_city_ids[_i]
            _sd = osrm_distances[_i] if _i < len(osrm_distances) else 0.0
            _nd = max(0.001, travel_days[_i] if _i < len(travel_days) else 1)
            _kpd = _sd / _nd if _nd > 0 else 0.0
            _rest = rest_days_map.get(_cid, 0)
            _dep_rel = route[_i][1] - start_day_val + _rest
            _first_int = math.ceil(_dep_rel + 1e-9)
            _last_int = math.floor(_dep_rel + _nd - 1e-9)
            for _d in range(_first_int, _last_int + 1):
                day_markers.append((round(_cum_km_seg + (_d - _dep_rel) * _kpd, 2), _d))
            _cum_km_seg += _sd

        def _in_forecast(day):
            """True if this arrival day falls within the 16-day forecast window."""
            arrival = actual_start_date + timedelta(days=day - start_day_val)
            return (arrival - today_date).days <= 15

        # Build all_temps_data with weather scores
        all_temps_data = []
        for city_id, day, city_name, distance in route:
            nd = city_graph.nodes[city_id]
            lat, lon = float(nd["lat"]), float(nd["lon"])
            temps = get_interpolated_weather(city_id, day, temperatures, params["warming_factor"])
            temp_score, _ = calculate_temperature_score(
                temps, 2,
                params["low_temp"], params["high_temp"],
                params["low_temp_min"], params["low_temp_max"],
                params["high_temp_min"], params["high_temp_max"],
            )
            all_temps_data.append((city_id, day, city_name, distance, lat, lon, temps, temp_score))

        # Normalize scores for segment colors
        scores = [d[7] for d in all_temps_data]
        mn, mx = min(scores), max(scores)
        rng = mx - mn if mx > mn else 1

        # Build map segments from OSRM chunks
        segments = []
        for ci, chunk in enumerate(chunks):
            ns = (all_temps_data[min(ci, len(all_temps_data) - 1)][7] - mn) / rng
            segments.append({
                "coordinates": [[pt[1], pt[0]] for pt in chunk],
                "color": _score_color(ns),
                "isDirect": False,
            })

        # Build markers — only for cities within the 16-day forecast window
        markers = []
        cum_dist = 0.0
        for i, (city_id, day, city_name, dist, lat, lon, temps, temp_score) in enumerate(all_temps_data):
            if i > 0:
                cum_dist += osrm_distances[i - 1] if i - 1 < len(osrm_distances) else 0
            if not _in_forecast(day):
                continue
            markers.append({
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
            })

        # Build weather stops — only for cities within the 16-day forecast window
        weather_stops = []
        for city_id, day, city_name, dist, lat, lon, temps, temp_score in all_temps_data:
            if not _in_forecast(day):
                continue
            rel_day = day - start_day_val
            by_offset: dict = {}
            for offset in range(-70, 71, 1):
                cal_day = ((day + offset - 1) % 365) + 1
                try:
                    w = get_interpolated_weather(city_id, cal_day, temperatures, params["warming_factor"])
                    by_offset[str(offset)] = {
                        "tmin": round(w[0], 1) if w[0] is not None else None,
                        "tmax": round(w[1], 1) if w[1] is not None else None,
                        "prcp": round(w[2], 1) if len(w) > 2 and w[2] is not None else None,
                        "wspd": round(w[3], 1) if len(w) > 3 and w[3] is not None else None,
                        "wdir": round(w[4], 0) if len(w) > 4 and w[4] is not None else None,
                        "wspdResultant": round(w[5], 1) if len(w) > 5 and w[5] is not None else None,
                    }
                except Exception:
                    pass
            weather_stops.append({
                "relDay": rel_day,
                "cityId": city_id,
                "cityName": city_name,
                "lat": lat,
                "lon": lon,
                "isRestDay": city_id in rest_days_map,
                "restDays": rest_days_map.get(city_id, 0),
                "byOffset": by_offset,
            })

        # Build route list
        route_list = []
        cum_dist = 0.0
        for i, (city_id, day, city_name, _dist, lat, lon, temps, temp_score) in enumerate(all_temps_data):
            dist_from_prev = osrm_distances[i - 1] if i > 0 and i - 1 < len(osrm_distances) else 0
            cum_dist += dist_from_prev
            route_list.append({
                "cityId": city_id,
                "cityName": city_name,
                "dayNumber": day - start_day_val,
                "restDays": rest_days_map.get(city_id, 0),
                "distanceFromPrev": round(dist_from_prev, 1),
                "cumulativeDistance": round(cum_dist, 1),
            })

        overall_distance = sum(d for d in osrm_distances if d > 0)
        total_days = all_temps_data[-1][1] - start_day_val if all_temps_data else 0

        # Wait for elevation worker to finish
        update("elevation", "Höhenprofil wird geladen...")
        _elev_thread.join()

        # Assemble elevation result
        elevation_error = _elev_result.get("elevation_error")
        _api_results = _elev_result.get("api_results", [])
        _all_kms = _elev_result.get("all_kms", [])
        _all_latlons = _elev_result.get("all_latlons", [])
        _seg_start_kms = _elev_result.get("segment_start_kms", {})
        _worker_total_km = _elev_result.get("total_km", 0.0)

        elev_data = None
        elevation_result = None

        if _api_results and _all_kms:
            _profile = [(km, r["elevation"] or 0) for km, r in zip(_all_kms, _api_results)]

            _city_kms = [_seg_start_kms.get(i, 0.0) for i in range(n_cities - 1)]
            _city_kms.append(_worker_total_km)

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
            city_ids_for_elev = [d[0] for d in all_temps_data]
            elevation_result = _fmt_elev(elev_data, city_ids_for_elev)
            if elevation_result and day_markers:
                elevation_result["dayMarkers"] = [[km, rd] for km, rd in day_markers]
            if not elevation_result and not elevation_error:
                elevation_error = "Höhenprofil enthält keine Daten"
        elif not elevation_error:
            elevation_error = "Keine Höhenprofil-Daten verfügbar"

        # Build forecast
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
        job["error"] = _friendly_error(e)


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


def _parse_gpx_stop_raw(data, stop_ele, stop_dt, nxt_start_dt):
    """Turn one raw Open-Meteo response (narrow hourly set: temp/precip/wind)
    into (stop_temp, stop_prcp, stop_wspd, night_data) for a GPX overnight
    stop. Shared between the server-side fetch and the client-fallback parse
    endpoint (the browser fetches the raw data, this parses it either way)."""
    model_ele = data.get("elevation")
    elev_corr = (stop_ele - model_ele) * 0.0065 if model_ele is not None else 0.0

    def _tc(v):
        return round(v - elev_corr, 1) if v is not None else None

    htimes = data.get("hourly", {}).get("time", [])
    htemp  = data.get("hourly", {}).get("temperature_2m", [])
    hprcp  = data.get("hourly", {}).get("precipitation", [])
    hwspd  = data.get("hourly", {}).get("windspeed_10m", [])
    hw = {
        t: {
            "temp": htemp[i] if i < len(htemp) else None,
            "prcp": hprcp[i] if i < len(hprcp) else None,
            "wspd": hwspd[i] if i < len(hwspd) else None,
        }
        for i, t in enumerate(htimes)
    }

    def _nearest_hw(dt):
        for delta in [0, 1, -1, 2, -2, 3, -3]:
            key = (dt + timedelta(hours=delta)).strftime("%Y-%m-%dT%H:00")
            if key in hw:
                return hw[key]
        return {}

    sw = _nearest_hw(stop_dt)
    stop_temp = _tc(sw.get("temp"))
    stop_prcp = round(sw["prcp"], 2) if sw.get("prcp") is not None else None
    stop_wspd = round(sw["wspd"], 1) if sw.get("wspd") is not None else None

    night_data = []
    slot = stop_dt
    while slot < nxt_start_dt - timedelta(minutes=1):
        slw = _nearest_hw(slot)
        night_data.append({
            "hour": slot.strftime("%H:%M"),
            "date": slot.date().isoformat(),
            "temp": _tc(slw.get("temp")),
            "prcp": round(slw["prcp"], 2) if slw.get("prcp") is not None else None,
            "wspd": round(slw["wspd"], 1) if slw.get("wspd") is not None else None,
        })
        slot = slot + timedelta(hours=3)
    # Always include an explicit point at departure time so that
    # interpNightMs(tNightEnd) and adjStartTemp on day N+1 are accurate.
    slw_dep = _nearest_hw(nxt_start_dt)
    night_data.append({
        "hour": nxt_start_dt.strftime("%H:%M"),
        "date": nxt_start_dt.date().isoformat(),
        "temp": _tc(slw_dep.get("temp")),
        "prcp": round(slw_dep["prcp"], 2) if slw_dep.get("prcp") is not None else None,
        "wspd": round(slw_dep["wspd"], 1) if slw_dep.get("wspd") is not None else None,
    })
    return stop_temp, stop_prcp, stop_wspd, night_data


def _gpx_stop_climate_night_series(s_city, stop_dt, nxt_start_dt, temperatures):
    """Climate-normals estimate of (temp, prcp, wspd, night_data) for a GPX
    overnight stop, used both for stops >15 days out and as an immediate
    degraded placeholder when Open-Meteo is unreachable."""
    stop_temp = stop_prcp = stop_wspd = None
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

    def _climate_slot_entry(sl):
        sl_doy = sl.timetuple().tm_yday
        sl_hf = sl.hour + sl.minute / 60.0
        sl_temp = sl_prcp = sl_wspd = None
        try:
            w2 = get_interpolated_weather(s_city, sl_doy, temperatures, 0.0)
            sl_tmin = w2[0] if w2[0] is not None else 5.0
            sl_tmax = w2[1] if w2[1] is not None else 15.0
            sl_mean = (sl_tmin + sl_tmax) / 2.0
            sl_amp = (sl_tmax - sl_tmin) / 2.0
            sl_temp = round(sl_mean + sl_amp * math.cos(2 * math.pi * (sl_hf - 14.0) / 24.0), 1)
            sl_prcp_day = w2[2] if len(w2) > 2 and w2[2] is not None else None
            sl_prcp = round(sl_prcp_day / 24.0, 2) if sl_prcp_day is not None else None
            sl_wspd = round(w2[3], 1) if len(w2) > 3 and w2[3] is not None else None
        except Exception:
            pass
        return {"hour": sl.strftime("%H:%M"), "date": sl.date().isoformat(),
                "temp": sl_temp, "prcp": sl_prcp, "wspd": sl_wspd}

    night_data = []
    slot = stop_dt
    while slot < nxt_start_dt - timedelta(minutes=1):
        night_data.append(_climate_slot_entry(slot))
        slot = slot + timedelta(hours=3)
    # Always include an explicit point at departure time so that
    # interpNightMs(tNightEnd) and adjStartTemp on day N+1 are accurate.
    night_data.append(_climate_slot_entry(nxt_start_dt))
    return stop_temp, stop_prcp, stop_wspd, night_data


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

        _gpx_elev_url, _BATCH_SIZE, _gpx_payload_fn = _elev_api(sampled_latlons)
        _BATCH_DELAY = 1.1  # both opentopodata APIs (SRTM + ASTER) require ~1 req/s
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
            payload = _gpx_payload_fn(batch)

            batch_results = None
            for attempt in range(_MAX_RETRIES):
                try:
                    resp = requests.post(_gpx_elev_url, json=payload, timeout=45)
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
                        warn = _friendly_error(batch_err, "Höhenprofil-API") + f" – Versuch {attempt+2} in {wait}s"
                        warnings = job.setdefault("warnings", [])
                        if not warnings or warnings[-1] != warn:
                            warnings.append(warn)
                            if len(warnings) > 5:
                                warnings.pop(0)
                        _time.sleep(wait)
                    else:
                        elevation_error = _friendly_error(batch_err, "Höhenprofil-API") + f" (Batch {batch_idx+1}/{n_batches})"
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
        raw_eles = [r["elevation"] or 0 for r in all_api_results[:n_valid]]
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
                "forecastPending": False,
            })

        done_count = [0]
        gpx_forecast_error = None
        _nearest_hour_key = _nearest_gpx_hour_key

        # Store forecast point metadata so model switching can re-fetch later
        job["gpx_forecast_meta"] = {
            "forecast_pts": [(pt_idx, ah_frac, fp) for pt_idx, ah_frac, fp in forecast_pts]
        }

        # Fetch forecast data for points <= 15 days away
        if forecast_pts:
            pts_for_meteo = [fp for _, _, fp in forecast_pts]

            def on_progress():
                done_count[0] += 1
                job["forecast_done"] = done_count[0]
                job["message"] = f"Vorhersage: {done_count[0]}/{job['forecast_total']} Punkte"

            valid = list(enumerate(pts_for_meteo))
            try:
                raw = request_open_meteo(build_open_meteo_params(valid, "best_match"))
                fdata = parse_open_meteo_data(valid, raw)
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
                for _ in pts_for_meteo:
                    on_progress()
            except OpenMeteoUnreachableError:
                gpx_forecast_error = CLIENT_FALLBACK_NEEDED
                for pt_idx, _, _fp in forecast_pts:
                    weather_points[pt_idx]["forecastPending"] = True
                for _ in pts_for_meteo:
                    on_progress()
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

        # Add stop weather points for day-change camps.
        # Forecast-eligible stops are gathered first and fetched in a single
        # batched Open-Meteo call (instead of one request per stop), which
        # both reduces load on the free-tier rate limit and lets us apply
        # the same unreachable -> client-fallback handling as route points.
        stops_needing_forecast = []
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
                night_data: list = []
                if not stop_is_forecast and s_city:
                    stop_temp, stop_prcp, stop_wspd, night_data = _gpx_stop_climate_night_series(
                        s_city, stop_dt, nxt_start_dt, temperatures
                    )
                night_temps_arr = [d["temp"] for d in night_data if d["temp"] is not None]
                night_low = round(min(night_temps_arr), 1) if night_temps_arr else None

                weather_idx = len(weather_points)
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
                    "forecastPending": False,
                    "dayNumber": stop_day_idx + 1,
                    "stopTime": stop_dt.isoformat(),
                    "nextStartTime": nxt_start_dt.isoformat(),
                    "nightData": night_data,
                    "nightLow": night_low,
                })

                if stop_is_forecast:
                    stops_needing_forecast.append({
                        "weather_idx": weather_idx, "lat": stop_lat, "lon": stop_lon,
                        "ele": stop_ele, "stop_dt": stop_dt, "nxt_start_dt": nxt_start_dt,
                        "s_city": s_city,
                    })

        if stops_needing_forecast:
            stop_params = {
                "latitude": ",".join(str(s["lat"]) for s in stops_needing_forecast),
                "longitude": ",".join(str(s["lon"]) for s in stops_needing_forecast),
                "hourly": "temperature_2m,precipitation,windspeed_10m",
                "forecast_days": 16,
                "timezone": "auto",
            }
            try:
                raw_stops = request_open_meteo(stop_params)
                if isinstance(raw_stops, dict):
                    raw_stops = [raw_stops]
                for s, data in zip(stops_needing_forecast, raw_stops):
                    wp = weather_points[s["weather_idx"]]
                    try:
                        temp, prcp, wspd, night_data = _parse_gpx_stop_raw(
                            data, s["ele"], s["stop_dt"], s["nxt_start_dt"]
                        )
                        wp["temp"], wp["prcp"], wp["wspd"] = temp, prcp, wspd
                        wp["nightData"] = night_data
                        night_temps = [d["temp"] for d in night_data if d["temp"] is not None]
                        wp["nightLow"] = round(min(night_temps), 1) if night_temps else None
                    except Exception as exc:
                        print(f"[GPX Stop Forecast] Point failed: {exc}", flush=True)
            except OpenMeteoUnreachableError:
                gpx_forecast_error = CLIENT_FALLBACK_NEEDED
                # Immediate graceful degradation (as before) while flagging the
                # point so the frontend can silently replace it with a real
                # forecast once the browser-side retry succeeds.
                for s in stops_needing_forecast:
                    wp = weather_points[s["weather_idx"]]
                    wp["forecastPending"] = True
                    if s["s_city"]:
                        temp, prcp, wspd, night_data = _gpx_stop_climate_night_series(
                            s["s_city"], s["stop_dt"], s["nxt_start_dt"], temperatures
                        )
                        wp["temp"], wp["prcp"], wp["wspd"] = temp, prcp, wspd
                        wp["nightData"] = night_data
                        night_temps = [d["temp"] for d in night_data if d["temp"] is not None]
                        wp["nightLow"] = round(min(night_temps), 1) if night_temps else None

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
            "forecastError": gpx_forecast_error,
        }
        job["status"] = "done"
        update("forecast", "Fertig!")

    except Exception as e:
        import traceback
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = _friendly_error(e)


# ---------------------------------------------------------------------------
# Saved routes
# ---------------------------------------------------------------------------


class SaveRouteRequest(BaseModel):
    jobId: str
    name: str
    plannerSettings: Optional[dict] = None


def run_restore_job(job_id: str, saved_data: dict):
    """Background thread: expose saved result immediately (preview), then refresh forecast."""
    job = jobs[job_id]
    job["result"] = saved_data["result"]
    job["status"] = "preview"
    meta = saved_data.get("forecastMeta")
    if meta and meta.get("elev_data"):
        job["forecast_meta"] = meta
        fresh_forecast, forecast_error = _build_forecast(
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
            job["result"] = {**job["result"], "forecast": fresh_forecast, "forecastError": forecast_error}
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
        "plannerSettings": req.plannerSettings,
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
    return {"jobId": job_id, "plannerSettings": saved_data.get("plannerSettings")}


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
        return FileResponse(
            str(FRONTEND_DIST / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_app:app", host="0.0.0.0", port=8000, reload=False)
