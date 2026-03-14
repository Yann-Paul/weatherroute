import type { ReactNode } from "react";
import type { GpxWeatherPoint } from "@/api/types";
import { tempToRgb } from "@/utils/tempColor";
import { windDegreesToDirection } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import { CloudRain, Cloud, Sun, Mountain, ArrowDown, ArrowRight, Play, Square, Moon } from "lucide-react";

function WxSymbol({ prcp, cloud }: { prcp: number | null; cloud: number | null }): ReactNode {
  if (prcp != null && prcp >= 0.3) return <CloudRain className="inline h-3.5 w-3.5 text-chart-1" />;
  if (cloud != null) return cloud >= 60 ? <Cloud className="inline h-3.5 w-3.5 text-muted-foreground" /> : <Sun className="inline h-3.5 w-3.5 text-warn" />;
  if (prcp != null && prcp >= 0.05) return <Cloud className="inline h-3.5 w-3.5 text-muted-foreground" />;
  return <Sun className="inline h-3.5 w-3.5 text-warn" />;
}

function TypeBadge({ type }: { type: GpxWeatherPoint["type"] }) {
  const t = useT();
  const labels: Record<string, ReactNode> = {
    pass: <><Mountain className="inline h-3 w-3 mr-0.5" />{t.gpx.results.typePass}</>,
    valley: <><ArrowDown className="inline h-3 w-3 mr-0.5" />{t.gpx.results.typeValley}</>,
    regular: <><ArrowRight className="inline h-3 w-3 mr-0.5" />{t.gpx.results.typeRegular}</>,
    start: <><Play className="inline h-3 w-3 mr-0.5" />Start</>,
    end: <><Square className="inline h-3 w-3 mr-0.5" />Ende</>,
    stop: <><Moon className="inline h-3 w-3 mr-0.5" />Stop</>,
  };
  const colors: Record<string, string> = {
    pass: "bg-warn/15 text-warn",
    valley: "bg-chart-1/15 text-chart-1",
    regular: "bg-muted text-muted-foreground",
    start: "bg-good/15 text-good",
    end: "bg-muted text-muted-foreground",
    stop: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${colors[type] ?? ""}`}>
      {labels[type] ?? type}
    </span>
  );
}

function SourceBadge({ isForecast }: { isForecast: boolean }) {
  const t = useT();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        isForecast
          ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
          : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
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
            <th className="px-3 py-2 text-left font-medium text-muted-foreground"><Moon className="inline h-3.5 w-3.5 mr-0.5" />Pause</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Temp</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wetter</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground"><CloudRain className="inline h-3.5 w-3.5" /> mm/h</th>
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
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                  {wp.type === "stop" && wp.stopTime && wp.nextStartTime
                    ? wp.stopTime.slice(11, 16) + "–" + wp.nextStartTime.slice(11, 16)
                    : "—"}
                </td>
                <td
                  className="px-3 py-1.5 tabular-nums font-semibold"
                  style={{
                    color: wp.temp != null ? tempToRgb(wp.temp, 20) : undefined,
                  }}
                >
                  {wp.temp != null ? `${wp.temp.toFixed(1)}°` : "—"}
                </td>
                <td className="px-3 py-1.5">
                  <span><WxSymbol prcp={wp.prcp} cloud={wp.cloud} /></span>
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
