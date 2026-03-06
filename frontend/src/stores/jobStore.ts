import { create } from "zustand";
import type { JobStatus, RoughMapData } from "@/api/types";

interface JobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  message: string;
  jobType: string;
  osrmDone: number;
  osrmTotal: number;
  roughMap: RoughMapData | null;
  error: string | null;
  elevationBatchDone: number;
  elevationBatchTotal: number;
  forecastDone: number;
  forecastTotal: number;

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
  osrmDone: 0,
  osrmTotal: 0,
  roughMap: null as RoughMapData | null,
  error: null as string | null,
  elevationBatchDone: 0,
  elevationBatchTotal: 0,
  forecastDone: 0,
  forecastTotal: 0,
};

export const useJobStore = create<JobState>()((set) => ({
  ...initialState,

  setJobId: (jobId) => set({ ...initialState, jobId }),

  updateStatus: (update) => set(update),

  reset: () => set(initialState),
}));
