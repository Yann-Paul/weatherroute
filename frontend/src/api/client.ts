import type {
  CitySearchResult,
  CountrySearchResult,
  JobStatusResponse,
  JobResults,
  PlannerFormData,
  GpxJobResults,
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
  startTime: string,
  avgSpeedKmh: number
): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("startDate", startDate);
  form.append("startTime", startTime);
  form.append("avgSpeedKmh", String(avgSpeedKmh));
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
