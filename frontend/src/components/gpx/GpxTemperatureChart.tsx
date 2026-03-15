import { useCallback, useEffect, useRef } from "react";
import type { ElevationProfile, GpxWeatherPoint, GpxDayConfig, GpxNightHour } from "@/api/types";
import { useT } from "@/i18n/useT";
import { Moon } from "lucide-react";
import { useIsDark } from "@/stores/themeStore";
import { tempToRgb, tempMidColor } from "@/utils/tempColor";

function gpxArrivalTime(km: number, dailyConfigs: GpxDayConfig[], startDate: string): Date {
  const base = new Date(startDate + "T00:00:00");
  let cum = 0;
  for (let di = 0; di < dailyConfigs.length; di++) {
    const cfg = dailyConfigs[di];
    const dayKm = Math.max(0.01, cfg.dailyKm);
    const speed = Math.max(0.01, cfg.speed);
    const [h, m] = cfg.startTime.split(":").map(Number);
    const dayStart = new Date(base);
    dayStart.setDate(dayStart.getDate() + di);
    dayStart.setHours(h, m, 0, 0);
    const isLast = di === dailyConfigs.length - 1;
    if (isLast || cum + dayKm >= km - 0.001) {
      return new Date(dayStart.getTime() + (Math.max(0, km - cum) / speed) * 3600e3);
    }
    cum += dayKm;
  }
  return base;
}

function getCssColors() {
  const cs = getComputedStyle(document.documentElement);
  const hsl = (v: string) => `hsl(${cs.getPropertyValue(v).trim()})`;
  return {
    grid: hsl("--border"),
    muted: hsl("--muted-foreground"),
    axis: hsl("--chart-line"),
    cursor: hsl("--chart-cursor"),
    fg: hsl("--foreground"),
    card: hsl("--card"),
  };
}

function markerColor(type: GpxWeatherPoint["type"]): string {
  if (type === "stop") return "#7c3aed";
  if (type === "pass") return "#f97316";
  if (type === "valley") return "#3b82f6";
  if (type === "start") return "#22c55e";
  if (type === "end") return "#6b7280";
  return "#9ca3af";
}

/** Linear interpolation of temperature from a sorted {ms, temp}[] array at a given timestamp. */
function interpNightMs(ms: number, pts: { ms: number; temp: number }[]): number {
  if (pts.length === 0) return NaN;
  if (ms <= pts[0].ms) return pts[0].temp;
  if (ms >= pts[pts.length - 1].ms) return pts[pts.length - 1].temp;
  const i = pts.findIndex((p) => p.ms >= ms);
  if (i <= 0) return pts[0].temp;
  const p0 = pts[i - 1], p1 = pts[i];
  const t = p1.ms > p0.ms ? (ms - p0.ms) / (p1.ms - p0.ms) : 0;
  return p0.temp + t * (p1.temp - p0.temp);
}

// Linear temperature interpolation from sparse weather points
function interpTempAtKm(
  km: number,
  sortedWPs: { km: number; temp: number }[]
): number | null {
  if (sortedWPs.length === 0) return null;
  if (km <= sortedWPs[0].km) return sortedWPs[0].temp;
  if (km >= sortedWPs[sortedWPs.length - 1].km) return sortedWPs[sortedWPs.length - 1].temp;
  let i = sortedWPs.findIndex((p) => p.km >= km);
  if (i <= 0) i = 1;
  const p0 = sortedWPs[i - 1], p1 = sortedWPs[i];
  const t = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
  return p0.temp + t * (p1.temp - p0.temp);
}

// ─── DayTempChart ─────────────────────────────────────────────────────────────

function DayTempChart({
  points,
  startKm,
  endKm,
  weatherPoints,
  desiredTemp,
  height = 180,
  isDark,
  dailyConfigs,
  startDate,
}: {
  points: [number, number][];
  startKm: number;
  endKm: number;
  weatherPoints: GpxWeatherPoint[];
  desiredTemp: number;
  height?: number;
  isDark?: boolean;
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hovRef = useRef<{ x: number; label: string } | null>(null);

  // Sorted weather points with valid temperature in this segment
  const sortedWPs = weatherPoints
    .filter((wp) => wp.temp != null && wp.km >= startKm - 0.1 && wp.km <= endKm + 0.1)
    .sort((a, b) => a.km - b.km) as { km: number; temp: number; type: GpxWeatherPoint["type"] }[];

  const drawChart = useCallback(() => {
    const clr = getCssColors();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const PAD = { top: 20, right: 16, bottom: 36, left: 52 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    if (sortedWPs.length < 2 || cw <= 0 || ch <= 0) {
      ctx.fillStyle = clr.muted;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Keine Temperaturdaten", W / 2, H / 2);
      return;
    }

    const kmRange = endKm - startKm || 1;

    // Sample elevation points for temperature line
    const stride = Math.max(1, Math.floor(points.length / 400));
    const sampledPts = points.filter((_, i) => i % stride === 0 || i === points.length - 1);

    // Compute temperature at each sampled point
    const tempPts: { km: number; temp: number }[] = sampledPts
      .map(([km]) => {
        const t = interpTempAtKm(km, sortedWPs);
        return t != null ? { km, temp: t } : null;
      })
      .filter((p): p is { km: number; temp: number } => p != null);

    if (tempPts.length < 2) {
      ctx.fillStyle = clr.muted;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Keine Temperaturdaten", W / 2, H / 2);
      return;
    }

    const temps = tempPts.map((p) => p.temp);
    const minT = Math.floor(Math.min(...temps)) - 2;
    const maxT = Math.ceil(Math.max(...temps)) + 2;
    const tRange = maxT - minT || 1;

    const toX = (km: number) => PAD.left + ((km - startKm) / kmRange) * cw;
    const toY = (temp: number) => PAD.top + ch - ((temp - minT) / tRange) * ch;
    const axY = PAD.top + ch;

    // Axes
    ctx.strokeStyle = clr.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, axY);
    ctx.lineTo(PAD.left + cw, axY);
    ctx.stroke();

    // Y-axis grid lines
    const tempTick = tRange <= 6 ? 1 : tRange <= 15 ? 2 : tRange <= 30 ? 5 : 10;
    ctx.fillStyle = clr.muted;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    for (let tv = Math.ceil(minT / tempTick) * tempTick; tv <= maxT; tv += tempTick) {
      const y = toY(tv);
      ctx.fillText(`${tv}°`, PAD.left - 4, y + 4);
      ctx.beginPath();
      ctx.strokeStyle = clr.grid;
      ctx.lineWidth = 0.7;
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cw, y);
      ctx.stroke();
    }

    // 0°C reference line
    if (minT < 0 && maxT > 0) {
      const y0 = toY(0);
      ctx.save();
      ctx.strokeStyle = clr.axis;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y0);
      ctx.lineTo(PAD.left + cw, y0);
      ctx.stroke();
      ctx.restore();
    }

    // Colored line segments
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    for (let i = 0; i < tempPts.length - 1; i++) {
      const p0 = tempPts[i], p1 = tempPts[i + 1];
      const midTemp = (p0.temp + p1.temp) / 2;
      ctx.beginPath();
      ctx.strokeStyle = tempToRgb(midTemp, desiredTemp, isDark);
      ctx.moveTo(toX(p0.km), toY(p0.temp));
      ctx.lineTo(toX(p1.km), toY(p1.temp));
      ctx.stroke();
    }

    // Weather point markers (vertical lines at km position)
    for (const wp of weatherPoints) {
      if (wp.km < startKm - 0.1 || wp.km > endKm + 0.1) continue;
      const x = toX(wp.km);
      const color = markerColor(wp.type);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = wp.type === "stop" ? 2 : 1.5;
      ctx.setLineDash(wp.type === "stop" ? [5, 3] : [3, 3]);
      ctx.globalAlpha = wp.type === "stop" ? 0.85 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, axY);
      ctx.stroke();
      ctx.restore();

      if (wp.type !== "regular") {
        const tempVal = wp.temp != null ? `${Math.round(wp.temp)}°` : "";
        ctx.fillStyle = color;
        ctx.font = wp.type === "stop" ? "bold 9px sans-serif" : "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(tempVal || (wp.type === "stop" ? `N${wp.dayNumber ?? ""}` : ""), x, PAD.top - 4);
      }
    }

    // X-axis ticks
    ctx.textAlign = "center";
    ctx.fillStyle = clr.muted;
    ctx.font = "11px sans-serif";
    ctx.strokeStyle = clr.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (dailyConfigs && startDate) {
      // Time-based x-axis
      const tStart = gpxArrivalTime(startKm, dailyConfigs, startDate).getTime();
      const tEnd = gpxArrivalTime(endKm, dailyConfigs, startDate).getTime();
      const msRange = tEnd - tStart || 1;
      const totalHours = msRange / 3600e3;
      const tickHours = totalHours <= 6 ? 1 : totalHours <= 12 ? 2 : 3;
      const t0Date = new Date(tStart);
      const firstTickH = Math.ceil((t0Date.getHours() + t0Date.getMinutes() / 60) / tickHours) * tickHours;
      let tickMs = new Date(tStart);
      tickMs.setHours(Math.floor(firstTickH), Math.round((firstTickH % 1) * 60), 0, 0);
      while (tickMs.getTime() <= tEnd + 60e3) {
        const kmPos = startKm + ((tickMs.getTime() - tStart) / msRange) * kmRange;
        const x = toX(kmPos);
        const hhmm = `${String(tickMs.getHours()).padStart(2, "0")}:${String(tickMs.getMinutes()).padStart(2, "0")}`;
        ctx.fillText(hhmm, x, axY + 18);
        ctx.beginPath();
        ctx.moveTo(x, axY);
        ctx.lineTo(x, axY + 4);
        ctx.stroke();
        tickMs = new Date(tickMs.getTime() + tickHours * 3600e3);
      }
    } else {
      const xStep = Math.max(1, Math.ceil(kmRange / 5 / 5) * 5);
      for (let km = Math.ceil(startKm / xStep) * xStep; km <= endKm; km += xStep) {
        const x = toX(km);
        ctx.fillText(`${Math.round(km)}`, x, axY + 18);
        ctx.beginPath();
        ctx.moveTo(x, axY);
        ctx.lineTo(x, axY + 4);
        ctx.stroke();
      }
    }

    // Hover crosshair
    if (hovRef.current) {
      const { x, label } = hovRef.current;
      ctx.save();
      ctx.strokeStyle = clr.cursor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, axY);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = clr.fg;
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = x > W / 2 ? "right" : "left";
      ctx.fillText(label, x + (x > W / 2 ? -8 : 8), PAD.top + 14);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, startKm, endKm, weatherPoints, desiredTemp, isDark, dailyConfigs, startDate]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const PAD_LEFT = 52, PAD_RIGHT = 16;
    const cw = canvas.offsetWidth - PAD_LEFT - PAD_RIGHT;
    const kmRange = endKm - startKm || 1;
    const km = Math.max(startKm, Math.min(endKm, startKm + ((x - PAD_LEFT) / cw) * kmRange));
    const temp = interpTempAtKm(km, sortedWPs);
    const tempStr = temp != null ? `${temp.toFixed(1)}°C` : "–";
    let posLabel: string;
    if (dailyConfigs && startDate) {
      const tStart = gpxArrivalTime(startKm, dailyConfigs, startDate).getTime();
      const tEnd = gpxArrivalTime(endKm, dailyConfigs, startDate).getTime();
      const msRange = tEnd - tStart || 1;
      const timeMs = tStart + ((km - startKm) / (endKm - startKm || 1)) * msRange;
      const d = new Date(timeMs);
      posLabel = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } else {
      posLabel = `${Math.round(km)} km`;
    }
    hovRef.current = { x, label: `${posLabel} · ${tempStr}` };
    drawChart();
  }

  function handleMouseLeave() {
    hovRef.current = null;
    drawChart();
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Temperature profile ${Math.round(startKm)}–${Math.round(endKm)} km`}
      style={{ width: "100%", height: `${height}px`, display: "block" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

// ─── GpxCombinedDayTempChart ──────────────────────────────────────────────────

function GpxCombinedDayTempChart({
  points,
  startKm,
  endKm,
  weatherPoints,
  stopPt,
  prevStopPt,
  desiredTemp,
  height = 180,
  isDark,
  dailyConfigs,
  startDate,
}: {
  points: [number, number][];
  startKm: number;
  endKm: number;
  weatherPoints: GpxWeatherPoint[];
  stopPt: GpxWeatherPoint | null;
  prevStopPt?: GpxWeatherPoint | null;
  desiredTemp: number;
  height?: number;
  isDark?: boolean;
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hovRef = useRef<{ x: number; label: string } | null>(null);

  const sortedWPs = weatherPoints
    .filter((wp) => wp.temp != null && wp.km >= startKm - 0.1 && wp.km <= endKm + 0.1)
    .sort((a, b) => a.km - b.km) as { km: number; temp: number; type: GpxWeatherPoint["type"] }[];

  const hasTime = !!(dailyConfigs && startDate);
  const tStart = prevStopPt?.nextStartTime
    ? new Date(prevStopPt.nextStartTime).getTime()
    : hasTime ? gpxArrivalTime(startKm, dailyConfigs!, startDate!).getTime() : 0;
  const tDayEnd = hasTime ? gpxArrivalTime(endKm, dailyConfigs!, startDate!).getTime() : 0;

  const hasNight = !!(stopPt?.nightData && stopPt.nightData.length > 0 && stopPt.stopTime && stopPt.nextStartTime);
  const tNightStart = hasNight ? new Date(stopPt!.stopTime!).getTime() : tDayEnd;
  const tNightEnd = hasNight ? new Date(stopPt!.nextStartTime!).getTime() : tDayEnd;
  const tEnd = hasNight ? tNightEnd : tDayEnd;
  const msRange = tEnd - tStart || 1;

  const nightPts: { ms: number; temp: number }[] = hasNight
    ? (stopPt!.nightData as GpxNightHour[])
        .map((d) => ({ ms: new Date(`${d.date}T${d.hour}:00`).getTime(), temp: d.temp ?? NaN }))
        .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.temp)) as { ms: number; temp: number }[]
    : [];

  // Previous night's data (for day 2+): used to get the correct temperature at the start of this day's riding
  const prevNightPts: { ms: number; temp: number }[] = (prevStopPt?.nightData && prevStopPt.nextStartTime)
    ? (prevStopPt.nightData as GpxNightHour[])
        .map((d) => ({ ms: new Date(`${d.date}T${d.hour}:00`).getTime(), temp: d.temp ?? NaN }))
        .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.temp)) as { ms: number; temp: number }[]
    : [];

  // Temperature at the very start of this day's riding = last night's data at tStart
  const adjStartTemp: number | null = prevNightPts.length > 0 ? interpNightMs(tStart, prevNightPts) : null;

  // For day 2+: replace the start boundary temp in sortedWPs with the night departure temp
  const effectiveSortedWPs =
    adjStartTemp != null && sortedWPs.length > 0 && sortedWPs[0].km <= startKm + 0.1
      ? [{ ...sortedWPs[0], temp: adjStartTemp }, ...sortedWPs.slice(1)]
      : sortedWPs;

  // Night pts with explicit boundary points:
  //   start = tNightStart with the stop-point temperature (= last riding temp)
  //   end   = tNightEnd with nightData-interpolated temperature
  const stopTemp = sortedWPs.length > 0 ? interpTempAtKm(endKm, sortedWPs) : null;
  const nightEndTemp = nightPts.length >= 2 ? interpNightMs(tNightEnd, nightPts) : null;
  const nightPtsAdj: { ms: number; temp: number }[] =
    hasNight && nightPts.length >= 2 && stopTemp != null && nightEndTemp != null
      ? [
          { ms: tNightStart, temp: stopTemp },
          ...nightPts.filter((p) => p.ms > tNightStart + 60_000 && p.ms < tNightEnd - 60_000),
          { ms: tNightEnd, temp: nightEndTemp },
        ]
      : nightPts;

  const drawChart = useCallback(() => {
    const clr = getCssColors();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const PAD = { top: 20, right: 16, bottom: 36, left: 52 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;
    const axY = PAD.top + ch;

    if (cw <= 0 || ch <= 0 || !hasTime || sortedWPs.length < 2) {
      ctx.fillStyle = clr.muted;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Keine Temperaturdaten", W / 2, H / 2);
      return;
    }

    // Build day temp points: km → time → interpolated temp
    const stride = Math.max(1, Math.floor(points.length / 300));
    const sampledPts = points.filter((_, i) => i % stride === 0 || i === points.length - 1);

    // Linear km → ms mapping using known start/end times for this segment
    const kmToMs = (km: number) =>
      tStart + ((km - startKm) / (endKm - startKm || 1)) * (tDayEnd - tStart);

    const dayTempPts: { ms: number; temp: number }[] = sampledPts
      .map(([km]) => {
        const t = interpTempAtKm(km, effectiveSortedWPs);
        if (t == null) return null;
        return { ms: kmToMs(km), temp: t };
      })
      .filter((p): p is { ms: number; temp: number } => p != null);

    const allTemps = [...dayTempPts.map((p) => p.temp), ...nightPtsAdj.map((p) => p.temp)];
    if (allTemps.length === 0) {
      ctx.fillStyle = clr.muted;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Keine Temperaturdaten", W / 2, H / 2);
      return;
    }
    const minT = Math.floor(Math.min(...allTemps)) - 2;
    const maxT = Math.ceil(Math.max(...allTemps)) + 2;
    const tRange = maxT - minT || 1;

    const toX = (ms: number) => PAD.left + ((ms - tStart) / msRange) * cw;
    const toY = (temp: number) => PAD.top + ch - ((temp - minT) / tRange) * ch;

    // Night background shade
    if (hasNight) {
      ctx.fillStyle = "rgba(99,102,241,0.07)";
      ctx.fillRect(toX(tNightStart), PAD.top, toX(tNightEnd) - toX(tNightStart), ch);
    }

    // Axes
    ctx.strokeStyle = clr.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, axY);
    ctx.lineTo(PAD.left + cw, axY);
    ctx.stroke();

    // Y-axis grid + labels
    const tempTick = tRange <= 6 ? 1 : tRange <= 15 ? 2 : tRange <= 30 ? 5 : 10;
    ctx.fillStyle = clr.muted;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    for (let tv = Math.ceil(minT / tempTick) * tempTick; tv <= maxT; tv += tempTick) {
      const y = toY(tv);
      ctx.fillText(`${tv}°`, PAD.left - 4, y + 4);
      ctx.beginPath();
      ctx.strokeStyle = clr.grid;
      ctx.lineWidth = 0.7;
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cw, y);
      ctx.stroke();
    }

    // 0° reference
    if (minT < 0 && maxT > 0) {
      const y0 = toY(0);
      ctx.save();
      ctx.strokeStyle = clr.axis;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y0);
      ctx.lineTo(PAD.left + cw, y0);
      ctx.stroke();
      ctx.restore();
    }

    // Day: colored temperature line
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    for (let i = 0; i < dayTempPts.length - 1; i++) {
      const p0 = dayTempPts[i], p1 = dayTempPts[i + 1];
      ctx.beginPath();
      ctx.strokeStyle = tempToRgb((p0.temp + p1.temp) / 2, desiredTemp, isDark);
      ctx.moveTo(toX(p0.ms), toY(p0.temp));
      ctx.lineTo(toX(p1.ms), toY(p1.temp));
      ctx.stroke();
    }

    // Night separator + night temperature line
    if (hasNight && nightPtsAdj.length > 0) {
      const xSep = toX(tNightStart);
      ctx.save();
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(xSep, PAD.top);
      ctx.lineTo(xSep, axY);
      ctx.stroke();
      ctx.restore();

      if (nightPtsAdj.length >= 2) {
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(toX(nightPtsAdj[0].ms), toY(nightPtsAdj[0].temp));
        for (let i = 1; i < nightPtsAdj.length; i++) {
          ctx.lineTo(toX(nightPtsAdj[i].ms), toY(nightPtsAdj[i].temp));
        }
        ctx.stroke();
      }
      for (const p of nightPtsAdj) {
        ctx.beginPath();
        ctx.arc(toX(p.ms), toY(p.temp), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#6366f1";
        ctx.fill();
      }
    }

    // X-axis time ticks
    ctx.textAlign = "center";
    ctx.fillStyle = clr.muted;
    ctx.font = "11px sans-serif";
    ctx.strokeStyle = clr.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    const totalHours = msRange / 3600e3;
    const tickHours = totalHours <= 8 ? 1 : totalHours <= 16 ? 2 : 3;
    const t0Date = new Date(tStart);
    const firstTickH = Math.ceil((t0Date.getHours() + t0Date.getMinutes() / 60) / tickHours) * tickHours;
    let tickMs = new Date(tStart);
    tickMs.setHours(Math.floor(firstTickH), Math.round((firstTickH % 1) * 60), 0, 0);
    while (tickMs.getTime() <= tEnd + 60e3) {
      const x = toX(tickMs.getTime());
      const hhmm = `${String(tickMs.getHours()).padStart(2, "0")}:${String(tickMs.getMinutes()).padStart(2, "0")}`;
      ctx.fillText(hhmm, x, axY + 18);
      ctx.beginPath();
      ctx.moveTo(x, axY);
      ctx.lineTo(x, axY + 4);
      ctx.stroke();
      tickMs = new Date(tickMs.getTime() + tickHours * 3600e3);
    }

    // Hover crosshair
    if (hovRef.current) {
      const { x, label } = hovRef.current;
      ctx.save();
      ctx.strokeStyle = clr.cursor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, axY);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = clr.fg;
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = x > W / 2 ? "right" : "left";
      ctx.fillText(label, x + (x > W / 2 ? -8 : 8), PAD.top + 14);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, startKm, endKm, weatherPoints, stopPt, prevStopPt, desiredTemp, isDark, dailyConfigs, startDate]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const PAD_LEFT = 52, PAD_RIGHT = 16;
    const cw = canvas.offsetWidth - PAD_LEFT - PAD_RIGHT;
    const ms = Math.max(tStart, Math.min(tEnd, tStart + ((x - PAD_LEFT) / cw) * msRange));
    const d = new Date(ms);
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    let tempStr = "–";
    if (!hasNight || ms <= tNightStart) {
      const dayFrac = (tNightStart - tStart) || 1;
      const kmPos = startKm + ((ms - tStart) / dayFrac) * (endKm - startKm);
      const temp = interpTempAtKm(kmPos, effectiveSortedWPs);
      if (temp != null) tempStr = `${temp.toFixed(1)}°C`;
    } else {
      const nightTemp = interpNightMs(ms, nightPtsAdj);
      if (Number.isFinite(nightTemp)) tempStr = `${nightTemp.toFixed(1)}°C`;
    }
    hovRef.current = { x, label: `${hhmm} · ${tempStr}` };
    drawChart();
  }

  function handleMouseLeave() {
    hovRef.current = null;
    drawChart();
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Temperature profile day ${Math.round(startKm)}–${Math.round(endKm)} km`}
      style={{ width: "100%", height: `${height}px`, display: "block" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

// ─── GpxTemperatureChart ──────────────────────────────────────────────────────

export function GpxTemperatureChart({
  elevation,
  weatherPoints,
  dailyConfigs,
  startDate,
}: {
  elevation: ElevationProfile;
  weatherPoints: GpxWeatherPoint[];
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const t = useT();
  const isDark = useIsDark();

  // Compute a sensible "desired" temperature from the midpoint of the observed range
  const desiredTemp = (() => {
    const temps = weatherPoints.map((wp) => wp.temp).filter((t): t is number => t != null);
    if (temps.length === 0) return 20;
    return Math.round((Math.min(...temps) + Math.max(...temps)) / 2);
  })();

  const stopPoints = [...weatherPoints.filter((wp) => wp.type === "stop")].sort(
    (a, b) => a.km - b.km
  );

  const totalKm = elevation.totalKm || (elevation.points.at(-1)?.[0] ?? 0);
  const boundaries = [0, ...stopPoints.map((sp) => sp.km), totalKm];
  const multiDay = stopPoints.length > 0;

  const legend = (
    <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
      <span>{desiredTemp - 15}°C</span>
      <svg className="flex-1" height="10">
        <defs>
          <linearGradient id="gtc-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"    stopColor="rgb(60,0,80)" />
            <stop offset="16.7%" stopColor="rgb(30,30,160)" />
            <stop offset="33.3%" stopColor="rgb(100,160,255)" />
            <stop offset="50%"   stopColor={tempMidColor(isDark ?? true)} />
            <stop offset="66.7%" stopColor="rgb(255,150,100)" />
            <stop offset="83.3%" stopColor="rgb(200,40,40)" />
            <stop offset="100%"  stopColor="rgb(160,0,120)" />
          </linearGradient>
        </defs>
        <rect x="0" y="1" width="100%" height="8" fill="url(#gtc-grad)" rx="2" />
      </svg>
      <span className="font-bold text-foreground">{desiredTemp}°C ✓</span>
      <span>{desiredTemp + 15}°C</span>
    </div>
  );

  if (!multiDay) {
    return (
      <div>
        <DayTempChart
          points={elevation.points}
          startKm={0}
          endKm={totalKm}
          weatherPoints={weatherPoints}
          desiredTemp={desiredTemp}
          height={260}
          isDark={isDark}
          dailyConfigs={dailyConfigs}
          startDate={startDate}
        />
        {legend}
      </div>
    );
  }

  return (
    <div>
      {boundaries.slice(0, -1).map((startKm, i) => {
        const endKm = boundaries[i + 1];
        const dayNum = i + 1;
        const dayPts = elevation.points.filter(
          ([km]) => km >= startKm - 0.01 && km <= endKm + 0.01
        );
        const dayWps = weatherPoints.filter(
          (wp) => wp.km >= startKm - 0.01 && wp.km <= endKm + 0.01
        );
        const stopPt = i < stopPoints.length ? stopPoints[i] : null;
        const hasNight = !!(
          stopPt?.nightData && stopPt.nightData.length > 0 &&
          stopPt.stopTime && stopPt.nextStartTime
        );

        return (
          <div key={dayNum} className="mb-4">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                {t.gpx.day} {dayNum}
              </span>
              <span className="text-xs text-muted-foreground">
                {Math.round(startKm)}–{Math.round(endKm)} km
              </span>
              {hasNight && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-2 border-l pl-3">
                  <Moon className="h-3 w-3 shrink-0" />
                  {stopPt!.stopTime!.slice(11, 16)}–{stopPt!.nextStartTime!.slice(11, 16)}
                  {stopPt!.nightLow != null && <> · {stopPt!.nightLow}°C</>}
                </span>
              )}
            </div>
            <GpxCombinedDayTempChart
              points={dayPts}
              startKm={startKm}
              endKm={endKm}
              weatherPoints={dayWps}
              stopPt={stopPt}
              prevStopPt={i > 0 ? stopPoints[i - 1] : null}
              desiredTemp={desiredTemp}
              height={hasNight ? 200 : 160}
              isDark={isDark}
              dailyConfigs={dailyConfigs}
              startDate={startDate}
            />
          </div>
        );
      })}
      {legend}
    </div>
  );
}
