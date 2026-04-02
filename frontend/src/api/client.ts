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
