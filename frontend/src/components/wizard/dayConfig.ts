// Day-planning data model shared between the GPX wizard and the route-planner
// wizard: both let the user derive one of speed / daily-km / riding-hours from
// the other two, and build a per-day schedule from a total route distance.
// Split out of RoutePlanningSteps.tsx so that file only exports components
// (required for Fast Refresh / react-refresh).

export type Param = "speed" | "dailyKm" | "ridingHours";

export interface DayConfig {
  startTime: string;
  speed: number;
  dailyKm: number;
  ridingHours: number;
  editHistory: [Param, Param];
}

export const DEFAULT_DAY_CONFIG: DayConfig = {
  startTime: "09:00",
  speed: 15,
  dailyKm: 90,
  ridingHours: 6,
  editHistory: ["speed", "dailyKm"],
};

export function derivedParam(history: [Param, Param]): Param {
  return (["speed", "dailyKm", "ridingHours"] as Param[]).find(
    (p) => p !== history[0] && p !== history[1]
  )!;
}

export function recalcDerived(c: DayConfig): DayConfig {
  const d = derivedParam(c.editHistory);
  const out = { ...c };
  if (d === "ridingHours") out.ridingHours = c.speed > 0 ? +(c.dailyKm / c.speed).toFixed(2) : 0;
  else if (d === "dailyKm") out.dailyKm = +(c.speed * c.ridingHours).toFixed(1);
  else out.speed = c.ridingHours > 0 ? +(c.dailyKm / c.ridingHours).toFixed(1) : 0;
  return out;
}

export function editParam(config: DayConfig, param: Param, value: number): DayConfig {
  const newHistory: [Param, Param] =
    config.editHistory[1] === param ? config.editHistory : [config.editHistory[1], param];
  return recalcDerived({ ...config, [param]: value, editHistory: newHistory });
}

export function isParamDerived(config: DayConfig, param: Param) {
  return derivedParam(config.editHistory) === param;
}

export function paramDisplay(cfg: DayConfig, param: Param): number {
  if (param === "ridingHours") return +cfg.ridingHours.toFixed(2);
  if (param === "dailyKm") return +cfg.dailyKm.toFixed(1);
  return +cfg.speed.toFixed(1);
}

export function buildDayConfigs(n: number, global: DayConfig, totalKm: number): DayConfig[] {
  return Array.from({ length: n }, (_, i) => {
    if (i < n - 1) return { ...global };
    const rest = Math.max(0.1, totalKm - global.dailyKm * (n - 1));
    return recalcDerived({ ...global, dailyKm: +rest.toFixed(1) });
  });
}

export function numDaysFor(totalKm: number, dailyKm: number) {
  return dailyKm > 0 ? Math.max(1, Math.ceil(totalKm / dailyKm)) : 1;
}
