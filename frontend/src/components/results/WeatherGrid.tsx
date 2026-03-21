import { useMemo } from "react";
import { Pause } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WeatherCell } from "./WeatherCell";
import { useResultsStore } from "@/stores/resultsStore";
import { dayOfYearToDate, computeBearing } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import type { WeatherStop } from "@/api/types";

// ─── Row descriptor ───────────────────────────────────────────────────────────

interface GridRow {
  relDay: number;
  stop: WeatherStop;
  restDayOffset: number; // 0 = arrival day, 1+ = nth rest day at this city
  bearing: number | null; // bearing from previous stop to this stop
}

const currentYear = new Date().getFullYear();

export function WeatherGrid() {
  const {
    weather,
    startDay,
    dateOffset,
    tableStep,
    tableColumns,
    setDateOffset,
    setTableStep,
    setTableColumns,
  } = useResultsStore();
  const t = useT();

  // Build rows: arrival day + rest days per stop
  const rows = useMemo<GridRow[]>(() => {
    const result: GridRow[] = [];
    for (let i = 0; i < weather.length; i++) {
      const stop = weather[i];
      const prev = weather[i - 1];
      const bearing = prev
        ? computeBearing(prev.lat, prev.lon, stop.lat, stop.lon)
        : null;
      result.push({ relDay: stop.relDay, stop, restDayOffset: 0, bearing });
      for (let k = 1; k <= stop.restDays; k++) {
        result.push({ relDay: stop.relDay + k, stop, restDayOffset: k, bearing });
      }
    }
    return result.sort((a, b) => a.relDay - b.relDay);
  }, [weather]);

  // Build columns: each column represents a different start-day offset
  const columns = useMemo(() => {
    const cols: { colOffset: number; label: string }[] = [];
    for (let i = 0; i < tableColumns; i++) {
      const colOffset = dateOffset + i * tableStep;
      const calDay = ((startDay + colOffset - 1 + 3650) % 365) + 1;
      cols.push({ colOffset, label: dayOfYearToDate(calDay, currentYear, t.dateLocale) });
    }
    return cols;
  }, [startDay, dateOffset, tableStep, tableColumns, t.dateLocale]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex-1 space-y-2 min-w-[200px]">
            <Label>{t.weatherGrid.startDay(dateOffset)}</Label>
            <Slider
              min={-60}
              max={60}
              step={1}
              value={[dateOffset]}
              onValueChange={([v]) => setDateOffset(v)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.weatherGrid.stepWidth}</Label>
            <Select
              value={String(tableStep)}
              onValueChange={(v) => setTableStep(Number(v))}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 7, 14, 30].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {t.weatherGrid.stepDay(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t.weatherGrid.columns}</Label>
            <Select
              value={String(tableColumns)}
              onValueChange={(v) => setTableColumns(Number(v))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 5, 7, 10, 14].map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </CardContent>
      </Card>

      {weather.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-border bg-muted/20 text-muted-foreground">
          {t.weatherGrid.noData}
        </div>
      ) : (
        <>
        <p className="text-right text-[11px] text-muted-foreground sm:hidden">
          ← {t.weatherGrid.scrollHint} →
        </p>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th scope="col" className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">
                  {t.weatherGrid.dayHeader}
                </th>
                {columns.map((col) => (
                  <th
                    key={col.colOffset}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-center font-medium min-w-[140px]"
                  >
                    <div className="text-xs font-bold">{col.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {col.colOffset >= 0 ? "+" : ""}{col.colOffset}d
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.stop.cityId}-${row.relDay}`}
                  className="border-b border-border/50"
                >
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1 whitespace-nowrap text-left font-normal">
                    <div className="font-medium leading-tight">{row.stop.cityName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t.weatherGrid.dayHeader} {row.relDay}
                      {row.restDayOffset > 0 && (
                        <Pause className="ml-1 inline h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                  </th>
                  {columns.map((col) => {
                    const lookupOffset = col.colOffset + row.restDayOffset;
                    const data = row.stop.byOffset[String(lookupOffset)] ?? null;
                    const calDay = ((startDay + col.colOffset + row.relDay - 1 + 3650) % 365) + 1;
                    const dateStr = dayOfYearToDate(calDay, currentYear, t.dateLocale);
                    return (
                      <td key={col.colOffset} className="px-1 py-1">
                        <WeatherCell
                          date={dateStr}
                          isRestDay={row.restDayOffset > 0}
                          restDayOffset={row.restDayOffset > 0 ? row.restDayOffset : undefined}
                          data={data}
                          bearing={row.bearing}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
