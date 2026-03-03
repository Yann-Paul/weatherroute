import { useEffect, useMemo, useRef, useCallback, useState } from "react";
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
import { tempToRgb, dayToShortDE } from "@/utils/tempColor";
import { useLangStore } from "@/i18n/store";
import { useT } from "@/i18n/useT";
import type { MarkerData, WeatherStop, ElevationCityData } from "@/api/types";

// First day of each month (1-indexed, non-leap year)
const MONTH_START_DAYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function haversineDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function windArrowColor(wdir: number, routeBearing: number): string {
  let diff = Math.abs(((wdir - routeBearing) % 360 + 360) % 360);
  if (diff > 180) diff = 360 - diff;
  const t = diff / 180;
  return `rgb(${Math.round(220 * (1 - t))},${Math.round(180 * t)},20)`;
}

function routeBearingForMarker(markers: MarkerData[], idx: number): number | null {
  if (markers.length < 2) return null;
  if (idx < markers.length - 1)
    return geoBearing(markers[idx].lat, markers[idx].lon, markers[idx + 1].lat, markers[idx + 1].lon);
  return geoBearing(markers[idx - 1].lat, markers[idx - 1].lon, markers[idx].lat, markers[idx].lon);
}

function interpTempAtKm(
  km: number,
  ele: number,
  cityData: ElevationCityData[],
  weatherByCity: globalThis.Map<string, WeatherStop>,
  key: "tmax" | "tmin"
): number | null {
  if (cityData.length < 2) return null;
  let ci = cityData.findIndex((c) => c.km >= km);
  if (ci < 0) ci = cityData.length - 1;
  if (ci === 0) ci = 1;
  const c0 = cityData[ci - 1], c1 = cityData[ci];
  const t = c1.km > c0.km ? Math.max(0, Math.min(1, (km - c0.km) / (c1.km - c0.km))) : 0;
  const w0 = weatherByCity.get(c0.cityId)?.byOffset["0"];
  const w1 = weatherByCity.get(c1.cityId)?.byOffset["0"];
  if (!w0 || !w1 || w0[key] == null || w1[key] == null) return null;
  const prcp = (w0.prcp ?? 0) + t * ((w1.prcp ?? 0) - (w0.prcp ?? 0));
  const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
  const eleRef = c0.ele + t * (c1.ele - c0.ele);
  return (w0[key]! + t * (w1[key]! - w0[key]!)) - (ele - eleRef) * lapse;
}

// ─── Wind arrow SVG ───────────────────────────────────────────────────────────

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

// ─── FitBounds (must be inside <MapView>) ─────────────────────────────────────

function FitBounds({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0 || hasFit.current) return;
    hasFit.current = true;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 50 });
  }, [map, isLoaded, coordinates]);
  return null;
}

// ─── Zoom-aware city markers (must be inside <MapView>) ───────────────────────

function RouteMapMarkers({
  markers,
  startDay,
  desiredHigh,
  desiredLow,
  lang,
}: {
  markers: MarkerData[];
  startDay: number;
  desiredHigh: number;
  desiredLow: number;
  lang: "de" | "en";
}) {
  const { map, isLoaded } = useMap();
  const [zoom, setZoom] = useState(5);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);
    setZoom(map.getZoom());
    return () => { map.off("zoom", onZoom); };
  }, [map, isLoaded]);

  const step = zoom < 3.5 ? 6 : zoom < 4.5 ? 4 : zoom < 5.5 ? 2 : 1;
  const desiredAvg = (desiredHigh + desiredLow) / 2;
  const textShadow = "0 1px 3px rgba(0,0,0,0.65)";

  return (
    <>
      {markers.map((m, idx) => {
        if (idx !== 0 && idx !== markers.length - 1 && idx % step !== 0) return null;

        const bg = tempToRgb((m.tmax + m.tmin) / 2, desiredAvg);
        const calDay = ((startDay + m.relDay - 1 + 3650) % 365) + 1;
        const dateStr = dayToShortDE(calDay, lang);
        const bearing = routeBearingForMarker(markers, idx);

        return (
          <MapMarker key={m.id} longitude={m.lon} latitude={m.lat}>
            <MarkerContent>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  className="cursor-pointer rounded border px-1.5 py-0.5 text-center font-bold shadow-md whitespace-nowrap leading-tight"
                  style={{
                    background: bg,
                    borderColor: "rgba(255,255,255,0.25)",
                    fontSize: "10px",
                    minWidth: "52px",
                  }}
                >
                  <div style={{ fontSize: "8px", color: "rgba(255,255,255,0.85)", textShadow }}>
                    {m.cityName}
                  </div>
                  <div style={{ fontSize: "8px", color: "rgba(255,255,255,0.75)", textShadow }}>
                    {dateStr}
                  </div>
                  <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                    <span>
                      <span style={{ color: "#fde68a", textShadow }}>☀</span>
                      <span style={{ color: "#fff", textShadow }}>{Math.round(m.tmax)}°</span>
                    </span>
                    <span>
                      <span style={{ color: "#bfdbfe", textShadow }}>☽</span>
                      <span style={{ color: "#fff", textShadow }}>{Math.round(m.tmin)}°</span>
                    </span>
                  </div>
                  {m.prcp > 0.1 && (
                    <div style={{ fontSize: "9px" }}>
                      <span style={{ color: "#93c5fd", textShadow }}>☂</span>
                      <span style={{ color: "#fff", textShadow }}>{m.prcp.toFixed(1)}mm</span>
                    </div>
                  )}
                </div>
                {m.wspd > 0 && bearing != null && (
                  <WindArrow wdir={m.wdir} wspd={m.wspd} routeBearing={bearing} />
                )}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <p className="font-medium">{m.cityName}</p>
              <p className="text-xs text-muted-foreground">{dateStr} · {lang === "de" ? "Tag" : "Day"} {m.relDay}</p>
              <div className="mt-1 space-y-0.5 text-sm">
                <p>
                  <span className="text-orange-500">☀ {m.tmax}°</span>
                  {" / "}
                  <span className="text-blue-400">☽ {m.tmin}°</span>
                </p>
                {m.prcp > 0 && <p className="text-muted-foreground">☂ {m.prcp.toFixed(1)} mm</p>}
                {m.wspd > 0 && (
                  <p className="text-muted-foreground">☴ {Math.round(m.wspd)} km/h</p>
                )}
              </div>
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </>
  );
}

// ─── Map bounds → visible km range (drives MiniElevChart highlight) ──────────

function MapBoundsTracker() {
  const { map, isLoaded } = useMap();
  const segments = useResultsStore((s) => s.segments);
  const elevation = useResultsStore((s) => s.elevation);
  const setVisibleKmRange = useResultsStore((s) => s.setVisibleKmRange);

  const routePolyline = useMemo(() => {
    const pts: [number, number, number][] = [];
    let cumKm = 0;
    let prev: [number, number] | null = null;
    for (const seg of segments) {
      for (const [lon, lat] of seg.coordinates) {
        if (prev) cumKm += haversineDist(prev[0], prev[1], lon, lat);
        pts.push([cumKm, lon, lat]);
        prev = [lon, lat];
      }
    }
    return pts;
  }, [segments]);

  const polylineRef = useRef(routePolyline);
  polylineRef.current = routePolyline;
  const scaleRef = useRef(1);
  scaleRef.current = (() => {
    const totalSeg = routePolyline.length > 0 ? routePolyline[routePolyline.length - 1][0] : 0;
    const totalElev = elevation?.totalKm ?? totalSeg;
    return totalSeg > 0 && totalElev > 0 ? totalElev / totalSeg : 1;
  })();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const m = map;

    function update() {
      const rp = polylineRef.current;
      const scale = scaleRef.current;
      if (rp.length < 2) { setVisibleKmRange(null); return; }

      const bounds = m.getBounds();
      const vis = rp.filter(([, lon, lat]) => bounds.contains([lon, lat]));
      if (vis.length === 0) { setVisibleKmRange(null); return; }

      const minKm = vis[0][0] * scale;
      const maxKm = vis[vis.length - 1][0] * scale;
      const totalKm = rp[rp.length - 1][0] * scale;

      // No highlight when essentially the whole route is visible
      if (totalKm > 0 && (maxKm - minKm) / totalKm > 0.95) {
        setVisibleKmRange(null);
        return;
      }
      setVisibleKmRange([minKm, maxKm]);
    }

    map.on("moveend", update);
    update();
    return () => {
      map.off("moveend", update);
      setVisibleKmRange(null);
    };
  }, [map, isLoaded, setVisibleKmRange]);

  return null;
}

// ─── Hover dot on the map (synced with MiniElevChart) ────────────────────────

function HoverDotRM() {
  const hoveredKm = useResultsStore((s) => s.hoveredKm);
  const segments = useResultsStore((s) => s.segments);
  const elevation = useResultsStore((s) => s.elevation);

  // Build cumulative-km polyline from actual route coordinates
  const routePolyline = useMemo(() => {
    const pts: [number, number, number][] = []; // [cumKm, lon, lat]
    let cumKm = 0;
    let prev: [number, number] | null = null;
    for (const seg of segments) {
      for (const [lon, lat] of seg.coordinates) {
        if (prev) cumKm += haversineDist(prev[0], prev[1], lon, lat);
        pts.push([cumKm, lon, lat]);
        prev = [lon, lat];
      }
    }
    return pts;
  }, [segments]);

  if (hoveredKm == null || routePolyline.length < 2) return null;

  // Scale hoveredKm (from elevation profile) to match actual segment distances
  const totalSegKm = routePolyline[routePolyline.length - 1][0];
  const totalElevKm = elevation?.totalKm ?? totalSegKm;
  const scaledKm = totalSegKm > 0 && totalElevKm > 0 ? hoveredKm * (totalSegKm / totalElevKm) : hoveredKm;

  let ci = routePolyline.findIndex((p) => p[0] >= scaledKm);
  if (ci < 0) ci = routePolyline.length - 1;
  if (ci === 0) ci = 1;
  const p0 = routePolyline[ci - 1], p1 = routePolyline[ci];
  const span = p1[0] - p0[0];
  const t = span > 0 ? Math.max(0, Math.min(1, (scaledKm - p0[0]) / span)) : 0;
  const lon = p0[1] + t * (p1[1] - p0[1]);
  const lat = p0[2] + t * (p1[2] - p0[2]);

  return (
    <MapMarker longitude={lon} latitude={lat}>
      <MarkerContent>
        <div
          style={{
            width: 14, height: 14, borderRadius: "50%",
            background: "rgba(249,115,22,0.95)",
            border: "2.5px solid white",
            boxShadow: "0 0 0 5px rgba(249,115,22,0.35), 0 0 12px rgba(249,115,22,0.5)",
            pointerEvents: "none",
          }}
        />
      </MarkerContent>
    </MapMarker>
  );
}

// ─── Mini elevation chart below the map ───────────────────────────────────────

const LEGEND_GRADIENT =
  "linear-gradient(to right, rgb(60,0,80) 0%, rgb(30,30,160) 16.67%, rgb(100,160,255) 33.33%, rgb(255,255,255) 50%, rgb(255,150,100) 66.67%, rgb(200,40,40) 83.33%, rgb(160,0,120) 100%)";

function MiniElevChart() {
  const elevation = useResultsStore((s) => s.elevation);
  const weather = useResultsStore((s) => s.weather);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = useResultsStore((s) => s.desiredHigh);
  const setHoveredKm = useResultsStore((s) => s.setHoveredKm);
  const visibleKmRange = useResultsStore((s) => s.visibleKmRange);
  const lang = useLangStore((s) => s.lang);
  const t = useT();

  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);

  const weatherByCity = useMemo(() => {
    const m = new globalThis.Map<string, WeatherStop>();
    for (const s of weather) m.set(s.cityId, s);
    return m;
  }, [weather]);

  const weatherByCityRef = useRef(weatherByCity);
  weatherByCityRef.current = weatherByCity;

  const stateRef = useRef({ elevation, desiredHigh });
  stateRef.current = { elevation, desiredHigh };

  useEffect(() => {
    return () => { setHoveredKm(null); };
  }, [setHoveredKm]);

  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !elevation) return;

    const W = svg.parentElement?.offsetWidth || 700;
    const H = 200;
    const PL = 40, PR = 10, PT = 20, PB = 65;
    const cW = W - PL - PR, cH = H - PT - PB;
    const profile = elevation.points;
    const cityData = elevation.cityData ?? [];
    if (profile.length < 2) return;

    const stride = Math.max(1, Math.floor(profile.length / 600));
    const drawProfile: [number, number][] = profile.filter(
      (_, i) => i % stride === 0 || i === profile.length - 1
    );

    const dataKmMin = drawProfile[0][0], dataKmMax = drawProfile[drawProfile.length - 1][0];
    const kmMin = visibleKmRange ? Math.max(dataKmMin, visibleKmRange[0]) : dataKmMin;
    const kmMax = visibleKmRange ? Math.min(dataKmMax, visibleKmRange[1]) : dataKmMax;

    // Elevation range from the visible slice only (gives tighter y-axis when zoomed)
    const visSlice = drawProfile.filter(([km]) => km >= kmMin && km <= kmMax);
    const eles = (visSlice.length >= 2 ? visSlice : drawProfile).map((p) => p[1]);
    const eMin = Math.max(0, Math.min(...eles) - 60);
    const eMax = Math.max(...eles) + 40;
    const eRange = eMax - eMin || 1;

    chartStateRef.current = { drawProfile, cityData, kmMin, kmMax, eMin, eMax, eRange, PL, cW, PT, cH };

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (ele: number) => PT + cH - ((ele - eMin) / eRange) * cH;
    const axY = PT + cH;

    let out = `<defs><clipPath id="mc-clip"><rect x="${PL}" y="${PT}" width="${cW}" height="${cH}"/></clipPath></defs>`;
    out += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="#f9fafb" rx="2"/>`;

    const yTick = eMax <= 200 ? 50 : eMax <= 500 ? 100 : eMax <= 1000 ? 200 : eMax <= 2500 ? 500 : 1000;
    for (let e = Math.ceil(eMin / yTick) * yTick; e <= eMax; e += yTick) {
      const y = yp(e);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#94a3b8" font-family="sans-serif">${e}m</text>`;
    }

    out += `<g clip-path="url(#mc-clip)">`;
    for (let i = 0; i < drawProfile.length - 1; i++) {
      const [km0, e0] = drawProfile[i], [km1, e1] = drawProfile[i + 1];
      const midKm = (km0 + km1) / 2, midEle = (e0 + e1) / 2;
      const temp = interpTempAtKm(midKm, midEle, cityData, weatherByCity, "tmax");
      const col = temp !== null ? tempToRgb(temp, desiredHigh) : "#94a3b8";
      const x0 = xp(km0).toFixed(1), x1 = xp(km1).toFixed(1);
      const y0 = yp(e0).toFixed(1), y1 = yp(e1).toFixed(1), ay = axY.toFixed(1);
      out += `<polygon points="${x0},${y0} ${x1},${y1} ${x1},${ay} ${x0},${ay}" fill="${col}" stroke="${col}" stroke-width="0.3"/>`;
    }

    const pts = drawProfile.map(([km, e]) => `${xp(km).toFixed(1)},${yp(e).toFixed(1)}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="#475569" stroke-width="1.2"/>`;

    if (eMin <= 0) {
      const y0m = yp(0);
      out += `<line x1="${PL}" y1="${y0m.toFixed(1)}" x2="${PL + cW}" y2="${y0m.toFixed(1)}" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="4,3"/>`;
    }
    out += `</g>`;

    for (const cd of cityData) {
      if (cd.km < kmMin - 1 || cd.km > kmMax + 1) continue;
      const xv = xp(cd.km);
      let dotEle = cd.ele;
      const pidx = drawProfile.findIndex(([km]) => km >= cd.km);
      if (pidx > 0) {
        const [km0, e0] = drawProfile[pidx - 1], [km1, e1] = drawProfile[pidx];
        const tval = km1 > km0 ? (cd.km - km0) / (km1 - km0) : 0;
        dotEle = e0 + tval * (e1 - e0);
      }
      const dotY = yp(dotEle);
      const stop = weatherByCity.get(cd.cityId);
      const relDay = stop?.relDay ?? 0;
      const absDay = ((startDay + relDay - 1 + 3650) % 365) + 1;
      const dateStr = dayToShortDE(absDay, lang);
      const px = xv - 18, py = PT + 2;
      out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="36" height="13" rx="3" fill="white" opacity="0.9" stroke="#b0c4de" stroke-width="0.7"/>`;
      out += `<text x="${xv.toFixed(1)}" y="${(py + 9.5).toFixed(1)}" text-anchor="middle" font-size="8" fill="#1a2d45" font-weight="700" font-family="sans-serif">${dateStr}</text>`;
      out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="#4a6fa5" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
      out += `<circle cx="${xv.toFixed(1)}" cy="${dotY.toFixed(1)}" r="3.5" fill="#fff" stroke="#4a6fa5" stroke-width="1.8"/>`;
      const safe = cd.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      out += `<text font-size="9.5" fill="#1e2d45" font-weight="600" text-anchor="end" font-family="sans-serif" transform="rotate(-38,${xv.toFixed(1)},${(axY + 14).toFixed(1)}) translate(${xv.toFixed(1)},${(axY + 14).toFixed(1)})">${safe}</text>`;
    }

    out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line id="mc-cursor" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="#334155" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="mc-cursor-dot" cx="0" cy="0" r="3.5" fill="#f97316" stroke="white" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [elevation, desiredHigh, weatherByCity, startDay, lang, visibleKmRange]);

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

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < cs.PL || x > cs.PL + cs.cW) {
      tooltip.style.display = "none";
      svg.querySelector("#mc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#mc-cursor-dot")?.setAttribute("visibility", "hidden");
      setHoveredKm(null);
      return;
    }

    const km = cs.kmMin + ((x - cs.PL) / cs.cW) * (cs.kmMax - cs.kmMin);
    let best = cs.drawProfile[0], bestDist = Infinity;
    for (const p of cs.drawProfile) {
      const d = Math.abs(p[0] - km);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    const [bestKm, bestEle] = best;
    const cxFixed = cs.PL + ((km - cs.kmMin) / (cs.kmMax - cs.kmMin)) * cs.cW;
    const cy = cs.PT + cs.cH - ((bestEle - cs.eMin) / cs.eRange) * cs.cH;

    const cl = svg.querySelector("#mc-cursor");
    if (cl) { cl.setAttribute("x1", String(cxFixed)); cl.setAttribute("x2", String(cxFixed)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector("#mc-cursor-dot");
    if (cdot) { cdot.setAttribute("cx", String(cxFixed)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    const { desiredHigh } = stateRef.current;
    const temp = interpTempAtKm(bestKm, bestEle, cs.cityData, weatherByCityRef.current, "tmax");
    let ttHtml = `<div style="color:#64748b;font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:#1e293b">⛰ ${Math.round(bestEle)} m</div>`;
    if (temp != null) {
      ttHtml += `<div style="color:${tempToRgb(temp, desiredHigh)}">☀ ${temp.toFixed(1)}°C</div>`;
    }
    tooltip.innerHTML = ttHtml;
    tooltip.style.display = "block";
    const tw = tooltip.offsetWidth;
    const panelW = svg.parentElement?.offsetWidth ?? 700;
    let tx = x + 14;
    if (tx + tw + 4 > panelW) tx = x - tw - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.bottom = "26px";
    tooltip.style.top = "auto";

    setHoveredKm(km);
  }

  function onChartMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector("#mc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#mc-cursor-dot")?.setAttribute("visibility", "hidden");
    }
    setHoveredKm(null);
  }

  if (!elevation || !elevation.cityData?.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {t.routeMap.elevTitle}
      </p>
      <div className="relative w-full overflow-hidden" onMouseMove={onChartMouseMove} onMouseLeave={onChartMouseLeave}>
        <svg ref={svgRef} width="100%" style={{ display: "block" }} />
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
      <div className="mt-1 flex items-center gap-2 px-10 text-[9px] text-muted-foreground">
        <span>{t.routeMap.elevCold}</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: LEGEND_GRADIENT }} />
        <span>{t.routeMap.elevWarm}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RouteMap() {
  const segments = useResultsStore((s) => s.segments);
  const markers = useResultsStore((s) => s.markers);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = useResultsStore((s) => s.desiredHigh);
  const desiredLow = useResultsStore((s) => s.desiredLow);
  const lang = useLangStore((s) => s.lang);
  const t = useT();

  const allCoords = useMemo<[number, number][]>(() => [
    ...segments.flatMap((s) => s.coordinates),
    ...markers.map((m) => [m.lon, m.lat] as [number, number]),
  ], [segments, markers]);

  const monthNames = t.monthsShort;

  const monthLabels = useMemo(() => {
    const labels: { lat: number; lon: number; label: string }[] = [];
    for (let i = 0; i < markers.length - 1; i++) {
      const m0 = markers[i], m1 = markers[i + 1];
      const d0 = startDay + m0.relDay;
      const d1 = startDay + m1.relDay;
      if (d1 <= d0) continue;
      MONTH_START_DAYS.forEach((md, monthIdx) => {
        for (let yr = 0; yr <= 1; yr++) {
          const boundary = md + yr * 365;
          if (boundary > d0 && boundary <= d1) {
            const tval = (boundary - d0) / (d1 - d0);
            labels.push({
              lat: m0.lat + tval * (m1.lat - m0.lat),
              lon: m0.lon + tval * (m1.lon - m0.lon),
              label: monthNames[monthIdx],
            });
          }
        }
      });
    }
    return labels;
  }, [markers, startDay, monthNames]);

  return (
    <div className="space-y-3">
      <MapView theme="light" center={[10, 48]} zoom={5} className="h-[500px] w-full rounded-2xl lg:h-[600px]">
        <FitBounds coordinates={allCoords} />

        {segments.map((seg, i) => (
          <MapRoute
            key={i}
            id={`segment-${i}`}
            coordinates={seg.coordinates}
            color={seg.color}
            width={4}
            opacity={0.8}
            dashArray={seg.isDirect ? [4, 4] : undefined}
          />
        ))}

        {monthLabels.map((ml, i) => (
          <MapMarker key={`month-${i}`} longitude={ml.lon} latitude={ml.lat}>
            <MarkerContent>
              <div
                className="whitespace-nowrap rounded border-2 px-2 py-0.5 text-[11px] font-bold shadow-md"
                style={{ background: "rgba(46,204,113,0.95)", borderColor: "#27AE60", color: "#fff" }}
              >
                {ml.label}
              </div>
            </MarkerContent>
          </MapMarker>
        ))}

        <RouteMapMarkers
          markers={markers}
          startDay={startDay}
          desiredHigh={desiredHigh}
          desiredLow={desiredLow}
          lang={lang}
        />

        <HoverDotRM />
        <MapBoundsTracker />

        <MapControls position="bottom-right" showFullscreen />

      </MapView>

      <MiniElevChart />
    </div>
  );
}
