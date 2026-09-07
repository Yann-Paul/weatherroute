import { useT } from "@/i18n/useT";

export const ROUTE_PLANNER_TOUR_STEPS = [
  "profile",
  "layers",
  "points",
  "pois",
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
    save: { title: tutorial.saveTitle, description: tutorial.saveDesc },
  }[step];

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/8 p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
            {tutorial.step(stepIndex + 1, ROUTE_PLANNER_TOUR_STEPS.length)}
          </p>
          <p className="mt-1 text-sm font-semibold">{content.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {content.description}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {tutorial.back}
            </button>
          )}
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {tutorial.skip}
          </button>
        </div>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {stepIndex === ROUTE_PLANNER_TOUR_STEPS.length - 1 ? tutorial.finish : tutorial.next}
        </button>
      </div>
    </div>
  );
}
