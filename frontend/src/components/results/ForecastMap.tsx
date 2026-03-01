import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import {
  Map as MapView,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import { useResultsStore } from "@/stores/resultsStore";
import { useT } from "@/i18n/useT";
import type { ForecastPoint, ForecastPointData } from "@/api/types";

const HOUR_STEPS = [0, 6, 12, 18, 24];

// ─── Pure helpers ────────────────────────────────────────────────────────────

function compassDir16(deg: number | null): string {
  if (deg == null) return "";
  const dirs = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function tempToRgb(temp: number, desired: number): string {
  const STOPS: [number, [number, number, number]][] = [
    [-1.0, [60, 0, 80]], [-0.667, [30, 30, 160]], [-0.333, [100, 160, 255]],
    [0.0, [255, 255, 255]], [0.333, [255, 150, 100]], [0.667, [200, 40, 40]], [1.0, [160, 0, 120]],
  ];
  const t = Math.max(-1, Math.min(1, (temp - desired) / 15));
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (t <= STOPS[i + 1][0]) {
      const f = (t - STOPS[i][0]) / (STOPS[i + 1][0] - STOPS[i][0]);
      const [r0, g0, b0] = STOPS[i][1], [r1, g1, b1] = STOPS[i + 1][1];
      return `rgb(${Math.round(r0+f*(r1-r0))},${Math.round(g0+f*(g1-g0))},${Math.round(b0+f*(b1-b0))})`;
    }
  }
  return "rgb(160,0,120)";
}

function kmToLatLon(km: number, miniElev: [number, number, number, number][]): [number, number] {
  if (miniElev.length === 0) return [0, 0];
  if (km <= miniElev[0][0]) return [miniElev[0][1], miniElev[0][2]];
  for (let i = 1; i < miniElev.length; i++) {
    if (miniElev[i][0] >= km) {
      const span = miniElev[i][0] - miniElev[i - 1][0];
      const t = span > 0 ? (km - miniElev[i - 1][0]) / span : 0;
      return [
        miniElev[i - 1][1] + t * (miniElev[i][1] - miniElev[i - 1][1]),
        miniElev[i - 1][2] + t * (miniElev[i][2] - miniElev[i - 1][2]),
      ];
    }
  }
  return [miniElev[miniElev.length - 1][1], miniElev[miniElev.length - 1][2]];
}

function geoBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function routeBearingAt(km: number, miniElev: [number, number, number, number][]): number | null {
  if (miniElev.length < 2) return null;
  for (let i = 1; i < miniElev.length; i++) {
    if (miniElev[i][0] >= km)
      return geoBearing(miniElev[i-1][1], miniElev[i-1][2], miniElev[i][1], miniElev[i][2]);
  }
  const n = miniElev.length;
  return geoBearing(miniElev[n-2][1], miniElev[n-2][2], miniElev[n-1][1], miniElev[n-1][2]);
}

function windArrowColor(wdir: number, routeBearing: number): string {
  let diff = Math.abs(((wdir - routeBearing) % 360 + 360) % 360);
  if (diff > 180) diff = 360 - diff;
  const t = diff / 180;
  const r = Math.round(220 * (1 - t));
  const g = Math.round(180 * t);
  return `rgb(${r},${g},20)`;
}

// ─── Wind arrow SVG ──────────────────────────────────────────────────────────

function WindArrow({ wdir, wspd, routeBearing }: { wdir: number; wspd: number; routeBearing: number }) {
  const blowsTo = (wdir + 180) % 360;
  const color = windArrowColor(wdir, routeBearing);
  const opacity = Math.min(1, 0.45 + wspd / 55);
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "2px" }}>
      <svg width="18" height="18" viewBox="-9 -9 18 18"
        style={{ transform: `rotate(${blowsTo}deg)`, opacity, display: "block" }}>
        <line x1="0" y1="6" x2="0" y2="-3" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="0,-9 -3.5,-2 3.5,-2" fill={color} />
      </svg>
    </div>
  );
}

// ─── Zoom-aware forecast markers ─────────────────────────────────────────────

interface MarkersProps {
  points: ForecastPoint[];
  data: Record<string, ForecastPointData>;
  miniElev: [number, number, number, number][];
  currentHour: number;
  dailyMode: boolean;
  desiredHigh: number;
  desiredLow: number;
  buildPopupContent: (pt: ForecastPoint, fd: ForecastPointData) => string;
}

function ForecastMarkers({
  points, data, miniElev, currentHour, dailyMode,
  desiredHigh, desiredLow, buildPopupContent,
}: MarkersProps) {
  const { map, isLoaded } = useMap();
  const [zoom, setZoom] = useState(5);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);
    setZoom(map.getZoom());
    return () => { map.off("zoom", onZoom); };
  }, [map, isLoaded]);

  const step = zoom < 3.5 ? 10 : zoom < 4.5 ? 6 : zoom < 5.5 ? 3 : zoom < 6.5 ? 2 : 1;
  const desiredAvg = (desiredHigh + desiredLow) / 2;

  return (
    <>
      {points.map((pt, i) => {
        if (i !== 0 && i !== points.length - 1 && i % step !== 0) return null;
        const fd = data[String(i)];
        if (!fd?.ok) return null;

        const textShadow = "0 1px 3px rgba(0,0,0,0.65)";
        let bg = "#94a3b8";
        let boxContent: React.ReactNode;
        let wdir: number | null = null;
        let wspd: number | null = null;

        if (dailyMode) {
          const d = fd.daily;
          const tavg = d?.tmax != null && d?.tmin != null ? (d.tmax + d.tmin) / 2 : null;
          bg = tavg != null ? tempToRgb(tavg, desiredAvg) : "#94a3b8";
          boxContent = (
            <>
              <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                {d?.tmax != null && (
                  <span>
                    <span style={{ color: "#fde68a", textShadow }}>☀</span>
                    <span style={{ color: "#fff", textShadow }}>{Math.round(d.tmax)}°</span>
                  </span>
                )}
                {d?.tmin != null && (
                  <span>
                    <span style={{ color: "#bfdbfe", textShadow }}>☽</span>
                    <span style={{ color: "#fff", textShadow }}>{Math.round(d.tmin)}°</span>
                  </span>
                )}
              </div>
              {(d?.prcp != null || d?.sun != null) && (
                <div style={{ fontSize: "9px", display: "flex", gap: "4px", justifyContent: "center" }}>
                  {d?.prcp != null && d.prcp > 0.1 && (
                    <span>
                      <span style={{ color: "#93c5fd", textShadow }}>☂</span>
                      <span style={{ color: "#fff", textShadow }}>{d.prcp.toFixed(1)}mm</span>
                    </span>
                  )}
                  {d?.sun != null && (
                    <span>
                      <span style={{ color: "#fde68a", textShadow }}>☀</span>
                      <span style={{ color: "#fff", textShadow }}>{d.sun.toFixed(1)}h</span>
                    </span>
                  )}
                </div>
              )}
            </>
          );
        } else {
          const h = fd.hourly?.[String(currentHour)];
          const chartRef = (currentHour === 0 || currentHour === 6 || currentHour === 24) ? desiredLow : desiredHigh;
          bg = h?.temp != null ? tempToRgb(h.temp, chartRef) : "#94a3b8";
          const isRainy = (h?.prcp ?? 0) > 1;
          const isHeavyCloud = (h?.cloud ?? 0) > 75;
          const iconColor = isRainy ? "#93c5fd" : isHeavyCloud ? "#cbd5e1" : "#fde68a";
          const iconChar = isRainy ? "\u2602" : isHeavyCloud ? "\u2601" : "\u2600";
          wdir = h?.wdir ?? null;
          wspd = h?.wspd ?? null;
          boxContent = (
            <>
              <div>
                <span style={{ color: iconColor, textShadow }}>{iconChar}</span>
                {" "}
                <span style={{ color: "#fff", textShadow }}>
                  {h?.temp != null ? `${Math.round(h.temp)}°` : "?"}
                </span>
              </div>
              {h?.prcp != null && h.prcp > 0.3 && (
                <div style={{ fontSize: "9px" }}>
                  <span style={{ color: "#93c5fd", textShadow }}>☂</span>
                  <span style={{ color: "#fff", textShadow }}>{h.prcp.toFixed(1)} mm</span>
                </div>
              )}
            </>
          );
        }

        const routeBearing = routeBearingAt(pt.km, miniElev);
        const showArrow = !dailyMode && wdir != null && wspd != null && routeBearing != null;

        return (
          <MapMarker key={`fp-${i}`} longitude={pt.lon} latitude={pt.lat}>
            <MarkerContent>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  className="cursor-pointer rounded border px-1.5 py-0.5 text-center font-bold shadow-md whitespace-nowrap leading-tight"
                  style={{ background: bg, borderColor: "rgba(255,255,255,0.25)", fontSize: "10px", minWidth: "42px" }}
                >
                  {boxContent}
                </div>
                {showArrow && (
                  <WindArrow wdir={wdir!} wspd={wspd!} routeBearing={routeBearing!} />
                )}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <div dangerouslySetInnerHTML={{ __html: buildPopupContent(pt, fd) }} />
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </>
  );
}

// ─── FitBounds ───────────────────────────────────────────────────────────────

function FitBounds({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 50 });
  }, [map, isLoaded, coordinates]);
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ForecastMap() {
  const forecast = useResultsStore((s) => s.forecast);
  const [hourIdx, setHourIdx] = useState(2);
  const [dailyMode, setDailyMode] = useState(false);
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const stateRef = useRef({ hourIdx, dailyMode, forecast });
  stateRef.current = { hourIdx, dailyMode, forecast };

  const points     = forecast?.points     ?? [];
  const data       = forecast?.data       ?? {};
  const miniElev   = forecast?.miniElev   ?? [];
  const routeStops = forecast?.routeStops ?? [];
  const desiredHigh = forecast?.desiredHigh ?? 25;
  const desiredLow  = forecast?.desiredLow  ?? 15;
  const desiredAvg  = (desiredHigh + desiredLow) / 2;
  const currentHour = HOUR_STEPS[hourIdx];

  const hourLabels = HOUR_STEPS.map((h) => t.forecastMap.hourLabel(h));

  const routeCoords = useMemo<[number, number][]>(
    () => miniElev.map(([, lat, lon]) => [lon, lat]),
    [miniElev]
  );

  const dayTransitions = useMemo(() => {
    const result: { lat: number; lon: number; relDay: number }[] = [];
    for (let i = 0; i < routeStops.length - 1; i++) {
      const s0 = routeStops[i], s1 = routeStops[i + 1];
      const diff = s1.relDay - s0.relDay;
      if (diff <= 1) continue;
      for (let d = 1; d < diff; d++) {
        const tv = d / diff;
        const km = s0.km + tv * (s1.km - s0.km);
        const [lat, lon] = kmToLatLon(km, miniElev);
        result.push({ lat, lon, relDay: s0.relDay + d });
      }
    }
    return result;
  }, [routeStops, miniElev]);

  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || miniElev.length < 2) return;

    const W = svg.parentElement?.offsetWidth || 600;
    const H = 180;
    const PL = 40, PR = 8, PT = 26, PB = 20;
    const cW = W - PL - PR, cH = H - PT - PB;

    const kmMin = miniElev[0][0], kmMax = miniElev[miniElev.length - 1][0];
    const eles = miniElev.map((p) => p[3]);
    const eMin = Math.max(0, Math.min(...eles) - 80);
    const eMax = Math.max(...eles) + 50;
    const eRange = eMax - eMin || 1;
    chartStateRef.current = { miniElev, kmMin, kmMax, eMin, eMax, eRange, PL, cW, PT, PB, cH, H };

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (ele: number) => PT + cH - ((ele - eMin) / eRange) * cH;

    function interpTemp(km: number, ele: number): number | null {
      if (!points.length) return null;
      let ci = points.findIndex((p) => p.km >= km);
      if (ci < 0) ci = points.length - 1;
      if (ci === 0) ci = 1;
      const p0 = points[ci - 1], p1 = points[ci];
      const fd0 = data[String(ci - 1)], fd1 = data[String(ci)];
      if (!fd0?.ok || !fd1?.ok) return null;
      const h0 = fd0.hourly?.[String(currentHour)];
      const h1 = fd1.hourly?.[String(currentHour)];
      if (h0?.temp == null || h1?.temp == null) return null;
      const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
      const prcp = (h0.prcp || 0) + tv * ((h1.prcp || 0) - (h0.prcp || 0));
      const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
      const eleRef = p0.ele + tv * (p1.ele - p0.ele);
      return h0.temp + tv * (h1.temp - h0.temp) - (ele - eleRef) * lapse;
    }

    function interpTempByKey(km: number, ele: number, key: "tmax" | "tmin"): number | null {
      if (!points.length) return null;
      let ci = points.findIndex((p) => p.km >= km);
      if (ci < 0) ci = points.length - 1;
      if (ci === 0) ci = 1;
      const p0 = points[ci - 1], p1 = points[ci];
      const fd0 = data[String(ci - 1)], fd1 = data[String(ci)];
      if (!fd0?.ok || !fd1?.ok) return null;
      const d0 = fd0.daily, d1 = fd1.daily;
      if (d0?.[key] == null || d1?.[key] == null) return null;
      const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
      const eleRef = p0.ele + tv * (p1.ele - p0.ele);
      return d0[key]! + tv * (d1[key]! - d0[key]!) - (ele - eleRef) / 100;
    }

    let out = "";
    const BAND = 10;

    if (dailyMode) {
      for (let i = 0; i < miniElev.length - 1; i++) {
        const [km0,,, e0] = miniElev[i], [km1,,, e1] = miniElev[i + 1];
        out += `<polygon points="${xp(km0)},${yp(e0)} ${xp(km1)},${yp(e1)} ${xp(km1)},${yp(eMin)} ${xp(km0)},${yp(eMin)}" fill="#cbd5e1" opacity="0.8"/>`;
      }
      const outline = miniElev.map((p) => `${xp(p[0])},${yp(p[3])}`).join(" ");
      out += `<polyline points="${outline}" fill="none" stroke="#94a3b8" stroke-width="1"/>`;
      for (let i = 0; i < miniElev.length - 1; i++) {
        const [km0,,, e0] = miniElev[i], [km1,,, e1] = miniElev[i + 1];
        const mk = (km0 + km1) / 2, me = (e0 + e1) / 2;
        const tmaxV = interpTempByKey(mk, me, "tmax");
        const tminV = interpTempByKey(mk, me, "tmin");
        const w = xp(km1) - xp(km0);
        if (tmaxV != null) out += `<rect x="${xp(km0)}" y="${PT}" width="${w}" height="${BAND}" fill="${tempToRgb(tmaxV, desiredHigh)}" opacity="0.9"/>`;
        if (tminV != null) out += `<rect x="${xp(km0)}" y="${PT+BAND+1}" width="${w}" height="${BAND}" fill="${tempToRgb(tminV, desiredLow)}" opacity="0.9"/>`;
      }
      out += `<text x="${W-PR-2}" y="${PT+8}" text-anchor="end" font-size="8" fill="#ea580c" font-family="sans-serif">☀Tmax</text>`;
      out += `<text x="${W-PR-2}" y="${PT+20}" text-anchor="end" font-size="8" fill="#0284c7" font-family="sans-serif">☽Tmin</text>`;
    } else {
      const chartRef = (currentHour === 0 || currentHour === 6 || currentHour === 24) ? desiredLow : desiredHigh;
      for (let i = 0; i < miniElev.length - 1; i++) {
        const [km0,,, e0] = miniElev[i], [km1,,, e1] = miniElev[i + 1];
        const tmid = interpTemp((km0 + km1) / 2, (e0 + e1) / 2);
        const col = tmid != null ? tempToRgb(tmid, chartRef) : "#94a3b8";
        out += `<polygon points="${xp(km0)},${yp(e0)} ${xp(km1)},${yp(e1)} ${xp(km1)},${yp(eMin)} ${xp(km0)},${yp(eMin)}" fill="${col}" opacity="0.85"/>`;
      }
      const outline = miniElev.map((p) => `${xp(p[0])},${yp(p[3])}`).join(" ");
      out += `<polyline points="${outline}" fill="none" stroke="#475569" stroke-width="1"/>`;
    }

    out += `<line x1="${PL}" y1="${PT}" x2="${W-PR}" y2="${PT}" stroke="#e2e8f0" stroke-width="0.8"/>`;
    out += `<line x1="${PL}" y1="${H-PB}" x2="${W-PR}" y2="${H-PB}" stroke="#e2e8f0" stroke-width="0.8"/>`;
    out += `<text x="${PL-4}" y="${PT+5}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="sans-serif">${Math.round(eMax)}m</text>`;
    out += `<text x="${PL-4}" y="${H-PB}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="sans-serif">${Math.round(eMin)}m</text>`;
    out += `<text x="${PL+cW/2}" y="${H-3}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="sans-serif">${Math.round(kmMax-kmMin)} km</text>`;
    out += `<line id="fc-cursor" x1="0" y1="${PT}" x2="0" y2="${H-PB}" stroke="#334155" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="fc-cursor-dot" cx="0" cy="0" r="3" fill="#334155" opacity="0.85" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [miniElev, dailyMode, currentHour, points, data, desiredHigh, desiredLow]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  function onChartMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const cs = chartStateRef.current;
    const svg = svgRef.current;
    const tooltip = tooltipRef.current;
    if (!cs || !svg || !tooltip) return;

    const { hourIdx, dailyMode, forecast } = stateRef.current;
    const pts  = forecast?.points ?? [];
    const dt   = forecast?.data   ?? {};
    const dHigh = forecast?.desiredHigh ?? 25;
    const dLow  = forecast?.desiredLow  ?? 15;
    const hour  = HOUR_STEPS[hourIdx];

    function interpTemp(km: number, ele: number): number | null {
      let ci = pts.findIndex((p) => p.km >= km);
      if (ci < 0) ci = pts.length - 1;
      if (ci === 0) ci = 1;
      const p0 = pts[ci-1], p1 = pts[ci];
      const fd0 = dt[String(ci-1)], fd1 = dt[String(ci)];
      if (!fd0?.ok || !fd1?.ok) return null;
      const h0 = fd0.hourly?.[String(hour)], h1 = fd1.hourly?.[String(hour)];
      if (h0?.temp == null || h1?.temp == null) return null;
      const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
      const prcp = (h0.prcp || 0) + tv * ((h1.prcp || 0) - (h0.prcp || 0));
      const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
      return h0.temp + tv * (h1.temp - h0.temp) - (ele - (p0.ele + tv*(p1.ele-p0.ele))) * lapse;
    }

    function interpByKey(km: number, ele: number, key: "tmax" | "tmin"): number | null {
      let ci = pts.findIndex((p) => p.km >= km);
      if (ci < 0) ci = pts.length - 1;
      if (ci === 0) ci = 1;
      const p0 = pts[ci-1], p1 = pts[ci];
      const fd0 = dt[String(ci-1)], fd1 = dt[String(ci)];
      if (!fd0?.ok || !fd1?.ok) return null;
      const d0 = fd0.daily, d1 = fd1.daily;
      if (d0?.[key] == null || d1?.[key] == null) return null;
      const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
      return d0[key]! + tv*(d1[key]!-d0[key]!) - (ele - (p0.ele+tv*(p1.ele-p0.ele))) / 100;
    }

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < cs.PL || x > cs.PL + cs.cW) {
      tooltip.style.display = "none";
      svg.querySelector("#fc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#fc-cursor-dot")?.setAttribute("visibility", "hidden");
      return;
    }
    const km = cs.kmMin + ((x - cs.PL) / cs.cW) * (cs.kmMax - cs.kmMin);
    let best = cs.miniElev[0], bestDist = Math.abs(best[0] - km);
    for (const p of cs.miniElev) {
      const d = Math.abs(p[0] - km);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    const ele = best[3];
    const cx = cs.PL + ((km - cs.kmMin) / (cs.kmMax - cs.kmMin)) * cs.cW;
    const cy = cs.PT + cs.cH - ((ele - cs.eMin) / cs.eRange) * cs.cH;
    const cl = svg.querySelector("#fc-cursor");
    if (cl) { cl.setAttribute("x1", String(cx)); cl.setAttribute("x2", String(cx)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector("#fc-cursor-dot");
    if (cdot) { cdot.setAttribute("cx", String(cx)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    let ttHtml = `<div style="color:#64748b;font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:#1e293b">⛰ ${Math.round(ele)} m</div>`;
    if (dailyMode) {
      const tmax = interpByKey(km, ele, "tmax");
      const tmin = interpByKey(km, ele, "tmin");
      if (tmax != null) ttHtml += `<div style="color:${tempToRgb(tmax, dHigh)}">☀ Tmax: ${tmax.toFixed(1)}°C</div>`;
      if (tmin != null) ttHtml += `<div style="color:${tempToRgb(tmin, dLow)}">☽ Tmin: ${tmin.toFixed(1)}°C</div>`;
    } else {
      const chartRef = (hour === 0 || hour === 6 || hour === 24) ? dLow : dHigh;
      const temp = interpTemp(km, ele);
      if (temp != null) ttHtml += `<div style="color:${tempToRgb(temp, chartRef)}">🌡 ${temp.toFixed(1)}°C</div>`;
    }

    tooltip.innerHTML = ttHtml;
    tooltip.style.display = "block";
    const tw = tooltip.offsetWidth;
    const panelW = svg.parentElement?.offsetWidth || 600;
    let tx = x + 14;
    if (tx + tw + 4 > panelW) tx = x - tw - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.bottom = "26px";
    tooltip.style.top = "auto";
  }

  function onChartMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector("#fc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#fc-cursor-dot")?.setAttribute("visibility", "hidden");
    }
  }

  function buildPopupContent(pt: ForecastPoint, fd: ForecastPointData): string {
    const lbl = (color: string, text: string) =>
      `<span style="color:${color};font-weight:600">${text}</span>`;
    const val = (text: string) => `<b style="color:#1e293b">${text}</b>`;

    const lines = [`<div style="font-family:sans-serif;min-width:160px;font-size:12px;color:#475569">`];
    lines.push(`<b style="color:#1e293b">⛰ ${Math.round(pt.ele)} m</b>&nbsp; km ${Math.round(pt.km)}`);
    lines.push(`<br><span style="color:#94a3b8">${pt.target_date ?? ""}</span>`);
    lines.push(`<hr style="margin:6px 0;border-color:#e2e8f0">`);
    if (!fd.ok) { lines.push(`${t.forecastMap.noData}</div>`); return lines.join(""); }
    if (dailyMode) {
      const d = fd.daily ?? {};
      if (d.tmax != null) lines.push(`${lbl("#f97316","☀ Tmax:")} ${val(d.tmax.toFixed(1)+"°C")}<br>`);
      if (d.tmin != null) lines.push(`${lbl("#3b82f6","☽ Tmin:")} ${val(d.tmin.toFixed(1)+"°C")}<br>`);
      if (d.prcp != null) lines.push(`${lbl("#60a5fa","☂ Regen:")} ${val(d.prcp.toFixed(1)+" mm")}<br>`);
      if (d.wspd != null) lines.push(`${lbl("#6b7280","☴ Windmax:")} ${val(d.wspd.toFixed(1)+" km/h")}<br>`);
      if (d.sun  != null) lines.push(`${lbl("#f59e0b","☀ Sonne:")} ${val(d.sun.toFixed(1)+" h")}<br>`);
    } else {
      const h = fd.hourly?.[String(currentHour)] ?? {};
      lines.push(`<b style="color:#1e293b">${t.forecastMap.hourLabel(currentHour)}</b><br>`);
      if (h.temp  != null) {
        const tColor = tempToRgb(h.temp, (desiredHigh + desiredLow) / 2);
        lines.push(`${lbl("#64748b","Temp:")} <b style="color:${tColor}">${h.temp.toFixed(1)}°C</b><br>`);
      }
      if (h.prcp  != null) lines.push(`${lbl("#60a5fa","☂:")} ${val(h.prcp.toFixed(1)+" mm")}<br>`);
      if (h.wspd  != null) {
        const rb = routeBearingAt(pt.km, miniElev);
        const dirStr = h.wdir != null && rb != null
          ? ` <span style="color:${windArrowColor(h.wdir, rb)};font-weight:700">${compassDir16(h.wdir)}</span>`
          : "";
        lines.push(`${lbl("#6b7280","☴ Wind:")} ${val(h.wspd.toFixed(1)+" km/h")}${dirStr}<br>`);
      }
      if (h.cloud != null) lines.push(`${lbl("#94a3b8","☁:")} ${val(Math.round(h.cloud)+"%")}<br>`);
      if (h.sun   != null) lines.push(`${lbl("#f59e0b","☀:")} ${val(Math.round(h.sun)+" min")}<br>`);
    }
    lines.push("</div>");
    return lines.join("");
  }

  if (!forecast) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-border bg-muted/30 text-muted-foreground">
        {t.forecastMap.noForecast}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-600">{t.forecastMap.time}</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          {HOUR_STEPS.map((h, i) => (
            <button
              key={h}
              onClick={() => { setHourIdx(i); setDailyMode(false); }}
              className={[
                "border-r border-slate-200 px-3 py-1.5 text-xs font-medium last:border-r-0 transition-colors",
                !dailyMode && hourIdx === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {hourLabels[i]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setDailyMode((d) => !d)}
          className={[
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            dailyMode
              ? "bg-primary text-primary-foreground border-primary"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          ].join(" ")}
        >
          {t.forecastMap.dailyOverview}
        </button>

        {!dailyMode && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="-6 -6 12 12"><polygon points="0,-6 -2.5,-1 2.5,-1" fill="rgb(0,180,20)"/><line x1="0" y1="4" x2="0" y2="-1" stroke="rgb(0,180,20)" strokeWidth="2" strokeLinecap="round"/></svg>
              {t.forecastMap.tailwind}
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="-6 -6 12 12"><polygon points="0,-6 -2.5,-1 2.5,-1" fill="rgb(220,0,20)"/><line x1="0" y1="4" x2="0" y2="-1" stroke="rgb(220,0,20)" strokeWidth="2" strokeLinecap="round"/></svg>
              {t.forecastMap.headwind}
            </span>
          </div>
        )}
      </div>

      {/* Map */}
      <MapView theme="light" center={[10, 48]} zoom={5} className="h-[450px] w-full rounded-xl lg:h-[550px]">
        <FitBounds coordinates={routeCoords} />
        <MapRoute id="forecast-route" coordinates={routeCoords} color="rgba(220,60,40,0.7)" width={3} opacity={0.85} />

        {dayTransitions.map((dt, i) => (
          <MapMarker key={`dt-${i}`} longitude={dt.lon} latitude={dt.lat}>
            <MarkerContent>
              <div className="rounded border border-slate-300 bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 shadow-sm whitespace-nowrap backdrop-blur-sm">
                {t.forecastMap.dayMarker(dt.relDay)}
              </div>
            </MarkerContent>
          </MapMarker>
        ))}

        {routeStops.map((s, i) => (
          <MapMarker key={`stop-${i}`} longitude={s.lon} latitude={s.lat}>
            <MarkerContent>
              <div
                className="flex size-7 cursor-pointer items-center justify-center rounded-full border-2 text-[9px] font-bold shadow-md"
                style={{ background: "#1e3a5f", borderColor: "#3b82f6", color: "#fff" }}
              >
                {s.relDay}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{t.forecastMap.dayMarker(s.relDay)}</p>
            </MarkerPopup>
          </MapMarker>
        ))}

        <ForecastMarkers
          points={points}
          data={data}
          miniElev={miniElev}
          currentHour={currentHour}
          dailyMode={dailyMode}
          desiredHigh={desiredHigh}
          desiredLow={desiredLow}
          buildPopupContent={buildPopupContent}
        />

        <MapControls position="bottom-right" showFullscreen />
      </MapView>

      {/* Elevation chart */}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-200"
        style={{ background: "#f8fafc" }}
        onMouseMove={onChartMouseMove}
        onMouseLeave={onChartMouseLeave}
      >
        <svg ref={svgRef} width="100%" height="180" style={{ display: "block" }} />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute hidden whitespace-nowrap rounded border px-2 py-1.5 text-[11px] leading-relaxed"
          style={{
            background: "rgba(255,255,255,0.96)",
            borderColor: "#93c5fd",
            color: "#1e293b",
            zIndex: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}
        />
      </div>
    </div>
  );
}
