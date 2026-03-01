const STOPS: [number, [number, number, number]][] = [
  [-1.0, [60, 0, 80]],
  [-0.667, [30, 30, 160]],
  [-0.333, [100, 160, 255]],
  [0.0, [255, 255, 255]],
  [0.333, [255, 150, 100]],
  [0.667, [200, 40, 40]],
  [1.0, [160, 0, 120]],
];

export function tempToRgb(temp: number, desired: number): string {
  const t = Math.max(-1, Math.min(1, (temp - desired) / 15));
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (t <= STOPS[i + 1][0]) {
      const f = (t - STOPS[i][0]) / (STOPS[i + 1][0] - STOPS[i][0]);
      const [r0, g0, b0] = STOPS[i][1];
      const [r1, g1, b1] = STOPS[i + 1][1];
      return `rgb(${Math.round(r0 + f * (r1 - r0))},${Math.round(g0 + f * (g1 - g0))},${Math.round(b0 + f * (b1 - b0))})`;
    }
  }
  return "rgb(160,0,120)";
}

const MONTHS_DE = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Short date string: "5. Mai" (de) or "May 5" (en) */
export function dayToShortDE(dayOfYear: number, lang: "de" | "en" = "de"): string {
  let d = ((dayOfYear - 1 + 3650) % 365) + 1;
  let m = 0;
  while (m < 11 && d > DAYS_IN_MONTH[m]) {
    d -= DAYS_IN_MONTH[m];
    m++;
  }
  return lang === "de" ? `${d}. ${MONTHS_DE[m]}` : `${MONTHS_EN[m]} ${d}`;
}
