import type { RoutePlannerPoint } from "@/api/types";

export interface RouteSegment {
  index: number;
  startKm: number;
  endKm: number;
  coords: RoutePlannerPoint[];
}

function haversineKm(a: RoutePlannerPoint, b: RoutePlannerPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Cumulative distance (km) at each point of the track, starting at 0. */
export function cumulativeKm(coords: RoutePlannerPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return cum;
}

/** Cut points every stepKm, e.g. totalKm=125, stepKm=50 -> [50, 100]. */
export function boundariesForDistance(totalKm: number, stepKm: number): number[] {
  if (stepKm <= 0 || totalKm <= 0) return [];
  const boundaries: number[] = [];
  for (let km = stepKm; km < totalKm - 0.05; km += stepKm) {
    boundaries.push(+km.toFixed(2));
  }
  return boundaries;
}

/** Cut points at the end of each day except the last (whose end is the route end). */
export function boundariesForDays(dailyKm: number[]): number[] {
  const boundaries: number[] = [];
  let cum = 0;
  for (let i = 0; i < dailyKm.length - 1; i++) {
    cum += dailyKm[i];
    boundaries.push(+cum.toFixed(2));
  }
  return boundaries;
}

/**
 * Splits a track at the given cumulative-km boundaries. Each boundary point
 * is included in both the segment that ends there and the one that starts
 * there, so every segment is a standalone, contiguous, rideable track.
 */
export function buildSegments(coords: RoutePlannerPoint[], boundaries: number[]): RouteSegment[] {
  if (coords.length < 2 || boundaries.length === 0) return [];
  const cum = cumulativeKm(coords);
  const totalKm = cum[cum.length - 1];
  const sortedBoundaries = [...new Set(boundaries.map((b) => +b.toFixed(3)))]
    .filter((b) => b > 1e-6 && b < totalKm - 1e-6)
    .sort((a, b) => a - b);
  if (sortedBoundaries.length === 0) return [];

  interface Node {
    km: number;
    point: RoutePlannerPoint;
    isBoundary: boolean;
  }

  const nodes: Node[] = coords.map((p, i) => ({ km: cum[i], point: p, isBoundary: false }));

  for (const targetKm of sortedBoundaries) {
    let i = 1;
    while (i < cum.length && cum[i] < targetKm) i++;
    const prevKm = cum[i - 1];
    const nextKm = cum[i];
    const frac = nextKm > prevKm ? (targetKm - prevKm) / (nextKm - prevKm) : 0;
    nodes.push({
      km: targetKm,
      point: {
        lat: coords[i - 1].lat + (coords[i].lat - coords[i - 1].lat) * frac,
        lon: coords[i - 1].lon + (coords[i].lon - coords[i - 1].lon) * frac,
      },
      isBoundary: true,
    });
  }

  nodes.sort((a, b) => a.km - b.km);

  // Merge nodes that land on (almost) the same km — e.g. a boundary that
  // happens to coincide with an existing track point.
  const merged: Node[] = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.km - n.km) < 1e-6) {
      last.isBoundary = last.isBoundary || n.isBoundary;
      continue;
    }
    merged.push(n);
  }

  const segments: RouteSegment[] = [];
  let current: RoutePlannerPoint[] = [];
  let startKm = 0;
  for (const n of merged) {
    current.push(n.point);
    if (n.isBoundary) {
      segments.push({
        index: segments.length,
        startKm: +startKm.toFixed(2),
        endKm: +n.km.toFixed(2),
        coords: current,
      });
      current = [n.point];
      startKm = n.km;
    }
  }
  segments.push({
    index: segments.length,
    startKm: +startKm.toFixed(2),
    endKm: +totalKm.toFixed(2),
    coords: current,
  });

  return segments.filter((s) => s.coords.length >= 2);
}
