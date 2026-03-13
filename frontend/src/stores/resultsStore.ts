import { create } from "zustand";
import type {
  RouteSegment,
  MarkerData,
  ElevationProfile,
  WeatherStop,
  RouteStop,
  ForecastData,
} from "@/api/types";

interface ResultsState {
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

  activeTab: string;
  dateOffset: number;
  tableStep: number;
  tableColumns: number;

  setResults: (data: {
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
  }) => void;
  updateElevation: (data: {
    elevation: ElevationProfile | null;
    elevationError: string | null;
    elevationComplete: boolean;
  }) => void;
  hoveredKm: number | null;
  visibleKmRange: [number, number] | null;

  setActiveTab: (tab: string) => void;
  setDateOffset: (offset: number) => void;
  setTableStep: (step: number) => void;
  setTableColumns: (cols: number) => void;
  setHoveredKm: (km: number | null) => void;
  setVisibleKmRange: (range: [number, number] | null) => void;
  reset: () => void;
}

const initialState = {
  segments: [] as RouteSegment[],
  markers: [] as MarkerData[],
  elevation: null as ElevationProfile | null,
  elevationError: null as string | null,
  elevationComplete: true,
  weather: [] as WeatherStop[],
  route: [] as RouteStop[],
  startDay: 1,
  totalDistance: 0,
  totalDays: 0,
  forecast: null as ForecastData | null,
  forecastError: null as string | null,
  desiredHigh: 25,
  desiredLow: 15,
  activeTab: "map",
  dateOffset: 0,
  tableStep: 7,
  tableColumns: 7,
  hoveredKm: null as number | null,
  visibleKmRange: null as [number, number] | null,
};

export const useResultsStore = create<ResultsState>()((set) => ({
  ...initialState,

  setResults: (data) => set({ ...data, activeTab: data.forecast ? "forecast" : "map" }),

  updateElevation: (data) => set(data),

  setActiveTab: (activeTab) => set({ activeTab }),
  setDateOffset: (dateOffset) => set({ dateOffset }),
  setTableStep: (tableStep) => set({ tableStep }),
  setTableColumns: (tableColumns) => set({ tableColumns }),
  setHoveredKm: (hoveredKm) => set({ hoveredKm }),
  setVisibleKmRange: (visibleKmRange) => set({ visibleKmRange }),

  reset: () => set(initialState),
}));
