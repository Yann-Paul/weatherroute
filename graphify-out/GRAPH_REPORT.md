# Graph Report - weatherroute-master  (2026-09-17)

## Corpus Check
- 121 files · ~491,990 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .bat 3, .gexf 1)

## Summary
- 1377 nodes · 2339 edges · 98 communities (75 shown, 23 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.84)
- Token cost: 478,720 input · 0 output

## Community Hubs (Navigation)
- Map Component (Leaflet/MapLibre Wrapper)
- Route Planner Backend Endpoints & README Features
- GPX Wizard & Day Config
- Saved Routes & Routing Algorithms Overview
- FastAPI App Core & Imports
- Map Layers & Overlay State
- Frontend API Types (Core Domain Models)
- Forecast Map Component
- Planner Search & List Components
- App Routing & Page Registry
- Zustand Stores & i18n
- Frontend Build Config & Dependencies
- RoutePlannerPage Event Handlers
- Overpass POI/Road/Wind-Shelter API
- GPX Calculation Worker
- Route Planner Job Models (Pydantic)
- Frontend Runtime Dependencies
- UI Primitives (Input, Progress, Switch, etc.)
- Frontend API Types (Job & GPX Results)
- WizardPage Steps (Destination Finder)
- Route Optimization: Clustering & Elevation
- GPX Model Badges & Route Split Control
- TypeScript App Config
- RoutePlannerPage UI Panels
- Results Page Sub-Components
- Open-Meteo Forecast Fetching
- GPX Route Map Component
- Layout & Progress/Results Pages
- GPX Analysis Endpoint
- TypeScript Node Config
- Frontend API Client Functions
- Elevation Profile & Route Optimization
- Destination Weather Scoring
- Destination-Finding Job Runner
- Frontend Dev Dependencies
- GpxPage Day Config Handlers
- UI Alert/Badge/Button Components
- Route Optimization: TSP & Cluster Improvement
- City Geocoding & Graph Cache
- GPX Temperature Chart
- Weather Cell & Weather Grid
- GPX Elevation Chart
- Road Profile Component
- GpxPage Container
- GPX Route Editor
- GPX Route Map Mini Charts
- GpxResultsPage Handlers
- Progress/Preview Maps
- ResultsPage Handlers
- TemperatureChart Component
- GPX Export Utility
- Temperature Color Utility
- Command Palette UI
- Table UI Component
- Frontend Bearing/Wind Constants
- Beam Search Scoring
- Select UI Component
- Icon Generation Script
- GPX Stop Parsing
- Client-Side Open-Meteo Fallback
- Route Split Control Handlers
- Card UI Component
- Route Segments Utility
- Path/Bearing Scoring
- Forecast Point Selection
- Live Location Component
- Saved Route Restore Job
- npm Scripts
- Step Indicator Component
- Tabs UI Component
- WizardPage Navigation Handlers
- IndexedDB Wrapper
- ClassName Merge Utility
- Weather Scoring Utility
- Map Layers Menu
- Route Planner Tour (Onboarding)
- Label UI Component
- Wind Exposure Overlay Layer
- POI Overlay Layer
- Map Overlay Toggle Hook
- PlannerPage Handlers
- Popover UI Component
- Slider UI Component
- Tooltip UI Component
- Countries Utility
- GPX Parser Utility
- TypeScript Root Config
- BRouter Segment Download Script
- Dev Startup Script
- Prod Startup Script
- Graphify Workflow Config
- Apple Touch Icon Asset
- PWA Icon 192 Asset
- PWA Icon 512 Asset
- Maskable Icon 192 Asset
- Maskable Icon 512 Asset
- Route Planner Screenshot Asset
- README: Progress Page Feature

## God Nodes (most connected - your core abstractions)
1. `react` - 60 edges
2. `lucide-react` - 44 edges
3. `RoutePlannerPage()` - 27 edges
4. `compilerOptions` - 22 edges
5. `run_gpx_analysis()` - 21 edges
6. `run_calculation()` - 19 edges
7. `run_direct_osrm_job()` - 19 edges
8. `ForecastMap()` - 19 edges
9. `compilerOptions` - 18 edges
10. `get_interpolated_weather()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `run_gpx_analysis()` --uses--> `OpenMeteoUnreachableError`  [INFERRED]
  api_app.py → module.py
- `saveRoute()` --references--> `POST /api/saved-routes/export`  [EXTRACTED]
  frontend/src/api/client.ts → README.md
- `restoreSavedRoute()` --references--> `POST /api/saved-routes/restore`  [EXTRACTED]
  frontend/src/api/client.ts → README.md
- `fetchForecastViaBrowser()` --references--> `POST /api/forecast/parse`  [EXTRACTED]
  frontend/src/api/client.ts → README.md
- `Client-Seitiger Fallback für Open-Meteo` --rationale_for--> `fetchForecastViaBrowser()`  [EXTRACTED]
  README.md → frontend/src/api/client.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Beam-Search Scoring Pipeline** — backend_module_beam_search_route, backend_module_score_candidate, readme_direction_penalty_concept, readme_continuity_penalty_concept [INFERRED 0.85]
- **Ziel-Finden Two-Phase Pipeline** — backend_module_find_destination_cities, backend_module_beam_search_route, backend_module_hierarchical_waypoint_route, backend_module_optimized_travel_planner [INFERRED 0.85]
- **Overpass Reliability Strategy** — readme_overpass_reliability, readme_mirror_racing, readme_grid_cache, readme_overpass_serialization_lock [EXTRACTED 1.00]

## Communities (98 total, 23 thin omitted)

### Community 0 - "Map Component (Leaflet/MapLibre Wrapper)"
Cohesion: 0.06
Nodes (38): CompassButton(), CONTENT_LAYER_PREFIXES, defaultStyles, getDocumentTheme(), getSystemTheme(), getViewport(), Map, MapClusterLayer() (+30 more)

### Community 1 - "Route Planner Backend Endpoints & README Features"
Cohesion: 0.05
Nodes (40): POST /api/route-planner/jobs, POST /api/route-planner/pois, POST /api/route-planner/preview, POST /api/route-planner/wind-shelter, BRouter Docker Compose Service, RainViewerData, RainViewerFrame, useRainRadar() (+32 more)

### Community 2 - "GPX Wizard & Day Config"
Cohesion: 0.09
Nodes (32): buildDayConfigs(), DayConfig, DEFAULT_DAY_CONFIG, derivedParam(), editParam(), isParamDerived(), numDaysFor(), Param (+24 more)

### Community 3 - "Saved Routes & Routing Algorithms Overview"
Cohesion: 0.06
Nodes (33): POST /api/saved-routes/export, POST /api/saved-routes/restore, _find_waypoint_cities, _score_waypoint_combo, beam_search_route, find_destination_cities, get_interpolated_weather, hierarchical_waypoint_route (+25 more)

### Community 4 - "FastAPI App Core & Imports"
Cohesion: 0.06
Nodes (37): DestinationFinderSubmission, geocode_search(), job_results(), job_status(), _normalize_ascii(), oepnv_tile(), FastAPI backend for WeatherRoute. Serves JSON-only /api/* endpoints for the…, Free-text address/place search (Photon) for the route planner. (+29 more)

### Community 5 - "Map Layers & Overlay State"
Cohesion: 0.05
Nodes (28): BASE_STYLES, BaseLayer, CYCLING_STYLE, CYCLING_STYLES, CYCLOSM_TILES, DEFAULT_MAP_OVERLAYS, DEFAULT_POI_RADIUS_M, MapOverlaysState (+20 more)

### Community 6 - "Frontend API Types (Core Domain Models)"
Cohesion: 0.06
Nodes (35): CityEntry, CLIENT_FALLBACK_NEEDED, Connection, CountrySearchResult, DestinationCity, DestinationRoute, DestinationRouteCity, DestinationRouteSegment (+27 more)

### Community 7 - "Forecast Map Component"
Cohesion: 0.11
Nodes (33): climateInterp(), climateInterpTemp(), ClimateMarkers(), ClimateMarkersProps, ClimatePoint, climateWdirAt(), compassDir16(), eleAtKm() (+25 more)

### Community 8 - "Planner Search & List Components"
Cohesion: 0.14
Nodes (21): AdvancedPanel(), CityCombobox(), CityComboboxProps, CityList(), ConnectionList(), CountryCombobox(), CountryComboboxProps, SavedRoutesList() (+13 more)

### Community 9 - "App Routing & Page Registry"
Cohesion: 0.06
Nodes (23): React + TypeScript + Vite Template, App(), DestinationResultsPage, GpxPage, GpxResultsPage, GpxWizardPage, ProgressPage, ResultsPage (+15 more)

### Community 10 - "Zustand Stores & i18n"
Cohesion: 0.08
Nodes (25): applyLangToDocument(), LangState, useLangStore, de, en, Lang, Translations, dict (+17 more)

### Community 11 - "Frontend Build Config & Dependencies"
Cohesion: 0.08
Nodes (28): name, private, type, version, TILE_HOST_PATTERN, TILE_HOSTS, @dnd-kit/core, @dnd-kit/sortable (+20 more)

### Community 12 - "RoutePlannerPage Event Handlers"
Cohesion: 0.08
Nodes (12): bestInsertIndex(), RoutePlannerPage(), buildConfigs(), computeSignature(), handleConfirmPending(), handleFinalize(), handleRefreshWeather(), pollWeatherJob() (+4 more)

### Community 13 - "Overpass POI/Road/Wind-Shelter API"
Cohesion: 0.08
Nodes (28): _around_polyline(), _fetch_overpass_mirror(), MapPoisRequest, _overpass_query(), _cache_result(), _launch_next(), _poi_category(), _point_in_ring() (+20 more)

### Community 14 - "GPX Calculation Worker"
Cohesion: 0.09
Nodes (22): _fmt_elev(), _friendly_error(), Normalized score (0=good, 1=bad) to hex color., Background thread: consumes (seg_idx, chunk) tuples from seg_queue, samples…, Format elevation data dict into the JSON result shape., Direct OSRM route: connect cities A→B→C in input order, no graph algorithm., Register pending nominatim cities in the background thread with progress…, Convert a raw exception into a user-friendly German error message. (+14 more)

### Community 15 - "Route Planner Job Models (Pydantic)"
Cohesion: 0.09
Nodes (27): CityEntry, Connection, DestinationDetailRequest, export_saved_route(), forecast_parse(), ForecastParsePoint, ForecastParseRequest, GpxStopParsePoint (+19 more)

### Community 16 - "Frontend Runtime Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, class-variance-authority, clsx, cmdk, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, jszip (+20 more)

### Community 17 - "UI Primitives (Input, Progress, Switch, etc.)"
Cohesion: 0.08
Nodes (15): NumberTickerProps, ShimmerButton, ShimmerButtonProps, Checkbox, Input, NumericInput, NumericInputProps, Progress (+7 more)

### Community 18 - "Frontend API Types (Job & GPX Results)"
Cohesion: 0.08
Nodes (22): CitySearchResult, DestinationFinderFormData, DestinationJobResults, ForecastPointData, GeocodeResult, GpxDayConfig, GpxForecastUpdate, GpxJobResults (+14 more)

### Community 19 - "WizardPage Steps (Destination Finder)"
Cohesion: 0.08
Nodes (8): DEST_STEPS, Step, WIZARD_STEPS, ref_components_planner_citycombobox, ref_components_planner_citylist, ref_components_planner_connectionlist, ref_components_planner_countrycombobox, ref_pictures_routenplaner_beispiel_png

### Community 20 - "Route Optimization: Clustering & Elevation"
Cohesion: 0.11
Nodes (22): collections, heapq, itertools, assemble_elevation_profile(), calc_targets_day_estimates(), calculate_cluster_metrics(), create_combined_distance_matrix(), dynamic_cluster_cities() (+14 more)

### Community 21 - "GPX Model Badges & Route Split Control"
Cohesion: 0.10
Nodes (17): GpxModelBadges(), MODELS, Props, ModelOverride, RoadHighlight, GpxWeatherTable(), Mode, RouteSplitControlProps (+9 more)

### Community 22 - "TypeScript App Config"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, baseUrl, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 23 - "RoutePlannerPage UI Panels"
Cohesion: 0.09
Nodes (14): ControlsPanel(), GERMANY_CENTER, Profile, PROFILES, ProfileTab, RoadHighlight, WaypointOrderPanel(), WeatherStatus (+6 more)

### Community 24 - "Results Page Sub-Components"
Cohesion: 0.15
Nodes (17): ElevationChart(), ElevationSegment(), onMouseMove(), getForecastEndKm(), interpForecastByKey(), interpTempAtKm(), SegmentProps, ModelBadges() (+9 more)

### Community 25 - "Open-Meteo Forecast Fetching"
Cohesion: 0.13
Nodes (19): _build_forecast(), _finish_forecast_result(), gpx_forecast_by_model(), job_forecast_by_model(), Assemble the final forecast payload from prepared ctx + fetched/parsed per-…, Build forecast_data from elevation data. Also used when restoring saved routes.…, Exception, build_open_meteo_params() (+11 more)

### Community 26 - "GPX Route Map Component"
Cohesion: 0.13
Nodes (15): findNearestTrackIdx(), geoBearing(), GpxBoundsTracker(), GpxMarkers(), GpxRouteMap(), handleEditMapClick(), haversineDist(), RoadHighlight (+7 more)

### Community 27 - "Layout & Progress/Results Pages"
Cohesion: 0.12
Nodes (12): NewHereBannerProps, TopBar(), getStepStatus(), ProgressPage(), StepStatus, DestinationResultsPage(), ref_components_ui_alert, ref_components_ui_skeleton (+4 more)

### Community 28 - "GPX Analysis Endpoint"
Cohesion: 0.11
Nodes (18): _elev_api(), find_nearest_city_id(), _gpx_arrival_dt(), gpx_subsample(), _haversine_km(), _interp_profile_at_km(), parse_gpx(), Parse GPX XML, return list of (lat, lon) tuples. (+10 more)

### Community 29 - "TypeScript Node Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 30 - "Frontend API Client Functions"
Cohesion: 0.12
Nodes (17): fetchRoadInfo(), fetchWindShelter(), getDestinationResults(), getGpxModelForecast(), getGpxResults(), getJobResults(), getJobStatus(), getModelForecast() (+9 more)

### Community 31 - "Elevation Profile & Route Optimization"
Cohesion: 0.13
Nodes (16): build_combined_elevation_profile(), _elev_api(), _expand_combination(), get_elevation_profile(), haversine(), hierarchical_waypoint_route(), optimized_travel_planner(), prepare_elevation_sampling() (+8 more)

### Community 32 - "Destination Weather Scoring"
Cohesion: 0.17
Nodes (16): _auto_start_day_direct(), _score_start(), _gpx_stop_climate_night_series(), _climate_slot_entry(), Find optimal start day for a direct-order OSRM route. Evaluates 52 weekly…, Climate-normals estimate of (temp, prcp, wspd, night_data) for a GPX overnight…, calculate_temperature_score(), create_loading_route_map() (+8 more)

### Community 33 - "Destination-Finding Job Runner"
Cohesion: 0.16
Nodes (16): Find destination cities + beam-search routes, then OSRM + elevation + forecast., run_destination_job(), on_beam_progress(), on_hierarchical_progress(), update(), check_route_feasibility(), find_destination_cities(), find_destination_route() (+8 more)

### Community 34 - "Frontend Dev Dependencies"
Cohesion: 0.12
Nodes (16): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, tailwindcss, @tailwindcss/vite (+8 more)

### Community 35 - "GpxPage Day Config Handlers"
Cohesion: 0.22
Nodes (13): buildDayConfigs(), derivedParam(), editParam(), GpxPage(), handleDayParam(), handleDrop(), handleFileChange(), handleFileSelected() (+5 more)

### Community 36 - "UI Alert/Badge/Button Components"
Cohesion: 0.16
Nodes (12): Alert, AlertDescription, AlertTitle, alertVariants, Badge(), BadgeProps, badgeVariants, Button (+4 more)

### Community 37 - "Route Optimization: TSP & Cluster Improvement"
Cohesion: 0.20
Nodes (14): calculate_route_score(), day_to_month(), find_optimal_route(), improve_route(), nearest_neighbor_with_random(), optimize_clusters_in_route(), Find optimal route considering both distance and temperature preferences.…, Convert day-of-year (1-366) to month (1-12). (+6 more)

### Community 38 - "City Geocoding & Graph Cache"
Cohesion: 0.17
Nodes (13): _build_graph_coord_cache(), _copy_nearest_temperatures(), _fetch_climate_normals_openmeteo(), _fetch_osrm_road_distances(), _find_nearest_graph_nodes(), geocode_and_register_city(), geocode_city_nominatim(), Return list of (node_id, nlat, nlon, air_km) for the n nearest original graph… (+5 more)

### Community 39 - "GPX Temperature Chart"
Cohesion: 0.31
Nodes (10): DayTempChart(), handleMouseMove(), getCssColors(), gpxArrivalTime(), GpxCombinedDayTempChart(), handleMouseMove(), GpxTemperatureChart(), interpNightMs() (+2 more)

### Community 40 - "Weather Cell & Weather Grid"
Cohesion: 0.18
Nodes (10): EXAMPLE, InfoPanel(), WeatherCell, WeatherCellProps, currentYear, GridRow, WeatherGrid(), ref_components_ui_label (+2 more)

### Community 41 - "GPX Elevation Chart"
Cohesion: 0.26
Nodes (8): DayChart(), handleMouseMove(), getCssColors(), gpxArrivalTime(), GpxElevationChart(), interpTempForGpx(), markerColor(), NightTempChart()

### Community 42 - "Road Profile Component"
Cohesion: 0.20
Nodes (9): aggregateRoadCategories(), buildRoadSegments(), EMPTY_FC, ROAD_COLORS, RoadDimension, RoadHighlightLayer(), RoadProfileBarChart(), SURFACE_COLORS (+1 more)

### Community 43 - "GpxPage Container"
Cohesion: 0.25
Nodes (9): DayConfig, DEFAULT, GlobalConfigPanel(), isParamDerived(), Param, paramDisplay(), PerDayTable(), ref_components_layout_newherebanner (+1 more)

### Community 44 - "GPX Route Editor"
Cohesion: 0.18
Nodes (8): EDIT_PROFILES, EditProfile, EMPTY_EDIT_SELECTION, GpxEditMapElements(), GpxEditPanel(), GpxEditSelection, gpxEditStep, ref_components_ui_checkbox

### Community 45 - "GPX Route Map Mini Charts"
Cohesion: 0.29
Nodes (9): gpxArrivalTime(), GpxMiniElevChart(), onChartMouseMove(), GpxMiniTempChart(), onChartMouseMove(), interpNightMs(), interpTempForGpx(), interpTempForGpxAtTime() (+1 more)

### Community 46 - "GpxResultsPage Handlers"
Cohesion: 0.24
Nodes (5): GpxResultsPage(), handleSelectModel(), runFallback(), hourFracFromIso(), interpolateGpxHourly()

### Community 47 - "Progress/Preview Maps"
Cohesion: 0.22
Nodes (6): ErrorCityMap(), ErrorCityMapProps, PreviewMap(), PreviewMapProps, ref_components_ui_map, maplibre-gl

### Community 48 - "ResultsPage Handlers"
Cohesion: 0.27
Nodes (9): buildRouteName(), ResultsPage(), fetchResults(), handleSave(), loadFromCacheOrFail(), pollElevation(), pollForecast(), scheduleElevationPoll() (+1 more)

### Community 49 - "TemperatureChart Component"
Cohesion: 0.31
Nodes (8): getForecastEndKm(), interpForecastByKey(), interpTempAtKm(), SegmentProps, TemperatureChart(), TempSegment(), onMouseMove(), ref_components_ui_slider

### Community 50 - "GPX Export Utility"
Cohesion: 0.38
Nodes (9): buildGpx(), buildGpxZip(), buildWaypoints(), downloadBlob(), downloadGpx(), downloadGpxZip(), escapeXml(), GpxZipEntry (+1 more)

### Community 51 - "Temperature Color Utility"
Cohesion: 0.20
Nodes (5): DAYS_IN_MONTH, MONTHS_DE, MONTHS_EN, STOPS_DARK, STOPS_LIGHT

### Community 52 - "Command Palette UI"
Cohesion: 0.22
Nodes (8): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, cmdk

### Community 53 - "Table UI Component"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 54 - "Frontend Bearing/Wind Constants"
Cohesion: 0.22
Nodes (3): MONTHS, PRESET_BLOCKED_COUNTRIES, WIND_DIRECTIONS

### Community 55 - "Beam Search Scoring"
Cohesion: 0.28
Nodes (9): angle_difference(), beam_search_route(), get_coords(), score_candidate(), _weather_score(), _bearing_continuity_penalty(), Calculate smallest difference between two angles, Calculate penalty for deviating from the travel direction of the last 3 cities.… (+1 more)

### Community 56 - "Select UI Component"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, @radix-ui/react-select

### Community 57 - "Icon Generation Script"
Cohesion: 0.32
Nodes (7): os, pil, draw_mark(), quad_bezier(), One-off generator for the PWA app icons (brand route+sun mark on the #d67229…, Stamp overlapping filled circles along pts — avoids the seam artifacts a thick…, stroke_path()

### Community 58 - "GPX Stop Parsing"
Cohesion: 0.29
Nodes (5): forecast_parse_gpx_stops(), GpxStopParseRequest, _parse_gpx_stop_raw(), Stateless equivalent of /api/forecast/parse for GPX overnight stops, which need…, Turn one raw Open-Meteo response (narrow hourly set: temp/precip/wind) into…

### Community 59 - "Client-Side Open-Meteo Fallback"
Cohesion: 0.43
Nodes (7): POST /api/forecast/parse, POST /api/forecast/parse-gpx-stops, OpenMeteoUnreachableError, fetchForecastViaBrowser(), fetchGpxStopsViaBrowser(), fetchOpenMeteoRaw(), Client-Seitiger Fallback für Open-Meteo

### Community 60 - "Route Split Control Handlers"
Cohesion: 0.38
Nodes (5): pillClass(), RouteSplitControl(), fetchSegmentPois(), handleDownloadSegment(), handleDownloadZip()

### Community 61 - "Card UI Component"
Cohesion: 0.29
Nodes (6): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle

### Community 62 - "Route Segments Utility"
Cohesion: 0.38
Nodes (4): buildSegments(), cumulativeKm(), haversineKm(), RouteSegment

### Community 63 - "Path/Bearing Scoring"
Cohesion: 0.29
Nodes (7): calculate_bearing(), calculate_daily_temperature_scores(), calculate_path_score(), Calculate compass bearing between two points in degrees, Calculate temperature, wind and rain scores for each day of travel between…, Cluster-compatible score calculation., Return initial bearing (0-360°) from point 1 to point 2.

### Community 64 - "Forecast Point Selection"
Cohesion: 0.33
Nodes (6): interp_route_day(), _prepare_forecast_points(), Compute the list of forecast points (with target_date) plus everything needed…, Interpolate the absolute travel day for a km position along the route., Select ~20-40 forecast points at elevation extrema along the route., select_forecast_points()

### Community 66 - "Saved Route Restore Job"
Cohesion: 0.40
Nodes (5): Background thread: expose saved result immediately (preview), then refresh…, Rehydrate a locally-stored route blob into a fresh in-memory job and refresh…, restore_saved_route(), RestoreRouteRequest, run_restore_job()

### Community 67 - "npm Scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 68 - "Step Indicator Component"
Cohesion: 0.40
Nodes (4): StepIndicator(), StepIndicatorProps, StepStatus, ref_components_ui_progress

### Community 69 - "Tabs UI Component"
Cohesion: 0.40
Nodes (4): TabsContent, TabsList, TabsTrigger, @radix-ui/react-tabs

### Community 70 - "WizardPage Navigation Handlers"
Cohesion: 0.60
Nodes (4): WizardPage(), goNext(), handleSubmit(), handleSubmitDestination()

### Community 71 - "IndexedDB Wrapper"
Cohesion: 0.50
Nodes (4): openDb(), STORE_RESULTS_CACHE, STORE_SAVED_ROUTES, withStore()

### Community 76 - "Label UI Component"
Cohesion: 0.67
Nodes (3): Label, labelVariants, @radix-ui/react-label

### Community 77 - "Wind Exposure Overlay Layer"
Cohesion: 0.67
Nodes (3): bearingDeg(), buildWindSegments(), WindExposureLayer()

### Community 78 - "POI Overlay Layer"
Cohesion: 0.67
Nodes (3): emptyPoiMap(), simplifyPoints(), usePoiOverlay()

### Community 80 - "PlannerPage Handlers"
Cohesion: 1.00
Nodes (3): PlannerPage(), handleSubmit(), validate()

## Knowledge Gaps
- **348 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+343 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 687 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Layout & Progress/Results Pages` to `Map Component (Leaflet/MapLibre Wrapper)`, `Route Planner Backend Endpoints & README Features`, `GPX Wizard & Day Config`, `Map Layers & Overlay State`, `Forecast Map Component`, `Planner Search & List Components`, `App Routing & Page Registry`, `Zustand Stores & i18n`, `Frontend Build Config & Dependencies`, `UI Primitives (Input, Progress, Switch, etc.)`, `WizardPage Steps (Destination Finder)`, `GPX Model Badges & Route Split Control`, `RoutePlannerPage UI Panels`, `Results Page Sub-Components`, `GPX Route Map Component`, `UI Alert/Badge/Button Components`, `GPX Temperature Chart`, `Weather Cell & Weather Grid`, `GPX Elevation Chart`, `Road Profile Component`, `GpxPage Container`, `GPX Route Editor`, `Progress/Preview Maps`, `TemperatureChart Component`, `Command Palette UI`, `Table UI Component`, `Select UI Component`, `Card UI Component`, `Live Location Component`, `Tabs UI Component`, `ClassName Merge Utility`, `Label UI Component`, `Popover UI Component`, `Slider UI Component`, `Tooltip UI Component`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `Planner Search & List Components` to `Map Component (Leaflet/MapLibre Wrapper)`, `Route Planner Backend Endpoints & README Features`, `GPX Wizard & Day Config`, `Map Layers & Overlay State`, `Forecast Map Component`, `Frontend Build Config & Dependencies`, `UI Primitives (Input, Progress, Switch, etc.)`, `WizardPage Steps (Destination Finder)`, `GPX Model Badges & Route Split Control`, `RoutePlannerPage UI Panels`, `Results Page Sub-Components`, `GPX Route Map Component`, `Layout & Progress/Results Pages`, `GPX Temperature Chart`, `Weather Cell & Weather Grid`, `GPX Elevation Chart`, `Road Profile Component`, `GpxPage Container`, `GPX Route Editor`, `TemperatureChart Component`, `Command Palette UI`, `Select UI Component`, `Live Location Component`, `Step Indicator Component`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _348 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Map Component (Leaflet/MapLibre Wrapper)` be split into smaller, more focused modules?**
  _Cohesion score 0.05757575757575758 - nodes in this community are weakly interconnected._
- **Should `Route Planner Backend Endpoints & README Features` be split into smaller, more focused modules?**
  _Cohesion score 0.052854122621564484 - nodes in this community are weakly interconnected._
- **Should `GPX Wizard & Day Config` be split into smaller, more focused modules?**
  _Cohesion score 0.09407665505226481 - nodes in this community are weakly interconnected._
- **Should `Saved Routes & Routing Algorithms Overview` be split into smaller, more focused modules?**
  _Cohesion score 0.06219512195121951 - nodes in this community are weakly interconnected._