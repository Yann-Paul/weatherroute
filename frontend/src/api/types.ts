export interface CitySearchResult {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface CountrySearchResult {
  code: string;
  name: string;
}

export interface CityEntry {
  id: string;
  name: string;
  restDays: number;
}

export interface Connection {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
}

export interface PlannerFormData {
  cities: CityEntry[];
  startCity: string;
  startDay: number | null;
  autoDetectStart: boolean;
  connections: Connection[];
  desiredDayTemp: number;
  desiredNightTemp: number;
  dayTempMin: number;
  dayTempMax: number;
  nightTempMin: number;
  nightTempMax: number;
  warmingFactor: number;
  tempWeight: number;
  maxDailyKm: number;
  maxTravelDays: number;
  elevResolution: number;
  blockedCountries: string[];
  sortedInput: boolean;
}

export type JobStatus = "pending" | "running" | "done" | "error";

export interface JobStatusResponse {
  status: JobStatus;
  step: string;
  message: string;
  osrmDone: number;
  osrmTotal: number;
  roughMap: RoughMapData | null;
  error: string | null;
}

export interface RoughMapData {
  center: [number, number];
  cities: RoughMapCity[];
}

export interface RoughMapCity {
  id: string;
  name: string;
  lat: number;
  lon: number;
  day: number;
  color: string;
}

export interface RouteSegment {
  coordinates: [number, number][];
  color: string;
  isDirect: boolean;
}

export interface MarkerData {
  id: string;
  cityName: string;
  lat: number;
  lon: number;
  dayNumber: number;
  relDay: number;
  tmin: number;
  tmax: number;
  prcp: number;
  wspd: number;
  wdir: number;
  score: number;
  isRestDay: boolean;
}

export interface ElevationProfile {
  points: [number, number][];
  cityMarks: [number, string][];
  totalAscent: number;
  totalDescent: number;
  totalKm: number;
}

export interface WeatherDay {
  day: number;
  date: string;
  cityName: string;
  cityId: string;
  tmin: number;
  tmax: number;
  prcp: number;
  wspd: number;
  wdir: number;
  score: number;
  isRestDay: boolean;
}

export interface RouteStop {
  cityId: string;
  cityName: string;
  dayNumber: number;
  restDays: number;
  distanceFromPrev: number;
  cumulativeDistance: number;
}

export interface JobResults {
  segments: RouteSegment[];
  markers: MarkerData[];
  elevation: ElevationProfile;
  weather: WeatherDay[];
  route: RouteStop[];
  startDay: number;
  totalDistance: number;
  totalDays: number;
}
