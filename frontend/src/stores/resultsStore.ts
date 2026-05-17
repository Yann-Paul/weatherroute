import { create } from "zustand";
import type {
  RouteSegment,
  MarkerData,
  ElevationProfile,
  WeatherStop,
  RouteStop,
  ForecastData,
  ForecastPointData,
} from "@/api/types";
import { getModelForecast } from "@/api/client";

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

  // Model switching
  jobId: string | null;
  selectedModel: string;
  modelDataCache: Record<string, Record<string, ForecastPointData>>;
  modelLoading: boolean;
  pendingModel: string | null;
  modelError: string | null;

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
  hoveredModelKmRange: [number, number] | null;

  setActiveTab: (tab: string) => void;
  setDateOffset: (offset: number) => void;
  setTableStep: (step: number) => void;
  setTableColumns: (cols: number) => void;
  setHoveredKm: (km: number | null) => void;
  setVisibleKmRange: (range: [number, number] | null) => void;
  setHoveredModelKmRange: (range: [number, number] | null) => void;
  setJobId: (jobId: string) => void;
  selectModel: (model: string) => Promise<void>;
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
  hoveredModelKmRange: null as [number, number] | null,
  jobId: null as string | null,
  selectedModel: "best_match",
  modelDataCache: {} as Record<string, Record<string, ForecastPointData>>,
  modelLoading: false,
  pendingModel: null as string | null,
  modelError: null as string | null,
};

export const useResultsStore = create<ResultsState>()((set, get) => ({
  ...initialState,

  setResults: (data) => set({
    ...data,
    activeTab: "map",
    selectedModel: "best_match",
    modelDataCache: data.forecast ? { "best_match": data.forecast.data } : {},
    modelLoading: false,
    pendingModel: null,
    modelError: null,
  }),

  updateElevation: (data) => set(data),

  setActiveTab: (activeTab) => set({ activeTab }),
  setDateOffset: (dateOffset) => set({ dateOffset }),
  setTableStep: (tableStep) => set({ tableStep }),
  setTableColumns: (tableColumns) => set({ tableColumns }),
  setHoveredKm: (hoveredKm) => set({ hoveredKm }),
  setVisibleKmRange: (visibleKmRange) => set({ visibleKmRange }),
  setHoveredModelKmRange: (hoveredModelKmRange) => set({ hoveredModelKmRange }),
  setJobId: (jobId) => set({ jobId }),

  selectModel: async (model) => {
    const { jobId, selectedModel, modelDataCache, forecast, modelLoading } = get();
    if (modelLoading || selectedModel === model || !jobId) return;

    if (modelDataCache[model]) {
      set({
        selectedModel: model,
        forecast: forecast ? { ...forecast, data: modelDataCache[model] } : null,
      });
      return;
    }

    set({ modelLoading: true, pendingModel: model, modelError: null });
    try {
      const result = await getModelForecast(jobId, model);
      set((state) => ({
        selectedModel: model,
        modelLoading: false,
        pendingModel: null,
        modelDataCache: { ...state.modelDataCache, [model]: result.data },
        forecast: state.forecast ? { ...state.forecast, data: result.data } : null,
      }));
    } catch (e) {
      set({ modelLoading: false, pendingModel: null, modelError: String(e) });
    }
  },

  reset: () => set(initialState),
}));
