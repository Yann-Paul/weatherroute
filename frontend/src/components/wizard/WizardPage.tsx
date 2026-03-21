import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  FileUp,
  ArrowLeft,
  Settings,
  ChevronRight,
  Check,
  Route as RouteIcon,
  Wand2,
  Shuffle,
  List,
  Zap,
  Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CityList } from "@/components/planner/CityList";
import { CityCombobox } from "@/components/planner/CityCombobox";
import { ConnectionList } from "@/components/planner/ConnectionList";
import { CountryCombobox } from "@/components/planner/CountryCombobox";
import { usePlannerStore } from "@/stores/plannerStore";
import { useJobStore } from "@/stores/jobStore";
import { submitJob } from "@/api/client";
import { monthDayToDayOfYear, PRESET_BLOCKED_COUNTRIES } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { getCountryName } from "@/utils/countries";
import type { CitySearchResult } from "@/api/types";

type Step = "welcome" | "intro" | "cities" | "routing" | "travel" | "temperature" | "api";

const WIZARD_STEPS: Step[] = ["intro", "cities", "routing", "travel", "temperature", "api"];

// ─── shared helpers ──────────────────────────────────────────────────────────

function wizardStepIdx(step: Step) {
  return WIZARD_STEPS.indexOf(step); // -1 for welcome, 0–4 for steps
}

// ─── progress dots ───────────────────────────────────────────────────────────

function ProgressDots({ current }: { current: Step }) {
  const idx = wizardStepIdx(current);
  if (idx === -1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-1">
      {WIZARD_STEPS.map((_, i) => {
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
            {i < WIZARD_STEPS.length - 1 && (
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

// ─── option card ─────────────────────────────────────────────────────────────

function OptionCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative flex flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/40",
      ].join(" ")}
    >
      {selected && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
          <Check className="h-3 w-3 text-primary-foreground" />
        </span>
      )}
      <div
        className={[
          "flex h-8 w-8 items-center justify-center rounded-lg",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        ].join(" ")}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold leading-snug">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ─── nav buttons ─────────────────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
  onAllSettings,
  isLast,
  submitting,
  disableNext,
}: {
  onBack: () => void;
  onNext: () => void;
  onAllSettings: () => void;
  isLast: boolean;
  submitting?: boolean;
  disableNext?: boolean;
}) {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
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
            ? w.calculating
            : w.calculate
          : w.next}
        {!isLast && <ChevronRight className="h-4 w-4" />}
      </Button>
    </div>
  );
}

// ─── micro helpers ────────────────────────────────────────────────────────────

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{title}</p>
      {hint && <Hint>{hint}</Hint>}
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
  const n = wizardStepIdx(step) + 1;
  return (
    <div className="space-y-1 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t.wizard.step(n, WIZARD_STEPS.length)}
      </p>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ─── step 1 — route optimisation intro ───────────────────────────────────────

function IntroStep() {
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader step="intro" title={w.introTitle} subtitle={w.introSubtitle} />
      <div className="rounded-xl border bg-card p-4">
        <ul className="space-y-3">
          {w.introPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── step 2 — cities ─────────────────────────────────────────────────────────

function CitiesStep() {
  const store = usePlannerStore();
  const t = useT();
  const w = t.wizard;
  return (
    <div className="space-y-5">
      <StepHeader step="cities" title={w.citiesTitle} subtitle={w.citiesSubtitle} />

      {/* City list */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <SectionLabel title={t.cityList.addCity} hint={w.citiesHint} />
        <CityList />
      </div>

      {/* Start city */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <SectionLabel title={w.startCityTitle} hint={w.startCityHint} />
        <CityCombobox
          value={store.startCity}
          onSelect={(c: CitySearchResult) => store.setStartCity(c.name)}
          placeholder={t.planner.startCityPlaceholder}
          className="w-full"
        />
      </div>

      {/* Direct connections */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <SectionLabel title={w.connectionsTitle} hint={w.connectionsHint} />
        <ConnectionList />
      </div>

      {/* Sorted input */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <SectionLabel title={w.sortedTitle} hint={w.sortedHint} />
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            selected={!store.sortedInput}
            onClick={() => store.setSortedInput(false)}
            icon={<Shuffle className="h-4 w-4" />}
            title={w.sortedNo}
            description={w.sortedNoDesc}
          />
          <OptionCard
            selected={store.sortedInput}
            onClick={() => store.setSortedInput(true)}
            icon={<List className="h-4 w-4" />}
            title={w.sortedYes}
            description={w.sortedYesDesc}
          />
        </div>
      </div>
    </div>
  );
}

// ─── step 2 — routing (conditional) ──────────────────────────────────────────

function RoutingStep() {
  const store = usePlannerStore();
  const t = useT();
  const w = t.wizard;
  const lang = t.dateLocale === "de-DE" ? "de" : "en";

  if (store.sortedInput) {
    // Show direct-route vs graph choice
    return (
      <div className="space-y-5">
        <StepHeader step="routing" title={w.directRouteTitle} subtitle={w.directRouteSubtitle} />
        <div className="grid grid-cols-1 gap-3">
          <OptionCard
            selected={!store.directOsrm}
            onClick={() => store.setDirectOsrm(false)}
            icon={<Navigation className="h-4 w-4" />}
            title={w.directOff}
            description={w.directOffDesc}
          />
          <OptionCard
            selected={store.directOsrm}
            onClick={() => store.setDirectOsrm(true)}
            icon={<Zap className="h-4 w-4" />}
            title={w.directOn}
            description={w.directOnDesc}
          />
        </div>
      </div>
    );
  }

  // Show blocked countries
  return (
    <div className="space-y-5">
      <StepHeader step="routing" title={w.blockedTitle} subtitle={w.blockedSubtitle} />
      <Hint>{w.blockedHint}</Hint>
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => store.setBlockedCountries(PRESET_BLOCKED_COUNTRIES.map((c) => c.code))}
          >
            {w.blockedPreset}
          </Button>
          <Button variant="outline" size="sm" onClick={() => store.setBlockedCountries([])}>
            {w.blockedClear}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESET_BLOCKED_COUNTRIES.map((country) => (
            <label key={country.code} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={store.blockedCountries.includes(country.code)}
                onCheckedChange={() => store.toggleBlockedCountry(country.code)}
              />
              {t.advanced.blockedCountries.names[country.code] ?? country.name}
            </label>
          ))}
          {store.blockedCountries
            .filter((code) => !PRESET_BLOCKED_COUNTRIES.some((c) => c.code === code))
            .map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <Checkbox checked onCheckedChange={() => store.toggleBlockedCountry(code)} />
                {t.advanced.blockedCountries.names[code] ?? getCountryName(code, lang)}
              </label>
            ))}
        </div>
        <CountryCombobox
          blockedCodes={store.blockedCountries}
          onToggle={store.toggleBlockedCountry}
        />
      </div>
    </div>
  );
}

// ─── step 3 — travel details ──────────────────────────────────────────────────

function TravelStep({
  startMonth,
  startDay,
  setStartMonth,
  setStartDay,
}: {
  startMonth: string;
  startDay: string;
  setStartMonth: (v: string) => void;
  setStartDay: (v: string) => void;
}) {
  const store = usePlannerStore();
  const t = useT();
  const w = t.wizard;
  const daysInMonth = new Date(new Date().getFullYear(), parseInt(startMonth), 0).getDate();

  return (
    <div className="space-y-5">
      <StepHeader step="travel" title={w.travelTitle} subtitle={w.travelSubtitle} />

      {/* Start date */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <SectionLabel title={w.startDateTitle} />
        <div className="flex items-center gap-3">
          <Switch
            id="wizard-auto-date"
            checked={store.autoDetectStart}
            onCheckedChange={store.setAutoDetectStart}
          />
          <Label htmlFor="wizard-auto-date">{w.autoDateLabel}</Label>
        </div>
        <Hint>{store.autoDetectStart ? w.autoDateHint : w.manualDateHint}</Hint>
        {!store.autoDetectStart && (
          <div className="flex items-center gap-2">
            <Select value={startMonth} onValueChange={setStartMonth}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {t.months.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={startDay} onValueChange={setStartDay}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Forecast vs climate note */}
      <div className="rounded-xl border border-muted bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">{w.forecastNote}</p>
      </div>

      {/* km & days */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <SectionLabel title={w.maxKmTitle} hint={w.maxKmHint} />
          <Input
            type="number"
            min={10}
            max={500}
            value={store.maxDailyKm}
            onChange={(e) => store.setMaxDailyKm(Number(e.target.value))}
          />
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <SectionLabel title={w.maxDaysTitle} hint={w.maxDaysHint} />
          <Input
            type="number"
            min={1}
            max={730}
            value={store.maxTravelDays}
            onChange={(e) => store.setMaxTravelDays(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}

// ─── step 4 — temperature & weights ──────────────────────────────────────────

function TemperatureStep() {
  const store = usePlannerStore();
  const t = useT();
  const w = t.wizard;
  const tc = t.advanced.temperature;

  const weights = [
    {
      label: tc.distanceWeight(store.distanceWeight.toFixed(2)),
      hints: [tc.distanceWeightDesc1, tc.distanceWeightDesc2, tc.distanceWeightDesc3],
      value: store.distanceWeight,
      onChange: store.setDistanceWeight,
    },
    {
      label: tc.tempWeight(store.tempWeight.toFixed(2)),
      hints: [tc.tempWeightDesc1, tc.tempWeightDesc2, tc.tempWeightDesc3],
      value: store.tempWeight,
      onChange: store.setTempWeight,
    },
    {
      label: tc.windWeight(store.windWeight.toFixed(2)),
      hints: [tc.windWeightDesc1, tc.windWeightDesc2, tc.windWeightDesc3],
      value: store.windWeight,
      onChange: store.setWindWeight,
    },
    {
      label: tc.rainWeight(store.rainWeight.toFixed(2)),
      hints: [tc.rainWeightDesc1, tc.rainWeightDesc2, tc.rainWeightDesc3],
      value: store.rainWeight,
      onChange: store.setRainWeight,
    },
  ];

  return (
    <div className="space-y-5">
      <StepHeader step="temperature" title={w.tempTitle} subtitle={w.tempSubtitle} />

      {/* Temperature preferences */}
      <div className="rounded-xl border bg-card p-4 space-y-5">
        <p className="text-sm font-medium">{tc.heading}</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{tc.desiredDay}</Label>
            <Input
              type="number"
              value={store.desiredDayTemp}
              onChange={(e) => store.setTemp("desiredDayTemp", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>{tc.desiredNight}</Label>
            <Input
              type="number"
              value={store.desiredNightTemp}
              onChange={(e) => store.setTemp("desiredNightTemp", Number(e.target.value))}
            />
          </div>
        </div>
        <Hint>{tc.targetDesc}</Hint>

        <div className="space-y-1.5">
          <Label>{tc.dayRange(store.dayTempMin, store.dayTempMax)}</Label>
          <Hint>{tc.dayRangeDesc}</Hint>
          <Slider
            min={-20}
            max={50}
            step={1}
            value={[store.dayTempMin, store.dayTempMax]}
            onValueChange={([min, max]) => {
              store.setTemp("dayTempMin", min);
              store.setTemp("dayTempMax", max);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{tc.nightRange(store.nightTempMin, store.nightTempMax)}</Label>
          <Hint>{tc.nightRangeDesc}</Hint>
          <Slider
            min={-30}
            max={40}
            step={1}
            value={[store.nightTempMin, store.nightTempMax]}
            onValueChange={([min, max]) => {
              store.setTemp("nightTempMin", min);
              store.setTemp("nightTempMax", max);
            }}
          />
        </div>

        <div className="rounded-lg border border-muted bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{w.tempRangeWarning}</p>
        </div>

        <div className="space-y-1.5">
          <Label>{tc.warmingFactor(store.warmingFactor.toFixed(1))}</Label>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>{tc.warmingFactorDesc1}</p>
            <p>{tc.warmingFactorDesc2}</p>
            <p>
              {tc.warmingFactorDesc3}{" "}
              <span className="font-medium">{tc.recommended}</span>
            </p>
            <p>{tc.warmingFactorDesc4}</p>
          </div>
          <Slider
            min={-1}
            max={4}
            step={0.1}
            value={[store.warmingFactor]}
            onValueChange={([v]) => store.setWarmingFactor(v)}
          />
        </div>
      </div>

      {/* Weights */}
      <div className="rounded-xl border bg-card p-4 space-y-5">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{w.weightsTitle}</p>
          <Hint>{w.weightsSubtitle}</Hint>
        </div>
        {weights.map(({ label, hints, value, onChange }) => (
          <div key={label} className="space-y-1.5">
            <Label>{label}</Label>
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {hints.map((h) => (
                <p key={h}>{h}</p>
              ))}
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[value]}
              onValueChange={([v]) => onChange(v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── step 5 — routing api & elevation ────────────────────────────────────────

function ApiStep() {
  const store = usePlannerStore();
  const t = useT();
  const w = t.wizard;
  const tp = t.planner;
  const te = t.advanced.elevation;
  const locale = t.dateLocale;

  return (
    <div className="space-y-5">
      <StepHeader step="api" title={w.apiTitle} subtitle={w.apiSubtitle} />

      {/* Routing API */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <SectionLabel title={tp.routingMode} hint={tp.routingModeDesc} />
        <Select value={store.routingMode} onValueChange={store.setRoutingMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="car">{tp.routingModes.car}</SelectItem>
            <SelectItem value="brouter">{tp.routingModes.brouter}</SelectItem>
          </SelectContent>
        </Select>
        {store.routingMode === "brouter" && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{tp.brouterProfile}</p>
            <Select value={store.brouterProfile} onValueChange={store.setBrouterProfile}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trekking">{tp.brouterProfiles.trekking}</SelectItem>
                <SelectItem value="fastbike">{tp.brouterProfiles.fastbike}</SelectItem>
                <SelectItem value="mtb">{tp.brouterProfiles.mtb}</SelectItem>
                <SelectItem value="safety">{tp.brouterProfiles.safety}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Routing API note */}
      <div className="rounded-xl border border-muted bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">{w.apiNote}</p>
      </div>

      {/* Elevation resolution */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <SectionLabel
          title={te.resolution(store.elevResolution.toLocaleString(locale))}
          hint={te.resolutionDesc}
        />
        <Slider
          min={100}
          max={3000}
          step={100}
          value={[store.elevResolution]}
          onValueChange={([v]) => store.setElevResolution(v)}
        />
      </div>
    </div>
  );
}

// ─── main wizard page ─────────────────────────────────────────────────────────

export function WizardPage() {
  const store = usePlannerStore();
  const setJobId = useJobStore((s) => s.setJobId);
  const navigate = useNavigate();
  const t = useT();
  const w = t.wizard;
  const lang = useLangStore((s) => s.lang);

  const [step, setStep] = useState<Step>("welcome");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    document.title =
      lang === "de" ? "WeatherRoute — Einrichtung" : "WeatherRoute — Setup";
    return () => {
      document.title = "WeatherRoute";
    };
  }, [lang]);

  // local date state (mirrors PlannerPage)
  const storedDate =
    !store.autoDetectStart && store.startDay != null
      ? new Date(new Date().getFullYear(), 0, store.startDay)
      : null;
  const [startMonth, setStartMonth] = useState(
    String(storedDate ? storedDate.getMonth() + 1 : new Date().getMonth() + 1)
  );
  const [startDay, setStartDay] = useState(
    String(storedDate ? storedDate.getDate() : new Date().getDate())
  );

  const STEP_ORDER: Step[] = ["welcome", ...WIZARD_STEPS];

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (step === "cities") {
      if (store.cities.filter((c) => c.id).length < 1) {
        setErrors([t.planner.errors.minOneCity]);
        return;
      }
    }
    setErrors([]);
    if (idx < STEP_ORDER.length - 1) {
      setStep(STEP_ORDER[idx + 1]);
    } else {
      handleSubmit();
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      setErrors([]);
      setStep(STEP_ORDER[idx - 1]);
    }
  }

  async function handleSubmit() {
    const errs: string[] = [];
    if (store.cities.filter((c) => c.id).length < 1)
      errs.push(t.planner.errors.minOneCity);
    if (store.desiredNightTemp > store.desiredDayTemp)
      errs.push(t.planner.errors.nightExceedsDay);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const computedStartDay = store.autoDetectStart
        ? null
        : monthDayToDayOfYear(parseInt(startMonth), parseInt(startDay));
      const { jobId } = await submitJob({
        ...store,
        startDay: computedStartDay,
        cities: store.cities.filter((c) => c.id),
        connections: store.connections.filter((c) => c.fromId && c.toId),
      });
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t.planner.errors.submissionFailed]);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Welcome screen ──────────────────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <div className="mx-auto max-w-xl space-y-10 px-4 pb-16 pt-12 text-center">
        <div className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{w.welcomeTitle}</h1>
          <p className="text-muted-foreground">{w.welcomeSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {/* New tour option */}
          <button
            type="button"
            onClick={() => setStep("intro")}
            className="flex flex-col gap-4 rounded-2xl border-2 border-border bg-card p-6 text-left transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <RouteIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">{w.newTourTitle}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{w.newTourDesc}</p>
            </div>
          </button>

          {/* GPX option */}
          <button
            type="button"
            onClick={() => navigate("/gpx/wizard")}
            className="flex flex-col gap-4 rounded-2xl border-2 border-border bg-card p-6 text-left transition-all hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">{w.gpxTitle}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{w.gpxDesc}</p>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {w.allSettings} →
        </button>
      </div>
    );
  }

  // ── Wizard steps 1–5 ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-16">
      <ProgressDots current={step} />

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div key={step} className="animate-fade-in-scale">
        {step === "intro" && <IntroStep />}
        {step === "cities" && <CitiesStep />}
        {step === "routing" && <RoutingStep />}
        {step === "travel" && (
          <TravelStep
            startMonth={startMonth}
            startDay={startDay}
            setStartMonth={setStartMonth}
            setStartDay={setStartDay}
          />
        )}
        {step === "temperature" && <TemperatureStep />}
        {step === "api" && <ApiStep />}
      </div>

      <NavButtons
        onBack={goBack}
        onNext={step === "api" ? handleSubmit : goNext}
        onAllSettings={() => navigate("/")}
        isLast={step === "api"}
        submitting={submitting}
      />
    </div>
  );
}
