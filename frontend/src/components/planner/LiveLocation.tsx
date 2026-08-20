import { useCallback, useEffect, useRef, useState } from "react";
import { Navigation, X, Loader2 } from "lucide-react";
import { MapMarker, MarkerContent } from "@/components/ui/map";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/useT";

interface LiveCoords {
  longitude: number;
  latitude: number;
  heading: number | null;
}

type LiveLocationStatus = "idle" | "locating" | "tracking" | "error";

/**
 * Manual GPS tracking (navigator.geolocation.watchPosition), off by default —
 * the user opts in via the button rendered by <LiveLocationButton/>. Doesn't
 * depend on the network: this is device/GPS location, so it keeps working
 * once the map and route are already loaded and the connection drops.
 */
export function useLiveLocation() {
  const [coords, setCoords] = useState<LiveCoords | null>(null);
  const [status, setStatus] = useState<LiveLocationStatus>("idle");
  const watchIdRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setStatus("idle");
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    setStatus("locating");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("tracking");
        setCoords({
          longitude: pos.coords.longitude,
          latitude: pos.coords.latitude,
          heading: pos.coords.heading,
        });
      },
      () => setStatus("error"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }, []);

  const toggle = useCallback(() => {
    if (status === "idle" || status === "error") start();
    else stop();
  }, [status, start, stop]);

  // Stop the GPS watch if the map/page unmounts while tracking is on.
  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
  }, []);

  return { coords, status, toggle };
}

export function LiveLocationButton({
  status,
  onToggle,
  className,
}: {
  status: LiveLocationStatus;
  onToggle: () => void;
  className?: string;
}) {
  const t = useT();
  const active = status === "locating" || status === "tracking";

  return (
    <div className={cn("absolute z-10 flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        aria-label={active ? t.liveLocation.stop : t.liveLocation.start}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent",
          active && "border-chart-1/50 bg-chart-1/10 text-chart-1"
        )}
      >
        {status === "locating" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : active ? (
          <X className="size-3.5" />
        ) : (
          <Navigation className="size-3.5" />
        )}
        <span>{active ? t.liveLocation.stop : t.liveLocation.start}</span>
      </button>
      {status === "error" && (
        <span className="max-w-48 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive shadow-sm">
          {t.liveLocation.error}
        </span>
      )}
    </div>
  );
}

/** "You are here" marker — a pulsing dot, optionally rotated to the device's
 * heading when the browser reports one. */
export function LiveLocationMarker({ coords }: { coords: LiveCoords | null }) {
  if (!coords) return null;
  return (
    <MapMarker longitude={coords.longitude} latitude={coords.latitude}>
      <MarkerContent>
        <div className="relative flex size-8 items-center justify-center">
          <span className="absolute size-8 animate-ping rounded-full bg-blue-500/25" />
          <span className="absolute size-4 rounded-full border-2 border-white bg-blue-500 shadow-md" />
          {coords.heading != null && !Number.isNaN(coords.heading) && (
            <span
              className="absolute -top-1.5 left-1/2 h-3 w-2 -translate-x-1/2"
              style={{
                transform: `translateX(-50%) rotate(${coords.heading}deg)`,
                transformOrigin: "50% 12px",
              }}
            >
              <svg viewBox="0 0 10 12" className="h-3 w-2.5 drop-shadow">
                <polygon points="5,0 10,12 5,9 0,12" fill="#3b82f6" />
              </svg>
            </span>
          )}
        </div>
      </MarkerContent>
    </MapMarker>
  );
}
