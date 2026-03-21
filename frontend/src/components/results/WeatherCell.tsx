import { memo, useState, useEffect, useRef } from "react";
import { Moon, Sun, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { windDegreesToDirection, relativeWindLabel } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import type { WeatherOffsetData } from "@/api/types";

const EXAMPLE: WeatherOffsetData = {
  tmin: 12.4,
  tmax: 24.7,
  prcp: 3.2,
  wspd: 15,
  wdir: 225,
  wspdResultant: 4,
};
const EXAMPLE_BEARING = 180; // travelling south

interface WeatherCellProps {
  date?: string;
  isRestDay: boolean;
  restDayOffset?: number;
  data: WeatherOffsetData | null;
  bearing?: number | null;
}

function InfoPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const ex = EXAMPLE;
  const exBearing = EXAMPLE_BEARING;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-5 z-50 w-80 rounded-md border border-border bg-popover shadow-lg text-[11px] text-popover-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="bg-muted/40 px-3 py-2 font-medium text-xs border-b border-border">
        Historische Klimadaten (1991–2020)
      </div>

      <div className="p-3 space-y-3">
        {/* Example cell + annotations */}

        {/* Date row */}
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 rounded border border-border/60 bg-muted/10 px-2 py-0.5">
            <span className="text-[10px] text-muted-foreground">15. Jun</span>
          </div>
          <span className="text-muted-foreground pt-0.5">Ankunftsdatum</span>
        </div>

        {/* Temperature */}
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 flex items-center gap-1.5 rounded border border-border/60 bg-muted/10 px-2 py-1">
            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
              <Moon className="h-2.5 w-2.5" />{ex.tmin!.toFixed(1)}°
            </Badge>
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
              <Sun className="h-2.5 w-2.5" />{ex.tmax!.toFixed(1)}°
            </Badge>
          </div>
          <span className="text-muted-foreground pt-0.5">
            Mittlere Tief- / Hochtemperatur des Tages
          </span>
        </div>

        {/* Precipitation */}
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 flex items-center gap-1 rounded border border-border/60 bg-muted/10 px-2 py-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/30"
                style={{ width: `${Math.min(ex.prcp! / 10, 1) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{ex.prcp!.toFixed(1)}mm</span>
          </div>
          <span className="text-muted-foreground pt-0.5">
            Mittlere Tagessumme Niederschlag
          </span>
        </div>

        {/* Wind */}
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 flex items-center gap-1 rounded border border-border/60 bg-muted/10 px-2 py-1.5">
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3 shrink-0 text-muted-foreground"
              style={{ transform: `rotate(${ex.wdir ?? 0}deg)` }}
              aria-hidden="true"
            >
              <path d="M8 1l3 12H5z" fill="currentColor" />
            </svg>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {ex.wspdResultant}{" "}
              <span className="text-muted-foreground/60">({ex.wspd})</span>{" "}
              km/h
            </span>
          </div>
          <div className="text-muted-foreground pt-0.5 space-y-1">
            <div>
              <span className="text-foreground font-medium">{ex.wspdResultant} km/h</span>{" "}
              Windresultante — vektorieller Mittelwert, berücksichtigt Richtungskonsistenz
            </div>
            <div>
              <span className="text-foreground/60 font-medium">({ex.wspd} km/h)</span>{" "}
              Skalarer Mittelwert aller Windmessungen
            </div>
          </div>
        </div>

        {/* Wind direction + relative */}
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 rounded border border-border/60 bg-muted/10 px-2 py-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {windDegreesToDirection(ex.wdir!)} · {relativeWindLabel(ex.wdir!, exBearing)}
            </span>
          </div>
          <div className="text-muted-foreground pt-0.5 space-y-1">
            <div>
              <span className="text-foreground font-medium">{windDegreesToDirection(ex.wdir!)}</span>{" "}
              Himmelsrichtung aus der der Wind kommt
            </div>
            <div>
              <span className="text-foreground font-medium">{relativeWindLabel(ex.wdir!, exBearing)}</span>{" "}
              Windrichtung relativ zur Fahrtrichtung
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const WeatherCell = memo(function WeatherCell({
  date,
  isRestDay,
  restDayOffset,
  data,
  bearing,
}: WeatherCellProps) {
  const t = useT();
  const [showInfo, setShowInfo] = useState(false);

  if (!data || data.tmin == null || data.tmax == null) {
    return <div className="h-16 rounded-md bg-muted/20" />;
  }

  return (
    <div className="relative space-y-1 rounded-md border-l-4 border-l-border p-2 transition-colors duration-200">
      {/* Info button */}
      <button
        onClick={() => setShowInfo((v) => !v)}
        className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] leading-none text-muted-foreground/60 hover:text-muted-foreground border border-muted-foreground/30 hover:border-muted-foreground/60"
        aria-label="Erklärung anzeigen"
      >
        ?
      </button>

      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}

      {date && (
        <div className="text-[10px] text-muted-foreground">{date}</div>
      )}

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
              className="h-full rounded-full bg-foreground/30"
              style={{ width: `${Math.min((data.prcp ?? 0) / 10, 1) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {(data.prcp ?? 0).toFixed(1)}mm
          </span>
        </div>
      )}

      {(data.wspdResultant ?? data.wspd ?? 0) > 0 && (
        <div className="flex items-center gap-1">
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3 shrink-0 text-muted-foreground"
            style={{ transform: `rotate(${data.wdir ?? 0}deg)` }}
            aria-hidden="true"
          >
            <path d="M8 1l3 12H5z" fill="currentColor" />
          </svg>
          <span className="text-[10px] text-muted-foreground">
            {data.wspdResultant != null
              ? <>{Math.round(data.wspdResultant)} <span className="text-muted-foreground/60">({Math.round(data.wspd ?? 0)})</span> km/h</>
              : <>{Math.round(data.wspd ?? 0)} km/h</>
            }{" "}
            {windDegreesToDirection(data.wdir ?? 0)}
            {bearing != null && data.wdir != null && (
              <> · {relativeWindLabel(data.wdir, bearing)}</>
            )}
          </span>
        </div>
      )}
    </div>
  );
});
