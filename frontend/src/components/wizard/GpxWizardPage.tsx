import { useState, useRef, useEffect } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { Upload, HelpCircle } from "lucide-react";
import gpxBeispielImg from "@/pictures/gpx_beispiel.png";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { submitGpxJob } from "@/api/client";
import type { GpxDayConfig } from "@/api/types";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";
import { parseGpxTotalKm } from "@/utils/gpxParser";
import {
  DateStep,
  InfoBox,
  NavButtons,
  PlanningStep,
  ProgressDots,
  StepHeader,
} from "./RoutePlanningSteps";
import {
  DEFAULT_DAY_CONFIG,
  buildDayConfigs,
  editParam,
  numDaysFor,
  type DayConfig,
  type Param,
} from "./dayConfig";

// ─── step types ───────────────────────────────────────────────────────────────

type Step = "upload" | "date" | "planning";
const GPX_STEPS: Step[] = ["upload", "date", "planning"];

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
      <StepHeader stepNumber={1} totalSteps={GPX_STEPS.length} title={w.gpxUploadTitle} subtitle={w.gpxUploadSubtitle} />

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
  const [globalConfig, setGlobalConfig] = useState<DayConfig>(DEFAULT_DAY_CONFIG);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);

  // ── wizard state
  const [step, setStep] = useState<Step>("upload");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const nDays = totalKm != null ? numDaysFor(totalKm, globalConfig.dailyKm) : null;
  const STEP_ORDER: Step[] = ["upload", "date", "planning"];
  const stepNumber = GPX_STEPS.indexOf(step) + 1;

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
      <ProgressDots steps={GPX_STEPS} currentIndex={GPX_STEPS.indexOf(step)} />

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
          <DateStep
            stepNumber={stepNumber}
            totalSteps={GPX_STEPS.length}
            startDate={startDate}
            onDateChange={setStartDate}
          />
        )}
        {step === "planning" && totalKm != null && (
          <PlanningStep
            stepNumber={stepNumber}
            totalSteps={GPX_STEPS.length}
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
