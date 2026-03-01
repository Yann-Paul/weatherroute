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
import { useResultsStore } from "@/stores/resultsStore";

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

export function RouteMap() {
  const segments = useResultsStore((s) => s.segments);
  const markers = useResultsStore((s) => s.markers);

  const allCoords: [number, number][] = [
    ...segments.flatMap((s) => s.coordinates),
    ...markers.map((m) => [m.lon, m.lat] as [number, number]),
  ];

  return (
    <Map center={[10, 48]} zoom={5} className="h-[500px] w-full rounded-2xl lg:h-[600px]">
      <FitBounds coordinates={allCoords} />
      {segments.map((seg, i) => (
        <MapRoute
          key={i}
          id={`segment-${i}`}
          coordinates={seg.coordinates}
          color={seg.color}
          width={4}
          opacity={0.8}
          dashArray={seg.isDirect ? [4, 4] : undefined}
        />
      ))}
      {markers.map((m) => (
        <MapMarker key={m.id} longitude={m.lon} latitude={m.lat}>
          <MarkerContent>
            <div className="flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-primary text-[11px] font-bold text-primary-foreground shadow-lg">
              {m.dayNumber}
            </div>
          </MarkerContent>
          <MarkerPopup>
            <p className="font-medium">{m.cityName}</p>
            <div className="mt-1 text-sm text-muted-foreground">
              {m.tmin}° / {m.tmax}°
            </div>
            <p className="text-xs text-muted-foreground">Day {m.relDay}</p>
          </MarkerPopup>
        </MapMarker>
      ))}
      <MapControls position="bottom-right" showFullscreen />
      <div className="absolute left-3 top-3 z-10 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 text-xs shadow-md backdrop-blur-sm">
        <p className="mb-2 font-medium text-muted-foreground">Route quality</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="h-1 w-5 rounded-full bg-good" />
            <span>Good</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-5 rounded-full bg-warn" />
            <span>Moderate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-5 rounded-full bg-bad" />
            <span>Poor</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="4" className="overflow-visible">
              <line
                x1="0" y1="2" x2="20" y2="2"
                strokeWidth="2"
                strokeDasharray="4 3"
                className="stroke-muted-foreground"
              />
            </svg>
            <span className="text-muted-foreground">Direct</span>
          </div>
        </div>
      </div>
    </Map>
  );
}
