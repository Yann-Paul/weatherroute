import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Download,
  GripVertical,
  ListOrdered,
  Loader2,
  Mountain,
  RefreshCw,
} from "lucide-react";
import {
  Map,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  MarkerPopup,
  MapRoute,
  useMap,
} from "@/components/ui/map";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GpxElevationChart } from "@/components/gpx/GpxElevationChart";
import { GpxMarkers } from "@/components/gpx/GpxRouteMap";
import {
  previewRoutePlan,
  submitRoutePlannerJob,
  getJobStatus,
  getGpxResults,
  fetchWindShelter,
  fetchRoadInfo,
  saveRoute,
} from "@/api/client";
import type {
  GeocodeResult,
  GpxDayConfig,
  GpxJobResults,
  MapPoi,
  PoiCategory,
  RoadInfoResult,
  RoutePlannerPoint,
  WindShelterResult,
} from "@/api/types";
import { AddressSearch } from "@/components/planner/AddressSearch";
import {
  ROUTE_PLANNER_TOUR_STEPS,
  RoutePlannerTourHint,
  type RoutePlannerTourStep,
} from "@/components/planner/RoutePlannerTour";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";
import {
  GlobalPlanPanel,
  PerDayPlanTable,
} from "@/components/wizard/RoutePlanningSteps";
import {
  DEFAULT_DAY_CONFIG,
  buildDayConfigs,
  editParam,
  numDaysFor,
  type DayConfig,
  type Param,
} from "@/components/wizard/dayConfig";
import { downloadGpx } from "@/utils/gpxExport";
import { RouteSplitControl } from "@/components/planner/RouteSplitControl";
import {
  baseLayerStyles,
  CyclingOverlayLayer,
  DEFAULT_POI_RADIUS_M,
  ForestLayer,
  LayersMenu,
  NO_OVERLAYS,
  PoiLayer,
  POI_CATEGORIES,
  POI_COLORS,
  RoadsOverlayLayer,
  simplifyPoints,
  TopoOverlayLayer,
  TransitOverlayLayer,
  useMapOverlays,
  usePoiOverlay,
  WindExposureLayer,
  type BaseLayer,
  type MapOverlaysState,
  type OverlayState,
} from "@/components/planner/MapLayers";
import {
  RainRadarLayer,
  RainRadarPanel,
  useRainRadar,
} from "@/components/planner/RainRadar";
import {
  RoadHighlightLayer,
  RoadProfileBarChart,
  roadCategoryColor,
  type RoadDimension,
} from "@/components/planner/RoadProfile";

const PROFILES = ["trekking", "fastbike", "mtb", "safety"] as const;
type Profile = (typeof PROFILES)[number];

type WeatherStatus = "idle" | "pending" | "running" | "done" | "error";
type ProfileTab = "weather" | "surface" | "roadType";
type RoadHighlight = { dimension: RoadDimension; category: string } | null;

const GERMANY_CENTER: [number, number] = [10.4515, 51.1657];

// ─── map helper components (must live inside <Map>) ───────────────────────────

function ClickCapture({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  const { map, isLoaded } = useMap();
  const cbRef = useRef(onMapClick);
  useEffect(() => {
    cbRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      // Tapping a POI marker shows its info popup (see PoiLayer) — it
      // shouldn't also drop a new route point underneath it. Touch has no
      // hover to tell the two gestures apart, so hit-test explicitly here.
      const poiLayerIds = map
        .getStyle()
        .layers?.filter((l) => l.id.startsWith("poi-layer-"))
        .map((l) => l.id);
      if (
        poiLayerIds?.length &&
        map.queryRenderedFeatures(e.point, { layers: poiLayerIds }).length > 0
      ) {
        return;
      }
      cbRef.current(e.lngLat.lat, e.lngLat.lng);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, isLoaded]);
  return null;
}

/** Fly the map to a target whenever a new one is set (address search hits). */
function FlyTo({ target }: { target: { lat: number; lon: number } | null }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || !target) return;
    map.flyTo({
      center: [target.lon, target.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 1200,
    });
  }, [map, isLoaded, target]);
  return null;
}

// ─── waypoint insertion heuristic ────────────────────────────────────────────

/** Squared planar distance in degree-space with latitude-corrected longitude —
 * only used for nearest-neighbour comparisons, so units don't matter. */
function sqDist(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const kx = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const dx = (aLon - bLon) * kx;
  const dy = aLat - bLat;
  return dx * dx + dy * dy;
}

function sqDistToSegment(p: RoutePlannerPoint, a: RoutePlannerPoint, b: RoutePlannerPoint): number {
  const kx = Math.cos((p.lat * Math.PI) / 180);
  const ax = a.lon * kx, ay = a.lat;
  const bx = b.lon * kx, by = b.lat;
  const px = p.lon * kx, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Waypoint index at which a clicked point should be inserted so it lands in
 * the leg of the routed track it is closest to. Falls back to straight-line
 * segments between waypoints when no routed preview exists yet. */
function bestInsertIndex(
  points: RoutePlannerPoint[],
  previewCoords: RoutePlannerPoint[],
  pt: RoutePlannerPoint
): number {
  if (points.length < 2) return points.length;

  if (previewCoords.length > 1) {
    const nearestTo = (target: RoutePlannerPoint) => {
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < previewCoords.length; i++) {
        const d = sqDist(target.lat, target.lon, previewCoords[i].lat, previewCoords[i].lon);
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      return idx;
    };
    const clickIdx = nearestTo(pt);
    // Anchor each waypoint on the routed track, kept monotonic so loops in
    // the geometry can't produce an out-of-order insertion.
    const anchors = points.map(nearestTo);
    for (let k = 1; k < anchors.length; k++) anchors[k] = Math.max(anchors[k], anchors[k - 1]);
    for (let k = 0; k < anchors.length - 1; k++) {
      if (clickIdx <= anchors[k + 1]) return k + 1;
    }
    return points.length - 1;
  }

  let bestIdx = 1;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = sqDistToSegment(pt, points[i], points[i + 1]);
    if (d < best) {
      best = d;
      bestIdx = i + 1;
    }
  }
  return bestIdx;
}

function FitOnce({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0 || hasFit.current) return;
    hasFit.current = true;
    if (coordinates.length === 1) {
      map.jumpTo({ center: coordinates[0], zoom: 12 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });
  }, [map, isLoaded, coordinates]);
  return null;
}

// ─── full-window map ────────────────────────────────────────────────────────

function RouteMapView({
  points,
  previewCoords,
  weatherResult,
  onMapClick,
  onDragPoint,
  onRemovePoint,
  baseLayer,
  mapOverlays,
  overlays,
  poisByCategory,
  windShelter,
  roadInfo,
  roadHighlight,
  pendingPoint,
  onConfirmPending,
  onCancelPending,
  focusTarget,
  radarTileUrl,
  radarOpacity,
  highlightSegment,
}: {
  points: RoutePlannerPoint[];
  previewCoords: RoutePlannerPoint[];
  weatherResult: GpxJobResults | null;
  onMapClick: (lat: number, lon: number) => void;
  onDragPoint: (i: number, lat: number, lon: number) => void;
  onRemovePoint: (i: number) => void;
  baseLayer: BaseLayer;
  mapOverlays: MapOverlaysState;
  overlays: OverlayState;
  poisByCategory: Record<PoiCategory, MapPoi[]>;
  windShelter: WindShelterResult | null;
  roadInfo: RoadInfoResult | null;
  roadHighlight: RoadHighlight;
  pendingPoint: RoutePlannerPoint | null;
  onConfirmPending: (mode: "append" | "insert") => void;
  onCancelPending: () => void;
  focusTarget: { lat: number; lon: number } | null;
  radarTileUrl: string | null;
  radarOpacity: number;
  highlightSegment?: RoutePlannerPoint[] | null;
}) {
  const t = useT();
  const rp = t.routePlanner;

  const routeLine: [number, number][] =
    previewCoords.length > 1
      ? previewCoords.map((p) => [p.lon, p.lat])
      : points.map((p) => [p.lon, p.lat]);

  return (
    <Map
      center={GERMANY_CENTER}
      zoom={6}
      className="h-full w-full"
      styles={baseLayerStyles(baseLayer)}
    >
      <ClickCapture onMapClick={onMapClick} />
      <FitOnce coordinates={points.map((p) => [p.lon, p.lat])} />
      <FlyTo target={focusTarget} />
      {mapOverlays.topo.enabled && <TopoOverlayLayer opacity={mapOverlays.topo.opacity} />}
      {mapOverlays.cycling.enabled && <CyclingOverlayLayer opacity={mapOverlays.cycling.opacity} />}
      {mapOverlays.roads.enabled && <RoadsOverlayLayer opacity={mapOverlays.roads.opacity} />}
      {mapOverlays.transit.enabled && <TransitOverlayLayer opacity={mapOverlays.transit.opacity} />}
      {radarTileUrl && <RainRadarLayer tileUrl={radarTileUrl} opacity={radarOpacity} />}
      {overlays.forest && windShelter && <ForestLayer data={windShelter.forest} />}
      {routeLine.length > 1 && (
        <MapRoute coordinates={routeLine} color="hsl(var(--primary))" width={4} opacity={0.85} />
      )}
      {highlightSegment && highlightSegment.length > 1 && (
        <MapRoute
          id="segment-highlight"
          coordinates={highlightSegment.map((p) => [p.lon, p.lat])}
          color="#22c55e"
          width={6}
          opacity={0.95}
        />
      )}
      {overlays.wind && windShelter && weatherResult && (
        <WindExposureLayer
          samples={windShelter.samples}
          weatherPoints={weatherResult.weatherPoints}
        />
      )}
      {roadInfo && roadHighlight && (
        <RoadHighlightLayer
          samples={roadInfo.samples}
          dimension={roadHighlight.dimension}
          category={roadHighlight.category}
          color={roadCategoryColor(roadHighlight.dimension, roadHighlight.category)}
        />
      )}
      {POI_CATEGORIES.filter((cat) => overlays[cat]).map((cat) => (
        <PoiLayer key={cat} pois={poisByCategory[cat]} color={POI_COLORS[cat]} label={rp.layers[cat]} />
      ))}
      {weatherResult && (
        <GpxMarkers weatherPoints={weatherResult.weatherPoints} trackPoints={weatherResult.trackPoints} />
      )}
      {points.map((pt, i) => {
        const label =
          i === 0 ? rp.pointStart : i === points.length - 1 ? rp.pointEnd : rp.pointVia(i);
        return (
          <MapMarker
            key={i}
            longitude={pt.lon}
            latitude={pt.lat}
            draggable
            onDragEnd={(lngLat) => onDragPoint(i, lngLat.lat, lngLat.lng)}
          >
            <MarkerContent>
              <div className="flex size-6 items-center justify-center rounded-full border-2 border-white bg-primary text-[11px] font-bold text-primary-foreground shadow-md">
                {i + 1}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <div className="min-w-[120px] space-y-1.5 text-xs">
                <p className="font-semibold">{label}</p>
                <p className="text-muted-foreground">
                  {pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}
                </p>
                <button
                  type="button"
                  onClick={() => onRemovePoint(i)}
                  className="font-medium text-destructive hover:underline"
                >
                  {rp.removePoint}
                </button>
              </div>
            </MarkerPopup>
          </MapMarker>
        );
      })}
      {pendingPoint && (
        <MapPopup
          longitude={pendingPoint.lon}
          latitude={pendingPoint.lat}
          closeOnClick={false}
          closeButton
          onClose={onCancelPending}
        >
          <div className="min-w-[160px] space-y-2 pr-4 text-xs">
            <p className="font-semibold">{rp.addPoint.title}</p>
            <p className="text-muted-foreground">
              {pendingPoint.lat.toFixed(5)}, {pendingPoint.lon.toFixed(5)}
            </p>
            <div className="flex flex-col gap-1.5">
              <Button type="button" size="sm" onClick={() => onConfirmPending("append")}>
                {rp.addPoint.append}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onConfirmPending("insert")}
              >
                {rp.addPoint.insert}
              </Button>
            </div>
          </div>
        </MapPopup>
      )}
      <MapControls position="bottom-right" showLocate />
    </Map>
  );
}

// ─── floating controls panel ───────────────────────────────────────────────

function SortableWaypointRow({
  point,
  index,
  isLast,
  itemId,
}: {
  point: RoutePlannerPoint;
  index: number;
  isLast: boolean;
  itemId: string;
}) {
  const t = useT();
  const rp = t.routePlanner;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId });
  const label = index === 0 ? rp.pointStart : isLast ? rp.pointEnd : rp.pointVia(index);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label={rp.pointOrder.dragLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
        {index + 1}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
        </p>
      </div>
    </div>
  );
}

function WaypointOrderPanel({
  points,
  onReorder,
}: {
  points: RoutePlannerPoint[];
  onReorder: (from: number, to: number) => void;
}) {
  const t = useT();
  const rp = t.routePlanner;
  const [open, setOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = points.map((_, index) => `waypoint-${index}`);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(items.indexOf(active.id as string), items.indexOf(over.id as string));
  }

  if (points.length < 2) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium hover:bg-muted/60"
      >
        <span className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-muted-foreground" />
          {rp.pointOrder.heading}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{points.length}</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2.5">
          <p className="text-[11px] leading-snug text-muted-foreground">{rp.pointOrder.hint}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {points.map((point, index) => (
                  <SortableWaypointRow
                    key={items[index]}
                    point={point}
                    index={index}
                    isLast={index === points.length - 1}
                    itemId={items[index]}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

function ControlsPanel({
  onBack,
  profile,
  onProfileChange,
  onAddressSelect,
  points,
  distanceKm,
  ascentM,
  previewLoading,
  previewError,
  onClearPoints,
  onReorderPoints,
  startDate,
  onDateChange,
  useGlobal,
  globalConfig,
  dayConfigs,
  nDays,
  totalKm,
  onToggleMode,
  onGlobalParam,
  onGlobalTime,
  onDayParam,
  onDayTime,
  collapsed,
  onToggleCollapsed,
  actionsDisabled,
  actionsDisabledHint,
  onFinalize,
  finalizeBusy,
  onDownloadGpx,
  gpxDisabled,
  onSaveRoute,
  saveDisabled,
  saveNotReadyHint,
  saving,
  saved,
  splitControl,
  tourStep,
  onTourNext,
  onTourBack,
  onTourSkip,
}: {
  onBack: () => void;
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onAddressSelect: (r: GeocodeResult) => void;
  points: RoutePlannerPoint[];
  distanceKm: number | null;
  ascentM: number | null;
  previewLoading: boolean;
  previewError: boolean;
  onClearPoints: () => void;
  onReorderPoints: (from: number, to: number) => void;
  startDate: string;
  onDateChange: (d: string) => void;
  useGlobal: boolean;
  globalConfig: DayConfig;
  dayConfigs: DayConfig[];
  nDays: number | null;
  totalKm: number | null;
  onToggleMode: (individual: boolean) => void;
  onGlobalParam: (p: Param, v: number) => void;
  onGlobalTime: (t: string) => void;
  onDayParam: (dayIdx: number, p: Param, v: number) => void;
  onDayTime: (dayIdx: number, t: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actionsDisabled: boolean;
  actionsDisabledHint?: string;
  onFinalize: () => void;
  finalizeBusy: boolean;
  onDownloadGpx: () => void;
  gpxDisabled: boolean;
  onSaveRoute: () => void;
  saveDisabled: boolean;
  saveNotReadyHint?: string;
  saving: boolean;
  saved: boolean;
  splitControl: ReactNode;
  tourStep: RoutePlannerTourStep | null;
  onTourNext: () => void;
  onTourBack: () => void;
  onTourSkip: () => void;
}) {
  const t = useT();
  const rp = t.routePlanner;
  const tp = t.planner;
  const w = t.wizard;

  function pillClass(active: boolean) {
    return [
      "px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-card text-muted-foreground hover:bg-muted",
    ].join(" ");
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border bg-card/95 shadow-lg backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={w.back}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="truncate text-sm font-semibold">{rp.heading}</h1>
          {distanceKm != null && (
            <span className="hidden shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline">
              {distanceKm.toFixed(1)} km · ↑{Math.round(ascentM ?? 0)} m
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? rp.expand : rp.collapse}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="relative min-h-0 flex-1 border-t border-border">
          <div className="h-full space-y-2.5 overflow-y-auto px-3 py-2.5 sm:space-y-3 sm:px-4 sm:py-3 max-sm:[&_input]:h-8 max-sm:[&_input]:text-xs max-sm:[&_[role=combobox]]:h-8 max-sm:[&_[role=combobox]]:text-xs max-sm:[&_label]:text-xs">
          {tourStep === "analyze" && (
            <div className="-mx-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 text-[11px] font-medium text-primary shadow-sm">
              ↓ {t.routePlanner.tutorial.scrollToAnalyze}
            </div>
          )}
          {/* address / place search */}
          <AddressSearch onSelect={onAddressSelect} />
          <WaypointOrderPanel points={points} onReorder={onReorderPoints} />
          {tourStep === "points" && (
            <div className="rounded-lg border-l-2 border-primary/60 pl-2">
              <RoutePlannerTourHint
                step="points"
                onNext={onTourNext}
                onBack={onTourBack}
                onSkip={onTourSkip}
              />
            </div>
          )}

          {/* profile + distance/ascent (mobile) + clear */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{rp.profile}</p>
              <Select value={profile} onValueChange={(v) => onProfileChange(v as Profile)}>
                <SelectTrigger className={tourStep === "profile" ? "ring-2 ring-primary ring-offset-2" : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tp.brouterProfiles[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tourStep === "profile" && (
                <div className="pt-1">
                  <RoutePlannerTourHint
                    step="profile"
                    onNext={onTourNext}
                    onBack={onTourBack}
                    onSkip={onTourSkip}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm sm:hidden">
              <span>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : previewLoading ? "…" : "—"}</span>
              <span>↑{ascentM != null ? Math.round(ascentM) : "—"} m</span>
            </div>
            {points.length > 0 && (
              <button
                type="button"
                onClick={onClearPoints}
                className="pb-2 text-xs text-muted-foreground hover:text-destructive"
              >
                {rp.clearPoints}
              </button>
            )}
          </div>
          {tourStep === null && <p className="text-xs text-muted-foreground">{rp.mapHint}</p>}

          {previewError && (
            <Alert variant="destructive">
              <AlertDescription>{rp.previewError}</AlertDescription>
            </Alert>
          )}

          <div className="h-px bg-border" />

          {/* start date */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-start-date">{t.gpx.startDate}</Label>
            <Input
              id="rp-start-date"
              type="date"
              value={startDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="max-w-[200px]"
            />
          </div>

          {/* mode toggle */}
          <div className="flex w-fit overflow-hidden rounded-lg border border-border">
            <button type="button" onClick={() => onToggleMode(false)} className={pillClass(useGlobal)}>
              {t.gpx.sameForAll}
            </button>
            <button type="button" onClick={() => onToggleMode(true)} className={pillClass(!useGlobal)}>
              {t.gpx.perDay}
            </button>
          </div>

          {useGlobal ? (
            <GlobalPlanPanel
              config={globalConfig}
              nDays={nDays}
              onParamChange={onGlobalParam}
              onTimeChange={onGlobalTime}
            />
          ) : (
            dayConfigs.length > 0 && (
              <PerDayPlanTable
                dayConfigs={dayConfigs}
                totalKm={totalKm ?? 0}
                onParamChange={onDayParam}
                onTimeChange={onDayTime}
              />
            )
          )}

          <div className="space-y-2 border-t border-border pt-3">
            {actionsDisabled && actionsDisabledHint && (
              <p className="text-center text-xs text-muted-foreground">{actionsDisabledHint}</p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onDownloadGpx}
                disabled={gpxDisabled}
                className="gap-1.5 max-sm:h-8 max-sm:px-3 max-sm:text-xs"
              >
                <Download className="h-4 w-4" />
                {rp.downloadGpx}
              </Button>
              <div className="relative">
                {tourStep === "save" && (
                  <div className="absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[calc(100vw-2rem)]">
                    <RoutePlannerTourHint
                      step="save"
                      onNext={onTourNext}
                      onBack={onTourBack}
                      onSkip={onTourSkip}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  variant={saved ? "outline" : "secondary"}
                  onClick={onSaveRoute}
                  disabled={saveDisabled}
                  title={saveDisabled && !saved && !saving ? saveNotReadyHint : undefined}
                  className={[
                    "gap-1.5 max-sm:h-8 max-sm:px-3 max-sm:text-xs",
                    tourStep === "save" ? "ring-2 ring-primary ring-offset-2" : "",
                  ].join(" ")}
                >
                  {saved ? (
                    <><BookmarkCheck className="h-4 w-4" />{t.results.saved}</>
                  ) : (
                    <><Bookmark className="h-4 w-4" />{saving ? "…" : t.results.save}</>
                  )}
                </Button>
              </div>
              <div className="relative">
                {tourStep === "analyze" && (
                  <div className="absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[calc(100vw-2rem)]">
                    <RoutePlannerTourHint
                      step="analyze"
                      onNext={onTourNext}
                      onBack={onTourBack}
                      onSkip={onTourSkip}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  onClick={onFinalize}
                  disabled={actionsDisabled || finalizeBusy}
                  className={[
                    "gap-1.5 max-sm:h-8 max-sm:px-3 max-sm:text-xs",
                    tourStep === "analyze" ? "ring-2 ring-primary ring-offset-2" : "",
                  ].join(" ")}
                >
                  {finalizeBusy ? w.gpxAnalyzing : w.gpxAnalyze}
                </Button>
              </div>
            </div>
          </div>

          {splitControl}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-2xl bg-gradient-to-t from-card to-transparent" />
        </div>
      )}
    </div>
  );
}

// ─── full-width collapsible elevation + weather dock ───────────────────────

function ProfileWindow({
  status,
  message,
  result,
  error,
  stale,
  collapsed,
  onToggleCollapsed,
  onRefresh,
  profileTab,
  onProfileTabChange,
  roadInfo,
  roadInfoLoading,
  roadHighlight,
  onSelectRoadCategory,
}: {
  status: WeatherStatus;
  message: string;
  result: GpxJobResults | null;
  error: string | null;
  stale: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRefresh: () => void;
  profileTab: ProfileTab;
  onProfileTabChange: (tab: ProfileTab) => void;
  roadInfo: RoadInfoResult | null;
  roadInfoLoading: boolean;
  roadHighlight: RoadHighlight;
  onSelectRoadCategory: (dimension: RoadDimension, category: string | null) => void;
}) {
  const t = useT();
  const rp = t.routePlanner;

  if (status === "idle") return null;

  const busy = status === "pending" || status === "running";

  return (
    <div className="rounded-2xl border bg-card/95 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mountain className="h-4 w-4 text-primary" />
          {rp.profileHeading}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          {profileTab === "weather" && (status === "done" || status === "error") && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              {rp.weatherRefresh}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? rp.expand : rp.collapse}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-[260px] overflow-y-auto border-t border-border px-4 py-3">
          <Tabs value={profileTab} onValueChange={(v) => onProfileTabChange(v as ProfileTab)}>
            <TabsList className="mb-3">
              <TabsTrigger value="weather">{rp.profileTabs.weather}</TabsTrigger>
              <TabsTrigger value="surface">{rp.profileTabs.surface}</TabsTrigger>
              <TabsTrigger value="roadType">{rp.profileTabs.roadType}</TabsTrigger>
            </TabsList>

            <TabsContent value="weather">
              {busy && !result && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p>{message || rp.weatherButtonLoading}</p>
                </div>
              )}

              {status === "error" && !result && (
                <Alert variant="destructive">
                  <AlertDescription>{error || rp.weatherErrorFallback}</AlertDescription>
                </Alert>
              )}

              {result && (
                <>
                  {status === "error" && (
                    <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                      {error || rp.weatherErrorFallback}
                    </div>
                  )}
                  {status === "done" && stale && (
                    <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-foreground">
                      {rp.weatherStale}
                    </div>
                  )}
                  <GpxElevationChart
                    elevation={result.elevation}
                    weatherPoints={result.weatherPoints}
                    dailyConfigs={result.dailyConfigs}
                    startDate={result.startDate}
                  />
                </>
              )}
            </TabsContent>

            <TabsContent value="surface">
              <RoadProfileBarChart
                samples={roadInfo?.samples}
                dimension="surface"
                selected={roadHighlight?.dimension === "surface" ? roadHighlight.category : null}
                onSelect={(category) => onSelectRoadCategory("surface", category)}
                loading={roadInfoLoading}
              />
            </TabsContent>

            <TabsContent value="roadType">
              <RoadProfileBarChart
                samples={roadInfo?.samples}
                dimension="highway"
                selected={roadHighlight?.dimension === "highway" ? roadHighlight.category : null}
                onSelect={(category) => onSelectRoadCategory("highway", category)}
                loading={roadInfoLoading}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

// ─── main route planner page ───────────────────────────────────────────────────

export function RoutePlannerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const rp = t.routePlanner;
  const lang = useLangStore((s) => s.lang);
  const setJobId = useJobStore((s) => s.setJobId);
  const startTutorial = (location.state as { showRoutePlannerTutorial?: boolean } | null)
    ?.showRoutePlannerTutorial === true;

  useEffect(() => {
    document.title = lang === "de" ? "WeatherRoute — Streckenplaner" : "WeatherRoute — Route Planner";
    return () => {
      document.title = "WeatherRoute";
    };
  }, [lang]);

  // ── route state
  const [points, setPoints] = useState<RoutePlannerPoint[]>([]);
  const [profile, setProfile] = useState<Profile>("fastbike");
  const [previewCoords, setPreviewCoords] = useState<RoutePlannerPoint[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ascentM, setAscentM] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const reqIdRef = useRef(0);

  // ── pending waypoint (append-vs-insert choice) + map focus target
  const [pendingPoint, setPendingPoint] = useState<RoutePlannerPoint | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lon: number } | null>(null);

  // ── selected route-split segment, highlighted on the map
  const [highlightSegment, setHighlightSegment] = useState<RoutePlannerPoint[] | null>(null);

  // ── date state
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  // ── planning state
  const [useGlobal, setUseGlobal] = useState(true);
  const [globalConfig, setGlobalConfig] = useState<DayConfig>(DEFAULT_DAY_CONFIG);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);

  // ── panel + submit state
  const [collapsed, setCollapsed] = useState(false);
  const [weatherCollapsed, setWeatherCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tourStep, setTourStep] = useState<RoutePlannerTourStep | null>(
    startTutorial ? "profile" : null,
  );

  // Consume the navigation flag so a browser refresh or revisiting the route
  // does not unexpectedly start the tutorial again.
  useEffect(() => {
    if (startTutorial) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [startTutorial, navigate, location.pathname]);

  function handleTourNext() {
    if (!tourStep) return;
    const index = ROUTE_PLANNER_TOUR_STEPS.indexOf(tourStep);
    setTourStep(ROUTE_PLANNER_TOUR_STEPS[index + 1] ?? null);
  }

  function handleTourBack() {
    if (!tourStep) return;
    const index = ROUTE_PLANNER_TOUR_STEPS.indexOf(tourStep);
    if (index > 0) setTourStep(ROUTE_PLANNER_TOUR_STEPS[index - 1]);
  }

  // ── map layer state
  const radar = useRainRadar();
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("cycling");
  const mapOverlays = useMapOverlays();
  const [overlays, setOverlays] = useState<OverlayState>(NO_OVERLAYS);
  const [poiRadiusM, setPoiRadiusM] = useState(DEFAULT_POI_RADIUS_M);
  const [windShelter, setWindShelter] = useState<WindShelterResult | null>(null);
  const [shelterLoading, setShelterLoading] = useState(false);
  const shelterSigRef = useRef<string | null>(null);

  // ── profile window: weather / surface / road-type tabs
  const [profileTab, setProfileTab] = useState<ProfileTab>("weather");
  const [roadInfo, setRoadInfo] = useState<RoadInfoResult | null>(null);
  const [roadInfoLoading, setRoadInfoLoading] = useState(false);
  const roadInfoSigRef = useRef<string | null>(null);
  const [roadHighlight, setRoadHighlight] = useState<RoadHighlight>(null);

  function handleProfileTabChange(tab: ProfileTab) {
    setProfileTab(tab);
    setRoadHighlight(null);
  }

  function handleSelectRoadCategory(dimension: RoadDimension, category: string | null) {
    setRoadHighlight(category ? { dimension, category } : null);
  }

  // ── weather preview state
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>("idle");
  const [weatherMessage, setWeatherMessage] = useState("");
  const [weatherResult, setWeatherResult] = useState<GpxJobResults | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherJobId, setWeatherJobId] = useState<string | null>(null);
  const [weatherSignature, setWeatherSignature] = useState<string | null>(null);
  const pollTokenRef = useRef(0);

  // ── save state (tied to the background weather job — see submitWeatherJob)
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { setIsSaved(false); }, [weatherJobId]);

  useEffect(() => () => { pollTokenRef.current++; }, []);

  const nDays = distanceKm != null ? numDaysFor(distanceKm, globalConfig.dailyKm) : null;

  // ── live route preview (debounced)
  useEffect(() => {
    if (points.length < 2) {
      setPreviewCoords([]);
      setDistanceKm(null);
      setAscentM(null);
      setPreviewError(false);
      setPreviewLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    setPreviewLoading(true);
    setPreviewError(false);
    const handle = setTimeout(async () => {
      try {
        const result = await previewRoutePlan(points, profile);
        if (reqIdRef.current !== myId) return;
        setPreviewCoords(result.coordinates);
        setDistanceKm(result.distanceKm);
        setAscentM(result.ascentM);
      } catch {
        if (reqIdRef.current !== myId) return;
        setPreviewError(true);
        setPreviewCoords([]);
        setDistanceKm(null);
        setAscentM(null);
      } finally {
        if (reqIdRef.current === myId) setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [points, profile]);

  // ── map overlay data: POIs (Overpass corridor query, one category at a
  // time — see usePoiOverlay for why).
  const { poisByCategory, poisLoading } = usePoiOverlay(previewCoords, overlays, poiRadiusM);

  // ── map overlay data: wind-shelter landcover analysis (forest + wind layers).
  // Same debounce/abort scheme as the POI query above.
  const needShelterData = overlays.forest || overlays.wind;
  useEffect(() => {
    if (!needShelterData || previewCoords.length < 2) return;
    // Keep enough vertices that the 250 m shelter sampling stays on the track
    // (the backend thins the polyline again for the Overpass corridor itself).
    const simplified = simplifyPoints(previewCoords, 2000);
    const sig = JSON.stringify(simplified);
    if (sig === shelterSigRef.current) return;
    const controller = new AbortController();
    let cancelled = false;
    const handle = setTimeout(() => {
      shelterSigRef.current = sig;
      setShelterLoading(true);
      fetchWindShelter(simplified, controller.signal)
        .then((result) => {
          if (!cancelled) setWindShelter(result);
        })
        .catch(() => {
          if (shelterSigRef.current === sig) shelterSigRef.current = null;
          if (!cancelled) toast.error(rp.layers.shelterError);
        })
        .finally(() => {
          if (!cancelled) setShelterLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needShelterData, previewCoords]);

  // ── surface/road-type profile data: fetched lazily once one of the two
  // new tabs is opened, and shared between both (one Overpass query covers
  // both dimensions) — same debounce/signature-caching scheme as above.
  const needRoadInfo = profileTab === "surface" || profileTab === "roadType";
  useEffect(() => {
    if (!needRoadInfo || previewCoords.length < 2) return;
    const simplified = simplifyPoints(previewCoords, 2000);
    const sig = JSON.stringify(simplified);
    if (sig === roadInfoSigRef.current) return;
    const controller = new AbortController();
    let cancelled = false;
    const handle = setTimeout(() => {
      roadInfoSigRef.current = sig;
      setRoadInfoLoading(true);
      fetchRoadInfo(simplified, controller.signal)
        .then((result) => {
          if (!cancelled) setRoadInfo(result);
        })
        .catch(() => {
          if (roadInfoSigRef.current === sig) roadInfoSigRef.current = null;
          if (!cancelled) toast.error(rp.layers.roadInfoError);
        })
        .finally(() => {
          if (!cancelled) setRoadInfoLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRoadInfo, previewCoords]);

  function handleToggleOverlay(key: keyof OverlayState) {
    setOverlays((o) => ({ ...o, [key]: !o[key] }));
  }

  // ── point handling
  function handleMapClick(lat: number, lon: number) {
    // With an existing route, let the user decide where the point goes;
    // while building the first leg, clicks append directly.
    if (points.length < 2) {
      setPoints((p) => [...p, { lat, lon }]);
      return;
    }
    setPendingPoint({ lat, lon });
  }

  function handleConfirmPending(mode: "append" | "insert") {
    const pt = pendingPoint;
    if (!pt) return;
    setPendingPoint(null);
    if (mode === "append") {
      setPoints((p) => [...p, pt]);
      return;
    }
    setPoints((p) => {
      const idx = bestInsertIndex(p, previewCoords, pt);
      return [...p.slice(0, idx), pt, ...p.slice(idx)];
    });
  }

  function handleAddressSelect(r: GeocodeResult) {
    setFocusTarget({ lat: r.lat, lon: r.lon });
    if (points.length < 2) {
      setPoints((p) => [...p, { lat: r.lat, lon: r.lon }]);
      return;
    }
    setPendingPoint({ lat: r.lat, lon: r.lon });
  }

  function handleDragPoint(i: number, lat: number, lon: number) {
    setPoints((p) => p.map((pt, idx) => (idx === i ? { lat, lon } : pt)));
  }

  function handleRemovePoint(i: number) {
    setPoints((p) => p.filter((_, idx) => idx !== i));
  }

  function handleClearPoints() {
    setPoints([]);
    setPendingPoint(null);
  }

  function handleReorderPoints(from: number, to: number) {
    setPoints((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [point] = next.splice(from, 1);
      next.splice(to, 0, point);
      return next;
    });
  }

  // ── planning config changes
  function handleGlobalParam(param: Param, value: number) {
    const next = editParam(globalConfig, param, value);
    setGlobalConfig(next);
    if (!useGlobal && distanceKm != null)
      setDayConfigs(buildDayConfigs(numDaysFor(distanceKm, next.dailyKm), next, distanceKm));
  }

  function handleGlobalTime(time: string) {
    setGlobalConfig((p) => ({ ...p, startTime: time }));
    if (!useGlobal) setDayConfigs((p) => p.map((d) => ({ ...d, startTime: time })));
  }

  function handleToggleMode(individual: boolean) {
    setUseGlobal(!individual);
    if (individual && distanceKm != null && nDays != null)
      setDayConfigs(buildDayConfigs(nDays, globalConfig, distanceKm));
  }

  function handleDayParam(dayIdx: number, param: Param, value: number) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? editParam(d, param, value) : d)));
  }

  function handleDayTime(dayIdx: number, time: string) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? { ...d, startTime: time } : d)));
  }

  // ── shared config + signature builders
  function buildConfigs(): GpxDayConfig[] {
    if (distanceKm == null) return [];
    return useGlobal
      ? buildDayConfigs(nDays ?? 1, globalConfig, distanceKm).map((c) => ({
          startTime: c.startTime,
          speed: c.speed,
          dailyKm: c.dailyKm,
        }))
      : dayConfigs.map((c) => ({ startTime: c.startTime, speed: c.speed, dailyKm: c.dailyKm }));
  }

  function computeSignature(configs: GpxDayConfig[]) {
    return JSON.stringify({ points, profile, startDate, configs });
  }

  const currentSignature = distanceKm != null ? computeSignature(buildConfigs()) : null;
  const isStale =
    weatherStatus === "done" &&
    weatherSignature != null &&
    currentSignature != null &&
    weatherSignature !== currentSignature;

  const actionsDisabled = points.length < 2 || previewLoading || distanceKm == null || !startDate;

  // ── weather preview: submit + poll inline, no navigation
  async function pollWeatherJob(jobId: string) {
    const myToken = ++pollTokenRef.current;
    for (;;) {
      if (pollTokenRef.current !== myToken) return;
      let status;
      try {
        status = await getJobStatus(jobId);
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (pollTokenRef.current !== myToken) return;

      if (status.status === "error") {
        setWeatherStatus("error");
        setWeatherError(status.error);
        return;
      }

      setWeatherStatus("running");
      setWeatherMessage(status.message);

      if (status.status === "done" || status.status === "preview") {
        try {
          const results = await getGpxResults(jobId);
          if (pollTokenRef.current !== myToken) return;
          setWeatherResult(results as GpxJobResults);
          setWeatherStatus("done");
        } catch {
          if (pollTokenRef.current !== myToken) return;
          setWeatherStatus("error");
          setWeatherError(rp.weatherErrorFallback);
        }
        return;
      }

      await new Promise((r) => setTimeout(r, 900));
    }
  }

  async function submitWeatherJob(configs: GpxDayConfig[], sig: string) {
    setWeatherStatus("pending"); // ProfileWindow keeps showing the last good `result` underneath
    setWeatherMessage("");
    setWeatherError(null);
    try {
      const { jobId } = await submitRoutePlannerJob(points, profile, startDate, configs);
      setWeatherJobId(jobId);
      setWeatherSignature(sig);
      pollWeatherJob(jobId);
    } catch (err) {
      setWeatherStatus("error");
      setWeatherError(err instanceof Error ? err.message : rp.weatherErrorFallback);
    }
  }

  // Manual retry/refresh (button in the profile window)
  function handleRefreshWeather() {
    if (points.length < 2 || !startDate || distanceKm == null) return;
    submitWeatherJob(buildConfigs(), currentSignature ?? computeSignature(buildConfigs()));
  }

  // Auto-fetch: whenever the route or day-planning settings settle on a new
  // value, query weather + elevation automatically (debounced — the lookups
  // hit rate-limited external APIs, so we don't want to fire on every drag).
  useEffect(() => {
    if (points.length < 2 || !startDate || distanceKm == null) return;
    const configs = buildConfigs();
    if (configs.length === 0) return;
    const sig = computeSignature(configs);
    if (sig === weatherSignature) return; // already fetched/fetching this exact combination

    const handle = setTimeout(() => {
      submitWeatherJob(configs, sig);
    }, 1500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, profile, startDate, distanceKm, useGlobal, globalConfig, dayConfigs]);

  // ── GPX export of the routed preview track
  function handleDownloadGpx() {
    if (previewCoords.length < 2) return;
    const pois = POI_CATEGORIES.filter((cat) => overlays[cat]).flatMap((cat) => poisByCategory[cat]);
    downloadGpx(previewCoords, `weatherroute-${startDate || "route"}`, pois);
  }

  // ── save the route: reuses the weather job the planner already computed
  // in the background (see the auto-fetch effect above) instead of requiring
  // a separate "Route analysieren" round trip.
  const saveReady = weatherStatus === "done" && weatherJobId != null && !isStale;
  async function handleSaveRoute() {
    if (!saveReady || !weatherJobId || isSaved || isSaving) return;
    setIsSaving(true);
    try {
      const name = `${startDate} · ${Math.round(distanceKm ?? 0)} km`;
      const pois = POI_CATEGORIES.filter((cat) => overlays[cat]).flatMap((cat) => poisByCategory[cat]);
      await saveRoute(weatherJobId, name, null, pois);
      setIsSaved(true);
    } catch {
      toast.error(t.results.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  // ── final submit: reuse an up-to-date weather preview job if one exists
  async function handleFinalize() {
    if (points.length < 2) { toast.error(rp.errors.minPoints); return; }
    if (!startDate) { toast.error(rp.errors.noDate); return; }
    if (distanceKm == null) { toast.error(rp.previewError); return; }

    const configs = buildConfigs();
    const sig = computeSignature(configs);
    setSubmitting(true);
    try {
      if (weatherJobId && weatherStatus === "done" && weatherSignature === sig) {
        setJobId(weatherJobId);
        navigate(`/progress/${weatherJobId}`);
        return;
      }
      const { jobId } = await submitRoutePlannerJob(points, profile, startDate, configs);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      const msg = rp.errors.submissionFailed + (err instanceof Error ? `: ${err.message}` : "");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <RouteMapView
          points={points}
          previewCoords={previewCoords}
          weatherResult={weatherResult}
          onMapClick={handleMapClick}
          onDragPoint={handleDragPoint}
          onRemovePoint={handleRemovePoint}
          baseLayer={baseLayer}
          mapOverlays={mapOverlays.state}
          overlays={overlays}
          poisByCategory={poisByCategory}
          windShelter={windShelter}
          roadInfo={roadInfo}
          roadHighlight={roadHighlight}
          pendingPoint={pendingPoint}
          onConfirmPending={handleConfirmPending}
          onCancelPending={() => setPendingPoint(null)}
          focusTarget={focusTarget}
          radarTileUrl={radar.enabled ? radar.tileUrl : null}
          radarOpacity={radar.opacity}
          highlightSegment={highlightSegment}
        />

        <div
          className={`absolute right-3 top-3 flex flex-col items-end gap-2 ${
            tourStep === "layers" || tourStep === "pois" ? "z-[90]" : "z-20"
          }`}
        >
          <div className="flex items-start gap-2">
            {tourStep === "layers" && (
              <div className="w-64 max-w-[calc(100vw-5rem)]">
                <RoutePlannerTourHint
                  step="layers"
                  onNext={handleTourNext}
                  onBack={handleTourBack}
                  onSkip={() => setTourStep(null)}
                />
              </div>
            )}
            <LayersMenu
              base={baseLayer}
              onBaseChange={setBaseLayer}
              mapOverlays={mapOverlays.state}
              onToggleMapOverlay={mapOverlays.toggle}
              onMapOverlayOpacityChange={mapOverlays.setOpacity}
              overlays={overlays}
              onToggleOverlay={handleToggleOverlay}
              routeReady={previewCoords.length > 1}
              windReady={weatherResult != null}
              poisLoading={poisLoading}
              shelterLoading={shelterLoading}
              poiRadiusM={poiRadiusM}
              onPoiRadiusChange={setPoiRadiusM}
              tourStep={tourStep === "pois" && previewCoords.length <= 1 ? null : tourStep}
              onTourNext={handleTourNext}
              onTourBack={handleTourBack}
              onTourSkip={() => setTourStep(null)}
            />
          </div>
          {tourStep === "pois" && previewCoords.length <= 1 && (
            <div className="w-64 max-w-[calc(100vw-1.5rem)]">
              <RoutePlannerTourHint
                step="pois"
                onNext={handleTourNext}
                onBack={handleTourBack}
                onSkip={() => setTourStep(null)}
              />
            </div>
          )}
          <div className="w-56 max-w-[calc(100vw-1.5rem)]">
            <RainRadarPanel {...radar.panelProps} />
          </div>
        </div>

        <div
          className={`pointer-events-none absolute left-3 w-[380px] max-w-[min(92vw,calc(100vw-4.75rem))] ${
            tourStep && tourStep !== "layers" && tourStep !== "pois" ? "z-[80]" : "z-20"
          } ${
            collapsed ? "top-3" : "top-3 bottom-[32vh] sm:bottom-3"
          }`}
        >
          <div className="pointer-events-auto h-full">
            <ControlsPanel
              onBack={() => navigate("/")}
              profile={profile}
              onProfileChange={setProfile}
              onAddressSelect={handleAddressSelect}
              points={points}
              distanceKm={distanceKm}
              ascentM={ascentM}
              previewLoading={previewLoading}
              previewError={previewError}
              onClearPoints={handleClearPoints}
              onReorderPoints={handleReorderPoints}
              startDate={startDate}
              onDateChange={setStartDate}
              useGlobal={useGlobal}
              globalConfig={globalConfig}
              dayConfigs={dayConfigs}
              nDays={nDays}
              totalKm={distanceKm}
              onToggleMode={handleToggleMode}
              onGlobalParam={handleGlobalParam}
              onGlobalTime={handleGlobalTime}
              onDayParam={handleDayParam}
              onDayTime={handleDayTime}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((c) => !c)}
              actionsDisabled={actionsDisabled}
              actionsDisabledHint={actionsDisabled ? rp.needPointsHint : undefined}
              onFinalize={handleFinalize}
              finalizeBusy={submitting}
              onDownloadGpx={handleDownloadGpx}
              gpxDisabled={previewCoords.length < 2 || previewLoading}
              onSaveRoute={handleSaveRoute}
              saveDisabled={!saveReady || isSaving || isSaved}
              saveNotReadyHint={rp.saveNotReady}
              saving={isSaving}
              saved={isSaved}
              splitControl={
                previewCoords.length > 1 && (
                  <RouteSplitControl
                    coords={previewCoords}
                    totalKm={distanceKm}
                    dailyKm={buildConfigs().map((c) => c.dailyKm)}
                    pois={POI_CATEGORIES.filter((cat) => overlays[cat]).flatMap((cat) => poisByCategory[cat])}
                    poiRadiusM={poiRadiusM}
                    namePrefix={`weatherroute-${startDate || "route"}`}
                    onSelectedSegmentChange={(seg) => setHighlightSegment(seg?.coords ?? null)}
                  />
                )
              }
              tourStep={tourStep}
              onTourNext={handleTourNext}
              onTourBack={handleTourBack}
              onTourSkip={() => setTourStep(null)}
            />
          </div>
        </div>
      </div>

      {weatherStatus !== "idle" && (
        <div className="shrink-0 px-3 pb-3">
          <ProfileWindow
            status={weatherStatus}
            message={weatherMessage}
            result={weatherResult}
            error={weatherError}
            stale={isStale}
            collapsed={weatherCollapsed}
            onToggleCollapsed={() => setWeatherCollapsed((c) => !c)}
            onRefresh={handleRefreshWeather}
            profileTab={profileTab}
            onProfileTabChange={handleProfileTabChange}
            roadInfo={roadInfo}
            roadInfoLoading={roadInfoLoading}
            roadHighlight={roadHighlight}
            onSelectRoadCategory={handleSelectRoadCategory}
          />
        </div>
      )}
    </div>
  );
}
