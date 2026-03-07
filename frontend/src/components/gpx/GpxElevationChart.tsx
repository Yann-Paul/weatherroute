import { useCallback, useEffect, useRef } from "react";
import type { ElevationProfile, GpxDayConfig, GpxNightHour, GpxWeatherPoint } from "@/api/types";
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

// ─── NightTempChart ───────────────────────────────────────────────────────────

function NightTempChart({
  nightData,
  stopTime,
  nextStartTime,
  height = 160,
}: {
  nightData: GpxNightHour[];
  stopTime: string;
  nextStartTime: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hovRef = useRef<{ x: number; label: string } | null>(null);

  // Convert nightData entries to {ms, temp}
  const pts = nightData
    .map((d) => ({
      ms: new Date(`${d.date}T${d.hour}:00`).getTime(),
      temp: d.temp,
    }))
    .filter((p) => Number.isFinite(p.ms));

  const t0 = new Date(stopTime).getTime();
  const t1 = new Date(nextStartTime).getTime();
  const msRange = t1 - t0 || 1;

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

    const PAD = { top: 20, right: 12, bottom: 36, left: 42 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    if (pts.length < 2 || cw <= 0 || ch <= 0) return;

    const validTemps = pts.filter((p) => p.temp !== null).map((p) => p.temp as number);
    if (validTemps.length === 0) return;
    const minT = Math.min(...validTemps) - 2;
    const maxT = Math.max(...validTemps) + 2;
    const tempRange = maxT - minT || 1;

    const toX = (ms: number) => PAD.left + ((ms - t0) / msRange) * cw;
    const toY = (temp: number) => PAD.top + ch - ((temp - minT) / tempRange) * ch;

    // Shade night background (midnight region)
    const midnight = new Date(stopTime);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const midMs = midnight.getTime();
    if (midMs > t0 && midMs < t1) {
      ctx.fillStyle = "rgba(99,102,241,0.07)";
      ctx.fillRect(toX(t0), PAD.top, toX(midMs) - toX(t0), ch);
    } else {
      ctx.fillStyle = "rgba(99,102,241,0.07)";
      ctx.fillRect(PAD.left, PAD.top, cw, ch);
    }

    // Gradient fill under curve
    const validPts = pts.filter((p) => p.temp !== null) as { ms: number; temp: number }[];
    if (validPts.length >= 2) {
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
      grad.addColorStop(0, "rgba(99,102,241,0.45)");
      grad.addColorStop(1, "rgba(99,102,241,0.05)");
      ctx.beginPath();
      ctx.moveTo(toX(validPts[0].ms), toY(validPts[0].temp));
      for (let i = 1; i < validPts.length; i++) {
        ctx.lineTo(toX(validPts[i].ms), toY(validPts[i].temp));
      }
      ctx.lineTo(toX(validPts[validPts.length - 1].ms), PAD.top + ch);
      ctx.lineTo(toX(validPts[0].ms), PAD.top + ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Temperature line
      ctx.beginPath();
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 1.5;
      ctx.moveTo(toX(validPts[0].ms), toY(validPts[0].temp));
      for (let i = 1; i < validPts.length; i++) {
        ctx.lineTo(toX(validPts[i].ms), toY(validPts[i].temp));
      }
      ctx.stroke();

      // Dot at each data point
      for (const p of validPts) {
        ctx.beginPath();
        ctx.arc(toX(p.ms), toY(p.temp), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#6366f1";
        ctx.fill();
      }
    }

    // Zero line
    if (minT < 0 && maxT > 0) {
      const y0 = toY(0);
      ctx.save();
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y0);
      ctx.lineTo(PAD.left + cw, y0);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("0°", PAD.left - 3, y0 + 3);
    }

    // Axes
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + ch);
    ctx.lineTo(PAD.left + cw, PAD.top + ch);
    ctx.stroke();

    // Y-axis ticks
    const nTicks = 3;
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= nTicks; i++) {
      const temp = minT + (tempRange * i) / nTicks;
      const y = toY(temp);
      ctx.fillText(`${Math.round(temp)}°`, PAD.left - 3, y + 3);
      ctx.beginPath();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 0.7;
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cw, y);
      ctx.stroke();
    }

    // X-axis ticks (every 3h or 6h depending on range)
    const totalHours = msRange / 3600e3;
    const tickHours = totalHours <= 12 ? 3 : 6;
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    // Start from the next rounded tick after t0
    const t0Date = new Date(t0);
    const firstTickH = Math.ceil((t0Date.getHours() + t0Date.getMinutes() / 60) / tickHours) * tickHours;
    let tickMs = new Date(t0).setHours(firstTickH, 0, 0, 0);
    while (tickMs <= t1 + 60e3) {
      const x = toX(tickMs);
      const d = new Date(tickMs);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      ctx.fillText(hhmm, x, PAD.top + ch + 18);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top + ch);
      ctx.lineTo(x, PAD.top + ch + 4);
      ctx.stroke();
      tickMs += tickHours * 3600e3;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, t0, t1, msRange, stopTime]);

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
    const PAD_LEFT = 42;
    const PAD_RIGHT = 12;
    const cw = canvas.offsetWidth - PAD_LEFT - PAD_RIGHT;
    const ms = Math.max(t0, Math.min(t1, t0 + ((x - PAD_LEFT) / cw) * msRange));
    // Find nearest point
    let closest: { ms: number; temp: number | null } | null = null;
    let minDist = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.ms - ms);
      if (d < minDist) { minDist = d; closest = p; }
    }
    const hovered = new Date(ms);
    const hhmm = `${String(hovered.getHours()).padStart(2, "0")}:${String(hovered.getMinutes()).padStart(2, "0")}`;
    const tempStr = closest?.temp !== null && closest?.temp !== undefined
      ? `${closest.temp.toFixed(1)}°C`
      : "–";
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
        // Ascent/descent for this day
        let asc = 0, desc = 0;
        for (let j = 1; j < dayPts.length; j++) {
          const diff = dayPts[j][1] - dayPts[j - 1][1];
          if (diff > 0) asc += diff; else desc -= diff;
        }
        // Night data: stop point at end of this day (not available for last day)
        const stopPt = i < stopPoints.length ? stopPoints[i] : null;
        const hasNight = !!(stopPt?.nightData && stopPt.nightData.length > 0 && stopPt.stopTime && stopPt.nextStartTime);
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
              {hasNight && (
                <span className="text-xs text-muted-foreground ml-2 border-l pl-3">
                  ☽ {stopPt!.stopTime!.slice(11, 16)}–{stopPt!.nextStartTime!.slice(11, 16)}
                  {stopPt!.nightLow !== null && stopPt!.nightLow !== undefined && (
                    <> · {stopPt!.nightLow}°C</>
                  )}
                </span>
              )}
            </div>
            <div className={hasNight ? "flex gap-2" : undefined}>
              <div style={hasNight ? { flex: "0 0 62%" } : undefined}>
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
              {hasNight && (
                <div style={{ flex: "0 0 38%" }}>
                  <div className="text-xs text-center text-muted-foreground mb-0.5">☽ Nacht</div>
                  <NightTempChart
                    nightData={stopPt!.nightData!}
                    stopTime={stopPt!.stopTime!}
                    nextStartTime={stopPt!.nextStartTime!}
                    height={160}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      {stats}
    </div>
  );
}
