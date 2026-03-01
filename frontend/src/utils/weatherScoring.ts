export function getWeatherScore(
  tmin: number,
  tmax: number,
  prcp: number,
  wspd: number,
  desiredNight: number,
  desiredDay: number
): number {
  const nightDev = Math.abs(tmin - desiredNight);
  const dayDev = Math.abs(tmax - desiredDay);
  const tempScore = (nightDev + dayDev) / 2;

  const prcpScore = Math.min(prcp / 10, 1) * 10;
  const windScore = Math.min(wspd / 40, 1) * 10;

  return 0.6 * tempScore + 0.2 * prcpScore + 0.2 * windScore;
}

export function scoreToColor(score: number): string {
  if (score <= 3) return "hsl(var(--good))";
  if (score <= 7) return "hsl(var(--warn))";
  return "hsl(var(--bad))";
}

export type ScoreVariant = "good" | "warn" | "bad";

export function scoreToVariant(score: number): ScoreVariant {
  if (score <= 3) return "good";
  if (score <= 7) return "warn";
  return "bad";
}
