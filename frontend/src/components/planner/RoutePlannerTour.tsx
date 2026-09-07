import { useT } from "@/i18n/useT";

export const ROUTE_PLANNER_TOUR_STEPS = [
  "profile",
  "layers",
  "points",
  "pois",
  "analyze",
  "save",
] as const;

export type RoutePlannerTourStep = (typeof ROUTE_PLANNER_TOUR_STEPS)[number];

export function RoutePlannerTourHint({
  step,
  onNext,
  onBack,
  onSkip,
}: {
  step: RoutePlannerTourStep;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  const tutorial = t.routePlanner.tutorial;
  const stepIndex = ROUTE_PLANNER_TOUR_STEPS.indexOf(step);
  const content = {
    profile: { title: tutorial.profileTitle, description: tutorial.profileDesc },
    layers: { title: tutorial.layersTitle, description: tutorial.layersDesc },
    points: { title: tutorial.pointsTitle, description: tutorial.pointsDesc },
    pois: { title: tutorial.poisTitle, description: tutorial.poisDesc },
    analyze: { title: tutorial.analyzeTitle, description: tutorial.analyzeDesc },
    save: { title: tutorial.saveTitle, description: tutorial.saveDesc },
  }[step];

  return (
    <div
      role="dialog"
      aria-live="polite"
      className="relative z-[100] w-64 max-w-full rounded-lg border border-primary/40 bg-card p-2.5 shadow-lg ring-1 ring-primary/10"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">
            {tutorial.step(stepIndex + 1, ROUTE_PLANNER_TOUR_STEPS.length)}
          </p>
          <p className="mt-0.5 text-xs font-semibold">{content.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {content.description}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {tutorial.back}
            </button>
          )}
          <button
            type="button"
            onClick={onSkip}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {tutorial.skip}
          </button>
        </div>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {stepIndex === ROUTE_PLANNER_TOUR_STEPS.length - 1 ? tutorial.finish : tutorial.next}
        </button>
      </div>
    </div>
  );
}
