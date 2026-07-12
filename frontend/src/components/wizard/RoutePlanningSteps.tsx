import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Clock, Gauge, Info, Map, Link as LinkIcon, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/useT";
import {
  isParamDerived,
  paramDisplay,
  type DayConfig,
  type Param,
} from "./dayConfig";

// Shared between the GPX wizard and the route-planner wizard: both end with
// the same "when do you start, how fast do you go" step before the route is
// sent through the weather-analysis pipeline.

// ─── linked param input ───────────────────────────────────────────────────────

export function LinkedParamInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      type="number"
      min={0.01}
      step="any"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = parseFloat(draft ?? "");
        if (!isNaN(v) && v > 0) onChange(v);
        setDraft(null);
      }}
      className={className}
    />
  );
}

// ─── shared step ui helpers ───────────────────────────────────────────────────

export function ProgressDots({ steps, currentIndex }: { steps: readonly string[]; currentIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-1">
      {steps.map((_, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-200",
                isActive
                  ? "scale-110 border-primary bg-primary text-primary-foreground"
                  : isDone
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-muted/50 text-muted-foreground",
              ].join(" ")}
            >
              {isDone ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div
                className={["h-px w-7", i < currentIndex ? "bg-primary/30" : "bg-border"].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NavButtons({
  onBack,
  onNext,
  onAllSettings,
  isLast,
  submitting,
  disableNext,
  disableHint,
}: {
  onBack: () => void;
  onNext: () => void;
  onAllSettings?: () => void;
  isLast: boolean;
  submitting?: boolean;
  disableNext?: boolean;
  disableHint?: string;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      {disableNext && disableHint && (
        <p className="text-center text-xs text-muted-foreground">{disableHint}</p>
      )}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {w.back}
        </Button>
        {onAllSettings ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAllSettings}
            className="gap-1 text-xs text-muted-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            {w.allSettings}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onNext} disabled={submitting || disableNext} className="gap-1">
          {isLast
            ? submitting
              ? w.gpxAnalyzing
              : w.gpxAnalyze
            : w.next}
          {!isLast && <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

export function StepHeader({
  stepNumber,
  totalSteps,
  title,
  subtitle,
}: {
  stepNumber: number;
  totalSteps: number;
  title: string;
  subtitle: string;
}) {
  const t = useT();
  return (
    <div className="space-y-1 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t.wizard.gpxStep(stepNumber, totalSteps)}
      </p>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ─── date step ────────────────────────────────────────────────────────────────

export function DateStep({
  stepNumber,
  totalSteps,
  startDate,
  onDateChange,
}: {
  stepNumber: number;
  totalSteps: number;
  startDate: string;
  onDateChange: (d: string) => void;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title={w.gpxDateTitle} subtitle={w.gpxDateSubtitle} />

      <InfoBox>{w.gpxDateHint}</InfoBox>

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <Label htmlFor="wizard-route-date">{t.gpx.startDate}</Label>
        <Input
          id="wizard-route-date"
          type="date"
          value={startDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="max-w-xs"
        />
      </div>
    </div>
  );
}

// ─── day planning step ─────────────────────────────────────────────────────────

const PARAM_META = (w: ReturnType<typeof useT>["wizard"]) => [
  {
    param: "speed" as Param,
    label: "km/h",
    icon: <Gauge className="h-4 w-4" />,
    hint: w.gpxSpeedHint,
  },
  {
    param: "dailyKm" as Param,
    label: "km/Tag",
    icon: <Map className="h-4 w-4" />,
    hint: w.gpxKmHint,
  },
  {
    param: "ridingHours" as Param,
    label: "h",
    icon: <Clock className="h-4 w-4" />,
    hint: w.gpxHoursHint,
  },
];

export function GlobalPlanPanel({
  config,
  nDays,
  onParamChange,
  onTimeChange,
}: {
  config: DayConfig;
  nDays: number | null;
  onParamChange: (p: Param, v: number) => void;
  onTimeChange: (t: string) => void;
}) {
  const t = useT();
  const w = t.wizard;
  const meta = PARAM_META(w);

  return (
    <div className="space-y-4">
      {nDays != null && (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {t.gpx.numDays(nDays)}
          </span>
        </div>
      )}

      <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
        <p className="text-xs text-muted-foreground leading-relaxed">{w.gpxLinkedHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 rounded-xl border bg-card p-3">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs">{t.gpx.startTime}</Label>
          </div>
          <Input
            type="time"
            value={config.startTime}
            onChange={(e) => onTimeChange(e.target.value)}
          />
          <Hint>{w.gpxTimeHint}</Hint>
        </div>

        {meta.map(({ param, label, icon, hint }) => {
          const derived = isParamDerived(config, param);
          return (
            <div key={param} className="space-y-1.5 rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{icon}</span>
                <Label className={["text-xs", derived ? "text-muted-foreground" : ""].join(" ")}>
                  {label}
                  {derived && (
                    <span className="ml-1 text-[10px] opacity-60">(berechnet)</span>
                  )}
                </Label>
              </div>
              <LinkedParamInput
                value={paramDisplay(config, param)}
                onChange={(v) => onParamChange(param, v)}
                className={derived ? "italic text-muted-foreground bg-muted/40" : ""}
              />
              <Hint>{hint}</Hint>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PerDayPlanTable({
  dayConfigs,
  totalKm,
  onParamChange,
  onTimeChange,
}: {
  dayConfigs: DayConfig[];
  totalKm: number;
  onParamChange: (dayIdx: number, p: Param, v: number) => void;
  onTimeChange: (dayIdx: number, t: string) => void;
}) {
  const t = useT();
  const PARAMS: Param[] = ["speed", "dailyKm", "ridingHours"];
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[22rem] space-y-1 text-sm">
        <div className="grid grid-cols-[2rem_5.5rem_3.5rem_4rem_4.5rem] gap-2 px-1 text-xs text-muted-foreground">
          <span>{t.gpx.day}</span>
          <span>{t.gpx.startTime}</span>
          <span>{t.gpx.speed}</span>
          <span>{t.gpx.dailyKm}</span>
          <span>{t.gpx.ridingHours}</span>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {dayConfigs.map((cfg, i) => {
            const isLast = i === dayConfigs.length - 1;
            const usedKm = dayConfigs.slice(0, i).reduce((s, d) => s + d.dailyKm, 0);
            return (
              <div key={i} className="space-y-0.5">
                <div className="grid grid-cols-[2rem_5.5rem_3.5rem_4rem_4.5rem] items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{i + 1}</span>
                  <Input
                    type="time"
                    value={cfg.startTime}
                    onChange={(e) => onTimeChange(i, e.target.value)}
                    className="h-8 px-2 text-xs"
                  />
                  {PARAMS.map((param) => {
                    const derived = isParamDerived(cfg, param);
                    return (
                      <LinkedParamInput
                        key={param}
                        value={paramDisplay(cfg, param)}
                        onChange={(v) => onParamChange(i, param, v)}
                        className={["h-8 px-2 text-xs", derived ? "italic text-muted-foreground bg-muted/40" : ""].join(" ")}
                      />
                    );
                  })}
                </div>
                {isLast && totalKm - usedKm > 0 && (
                  <p className="pl-[2.5rem] text-xs text-muted-foreground">
                    {t.gpx.lastDayNote(totalKm - usedKm)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PlanningStep({
  stepNumber,
  totalSteps,
  globalConfig,
  dayConfigs,
  useGlobal,
  nDays,
  totalKm,
  onToggleMode,
  onGlobalParam,
  onGlobalTime,
  onDayParam,
  onDayTime,
}: {
  stepNumber: number;
  totalSteps: number;
  globalConfig: DayConfig;
  dayConfigs: DayConfig[];
  useGlobal: boolean;
  nDays: number | null;
  totalKm: number;
  onToggleMode: (individual: boolean) => void;
  onGlobalParam: (p: Param, v: number) => void;
  onGlobalTime: (t: string) => void;
  onDayParam: (dayIdx: number, p: Param, v: number) => void;
  onDayTime: (dayIdx: number, t: string) => void;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title={w.gpxPlanTitle} subtitle={w.gpxPlanSubtitle} />

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{w.gpxModeTitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onToggleMode(false)}
            className={[
              "relative flex flex-col gap-2.5 rounded-xl border-2 p-4 text-left transition-all",
              useGlobal ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
            ].join(" ")}
          >
            {useGlobal && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                <Check className="h-3 w-3 text-primary-foreground" />
              </span>
            )}
            <p className="text-sm font-semibold">{w.gpxModeGlobal}</p>
            <p className="text-xs text-muted-foreground">{w.gpxModeGlobalDesc}</p>
          </button>
          <button
            type="button"
            onClick={() => onToggleMode(true)}
            className={[
              "relative flex flex-col gap-2.5 rounded-xl border-2 p-4 text-left transition-all",
              !useGlobal ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
            ].join(" ")}
          >
            {!useGlobal && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                <Check className="h-3 w-3 text-primary-foreground" />
              </span>
            )}
            <p className="text-sm font-semibold">{w.gpxModePerDay}</p>
            <p className="text-xs text-muted-foreground">{w.gpxModePerDayDesc}</p>
          </button>
        </div>
      </div>

      {useGlobal && (
        <GlobalPlanPanel
          config={globalConfig}
          nDays={nDays}
          onParamChange={onGlobalParam}
          onTimeChange={onGlobalTime}
        />
      )}

      {!useGlobal && dayConfigs.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
            <p className="text-xs text-muted-foreground leading-relaxed">{w.gpxLinkedHint}</p>
          </div>
          <PerDayPlanTable
            dayConfigs={dayConfigs}
            totalKm={totalKm}
            onParamChange={onDayParam}
            onTimeChange={onDayTime}
          />
        </div>
      )}
    </div>
  );
}
