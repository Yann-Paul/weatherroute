import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CityEntry, Connection, PlannerSettings } from "@/api/types";

interface PlannerState {
  mode: "route" | "destination";
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
  directOsrm: boolean;
  routingMode: string;
  brouterProfile: string;
  destinationAlgorithm: string;

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
  setDistanceWeight: (value: number) => void;
  setTempWeight: (value: number) => void;
  setWindWeight: (value: number) => void;
  setRainWeight: (value: number) => void;
  setMaxDailyKm: (value: number) => void;
  setMaxTravelDays: (value: number) => void;
  setElevResolution: (value: number) => void;
  toggleBlockedCountry: (code: string) => void;
  setBlockedCountries: (codes: string[]) => void;
  setSortedInput: (value: boolean) => void;
  setDirectOsrm: (value: boolean) => void;
  setRoutingMode: (value: string) => void;
  setBrouterProfile: (value: string) => void;
  setDestinationAlgorithm: (value: string) => void;
  setMode: (mode: "route" | "destination") => void;
  loadFromResults: (data: { startDay: number }) => void;
  restoreSettings: (settings: PlannerSettings) => void;
  reset: () => void;
}

const initialState = {
  mode: "route" as "route" | "destination",
  cities: [] as CityEntry[],
  startCity: "",
  startDay: null as number | null,
  autoDetectStart: false,
  connections: [] as Connection[],
  desiredDayTemp: 22,
  desiredNightTemp: 12,
  dayTempMin: -20,
  dayTempMax: 50,
  nightTempMin: -30,
  nightTempMax: 40,
  warmingFactor: 0.6,
  distanceWeight: 0.5,
  tempWeight: 1.0,
  windWeight: 0.0,
  rainWeight: 0.0,
  maxDailyKm: 80,
  maxTravelDays: 365,
  elevResolution: 1000,
  blockedCountries: [] as string[],
  sortedInput: false,
  directOsrm: false,
  routingMode: "car",
  brouterProfile: "trekking",
  destinationAlgorithm: "beam_search",
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
      setDistanceWeight: (distanceWeight) => set({ distanceWeight }),
      setTempWeight: (tempWeight) => set({ tempWeight }),
      setWindWeight: (windWeight) => set({ windWeight }),
      setRainWeight: (rainWeight) => set({ rainWeight }),
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
      setDirectOsrm: (directOsrm) => set({ directOsrm }),
      setRoutingMode: (routingMode) => set({ routingMode }),
      setBrouterProfile: (brouterProfile) => set({ brouterProfile }),
      setDestinationAlgorithm: (destinationAlgorithm) => set({ destinationAlgorithm }),
      setMode: (mode) => set({ mode }),

      // Restores only the computed start day — all other settings (cities, temps, etc.)
      // remain as the user originally configured them in the planner.
      loadFromResults: ({ startDay }) =>
        set({
          startDay,
          autoDetectStart: false,
        }),

      // Restores all planner settings from a saved route snapshot.
      restoreSettings: (s) =>
        set({
          cities: s.cities,
          startCity: s.startCity,
          startDay: s.startDay,
          autoDetectStart: s.autoDetectStart,
          connections: s.connections,
          desiredDayTemp: s.desiredDayTemp,
          desiredNightTemp: s.desiredNightTemp,
          dayTempMin: s.dayTempMin,
          dayTempMax: s.dayTempMax,
          nightTempMin: s.nightTempMin,
          nightTempMax: s.nightTempMax,
          warmingFactor: s.warmingFactor,
          distanceWeight: s.distanceWeight ?? 0.5,
          tempWeight: s.tempWeight,
          windWeight: s.windWeight ?? 0,
          rainWeight: s.rainWeight ?? 0,
          maxDailyKm: s.maxDailyKm,
          maxTravelDays: s.maxTravelDays,
          elevResolution: s.elevResolution,
          blockedCountries: s.blockedCountries,
          sortedInput: s.sortedInput,
          directOsrm: s.directOsrm ?? false,
          routingMode: s.routingMode ?? "car",
          brouterProfile: s.brouterProfile ?? "trekking",
        }),

      reset: () => set(initialState),
    }),
    {
      name: "weatherroute-planner",
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
