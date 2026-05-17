import { Loader2 } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import type { ForecastData } from "@/api/types";

const MODELS = [
  { id: "best_match", label: "best_match" },
  { id: "ecmwf_ifs025", label: "ECMWF" },
  { id: "icon_seamless", label: "ICON" },
  { id: "gfs_seamless", label: "GFS" },
] as const;

interface Props {
  forecast: ForecastData;
  /** When provided, shows a zone bar indicating forecast coverage of the full route */
  totalKm?: number;
}

export function ModelBadges({ forecast, totalKm }: Props) {
  const setHoveredModelKmRange = useResultsStore((s) => s.setHoveredModelKmRange);
  const hoveredModelKmRange = useResultsStore((s) => s.hoveredModelKmRange);
  const selectedModel = useResultsStore((s) => s.selectedModel);
  const modelLoading = useResultsStore((s) => s.modelLoading);
  const pendingModel = useResultsStore((s) => s.pendingModel);
  const selectModel = useResultsStore((s) => s.selectModel);

  if (!forecast.points.length) return null;

  const kmStart = forecast.points[0].km;
  const kmEnd = forecast.points[forecast.points.length - 1].km;
  const isHovered = hoveredModelKmRange !== null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1">
        {MODELS.map(({ id, label }) => {
          const isSelected = selectedModel === id;
          const isPending = pendingModel === id;

          return (
            <span
              key={id}
              onClick={() => !modelLoading && selectModel(id)}
              onMouseEnter={() => isSelected ? setHoveredModelKmRange([kmStart, kmEnd]) : undefined}
              onMouseLeave={() => isSelected ? setHoveredModelKmRange(null) : undefined}
              style={
                isSelected
                  ? { borderColor: "rgba(59,130,246,0.4)", backgroundColor: "rgba(59,130,246,0.1)", color: "rgb(96,165,250)" }
                  : { borderColor: "rgba(100,116,139,0.25)", backgroundColor: "transparent", color: "rgb(148,163,184)" }
              }
              className={[
                "inline-flex items-center gap-1 select-none rounded-md border px-2 py-0.5 text-[11px] font-mono transition-all",
                modelLoading ? "cursor-wait" : "cursor-pointer",
                isSelected
                  ? isHovered ? "opacity-100 brightness-110" : "opacity-100"
                  : modelLoading ? "opacity-25" : "opacity-50 hover:opacity-80",
              ].join(" ")}
            >
              {isPending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {label}
            </span>
          );
        })}
      </div>

      {totalKm != null && totalKm > 0 && (
        <div
          className="relative h-1.5 w-32 overflow-hidden rounded-full bg-muted"
          title={`Vorhersage: km ${Math.round(kmStart)}–${Math.round(kmEnd)}`}
        >
          <div
            className="absolute top-0 h-full transition-opacity"
            style={{
              left: `${(kmStart / totalKm) * 100}%`,
              width: `${((kmEnd - kmStart) / totalKm) * 100}%`,
              backgroundColor: "rgb(96,165,250)",
              opacity: isHovered ? 1 : 0.5,
            }}
          />
        </div>
      )}
    </div>
  );
}
