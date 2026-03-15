import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsDark } from "@/stores/themeStore";
import { Sun, Moon, CloudRain, Cloud, Wind, ChevronDown, ChevronUp } from "lucide-react";
import maplibregl from "maplibre-gl";
import {
  Map as MapView,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MapRoute,
  useMap,
} from "@/components/ui/map";
import type { ElevationProfile, GpxDayConfig, GpxJobResults, GpxNightHour, GpxWeatherPoint } from "@/api/types";
import { tempToRgb } from "@/utils/tempColor";
import { windDegreesToDirection } from "@/utils/constants";
import { useT } from "@/i18n/useT";

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function windArrowColor(wdir: number, routeBearing: number): string {
  let diff = Math.abs(((wdir - routeBearing) % 360 + 360) % 360);
  if (diff > 180) diff = 360 - diff;
  const t = diff / 180;
  return `rgb(${Math.round(220 * (1 - t))},${Math.round(180 * t)},20)`;
}

function findNearestTrackIdx(
  trackPoints: [number, number][],
  lat: number,
  lon: number
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < trackPoints.length; i++) {
    const dlat = trackPoints[i][0] - lat;
    const dlon = trackPoints[i][1] - lon;
    const d = dlat * dlat + dlon * dlon;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// ─── Arrival time from km ─────────────────────────────────────────────────────

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

// ─── Temperature interpolation with lapse-rate correction ─────────────────────

const DESIRED_TEMP = 20;

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

function interpTempForGpx(
  km: number,
  ele: number,
  weatherPoints: GpxWeatherPoint[]
): number | null {
  const pts = weatherPoints.filter((wp) => wp.temp != null);
  if (pts.length === 0) return null;
  if (pts.length === 1) {
    const lapse = (1 - 0.4 * Math.min(1, (pts[0].prcp ?? 0) / 5)) / 100;
    return pts[0].temp! - (ele - pts[0].ele) * lapse;
  }
  let upper = pts.findIndex((wp) => wp.km >= km);
  if (upper < 0) upper = pts.length - 1;
  if (upper === 0) upper = 1;
  const wp0 = pts[upper - 1], wp1 = pts[upper];
  const span = wp1.km - wp0.km;
  const t = span > 0 ? Math.max(0, Math.min(1, (km - wp0.km) / span)) : 0;
  const interpTemp = wp0.temp! + t * (wp1.temp! - wp0.temp!);
  const interpEle = wp0.ele + t * (wp1.ele - wp0.ele);
  const prcp = (wp0.prcp ?? 0) + t * ((wp1.prcp ?? 0) - (wp0.prcp ?? 0));
  const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
  return interpTemp - (ele - interpEle) * lapse;
}

// ─── FitTrack ─────────────────────────────────────────────────────────────────

function FitTrack({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0 || hasFit.current) return;
    hasFit.current = true;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });
  }, [map, isLoaded, coordinates]);
  return null;
}

// ─── GpxBoundsTracker (inside MapView) ────────────────────────────────────────

function GpxBoundsTracker({
  trackPolyline,
  totalKm,
  onRangeChange,
}: {
  trackPolyline: [number, number, number][]; // [cumKm, lat, lon]
  totalKm: number;
  onRangeChange: (range: [number, number] | null) => void;
}) {
  const { map, isLoaded } = useMap();
  const polyRef = useRef(trackPolyline);
  polyRef.current = trackPolyline;
  const cbRef = useRef(onRangeChange);
  cbRef.current = onRangeChange;
  const totalRef = useRef(totalKm);
  totalRef.current = totalKm;

  useEffect(() => {
    if (!map || !isLoaded) return;
    const m = map;
    function update() {
      const rp = polyRef.current;
      const total = totalRef.current;
      if (rp.length < 2) { cbRef.current(null); return; }
      const bounds = m.getBounds();
      const vis = rp.filter(([, lat, lon]) => bounds.contains([lon, lat]));
      if (vis.length === 0) { cbRef.current(null); return; }
      const minKm = vis[0][0];
      const maxKm = vis[vis.length - 1][0];
      if (total > 0 && (maxKm - minKm) / total > 0.95) { cbRef.current(null); return; }
      cbRef.current([minKm, maxKm]);
    }
    m.on("moveend", update);
    update();
    return () => {
      m.off("moveend", update);
      cbRef.current(null);
    };
  }, [map, isLoaded]);

  return null;
}

// ─── GpxHoverDot (inside MapView) ─────────────────────────────────────────────

function GpxHoverDot({
  hoveredKm,
  trackPolyline,
}: {
  hoveredKm: number | null;
  trackPolyline: [number, number, number][];
}) {
  if (hoveredKm == null || trackPolyline.length < 2) return null;
  let ci = trackPolyline.findIndex((p) => p[0] >= hoveredKm);
  if (ci < 0) ci = trackPolyline.length - 1;
  if (ci === 0) ci = 1;
  const p0 = trackPolyline[ci - 1], p1 = trackPolyline[ci];
  const span = p1[0] - p0[0];
  const t = span > 0 ? Math.max(0, Math.min(1, (hoveredKm - p0[0]) / span)) : 0;
  const lat = p0[1] + t * (p1[1] - p0[1]);
  const lon = p0[2] + t * (p1[2] - p0[2]);
  return (
    <MapMarker longitude={lon} latitude={lat}>
      <MarkerContent>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
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

// ─── Wind arrow ───────────────────────────────────────────────────────────────

function WindArrow({
  wdir,
  wspd,
  routeBearing,
}: {
  wdir: number;
  wspd: number;
  routeBearing: number;
}) {
  const blowsTo = (wdir + 180) % 360;
  const color = windArrowColor(wdir, routeBearing);
  const size = Math.max(14, Math.min(36, 14 + wspd * 0.44));
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "2px" }}>
      <svg
        width={size}
        height={size}
        viewBox="-9 -9 18 18"
        style={{ transform: `rotate(${blowsTo}deg)`, display: "block" }}
      >
        <line x1="0" y1="6" x2="0" y2="-3" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="0,-9 -3.5,-2 3.5,-2" fill={color} />
      </svg>
    </div>
  );
}

// ─── Weather icon ─────────────────────────────────────────────────────────────

type WxType = "rain" | "cloud" | "sun";

function wxIcon(prcp: number | null, cloud: number | null): { type: WxType; color: string } {
  if (prcp != null && prcp >= 0.3) return { type: "rain", color: "#93c5fd" };
  if (cloud != null) {
    if (cloud >= 60) return { type: "cloud", color: "#94a3b8" };
    return { type: "sun", color: "#fde68a" };
  }
  if (prcp != null && prcp >= 0.05) return { type: "cloud", color: "#94a3b8" };
  return { type: "sun", color: "#fde68a" };
}

function WxSymIcon({ type, color, size = 12 }: { type: WxType; color: string; size?: number }) {
  const style = { width: size, height: size, color, flexShrink: 0 } as React.CSSProperties;
  if (type === "rain") return <CloudRain style={style} />;
  if (type === "cloud") return <Cloud style={style} />;
  return <Sun style={style} />;
}

// ─── GpxMarkers (inside MapView) ──────────────────────────────────────────────

function GpxMarkers({
  weatherPoints,
  trackPoints,
}: {
  weatherPoints: GpxWeatherPoint[];
  trackPoints: [number, number][];
}) {
  const { map, isLoaded } = useMap();
  const [zoom, setZoom] = useState(8);
  const t = useT();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);
    setZoom(map.getZoom());
    return () => { map.off("zoom", onZoom); };
  }, [map, isLoaded]);

  const bearings = useMemo(
    () =>
      weatherPoints.map((pt) => {
        const nearestIdx = findNearestTrackIdx(trackPoints, pt.lat, pt.lon);
        const i = Math.min(nearestIdx, trackPoints.length - 2);
        const [lat1, lon1] = trackPoints[i];
        const [lat2, lon2] = trackPoints[i + 1];
        return geoBearing(lat1, lon1, lat2, lon2);
      }),
    [weatherPoints, trackPoints]
  );

  // Stride = how many 10-km regular slots to skip between shown points.
  // stride 1 → every 10 km, stride 2 → every 20 km, stride 4 → every 40 km …
  const boxStride =
    zoom >= 11 ? 1 :
    zoom >= 9  ? 2 :
    zoom >= 7  ? 4 :
    zoom >= 5  ? 8 :
    0; // only start/end/pass visible

  // Arrows follow a tighter stride (half of box stride, min 1).
  const arrowStride =
    zoom >= 10 ? 1 :
    zoom >= 8  ? 2 :
    zoom >= 6  ? 4 :
    zoom >= 4  ? 8 :
    0;

  const textShadow = "0 1px 3px rgba(0,0,0,0.65)";

  return (
    <>
      {weatherPoints.map((pt, idx) => {
        const isStop = pt.type === "stop";
        const hasWind = pt.wspd != null && pt.wspd > 0 && pt.wdir != null;
        const showBox   = showAtStride(pt, boxStride);
        const showArrow = hasWind && showAtStride(pt, arrowStride) && !isStop;

        if (!showBox && !showArrow) return null;

        const bearing = bearings[idx];
        const hasTemp = pt.temp != null;
        const bg = hasTemp ? tempToRgb(pt.temp!, DESIRED_TEMP) : "#475569";
        const wx = wxIcon(pt.prcp, pt.cloud);
        const arrival = new Date(pt.arrivalTime).toLocaleString(undefined, {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <MapMarker key={idx} longitude={pt.lon} latitude={pt.lat}>
            <MarkerContent>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                {showBox && (
                  isStop ? (
                    // Stop/camp marker: ForecastMap daily-style with purple border
                    <div
                      className="cursor-pointer rounded border text-center shadow-md whitespace-nowrap leading-tight"
                      style={{
                        background: hasTemp ? tempToRgb(pt.temp!, DESIRED_TEMP) : "#475569",
                        borderColor: "#7c3aed",
                        borderWidth: "2px",
                        fontSize: "10px",
                        padding: "3px 6px",
                      }}
                    >
                      <div style={{ color: "#e9d5ff", fontSize: "8px", fontWeight: "bold", textShadow }}>
                        {t.gpx.night} {pt.dayNumber}
                      </div>
                      <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                        {hasTemp && (
                          <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                            <WxSymIcon type={wx.type} color={wx.color} size={10} />
                            <span style={{ color: "#fff", textShadow, fontWeight: "bold" }}>{Math.round(pt.temp!)}°</span>
                          </span>
                        )}
                        {pt.nightLow != null && (
                          <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                            <Moon style={{ width: 10, height: 10, color: "#bfdbfe", flexShrink: 0 }} />
                            <span style={{ color: "#c4b5fd", textShadow }}>{Math.round(pt.nightLow)}°</span>
                          </span>
                        )}
                        {!hasTemp && <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "8px" }}>—</span>}
                      </div>
                    </div>
                  ) : (
                    // Regular marker: ForecastMap hourly-style (icon inline with temp)
                    <div
                      className="cursor-pointer rounded border px-1.5 py-0.5 text-center font-bold shadow-md whitespace-nowrap leading-tight"
                      style={{
                        background: bg,
                        borderColor: "rgba(255,255,255,0.25)",
                        fontSize: "10px",
                        minWidth: "42px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                        <WxSymIcon type={wx.type} color={wx.color} size={10} />
                        <span style={{ color: "#fff", textShadow }}>
                          {hasTemp ? `${Math.round(pt.temp!)}°` : "?"}
                        </span>
                      </div>
                      {pt.prcp != null && pt.prcp > 0.3 && (
                        <div style={{ fontSize: "9px", display: "flex", alignItems: "center", justifyContent: "center", gap: "1px" }}>
                          <CloudRain style={{ width: 9, height: 9, color: "#93c5fd", flexShrink: 0 }} />
                          <span style={{ color: "#fff", textShadow }}>{pt.prcp.toFixed(1)} mm</span>
                        </div>
                      )}
                    </div>
                  )
                )}
                {showArrow && (
                  <WindArrow wdir={pt.wdir!} wspd={pt.wspd!} routeBearing={bearing} />
                )}
              </div>
            </MarkerContent>
            <MarkerPopup>
              {isStop ? (
                <div className="min-w-[180px] space-y-1 text-xs">
                  <div className="font-semibold">{t.gpx.night} {pt.dayNumber} · {Math.round(pt.km)} km · {Math.round(pt.ele)} m</div>
                  <div className="text-muted-foreground">{arrival}</div>
                  {pt.temp != null && (
                    <div className="flex items-center gap-1"><WxSymIcon type={wx.type} color={wx.color} size={12} />{pt.temp.toFixed(1)}°C</div>
                  )}
                  {pt.nightData && pt.nightData.length > 0 && (
                    <>
                      <div className="font-semibold pt-1">{t.gpx.results.nightTable}</div>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left pr-2 font-normal">Zeit</th>
                            <th className="text-right pr-2 font-normal">°C</th>
                            <th className="text-right pr-2 font-normal">mm</th>
                            <th className="text-right font-normal">km/h</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pt.nightData.map((row: GpxNightHour, ri: number) => (
                            <tr key={ri} className={ri % 2 === 0 ? "bg-muted/30" : ""}>
                              <td className="pr-2">{row.hour}</td>
                              <td className="text-right pr-2">{row.temp != null ? Math.round(row.temp) : "—"}</td>
                              <td className="text-right pr-2">{row.prcp != null ? row.prcp.toFixed(1) : "—"}</td>
                              <td className="text-right">{row.wspd != null ? Math.round(row.wspd) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {pt.nextStartTime && (
                        <div className="text-muted-foreground pt-0.5">
                          {t.gpx.results.nextStart}: {new Date(pt.nextStartTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="min-w-[130px] space-y-0.5 text-xs">
                  <div className="font-semibold">{Math.round(pt.km)} km · {Math.round(pt.ele)} m</div>
                  <div className="text-muted-foreground">{arrival}</div>
                  {pt.temp != null && (
                    <div className="flex items-center gap-1 font-semibold">
                      <WxSymIcon type={wx.type} color={wx.color} size={12} />{pt.temp.toFixed(1)}°C
                      {pt.cloud != null && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          {pt.cloud}% Wolken
                        </span>
                      )}
                    </div>
                  )}
                  {pt.prcp != null && (
                    <div className="flex items-center gap-1 text-muted-foreground"><CloudRain className="h-3.5 w-3.5" />{pt.prcp.toFixed(1)} mm</div>
                  )}
                  {pt.wspd != null && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Wind className="h-3.5 w-3.5" />{Math.round(pt.wspd)} km/h{pt.wdir != null ? ` · ${windDegreesToDirection(pt.wdir)}` : ""}
                    </div>
                  )}
                </div>
              )}
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </>
  );
}

// ─── GpxMiniElevChart (below map) ─────────────────────────────────────────────

/**
 * Stride-based visibility check for regularly-spaced weather points.
 *
 * The backend now places 'regular' points at exactly every 10 km, so
 * Math.round(pt.km / 10) gives a clean integer index.  Showing every
 * stride-th index produces perfectly uniform thinning at any zoom level –
 * no clustering, no gaps larger than stride × 10 km.
 *
 * 'pass' points (highest elevation in each 50 km block) are shown when
 * stride ≤ 4 (zoom ≥ 7).  'start' and 'end' are always visible.
 */
function showAtStride(pt: GpxWeatherPoint, stride: number): boolean {
  if (pt.type === "start" || pt.type === "end" || pt.type === "stop") return true;
  if (pt.type === "pass" || pt.type === "valley") return stride <= 4;
  if (stride === 0) return false;
  return Math.round(pt.km / 10) % stride === 0;
}

const LEGEND_GRADIENT =
  "linear-gradient(to right, rgb(60,0,80) 0%, rgb(30,30,160) 16.67%, rgb(100,160,255) 33.33%, rgb(255,255,255) 50%, rgb(255,150,100) 66.67%, rgb(200,40,40) 83.33%, rgb(160,0,120) 100%)";

function markerColorSvg(type: GpxWeatherPoint["type"]): string {
  if (type === "stop") return "#7c3aed";
  if (type === "pass") return "#f97316";
  if (type === "valley") return "#3b82f6";
  if (type === "start") return "#22c55e";
  return "#6b7280";
}

function GpxMiniElevChart({
  elevation,
  weatherPoints,
  visibleKmRange,
  onHover,
  dailyConfigs,
  startDate,
}: {
  elevation: ElevationProfile;
  weatherPoints: GpxWeatherPoint[];
  visibleKmRange: [number, number] | null;
  onHover: (km: number | null) => void;
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const t = useT();
  const isDark = useIsDark();
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const wpRef = useRef(weatherPoints);
  wpRef.current = weatherPoints;

  const drawChart = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const hsl = (v: string) => `hsl(${cs.getPropertyValue(v).trim()})`;
    const clrBg = hsl("--card");
    const clrGrid = hsl("--border");
    const clrMuted = hsl("--muted-foreground");
    const clrAxis = hsl("--chart-line");
    const clrLine = hsl("--chart-line");
    const clrCursor = hsl("--chart-cursor");

    const svg = svgRef.current;
    if (!svg || !elevation) return;

    const W = svg.parentElement?.offsetWidth || 700;
    const H = 200;
    const PL = 40, PR = 10, PT = 20, PB = 50;
    const cW = W - PL - PR, cH = H - PT - PB;
    const profile = elevation.points;
    if (profile.length < 2 || cW <= 0 || cH <= 0) return;

    const stride = Math.max(1, Math.floor(profile.length / 600));
    const drawProfile: [number, number][] = profile.filter(
      (_, i) => i % stride === 0 || i === profile.length - 1
    );

    const dataKmMin = drawProfile[0][0], dataKmMax = drawProfile[drawProfile.length - 1][0];
    const kmMin = visibleKmRange ? Math.max(dataKmMin, visibleKmRange[0]) : dataKmMin;
    const kmMax = visibleKmRange ? Math.min(dataKmMax, visibleKmRange[1]) : dataKmMax;

    const visSlice = drawProfile.filter(([km]) => km >= kmMin && km <= kmMax);
    const eles = (visSlice.length >= 2 ? visSlice : drawProfile).map((p) => p[1]);
    const eMin = Math.max(0, Math.min(...eles) - 60);
    const eMax = Math.max(...eles) + 40;
    const eRange = eMax - eMin || 1;

    chartStateRef.current = { drawProfile, kmMin, kmMax, eMin, eMax, eRange, PL, cW, PT, cH };

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (ele: number) => PT + cH - ((ele - eMin) / eRange) * cH;
    const axY = PT + cH;

    let out = `<defs><clipPath id="gpx-mc-clip"><rect x="${PL}" y="${PT}" width="${cW}" height="${cH}"/></clipPath></defs>`;
    out += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${clrBg}" rx="2"/>`;

    // Y-axis grid + labels
    const yTick = eMax <= 200 ? 50 : eMax <= 500 ? 100 : eMax <= 1000 ? 200 : eMax <= 2500 ? 500 : 1000;
    for (let e = Math.ceil(eMin / yTick) * yTick; e <= eMax; e += yTick) {
      const y = yp(e);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${clrGrid}" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${e}m</text>`;
    }

    // Temperature-colored fill (with lapse-rate interpolation)
    out += `<g clip-path="url(#gpx-mc-clip)">`;
    const wps = wpRef.current;
    for (let i = 0; i < drawProfile.length - 1; i++) {
      const [km0, e0] = drawProfile[i], [km1, e1] = drawProfile[i + 1];
      const midKm = (km0 + km1) / 2, midEle = (e0 + e1) / 2;
      const temp = interpTempForGpx(midKm, midEle, wps);
      const col = temp !== null ? tempToRgb(temp, DESIRED_TEMP) : "#94a3b8";
      const x0 = xp(km0).toFixed(1), x1 = xp(km1).toFixed(1);
      const y0 = yp(e0).toFixed(1), y1 = yp(e1).toFixed(1), ay = axY.toFixed(1);
      out += `<polygon points="${x0},${y0} ${x1},${y1} ${x1},${ay} ${x0},${ay}" fill="${col}" stroke="${col}" stroke-width="0.3"/>`;
    }
    const pts = drawProfile.map(([km, e]) => `${xp(km).toFixed(1)},${yp(e).toFixed(1)}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="${clrLine}" stroke-width="1.2"/>`;
    out += `</g>`;

    // Weather point markers for passes/valleys/start/end/stop
    for (const wp of weatherPoints) {
      if (wp.km < kmMin - 1 || wp.km > kmMax + 1 || wp.type === "regular") continue;
      const xv = xp(wp.km);
      const color = markerColorSvg(wp.type);

      if (wp.type === "stop") {
        // Thicker dashed line for day-change camp
        out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="${color}" stroke-width="2" stroke-dasharray="5,3" opacity="0.85"/>`;
        // "N{N}" label above the chart
        out += `<text x="${xv.toFixed(1)}" y="${(PT - 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${color}" font-family="sans-serif" font-weight="bold">N${wp.dayNumber ?? ""}</text>`;
        // Night low below x-axis
        if (wp.nightLow != null) {
          out += `<text x="${xv.toFixed(1)}" y="${(axY + 24).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="${color}" font-family="sans-serif">☽${Math.round(wp.nightLow)}°</text>`;
        }
        // Pause time range below night low
        if (wp.stopTime && wp.nextStartTime) {
          const pauseLabel = wp.stopTime.slice(11, 16) + "–" + wp.nextStartTime.slice(11, 16);
          out += `<text x="${xv.toFixed(1)}" y="${(axY + 34).toFixed(1)}" text-anchor="middle" font-size="7" fill="${color}" font-family="sans-serif">${pauseLabel}</text>`;
        }
      } else {
        out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
        let dotEle = wp.ele;
        const pidx = drawProfile.findIndex(([km]) => km >= wp.km);
        if (pidx > 0) {
          const [km0, e0] = drawProfile[pidx - 1], [km1, e1] = drawProfile[pidx];
          const tv = km1 > km0 ? (wp.km - km0) / (km1 - km0) : 0;
          dotEle = e0 + tv * (e1 - e0);
        }
        out += `<circle cx="${xv.toFixed(1)}" cy="${yp(dotEle).toFixed(1)}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      }
    }

    // Axes
    out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;
    out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;

    // X-axis labels (time if dailyConfigs available, else km)
    const xStep = Math.max(1, Math.ceil(((kmMax - kmMin) / 6) / 5) * 5);
    for (let km = Math.ceil(kmMin / xStep) * xStep; km <= kmMax; km += xStep) {
      const x = xp(km);
      const label = dailyConfigs && startDate
        ? gpxArrivalTime(km, dailyConfigs, startDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : `${Math.round(km)}km`;
      out += `<text x="${x.toFixed(1)}" y="${(axY + 12).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${label}</text>`;
      out += `<line x1="${x.toFixed(1)}" y1="${axY}" x2="${x.toFixed(1)}" y2="${(axY + 4).toFixed(1)}" stroke="${clrAxis}" stroke-width="0.8"/>`;
    }

    // Cursor elements (updated on hover via querySelector)
    out += `<line id="gpx-cursor" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="${clrCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="gpx-cursor-dot" cx="0" cy="0" r="3.5" fill="#f97316" stroke="white" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [elevation, weatherPoints, visibleKmRange, isDark]);

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
      svg.querySelector("#gpx-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#gpx-cursor-dot")?.setAttribute("visibility", "hidden");
      onHover(null);
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

    const cl = svg.querySelector("#gpx-cursor");
    if (cl) {
      cl.setAttribute("x1", String(cxFixed));
      cl.setAttribute("x2", String(cxFixed));
      cl.setAttribute("visibility", "visible");
    }
    const cdot = svg.querySelector("#gpx-cursor-dot");
    if (cdot) {
      cdot.setAttribute("cx", String(cxFixed));
      cdot.setAttribute("cy", String(cy));
      cdot.setAttribute("visibility", "visible");
    }

    const temp = interpTempForGpx(bestKm, bestEle, wpRef.current);
    const ttMuted = "hsl(var(--muted-foreground))";
    const ttFg = "hsl(var(--foreground))";
    let ttHtml = `<div style="color:${ttMuted};font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:${ttFg}">⛰ ${Math.round(bestEle)} m</div>`;
    if (temp != null) {
      ttHtml += `<div style="color:${tempToRgb(temp, DESIRED_TEMP)}">☀ ${temp.toFixed(1)}°C</div>`;
    }
    if (dailyConfigs && startDate) {
      const arrival = gpxArrivalTime(km, dailyConfigs, startDate);
      const timeStr = arrival.toLocaleString(undefined, {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      ttHtml += `<div style="color:${ttMuted};font-size:9px;margin-top:2px">🕐 ${timeStr}</div>`;
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

    onHover(km);
  }

  function onChartMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector("#gpx-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#gpx-cursor-dot")?.setAttribute("visibility", "hidden");
    }
    onHover(null);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t.gpx.results.tabElevation}</p>
      <div
        className="relative w-full overflow-hidden"
        onMouseMove={onChartMouseMove}
        onMouseLeave={onChartMouseLeave}
      >
        <svg ref={svgRef} width="100%" style={{ display: "block" }} />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute hidden whitespace-nowrap rounded border border-border bg-card/95 px-2 py-1.5 text-[11px] leading-relaxed text-foreground shadow-md"
          style={{ zIndex: 20 }}
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

// ─── GpxMiniTempChart ─────────────────────────────────────────────────────────

function GpxMiniTempChart({
  elevation,
  weatherPoints,
  visibleKmRange,
  onHover,
  dailyConfigs,
  startDate,
}: {
  elevation: ElevationProfile;
  weatherPoints: GpxWeatherPoint[];
  visibleKmRange: [number, number] | null;
  onHover: (km: number | null) => void;
  dailyConfigs?: GpxDayConfig[];
  startDate?: string;
}) {
  const t = useT();
  const isDark = useIsDark();
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const wpRef = useRef(weatherPoints);
  wpRef.current = weatherPoints;

  const drawChart = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const hsl = (v: string) => `hsl(${cs.getPropertyValue(v).trim()})`;
    const clrBg = hsl("--card");
    const clrGrid = hsl("--border");
    const clrMuted = hsl("--muted-foreground");
    const clrAxis = hsl("--chart-line");
    const clrCursor = hsl("--chart-cursor");

    const svg = svgRef.current;
    if (!svg || !elevation) return;

    const W = svg.parentElement?.offsetWidth || 700;
    const H = 180;
    const PL = 44, PR = 10, PT = 20, PB = 50;
    const cW = W - PL - PR, cH = H - PT - PB;
    const profile = elevation.points;
    if (profile.length < 2 || cW <= 0 || cH <= 0) return;

    const stride = Math.max(1, Math.floor(profile.length / 600));
    const drawProfile: [number, number][] = profile.filter(
      (_, i) => i % stride === 0 || i === profile.length - 1
    );

    const dataKmMin = drawProfile[0][0], dataKmMax = drawProfile[drawProfile.length - 1][0];
    const kmMin = visibleKmRange ? Math.max(dataKmMin, visibleKmRange[0]) : dataKmMin;
    const kmMax = visibleKmRange ? Math.min(dataKmMax, visibleKmRange[1]) : dataKmMax;

    const wps = wpRef.current;
    const axY = PT + cH;
    const hasTime = !!(dailyConfigs && startDate);

    if (hasTime) {
      // ── TIME-BASED MODE: riding segments + overnight nightData ───────────────

      // Riding temp points (km → time → temp)
      const ridePoints: { ms: number; temp: number }[] = drawProfile
        .filter(([km]) => km >= kmMin && km <= kmMax)
        .map(([km, ele]) => {
          const temp = interpTempForGpx(km, ele, wps);
          if (temp == null) return null;
          return { ms: gpxArrivalTime(km, dailyConfigs!, startDate!).getTime(), temp };
        })
        .filter((p): p is { ms: number; temp: number } => p != null);

      // Stop wps with nightData within visible km range
      const stopWps = wps.filter(
        (wp) => wp.type === "stop"
          && wp.km >= kmMin - 1 && wp.km <= kmMax + 1
          && wp.stopTime && wp.nextStartTime
      );

      interface NightSeg { pts: { ms: number; temp: number }[]; stopMs: number; nextStartMs: number; nightLow: number | null; stopTime: string; nextStartTime: string }
      const nightSegs: NightSeg[] = [];
      for (const wp of stopWps) {
        if (!wp.stopTime || !wp.nextStartTime) continue;
        const pts = (wp.nightData as GpxNightHour[] | undefined ?? [])
          .map((d) => ({ ms: new Date(`${d.date}T${d.hour}:00`).getTime(), temp: d.temp ?? NaN }))
          .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.temp));
        nightSegs.push({
          pts,
          stopMs: new Date(wp.stopTime).getTime(),
          nextStartMs: new Date(wp.nextStartTime).getTime(),
          nightLow: wp.nightLow ?? null,
          stopTime: wp.stopTime,
          nextStartTime: wp.nextStartTime,
        });
      }

      const allMs = [
        ...ridePoints.map((p) => p.ms),
        ...nightSegs.flatMap((s) => [s.stopMs, s.nextStartMs]),
      ];
      if (allMs.length < 2 || ridePoints.length < 2) {
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        svg.setAttribute("height", String(H));
        svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="${clrMuted}" font-family="sans-serif">Keine Temperaturdaten</text>`;
        return;
      }

      const tStart = Math.min(...allMs);
      const tEnd = Math.max(...allMs);
      const msRange = tEnd - tStart || 1;

      const allTemps = [
        ...ridePoints.map((p) => p.temp),
        ...nightSegs.flatMap((s) => s.pts.map((p) => p.temp)),
      ];
      const tMin = Math.floor(Math.min(...allTemps)) - 2;
      const tMax = Math.ceil(Math.max(...allTemps)) + 2;
      const tRange = tMax - tMin || 1;

      // Build unified temp points: per-day riding segments interleaved with night data
      const rideSegs: { ms: number; temp: number }[][] = [];
      let curSeg: { ms: number; temp: number }[] = [];
      for (let i = 0; i < ridePoints.length; i++) {
        curSeg.push(ridePoints[i]);
        if (i < ridePoints.length - 1 && ridePoints[i + 1].ms - ridePoints[i].ms > 30 * 60_000) {
          rideSegs.push(curSeg);
          curSeg = [];
        }
      }
      if (curSeg.length > 0) rideSegs.push(curSeg);

      const unifiedPts: { ms: number; temp: number }[] = [];
      for (let si = 0; si < rideSegs.length; si++) {
        unifiedPts.push(...rideSegs[si]);
        if (si < rideSegs.length - 1) {
          const lastRide = rideSegs[si][rideSegs[si].length - 1];
          const ns = nightSegs.find((n) => Math.abs(n.stopMs - lastRide.ms) < 2 * 3_600_000);
          if (ns && ns.pts.length >= 2) {
            // Pause start: use riding day's last temp (= wp.temp at stop time)
            // Pause end:   interpolate nightData at nextStartMs for correct boundary
            const tempAtEnd = interpNightMs(ns.nextStartMs, ns.pts);
            const nightBoundary: { ms: number; temp: number }[] = [
              { ms: ns.stopMs, temp: lastRide.temp },
              ...ns.pts.filter((p) => p.ms > ns.stopMs + 60_000 && p.ms < ns.nextStartMs - 60_000),
              { ms: ns.nextStartMs, temp: tempAtEnd },
            ];
            unifiedPts.push(...nightBoundary);
            // Override first riding point of next day to use the night's boundary temperature
            rideSegs[si + 1] = [
              { ms: rideSegs[si + 1][0].ms, temp: tempAtEnd },
              ...rideSegs[si + 1].slice(1),
            ];
          } else {
            // No nightData: straight interpolated line across the pause
            const stopMs = ns?.stopMs ?? lastRide.ms;
            const nextStartMs = ns?.nextStartMs ?? rideSegs[si + 1][0].ms;
            unifiedPts.push({ ms: stopMs, temp: lastRide.temp });
            unifiedPts.push({ ms: nextStartMs, temp: rideSegs[si + 1][0].temp });
          }
        }
      }

      const kmMsLookup: { km: number; ms: number }[] = drawProfile
        .filter(([km]) => km >= kmMin && km <= kmMax)
        .map(([km]) => ({
          km,
          ms: gpxArrivalTime(km, dailyConfigs!, startDate!).getTime(),
        }));

      chartStateRef.current = {
        drawProfile: drawProfile.filter(([km]) => km >= kmMin && km <= kmMax),
        kmMin, kmMax, PL, cW, PT, cH,
        tMode: "time", tStart, msRange, tMin, tMax, tRange,
        unifiedPts,
        kmMsLookup,
      };

      const xp = (ms: number) => PL + ((ms - tStart) / msRange) * cW;
      const yp = (temp: number) => PT + cH - ((temp - tMin) / tRange) * cH;

      let out = `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${clrBg}" rx="2"/>`;

      // Night shading
      for (const ns of nightSegs) {
        const x1 = xp(ns.stopMs), x2 = xp(ns.nextStartMs);
        out += `<rect x="${x1.toFixed(1)}" y="${PT}" width="${Math.max(0, x2 - x1).toFixed(1)}" height="${cH}" fill="#7c3aed" opacity="0.07"/>`;
      }

      // Y-axis grid + labels
      const tempTick = tRange <= 6 ? 1 : tRange <= 15 ? 2 : tRange <= 30 ? 5 : 10;
      for (let tv = Math.ceil(tMin / tempTick) * tempTick; tv <= tMax; tv += tempTick) {
        const y = yp(tv);
        out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${clrGrid}" stroke-width="0.8"/>`;
        out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${tv}°</text>`;
      }

      // 0° reference
      if (tMin < 0 && tMax > 0) {
        const y0 = yp(0);
        out += `<line x1="${PL}" y1="${y0.toFixed(1)}" x2="${PL + cW}" y2="${y0.toFixed(1)}" stroke="${clrAxis}" stroke-width="0.8" stroke-dasharray="3,3"/>`;
      }

      // Single continuous temperature line (riding + pauses merged)
      for (let i = 0; i < unifiedPts.length - 1; i++) {
        const p0 = unifiedPts[i], p1 = unifiedPts[i + 1];
        const col = tempToRgb((p0.temp + p1.temp) / 2, DESIRED_TEMP);
        out += `<line x1="${xp(p0.ms).toFixed(1)}" y1="${yp(p0.temp).toFixed(1)}" x2="${xp(p1.ms).toFixed(1)}" y2="${yp(p1.temp).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;
      }

      // Stop marker lines + labels
      for (const ns of nightSegs) {
        const xv = xp(ns.stopMs);
        out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>`;
        if (ns.nightLow != null) {
          out += `<text x="${xv.toFixed(1)}" y="${(axY + 22).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#7c3aed" font-family="sans-serif">☽${Math.round(ns.nightLow)}°</text>`;
        }
        const pauseLabel = ns.stopTime.slice(11, 16) + "–" + ns.nextStartTime.slice(11, 16);
        out += `<text x="${xv.toFixed(1)}" y="${(axY + 34).toFixed(1)}" text-anchor="middle" font-size="7" fill="#7c3aed" font-family="sans-serif">${pauseLabel}</text>`;
      }

      // Axes
      out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;
      out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;

      // X-axis time ticks
      const hourMs = 3_600_000;
      const tickMs = msRange < 12 * hourMs ? hourMs
        : msRange < 24 * hourMs ? 2 * hourMs
        : msRange < 48 * hourMs ? 4 * hourMs
        : msRange < 96 * hourMs ? 8 * hourMs : 12 * hourMs;
      for (let ms = Math.ceil(tStart / tickMs) * tickMs; ms <= tEnd; ms += tickMs) {
        const x = xp(ms);
        const label = new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        out += `<text x="${x.toFixed(1)}" y="${(axY + 12).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${label}</text>`;
        out += `<line x1="${x.toFixed(1)}" y1="${axY}" x2="${x.toFixed(1)}" y2="${(axY + 4).toFixed(1)}" stroke="${clrAxis}" stroke-width="0.8"/>`;
      }

      // Cursor elements
      out += `<line id="gpx-tc-cursor" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="${clrCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
      out += `<circle id="gpx-tc-cursor-dot" cx="0" cy="0" r="3.5" fill="#f97316" stroke="white" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;

      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("height", String(H));
      svg.innerHTML = out;
      return;
    }

    // ── KM-BASED MODE (fallback when no dailyConfigs) ────────────────────────
    const kmRange = kmMax - kmMin || 1;
    const tempData: { km: number; ele: number; temp: number }[] = drawProfile
      .filter(([km]) => km >= kmMin && km <= kmMax)
      .map(([km, ele]) => {
        const temp = interpTempForGpx(km, ele, wps);
        return temp != null ? { km, ele, temp } : null;
      })
      .filter((p): p is { km: number; ele: number; temp: number } => p != null);

    chartStateRef.current = {
      drawProfile: drawProfile.filter(([km]) => km >= kmMin && km <= kmMax),
      kmMin, kmMax, PL, cW, PT, cH,
      tempData,
    };

    if (tempData.length < 2) {
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("height", String(H));
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="${clrMuted}" font-family="sans-serif">Keine Temperaturdaten</text>`;
      return;
    }

    const temps = tempData.map((p) => p.temp);
    const tMin = Math.floor(Math.min(...temps)) - 2;
    const tMax = Math.ceil(Math.max(...temps)) + 2;
    const tRange = tMax - tMin || 1;
    chartStateRef.current.tMin = tMin;
    chartStateRef.current.tMax = tMax;
    chartStateRef.current.tRange = tRange;

    const xp = (km: number) => PL + ((km - kmMin) / kmRange) * cW;
    const yp = (temp: number) => PT + cH - ((temp - tMin) / tRange) * cH;

    let out = `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${clrBg}" rx="2"/>`;

    // Y-axis grid + labels
    const tempTick = tRange <= 6 ? 1 : tRange <= 15 ? 2 : tRange <= 30 ? 5 : 10;
    for (let tv = Math.ceil(tMin / tempTick) * tempTick; tv <= tMax; tv += tempTick) {
      const y = yp(tv);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${clrGrid}" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${tv}°</text>`;
    }

    // 0° reference
    if (tMin < 0 && tMax > 0) {
      const y0 = yp(0);
      out += `<line x1="${PL}" y1="${y0.toFixed(1)}" x2="${PL + cW}" y2="${y0.toFixed(1)}" stroke="${clrAxis}" stroke-width="0.8" stroke-dasharray="3,3"/>`;
    }

    // Stop markers
    for (const wp of wps) {
      if (wp.type !== "stop" || wp.km < kmMin || wp.km > kmMax) continue;
      const xv = xp(wp.km);
      out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.7"/>`;
      if (wp.nightLow != null) {
        out += `<text x="${xv.toFixed(1)}" y="${(axY + 22).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#7c3aed" font-family="sans-serif">☽${Math.round(wp.nightLow)}°</text>`;
      }
      if (wp.stopTime && wp.nextStartTime) {
        const pauseLabel = wp.stopTime.slice(11, 16) + "–" + wp.nextStartTime.slice(11, 16);
        out += `<text x="${xv.toFixed(1)}" y="${(axY + 34).toFixed(1)}" text-anchor="middle" font-size="7" fill="#7c3aed" font-family="sans-serif">${pauseLabel}</text>`;
      }
    }

    // Colored temperature line
    for (let i = 0; i < tempData.length - 1; i++) {
      const p0 = tempData[i], p1 = tempData[i + 1];
      const col = tempToRgb((p0.temp + p1.temp) / 2, DESIRED_TEMP);
      out += `<line x1="${xp(p0.km).toFixed(1)}" y1="${yp(p0.temp).toFixed(1)}" x2="${xp(p1.km).toFixed(1)}" y2="${yp(p1.temp).toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;
    }

    // Axes
    out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;
    out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="${clrAxis}" stroke-width="1"/>`;

    // X-axis km ticks
    const xStep = Math.max(1, Math.ceil((kmMax - kmMin) / 6 / 5) * 5);
    for (let km = Math.ceil(kmMin / xStep) * xStep; km <= kmMax; km += xStep) {
      const x = xp(km);
      out += `<text x="${x.toFixed(1)}" y="${(axY + 12).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${clrMuted}" font-family="sans-serif">${Math.round(km)}km</text>`;
      out += `<line x1="${x.toFixed(1)}" y1="${axY}" x2="${x.toFixed(1)}" y2="${(axY + 4).toFixed(1)}" stroke="${clrAxis}" stroke-width="0.8"/>`;
    }

    // Cursor elements
    out += `<line id="gpx-tc-cursor" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="${clrCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="gpx-tc-cursor-dot" cx="0" cy="0" r="3.5" fill="#f97316" stroke="white" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [elevation, weatherPoints, visibleKmRange, isDark, dailyConfigs, startDate]);

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
      svg.querySelector("#gpx-tc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#gpx-tc-cursor-dot")?.setAttribute("visibility", "hidden");
      onHover(null);
      return;
    }

    const ttMuted = "hsl(var(--muted-foreground))";
    let ttHtml = "";
    let cxFixed = x;
    let cy = cs.PT + cs.cH / 2;
    let hoverKm: number | null = null;

    if (cs.tMode === "time") {
      const ms = cs.tStart + ((x - cs.PL) / cs.cW) * cs.msRange;
      cxFixed = x;
      let bestTemp: number | null = null;
      let bestDist = Infinity;
      for (const p of (cs.unifiedPts as { ms: number; temp: number }[])) {
        const d = Math.abs(p.ms - ms);
        if (d < bestDist) { bestDist = d; bestTemp = p.temp; }
      }
      const timeStr = new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      ttHtml = `<div style="color:${ttMuted};font-size:9px;margin-bottom:2px">🕐 ${timeStr}</div>`;
      if (bestTemp != null) {
        ttHtml += `<div style="color:${tempToRgb(bestTemp, DESIRED_TEMP)};font-size:13px;font-weight:600">☀ ${bestTemp.toFixed(1)}°C</div>`;
        cy = cs.PT + cs.cH - ((bestTemp - cs.tMin) / cs.tRange) * cs.cH;
      }
      if (cs.kmMsLookup && cs.kmMsLookup.length > 0) {
        let bestKm = cs.kmMsLookup[0].km;
        let bestKmDist = Infinity;
        for (const { ms: pMs, km: pKm } of cs.kmMsLookup) {
          const d = Math.abs(pMs - ms);
          if (d < bestKmDist) { bestKmDist = d; bestKm = pKm; }
        }
        hoverKm = bestKm;
      }
    } else {
      const km = cs.kmMin + ((x - cs.PL) / cs.cW) * (cs.kmMax - cs.kmMin);
      let best = cs.drawProfile[0], bestDist = Infinity;
      for (const p of cs.drawProfile) {
        const d = Math.abs(p[0] - km);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      const [bestKm, bestEle] = best;
      const temp = interpTempForGpx(bestKm, bestEle, wpRef.current);
      cxFixed = cs.PL + ((km - cs.kmMin) / (cs.kmMax - cs.kmMin)) * cs.cW;
      cy = temp != null && cs.tRange
        ? cs.PT + cs.cH - ((temp - cs.tMin) / cs.tRange) * cs.cH
        : cs.PT + cs.cH / 2;
      ttHtml = `<div style="color:${ttMuted};font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
      if (temp != null) {
        ttHtml += `<div style="color:${tempToRgb(temp, DESIRED_TEMP)};font-size:13px;font-weight:600">☀ ${temp.toFixed(1)}°C</div>`;
      }
      hoverKm = km;
    }

    const cl = svg.querySelector("#gpx-tc-cursor");
    if (cl) { cl.setAttribute("x1", String(cxFixed)); cl.setAttribute("x2", String(cxFixed)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector("#gpx-tc-cursor-dot");
    if (cdot) { cdot.setAttribute("cx", String(cxFixed)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    tooltip.innerHTML = ttHtml;
    tooltip.style.display = "block";
    const tw = tooltip.offsetWidth;
    const panelW = svg.parentElement?.offsetWidth ?? 700;
    let tx = x + 14;
    if (tx + tw + 4 > panelW) tx = x - tw - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.bottom = "26px";
    tooltip.style.top = "auto";

    onHover(hoverKm);
  }

  function onChartMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector("#gpx-tc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#gpx-tc-cursor-dot")?.setAttribute("visibility", "hidden");
    }
    onHover(null);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t.gpx.results.tabTemperature}</p>
      <div
        className="relative w-full overflow-hidden"
        onMouseMove={onChartMouseMove}
        onMouseLeave={onChartMouseLeave}
      >
        <svg ref={svgRef} width="100%" style={{ display: "block" }} />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute hidden whitespace-nowrap rounded border border-border bg-card/95 px-2 py-1.5 text-[11px] leading-relaxed text-foreground shadow-md"
          style={{ zIndex: 20 }}
        />
      </div>
      <div className="mt-1 flex items-center gap-2 px-10 text-[9px] text-muted-foreground">
        <span>{DESIRED_TEMP - 15}°C</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: LEGEND_GRADIENT }} />
        <span>{DESIRED_TEMP + 15}°C</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GpxRouteMap({ results }: { results: GpxJobResults }) {
  const [visibleKmRange, setVisibleKmRange] = useState<[number, number] | null>(null);
  const [hoveredKm, setHoveredKm] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<"elevation" | "temperature">("elevation");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [elevExpanded, setElevExpanded] = useState(true);
  const isDark = useIsDark();
  const t = useT();

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // trackPolyline: [cumKm, lat, lon][] scaled to match elevation profile km values
  const trackPolyline = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    let cumKm = 0;
    for (let i = 0; i < results.trackPoints.length; i++) {
      const [lat, lon] = results.trackPoints[i];
      if (i > 0) {
        const [lat0, lon0] = results.trackPoints[i - 1];
        cumKm += haversineDist(lat0, lon0, lat, lon);
      }
      pts.push([cumKm, lat, lon]);
    }
    // Scale to match the backend's totalKm so bounds tracking aligns with elevation profile
    if (pts.length > 0 && cumKm > 0 && results.totalKm > 0) {
      const scale = results.totalKm / cumKm;
      return pts.map(([km, lat, lon]) => [km * scale, lat, lon]);
    }
    return pts;
  }, [results.trackPoints, results.totalKm]);

  const trackCoords: [number, number][] = results.trackPoints.map(([lat, lon]) => [lon, lat]);

  const initCenter: [number, number] =
    results.trackPoints.length > 0
      ? [results.trackPoints[0][1], results.trackPoints[0][0]]
      : [10, 48];

  const chartTabs = results.elevation && (
    <div className="flex overflow-hidden rounded-md border border-border">
      <button
        onClick={() => setChartMode("elevation")}
        className={[
          "border-r border-border px-2.5 py-1 text-[11px] font-medium transition-colors",
          chartMode === "elevation"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:bg-muted",
        ].join(" ")}
      >
        {t.gpx.results.tabElevation}
      </button>
      <button
        onClick={() => setChartMode("temperature")}
        className={[
          "px-2.5 py-1 text-[11px] font-medium transition-colors",
          chartMode === "temperature"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:bg-muted",
        ].join(" ")}
      >
        {t.gpx.results.tabTemperature}
      </button>
    </div>
  );

  const chartContent = results.elevation && (
    chartMode === "elevation" ? (
      <GpxMiniElevChart
        key={`elev-${isFullscreen}`}
        elevation={results.elevation}
        weatherPoints={results.weatherPoints}
        visibleKmRange={visibleKmRange}
        onHover={setHoveredKm}
        dailyConfigs={results.dailyConfigs}
        startDate={results.startDate}
      />
    ) : (
      <GpxMiniTempChart
        key={`temp-${isFullscreen}`}
        elevation={results.elevation}
        weatherPoints={results.weatherPoints}
        visibleKmRange={visibleKmRange}
        onHover={setHoveredKm}
        dailyConfigs={results.dailyConfigs}
        startDate={results.startDate}
      />
    )
  );

  return (
    <div className="space-y-3">
      <MapView
        theme={isDark ? "dark" : "light"}
        center={initCenter}
        zoom={8}
        className="h-[500px] w-full rounded-lg lg:h-[600px]"
      >
        <MapControls showFullscreen />
        <FitTrack coordinates={trackCoords} />
        {trackCoords.length > 1 && (
          <MapRoute
            coordinates={trackCoords}
            color="#2563eb"
            width={2.5}
            opacity={0.85}
            interactive={false}
          />
        )}
        <GpxMarkers weatherPoints={results.weatherPoints} trackPoints={results.trackPoints} />
        <GpxBoundsTracker
          trackPolyline={trackPolyline}
          totalKm={results.totalKm}
          onRangeChange={setVisibleKmRange}
        />
        <GpxHoverDot hoveredKm={hoveredKm} trackPolyline={trackPolyline} />

        {isFullscreen && results.elevation && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div
              className="flex cursor-pointer items-center justify-between border-t border-border bg-card/90 px-3 py-1 backdrop-blur-sm"
              onClick={() => setElevExpanded((v) => !v)}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {chartMode === "elevation" ? t.gpx.results.tabElevation : t.gpx.results.tabTemperature}
              </span>
              {elevExpanded
                ? <ChevronDown className="size-4 text-muted-foreground" />
                : <ChevronUp className="size-4 text-muted-foreground" />}
            </div>
            {elevExpanded && (
              <div className="bg-card/95 p-2">
                <div className="mb-1 flex justify-end">
                  {chartTabs}
                </div>
                {chartContent}
              </div>
            )}
          </div>
        )}
      </MapView>

      {!isFullscreen && results.elevation && (
        <div className="space-y-2">
          <div className="flex overflow-hidden rounded-lg border border-border w-fit">
            <button
              onClick={() => setChartMode("elevation")}
              className={[
                "border-r border-border px-3 py-1 text-xs font-medium transition-colors",
                chartMode === "elevation"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {t.gpx.results.tabElevation}
            </button>
            <button
              onClick={() => setChartMode("temperature")}
              className={[
                "px-3 py-1 text-xs font-medium transition-colors",
                chartMode === "temperature"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {t.gpx.results.tabTemperature}
            </button>
          </div>
          {chartContent}
        </div>
      )}
    </div>
  );
}
