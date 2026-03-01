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
  weather: WeatherStop[];
  route: RouteStop[];
  startDay: number;
  totalDistance: number;
  totalDays: number;
  forecast: ForecastData | null;
  desiredHigh: number;
  desiredLow: number;

  activeTab: string;
  dateOffset: number;
  tableStep: number;
  tableColumns: number;

  setResults: (data: {
    segments: RouteSegment[];
    markers: MarkerData[];
    elevation: ElevationProfile;
    weather: WeatherStop[];
    route: RouteStop[];
    startDay: number;
    totalDistance: number;
    totalDays: number;
    forecast: ForecastData | null;
    desiredHigh: number;
    desiredLow: number;
  }) => void;
  setActiveTab: (tab: string) => void;
  setDateOffset: (offset: number) => void;
  setTableStep: (step: number) => void;
  setTableColumns: (cols: number) => void;
  reset: () => void;
}

const initialState = {
  segments: [] as RouteSegment[],
  markers: [] as MarkerData[],
  elevation: null as ElevationProfile | null,
  weather: [] as WeatherStop[],
  route: [] as RouteStop[],
  startDay: 1,
  totalDistance: 0,
  totalDays: 0,
  forecast: null as ForecastData | null,
  desiredHigh: 25,
  desiredLow: 15,
  activeTab: "map",
  dateOffset: 0,
  tableStep: 7,
  tableColumns: 7,
};

export const useResultsStore = create<ResultsState>()((set) => ({
  ...initialState,

  setResults: (data) => set({ ...data, activeTab: "map" }),

  setActiveTab: (activeTab) => set({ activeTab }),
  setDateOffset: (dateOffset) => set({ dateOffset }),
  setTableStep: (tableStep) => set({ tableStep }),
  setTableColumns: (tableColumns) => set({ tableColumns }),

  reset: () => set(initialState),
}));
