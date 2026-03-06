import { useCallback, useEffect, useRef } from "react";
import type { ElevationProfile, GpxWeatherPoint } from "@/api/types";
import { useT } from "@/i18n/useT";

function markerColor(type: GpxWeatherPoint["type"]): string {
  if (type === "pass") return "#f97316";
  if (type === "valley") return "#3b82f6";
  if (type === "start") return "#22c55e";
  if (type === "end") return "#6b7280";
  return "#9ca3af";
}

export function GpxElevationChart({
  elevation,
  weatherPoints,
}: {
  elevation: ElevationProfile;
  weatherPoints: GpxWeatherPoint[];
}) {
  const t = useT();
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

    const PAD = { top: 24, right: 16, bottom: 36, left: 52 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    const points = elevation.points;
    if (points.length < 2 || cw <= 0 || ch <= 0) return;

    const maxKm = points[points.length - 1][0];
    const eles = points.map((p) => p[1]);
    const minEle = Math.min(...eles);
    const maxEle = Math.max(...eles);
    const eleRange = maxEle - minEle || 1;

    const toX = (km: number) => PAD.left + (km / maxKm) * cw;
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
    ctx.lineTo(toX(maxKm), PAD.top + ch);
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

    // Weather point vertical markers
    for (const wp of weatherPoints) {
      if (wp.km > maxKm) continue;
      const x = toX(wp.km);
      const color = markerColor(wp.type);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + ch);
      ctx.stroke();
      ctx.restore();

      if (wp.type !== "regular") {
        ctx.fillStyle = color;
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(wp.km)}`, x, PAD.top - 6);
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
    const nTicks = 4;
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
    const xStep = Math.ceil(maxKm / 8 / 10) * 10 || 1;
    for (let km = 0; km <= maxKm; km += xStep) {
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
  }, [elevation, weatherPoints]);

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
    const points = elevation.points;
    const maxKm = points[points.length - 1][0];
    const km = Math.max(0, Math.min(maxKm, ((x - PAD_LEFT) / cw) * maxKm));
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i][0] - km);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    const ele = points[closestIdx][1];
    hovRef.current = { x, label: `${Math.round(km)} km · ${Math.round(ele)} m` };
    drawChart();
  }

  function handleMouseLeave() {
    hovRef.current = null;
    drawChart();
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "280px", display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <div className="mt-2 flex flex-wrap gap-6 text-sm text-muted-foreground">
        <span>
          {t.gpx.results.totalKm}:{" "}
          <strong>{elevation.totalKm} km</strong>
        </span>
        <span>
          {t.gpx.results.ascent}:{" "}
          <strong>↑{elevation.totalAscent} m</strong>
        </span>
        <span>
          {t.gpx.results.descent}:{" "}
          <strong>↓{elevation.totalDescent} m</strong>
        </span>
      </div>
    </div>
  );
}
