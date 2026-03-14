import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import {
  Map,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import type { RoughMapData } from "@/api/types";

interface PreviewMapProps {
  data: RoughMapData;
}

function FitBounds({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 50 });
  }, [map, isLoaded, coordinates]);
  return null;
}

export function PreviewMap({ data }: PreviewMapProps) {
  const coordinates = data.cities.map((c) => [c.lon, c.lat] as [number, number]);
  const center: [number, number] = [data.center[1], data.center[0]];

  return (
    <Map center={center} zoom={5} className="h-full min-h-[300px] w-full rounded-2xl">
      <FitBounds coordinates={coordinates} />
      {coordinates.length > 1 && (
        <MapRoute
          coordinates={coordinates}
          color="hsl(var(--primary))"
          width={3}
          opacity={0.7}
          dashArray={[4, 4]}
        />
      )}
      {data.cities.map((city, i) => (
        <MapMarker key={`${city.id}-${i}`} longitude={city.lon} latitude={city.lat}>
          <MarkerContent>
            <div
              className="flex size-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md"
              style={{ background: city.color }}
            >
              {i + 1}
            </div>
          </MarkerContent>
          <MarkerPopup>
            <p className="font-semibold">{city.name}</p>
            <p className="text-xs text-muted-foreground">Day {city.day}</p>
          </MarkerPopup>
        </MapMarker>
      ))}
      <MapControls position="bottom-right" />
    </Map>
  );
}
