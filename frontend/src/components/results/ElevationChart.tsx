import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent } from "@/components/ui/card";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { TrendingUp, TrendingDown, Ruler } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";

const chartConfig = {
  elevation: {
    label: "Elevation",
    color: "var(--color-chart-1)",
  },
} satisfies ChartConfig;

export function ElevationChart() {
  const elevation = useResultsStore((s) => s.elevation);

  if (!elevation) return null;

  const chartData = elevation.points.map(([km, ele]) => ({
    km: Math.round(km),
    elevation: Math.round(ele),
  }));

  return (
    <div className="space-y-4">
      <ChartContainer config={chartConfig} className="h-[300px] w-full lg:h-[400px]">
        <AreaChart data={chartData} margin={{ top: 40, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-elevation)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-elevation)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="km"
            fontSize={12}
            tickFormatter={(v) => `${v} km`}
          />
          <YAxis
            fontSize={12}
            tickFormatter={(v) => `${v} m`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => `${v} km`}
                formatter={(v) => `${v} m`}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="elevation"
            stroke="var(--color-elevation)"
            strokeWidth={2}
            fill="url(#elevGradient)"
          />
          {elevation.cityMarks.map(([km, name]) => (
            <ReferenceLine
              key={`${km}-${name}`}
              x={Math.round(km)}
              stroke="hsl(240, 5%, 64.9%)"
              strokeDasharray="3 3"
              label={{
                value: name,
                position: "top",
                fill: "hsl(0, 0%, 98%)",
                fontSize: 11,
              }}
            />
          ))}
        </AreaChart>
      </ChartContainer>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total:</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalKm)} /> km
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-good" />
            <span className="text-sm text-muted-foreground">Ascent:</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalAscent)} /> m
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-bad" />
            <span className="text-sm text-muted-foreground">Descent:</span>
            <span className="font-medium">
              <NumberTicker value={Math.round(elevation.totalDescent)} /> m
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
