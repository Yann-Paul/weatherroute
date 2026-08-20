import JSZip from "jszip";
import type { MapPoi, RoutePlannerPoint } from "@/api/types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildWaypoints(pois: MapPoi[]): string {
  return pois
    .map((p) => {
      const label = p.name ?? p.subtype ?? p.category;
      return `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">
    <name>${escapeXml(label)}</name>
    <type>${escapeXml(p.category)}</type>
  </wpt>`;
    })
    .join("\n");
}

/** Serialize a routed track (plus optional POI waypoints) as a GPX 1.1 document. */
export function buildGpx(coords: RoutePlannerPoint[], name: string, pois?: MapPoi[]): string {
  const trkpts = coords
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`)
    .join("\n");
  const wpts = pois?.length ? `${buildWaypoints(pois)}\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WeatherRoute" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
${wpts}  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Trigger a browser download of the given blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of the given track (plus optional POI waypoints) as a .gpx file. */
export function downloadGpx(coords: RoutePlannerPoint[], name: string, pois?: MapPoi[]): void {
  const blob = new Blob([buildGpx(coords, name, pois)], { type: "application/gpx+xml" });
  downloadBlob(blob, `${name}.gpx`);
}

export interface GpxZipEntry {
  name: string;
  coords: RoutePlannerPoint[];
  pois?: MapPoi[];
}

/** Bundle multiple route segments as individual .gpx files inside a single .zip. */
export async function buildGpxZip(entries: GpxZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(`${entry.name}.gpx`, buildGpx(entry.coords, entry.name, entry.pois));
  }
  return zip.generateAsync({ type: "blob" });
}

/** Trigger a browser download of multiple route segments bundled as one .zip of .gpx files. */
export async function downloadGpxZip(entries: GpxZipEntry[], zipName: string): Promise<void> {
  const blob = await buildGpxZip(entries);
  downloadBlob(blob, `${zipName}.zip`);
}
