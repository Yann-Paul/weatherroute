import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CityEntry, Connection } from "@/api/types";

interface PlannerState {
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

  addCity: (city: CityEntry) => void;
  removeCity: (index: number) => void;
  updateCity: (index: number, city: Partial<CityEntry>) => void;
  reorderCities: (from: number, to: number) => void;
  setStartCity: (city: string) => void;
  setStartDay: (day: number | null) => void;
  setAutoDetectStart: (auto: boolean) => void;
  addConnection: (conn: Connection) => void;
  removeConnection: (index: number) => void;
  setTemp: (field: string, value: number) => void;
  setWarmingFactor: (value: number) => void;
  setTempWeight: (value: number) => void;
  setMaxDailyKm: (value: number) => void;
  setMaxTravelDays: (value: number) => void;
  setElevResolution: (value: number) => void;
  toggleBlockedCountry: (code: string) => void;
  setBlockedCountries: (codes: string[]) => void;
  setSortedInput: (value: boolean) => void;
  reset: () => void;
}

const DEFAULT_BLOCKED = [
  "RU", "UA", "BY", "MD", "TR", "GE", "AM", "AZ", "SY", "IQ", "IR",
];

const initialState = {
  cities: [] as CityEntry[],
  startCity: "",
  startDay: null as number | null,
  autoDetectStart: true,
  connections: [] as Connection[],
  desiredDayTemp: 25,
  desiredNightTemp: 15,
  dayTempMin: 10,
  dayTempMax: 40,
  nightTempMin: 0,
  nightTempMax: 30,
  warmingFactor: 1.5,
  tempWeight: 0.5,
  maxDailyKm: 120,
  maxTravelDays: 365,
  elevResolution: 1000,
  blockedCountries: [...DEFAULT_BLOCKED],
  sortedInput: false,
};

export const usePlannerStore = create<PlannerState>()(
  persist(
    (set) => ({
      ...initialState,

      addCity: (city) =>
        set((s) => ({ cities: [...s.cities, city] })),

      removeCity: (index) =>
        set((s) => ({ cities: s.cities.filter((_, i) => i !== index) })),

      updateCity: (index, partial) =>
        set((s) => ({
          cities: s.cities.map((c, i) => (i === index ? { ...c, ...partial } : c)),
        })),

      reorderCities: (from, to) =>
        set((s) => {
          const cities = [...s.cities];
          const [moved] = cities.splice(from, 1);
          cities.splice(to, 0, moved);
          return { cities };
        }),

      setStartCity: (startCity) => set({ startCity }),
      setStartDay: (startDay) => set({ startDay }),
      setAutoDetectStart: (autoDetectStart) => set({ autoDetectStart }),

      addConnection: (conn) =>
        set((s) => ({ connections: [...s.connections, conn] })),

      removeConnection: (index) =>
        set((s) => ({
          connections: s.connections.filter((_, i) => i !== index),
        })),

      setTemp: (field, value) => set({ [field]: value }),
      setWarmingFactor: (warmingFactor) => set({ warmingFactor }),
      setTempWeight: (tempWeight) => set({ tempWeight }),
      setMaxDailyKm: (maxDailyKm) => set({ maxDailyKm }),
      setMaxTravelDays: (maxTravelDays) => set({ maxTravelDays }),
      setElevResolution: (elevResolution) => set({ elevResolution }),

      toggleBlockedCountry: (code) =>
        set((s) => ({
          blockedCountries: s.blockedCountries.includes(code)
            ? s.blockedCountries.filter((c) => c !== code)
            : [...s.blockedCountries, code],
        })),

      setBlockedCountries: (blockedCountries) => set({ blockedCountries }),
      setSortedInput: (sortedInput) => set({ sortedInput }),

      reset: () => set(initialState),
    }),
    {
      name: "weatherroute-planner",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
