import { create } from "zustand";
import type { JobStatus, RoughMapData } from "@/api/types";

interface JobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  message: string;
  osrmDone: number;
  osrmTotal: number;
  roughMap: RoughMapData | null;
  error: string | null;

  setJobId: (id: string) => void;
  updateStatus: (update: Partial<JobState>) => void;
  reset: () => void;
}

const initialState = {
  jobId: null as string | null,
  status: "pending" as JobStatus,
  step: "",
  message: "",
  osrmDone: 0,
  osrmTotal: 0,
  roughMap: null as RoughMapData | null,
  error: null as string | null,
};

export const useJobStore = create<JobState>()((set) => ({
  ...initialState,

  setJobId: (jobId) => set({ ...initialState, jobId }),

  updateStatus: (update) => set(update),

  reset: () => set(initialState),
}));
