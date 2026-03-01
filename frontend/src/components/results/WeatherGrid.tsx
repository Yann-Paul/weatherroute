import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WeatherCell } from "./WeatherCell";
import { useResultsStore } from "@/stores/resultsStore";
import { dayOfYearToDate } from "@/utils/constants";

export function WeatherGrid() {
  const {
    weather,
    startDay,
    totalDays,
    dateOffset,
    tableStep,
    tableColumns,
    setDateOffset,
    setTableStep,
    setTableColumns,
  } = useResultsStore();

  const { columns, rows } = useMemo(() => {
    const adjustedStart = startDay + dateOffset;
    const cols: { day: number; label: string }[] = [];
    for (let i = 0; i < tableColumns; i++) {
      const day = adjustedStart + i * tableStep;
      cols.push({ day, label: dayOfYearToDate(((day - 1) % 365) + 1) });
    }

    const dayMap = new Map<number, Map<string, typeof weather[0]>>();
    for (const w of weather) {
      if (!dayMap.has(w.day)) dayMap.set(w.day, new Map());
      dayMap.get(w.day)!.set(w.cityId, w);
    }

    const uniqueDays = Array.from(
      new Set(weather.map((w) => w.day))
    ).sort((a, b) => a - b);

    return { columns: cols, rows: uniqueDays, dayMap };
  }, [weather, startDay, dateOffset, tableStep, tableColumns]);

  const dayMap = useMemo(() => {
    const map = new Map<number, Map<string, typeof weather[0]>>();
    for (const w of weather) {
      if (!map.has(w.day)) map.set(w.day, new Map());
      map.get(w.day)!.set(w.cityId, w);
    }
    return map;
  }, [weather]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex-1 space-y-2">
            <Label>
              Date offset: {dateOffset > 0 ? "+" : ""}
              {dateOffset} days
            </Label>
            <Slider
              min={-60}
              max={60}
              step={1}
              value={[dateOffset]}
              onValueChange={([v]) => setDateOffset(v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Step</Label>
            <Select
              value={String(tableStep)}
              onValueChange={(v) => setTableStep(Number(v))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 7, 14, 30].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}d
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Columns</Label>
            <Select
              value={String(tableColumns)}
              onValueChange={(v) => setTableColumns(Number(v))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 5, 7, 10, 14, 20].map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="good">Good</Badge>
            <Badge variant="warn">Fair</Badge>
            <Badge variant="bad">Poor</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
                Day
              </th>
              {columns.map((col) => (
                <th
                  key={col.day}
                  className="whitespace-nowrap px-3 py-2 text-center font-medium"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rowDay) => (
              <tr key={rowDay} className="border-b border-border/50">
                <td className="sticky left-0 z-10 bg-background px-3 py-1 font-medium">
                  {rowDay}
                </td>
                {columns.map((col) => {
                  const cellDay = dayMap.get(rowDay);
                  const weatherData = cellDay
                    ? Array.from(cellDay.values()).find(
                        (w) =>
                          Math.abs(w.day - col.day) < tableStep
                      )
                    : undefined;

                  return (
                    <td key={col.day} className="px-1 py-1">
                      {weatherData ? (
                        <WeatherCell day={weatherData} />
                      ) : (
                        <div className="h-16" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
