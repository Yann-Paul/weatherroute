import type {
  CitySearchResult,
  CountrySearchResult,
  JobStatusResponse,
  JobResults,
  PlannerFormData,
  PlannerSettings,
  GpxJobResults,
  GpxDayConfig,
  SavedRouteSummary,
  DestinationFinderFormData,
  DestinationJobResults,
  ModelForecastData,
  GpxForecastUpdate,
  OpenMeteoParsePoint,
  GpxStopParsePoint,
  GpxStopParseResult,
  ForecastPointData,
  RoutePlannerPoint,
  RoutePreviewResult,
} from "./types";

const BASE = "/api";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function searchCities(query: string): Promise<CitySearchResult[]> {
  if (query.length < 2) return [];
  return request(`/cities/search?q=${encodeURIComponent(query)}`);
}

export async function searchCountries(query: string): Promise<CountrySearchResult[]> {
  if (query.length < 1) return [];
  return request(`/countries/search?q=${encodeURIComponent(query)}`);
}

export async function submitJob(data: PlannerFormData): Promise<{ jobId: string }> {
  return request("/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return request(`/jobs/${jobId}/status`);
}

export async function getJobResults(jobId: string): Promise<JobResults> {
  return request(`/jobs/${jobId}/results`);
}

export async function getModelForecast(jobId: string, model: string): Promise<ModelForecastData> {
  return request(`/jobs/${jobId}/forecast/${model}`);
}

export async function getGpxModelForecast(jobId: string, model: string): Promise<GpxForecastUpdate> {
  return request(`/jobs/${jobId}/gpx-forecast/${model}`);
}

export async function submitGpxJob(
  file: File,
  startDate: string,
  dailyConfigs: GpxDayConfig[]
): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("startDate", startDate);
  form.append("dailyConfigs", JSON.stringify(dailyConfigs));
  const res = await fetch("/api/gpx/jobs", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function getGpxResults(jobId: string): Promise<GpxJobResults> {
  return request(`/jobs/${jobId}/results`);
}

export async function previewRoutePlan(
  points: RoutePlannerPoint[],
  profile: string
): Promise<RoutePreviewResult> {
  return request("/route-planner/preview", {
    method: "POST",
    body: JSON.stringify({ points, profile }),
  });
}

export async function submitRoutePlannerJob(
  points: RoutePlannerPoint[],
  profile: string,
  startDate: string,
  dailyConfigs: GpxDayConfig[]
): Promise<{ jobId: string }> {
  return request("/route-planner/jobs", {
    method: "POST",
    body: JSON.stringify({ points, profile, startDate, dailyConfigs }),
  });
}

export async function getSavedRoutes(): Promise<SavedRouteSummary[]> {
  return request("/saved-routes");
}

export async function saveRoute(
  jobId: string,
  name: string,
  plannerSettings: PlannerSettings
): Promise<{ id: string; name: string }> {
  return request("/saved-routes", {
    method: "POST",
    body: JSON.stringify({ jobId, name, plannerSettings }),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await request(`/saved-routes/${id}`, { method: "DELETE" });
}

export async function restoreSavedRoute(id: string): Promise<{ jobId: string; plannerSettings: PlannerSettings | null }> {
  return request(`/saved-routes/${id}/restore`, { method: "POST" });
}

export async function submitDestinationJob(data: DestinationFinderFormData): Promise<{ jobId: string }> {
  return request("/destination-jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getDestinationResults(jobId: string): Promise<DestinationJobResults> {
  return request(`/jobs/${jobId}/results`);
}

export async function submitDestinationDetailJob(data: {
  cityIds: string[];
  startDay: number;
  desiredDayTemp: number;
  desiredNightTemp: number;
  dayTempMin: number;
  dayTempMax: number;
  nightTempMin: number;
  nightTempMax: number;
  warmingFactor: number;
  tempWeight: number;
  windWeight: number;
  rainWeight: number;
  distanceWeight: number;
  maxDailyKm: number;
  maxTravelDays: number;
  elevResolution: number;
  blockedCountries: string[];
  routingMode?: string;
  brouterProfile?: string;
}): Promise<{ jobId: string }> {
  return request("/destination-detail-jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Client-side weather fallback
//
// When the server can't reach Open-Meteo (its outbound IP got rate-limited,
// which has happened intermittently on Render), the backend still finishes
// the job but leaves the affected points empty and flags
// forecastError === CLIENT_FALLBACK_NEEDED. The browser then fetches
// Open-Meteo directly (using the visitor's own IP) and posts the raw
// response back so the backend can parse it with the same logic as a normal
// server-side fetch.
// ---------------------------------------------------------------------------

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
// Must match OPEN_METEO_HOURLY_FIELDS / OPEN_METEO_DAILY_FIELDS in module.py
const OPEN_METEO_HOURLY_FIELDS =
  "temperature_2m,precipitation,windspeed_10m,winddirection_10m,cloudcover,sunshine_duration";
const OPEN_METEO_DAILY_FIELDS =
  "precipitation_sum,windspeed_10m_max,sunshine_duration,temperature_2m_max,temperature_2m_min";
// Must match the narrow hourly set used for GPX overnight stops in api_app.py
const OPEN_METEO_STOP_HOURLY_FIELDS = "temperature_2m,precipitation,windspeed_10m";

async function fetchOpenMeteoRaw(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${OPEN_METEO_URL}?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }
  return res.json();
}

/** Fetch a batch of route/forecast points directly from the browser, then
 * have the backend parse the raw response (elevation correction etc.). */
export async function fetchForecastViaBrowser(
  points: OpenMeteoParsePoint[],
  model: string
): Promise<Record<string, ForecastPointData>> {
  const rawData = await fetchOpenMeteoRaw({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: OPEN_METEO_HOURLY_FIELDS,
    daily: OPEN_METEO_DAILY_FIELDS,
    models: model,
    forecast_days: "16",
    timezone: "auto",
  });
  const result = await request<ModelForecastData>("/forecast/parse", {
    method: "POST",
    body: JSON.stringify({ points, rawData }),
  });
  return result.data;
}

/** Fetch GPX overnight-stop points directly from the browser, then have the
 * backend parse the raw response (night-time series, elevation correction). */
export async function fetchGpxStopsViaBrowser(
  stops: GpxStopParsePoint[]
): Promise<GpxStopParseResult[]> {
  const rawData = await fetchOpenMeteoRaw({
    latitude: stops.map((s) => s.lat).join(","),
    longitude: stops.map((s) => s.lon).join(","),
    hourly: OPEN_METEO_STOP_HOURLY_FIELDS,
    forecast_days: "16",
    timezone: "auto",
  });
  const result = await request<{ stops: GpxStopParseResult[] }>("/forecast/parse-gpx-stops", {
    method: "POST",
    body: JSON.stringify({ stops, rawData }),
  });
  return result.stops;
}
