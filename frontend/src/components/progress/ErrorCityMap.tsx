import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import type { ErrorCity } from "@/api/types";
import { useT } from "@/i18n/useT";

interface ErrorCityMapProps {
  allCities: ErrorCity[];
  disconnectedCities: ErrorCity[];
  label: string;
}

function FitBounds({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });
  }, [map, isLoaded, coordinates]);
  return null;
}

export function ErrorCityMap({ allCities, disconnectedCities, label }: ErrorCityMapProps) {
  const t = useT();
  const disconnectedIds = new Set(disconnectedCities.map((c) => c.id));
  const coordinates = allCities.map((c) => [c.lon, c.lat] as [number, number]);
  const center: [number, number] =
    allCities.length > 0
      ? [allCities[0].lon, allCities[0].lat]
      : [10, 50];

  return (
    <div className="flex h-full min-h-[300px] flex-col">
      <div className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-destructive bg-destructive/10 border-b border-destructive/30">
        <span className="inline-block size-3 rounded-full bg-destructive" />
        {label}
      </div>
      <div className="flex-1">
        <Map center={center} zoom={4} className="h-full min-h-[260px] w-full">
          <FitBounds coordinates={coordinates} />
          {allCities.map((city, i) => {
            const isDisconnected = disconnectedIds.has(city.id);
            return (
              <MapMarker key={`${city.id}-${i}`} longitude={city.lon} latitude={city.lat}>
                <MarkerContent>
                  <div
                    className="flex size-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-lg"
                    style={{
                      background: isDisconnected
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--primary))",
                    }}
                  >
                    {isDisconnected ? "!" : i + 1}
                  </div>
                </MarkerContent>
                <MarkerPopup>
                  <p className="font-semibold">{city.name}</p>
                  {isDisconnected && (
                    <p className="text-xs text-destructive font-medium mt-0.5">
                      {t.progress.disconnectedCityPopup}
                    </p>
                  )}
                </MarkerPopup>
              </MapMarker>
            );
          })}
          <MapControls position="bottom-right" />
        </Map>
      </div>
    </div>
  );
}
