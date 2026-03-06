import type { GpxWeatherPoint } from "@/api/types";
import { tempToRgb } from "@/utils/tempColor";
import { windDegreesToDirection } from "@/utils/constants";
import { useT } from "@/i18n/useT";

function wxSymbol(prcp: number | null, cloud: number | null): string {
  if (prcp != null && prcp >= 0.3) return "☂";
  if (cloud != null) return cloud >= 60 ? "☁" : "☀";
  if (prcp != null && prcp >= 0.05) return "☁";
  return "☀";
}

function TypeBadge({ type }: { type: GpxWeatherPoint["type"] }) {
  const t = useT();
  const labels: Record<string, string> = {
    pass: `⛰ ${t.gpx.results.typePass}`,
    valley: `↓ ${t.gpx.results.typeValley}`,
    regular: `→ ${t.gpx.results.typeRegular}`,
    start: "▶ Start",
    end: "■ Ende",
  };
  const colors: Record<string, string> = {
    pass: "bg-orange-100 text-orange-700",
    valley: "bg-blue-100 text-blue-700",
    regular: "bg-gray-100 text-gray-600",
    start: "bg-green-100 text-green-700",
    end: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[type] ?? ""}`}>
      {labels[type] ?? type}
    </span>
  );
}

function SourceBadge({ isForecast }: { isForecast: boolean }) {
  const t = useT();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        isForecast ? "bg-sky-100 text-sky-700" : "bg-purple-100 text-purple-700"
      }`}
    >
      {isForecast ? t.gpx.results.sourceForecast : t.gpx.results.sourceClimatic}
    </span>
  );
}

export function GpxWeatherTable({ weatherPoints }: { weatherPoints: GpxWeatherPoint[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 border-b border-border bg-background">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">km</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Typ</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Höhe</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ankunft</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Temp</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wetter</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">☂ mm/h</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wind</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Quelle</th>
          </tr>
        </thead>
        <tbody>
          {weatherPoints.map((wp, i) => {
            const arrival = new Date(wp.arrivalTime).toLocaleString(undefined, {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                <td className="px-3 py-1.5 tabular-nums">{Math.round(wp.km)}</td>
                <td className="px-3 py-1.5">
                  <TypeBadge type={wp.type} />
                </td>
                <td className="px-3 py-1.5 tabular-nums">{Math.round(wp.ele)} m</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{arrival}</td>
                <td
                  className="px-3 py-1.5 tabular-nums font-semibold"
                  style={{
                    color: wp.temp != null ? tempToRgb(wp.temp, 20) : undefined,
                  }}
                >
                  {wp.temp != null ? `${wp.temp.toFixed(1)}°` : "—"}
                </td>
                <td className="px-3 py-1.5">
                  <span>{wxSymbol(wp.prcp, wp.cloud)}</span>
                  {wp.cloud != null && (
                    <span className="ml-1 text-muted-foreground">{wp.cloud}%</span>
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums">
                  {wp.prcp != null ? wp.prcp.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {wp.wspd != null
                    ? `${Math.round(wp.wspd)} km/h${wp.wdir != null ? ` ${windDegreesToDirection(wp.wdir)}` : ""}`
                    : "—"}
                </td>
                <td className="px-3 py-1.5">
                  <SourceBadge isForecast={wp.isForecast} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
