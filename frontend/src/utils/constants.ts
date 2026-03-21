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

export function dayOfYearToDate(dayOfYear: number, year = 2025, locale = "en-US"): string {
  const date = new Date(year, 0);
  date.setDate(dayOfYear);
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function monthDayToDayOfYear(month: number, day: number): number {
  const date = new Date(2025, month - 1, day);
  const start = new Date(2025, 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}
