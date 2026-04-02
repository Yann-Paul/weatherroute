export interface CitySearchResult {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
  source?: "graph" | "nominatim";
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
  distanceWeight: number;
  tempWeight: number;
  windWeight: number;
  rainWeight: number;
  maxDailyKm: number;
  maxTravelDays: number;
  elevResolution: number;
  blockedCountries: string[];
  sortedInput: boolean;
  directOsrm?: boolean;
  routingMode?: string;
  brouterProfile?: string;
}

export type JobStatus = "pending" | "running" | "done" | "preview" | "error";

export interface JobStatusResponse {
  status: JobStatus;
  step: string;
  message: string;
  jobType?: string;
  algorithm?: string;
  osrmDone: number;
  osrmTotal: number;
  roughMap: RoughMapData | null;
  error: string | null;
  elevationBatchDone: number;
  elevationBatchTotal: number;
  forecastDone: number;
  forecastTotal: number;
  registeringDone: number;
  registeringTotal: number;
  warnings: string[];
  destinationRoutesDone?: number;
  destinationRoutesTotal?: number;
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

export interface ElevationCityData {
  km: number;
  name: string;
  cityId: string;
  ele: number;
}

export interface ElevationProfile {
  points: [number, number][];
  cityMarks: [number, string][];
  cityData?: ElevationCityData[];
  totalAscent: number;
  totalDescent: number;
  totalKm: number;
  dayMarkers?: [number, number][];
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

export interface WeatherOffsetData {
  tmin: number | null;
  tmax: number | null;
  prcp: number | null;
  wspd: number | null;
  wdir: number | null;
  wspdResultant: number | null;
}

export interface WeatherStop {
  relDay: number;
  cityId: string;
  cityName: string;
  lat: number;
  lon: number;
  isRestDay: boolean;
  restDays: number;
  byOffset: Record<string, WeatherOffsetData>;
}

export interface RouteStop {
  cityId: string;
  cityName: string;
  dayNumber: number;
  restDays: number;
  distanceFromPrev: number;
  cumulativeDistance: number;
}

export interface ForecastHourData {
  temp: number | null;
  prcp: number | null;
  wspd: number | null;
  wdir: number | null;
  cloud: number | null;
  sun: number | null;
}

export interface ForecastDailyData {
  prcp: number | null;
  wspd: number | null;
  sun: number | null;
  tmax: number | null;
  tmin: number | null;
}

export interface ForecastPointData {
  ok: boolean;
  hourly?: Record<string, ForecastHourData>;
  daily?: ForecastDailyData;
}

export interface ForecastPoint {
  km: number;
  lat: number;
  lon: number;
  ele: number;
  target_date: string;
  day_offset: number;
}

export interface ForecastData {
  points: ForecastPoint[];
  data: Record<string, ForecastPointData>;
  miniElev: [number, number, number, number][]; // [km, lat, lon, ele]
  routeStops: { name: string; lat: number; lon: number; km: number; relDay: number }[];
  desiredHigh: number;
  desiredLow: number;
}

export interface GpxDayConfig {
  startTime: string;
  speed: number;
  dailyKm: number;
}

export interface GpxNightHour {
  hour: string;
  date: string;
  temp: number | null;
  prcp: number | null;
  wspd: number | null;
}

export interface GpxWeatherPoint {
  km: number;
  lat: number;
  lon: number;
  ele: number;
  arrivalTime: string;
  type: "start" | "end" | "pass" | "valley" | "regular" | "stop";
  temp: number | null;    // temperature at arrival hour
  prcp: number | null;    // precipitation at arrival hour (mm/h)
  wspd: number | null;
  wdir: number | null;
  cloud: number | null;   // cloud cover % (forecast only)
  isForecast: boolean;
  // Stop-specific fields:
  dayNumber?: number;
  stopTime?: string;
  nextStartTime?: string;
  nightData?: GpxNightHour[];
  nightLow?: number | null;
}

export interface GpxJobResults {
  jobType: "gpx";
  elevation: ElevationProfile;
  weatherPoints: GpxWeatherPoint[];
  totalKm: number;
  startDate: string;
  startTime: string;
  dailyConfigs: GpxDayConfig[];
  trackPoints: [number, number][];
}

export interface SavedRouteSummary {
  id: string;
  name: string;
  savedAt: string;
  totalDistance: number;
  totalDays: number;
  startDay: number;
}

/** Planner settings snapshot stored alongside a saved route. */
export type PlannerSettings = PlannerFormData;

export interface DestinationFinderFormData {
  startCity: string;
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
  maxDailyKm: number;
  maxTravelDays: number;
  elevResolution: number;
  blockedCountries: string[];
  routingMode?: string;
  brouterProfile?: string;
  algorithm?: string;
}

export interface DestinationCity {
  id: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
  distance: number;
  tmin: number | null;
  tmax: number | null;
}

export interface DestinationRouteCity {
  cityId: string;
  cityName: string;
  lat: number;
  lon: number;
  dayNumber: number;
  tmin: number | null;
  tmax: number | null;
  prcp: number | null;
  wspd: number | null;
}

export interface DestinationRouteSegment {
  coordinates: [number, number][];
  color: string;
}

export interface DestinationRoute {
  routeIndex: number;
  score: number;
  segments: DestinationRouteSegment[];
  markers: MarkerData[];
  cities: DestinationRouteCity[];
  totalAirKm: number;
  totalDays: number;
  startDay: number;
}

export interface DestinationJobResults {
  type: "destination";
  destinations: DestinationCity[];
  routes: DestinationRoute[];
  startDay: number;
  desiredHigh: number;
  desiredLow: number;
}

export interface JobResults {
  segments: RouteSegment[];
  markers: MarkerData[];
  elevation: ElevationProfile | null;
  elevationError: string | null;
  elevationComplete: boolean;
  weather: WeatherStop[];
  route: RouteStop[];
  startDay: number;
  totalDistance: number;
  totalDays: number;
  forecast: ForecastData | null;
  forecastError: string | null;
  desiredHigh: number;
  desiredLow: number;
}
