import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { TrendingUp, TrendingDown, Ruler } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import { tempToRgb, dayToShortDE } from "@/utils/tempColor";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import type { WeatherStop, ElevationCityData } from "@/api/types";

// ─── Lapse-rate-corrected temperature interpolation ──────────────────────────

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

const SEGMENT_KM = 1000;

// ─── Single-segment chart ─────────────────────────────────────────────────────

interface SegmentProps {
  segIndex: number;
  segPoints: [number, number][];
  segCitiesVisible: ElevationCityData[];
  allCityData: ElevationCityData[];
  weatherByCityRef: React.MutableRefObject<globalThis.Map<string, WeatherStop>>;
  tempKey: "tmax" | "tmin";
  dayOffset: number;
  desiredHigh: number;
  desiredLow: number;
  startDay: number;
  lang: "de" | "en";
}

function ElevationSegment({
  segIndex, segPoints, segCitiesVisible, allCityData,
  weatherByCityRef, tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang,
}: SegmentProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const stateRef = useRef({ tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang });
  stateRef.current = { tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang };

  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || segPoints.length < 2) return;

    const W = svg.parentElement?.offsetWidth || 700;
    const H = 280;
    const PL = 48, PR = 10, PT = 30, PB = 80;
    const cW = W - PL - PR, cH = H - PT - PB;

    const stride = Math.max(1, Math.floor(segPoints.length / 600));
    const drawProfile: [number, number][] = segPoints.filter(
      (_, i) => i % stride === 0 || i === segPoints.length - 1
    );

    const kmMin = drawProfile[0][0], kmMax = drawProfile[drawProfile.length - 1][0];
    const eles = drawProfile.map((p) => p[1]);
    const eMin = Math.max(0, Math.min(...eles) - 80);
    const eMax = Math.max(...eles) + 50;
    const eRange = eMax - eMin || 1;

    chartStateRef.current = {
      drawProfile, kmMin, kmMax, eMin, eMax, eRange,
      PL, PR, PT, PB, cW, cH, H, W,
    };

    const { tempKey: tk, dayOffset: off, desiredHigh: dh, desiredLow: dl } = stateRef.current;
    const desired = tk === "tmax" ? dh : dl;

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (ele: number) => PT + cH - ((ele - eMin) / eRange) * cH;
    const axY = PT + cH;

    let out = `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="#f9fafb" rx="2"/>`;

    const yTick = eMax <= 200 ? 50 : eMax <= 500 ? 100 : eMax <= 1000 ? 200 : eMax <= 2500 ? 500 : 1000;
    for (let e = Math.ceil(eMin / yTick) * yTick; e <= eMax; e += yTick) {
      const y = yp(e);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#94a3b8" font-family="sans-serif">${e}m</text>`;
    }

    for (let i = 0; i < drawProfile.length - 1; i++) {
      const [km0, e0] = drawProfile[i], [km1, e1] = drawProfile[i + 1];
      const midKm = (km0 + km1) / 2, midEle = (e0 + e1) / 2;
      const temp = interpTempAtKm(midKm, midEle, allCityData, weatherByCityRef.current, off, tk);
      const col = temp !== null ? tempToRgb(temp, desired) : "#94a3b8";
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

    for (const cd of segCitiesVisible) {
      const xv = xp(cd.km);
      let dotEle = cd.ele;
      const pidx = drawProfile.findIndex(([km]) => km >= cd.km);
      if (pidx > 0) {
        const [km0, e0] = drawProfile[pidx - 1], [km1, e1] = drawProfile[pidx];
        const tval = km1 > km0 ? (cd.km - km0) / (km1 - km0) : 0;
        dotEle = e0 + tval * (e1 - e0);
      }
      const dotY = yp(dotEle);

      const stop = weatherByCityRef.current.get(cd.cityId);
      const relDay = stop?.relDay ?? 0;
      const absDay = ((stateRef.current.startDay + relDay + off - 1 + 3650) % 365) + 1;
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
    out += `<text x="${(PL + cW / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="sans-serif">${Math.round(kmMin)}–${Math.round(kmMax)} km</text>`;

    const cursorId = `ec-cursor-${segIndex}`;
    const dotId = `ec-dot-${segIndex}`;
    out += `<line id="${cursorId}" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="#334155" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="${dotId}" cx="0" cy="0" r="3" fill="#334155" opacity="0.85" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [segPoints, segCitiesVisible, allCityData, tempKey, dayOffset, desiredHigh, desiredLow, startDay, lang, segIndex]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { tempKey: tk, dayOffset: off, desiredHigh: dh, desiredLow: dl } = stateRef.current;
    const cs = chartStateRef.current;
    const svg = svgRef.current;
    const tooltip = tooltipRef.current;
    if (!cs || !svg || !tooltip) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cursorId = `ec-cursor-${segIndex}`;
    const dotId = `ec-dot-${segIndex}`;

    if (x < cs.PL || x > cs.PL + cs.cW) {
      tooltip.style.display = "none";
      svg.querySelector(`#${cursorId}`)?.setAttribute("visibility", "hidden");
      svg.querySelector(`#${dotId}`)?.setAttribute("visibility", "hidden");
      return;
    }

    const km = cs.kmMin + ((x - cs.PL) / cs.cW) * (cs.kmMax - cs.kmMin);
    let best = cs.drawProfile[0];
    let bestDist = Infinity;
    for (const p of cs.drawProfile) {
      const d = Math.abs(p[0] - km);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    const [bestKm, bestEle] = best;

    const cxFixed = cs.PL + ((km - cs.kmMin) / (cs.kmMax - cs.kmMin)) * cs.cW;
    const cy = cs.PT + cs.cH - ((bestEle - cs.eMin) / cs.eRange) * cs.cH;

    const cl = svg.querySelector(`#${cursorId}`);
    if (cl) { cl.setAttribute("x1", String(cxFixed)); cl.setAttribute("x2", String(cxFixed)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector(`#${dotId}`);
    if (cdot) { cdot.setAttribute("cx", String(cxFixed)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    const desired = tk === "tmax" ? dh : dl;
    const temp = interpTempAtKm(bestKm, bestEle, allCityData, weatherByCityRef.current, off, tk);

    let ttHtml = `<div style="color:#64748b;font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:#1e293b">⛰ ${Math.round(bestEle)} m</div>`;
    if (temp != null) {
      ttHtml += `<div style="color:${tempToRgb(temp, desired)}">${tk === "tmax" ? "☀" : "☽"} ${temp.toFixed(1)}°C</div>`;
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
      svg.querySelector(`#ec-cursor-${segIndex}`)?.setAttribute("visibility", "hidden");
      svg.querySelector(`#ec-dot-${segIndex}`)?.setAttribute("visibility", "hidden");
    }
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-white"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <svg ref={svgRef} width="100%" height="280" style={{ display: "block" }} />
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
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ElevationChart() {
  const elevation = useResultsStore((s) => s.elevation);
  const weather = useResultsStore((s) => s.weather);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = useResultsStore((s) => s.desiredHigh);
  const desiredLow = useResultsStore((s) => s.desiredLow);

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

  const segments = useMemo(() => {
    if (!elevation || elevation.points.length < 2) return [];
    const points = elevation.points;
    const allCityData = elevation.cityData ?? [];
    const totalKm = points[points.length - 1][0];
    const numSegments = Math.max(1, Math.ceil(totalKm / SEGMENT_KM));

    return Array.from({ length: numSegments }, (_, i) => {
      const kmStart = i * SEGMENT_KM;
      const kmEnd = (i + 1) * SEGMENT_KM;

      const filtered = points.filter(([km]) => km >= kmStart && km <= kmEnd);
      // Include last point before segment start for visual continuity
      const beforeIdx = points.findIndex(([km]) => km >= kmStart);
      const lastBefore = beforeIdx > 0 ? points[beforeIdx - 1] : null;
      const segPoints: [number, number][] = lastBefore ? [lastBefore, ...filtered] : filtered;

      const segCitiesVisible = allCityData.filter((c) => c.km >= kmStart && c.km <= kmEnd);

      return { segPoints, segCitiesVisible };
    });
  }, [elevation]);

  if (!elevation) return null;

  const desired = tempKey === "tmax" ? desiredHigh : desiredLow;
  const allCityData = elevation.cityData ?? [];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          {(["tmax", "tmin"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTempKey(key)}
              className={[
                "border-r border-slate-200 px-3 py-1.5 text-xs font-medium last:border-r-0 transition-colors",
                tempKey === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {key === "tmax"
                ? t.elevationChart.dayTemp(desiredHigh)
                : t.elevationChart.nightTemp(desiredLow)}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center gap-3 min-w-[200px]">
          <span className="whitespace-nowrap text-xs font-medium text-slate-600">
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
          <ElevationSegment
            key={i}
            segIndex={i}
            segPoints={seg.segPoints}
            segCitiesVisible={seg.segCitiesVisible}
            allCityData={allCityData}
            weatherByCityRef={weatherByCityRef}
            tempKey={tempKey}
            dayOffset={dayOffset}
            desiredHigh={desiredHigh}
            desiredLow={desiredLow}
            startDay={startDay}
            lang={lang}
          />
        ))}
      </div>

      {/* Temperature legend */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2">
        <span className="whitespace-nowrap text-[10px] text-slate-500">{desired - 15}°C</span>
        <svg className="flex-1" height="14">
          <defs>
            <linearGradient id="ec-tg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"    stopColor="rgb(60,0,80)" />
              <stop offset="16.7%" stopColor="rgb(30,30,160)" />
              <stop offset="33.3%" stopColor="rgb(100,160,255)" />
              <stop offset="50%"   stopColor="rgb(255,255,255)" />
              <stop offset="66.7%" stopColor="rgb(255,150,100)" />
              <stop offset="83.3%" stopColor="rgb(200,40,40)" />
              <stop offset="100%"  stopColor="rgb(160,0,120)" />
            </linearGradient>
          </defs>
          <rect x="0" y="2" width="100%" height="10" fill="url(#ec-tg)" rx="3" />
        </svg>
        <span className="whitespace-nowrap text-[10px] font-bold text-slate-700">
          {desired}°C ✓
        </span>
        <span className="whitespace-nowrap text-[10px] text-slate-500">{desired + 15}°C</span>
      </div>

      {/* Stats card */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t.elevationChart.totalLabel}</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalKm)} /> km
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-good" />
            <span className="text-sm text-muted-foreground">{t.elevationChart.ascentLabel}</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalAscent)} /> m
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-bad" />
            <span className="text-sm text-muted-foreground">{t.elevationChart.descentLabel}</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalDescent)} /> m
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
