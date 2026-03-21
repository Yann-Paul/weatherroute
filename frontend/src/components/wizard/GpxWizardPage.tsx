import { useState, useRef, useEffect } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { useNavigate } from "react-router";
import {
  Upload,
  ArrowLeft,
  Settings,
  ChevronRight,
  Check,
  Info,
  Link as LinkIcon,
  Clock,
  Gauge,
  Map,
  HelpCircle,
} from "lucide-react";
import gpxBeispielImg from "@/pictures/gpx_beispiel.png";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { submitGpxJob } from "@/api/client";
import type { GpxDayConfig } from "@/api/types";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";
import { parseGpxTotalKm } from "@/utils/gpxParser";

// ─── linked-param logic (self-contained) ─────────────────────────────────────

type Param = "speed" | "dailyKm" | "ridingHours";

interface DayConfig {
  startTime: string;
  speed: number;
  dailyKm: number;
  ridingHours: number;
  editHistory: [Param, Param];
}

const DEFAULT: DayConfig = {
  startTime: "09:00",
  speed: 15,
  dailyKm: 90,
  ridingHours: 6,
  editHistory: ["speed", "dailyKm"],
};

function derivedParam(history: [Param, Param]): Param {
  return (["speed", "dailyKm", "ridingHours"] as Param[]).find(
    (p) => p !== history[0] && p !== history[1]
  )!;
}

function recalcDerived(c: DayConfig): DayConfig {
  const d = derivedParam(c.editHistory);
  const out = { ...c };
  if (d === "ridingHours") out.ridingHours = c.speed > 0 ? +(c.dailyKm / c.speed).toFixed(2) : 0;
  else if (d === "dailyKm") out.dailyKm = +(c.speed * c.ridingHours).toFixed(1);
  else out.speed = c.ridingHours > 0 ? +(c.dailyKm / c.ridingHours).toFixed(1) : 0;
  return out;
}

function editParam(config: DayConfig, param: Param, value: number): DayConfig {
  const newHistory: [Param, Param] =
    config.editHistory[1] === param ? config.editHistory : [config.editHistory[1], param];
  return recalcDerived({ ...config, [param]: value, editHistory: newHistory });
}

function isParamDerived(config: DayConfig, param: Param) {
  return derivedParam(config.editHistory) === param;
}

function paramDisplay(cfg: DayConfig, param: Param): number {
  if (param === "ridingHours") return +cfg.ridingHours.toFixed(2);
  if (param === "dailyKm") return +cfg.dailyKm.toFixed(1);
  return +cfg.speed.toFixed(1);
}

function buildDayConfigs(n: number, global: DayConfig, totalKm: number): DayConfig[] {
  return Array.from({ length: n }, (_, i) => {
    if (i < n - 1) return { ...global };
    const rest = Math.max(0.1, totalKm - global.dailyKm * (n - 1));
    return recalcDerived({ ...global, dailyKm: +rest.toFixed(1) });
  });
}

function numDaysFor(totalKm: number, dailyKm: number) {
  return dailyKm > 0 ? Math.max(1, Math.ceil(totalKm / dailyKm)) : 1;
}

// ─── linked param input ───────────────────────────────────────────────────────

function LinkedParamInput({
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

// ─── step types ───────────────────────────────────────────────────────────────

type Step = "upload" | "date" | "planning";
const GPX_STEPS: Step[] = ["upload", "date", "planning"];

// ─── shared ui helpers ────────────────────────────────────────────────────────

function ProgressDots({ current }: { current: Step }) {
  const idx = GPX_STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-1.5 py-1">
      {GPX_STEPS.map((_, i) => {
        const isActive = i === idx;
        const isDone = i < idx;
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
            {i < GPX_STEPS.length - 1 && (
              <div
                className={["h-px w-7", i < idx ? "bg-primary/30" : "bg-border"].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function NavButtons({
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
  onAllSettings: () => void;
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onAllSettings}
          className="gap-1 text-xs text-muted-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          {w.allSettings}
        </Button>
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

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function StepHeader({
  step,
  title,
  subtitle,
}: {
  step: Step;
  title: string;
  subtitle: string;
}) {
  const t = useT();
  const n = GPX_STEPS.indexOf(step) + 1;
  return (
    <div className="space-y-1 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t.wizard.gpxStep(n, GPX_STEPS.length)}
      </p>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ─── feature tooltip ──────────────────────────────────────────────────────────

function FeatureTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
          className="inline-flex text-muted-foreground hover:text-primary transition-colors"
          aria-label="Mehr erfahren"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── step 1 — upload ──────────────────────────────────────────────────────────

function UploadStep({
  file,
  totalKm,
  isDragging,
  onFileSelected,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  file: File | null;
  totalKm: number | null;
  isDragging: boolean;
  onFileSelected: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader step="upload" title={w.gpxUploadTitle} subtitle={w.gpxUploadSubtitle} />

      {/* Drop zone */}
      <div>
        <div
          className={[
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50",
          ].join(" ")}
          onClick={onFileSelected}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Upload
            className={["mb-3 h-9 w-9 transition-colors", isDragging ? "text-primary" : "text-muted-foreground"].join(" ")}
          />
          {file ? (
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">{file.name}</p>
              {totalKm != null ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.gpx.totalKm}:{" "}
                  <strong className="text-foreground">{totalKm.toFixed(1)} km</strong>
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground animate-pulse">
                  {t.gpx.calculating}
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t.gpx.dropHint}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.gpx.uploadButton}</p>
            </>
          )}
        </div>
      </div>

      <InfoBox>{w.gpxUploadWhatIsDesc}</InfoBox>

      {/* Feature list */}
      <div className="rounded-xl border bg-card p-4">
        <ul className="space-y-3">
          {w.gpxIntroPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-primary shrink-0">•</span>
              <span className="flex-1">{point}</span>
              <FeatureTooltip text={w.gpxIntroTooltips[i]} />
            </li>
          ))}
        </ul>
      </div>

      {/* Example image */}
      <div className="rounded-xl overflow-hidden border">
        <img
          src={gpxBeispielImg}
          alt="Beispiel GPX-Routenanzeige mit Wetterdaten und Höhenprofil"
          className="w-full object-cover"
        />
      </div>
    </div>
  );
}

// ─── step 2 — date ────────────────────────────────────────────────────────────

function DateStep({
  startDate,
  onDateChange,
}: {
  startDate: string;
  onDateChange: (d: string) => void;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader step="date" title={w.gpxDateTitle} subtitle={w.gpxDateSubtitle} />

      <InfoBox>{w.gpxDateHint}</InfoBox>

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <Label htmlFor="wizard-gpx-date">{t.gpx.startDate}</Label>
        <Input
          id="wizard-gpx-date"
          type="date"
          value={startDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="max-w-xs"
        />
      </div>
    </div>
  );
}

// ─── step 3 — day planning ────────────────────────────────────────────────────

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

function GlobalPlanPanel({
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

      {/* Linked-param hint */}
      <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
        <p className="text-xs text-muted-foreground leading-relaxed">{w.gpxLinkedHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Start time */}
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

        {/* Param fields */}
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

function PerDayPlanTable({
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

function PlanningStep({
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
      <StepHeader step="planning" title={w.gpxPlanTitle} subtitle={w.gpxPlanSubtitle} />

      {/* Mode picker */}
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

      {/* Global config */}
      {useGlobal && (
        <GlobalPlanPanel
          config={globalConfig}
          nDays={nDays}
          onParamChange={onGlobalParam}
          onTimeChange={onGlobalTime}
        />
      )}

      {/* Per-day table */}
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

// ─── main gpx wizard ──────────────────────────────────────────────────────────

export function GpxWizardPage() {
  const navigate = useNavigate();
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setJobId = useJobStore((s) => s.setJobId);

  useEffect(() => {
    document.title =
      lang === "de" ? "WeatherRoute — GPX Einrichtung" : "WeatherRoute — GPX Setup";
    return () => {
      document.title = "WeatherRoute";
    };
  }, [lang]);

  // ── file state
  const [file, setFile] = useState<File | null>(null);
  const [totalKm, setTotalKm] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── date state
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  // ── planning state
  const [useGlobal, setUseGlobal] = useState(true);
  const [globalConfig, setGlobalConfig] = useState<DayConfig>(DEFAULT);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);

  // ── wizard state
  const [step, setStep] = useState<Step>("upload");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const nDays = totalKm != null ? numDaysFor(totalKm, globalConfig.dailyKm) : null;
  const STEP_ORDER: Step[] = ["upload", "date", "planning"];

  // ── file handling
  async function handleFileSelected(f: File) {
    setFile(f);
    setTotalKm(null);
    try {
      const km = await parseGpxTotalKm(f);
      if (km < 0.1) { toast.error(t.gpx.errors.parseError); return; }
      setTotalKm(km);
      if (!useGlobal) {
        setDayConfigs(buildDayConfigs(numDaysFor(km, globalConfig.dailyKm), globalConfig, km));
      }
    } catch {
      toast.error(t.gpx.errors.parseError);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".gpx")) handleFileSelected(dropped);
    else toast.error(t.gpx.errors.notGpx);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFileSelected(f);
  }

  // ── global config changes
  function handleGlobalParam(param: Param, value: number) {
    const next = editParam(globalConfig, param, value);
    setGlobalConfig(next);
    if (!useGlobal && totalKm != null)
      setDayConfigs(buildDayConfigs(numDaysFor(totalKm, next.dailyKm), next, totalKm));
  }

  function handleGlobalTime(time: string) {
    setGlobalConfig((p) => ({ ...p, startTime: time }));
    if (!useGlobal) setDayConfigs((p) => p.map((d) => ({ ...d, startTime: time })));
  }

  function handleToggleMode(individual: boolean) {
    setUseGlobal(!individual);
    if (individual && totalKm != null && nDays != null)
      setDayConfigs(buildDayConfigs(nDays, globalConfig, totalKm));
  }

  function handleDayParam(dayIdx: number, param: Param, value: number) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? editParam(d, param, value) : d)));
  }

  function handleDayTime(dayIdx: number, time: string) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? { ...d, startTime: time } : d)));
  }

  // ── navigation
  function goNext() {
    setErrors([]);
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      setStep(STEP_ORDER[idx + 1]);
    } else {
      handleSubmit();
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) { setErrors([]); setStep(STEP_ORDER[idx - 1]); }
    else navigate("/gpx");
  }

  // ── submit
  async function handleSubmit() {
    if (!file) { toast.error(t.gpx.errors.noFile); return; }
    if (!startDate) { toast.error(t.gpx.errors.noDate); return; }
    if (totalKm == null) { toast.error(t.gpx.errors.parseError); return; }

    const configs: GpxDayConfig[] = useGlobal
      ? buildDayConfigs(nDays ?? 1, globalConfig, totalKm).map((c) => ({
          startTime: c.startTime,
          speed: c.speed,
          dailyKm: c.dailyKm,
        }))
      : dayConfigs.map((c) => ({ startTime: c.startTime, speed: c.speed, dailyKm: c.dailyKm }));

    setSubmitting(true);
    try {
      const { jobId } = await submitGpxJob(file, startDate, configs);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      const msg = t.gpx.errors.submissionFailed + (err instanceof Error ? `: ${err.message}` : "");
      toast.error(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-16">
      <ProgressDots current={step} />

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div key={step} className="animate-fade-in-scale">
        {step === "upload" && (
          <UploadStep
            file={file}
            totalKm={totalKm}
            isDragging={isDragging}
            onFileSelected={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          />
        )}
        {step === "date" && (
          <DateStep startDate={startDate} onDateChange={setStartDate} />
        )}
        {step === "planning" && totalKm != null && (
          <PlanningStep
            globalConfig={globalConfig}
            dayConfigs={dayConfigs}
            useGlobal={useGlobal}
            nDays={nDays}
            totalKm={totalKm}
            onToggleMode={handleToggleMode}
            onGlobalParam={handleGlobalParam}
            onGlobalTime={handleGlobalTime}
            onDayParam={handleDayParam}
            onDayTime={handleDayTime}
          />
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        className="hidden"
        onChange={handleFileChange}
      />

      <NavButtons
        onBack={goBack}
        onNext={step === "planning" ? handleSubmit : goNext}
        onAllSettings={() => navigate("/gpx")}
        isLast={step === "planning"}
        submitting={submitting}
        disableNext={step === "upload" && totalKm == null}
        disableHint={step === "upload" ? t.wizard.gpxNeedFile : undefined}
      />
    </div>
  );
}
