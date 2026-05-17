export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const PRESET_BLOCKED_COUNTRIES = [
  { code: "RU", name: "Russia" },
  { code: "UA", name: "Ukraine" },
  { code: "BY", name: "Belarus" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "SY", name: "Syria" },
  { code: "IQ", name: "Iraq" },
  { code: "IR", name: "Iran" },
  { code: "LB", name: "Lebanon" },
  { code: "YE", name: "Yemen" },
  { code: "AF", name: "Afghanistan" },
  { code: "LY", name: "Libya" },
  { code: "SD", name: "Sudan" },
  { code: "MM", name: "Myanmar" },
];

export const WIND_DIRECTIONS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function windDegreesToDirection(deg: number): string {
  const index = Math.round(deg / 22.5) % 16;
  return WIND_DIRECTIONS[index];
}

export function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Returns a label for the wind relative to travel direction.
 *  angle = angle between wind-blows-to direction and travel bearing (0=tailwind) */
export function relativeWindLabel(wdir: number, bearing: number): string {
  const diff = ((wdir + 180 - bearing) % 360 + 360) % 360; // angle of wind source relative to travel
  // diff=0: wind from behind (tailwind), diff=180: wind from front (headwind)
  if (diff <= 30 || diff >= 330) return "↑ Rückenwind";
  if (diff <= 60 || diff >= 300) return "↗ Schräg hinten";
  if (diff <= 120 || diff >= 240) return "→ Seitenwind";
  if (diff <= 150 || diff >= 210) return "↘ Schräg vorne";
  return "↓ Gegenwind";
}

export function dayOfYearToDate(dayOfYear: number, year = 2025, locale = "en-US"): string {
  const date = new Date(year, 0);
  date.setDate(dayOfYear);
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function monthDayToDayOfYear(month: number, day: number): number {
  const date = Date.UTC(2025, month - 1, day);
  const start = Date.UTC(2025, 0, 1);
  return Math.floor((date - start) / 86400000) + 1;
}
