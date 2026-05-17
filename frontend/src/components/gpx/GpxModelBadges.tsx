import { Loader2 } from "lucide-react";

const MODELS = [
  { id: "best_match", label: "best_match" },
  { id: "ecmwf_ifs025", label: "ECMWF" },
  { id: "icon_seamless", label: "ICON" },
  { id: "gfs_seamless", label: "GFS" },
] as const;

interface Props {
  selectedModel: string;
  pendingModel: string | null;
  modelLoading: boolean;
  onSelect: (model: string) => void;
  /** Shows forecast coverage bar when provided */
  totalKm?: number;
  forecastKmStart?: number;
  forecastKmEnd?: number;
}

export function GpxModelBadges({
  selectedModel, pendingModel, modelLoading, onSelect,
  totalKm, forecastKmStart, forecastKmEnd,
}: Props) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1">
        {MODELS.map(({ id, label }) => {
          const isSelected = selectedModel === id;
          const isPending = pendingModel === id;
          return (
            <span
              key={id}
              onClick={() => !modelLoading && onSelect(id)}
              style={
                isSelected
                  ? { borderColor: "rgba(59,130,246,0.4)", backgroundColor: "rgba(59,130,246,0.1)", color: "rgb(96,165,250)" }
                  : { borderColor: "rgba(100,116,139,0.25)", backgroundColor: "transparent", color: "rgb(148,163,184)" }
              }
              className={[
                "inline-flex items-center gap-1 select-none rounded-md border px-2 py-0.5 text-[11px] font-mono transition-all",
                modelLoading ? "cursor-wait" : "cursor-pointer",
                isSelected
                  ? "opacity-100"
                  : modelLoading ? "opacity-25" : "opacity-50 hover:opacity-80",
              ].join(" ")}
            >
              {isPending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {label}
            </span>
          );
        })}
      </div>

      {totalKm != null && totalKm > 0 && forecastKmStart != null && forecastKmEnd != null && (
        <div
          className="relative h-1.5 w-32 overflow-hidden rounded-full bg-muted"
          title={`Vorhersage: km ${Math.round(forecastKmStart)}–${Math.round(forecastKmEnd)}`}
        >
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${(forecastKmStart / totalKm) * 100}%`,
              width: `${((forecastKmEnd - forecastKmStart) / totalKm) * 100}%`,
              backgroundColor: "rgb(96,165,250)",
              opacity: 0.5,
            }}
          />
        </div>
      )}
    </div>
  );
}
