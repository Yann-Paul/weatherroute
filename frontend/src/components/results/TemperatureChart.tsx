import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Sun, Moon } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import { dayToShortDE } from "@/utils/tempColor";
import { useIsDark } from "@/stores/themeStore";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import type { WeatherStop, ElevationCityData, ForecastData } from "@/api/types";


// ─── Interpolation helpers (same as ElevationChart) ──────────────────────────

function interpTempAtKm(
  km: number,
  ele: number,
  cityData: ElevationCityData[],
  weatherByCity: globalThis.Map<string, WeatherStop>,
  offset: number,
  key: "tmax" | "tmin"
): number | null {
  if (cityData.length < 2) return null;
  let ci = cityData.findIndex((c) => c.km >= km);
  if (ci < 0) ci = cityData.length - 1;
  if (ci === 0) ci = 1;
  const c0 = cityData[ci - 1], c1 = cityData[ci];
  const t = c1.km > c0.km ? Math.max(0, Math.min(1, (km - c0.km) / (c1.km - c0.km))) : 0;
  const w0 = weatherByCity.get(c0.cityId)?.byOffset[String(offset)];
  const w1 = weatherByCity.get(c1.cityId)?.byOffset[String(offset)];
  if (!w0 || !w1 || w0[key] == null || w1[key] == null) return null;
  const prcp = (w0.prcp ?? 0) + t * ((w1.prcp ?? 0) - (w0.prcp ?? 0));
  const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
  const eleRef = c0.ele + t * (c1.ele - c0.ele);
  return (w0[key]! + t * (w1[key]! - w0[key]!)) - (ele - eleRef) * lapse;
}

function interpForecastByKey(
  km: number, ele: number, key: "tmax" | "tmin", forecast: ForecastData
): number | null {
  const { points, data } = forecast;
  if (!points.length || km < points[0].km || km > points[points.length - 1].km) return null;
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

function getForecastEndKm(forecast: ForecastData): number | null {
  let lastOkKm: number | null = null;
  for (let i = 0; i < forecast.points.length; i++) {
    if (forecast.data[String(i)]?.ok) lastOkKm = forecast.points[i].km;
  }
  return lastOkKm;
}

const SEGMENT_KM = 1000;

// ─── Single-segment temperature chart ────────────────────────────────────────

interface SegmentProps {
  segIndex: number;
  segPoints: [number, number][];
  segCitiesVisible: ElevationCityData[];
  segDayMarkersVisible: [number, number][];
  allCityData: ElevationCityData[];
  weatherByCityRef: React.MutableRefObject<globalThis.Map<string, WeatherStop>>;
  tempKey: "tmax" | "tmin";
  dayOffset: number;
  desiredHigh: number;
  desiredLow: number;
  startDay: number;
  lang: "de" | "en";
  forecast: ForecastData | null;
  globalTMin?: number;
  globalTMax?: number;
}

function TempSegment({
  segIndex, segPoints, segCitiesVisible, segDayMarkersVisible, allCityData,
  weatherByCityRef, tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang, forecast,
  globalTMin, globalTMax,
}: SegmentProps) {
  const isDark = useIsDark();
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const stateRef = useRef({ tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang, forecast });
  stateRef.current = { tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang, forecast };

  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || segPoints.length < 2) return;

    const root = document.documentElement;
    const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    const hsl = (name: string) => `hsl(${cssVar(name)})`;

    const colBg     = hsl("--muted");
    const colGrid   = hsl("--border");
    const colAxis   = hsl("--muted-foreground");
    const colLine   = hsl("--chart-line");
    const colDot    = hsl("--chart-1");
    const colText   = hsl("--foreground");
    const colCard   = hsl("--card");
    const colWarn   = hsl("--warn");
    const colCursor = hsl("--chart-cursor");

    chartStateRef.current = {
      ...chartStateRef.current,
      colAxisFallback: cssVar("--muted-foreground"),
      colTextResolved: cssVar("--foreground"),
    };

    const W = svg.parentElement?.offsetWidth || 700;
    const H = 280;
    const PL = 52, PR = 10, PT = 30, PB = 80;
    const cW = W - PL - PR, cH = H - PT - PB;

    const stride = Math.max(1, Math.floor(segPoints.length / 600));
    const drawProfile: [number, number][] = segPoints.filter(
      (_, i) => i % stride === 0 || i === segPoints.length - 1
    );

    const kmMin = drawProfile[0][0], kmMax = drawProfile[drawProfile.length - 1][0];
    const { tempKey: tk, dayOffset: off, forecast: fc } = stateRef.current;

    // Compute temperature at each profile point
    const tempValues: (number | null)[] = drawProfile.map(([km, ele]) => {
      const fcTemp = off === 0 && fc ? interpForecastByKey(km, ele, tk, fc) : null;
      return fcTemp ?? interpTempAtKm(km, ele, allCityData, weatherByCityRef.current, off, tk);
    });

    const validTemps = tempValues.filter((t): t is number => t !== null);
    const tMin = globalTMin ?? (validTemps.length > 0 ? Math.floor(Math.min(...validTemps)) - 3 : -5);
    const tMax = globalTMax ?? (validTemps.length > 0 ? Math.ceil(Math.max(...validTemps)) + 3 : 35);
    const tRange = tMax - tMin || 1;

    chartStateRef.current = {
      ...chartStateRef.current,
      drawProfile, kmMin, kmMax, tMin, tMax, tRange,
      PL, PR, PT, PB, cW, cH, H, W, tempValues,
    };

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (temp: number) => PT + cH - ((temp - tMin) / tRange) * cH;
    const axY = PT + cH;

    let out = `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${colBg}" rx="2"/>`;

    // Y-axis grid lines (temperature °C)
    const tempTick = tRange <= 6 ? 1 : tRange <= 15 ? 2 : tRange <= 30 ? 5 : 10;
    for (let tv = Math.ceil(tMin / tempTick) * tempTick; tv <= tMax; tv += tempTick) {
      const y = yp(tv);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${colGrid}" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${colAxis}" font-family="sans-serif">${tv}°C</text>`;
    }

    // 0°C reference line
    if (tMin < 0 && tMax > 0) {
      const y0 = yp(0);
      out += `<line x1="${PL}" y1="${y0.toFixed(1)}" x2="${PL + cW}" y2="${y0.toFixed(1)}" stroke="${colAxis}" stroke-width="1" stroke-dasharray="4,3"/>`;
    }

    // Forecast end boundary
    if (off === 0 && fc) {
      const endKm = getForecastEndKm(fc);
      if (endKm != null && endKm > kmMin && endKm < kmMax) {
        const xEnd = xp(endKm).toFixed(1);
        const forecastLabel = stateRef.current.lang === "de" ? "Vorhersage" : "Forecast";
        out += `<line x1="${xEnd}" y1="${PT}" x2="${xEnd}" y2="${axY}" stroke="${colWarn}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.9"/>`;
        out += `<rect x="${(parseFloat(xEnd) + 1).toFixed(1)}" y="${(PT + 1).toFixed(1)}" width="70" height="13" rx="2" fill="${colCard}" opacity="0.85"/>`;
        out += `<text x="${(parseFloat(xEnd) + 4).toFixed(1)}" y="${(PT + 11).toFixed(1)}" font-size="8.5" fill="${colWarn}" font-weight="600" font-family="sans-serif">☁ ${forecastLabel}</text>`;
      }
    }

    // Temperature line segments
    for (let i = 0; i < drawProfile.length - 1; i++) {
      const [km0] = drawProfile[i], [km1] = drawProfile[i + 1];
      const t0 = tempValues[i], t1 = tempValues[i + 1];
      if (t0 == null || t1 == null) continue;
      const x0 = xp(km0).toFixed(1), x1 = xp(km1).toFixed(1);
      const y0 = yp(t0).toFixed(1), y1 = yp(t1).toFixed(1);
      out += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${colLine}" stroke-width="2.5" stroke-linecap="round"/>`;
    }

    // Day markers
    const MIN_DM_PX = 32;
    let lastDmX = -Infinity;
    for (const [dmKm, dmRelDay] of segDayMarkersVisible) {
      if (dmKm < kmMin || dmKm > kmMax) continue;
      const xd = xp(dmKm);
      if (xd - lastDmX < MIN_DM_PX) continue;
      lastDmX = xd;
      const lbl = stateRef.current.lang === "de" ? `Tag ${Math.round(dmRelDay)}` : `Day ${Math.round(dmRelDay)}`;
      out += `<line x1="${xd.toFixed(1)}" y1="${PT}" x2="${xd.toFixed(1)}" y2="${axY}" stroke="${colAxis}" stroke-width="0.7" stroke-dasharray="2,3" opacity="0.5"/>`;
      out += `<text x="${(xd + 1.5).toFixed(1)}" y="${(PT + 8).toFixed(1)}" font-size="7" fill="${colAxis}" font-family="sans-serif" opacity="0.7">${lbl}</text>`;
    }

    // City markers
    for (const cd of segCitiesVisible) {
      const xv = xp(cd.km);
      const stop = weatherByCityRef.current.get(cd.cityId);
      const relDay = stop?.relDay ?? 0;
      const absDay = ((stateRef.current.startDay + Math.round(relDay) + off - 1 + 3650) % 365) + 1;
      const dateStr = dayToShortDE(absDay, lang);

      // Find temperature at city km for dot position
      let cityDotY = PT + cH / 2;
      const pidx = drawProfile.findIndex(([km]) => km >= cd.km);
      if (pidx > 0 && tempValues[pidx] != null) cityDotY = yp(tempValues[pidx]!);
      else if (pidx === 0 && tempValues[0] != null) cityDotY = yp(tempValues[0]!);

      const px = xv - 18, py = PT + 2;
      out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="36" height="13" rx="3" fill="${colCard}" opacity="0.9" stroke="${colDot}" stroke-width="0.7"/>`;
      out += `<text x="${xv.toFixed(1)}" y="${(py + 9.5).toFixed(1)}" text-anchor="middle" font-size="8" fill="${colText}" font-weight="700" font-family="sans-serif">${dateStr}</text>`;
      out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="${colDot}" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
      out += `<circle cx="${xv.toFixed(1)}" cy="${cityDotY.toFixed(1)}" r="3.5" fill="${colCard}" stroke="${colDot}" stroke-width="1.8"/>`;
      const safe = cd.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      out += `<text font-size="9.5" fill="${colText}" font-weight="600" text-anchor="end" font-family="sans-serif" transform="rotate(-38,${xv.toFixed(1)},${(axY + 14).toFixed(1)}) translate(${xv.toFixed(1)},${(axY + 14).toFixed(1)})">${safe}</text>`;
    }

    // Axis lines
    out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="${colAxis}" stroke-width="1"/>`;
    out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="${colAxis}" stroke-width="1"/>`;

    // X-axis km tick marks
    const kmSpan = kmMax - kmMin || 1;
    const rawStep = kmSpan / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    let xTickStep = mag * 10;
    for (const f of [1, 2, 5, 10]) { if (mag * f >= rawStep) { xTickStep = mag * f; break; } }
    for (let kmTick = Math.ceil(kmMin / xTickStep) * xTickStep; kmTick <= kmMax; kmTick += xTickStep) {
      const xtick = xp(kmTick);
      out += `<line x1="${xtick.toFixed(1)}" y1="${axY.toFixed(1)}" x2="${xtick.toFixed(1)}" y2="${(axY + 4).toFixed(1)}" stroke="${colAxis}" stroke-width="0.8"/>`;
      out += `<text x="${xtick.toFixed(1)}" y="${(axY + 15).toFixed(1)}" text-anchor="middle" font-size="8" fill="${colAxis}" font-family="sans-serif">${Math.round(kmTick)}</text>`;
    }
    out += `<text x="${(PL + cW - 1).toFixed(1)}" y="${(axY + 15).toFixed(1)}" text-anchor="end" font-size="7.5" fill="${colAxis}" font-family="sans-serif" opacity="0.7">km</text>`;

    const cursorId = `tc-cursor-${segIndex}`;
    const dotId = `tc-dot-${segIndex}`;
    out += `<line id="${cursorId}" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="${colCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="${dotId}" cx="0" cy="0" r="3" fill="${colCursor}" opacity="0.85" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [segPoints, segCitiesVisible, segDayMarkersVisible, allCityData, tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang, segIndex, forecast, globalTMin, globalTMax, isDark]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { tempKey: tk, dayOffset: off } = stateRef.current;
    const cs = chartStateRef.current;
    const svg = svgRef.current;
    const tooltip = tooltipRef.current;
    if (!cs || !svg || !tooltip) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cursorId = `tc-cursor-${segIndex}`;
    const dotId = `tc-dot-${segIndex}`;

    if (x < cs.PL || x > cs.PL + cs.cW) {
      tooltip.style.display = "none";
      svg.querySelector(`#${cursorId}`)?.setAttribute("visibility", "hidden");
      svg.querySelector(`#${dotId}`)?.setAttribute("visibility", "hidden");
      return;
    }

    const km = cs.kmMin + ((x - cs.PL) / cs.cW) * (cs.kmMax - cs.kmMin);
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < cs.drawProfile.length; i++) {
      const d = Math.abs(cs.drawProfile[i][0] - km);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const [bestKm, bestEle] = cs.drawProfile[bestIdx];
    const temp = cs.tempValues?.[bestIdx] as number | null | undefined;

    const cxFixed = cs.PL + ((km - cs.kmMin) / (cs.kmMax - cs.kmMin)) * cs.cW;
    const cy = temp != null
      ? cs.PT + cs.cH - ((temp - cs.tMin) / cs.tRange) * cs.cH
      : cs.PT + cs.cH / 2;

    const cl = svg.querySelector(`#${cursorId}`);
    if (cl) { cl.setAttribute("x1", String(cxFixed)); cl.setAttribute("x2", String(cxFixed)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector(`#${dotId}`);
    if (cdot) { cdot.setAttribute("cx", String(cxFixed)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    const colMuted = cs?.colAxisFallback ? `hsl(${cs.colAxisFallback})` : "hsl(var(--muted-foreground))";
    const colFg = cs?.colTextResolved ? `hsl(${cs.colTextResolved})` : "hsl(var(--foreground))";
    const { forecast: fc, lang: lg, startDay: sd } = stateRef.current;
    const fcTemp = off === 0 && fc ? interpForecastByKey(bestKm, bestEle, tk, fc) : null;

    let ttHtml = `<div style="color:${colMuted};font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:${colMuted};font-size:9px">⛰ ${Math.round(bestEle)} m</div>`;

    // Date
    if (allCityData.length > 0) {
      let ci = allCityData.findIndex((c) => c.km >= km);
      if (ci < 0) ci = allCityData.length - 1;
      let relDayAtKm: number | null = null;
      if (ci === 0) {
        relDayAtKm = weatherByCityRef.current.get(allCityData[0].cityId)?.relDay ?? null;
      } else {
        const c0 = allCityData[ci - 1], c1 = allCityData[ci];
        const tv = c1.km > c0.km ? Math.max(0, Math.min(1, (km - c0.km) / (c1.km - c0.km))) : 0;
        const w0 = weatherByCityRef.current.get(c0.cityId);
        const dep0 = (w0?.relDay ?? 0) + (w0?.restDays ?? 0);
        const r1 = weatherByCityRef.current.get(c1.cityId)?.relDay ?? 0;
        relDayAtKm = dep0 + tv * (r1 - dep0);
      }
      if (relDayAtKm != null) {
        const absDay = ((sd + Math.round(relDayAtKm) + off - 1 + 3650) % 365) + 1;
        ttHtml += `<div style="color:${colMuted};font-size:9px">${dayToShortDE(absDay, lg)}</div>`;
      }
    }

    if (temp != null) {
      const icon = fcTemp != null ? (tk === "tmax" ? "☁☀" : "☁☽") : (tk === "tmax" ? "☀" : "☽");
      ttHtml += `<div style="color:${colFg};font-size:13px;font-weight:600">${icon} ${temp.toFixed(1)}°C</div>`;
    } else {
      ttHtml += `<div style="color:${colMuted};font-size:9px">– kein Wert –</div>`;
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
  }

  function onMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector(`#tc-cursor-${segIndex}`)?.setAttribute("visibility", "hidden");
      svg.querySelector(`#tc-dot-${segIndex}`)?.setAttribute("visibility", "hidden");
    }
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border bg-card"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="280"
        style={{ display: "block" }}
        role="img"
        aria-label={`Temperature profile ${segPoints.length > 0 ? Math.round(segPoints[0][0]) : 0}–${segPoints.length > 0 ? Math.round(segPoints[segPoints.length - 1][0]) : 0} km`}
      />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute hidden whitespace-nowrap rounded border px-2 py-1.5 text-[11px] leading-relaxed"
        style={{
          background: "hsl(var(--card) / 0.96)",
          borderColor: "hsl(var(--chart-1))",
          color: "hsl(var(--foreground))",
          zIndex: 20,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TemperatureChart() {
  const elevation = useResultsStore((s) => s.elevation);
  const weather = useResultsStore((s) => s.weather);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = useResultsStore((s) => s.desiredHigh);
  const desiredLow = useResultsStore((s) => s.desiredLow);
  const forecast = useResultsStore((s) => s.forecast);
  const [tempKey, setTempKey] = useState<"tmax" | "tmin">("tmax");
  const [dayOffset, setDayOffset] = useState(0);

  const t = useT();
  const lang = useLangStore((s) => s.lang);

  const weatherByCity = useMemo(() => {
    const m = new globalThis.Map<string, WeatherStop>();
    for (const s of weather) m.set(s.cityId, s);
    return m;
  }, [weather]);

  const weatherByCityRef = useRef(weatherByCity);
  weatherByCityRef.current = weatherByCity;

  // Compute global tMin/tMax across all day offsets so Y-axis stays fixed while sliding
  const globalTempRange = useMemo(() => {
    if (!elevation || elevation.points.length < 2) return null;
    const allCityData = elevation.cityData ?? [];
    if (allCityData.length < 2) return null;
    const points = elevation.points;
    const stride = Math.max(1, Math.floor(points.length / 60));
    let tMin = Infinity, tMax = -Infinity;
    for (let off = -30; off <= 30; off++) {
      for (let i = 0; i < points.length; i += stride) {
        const [km, ele] = points[i];
        const temp = interpTempAtKm(km, ele, allCityData, weatherByCity, off, tempKey);
        if (temp != null) { tMin = Math.min(tMin, temp); tMax = Math.max(tMax, temp); }
      }
    }
    if (!isFinite(tMin) || !isFinite(tMax)) return null;
    return { tMin: Math.floor(tMin) - 3, tMax: Math.ceil(tMax) + 3 };
  }, [elevation, weatherByCity, tempKey]);

  const segments = useMemo(() => {
    if (!elevation || elevation.points.length < 2) return [];
    const points = elevation.points;
    const allCityData = elevation.cityData ?? [];
    const dayMarkers = elevation.dayMarkers ?? [];
    const totalKm = points[points.length - 1][0];
    const numSegments = Math.max(1, Math.ceil(totalKm / SEGMENT_KM));

    return Array.from({ length: numSegments }, (_, i) => {
      const kmStart = i * SEGMENT_KM;
      const kmEnd = (i + 1) * SEGMENT_KM;
      const filtered = points.filter(([km]) => km >= kmStart && km <= kmEnd);
      const beforeIdx = points.findIndex(([km]) => km >= kmStart);
      const lastBefore = beforeIdx > 0 ? points[beforeIdx - 1] : null;
      const segPoints: [number, number][] = lastBefore ? [lastBefore, ...filtered] : filtered;
      const segCitiesVisible = allCityData.filter((c) => c.km >= kmStart && c.km <= kmEnd);
      const segDayMarkersVisible = dayMarkers.filter(([km]) => km >= kmStart && km <= kmEnd);
      return { segPoints, segCitiesVisible, segDayMarkersVisible };
    });
  }, [elevation]);

  if (!elevation) return null;

  const allCityData = elevation.cityData ?? [];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(["tmax", "tmin"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTempKey(key)}
              className={[
                "border-r border-border px-3 py-1.5 text-xs font-medium last:border-r-0 transition-colors",
                tempKey === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {key === "tmax" ? (
                <><Sun className="mr-1 inline h-3 w-3" />{t.elevationChart.dayTemp(desiredHigh)}</>
              ) : (
                <><Moon className="mr-1 inline h-3 w-3" />{t.elevationChart.nightTemp(desiredLow)}</>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center gap-3 min-w-[200px]">
          <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
            {t.elevationChart.startDay(dayOffset)}
          </span>
          <Slider
            min={-30}
            max={30}
            step={1}
            value={[dayOffset]}
            onValueChange={([v]) => setDayOffset(v)}
            className="flex-1"
          />
        </div>

      </div>

      {/* Segment charts */}
      <div className="space-y-3">
        {segments.map((seg, i) => (
          <TempSegment
            key={i}
            segIndex={i}
            segPoints={seg.segPoints}
            segCitiesVisible={seg.segCitiesVisible}
            segDayMarkersVisible={seg.segDayMarkersVisible}
            allCityData={allCityData}
            weatherByCityRef={weatherByCityRef}
            tempKey={tempKey}
            dayOffset={dayOffset}
            desiredHigh={desiredHigh}
            desiredLow={desiredLow}
            startDay={startDay}
            lang={lang}
            forecast={forecast}
            globalTMin={globalTempRange?.tMin}
            globalTMax={globalTempRange?.tMax}
          />
        ))}
      </div>

    </div>
  );
}
