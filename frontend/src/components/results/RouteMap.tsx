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
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0) return;
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

// ─── Mini elevation chart below the map ───────────────────────────────────────

const LEGEND_GRADIENT =
  "linear-gradient(to right, rgb(60,0,80) 0%, rgb(30,30,160) 16.67%, rgb(100,160,255) 33.33%, rgb(255,255,255) 50%, rgb(255,150,100) 66.67%, rgb(200,40,40) 83.33%, rgb(160,0,120) 100%)";

function MiniElevChart() {
  const elevation = useResultsStore((s) => s.elevation);
  const weather = useResultsStore((s) => s.weather);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = useResultsStore((s) => s.desiredHigh);
  const lang = useLangStore((s) => s.lang);
  const t = useT();

  const svgRef = useRef<SVGSVGElement>(null);

  const weatherByCity = useMemo(() => {
    const m = new globalThis.Map<string, WeatherStop>();
    for (const s of weather) m.set(s.cityId, s);
    return m;
  }, [weather]);

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

    const kmMin = drawProfile[0][0], kmMax = drawProfile[drawProfile.length - 1][0];
    const eles = drawProfile.map((p) => p[1]);
    const eMin = Math.max(0, Math.min(...eles) - 80);
    const eMax = Math.max(...eles) + 50;
    const eRange = eMax - eMin || 1;

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

    for (const cd of cityData) {
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

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [elevation, desiredHigh, weatherByCity, startDay, lang]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  if (!elevation || !elevation.cityData?.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {t.routeMap.elevTitle}
      </p>
      <div className="relative w-full overflow-hidden">
        <svg ref={svgRef} width="100%" style={{ display: "block" }} />
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

  const allCoords: [number, number][] = [
    ...segments.flatMap((s) => s.coordinates),
    ...markers.map((m) => [m.lon, m.lat] as [number, number]),
  ];

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

        <MapControls position="bottom-right" showFullscreen />

        {/* Legend */}
        <div className="absolute left-3 top-3 z-10 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 text-xs shadow-md backdrop-blur-sm">
          <p className="mb-2 font-medium text-muted-foreground">{t.routeMap.legendTitle}</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-1 w-5 rounded-full bg-good" />
              <span>{t.routeMap.legendGood}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-5 rounded-full bg-warn" />
              <span>{t.routeMap.legendModerate}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-5 rounded-full bg-bad" />
              <span>{t.routeMap.legendPoor}</span>
            </div>
            <div className="flex items-center gap-2">
              <svg width="20" height="4" className="overflow-visible">
                <line x1="0" y1="2" x2="20" y2="2" strokeWidth="2" strokeDasharray="4 3" className="stroke-muted-foreground" />
              </svg>
              <span className="text-muted-foreground">{t.routeMap.legendDirect}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 rounded border-2 px-1 text-[9px] font-bold text-white"
                style={{ background: "rgba(46,204,113,0.95)", borderColor: "#27AE60" }}>
                {monthNames[2]}
              </div>
              <span className="text-muted-foreground">{t.routeMap.legendMonth}</span>
            </div>
          </div>
        </div>
      </MapView>

      <MiniElevChart />
    </div>
  );
}
