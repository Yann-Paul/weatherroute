import { useCallback, useEffect, useRef } from "react";
import type { ElevationProfile, GpxDayConfig, GpxWeatherPoint } from "@/api/types";
import { useT } from "@/i18n/useT";

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

function markerColor(type: GpxWeatherPoint["type"]): string {
  if (type === "stop") return "#7c3aed";
  if (type === "pass") return "#f97316";
  if (type === "valley") return "#3b82f6";
  if (type === "start") return "#22c55e";
  if (type === "end") return "#6b7280";
  return "#9ca3af";
}

// ─── DayChart ─────────────────────────────────────────────────────────────────

function DayChart({
  points,
  startKm,
  endKm,
  weatherPoints,
  height = 180,
  dailyConfigs,
  startDate,
}: {
  points: [number, number][];
  startKm: number;
  endKm: number;
  weatherPoints: GpxWeatherPoint[];
  height?: number;
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hovRef = useRef<{ x: number; label: string } | null>(null);

  const drawChart = useCallback(() => {
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

    if (points.length < 2 || cw <= 0 || ch <= 0) return;

    const kmRange = endKm - startKm || 1;
    const eles = points.map((p) => p[1]);
    const minEle = Math.max(0, Math.min(...eles) - 40);
    const maxEle = Math.max(...eles) + 30;
    const eleRange = maxEle - minEle || 1;

    const toX = (km: number) => PAD.left + ((km - startKm) / kmRange) * cw;
    const toY = (ele: number) => PAD.top + ch - ((ele - minEle) / eleRange) * ch;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
    grad.addColorStop(0, "rgba(96,165,250,0.55)");
    grad.addColorStop(1, "rgba(37,99,235,0.1)");

    ctx.beginPath();
    ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
    }
    ctx.lineTo(toX(endKm), PAD.top + ch);
    ctx.lineTo(PAD.left, PAD.top + ch);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Profile line
    ctx.beginPath();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1.5;
    ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
    }
    ctx.stroke();

    // Weather point markers
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
      ctx.lineTo(x, PAD.top + ch);
      ctx.stroke();
      ctx.restore();

      if (wp.type !== "regular") {
        ctx.fillStyle = color;
        ctx.font = wp.type === "stop" ? "bold 9px sans-serif" : "9px sans-serif";
        ctx.textAlign = "center";
        const label = wp.type === "stop" ? `N${wp.dayNumber ?? ""}` : `${Math.round(wp.km)}`;
        ctx.fillText(label, x, PAD.top - 4);
      }
    }

    // Axes
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + ch);
    ctx.lineTo(PAD.left + cw, PAD.top + ch);
    ctx.stroke();

    // Y-axis ticks and grid
    const nTicks = 3;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= nTicks; i++) {
      const ele = minEle + (eleRange * i) / nTicks;
      const y = toY(ele);
      ctx.fillText(`${Math.round(ele)}`, PAD.left - 5, y + 4);
      ctx.beginPath();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 0.8;
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cw, y);
      ctx.stroke();
    }

    // X-axis ticks
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.font = "11px sans-serif";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    const xStep = Math.max(1, Math.ceil(kmRange / 5 / 5) * 5);
    for (let km = Math.ceil(startKm / xStep) * xStep; km <= endKm; km += xStep) {
      const x = toX(km);
      ctx.fillText(`${Math.round(km)}`, x, PAD.top + ch + 18);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top + ch);
      ctx.lineTo(x, PAD.top + ch + 4);
      ctx.stroke();
    }

    // Hover crosshair
    if (hovRef.current) {
      const { x, label } = hovRef.current;
      ctx.save();
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + ch);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = x > W / 2 ? "right" : "left";
      ctx.fillText(label, x + (x > W / 2 ? -8 : 8), PAD.top + 14);
    }
  }, [points, startKm, endKm, weatherPoints]);

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
    const PAD_LEFT = 52;
    const PAD_RIGHT = 16;
    const cw = canvas.offsetWidth - PAD_LEFT - PAD_RIGHT;
    const kmRange = endKm - startKm || 1;
    const km = Math.max(startKm, Math.min(endKm, startKm + ((x - PAD_LEFT) / cw) * kmRange));
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i][0] - km);
      if (d < minDist) { minDist = d; closestIdx = i; }
    }
    const ele = points[closestIdx][1];
    let label = `${Math.round(km)} km · ${Math.round(ele)} m`;
    if (dailyConfigs && startDate) {
      const arrival = gpxArrivalTime(km, dailyConfigs, startDate);
      const timeStr = arrival.toLocaleString(undefined, {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      label += ` · ${timeStr}`;
    }
    hovRef.current = { x, label };
    drawChart();
  }

  function handleMouseLeave() {
    hovRef.current = null;
    drawChart();
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: `${height}px`, display: "block" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

// ─── GpxElevationChart ────────────────────────────────────────────────────────

export function GpxElevationChart({
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

  // Derive day boundaries from stop points
  const stopPoints = [...weatherPoints.filter((wp) => wp.type === "stop")].sort(
    (a, b) => a.km - b.km
  );

  const totalKm = elevation.totalKm || (elevation.points.at(-1)?.[0] ?? 0);
  const boundaries = [0, ...stopPoints.map((sp) => sp.km), totalKm];
  const multiDay = stopPoints.length > 0;

  const stats = (
    <div className="mt-2 flex flex-wrap gap-6 text-sm text-muted-foreground">
      <span>
        {t.gpx.results.totalKm}: <strong>{elevation.totalKm} km</strong>
      </span>
      <span>
        {t.gpx.results.ascent}: <strong>↑{elevation.totalAscent} m</strong>
      </span>
      <span>
        {t.gpx.results.descent}: <strong>↓{elevation.totalDescent} m</strong>
      </span>
    </div>
  );

  if (!multiDay) {
    // Single-day: original full chart
    return (
      <div>
        <DayChart
          points={elevation.points}
          startKm={0}
          endKm={totalKm}
          weatherPoints={weatherPoints}
          height={260}
          dailyConfigs={dailyConfigs}
          startDate={startDate}
        />
        {stats}
      </div>
    );
  }

  // Multi-day: one chart per day
  return (
    <div>
      {boundaries.slice(0, -1).map((startKm, i) => {
        const endKm = boundaries[i + 1];
        const dayNum = i + 1;
        const dayPts = elevation.points.filter(([km]) => km >= startKm - 0.01 && km <= endKm + 0.01);
        const dayWps = weatherPoints.filter((wp) => wp.km >= startKm - 0.01 && wp.km <= endKm + 0.01);
        const dayKm = Math.round(endKm - startKm);
        // Ascent/descent for this day
        let asc = 0, desc = 0;
        for (let j = 1; j < dayPts.length; j++) {
          const diff = dayPts[j][1] - dayPts[j - 1][1];
          if (diff > 0) asc += diff; else desc -= diff;
        }
        return (
          <div key={dayNum} className="mb-4">
            <div className="flex items-center gap-3 mb-1">
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ background: "#7c3aed" }}
              >
                {t.gpx.day} {dayNum}
              </span>
              <span className="text-xs text-muted-foreground">
                {Math.round(startKm)}–{Math.round(endKm)} km
                {" · "}↑{Math.round(asc)} m ↓{Math.round(desc)} m
              </span>
            </div>
            <DayChart
              points={dayPts}
              startKm={startKm}
              endKm={endKm}
              weatherPoints={dayWps}
              height={160}
              dailyConfigs={dailyConfigs}
              startDate={startDate}
            />
          </div>
        );
      })}
      {stats}
    </div>
  );
}
