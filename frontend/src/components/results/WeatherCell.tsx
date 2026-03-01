import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { scoreToVariant } from "@/utils/weatherScoring";
import { windDegreesToDirection } from "@/utils/constants";
import type { WeatherDay } from "@/api/types";

interface WeatherCellProps {
  day: WeatherDay;
}

export const WeatherCell = memo(function WeatherCell({ day }: WeatherCellProps) {
  const variant = scoreToVariant(day.score);
  const borderColor =
    variant === "good"
      ? "border-l-good"
      : variant === "warn"
        ? "border-l-warn"
        : "border-l-bad";
  const bgTint =
    variant === "good"
      ? "bg-good/5"
      : variant === "warn"
        ? "bg-warn/5"
        : "bg-bad/5";

  return (
    <div
      className={`space-y-1 rounded-md border-l-4 p-2 transition-colors duration-200 ${borderColor} ${bgTint}`}
    >
      <p className="text-sm font-medium leading-tight">{day.cityName}</p>

      {day.isRestDay && (
        <Badge variant="outline" className="text-[10px]">
          Rest
        </Badge>
      )}

      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {day.tmin}°
        </Badge>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {day.tmax}°
        </Badge>
      </div>

      {day.prcp > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/25"
              style={{ width: `${Math.min(day.prcp / 10, 1) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {day.prcp.toFixed(1)}mm
          </span>
        </div>
      )}

      {day.wspd > 0 && (
        <div className="flex items-center gap-1">
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3 text-muted-foreground"
            style={{ transform: `rotate(${day.wdir}deg)` }}
          >
            <path d="M8 1l3 12H5z" fill="currentColor" />
          </svg>
          <span className="text-[10px] text-muted-foreground">
            {Math.round(day.wspd)} km/h {windDegreesToDirection(day.wdir)}
          </span>
        </div>
      )}
    </div>
  );
});
