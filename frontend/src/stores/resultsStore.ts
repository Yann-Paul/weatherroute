import { create } from "zustand";
import type {
  RouteSegment,
  MarkerData,
  ElevationProfile,
  WeatherDay,
  RouteStop,
} from "@/api/types";

interface ResultsState {
  segments: RouteSegment[];
  markers: MarkerData[];
  elevation: ElevationProfile | null;
  weather: WeatherDay[];
  route: RouteStop[];
  startDay: number;
  totalDistance: number;
  totalDays: number;

  activeTab: string;
  dateOffset: number;
  tableStep: number;
  tableColumns: number;

  setResults: (data: {
    segments: RouteSegment[];
    markers: MarkerData[];
    elevation: ElevationProfile;
    weather: WeatherDay[];
    route: RouteStop[];
    startDay: number;
    totalDistance: number;
    totalDays: number;
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
  weather: [] as WeatherDay[],
  route: [] as RouteStop[],
  startDay: 1,
  totalDistance: 0,
  totalDays: 0,
  activeTab: "map",
  dateOffset: 0,
  tableStep: 1,
  tableColumns: 7,
};

export const useResultsStore = create<ResultsState>()((set) => ({
  ...initialState,

  setResults: (data) => set({ ...data }),

  setActiveTab: (activeTab) => set({ activeTab }),
  setDateOffset: (dateOffset) => set({ dateOffset }),
  setTableStep: (tableStep) => set({ tableStep }),
  setTableColumns: (tableColumns) => set({ tableColumns }),

  reset: () => set(initialState),
}));
