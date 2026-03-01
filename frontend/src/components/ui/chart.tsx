import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({
  id: _id,
  className,
  children,
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const colorVars = Object.fromEntries(
    Object.entries(config)
      .filter(([, c]) => c.color)
      .map(([key, c]) => [`--color-${key}`, c.color]),
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50",
          className,
        )}
        style={{ ...colorVars, ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipPayloadItem = {
  name?: string;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  className,
  hideLabel = false,
  hideIndicator = false,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  labelFormatter?: (
    label: string | number,
    payload: TooltipPayloadItem[],
  ) => React.ReactNode;
  formatter?: (
    value: number | string,
    name: string,
    item: TooltipPayloadItem,
    index: number,
  ) => React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
}) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const tooltipLabel = !hideLabel
    ? labelFormatter
      ? labelFormatter(label ?? "", payload)
      : label !== undefined
        ? String(label)
        : null
    : null;

  return (
    <div
      className={cn(
        "border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
    >
      {tooltipLabel && <div className="font-medium">{tooltipLabel}</div>}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          const cfg = config[key];
          const indicatorColor = item.color;

          return (
            <div key={`${key}-${index}`} className="flex w-full items-center gap-2">
              {!hideIndicator && (
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: indicatorColor }}
                />
              )}
              <div className="flex flex-1 items-center justify-between leading-none">
                <span className="text-muted-foreground">
                  {cfg?.label ?? item.name ?? key}
                </span>
                {formatter && item.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index)
                ) : item.value !== undefined ? (
                  <span className="text-foreground font-mono font-medium tabular-nums">
                    {typeof item.value === "number"
                      ? item.value.toLocaleString()
                      : item.value}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
