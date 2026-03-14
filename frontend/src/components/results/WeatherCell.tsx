import { memo } from "react";
import { Moon, Sun, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getWeatherScore, scoreToVariant } from "@/utils/weatherScoring";
import { windDegreesToDirection } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import type { WeatherOffsetData } from "@/api/types";

interface WeatherCellProps {
  cityName: string;
  date?: string;
  isRestDay: boolean;        // true = this is a rest-day row (not arrival)
  restDayOffset?: number;    // 1, 2, ... for rest days
  data: WeatherOffsetData | null;
  desiredHigh: number;
  desiredLow: number;
}

export const WeatherCell = memo(function WeatherCell({
  cityName,
  date,
  isRestDay,
  restDayOffset,
  data,
  desiredHigh,
  desiredLow,
}: WeatherCellProps) {
  const t = useT();

  if (!data || data.tmin == null || data.tmax == null) {
    return <div className="h-16 rounded-md bg-muted/20" />;
  }

  const score = getWeatherScore(
    data.tmin,
    data.tmax,
    data.prcp ?? 0,
    data.wspd ?? 0,
    desiredLow,
    desiredHigh
  );
  const variant = scoreToVariant(score);
  const borderColor =
    variant === "good" ? "border-l-good" : variant === "warn" ? "border-l-warn" : "border-l-bad";
  const bgTint =
    variant === "good" ? "bg-good/5" : variant === "warn" ? "bg-warn/5" : "bg-bad/5";

  return (
    <div
      className={`space-y-1 rounded-md border-l-4 p-2 transition-colors duration-200 ${borderColor} ${bgTint}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <p className="text-sm font-medium leading-tight">{cityName}</p>
        {date && <span className="text-[10px] text-muted-foreground">{date}</span>}
      </div>

      {isRestDay && restDayOffset != null && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Pause className="h-2.5 w-2.5" />
          {t.weatherGrid.restDayBadge(restDayOffset)}
        </Badge>
      )}

      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
          <Moon className="h-2.5 w-2.5" />{data.tmin.toFixed(1)}°
        </Badge>
        <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
          <Sun className="h-2.5 w-2.5" />{data.tmax.toFixed(1)}°
        </Badge>
      </div>

      {(data.prcp ?? 0) > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-chart-1/60"
              style={{ width: `${Math.min((data.prcp ?? 0) / 10, 1) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {(data.prcp ?? 0).toFixed(1)}mm
          </span>
        </div>
      )}

      {(data.wspd ?? 0) > 0 && (
        <div className="flex items-center gap-1">
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3 text-muted-foreground"
            style={{ transform: `rotate(${data.wdir ?? 0}deg)` }}
            aria-hidden="true"
          >
            <path d="M8 1l3 12H5z" fill="currentColor" />
          </svg>
          <span className="text-[10px] text-muted-foreground">
            {Math.round(data.wspd ?? 0)} km/h {windDegreesToDirection(data.wdir ?? 0)}
          </span>
        </div>
      )}
    </div>
  );
});
