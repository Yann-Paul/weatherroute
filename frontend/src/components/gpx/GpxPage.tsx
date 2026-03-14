import { useState, useRef } from "react";
import type { DragEvent, ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router";
import { FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { submitGpxJob } from "@/api/client";
import type { GpxDayConfig } from "@/api/types";
import { useT } from "@/i18n/useT";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";
import { parseGpxTotalKm } from "@/utils/gpxParser";

// ─── linked-param logic ────────────────────────────────────────────────────

type Param = "speed" | "dailyKm" | "ridingHours";

interface DayConfig {
  startTime: string;
  speed: number;
  dailyKm: number;
  ridingHours: number;
  /** The last two params that were manually edited; the third is always derived. */
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
  if (d === "ridingHours") {
    out.ridingHours = c.speed > 0 ? +(c.dailyKm / c.speed).toFixed(2) : 0;
  } else if (d === "dailyKm") {
    out.dailyKm = +(c.speed * c.ridingHours).toFixed(1);
  } else {
    out.speed = c.ridingHours > 0 ? +(c.dailyKm / c.ridingHours).toFixed(1) : 0;
  }
  return out;
}

function editParam(config: DayConfig, param: Param, value: number): DayConfig {
  // If param is already the most-recently edited, keep history unchanged.
  // Otherwise rotate: drop oldest, push param to end.
  const newHistory: [Param, Param] =
    config.editHistory[1] === param
      ? config.editHistory
      : [config.editHistory[1], param];
  return recalcDerived({ ...config, [param]: value, editHistory: newHistory });
}

function isParamDerived(config: DayConfig, param: Param): boolean {
  return derivedParam(config.editHistory) === param;
}

function paramDisplay(cfg: DayConfig, param: Param): number {
  if (param === "ridingHours") return +cfg.ridingHours.toFixed(2);
  if (param === "dailyKm") return +cfg.dailyKm.toFixed(1);
  return +cfg.speed.toFixed(1);
}

// ─── LinkedParamInput ──────────────────────────────────────────────────────
// Shows the parent-computed value while not focused.
// While the user types, shows the draft (no mid-type recalculation).
// Commits the value only on blur.

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

// Build N day configs: first N-1 use globalConfig, last gets remainder km.
function buildDayConfigs(n: number, global: DayConfig, totalKm: number): DayConfig[] {
  const result: DayConfig[] = [];
  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      result.push({ ...global });
    } else {
      const usedKm = global.dailyKm * (n - 1);
      const rest = Math.max(0.1, totalKm - usedKm);
      result.push(recalcDerived({ ...global, dailyKm: +rest.toFixed(1) }));
    }
  }
  return result;
}

function numDaysFor(totalKm: number, dailyKm: number): number {
  return dailyKm > 0 ? Math.max(1, Math.ceil(totalKm / dailyKm)) : 1;
}

// ─── component ────────────────────────────────────────────────────────────

export function GpxPage() {
  const navigate = useNavigate();
  const t = useT();
  const setJobId = useJobStore((s) => s.setJobId);

  const [file, setFile] = useState<File | null>(null);
  const [totalKm, setTotalKm] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [useGlobal, setUseGlobal] = useState(true);
  const [globalConfig, setGlobalConfig] = useState<DayConfig>(DEFAULT);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nDays = totalKm != null ? numDaysFor(totalKm, globalConfig.dailyKm) : null;

  // ── file handling ────────────────────────────────────────────────────────

  async function handleFileSelected(f: File) {
    setFile(f);
    setTotalKm(null);
    try {
      const km = await parseGpxTotalKm(f);
      if (km < 0.1) {
        toast.error(t.gpx.errors.parseError);
        return;
      }
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
    if (dropped?.name.toLowerCase().endsWith(".gpx")) {
      handleFileSelected(dropped);
    } else {
      toast.error(t.gpx.errors.notGpx);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFileSelected(f);
  }

  // ── global config changes ────────────────────────────────────────────────

  function handleGlobalParam(param: Param, value: number) {
    const next = editParam(globalConfig, param, value);
    setGlobalConfig(next);
    if (!useGlobal && totalKm != null) {
      setDayConfigs(buildDayConfigs(numDaysFor(totalKm, next.dailyKm), next, totalKm));
    }
  }

  function handleGlobalTime(time: string) {
    setGlobalConfig((prev) => ({ ...prev, startTime: time }));
    if (!useGlobal) {
      setDayConfigs((prev) => prev.map((d) => ({ ...d, startTime: time })));
    }
  }

  // ── mode toggle ──────────────────────────────────────────────────────────

  function handleToggleMode(individual: boolean) {
    setUseGlobal(!individual);
    if (individual && totalKm != null && nDays != null) {
      setDayConfigs(buildDayConfigs(nDays, globalConfig, totalKm));
    }
  }

  // ── per-day changes ──────────────────────────────────────────────────────

  function handleDayParam(dayIdx: number, param: Param, value: number) {
    setDayConfigs((prev) =>
      prev.map((d, i) => (i === dayIdx ? editParam(d, param, value) : d))
    );
  }

  function handleDayTime(dayIdx: number, time: string) {
    setDayConfigs((prev) =>
      prev.map((d, i) => (i === dayIdx ? { ...d, startTime: time } : d))
    );
  }

  // ── submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) { toast.error(t.gpx.errors.noFile); return; }
    if (!startDate) { toast.error(t.gpx.errors.noDate); return; }
    if (totalKm == null) { toast.error(t.gpx.errors.parseError); return; }

    const configs: GpxDayConfig[] = useGlobal
      ? buildDayConfigs(nDays ?? 1, globalConfig, totalKm).map((c) => ({
          startTime: c.startTime,
          speed: c.speed,
          dailyKm: c.dailyKm,
        }))
      : dayConfigs.map((c) => ({
          startTime: c.startTime,
          speed: c.speed,
          dailyKm: c.dailyKm,
        }));

    setSubmitting(true);
    try {
      const { jobId } = await submitGpxJob(file, startDate, configs);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      toast.error(
        t.gpx.errors.submissionFailed +
          (err instanceof Error ? `: ${err.message}` : "")
      );
      setSubmitting(false);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            {t.gpx.heading}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* ── File upload ── */}
            <div>
              <Label>{t.gpx.uploadLabel}</Label>
              <div
                className={[
                  "mt-1 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                ].join(" ")}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                {file ? (
                  <div className="text-center">
                    <p className="text-sm font-medium">{file.name}</p>
                    {totalKm != null ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t.gpx.totalKm}:{" "}
                        <strong>{totalKm.toFixed(1)} km</strong>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground animate-pulse">
                        {t.gpx.calculating}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">{t.gpx.dropHint}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{t.gpx.uploadButton}</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* ── Start date ── */}
            <div>
              <Label htmlFor="startDate">{t.gpx.startDate}</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* ── Day planning (only shown after GPX is parsed) ── */}
            {totalKm != null && (
              <div className="space-y-3 rounded-lg border p-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{t.gpx.dayPlanning}</span>
                  {nDays != null && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {t.gpx.numDays(nDays)}
                    </span>
                  )}
                </div>

                {/* Mode toggle */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={useGlobal ? "default" : "outline"}
                    onClick={() => handleToggleMode(false)}
                  >
                    {t.gpx.sameForAll}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={!useGlobal ? "default" : "outline"}
                    onClick={() => handleToggleMode(true)}
                  >
                    {t.gpx.perDay}
                  </Button>
                </div>

                {/* ── Global config ── */}
                {useGlobal && (
                  <GlobalConfigPanel
                    config={globalConfig}
                    onParamChange={handleGlobalParam}
                    onTimeChange={handleGlobalTime}
                    t={t}
                  />
                )}

                {/* ── Per-day table ── */}
                {!useGlobal && dayConfigs.length > 0 && (
                  <PerDayTable
                    dayConfigs={dayConfigs}
                    totalKm={totalKm}
                    onParamChange={handleDayParam}
                    onTimeChange={handleDayTime}
                    t={t}
                  />
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || totalKm == null}
            >
              {submitting ? t.gpx.submitting : t.gpx.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── GlobalConfigPanel ─────────────────────────────────────────────────────

function GlobalConfigPanel({
  config,
  onParamChange,
  onTimeChange,
  t,
}: {
  config: DayConfig;
  onParamChange: (p: Param, v: number) => void;
  onTimeChange: (time: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const fields: { param: Param; label: string }[] = [
    { param: "speed", label: t.gpx.speed },
    { param: "dailyKm", label: t.gpx.dailyKm },
    { param: "ridingHours", label: t.gpx.ridingHours },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{t.gpx.startTime}</Label>
        <Input
          type="time"
          value={config.startTime}
          onChange={(e) => onTimeChange(e.target.value)}
          className="mt-1"
        />
      </div>
      {fields.map(({ param, label }) => {
        const derived = isParamDerived(config, param);
        return (
          <div key={param}>
            <Label className={derived ? "text-muted-foreground" : undefined}>
              {label}
              {derived && <span className="ml-1 text-xs opacity-70">(berechnet)</span>}
            </Label>
            <LinkedParamInput
              value={paramDisplay(config, param)}
              onChange={(v) => onParamChange(param, v)}
              className={[
                "mt-1",
                derived ? "bg-muted/40 italic text-muted-foreground" : "",
              ].join(" ")}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── PerDayTable ────────────────────────────────────────────────────────────

function PerDayTable({
  dayConfigs,
  totalKm,
  onParamChange,
  onTimeChange,
  t,
}: {
  dayConfigs: DayConfig[];
  totalKm: number;
  onParamChange: (dayIdx: number, p: Param, v: number) => void;
  onTimeChange: (dayIdx: number, time: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const PARAMS: Param[] = ["speed", "dailyKm", "ridingHours"];

  return (
    <div className="space-y-1 text-sm">
      {/* Header */}
      <div className="grid grid-cols-[2rem_5.5rem_3.5rem_4rem_4.5rem] gap-2 px-1 text-xs text-muted-foreground">
        <span>{t.gpx.day}</span>
        <span>{t.gpx.startTime}</span>
        <span>{t.gpx.speed}</span>
        <span>{t.gpx.dailyKm}</span>
        <span>{t.gpx.ridingHours}</span>
      </div>

      {/* Rows */}
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {dayConfigs.map((cfg, i) => {
          const isLast = i === dayConfigs.length - 1;
          const usedKm = dayConfigs.slice(0, i).reduce((s, d) => s + d.dailyKm, 0);
          const restKm = totalKm - usedKm;

          return (
            <div key={i} className="space-y-0.5">
              <div className="grid grid-cols-[2rem_5.5rem_3.5rem_4rem_4.5rem] items-center gap-2">
                {/* Day number */}
                <span className="text-xs font-medium text-muted-foreground">{i + 1}</span>

                {/* Start time */}
                <Input
                  type="time"
                  value={cfg.startTime}
                  onChange={(e) => onTimeChange(i, e.target.value)}
                  className="h-8 px-2 text-xs"
                />

                {/* Linked params */}
                {PARAMS.map((param) => {
                  const derived = isParamDerived(cfg, param);
                  return (
                    <LinkedParamInput
                      key={param}
                      value={paramDisplay(cfg, param)}
                      onChange={(v) => onParamChange(i, param, v)}
                      className={[
                        "h-8 px-2 text-xs",
                        derived ? "bg-muted/40 italic text-muted-foreground" : "",
                      ].join(" ")}
                    />
                  );
                })}
              </div>

              {/* Remaining km note for last row */}
              {isLast && restKm > 0 && (
                <p className="pl-[2.5rem] text-xs text-muted-foreground">
                  {t.gpx.lastDayNote(restKm)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
