import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Sun, Moon, CloudRain, Cloud } from "lucide-react";
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
import { useLangStore } from "@/i18n/store";
import { dayToShortDE } from "@/utils/tempColor";
import { useIsDark } from "@/stores/themeStore";
import type { ForecastPoint, ForecastPointData, ForecastDailyData, ForecastHourData } from "@/api/types";


const HOUR_STEPS = [0, 6, 12, 18, 24];

function legendGradient(isDark: boolean): string {
  const mid = isDark ? "rgb(255,255,255)" : "rgb(160,160,160)";
  return `linear-gradient(to right, rgb(60,0,80) 0%, rgb(30,30,160) 16.67%, rgb(100,160,255) 33.33%, ${mid} 50%, rgb(255,150,100) 66.67%, rgb(200,40,40) 83.33%, rgb(160,0,120) 100%)`;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function compassDir16(deg: number | null): string {
  if (deg == null) return "";
  const dirs = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function tempToRgb(temp: number, desired: number, isDark = true): string {
  const STOPS: [number, [number, number, number]][] = isDark
    ? [
        [-1.0, [60, 0, 80]], [-0.667, [30, 30, 160]], [-0.333, [100, 160, 255]],
        [0.0, [255, 255, 255]], [0.333, [255, 150, 100]], [0.667, [200, 40, 40]], [1.0, [160, 0, 120]],
      ]
    : [
        [-1.0, [60, 0, 80]], [-0.667, [30, 30, 160]], [-0.333, [100, 160, 255]],
        [0.0, [160, 160, 160]], [0.333, [255, 150, 100]], [0.667, [200, 40, 40]], [1.0, [160, 0, 120]],
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

function haversineDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
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

// ─── Climate (historical) point type + interpolation helper ──────────────────

interface ClimatePoint {
  km: number;
  lat: number;
  lon: number;
  ele: number;
  tmin: number;
  tmax: number;
  prcp: number;
  wspd: number;
  wdir: number;
}

function climateInterp(km: number, key: "tmin" | "tmax" | "prcp" | "wspd", cps: ClimatePoint[]): number | null {
  if (!cps.length) return null;
  if (km <= cps[0].km) return cps[0][key];
  if (km >= cps[cps.length - 1].km) return cps[cps.length - 1][key];
  for (let i = 1; i < cps.length; i++) {
    if (cps[i].km >= km) {
      const span = cps[i].km - cps[i - 1].km;
      const tv = span > 0 ? (km - cps[i - 1].km) / span : 0;
      return cps[i - 1][key] + tv * (cps[i][key] - cps[i - 1][key]);
    }
  }
  return cps[cps.length - 1][key];
}

/** Interpolate elevation from miniElev at a given km position. */
function eleAtKm(km: number, miniElev: [number, number, number, number][]): number {
  if (!miniElev.length) return 0;
  if (km <= miniElev[0][0]) return miniElev[0][3];
  for (let i = 1; i < miniElev.length; i++) {
    if (miniElev[i][0] >= km) {
      const span = miniElev[i][0] - miniElev[i - 1][0];
      const tv = span > 0 ? (km - miniElev[i - 1][0]) / span : 0;
      return miniElev[i - 1][3] + tv * (miniElev[i][3] - miniElev[i - 1][3]);
    }
  }
  return miniElev[miniElev.length - 1][3];
}

/**
 * Interpolate a temperature key from climate points, then apply lapse rate
 * correction for the actual elevation vs the reference elevation at that km.
 */
function climateInterpTemp(km: number, ele: number, key: "tmin" | "tmax", cps: ClimatePoint[]): number | null {
  if (!cps.length) return null;
  let baseTemp: number;
  let refEle: number;
  let refPrcp: number;
  if (km <= cps[0].km) {
    baseTemp = cps[0][key]; refEle = cps[0].ele; refPrcp = cps[0].prcp;
  } else if (km >= cps[cps.length - 1].km) {
    baseTemp = cps[cps.length - 1][key]; refEle = cps[cps.length - 1].ele; refPrcp = cps[cps.length - 1].prcp;
  } else {
    for (let i = 1; i < cps.length; i++) {
      if (cps[i].km >= km) {
        const span = cps[i].km - cps[i - 1].km;
        const tv = span > 0 ? (km - cps[i - 1].km) / span : 0;
        baseTemp = cps[i - 1][key] + tv * (cps[i][key] - cps[i - 1][key]);
        refEle   = cps[i - 1].ele  + tv * (cps[i].ele  - cps[i - 1].ele);
        refPrcp  = cps[i - 1].prcp + tv * (cps[i].prcp - cps[i - 1].prcp);
        const lapse = (1 - 0.4 * Math.min(1, refPrcp / 5)) / 100;
        return baseTemp - (ele - refEle) * lapse;
      }
    }
    baseTemp = cps[cps.length - 1][key]; refEle = cps[cps.length - 1].ele; refPrcp = cps[cps.length - 1].prcp;
  }
  const lapse = (1 - 0.4 * Math.min(1, refPrcp / 5)) / 100;
  return baseTemp - (ele - refEle) * lapse;
}

function climateWdirAt(km: number, cps: ClimatePoint[]): number {
  if (!cps.length) return 0;
  let best = cps[0];
  let bestDist = Math.abs(km - cps[0].km);
  for (let i = 1; i < cps.length; i++) {
    const d = Math.abs(km - cps[i].km);
    if (d < bestDist) { bestDist = d; best = cps[i]; }
  }
  return best.wdir;
}

// ─── Climate markers (city stops outside the forecast window) ─────────────────

interface ClimateMarkersProps {
  points: ClimatePoint[];
  miniElev: [number, number, number, number][];
  currentHour: number;
  dailyMode: boolean;
  desiredHigh: number;
  desiredLow: number;
  buildPopupContent: (cp: ClimatePoint) => string;
}

function ClimateMarkers({ points, miniElev, currentHour, dailyMode, desiredHigh, desiredLow, buildPopupContent }: ClimateMarkersProps) {
  const { map, isLoaded } = useMap();
  const [zoom, setZoom] = useState(5);
  const isDark = useIsDark();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);
    setZoom(map.getZoom());
    return () => { map.off("zoom", onZoom); };
  }, [map, isLoaded]);

  const step = zoom < 4 ? 20 : zoom < 5 ? 12 : zoom < 6 ? 6 : zoom < 7 ? 3 : zoom < 8 ? 2 : 1;
  const desiredAvg = (desiredHigh + desiredLow) / 2;
  const textShadow = "0 1px 3px rgba(0,0,0,0.65)";

  return (
    <>
      {points.map((cp, i) => {
        if (i !== 0 && i !== points.length - 1 && i % step !== 0) return null;
        let bg: string;
        let boxContent: React.ReactNode;

        if (dailyMode) {
          const tavg = (cp.tmax + cp.tmin) / 2;
          bg = tempToRgb(tavg, desiredAvg, isDark);
          boxContent = (
            <>
              <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                  <Sun style={{ width: 10, height: 10, color: "#fde68a", filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
                  <span style={{ color: "#fff", textShadow }}>{Math.round(cp.tmax)}°</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                  <Moon style={{ width: 10, height: 10, color: "#bfdbfe", filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
                  <span style={{ color: "#fff", textShadow }}>{Math.round(cp.tmin)}°</span>
                </span>
              </div>
              {cp.prcp > 0.1 && (
                <div style={{ fontSize: "9px", display: "flex", alignItems: "center", justifyContent: "center", gap: "1px" }}>
                  <CloudRain style={{ width: 9, height: 9, color: "#93c5fd", flexShrink: 0 }} />
                  <span style={{ color: "#fff", textShadow }}>{cp.prcp.toFixed(1)}mm</span>
                </div>
              )}
            </>
          );
        } else {
          const isNight = currentHour === 0 || currentHour === 6 || currentHour === 24;
          const temp = isNight ? cp.tmin : cp.tmax;
          const chartRef = isNight ? desiredLow : desiredHigh;
          bg = tempToRgb(temp, chartRef, isDark);
          const IconComp = isNight ? Moon : Sun;
          const iconColor = isNight ? "#bfdbfe" : "#fde68a";
          boxContent = (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
              <IconComp style={{ width: 10, height: 10, color: iconColor, filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
              <span style={{ color: "#fff", textShadow }}>{Math.round(temp)}°</span>
            </div>
          );
        }

        const routeBearing = routeBearingAt(cp.km, miniElev);
        const showArrow = !dailyMode && routeBearing != null;

        return (
          <MapMarker key={`cl-${i}`} longitude={cp.lon} latitude={cp.lat}>
            <MarkerContent>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  className="cursor-pointer rounded border px-1.5 py-0.5 text-center font-bold shadow-md whitespace-nowrap leading-tight"
                  style={{ background: bg, borderColor: "rgba(255,255,255,0.25)", fontSize: "10px", minWidth: "42px" }}
                >
                  {boxContent}
                </div>
                {showArrow && (
                  <WindArrow wdir={cp.wdir} wspd={cp.wspd} routeBearing={routeBearing!} />
                )}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <div dangerouslySetInnerHTML={{ __html: buildPopupContent(cp) }} />
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </>
  );
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
  const isDark = useIsDark();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoom", onZoom);
    setZoom(map.getZoom());
    return () => { map.off("zoom", onZoom); };
  }, [map, isLoaded]);

  const step = zoom < 4 ? 20 : zoom < 5 ? 12 : zoom < 6 ? 6 : zoom < 7 ? 3 : zoom < 8 ? 2 : 1;
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
          bg = tavg != null ? tempToRgb(tavg, desiredAvg, isDark) : "#94a3b8";
          boxContent = (
            <>
              <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                {d?.tmax != null && (
                  <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                    <Sun style={{ width: 10, height: 10, color: "#fde68a", filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
                    <span style={{ color: "#fff", textShadow }}>{Math.round(d.tmax)}°</span>
                  </span>
                )}
                {d?.tmin != null && (
                  <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                    <Moon style={{ width: 10, height: 10, color: "#bfdbfe", filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
                    <span style={{ color: "#fff", textShadow }}>{Math.round(d.tmin)}°</span>
                  </span>
                )}
              </div>
              {(d?.prcp != null || d?.sun != null) && (
                <div style={{ fontSize: "9px", display: "flex", gap: "4px", justifyContent: "center" }}>
                  {d?.prcp != null && d.prcp > 0.1 && (
                    <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                      <CloudRain style={{ width: 9, height: 9, color: "#93c5fd", flexShrink: 0 }} />
                      <span style={{ color: "#fff", textShadow }}>{d.prcp.toFixed(1)}mm</span>
                    </span>
                  )}
                  {d?.sun != null && (
                    <span style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                      <Sun style={{ width: 9, height: 9, color: "#fde68a", flexShrink: 0 }} />
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
          bg = h?.temp != null ? tempToRgb(h.temp, chartRef, isDark) : "#94a3b8";
          const isRainy = (h?.prcp ?? 0) > 1;
          const isHeavyCloud = (h?.cloud ?? 0) > 75;
          const iconColor = isRainy ? "#93c5fd" : isHeavyCloud ? "#cbd5e1" : "#fde68a";
          const HourIcon = isRainy ? CloudRain : isHeavyCloud ? Cloud : Sun;
          wdir = h?.wdir ?? null;
          wspd = h?.wspd ?? null;
          boxContent = (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                <HourIcon style={{ width: 10, height: 10, color: iconColor, filter: `drop-shadow(${textShadow})`, flexShrink: 0 }} />
                <span style={{ color: "#fff", textShadow }}>
                  {h?.temp != null ? `${Math.round(h.temp)}°` : "?"}
                </span>
              </div>
              {h?.prcp != null && h.prcp > 0.3 && (
                <div style={{ fontSize: "9px", display: "flex", alignItems: "center", justifyContent: "center", gap: "1px" }}>
                  <CloudRain style={{ width: 9, height: 9, color: "#93c5fd", flexShrink: 0 }} />
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

// ─── Hover dot on the map (synced with elevation chart) ──────────────────────

function HoverDotFM({ miniElev }: { miniElev: [number, number, number, number][] }) {
  const hoveredKm = useResultsStore((s) => s.hoveredKm);
  if (hoveredKm == null || !miniElev.length) return null;
  const [lat, lon] = kmToLatLon(hoveredKm, miniElev);
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

// ─── FitBounds ───────────────────────────────────────────────────────────────

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

// ─── Map bounds → visible km range (drives elevation chart zoom) ──────────────

function MapBoundsForecastTracker({ miniElev }: { miniElev: [number, number, number, number][] }) {
  const { map, isLoaded } = useMap();
  const setVisibleKmRange = useResultsStore((s) => s.setVisibleKmRange);

  const miniElevRef = useRef(miniElev);
  miniElevRef.current = miniElev;

  useEffect(() => {
    if (!map || !isLoaded) return;
    const m = map;

    function update() {
      const me = miniElevRef.current;
      if (me.length < 2) { setVisibleKmRange(null); return; }
      const bounds = m.getBounds();
      // miniElev format: [km, lat, lon, ele] → bounds.contains wants [lon, lat]
      const vis = me.filter(([, lat, lon]) => bounds.contains([lon, lat]));
      if (vis.length === 0) { setVisibleKmRange(null); return; }
      const minKm = vis[0][0];
      const maxKm = vis[vis.length - 1][0];
      const totalKm = me[me.length - 1][0];
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

// ─── Zoom tracker (must live inside MapView) ──────────────────────────────────

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const update = () => onZoom(map.getZoom());
    map.on("zoom", update);
    update();
    return () => { map.off("zoom", update); };
  }, [map, isLoaded, onZoom]);
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────

function relDayToLabel(relDay: number, startDay: number, lang: string): string {
  const absDay = ((startDay + Math.round(relDay) - 1 + 3650) % 365) + 1;
  return dayToShortDE(absDay, lang === "de" ? "de" : "en");
}

function relDayToCircle(relDay: number, startDay: number): string {
  const absDay = ((startDay + Math.round(relDay) - 1 + 3650) % 365) + 1;
  const d = new Date(new Date().getFullYear(), 0);
  d.setDate(absDay);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function ForecastMap() {
  const forecast = useResultsStore((s) => s.forecast);
  const forecastError = useResultsStore((s) => s.forecastError);
  const setHoveredKm = useResultsStore((s) => s.setHoveredKm);
  const visibleKmRange = useResultsStore((s) => s.visibleKmRange);
  const hoveredModelKmRange = useResultsStore((s) => s.hoveredModelKmRange);
  const elevation = useResultsStore((s) => s.elevation);
  const markers = useResultsStore((s) => s.markers);
  const segments = useResultsStore((s) => s.segments);
const lang = useLangStore((s) => s.lang);
  const [hourIdx, setHourIdx] = useState(2);
  const [dailyMode, setDailyMode] = useState(() => !!forecast);
  useEffect(() => { if (forecast) setDailyMode(true); }, [forecast]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapZoom, setMapZoom] = useState(5);
  const handleZoom = useCallback((z: number) => setMapZoom(z), []);
  const [elevExpanded, setElevExpanded] = useState(true);
  const [showTempProfile, setShowTempProfile] = useState(false);
  const isDark = useIsDark();
  const t = useT();

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartStateRef = useRef<any>(null);
  const stateRef = useRef({ hourIdx, dailyMode, forecast, lang, climatePoints: [] as ClimatePoint[], showTempProfile: false, markerStops: [] as { km: number; relDay: number }[], startDay: 1 as number });
  // stateRef.current is updated after climatePoints is defined below

  useEffect(() => {
    return () => { setHoveredKm(null); };
  }, [setHoveredKm]);

  // Fallback miniElev built from segments + elevation profile when no forecast exists
  const fallbackMiniElev = useMemo<[number, number, number, number][]>(() => {
    if (forecast) return [];
    if (!elevation?.points || !segments.length) return [];
    const poly: [number, number, number][] = [];
    let cumKm = 0;
    let prev: [number, number] | null = null;
    for (const seg of segments) {
      for (const [lon, lat] of seg.coordinates) {
        if (prev) cumKm += haversineDist(prev[0], prev[1], lon, lat);
        poly.push([cumKm, lon, lat]);
        prev = [lon, lat];
      }
    }
    if (poly.length < 2) return [];
    const totalSegKm = poly[poly.length - 1][0];
    const totalElevKm = elevation.totalKm || totalSegKm;
    const scale = totalSegKm > 0 && totalElevKm > 0 ? totalSegKm / totalElevKm : 1;
    const getLatLon = (elevKm: number): [number, number] => {
      const skm = elevKm * scale;
      if (skm <= poly[0][0]) return [poly[0][2], poly[0][1]];
      if (skm >= poly[poly.length - 1][0]) { const p = poly[poly.length - 1]; return [p[2], p[1]]; }
      let ci = poly.findIndex(p => p[0] >= skm);
      if (ci < 0) ci = poly.length - 1;
      if (ci === 0) ci = 1;
      const p0 = poly[ci - 1], p1 = poly[ci];
      const span = p1[0] - p0[0];
      const tv = span > 0 ? (skm - p0[0]) / span : 0;
      return [p0[2] + tv * (p1[2] - p0[2]), p0[1] + tv * (p1[1] - p0[1])];
    };
    const stride = Math.max(1, Math.floor(elevation.points.length / 400));
    const result: [number, number, number, number][] = [];
    for (let i = 0; i < elevation.points.length; i += stride) {
      const [elevKm, ele] = elevation.points[i];
      const [lat, lon] = getLatLon(elevKm);
      result.push([elevKm, lat, lon, ele]);
    }
    const lastPt = elevation.points[elevation.points.length - 1];
    const [lastLat, lastLon] = getLatLon(lastPt[0]);
    if (result.length === 0 || result[result.length - 1][0] < lastPt[0] - 0.1)
      result.push([lastPt[0], lastLat, lastLon, lastPt[1]]);
    return result;
  }, [forecast, elevation, segments]);

  const points     = forecast?.points     ?? [];
  const data       = forecast?.data       ?? {};
  const miniElev   = forecast?.miniElev   ?? fallbackMiniElev;
  const routeStops = forecast?.routeStops ?? [];
  const storeDesiredHigh = useResultsStore((s) => s.desiredHigh);
  const storeDesiredLow  = useResultsStore((s) => s.desiredLow);
  const startDay = useResultsStore((s) => s.startDay);
  const desiredHigh = forecast?.desiredHigh ?? storeDesiredHigh;
  const desiredLow  = forecast?.desiredLow  ?? storeDesiredLow;
  const desiredAvg  = (desiredHigh + desiredLow) / 2;
  const currentHour = HOUR_STEPS[hourIdx];

  // Build climate points from city markers + elevation km positions.
  // Falls back to forecast.routeStops when elevation.cityData isn't loaded yet,
  // so the elevation profile is immediately colored even before elevation data arrives.
  const climatePoints = useMemo<ClimatePoint[]>(() => {
    if (markers.length === 0) return [];

    // Primary: precise km positions from elevation.cityData
    if (elevation?.cityData?.length) {
      const kmByCity = new Map(elevation.cityData.map((cd) => [cd.cityId, cd.km]));
      const eleByCity = new Map(elevation.cityData.map((cd) => [cd.cityId, cd.ele]));
      const me = forecast?.miniElev ?? [];
      const pts = markers
        .map((m) => {
          const km = kmByCity.get(m.id);
          if (km == null) return null;
          const ele = eleByCity.get(m.id) ?? eleAtKm(km, me);
          return { km, lat: m.lat, lon: m.lon, ele, tmin: m.tmin, tmax: m.tmax, prcp: m.prcp, wspd: m.wspd, wdir: m.wdir };
        })
        .filter((p): p is ClimatePoint => p != null)
        .sort((a, b) => a.km - b.km);
      if (pts.length > 0) return pts;
    }

    // Fallback: km positions from forecast.routeStops, temperature from nearest marker
    if (forecast?.routeStops.length) {
      const me = forecast.miniElev ?? [];
      return forecast.routeStops
        .map((rs) => {
          let best = markers[0], bestDist = Infinity;
          for (const m of markers) {
            const d = (m.lat - rs.lat) ** 2 + (m.lon - rs.lon) ** 2;
            if (d < bestDist) { bestDist = d; best = m; }
          }
          const ele = eleAtKm(rs.km, me);
          return { km: rs.km, lat: rs.lat, lon: rs.lon, ele, tmin: best.tmin, tmax: best.tmax, prcp: best.prcp, wspd: best.wspd, wdir: best.wdir };
        })
        .sort((a, b) => a.km - b.km);
    }

    return [];
  }, [elevation, markers, forecast]);

  // Stops with km + relDay derived from markers (used for day transitions when no forecast)
  const markerStops = useMemo<{ km: number; relDay: number }[]>(() => {
    if (!elevation?.cityData || !markers.length) return [];
    const kmByCity = new Map(elevation.cityData.map((cd) => [cd.cityId, cd.km]));
    return markers
      .map((m) => {
        const km = kmByCity.get(m.id);
        if (km == null) return null;
        return { km, relDay: m.relDay };
      })
      .filter((p): p is { km: number; relDay: number } => p != null)
      .sort((a, b) => a.km - b.km);
  }, [elevation, markers]);

  // km range covered by actual forecast data
  const forecastKmMin = points.length > 0 ? points[0].km : Infinity;
  const forecastKmMax = points.length > 0 ? points[points.length - 1].km : -Infinity;

  // Dense climate points every ~18 km, outside the forecast window
  const denseClimatePoints = useMemo<ClimatePoint[]>(() => {
    if (!climatePoints.length || !miniElev.length) return [];
    const totalKm = miniElev[miniElev.length - 1][0];
    const STEP = 18;
    const result: ClimatePoint[] = [];
    for (let km = 0; km <= totalKm + STEP / 2; km += STEP) {
      const clampedKm = Math.min(km, totalKm);
      // skip km range covered by forecast
      if (clampedKm >= forecastKmMin - 5 && clampedKm <= forecastKmMax + 5) continue;
      const [lat, lon] = kmToLatLon(clampedKm, miniElev);
      const ele  = eleAtKm(clampedKm, miniElev);
      const tmin = climateInterpTemp(clampedKm, ele, "tmin", climatePoints) ?? 0;
      const tmax = climateInterpTemp(clampedKm, ele, "tmax", climatePoints) ?? 0;
      const prcp = climateInterp(clampedKm, "prcp", climatePoints) ?? 0;
      const wspd = climateInterp(clampedKm, "wspd", climatePoints) ?? 0;
      const wdir = climateWdirAt(clampedKm, climatePoints);
      result.push({ km: clampedKm, lat, lon, ele, tmin, tmax, prcp, wspd, wdir });
    }
    return result;
  }, [climatePoints, miniElev, forecastKmMin, forecastKmMax]);

  // Last km position with valid forecast data
  const forecastEndKm = useMemo(() => {
    if (!points.length) return null;
    let lastOkKm: number | null = null;
    for (let i = 0; i < points.length; i++) {
      if (data[String(i)]?.ok) lastOkKm = points[i].km;
    }
    return lastOkKm;
  }, [points, data]);

  // Keep stateRef current (used in event handlers)
  stateRef.current = { hourIdx, dailyMode, forecast, lang, climatePoints, showTempProfile, markerStops, startDay };

  const hourLabels = HOUR_STEPS.map((h) => t.forecastMap.hourLabel(h));

  const routeCoords = useMemo<[number, number][]>(
    () => miniElev.map(([, lat, lon]) => [lon, lat]),
    [miniElev]
  );

  const dayTransitions = useMemo(() => {
    const stops: { km: number; relDay: number }[] =
      routeStops.length > 0 ? routeStops : markerStops;
    if (stops.length < 2) return [];
    const result: { lat: number; lon: number; relDay: number }[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i], s1 = stops[i + 1];
      if (s1.relDay <= s0.relDay) continue;
      const firstDay = Math.ceil(s0.relDay + 1e-9);
      const lastDay = Math.floor(s1.relDay - 1e-9);
      for (let day = firstDay; day <= lastDay; day++) {
        const tv = (day - s0.relDay) / (s1.relDay - s0.relDay);
        const km = s0.km + tv * (s1.km - s0.km);
        const [lat, lon] = kmToLatLon(km, miniElev);
        result.push({ lat, lon, relDay: day });
      }
    }
    return result;
  }, [routeStops, climatePoints, miniElev]);

  const dayStep = mapZoom < 4 ? 10 : mapZoom < 5 ? 5 : mapZoom < 6 ? 3 : mapZoom < 7 ? 2 : 1;
  const visibleDayTransitions = useMemo(
    () => dayStep <= 1 ? dayTransitions : dayTransitions.filter(dt => dt.relDay % dayStep === 0),
    [dayTransitions, dayStep]
  );

  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || miniElev.length < 2) return;

    // Read design tokens from CSS custom properties
    const root = document.documentElement;
    const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    const hsl = (name: string) => `hsl(${cssVar(name)})`;

    const colBg     = hsl("--muted");
    const colGrid   = hsl("--border");
    const colAxis   = hsl("--muted-foreground");
    const colLine   = hsl("--chart-line");
    const colCursor = hsl("--chart-cursor");
    const colWarn   = hsl("--warn");
    const colDot    = hsl("--chart-1");
    const colText   = hsl("--foreground");
    const colCard   = hsl("--card");

    // Store tooltip colors for mouse-move handler
    chartStateRef.current = {
      ...chartStateRef.current,
      colAxisFallback: cssVar("--muted-foreground"),
      colTextResolved: cssVar("--foreground"),
    };

    const W = svg.parentElement?.offsetWidth || 600;
    const H = 200;
    const PL = 40, PR = 10, PT = 26, PB = 65;
    const cW = W - PL - PR, cH = H - PT - PB;
    const axY = PT + cH;

    const dataKmMin = miniElev[0][0], dataKmMax = miniElev[miniElev.length - 1][0];
    const kmMin = visibleKmRange ? Math.max(dataKmMin, visibleKmRange[0]) : dataKmMin;
    const kmMax = visibleKmRange ? Math.min(dataKmMax, visibleKmRange[1]) : dataKmMax;
    const visSlice = miniElev.filter(([km]) => km >= kmMin && km <= kmMax);
    const eles = (visSlice.length >= 2 ? visSlice : miniElev).map((p) => p[3]);
    const eMin = Math.max(0, Math.min(...eles) - 60);
    const eMax = Math.max(...eles) + 40;
    const eRange = eMax - eMin || 1;
    chartStateRef.current = { miniElev, kmMin, kmMax, eMin, eMax, eRange, PL, cW, PT, PB, cH, H };

    const xp = (km: number) => PL + ((km - kmMin) / (kmMax - kmMin)) * cW;
    const yp = (ele: number) => PT + cH - ((ele - eMin) / eRange) * cH;

    function interpTemp(km: number, ele: number): number | null {
      if (points.length && km >= points[0].km && km <= points[points.length - 1].km) {
        let ci = points.findIndex((p) => p.km >= km);
        if (ci < 0) ci = points.length - 1;
        if (ci === 0) ci = 1;
        const p0 = points[ci - 1], p1 = points[ci];
        const fd0 = data[String(ci - 1)], fd1 = data[String(ci)];
        if (fd0?.ok && fd1?.ok) {
          const h0 = fd0.hourly?.[String(currentHour)];
          const h1 = fd1.hourly?.[String(currentHour)];
          if (h0?.temp != null && h1?.temp != null) {
            const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
            const prcp = (h0.prcp || 0) + tv * ((h1.prcp || 0) - (h0.prcp || 0));
            const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
            const eleRef = p0.ele + tv * (p1.ele - p0.ele);
            return h0.temp + tv * (h1.temp - h0.temp) - (ele - eleRef) * lapse;
          }
        }
      }
      // Fall back to historical climate data for km outside forecast range
      const refKey = (currentHour === 0 || currentHour === 6 || currentHour === 24) ? "tmin" : "tmax";
      return climateInterpTemp(km, ele, refKey, climatePoints);
    }

    function interpTempByKey(km: number, ele: number, key: "tmax" | "tmin"): number | null {
      if (points.length && km >= points[0].km && km <= points[points.length - 1].km) {
        let ci = points.findIndex((p) => p.km >= km);
        if (ci < 0) ci = points.length - 1;
        if (ci === 0) ci = 1;
        const p0 = points[ci - 1], p1 = points[ci];
        const fd0 = data[String(ci - 1)], fd1 = data[String(ci)];
        if (fd0?.ok && fd1?.ok) {
          const d0 = fd0.daily, d1 = fd1.daily;
          if (d0?.[key] != null && d1?.[key] != null) {
            const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
            const eleRef = p0.ele + tv * (p1.ele - p0.ele);
            return d0[key]! + tv * (d1[key]! - d0[key]!) - (ele - eleRef) / 100;
          }
        }
      }
      // Fall back to historical climate data
      return climateInterpTemp(km, ele, key, climatePoints);
    }

    // ─── Temperature profile mode ─────────────────────────────────────────────
    if (showTempProfile) {
      const workSlice = visSlice.length >= 2 ? visSlice : miniElev;
      const chartRef2 = (currentHour === 0 || currentHour === 6 || currentHour === 24) ? desiredLow : desiredHigh;
      const desired2 = dailyMode ? (desiredHigh + desiredLow) / 2 : chartRef2;
      const temps2: (number | null)[] = workSlice.map(([km,,, e]) =>
        dailyMode
          ? (() => { const tx = interpTempByKey(km, e, "tmax"); const tn = interpTempByKey(km, e, "tmin"); return tx != null && tn != null ? (tx + tn) / 2 : tx ?? tn; })()
          : interpTemp(km, e)
      );
      const valid2 = temps2.filter((t): t is number => t !== null);
      const tMin2 = valid2.length > 0 ? Math.floor(Math.min(...valid2)) - 2 : -5;
      const tMax2 = valid2.length > 0 ? Math.ceil(Math.max(...valid2)) + 2 : 35;
      const tRange2 = tMax2 - tMin2 || 1;

      chartStateRef.current = {
        miniElev, kmMin, kmMax,
        tMin: tMin2, tMax: tMax2, tRange: tRange2,
        PL, cW, PT, PB, cH, H,
        showTempProfile: true,
        tempWorkSlice: workSlice,
        tempTemps: temps2,
        colAxisFallback: cssVar("--muted-foreground"),
        colTextResolved: cssVar("--foreground"),
      };

      const ypT = (t: number) => PT + cH - ((t - tMin2) / tRange2) * cH;
      const axY2 = PT + cH;

      let out2 = `<defs><clipPath id="fc-clip"><rect x="${PL}" y="${PT}" width="${cW}" height="${cH}"/></clipPath></defs>`;
      out2 += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${colBg}" rx="2"/>`;

      const tempTick2 = tRange2 <= 10 ? 2 : tRange2 <= 25 ? 5 : 10;
      for (let tv = Math.ceil(tMin2 / tempTick2) * tempTick2; tv <= tMax2; tv += tempTick2) {
        const y = ypT(tv);
        out2 += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${colGrid}" stroke-width="0.8"/>`;
        out2 += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8" fill="${colAxis}" font-family="sans-serif">${tv}°</text>`;
      }
      if (tMin2 < 0 && tMax2 > 0) {
        const y0 = ypT(0);
        out2 += `<line x1="${PL}" y1="${y0.toFixed(1)}" x2="${PL + cW}" y2="${y0.toFixed(1)}" stroke="${colAxis}" stroke-width="0.8" stroke-dasharray="4,3"/>`;
      }

      out2 += `<g clip-path="url(#fc-clip)">`;
      for (let i = 0; i < workSlice.length - 1; i++) {
        const [km0] = workSlice[i], [km1] = workSlice[i + 1];
        const t0 = temps2[i], t1 = temps2[i + 1];
        if (t0 == null || t1 == null) continue;
        const col2 = tempToRgb((t0 + t1) / 2, desired2, isDark);
        out2 += `<line x1="${xp(km0).toFixed(1)}" y1="${ypT(t0).toFixed(1)}" x2="${xp(km1).toFixed(1)}" y2="${ypT(t1).toFixed(1)}" stroke="${col2}" stroke-width="2.5" stroke-linecap="round"/>`;
      }
      out2 += `</g>`;

      // City labels
      for (const cd of (elevation?.cityData ?? [])) {
        if (cd.km < kmMin - 1 || cd.km > kmMax + 1) continue;
        const xv = xp(cd.km);
        out2 += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY2}" stroke="${colDot}" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>`;
        const safe = cd.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        out2 += `<text font-size="9.5" fill="${colText}" font-weight="600" text-anchor="end" font-family="sans-serif" transform="rotate(-38,${xv.toFixed(1)},${(axY2 + 14).toFixed(1)}) translate(${xv.toFixed(1)},${(axY2 + 14).toFixed(1)})">${safe}</text>`;
      }
      // Day markers from elevation.dayMarkers
      { let lastDmX2 = -Infinity;
        for (const [dmKm, dmDay] of (elevation?.dayMarkers ?? [])) {
          if (dmKm < kmMin - 1 || dmKm > kmMax + 1) continue;
          const xd = xp(dmKm);
          if (xd - lastDmX2 < 28) continue;
          lastDmX2 = xd;
          const lbl = lang === "de" ? `Tag ${dmDay}` : `Day ${dmDay}`;
          out2 += `<line x1="${xd.toFixed(1)}" y1="${PT}" x2="${xd.toFixed(1)}" y2="${axY2}" stroke="${colAxis}" stroke-width="0.6" stroke-dasharray="2,3" opacity="0.45"/>`;
          out2 += `<text x="${(xd + 1).toFixed(1)}" y="${(PT + 7).toFixed(1)}" font-size="6.5" fill="${colAxis}" font-family="sans-serif" opacity="0.6">${lbl}</text>`;
        }
      }
      if (forecastEndKm != null && forecastEndKm > kmMin && forecastEndKm < kmMax) {
        const xEnd = xp(forecastEndKm).toFixed(1);
        const fLabel = lang === "de" ? "Vorhersage" : "Forecast";
        out2 += `<line x1="${xEnd}" y1="${PT}" x2="${xEnd}" y2="${axY2}" stroke="${colWarn}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.9"/>`;
        out2 += `<text x="${(parseFloat(xEnd) + 3).toFixed(1)}" y="${(PT + 9).toFixed(1)}" font-size="8" fill="${colWarn}" font-weight="600" font-family="sans-serif">☁ ${fLabel}</text>`;
      }
      out2 += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY2}" stroke="${colAxis}" stroke-width="1"/>`;
      out2 += `<line x1="${PL}" y1="${axY2}" x2="${PL + cW}" y2="${axY2}" stroke="${colAxis}" stroke-width="1"/>`;
      out2 += `<line id="fc-cursor" x1="0" y1="${PT}" x2="0" y2="${axY2}" stroke="${colCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
      out2 += `<circle id="fc-cursor-dot" cx="0" cy="0" r="3.5" fill="${colCursor}" stroke="${colCard}" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("height", String(H));
      svg.innerHTML = out2;
      return;
    }
    // ─── Elevation profile mode ───────────────────────────────────────────────

    let out = `<defs><clipPath id="fc-clip"><rect x="${PL}" y="${PT}" width="${cW}" height="${cH}"/></clipPath></defs>`;
    const BAND = 10;

    // Background rect
    out += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="${colBg}" rx="2"/>`;

    // Y-axis grid lines with labels
    const yTick = eMax <= 200 ? 50 : eMax <= 500 ? 100 : eMax <= 1000 ? 200 : eMax <= 2500 ? 500 : 1000;
    for (let e = Math.ceil(eMin / yTick) * yTick; e <= eMax; e += yTick) {
      const y = yp(e);
      out += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + cW}" y2="${y.toFixed(1)}" stroke="${colGrid}" stroke-width="0.8"/>`;
      out += `<text x="${(PL - 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${colAxis}" font-family="sans-serif">${e}m</text>`;
    }

    out += `<g clip-path="url(#fc-clip)" shape-rendering="crispEdges">`;
    if (dailyMode) {
      for (let i = 0; i < miniElev.length - 1; i++) {
        const [km0,,, e0] = miniElev[i], [km1,,, e1] = miniElev[i + 1];
        const mk = (km0 + km1) / 2, me = (e0 + e1) / 2;
        const tmaxV = interpTempByKey(mk, me, "tmax");
        const tminV = interpTempByKey(mk, me, "tmin");
        const hasData = tmaxV != null || tminV != null;
        const w = xp(km1) - xp(km0);
        out += `<polygon points="${xp(km0)},${yp(e0)} ${xp(km1)},${yp(e1)} ${xp(km1)},${axY} ${xp(km0)},${axY}" fill="${hasData ? colGrid : colBg}" opacity="0.8"/>`;
        if (tmaxV != null) out += `<rect x="${xp(km0)}" y="${PT}" width="${w}" height="${BAND}" fill="${tempToRgb(tmaxV, desiredHigh, isDark)}" opacity="0.9"/>`;
        if (tminV != null) out += `<rect x="${xp(km0)}" y="${PT+BAND+1}" width="${w}" height="${BAND}" fill="${tempToRgb(tminV, desiredLow, isDark)}" opacity="0.9"/>`;
      }
      const outline = miniElev.map((p) => `${xp(p[0])},${yp(p[3])}`).join(" ");
      out += `<polyline points="${outline}" fill="none" stroke="${colLine}" stroke-width="1.2"/>`;
      out += `<text x="${W-PR-2}" y="${PT+8}" text-anchor="end" font-size="8" fill="${colWarn}" font-family="sans-serif">☀Tmax</text>`;
      out += `<text x="${W-PR-2}" y="${PT+20}" text-anchor="end" font-size="8" fill="${hsl("--chart-1")}" font-family="sans-serif">☽Tmin</text>`;
    } else {
      const chartRef = (currentHour === 0 || currentHour === 6 || currentHour === 24) ? desiredLow : desiredHigh;
      for (let i = 0; i < miniElev.length - 1; i++) {
        const [km0,,, e0] = miniElev[i], [km1,,, e1] = miniElev[i + 1];
        const tmid = interpTemp((km0 + km1) / 2, (e0 + e1) / 2);
        const col = tmid != null ? tempToRgb(tmid, chartRef, isDark) : colBg;
        out += `<polygon points="${xp(km0)},${yp(e0)} ${xp(km1)},${yp(e1)} ${xp(km1)},${axY} ${xp(km0)},${axY}" fill="${col}" opacity="0.85"/>`;
      }
      const outline = miniElev.map((p) => `${xp(p[0])},${yp(p[3])}`).join(" ");
      out += `<polyline points="${outline}" fill="none" stroke="${colLine}" stroke-width="1.2"/>`;
    }
    out += `</g>`;

    // City dots and angled name labels
    const cityData = elevation?.cityData ?? [];
    for (const cd of cityData) {
      if (cd.km < kmMin - 1 || cd.km > kmMax + 1) continue;
      const xv = xp(cd.km);
      let dotEle = cd.ele;
      const mi = miniElev.findIndex(([km]) => km >= cd.km);
      if (mi > 0) {
        const [mk0,,, me0] = miniElev[mi - 1], [mk1,,, me1] = miniElev[mi];
        const tv = mk1 > mk0 ? (cd.km - mk0) / (mk1 - mk0) : 0;
        dotEle = me0 + tv * (me1 - me0);
      }
      const dotY = yp(dotEle);
      out += `<line x1="${xv.toFixed(1)}" y1="${PT}" x2="${xv.toFixed(1)}" y2="${axY}" stroke="${colDot}" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
      out += `<circle cx="${xv.toFixed(1)}" cy="${dotY.toFixed(1)}" r="3.5" fill="${colCard}" stroke="${colDot}" stroke-width="1.8"/>`;
      const safe = cd.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      out += `<text font-size="9.5" fill="${colText}" font-weight="600" text-anchor="end" font-family="sans-serif" transform="rotate(-38,${xv.toFixed(1)},${(axY + 14).toFixed(1)}) translate(${xv.toFixed(1)},${(axY + 14).toFixed(1)})">${safe}</text>`;
    }

    // Day markers from elevation.dayMarkers
    const MIN_DM_PX = 28;
    let lastDmX = -Infinity;
    for (const [dmKm, dmDay] of (elevation?.dayMarkers ?? [])) {
      if (dmKm < kmMin - 1 || dmKm > kmMax + 1) continue;
      const xd = xp(dmKm);
      if (xd - lastDmX < MIN_DM_PX) continue;
      lastDmX = xd;
      const lbl = lang === "de" ? `Tag ${dmDay}` : `Day ${dmDay}`;
      out += `<line x1="${xd.toFixed(1)}" y1="${PT}" x2="${xd.toFixed(1)}" y2="${axY}" stroke="${colAxis}" stroke-width="0.6" stroke-dasharray="2,3" opacity="0.45"/>`;
      out += `<text x="${(xd + 1).toFixed(1)}" y="${(PT + 7).toFixed(1)}" font-size="6.5" fill="${colAxis}" font-family="sans-serif" opacity="0.6">${lbl}</text>`;
    }

    // Forecast end boundary line
    if (forecastEndKm != null && forecastEndKm > kmMin && forecastEndKm < kmMax) {
      const xEnd = xp(forecastEndKm).toFixed(1);
      const fLabel = lang === "de" ? "Vorhersage" : "Forecast";
      out += `<line x1="${xEnd}" y1="${PT}" x2="${xEnd}" y2="${axY}" stroke="${colWarn}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.9"/>`;
      out += `<text x="${(parseFloat(xEnd) + 3).toFixed(1)}" y="${(PT + 9).toFixed(1)}" font-size="8" fill="${colWarn}" font-weight="600" font-family="sans-serif">☁ ${fLabel}</text>`;
    }

    // Axis lines
    out += `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${axY}" stroke="${colAxis}" stroke-width="1"/>`;
    out += `<line x1="${PL}" y1="${axY}" x2="${PL + cW}" y2="${axY}" stroke="${colAxis}" stroke-width="1"/>`;

    out += `<line id="fc-cursor" x1="0" y1="${PT}" x2="0" y2="${axY}" stroke="${colCursor}" stroke-width="1" stroke-dasharray="3,2" visibility="hidden"/>`;
    out += `<circle id="fc-cursor-dot" cx="0" cy="0" r="3.5" fill="${colCursor}" stroke="${colCard}" stroke-width="1.5" opacity="0.9" visibility="hidden"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", String(H));
    svg.innerHTML = out;
  }, [miniElev, dailyMode, currentHour, points, data, desiredHigh, desiredLow, visibleKmRange, climatePoints, elevation, forecastEndKm, lang, showTempProfile, isDark]);

  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [drawChart]);

  // Re-draw after fullscreen toggle or expand — SVG element is remounted
  useEffect(() => {
    drawChart();
  }, [isFullscreen, elevExpanded, drawChart]);

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

    const cps = stateRef.current.climatePoints;

    function interpTemp(km: number, ele: number): number | null {
      if (pts.length && km >= pts[0].km && km <= pts[pts.length - 1].km) {
        let ci = pts.findIndex((p) => p.km >= km);
        if (ci < 0) ci = pts.length - 1;
        if (ci === 0) ci = 1;
        const p0 = pts[ci-1], p1 = pts[ci];
        const fd0 = dt[String(ci-1)], fd1 = dt[String(ci)];
        if (fd0?.ok && fd1?.ok) {
          const h0 = fd0.hourly?.[String(hour)], h1 = fd1.hourly?.[String(hour)];
          if (h0?.temp != null && h1?.temp != null) {
            const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
            const prcp = (h0.prcp || 0) + tv * ((h1.prcp || 0) - (h0.prcp || 0));
            const lapse = (1 - 0.4 * Math.min(1, prcp / 5)) / 100;
            return h0.temp + tv * (h1.temp - h0.temp) - (ele - (p0.ele + tv*(p1.ele-p0.ele))) * lapse;
          }
        }
      }
      const refKey = (hour === 0 || hour === 6 || hour === 24) ? "tmin" : "tmax";
      return climateInterpTemp(km, ele, refKey, cps);
    }

    function interpByKey(km: number, ele: number, key: "tmax" | "tmin"): number | null {
      if (pts.length && km >= pts[0].km && km <= pts[pts.length - 1].km) {
        let ci = pts.findIndex((p) => p.km >= km);
        if (ci < 0) ci = pts.length - 1;
        if (ci === 0) ci = 1;
        const p0 = pts[ci-1], p1 = pts[ci];
        const fd0 = dt[String(ci-1)], fd1 = dt[String(ci)];
        if (fd0?.ok && fd1?.ok) {
          const d0 = fd0.daily, d1 = fd1.daily;
          if (d0?.[key] != null && d1?.[key] != null) {
            const tv = p1.km > p0.km ? (km - p0.km) / (p1.km - p0.km) : 0;
            return d0[key]! + tv*(d1[key]!-d0[key]!) - (ele - (p0.ele+tv*(p1.ele-p0.ele))) / 100;
          }
        }
      }
      return climateInterpTemp(km, ele, key, cps);
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
    let cy: number;
    if (cs.showTempProfile && cs.tempWorkSlice && cs.tempTemps) {
      let bi2 = 0, bd2 = Infinity;
      for (let ii = 0; ii < (cs.tempWorkSlice as [number, ...number[]][]).length; ii++) {
        const d2 = Math.abs(cs.tempWorkSlice[ii][0] - km);
        if (d2 < bd2) { bd2 = d2; bi2 = ii; }
      }
      const t2 = cs.tempTemps[bi2] as number | null;
      cy = t2 != null ? cs.PT + cs.cH - ((t2 - cs.tMin) / cs.tRange) * cs.cH : cs.PT + cs.cH / 2;
    } else {
      cy = cs.PT + cs.cH - ((ele - cs.eMin) / cs.eRange) * cs.cH;
    }
    const cl = svg.querySelector("#fc-cursor");
    if (cl) { cl.setAttribute("x1", String(cx)); cl.setAttribute("x2", String(cx)); cl.setAttribute("visibility", "visible"); }
    const cdot = svg.querySelector("#fc-cursor-dot");
    if (cdot) { cdot.setAttribute("cx", String(cx)); cdot.setAttribute("cy", String(cy)); cdot.setAttribute("visibility", "visible"); }

    const colMuted = cs?.colAxisFallback ? `hsl(${cs.colAxisFallback})` : "hsl(var(--muted-foreground))";
    const colFg = cs?.colTextResolved ? `hsl(${cs.colTextResolved})` : "hsl(var(--foreground))";
    let ttHtml = `<div style="color:${colMuted};font-size:9px;margin-bottom:2px">km ${Math.round(km)}</div>`;
    ttHtml += `<div style="color:${colFg}">⛰ ${Math.round(ele)} m</div>`;
    // Date at hovered km — forecast area uses day_offset, historical area uses markerStops
    {
      const { forecast: fc, lang: lg, markerStops: ms, startDay: sd } = stateRef.current;
      const pts = fc?.points ?? [];
      if (pts.length > 0 && km >= pts[0].km) {
        let pi = pts.findIndex((p) => p.km >= km);
        if (pi < 0) pi = pts.length - 1;
        const p0 = pi > 0 ? pts[pi - 1] : pts[0];
        const p1 = pts[Math.min(pi, pts.length - 1)];
        const tv = p1.km > p0.km ? Math.max(0, Math.min(1, (km - p0.km) / (p1.km - p0.km))) : 0;
        const offset = Math.round(p0.day_offset + tv * (p1.day_offset - p0.day_offset));
        const target = new Date();
        target.setDate(target.getDate() + offset);
        const jan0 = new Date(target.getFullYear(), 0, 0);
        const absDay = Math.floor((target.getTime() - jan0.getTime()) / 86400000);
        ttHtml += `<div style="color:${colMuted};font-size:9px">${dayToShortDE(absDay, lg)}</div>`;
      } else if (ms && ms.length >= 2) {
        let mi = ms.findIndex((s: { km: number; relDay: number }) => s.km >= km);
        if (mi < 0) mi = ms.length - 1;
        if (mi === 0) mi = 1;
        const s0 = ms[mi - 1], s1 = ms[mi];
        const tv = s1.km > s0.km ? Math.max(0, Math.min(1, (km - s0.km) / (s1.km - s0.km))) : 0;
        const relDay = s0.relDay + tv * (s1.relDay - s0.relDay);
        const absDay = ((sd + Math.round(relDay) - 1 + 3650) % 365) + 1;
        ttHtml += `<div style="color:${colMuted};font-size:9px">${dayToShortDE(absDay, lg)}</div>`;
      }
    }
    if (dailyMode) {
      const tmax = interpByKey(km, ele, "tmax");
      const tmin = interpByKey(km, ele, "tmin");
      const ttDark = document.documentElement.classList.contains("dark");
      if (tmax != null) ttHtml += `<div style="color:${tempToRgb(tmax, dHigh, ttDark)}">☀ Tmax: ${tmax.toFixed(1)}°C</div>`;
      if (tmin != null) ttHtml += `<div style="color:${tempToRgb(tmin, dLow, ttDark)}">☽ Tmin: ${tmin.toFixed(1)}°C</div>`;
    } else {
      const ttDark = document.documentElement.classList.contains("dark");
      const chartRef = (hour === 0 || hour === 6 || hour === 24) ? dLow : dHigh;
      const temp = interpTemp(km, ele);
      if (temp != null) ttHtml += `<div style="color:${tempToRgb(temp, chartRef, ttDark)}">🌡 ${temp.toFixed(1)}°C</div>`;
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

    setHoveredKm(km);
  }

  function onChartMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    const svg = svgRef.current;
    if (svg) {
      svg.querySelector("#fc-cursor")?.setAttribute("visibility", "hidden");
      svg.querySelector("#fc-cursor-dot")?.setAttribute("visibility", "hidden");
    }
    setHoveredKm(null);
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
      const d = (fd.daily ?? {}) as ForecastDailyData;
      if (d.tmax != null) lines.push(`${lbl("#f97316","☀ Tmax:")} ${val(d.tmax.toFixed(1)+"°C")}<br>`);
      if (d.tmin != null) lines.push(`${lbl("#3b82f6","☽ Tmin:")} ${val(d.tmin.toFixed(1)+"°C")}<br>`);
      if (d.prcp != null) lines.push(`${lbl("#60a5fa","☂ Regen:")} ${val(d.prcp.toFixed(1)+" mm/Tag")}<br>`);
      if (d.wspd != null) lines.push(`${lbl("#6b7280","☴ Windmax:")} ${val(d.wspd.toFixed(1)+" km/h")}<br>`);
      if (d.sun  != null) lines.push(`${lbl("#f59e0b","☀ Sonne:")} ${val(d.sun.toFixed(1)+" h")}<br>`);
    } else {
      const h = (fd.hourly?.[String(currentHour)] ?? {}) as ForecastHourData;
      lines.push(`<b style="color:#1e293b">${t.forecastMap.hourLabel(currentHour)}</b><br>`);
      if (h.temp  != null) {
        const tColor = tempToRgb(h.temp, desiredAvg, document.documentElement.classList.contains("dark"));
        lines.push(`${lbl("#64748b","Temp:")} <b style="color:${tColor}">${h.temp.toFixed(1)}°C</b><br>`);
      }
      if (h.prcp  != null) lines.push(`${lbl("#60a5fa","☂:")} ${val(h.prcp.toFixed(1)+" mm/h")}<br>`);
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

  function buildClimatePopupContent(cp: ClimatePoint): string {
    const lbl = (color: string, text: string) =>
      `<span style="color:${color};font-weight:600">${text}</span>`;
    const val = (text: string) => `<b style="color:#1e293b">${text}</b>`;
    const rb = routeBearingAt(cp.km, miniElev);
    const climateLabel = lang === "de" ? "Klimadaten 1991–2020" : "Climate data 1991–2020";
    const rainLabel = lang === "de" ? "Regen:" : "Rain:";
    const lines = [`<div style="font-family:sans-serif;min-width:150px;font-size:12px;color:#475569">`];
    lines.push(`<b style="color:#1e293b">km ${Math.round(cp.km)}</b>`);
    lines.push(`<br><span style="color:#94a3b8">${climateLabel}</span>`);
    lines.push(`<hr style="margin:6px 0;border-color:#e2e8f0">`);
    lines.push(`${lbl("#f97316","☀ Tmax:")} ${val(cp.tmax.toFixed(1)+"°C")}<br>`);
    lines.push(`${lbl("#3b82f6","☽ Tmin:")} ${val(cp.tmin.toFixed(1)+"°C")}<br>`);
    if (cp.prcp > 0.05) lines.push(`${lbl("#60a5fa","☂ "+rainLabel)} ${val(cp.prcp.toFixed(1)+" mm/Tag")}<br>`);
    if (cp.wspd > 0) {
      const dirStr = rb != null
        ? ` <span style="color:${windArrowColor(cp.wdir, rb)};font-weight:700">${compassDir16(cp.wdir)}</span>`
        : ` ${compassDir16(cp.wdir)}`;
      lines.push(`${lbl("#6b7280","☴ Wind:")} ${val(cp.wspd.toFixed(1)+" km/h")}${dirStr}<br>`);
    }
    lines.push("</div>");
    return lines.join("");
  }

  // No forecast AND no elevation data to build a fallback map → show info/error
  if (!forecast && miniElev.length < 2) {
    const msg = forecastError ?? t.forecastMap.noForecast;
    const isError = !!forecastError;
    return (
      <div className={[
        "rounded-2xl border px-6 py-8 text-sm",
        isError
          ? "border-warn/30 bg-warn/10 text-foreground"
          : "border-border bg-muted/30 text-muted-foreground flex h-64 items-center justify-center",
      ].join(" ")}>
        {isError && <div className="mb-1 font-semibold">⚠ Vorhersage nicht verfügbar</div>}
        <div>{msg}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-2 sm:space-y-3 sm:p-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">{t.forecastMap.time}</span>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {HOUR_STEPS.map((h, i) => (
            <button
              key={h}
              onClick={() => { setHourIdx(i); setDailyMode(false); }}
              className={[
                "border-r border-border px-3 py-1.5 text-xs font-medium last:border-r-0 transition-colors",
                !dailyMode && hourIdx === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
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
              : "border-border bg-card text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {t.forecastMap.dailyOverview}
        </button>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          {!dailyMode && (<>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="-6 -6 12 12"><polygon points="0,-6 -2.5,-1 2.5,-1" fill="rgb(0,180,20)"/><line x1="0" y1="4" x2="0" y2="-1" stroke="rgb(0,180,20)" strokeWidth="2" strokeLinecap="round"/></svg>
              {t.forecastMap.tailwind}
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="-6 -6 12 12"><polygon points="0,-6 -2.5,-1 2.5,-1" fill="rgb(220,0,20)"/><line x1="0" y1="4" x2="0" y2="-1" stroke="rgb(220,0,20)" strokeWidth="2" strokeLinecap="round"/></svg>
              {t.forecastMap.headwind}
            </span>
          </>)}
        </div>
      </div>

      {/* Map */}
      <MapView theme="light" center={[10, 48]} zoom={5} className="h-[450px] w-full rounded-xl lg:h-[550px]">
        <FitBounds coordinates={routeCoords} />
        <ZoomTracker onZoom={handleZoom} />
        <MapRoute id="forecast-route" coordinates={routeCoords} color="rgba(220,60,40,0.7)" width={3} opacity={0.85} />
        {hoveredModelKmRange && forecast && (() => {
          const [ks, ke] = hoveredModelKmRange;
          const me = forecast.miniElev;
          const coords: [number, number][] = [];
          const s = kmToLatLon(ks, me); coords.push([s[1], s[0]]);
          for (const [km, lat, lon] of me) { if (km > ks && km < ke) coords.push([lon, lat]); }
          const e = kmToLatLon(ke, me); coords.push([e[1], e[0]]);
          return coords.length >= 2
            ? <MapRoute id="model-highlight" coordinates={coords} color="rgba(255,210,0,0.95)" width={5} opacity={0.9} />
            : null;
        })()}

        {visibleDayTransitions.map((dt, i) => (
          <MapMarker key={`dt-${i}`} longitude={dt.lon} latitude={dt.lat}>
            <MarkerContent>
              <div className="rounded border border-border bg-card/90 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm whitespace-nowrap backdrop-blur-sm">
                {relDayToLabel(dt.relDay, startDay, lang)}
              </div>
            </MarkerContent>
          </MapMarker>
        ))}

        {routeStops.map((s, i) => (
          <MapMarker key={`stop-${i}`} longitude={s.lon} latitude={s.lat}>
            <MarkerContent>
              <div
                className="flex size-7 cursor-pointer items-center justify-center rounded-full border-2 text-[9px] font-bold shadow-md"
                style={{ background: "hsl(var(--primary))", borderColor: "hsl(var(--chart-1))", color: "hsl(var(--primary-foreground))" }}
              >
                {relDayToCircle(s.relDay, startDay)}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{relDayToLabel(s.relDay, startDay, lang)}</p>
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

        <ClimateMarkers
          points={denseClimatePoints}
          miniElev={miniElev}
          currentHour={currentHour}
          dailyMode={dailyMode}
          desiredHigh={desiredHigh}
          desiredLow={desiredLow}
          buildPopupContent={buildClimatePopupContent}
        />

        {forecastEndKm != null && (() => {
          const [lat, lon] = kmToLatLon(forecastEndKm, miniElev);
          return lat !== 0 ? (
            <MapMarker longitude={lon} latitude={lat}>
              <MarkerContent>
                <div className="flex items-center gap-1 rounded border-2 border-warn/70 bg-card/90 px-1.5 py-0.5 text-[9px] font-bold text-warn shadow-md whitespace-nowrap backdrop-blur-sm">
                  <Cloud className="h-3 w-3 shrink-0" />{t.routeMap.forecastEnd} · {Math.round(forecastEndKm)} km
                </div>
              </MarkerContent>
            </MapMarker>
          ) : null;
        })()}

        <HoverDotFM miniElev={miniElev} />
        <MapBoundsForecastTracker miniElev={miniElev} />

        <MapControls position="bottom-right" showFullscreen />

        {isFullscreen && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div
              className="flex cursor-pointer items-center justify-between gap-3 border-t border-border bg-card/90 px-3 py-1 backdrop-blur-sm"
              onClick={() => setElevExpanded((v) => !v)}
            >
              <span className="text-xs font-medium text-muted-foreground shrink-0">{t.routeMap.elevTitle}</span>
              <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {HOUR_STEPS.map((h, i) => (
                    <button
                      key={h}
                      onClick={() => { setHourIdx(i); setDailyMode(false); }}
                      className={[
                        "border-r border-border px-2 py-0.5 text-[11px] font-medium last:border-r-0 transition-colors",
                        !dailyMode && hourIdx === i
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:bg-muted",
                      ].join(" ")}
                    >
                      {hourLabels[i]}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setDailyMode((d) => !d)}
                  className={[
                    "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    dailyMode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {t.forecastMap.dailyOverview}
                </button>
              </div>
              {elevExpanded
                ? <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                : <ChevronUp className="size-4 text-muted-foreground shrink-0" />}
            </div>
            {elevExpanded && (
              <div className="bg-card/95 p-2">
                <div className="mb-1 flex justify-end">
                  <div className="flex overflow-hidden rounded-md border border-border">
                    <button
                      onClick={() => setShowTempProfile(false)}
                      className={["border-r border-border px-2.5 py-1 text-[11px] font-medium transition-colors", !showTempProfile ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"].join(" ")}
                    >
                      {lang === "de" ? "Höhenprofil" : "Elevation"}
                    </button>
                    <button
                      onClick={() => setShowTempProfile(true)}
                      className={["px-2.5 py-1 text-[11px] font-medium transition-colors", showTempProfile ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"].join(" ")}
                    >
                      {lang === "de" ? "Temperaturprofil" : "Temperature"}
                    </button>
                  </div>
                </div>
                <div
                  className="relative w-full overflow-hidden rounded-lg border border-border bg-card"
                  onMouseMove={onChartMouseMove}
                  onMouseLeave={onChartMouseLeave}
                >
                  <svg ref={svgRef} width="100%" height="200" style={{ display: "block" }} />
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
                <div className="mt-1 flex items-center gap-2 px-10 text-[9px] text-muted-foreground">
                  <span>{t.routeMap.elevCold}</span>
                  <div className="h-2 flex-1 rounded-full" style={{ background: legendGradient(isDark) }} />
                  <span>{t.routeMap.elevWarm}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </MapView>

      {/* Elevation / Temperature chart - shown below map when not fullscreen */}
      {!isFullscreen && (
        <div className="rounded-lg border border-border bg-card p-1">
          <div className="flex justify-end p-1 pb-0">
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setShowTempProfile(false)}
                className={[
                  "border-r border-border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  !showTempProfile ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {lang === "de" ? "Höhenprofil" : "Elevation"}
              </button>
              <button
                onClick={() => setShowTempProfile(true)}
                className={[
                  "px-2.5 py-1 text-[11px] font-medium transition-colors",
                  showTempProfile ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {lang === "de" ? "Temperaturprofil" : "Temperature"}
              </button>
            </div>
          </div>
          <div
            className="relative w-full overflow-hidden"
            onMouseMove={onChartMouseMove}
            onMouseLeave={onChartMouseLeave}
          >
            <svg ref={svgRef} width="100%" height="200" style={{ display: "block" }} />
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
          <div className="mt-1 flex items-center gap-2 px-10 text-[9px] text-muted-foreground">
            <span>{t.routeMap.elevCold}</span>
            <div className="h-2 flex-1 rounded-full" style={{ background: legendGradient(isDark) }} />
            <span>{t.routeMap.elevWarm}</span>
          </div>
        </div>
      )}
    </div>
  );
}
