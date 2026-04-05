import { create } from "zustand";
import type { JobStatus, RoughMapData, ErrorCitiesData } from "@/api/types";

interface JobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  message: string;
  jobType: string;
  algorithm: string;
  osrmDone: number;
  osrmTotal: number;
  roughMap: RoughMapData | null;
  error: string | null;
  errorCities: ErrorCitiesData | null;
  elevationBatchDone: number;
  elevationBatchTotal: number;
  forecastDone: number;
  forecastTotal: number;
  registeringDone: number;
  registeringTotal: number;
  warnings: string[];

  setJobId: (id: string) => void;
  updateStatus: (update: Partial<JobState>) => void;
  reset: () => void;
}

const initialState = {
  jobId: null as string | null,
  status: "pending" as JobStatus,
  step: "",
  message: "",
  jobType: "route",
  algorithm: "beam_search",
  osrmDone: 0,
  osrmTotal: 0,
  roughMap: null as RoughMapData | null,
  error: null as string | null,
  errorCities: null as ErrorCitiesData | null,
  elevationBatchDone: 0,
  elevationBatchTotal: 0,
  forecastDone: 0,
  forecastTotal: 0,
  registeringDone: 0,
  registeringTotal: 0,
  warnings: [] as string[],
};

export const useJobStore = create<JobState>()((set) => ({
  ...initialState,

  setJobId: (jobId) => set({ ...initialState, jobId }),

  updateStatus: (update) => set(update),

  reset: () => set(initialState),
}));
