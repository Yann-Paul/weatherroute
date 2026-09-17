# Graph Report - weatherroute-master  (2026-09-17)

## Corpus Check
- 111 files · ~493,043 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .bat 3, .gexf 1)

## Summary
- 1387 nodes · 2358 edges · 88 communities (68 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `64d9e3b9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- map.tsx
- RainRadar.tsx
- GpxWizardPage.tsx
- savedRoutesDb.ts
- api_app.py
- MapLayers.tsx
- types.ts
- ForecastMap.tsx
- react
- App.tsx
- themeStore.ts
- package.json
- RoutePlannerPage
- _overpass_query
- run_calculation
- PlannerPage.tsx
- dependencies
- ref_lib_utils
- client.ts
- WizardPage.tsx
- module.py
- lucide-react
- compilerOptions
- RoutePlannerPage.tsx
- ResultsPage.tsx
- _build_forecast
- GpxRouteMap.tsx
- GpxRouteEditor.tsx
- run_gpx_analysis
- compilerOptions
- request
- GpxMiniTempChart
- get_interpolated_weather
- button.tsx
- devDependencies
- GpxPage
- alert.tsx
- tooltip.tsx
- geocode_and_register_city
- GpxTemperatureChart.tsx
- WeatherGrid.tsx
- GpxElevationChart.tsx
- RoadProfile.tsx
- GpxPage.tsx
- GpxResultsPage
- ref_components_ui_map
- ResultsPage
- TemperatureChart.tsx
- gpxExport.ts
- tempColor.ts
- command.tsx
- table.tsx
- constants.ts
- _bearing_continuity_penalty
- select.tsx
- gen_icons.py
- Client-Seitiger Fallback für Open-Meteo
- RouteSplitControl
- card.tsx
- routeSegments.ts
- _prepare_forecast_points
- scripts
- StepIndicator.tsx
- tabs.tsx
- WizardPage
- idb.ts
- weatherScoring.ts
- LayersMenu
- RoutePlannerTour.tsx
- buildWindSegments
- usePoiOverlay
- useMapOverlays
- PlannerPage
- popover.tsx
- countries.ts
- gpxParser.ts
- tsconfig.json
- download-brouter-segments.sh
- start-dev.sh
- start-prod.sh
- Graphify Knowledge Graph Workflow
- Apple touch icon (weatherroute app icon)
- App icon (192x192): white curved route/stick shape with a circle on an orange background
- App Icon (512x512): Route to Sun
- Maskable App Icon (192px, route + sun)
- Maskable App Icon (512x512)
- Routenplaner Beispiel Screenshot
- Fortschrittsanzeige

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
- **Overpass Reliability Strategy** — readme_overpass_reliability, readme_mirror_racing, readme_grid_cache, readme_overpass_serialization_lock [EXTRACTED 1.00]
- **Beam-Search Scoring Pipeline** — backend_module_beam_search_route, backend_module_score_candidate, readme_direction_penalty_concept, readme_continuity_penalty_concept [INFERRED 0.85]
- **Ziel-Finden Two-Phase Pipeline** — backend_module_find_destination_cities, backend_module_beam_search_route, backend_module_hierarchical_waypoint_route, backend_module_optimized_travel_planner [INFERRED 0.85]

## Communities (88 total, 20 thin omitted)

### Community 0 - "map.tsx"
Cohesion: 0.06
Nodes (39): CompassButton(), CONTENT_LAYER_PREFIXES, defaultStyles, getDocumentTheme(), getSystemTheme(), getViewport(), Map, MapClusterLayer() (+31 more)

### Community 1 - "RainRadar.tsx"
Cohesion: 0.05
Nodes (40): POST /api/route-planner/jobs, POST /api/route-planner/pois, POST /api/route-planner/preview, POST /api/route-planner/wind-shelter, BRouter Docker Compose Service, RainViewerData, RainViewerFrame, useRainRadar() (+32 more)

### Community 2 - "GpxWizardPage.tsx"
Cohesion: 0.09
Nodes (32): buildDayConfigs(), DayConfig, DEFAULT_DAY_CONFIG, derivedParam(), editParam(), isParamDerived(), numDaysFor(), Param (+24 more)

### Community 3 - "savedRoutesDb.ts"
Cohesion: 0.06
Nodes (33): POST /api/saved-routes/export, POST /api/saved-routes/restore, _find_waypoint_cities, _score_waypoint_combo, beam_search_route, find_destination_cities, get_interpolated_weather, hierarchical_waypoint_route (+25 more)

### Community 4 - "api_app.py"
Cohesion: 0.04
Nodes (87): _around_polyline(), CityEntry, Connection, DestinationDetailRequest, DestinationFinderSubmission, export_saved_route(), forecast_parse(), forecast_parse_gpx_stops() (+79 more)

### Community 5 - "MapLayers.tsx"
Cohesion: 0.05
Nodes (28): BASE_STYLES, BaseLayer, CYCLING_STYLE, CYCLING_STYLES, CYCLOSM_TILES, DEFAULT_MAP_OVERLAYS, DEFAULT_POI_RADIUS_M, MapOverlaysState (+20 more)

### Community 6 - "types.ts"
Cohesion: 0.06
Nodes (35): CityEntry, CLIENT_FALLBACK_NEEDED, Connection, CountrySearchResult, DestinationCity, DestinationRoute, DestinationRouteCity, DestinationRouteSegment (+27 more)

### Community 7 - "ForecastMap.tsx"
Cohesion: 0.11
Nodes (33): climateInterp(), climateInterpTemp(), ClimateMarkers(), ClimateMarkersProps, ClimatePoint, climateWdirAt(), compassDir16(), eleAtKm() (+25 more)

### Community 8 - "react"
Cohesion: 0.14
Nodes (18): NewHereBannerProps, AdvancedPanel(), CityCombobox(), CityComboboxProps, ConnectionList(), CountryCombobox(), CountryComboboxProps, ref_api_types (+10 more)

### Community 9 - "App.tsx"
Cohesion: 0.06
Nodes (23): React + TypeScript + Vite Template, App(), DestinationResultsPage, GpxPage, GpxResultsPage, GpxWizardPage, ProgressPage, ResultsPage (+15 more)

### Community 10 - "themeStore.ts"
Cohesion: 0.08
Nodes (25): applyLangToDocument(), LangState, useLangStore, de, en, Lang, Translations, dict (+17 more)

### Community 11 - "package.json"
Cohesion: 0.07
Nodes (27): name, private, type, version, TILE_HOST_PATTERN, TILE_HOSTS, clsx, @dnd-kit/utilities (+19 more)

### Community 12 - "RoutePlannerPage"
Cohesion: 0.08
Nodes (12): bestInsertIndex(), RoutePlannerPage(), buildConfigs(), computeSignature(), handleConfirmPending(), handleFinalize(), handleRefreshWeather(), pollWeatherJob() (+4 more)

### Community 13 - "_overpass_query"
Cohesion: 0.40
Nodes (5): _fetch_overpass_mirror(), _overpass_query(), _cache_result(), _launch_next(), POST a query to Overpass, with a small in-memory TTL cache. Query *sessions*…

### Community 14 - "run_calculation"
Cohesion: 0.08
Nodes (26): _fmt_elev(), _friendly_error(), Normalized score (0=good, 1=bad) to hex color., Background thread: consumes (seg_idx, chunk) tuples from seg_queue, samples…, Format elevation data dict into the JSON result shape., Find destination cities + beam-search routes, then OSRM + elevation + forecast., Direct OSRM route: connect cities A→B→C in input order, no graph algorithm., Register pending nominatim cities in the background thread with progress… (+18 more)

### Community 15 - "PlannerPage.tsx"
Cohesion: 0.15
Nodes (15): CityList(), SavedRoutesList(), getStepStatus(), ProgressPage(), StepStatus, DestinationResultsPage(), ref_api_client, ref_components_magicui_shimmer_button (+7 more)

### Community 16 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, class-variance-authority, clsx, cmdk, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, jszip (+20 more)

### Community 17 - "ref_lib_utils"
Cohesion: 0.07
Nodes (17): NumberTickerProps, ShimmerButton, ShimmerButtonProps, Checkbox, Input, NumericInput, NumericInputProps, Progress (+9 more)

### Community 18 - "client.ts"
Cohesion: 0.08
Nodes (22): CitySearchResult, DestinationFinderFormData, DestinationJobResults, ForecastPointData, GeocodeResult, GpxDayConfig, GpxForecastUpdate, GpxJobResults (+14 more)

### Community 19 - "WizardPage.tsx"
Cohesion: 0.08
Nodes (8): DEST_STEPS, Step, WIZARD_STEPS, ref_components_planner_citycombobox, ref_components_planner_citylist, ref_components_planner_connectionlist, ref_components_planner_countrycombobox, ref_pictures_routenplaner_beispiel_png

### Community 20 - "module.py"
Cohesion: 0.04
Nodes (74): collections, datetime, heapq, itertools, json, math, assemble_elevation_profile(), build_combined_elevation_profile() (+66 more)

### Community 21 - "lucide-react"
Cohesion: 0.10
Nodes (18): GpxModelBadges(), MODELS, Props, ModelOverride, RoadHighlight, GpxWeatherTable(), Mode, RouteSplitControlProps (+10 more)

### Community 22 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, baseUrl, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 23 - "RoutePlannerPage.tsx"
Cohesion: 0.09
Nodes (14): ControlsPanel(), GERMANY_CENTER, Profile, PROFILES, ProfileTab, RoadHighlight, WaypointOrderPanel(), WeatherStatus (+6 more)

### Community 24 - "ResultsPage.tsx"
Cohesion: 0.16
Nodes (16): ElevationChart(), ElevationSegment(), onMouseMove(), getForecastEndKm(), interpForecastByKey(), interpTempAtKm(), SegmentProps, ModelBadges() (+8 more)

### Community 25 - "_build_forecast"
Cohesion: 0.12
Nodes (21): _build_forecast(), _finish_forecast_result(), gpx_forecast_by_model(), job_forecast_by_model(), Assemble the final forecast payload from prepared ctx + fetched/parsed per-…, Build forecast_data from elevation data. Also used when restoring saved routes.…, Background thread: expose saved result immediately (preview), then refresh…, run_restore_job() (+13 more)

### Community 26 - "GpxRouteMap.tsx"
Cohesion: 0.12
Nodes (16): findNearestTrackIdx(), geoBearing(), GpxBoundsTracker(), GpxMarkers(), GpxRouteMap(), handleEditMapClick(), haversineDist(), RoadHighlight (+8 more)

### Community 27 - "GpxRouteEditor.tsx"
Cohesion: 0.18
Nodes (8): EDIT_PROFILES, EditProfile, EMPTY_EDIT_SELECTION, GpxEditMapElements(), GpxEditPanel(), GpxEditSelection, gpxEditStep, ref_components_ui_checkbox

### Community 28 - "run_gpx_analysis"
Cohesion: 0.07
Nodes (24): _elev_api(), find_nearest_city_id(), _gpx_arrival_dt(), gpx_subsample(), _haversine_km(), _interp_profile_at_km(), parse_gpx(), _parse_gpx_stop_raw() (+16 more)

### Community 29 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 30 - "request"
Cohesion: 0.12
Nodes (17): fetchRoadInfo(), fetchWindShelter(), getDestinationResults(), getGpxModelForecast(), getGpxResults(), getJobResults(), getJobStatus(), getModelForecast() (+9 more)

### Community 31 - "GpxMiniTempChart"
Cohesion: 0.29
Nodes (9): gpxArrivalTime(), GpxMiniElevChart(), onChartMouseMove(), GpxMiniTempChart(), onChartMouseMove(), interpNightMs(), interpTempForGpx(), interpTempForGpxAtTime() (+1 more)

### Community 32 - "get_interpolated_weather"
Cohesion: 0.14
Nodes (21): _auto_start_day_direct(), _score_start(), _gpx_stop_climate_night_series(), _climate_slot_entry(), Find optimal start day for a direct-order OSRM route. Evaluates 52 weekly…, Climate-normals estimate of (temp, prcp, wspd, night_data) for a GPX overnight…, beam_search_route(), get_coords() (+13 more)

### Community 33 - "button.tsx"
Cohesion: 0.50
Nodes (4): Button, ButtonProps, buttonVariants, @radix-ui/react-slot

### Community 34 - "devDependencies"
Cohesion: 0.12
Nodes (16): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, tailwindcss, @tailwindcss/vite (+8 more)

### Community 35 - "GpxPage"
Cohesion: 0.22
Nodes (13): buildDayConfigs(), derivedParam(), editParam(), GpxPage(), handleDayParam(), handleDrop(), handleFileChange(), handleFileSelected() (+5 more)

### Community 36 - "alert.tsx"
Cohesion: 0.18
Nodes (11): Alert, AlertDescription, AlertTitle, alertVariants, Badge(), BadgeProps, badgeVariants, Label (+3 more)

### Community 38 - "geocode_and_register_city"
Cohesion: 0.17
Nodes (13): _build_graph_coord_cache(), _copy_nearest_temperatures(), _fetch_climate_normals_openmeteo(), _fetch_osrm_road_distances(), _find_nearest_graph_nodes(), geocode_and_register_city(), geocode_city_nominatim(), Return list of (node_id, nlat, nlon, air_km) for the n nearest original graph… (+5 more)

### Community 39 - "GpxTemperatureChart.tsx"
Cohesion: 0.31
Nodes (10): DayTempChart(), handleMouseMove(), getCssColors(), gpxArrivalTime(), GpxCombinedDayTempChart(), handleMouseMove(), GpxTemperatureChart(), interpNightMs() (+2 more)

### Community 40 - "WeatherGrid.tsx"
Cohesion: 0.17
Nodes (10): EXAMPLE, InfoPanel(), WeatherCell, WeatherCellProps, currentYear, GridRow, WeatherGrid(), ref_components_ui_label (+2 more)

### Community 41 - "GpxElevationChart.tsx"
Cohesion: 0.26
Nodes (8): DayChart(), handleMouseMove(), getCssColors(), gpxArrivalTime(), GpxElevationChart(), interpTempForGpx(), markerColor(), NightTempChart()

### Community 42 - "RoadProfile.tsx"
Cohesion: 0.20
Nodes (9): aggregateRoadCategories(), buildRoadSegments(), EMPTY_FC, ROAD_COLORS, RoadDimension, RoadHighlightLayer(), RoadProfileBarChart(), SURFACE_COLORS (+1 more)

### Community 43 - "GpxPage.tsx"
Cohesion: 0.25
Nodes (9): DayConfig, DEFAULT, GlobalConfigPanel(), isParamDerived(), Param, paramDisplay(), PerDayTable(), ref_components_layout_newherebanner (+1 more)

### Community 46 - "GpxResultsPage"
Cohesion: 0.24
Nodes (5): GpxResultsPage(), handleSelectModel(), runFallback(), hourFracFromIso(), interpolateGpxHourly()

### Community 47 - "ref_components_ui_map"
Cohesion: 0.13
Nodes (8): LiveCoords, LiveLocationStatus, ErrorCityMap(), ErrorCityMapProps, PreviewMap(), PreviewMapProps, ref_components_ui_map, maplibre-gl

### Community 48 - "ResultsPage"
Cohesion: 0.27
Nodes (9): buildRouteName(), ResultsPage(), fetchResults(), handleSave(), loadFromCacheOrFail(), pollElevation(), pollForecast(), scheduleElevationPoll() (+1 more)

### Community 49 - "TemperatureChart.tsx"
Cohesion: 0.22
Nodes (9): TopBar(), getForecastEndKm(), interpForecastByKey(), interpTempAtKm(), SegmentProps, TemperatureChart(), TempSegment(), onMouseMove() (+1 more)

### Community 50 - "gpxExport.ts"
Cohesion: 0.33
Nodes (10): buildGpx(), buildGpxZip(), buildWaypoints(), downloadBlob(), downloadGpx(), downloadGpxZip(), escapeXml(), GpxZipEntry (+2 more)

### Community 51 - "tempColor.ts"
Cohesion: 0.20
Nodes (5): DAYS_IN_MONTH, MONTHS_DE, MONTHS_EN, STOPS_DARK, STOPS_LIGHT

### Community 52 - "command.tsx"
Cohesion: 0.22
Nodes (8): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, cmdk

### Community 53 - "table.tsx"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 54 - "constants.ts"
Cohesion: 0.22
Nodes (3): MONTHS, PRESET_BLOCKED_COUNTRIES, WIND_DIRECTIONS

### Community 55 - "_bearing_continuity_penalty"
Cohesion: 0.29
Nodes (7): angle_difference(), _bearing_continuity_penalty(), calculate_bearing(), Calculate compass bearing between two points in degrees, Calculate smallest difference between two angles, Calculate penalty for deviating from the travel direction of the last 3 cities.…, Return initial bearing (0-360°) from point 1 to point 2.

### Community 56 - "select.tsx"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, @radix-ui/react-select

### Community 57 - "gen_icons.py"
Cohesion: 0.32
Nodes (7): os, pil, draw_mark(), quad_bezier(), One-off generator for the PWA app icons (brand route+sun mark on the #d67229…, Stamp overlapping filled circles along pts — avoids the seam artifacts a thick…, stroke_path()

### Community 59 - "Client-Seitiger Fallback für Open-Meteo"
Cohesion: 0.43
Nodes (7): POST /api/forecast/parse, POST /api/forecast/parse-gpx-stops, OpenMeteoUnreachableError, fetchForecastViaBrowser(), fetchGpxStopsViaBrowser(), fetchOpenMeteoRaw(), Client-Seitiger Fallback für Open-Meteo

### Community 60 - "RouteSplitControl"
Cohesion: 0.38
Nodes (5): pillClass(), RouteSplitControl(), fetchSegmentPois(), handleDownloadSegment(), handleDownloadZip()

### Community 61 - "card.tsx"
Cohesion: 0.29
Nodes (6): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle

### Community 62 - "routeSegments.ts"
Cohesion: 0.38
Nodes (4): buildSegments(), cumulativeKm(), haversineKm(), RouteSegment

### Community 64 - "_prepare_forecast_points"
Cohesion: 0.33
Nodes (6): interp_route_day(), _prepare_forecast_points(), Compute the list of forecast points (with target_date) plus everything needed…, Interpolate the absolute travel day for a km position along the route., Select ~20-40 forecast points at elevation extrema along the route., select_forecast_points()

### Community 67 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 68 - "StepIndicator.tsx"
Cohesion: 0.40
Nodes (4): StepIndicator(), StepIndicatorProps, StepStatus, ref_components_ui_progress

### Community 69 - "tabs.tsx"
Cohesion: 0.40
Nodes (4): TabsContent, TabsList, TabsTrigger, @radix-ui/react-tabs

### Community 70 - "WizardPage"
Cohesion: 0.60
Nodes (4): WizardPage(), goNext(), handleSubmit(), handleSubmitDestination()

### Community 71 - "idb.ts"
Cohesion: 0.50
Nodes (4): openDb(), STORE_RESULTS_CACHE, STORE_SAVED_ROUTES, withStore()

### Community 77 - "buildWindSegments"
Cohesion: 0.67
Nodes (3): bearingDeg(), buildWindSegments(), WindExposureLayer()

### Community 78 - "usePoiOverlay"
Cohesion: 0.29
Nodes (7): distanceToRouteM(), emptyPoiMap(), mergePois(), poiKey(), pointToSegmentM(), simplifyPoints(), usePoiOverlay()

### Community 80 - "PlannerPage"
Cohesion: 1.00
Nodes (3): PlannerPage(), handleSubmit(), validate()

## Knowledge Gaps
- **349 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+344 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 690 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `map.tsx`, `RainRadar.tsx`, `GpxWizardPage.tsx`, `MapLayers.tsx`, `ForecastMap.tsx`, `App.tsx`, `themeStore.ts`, `package.json`, `PlannerPage.tsx`, `ref_lib_utils`, `WizardPage.tsx`, `lucide-react`, `RoutePlannerPage.tsx`, `ResultsPage.tsx`, `GpxRouteMap.tsx`, `GpxRouteEditor.tsx`, `button.tsx`, `alert.tsx`, `tooltip.tsx`, `GpxTemperatureChart.tsx`, `WeatherGrid.tsx`, `GpxElevationChart.tsx`, `RoadProfile.tsx`, `GpxPage.tsx`, `ref_components_ui_map`, `TemperatureChart.tsx`, `command.tsx`, `table.tsx`, `select.tsx`, `card.tsx`, `tabs.tsx`, `popover.tsx`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `lucide-react` to `map.tsx`, `RainRadar.tsx`, `GpxWizardPage.tsx`, `MapLayers.tsx`, `ForecastMap.tsx`, `react`, `package.json`, `PlannerPage.tsx`, `ref_lib_utils`, `WizardPage.tsx`, `RoutePlannerPage.tsx`, `ResultsPage.tsx`, `GpxRouteMap.tsx`, `GpxRouteEditor.tsx`, `GpxTemperatureChart.tsx`, `WeatherGrid.tsx`, `GpxElevationChart.tsx`, `RoadProfile.tsx`, `GpxPage.tsx`, `ref_components_ui_map`, `TemperatureChart.tsx`, `command.tsx`, `select.tsx`, `StepIndicator.tsx`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _349 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `map.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05603864734299517 - nodes in this community are weakly interconnected._
- **Should `RainRadar.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.052854122621564484 - nodes in this community are weakly interconnected._
- **Should `GpxWizardPage.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09407665505226481 - nodes in this community are weakly interconnected._
- **Should `savedRoutesDb.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06219512195121951 - nodes in this community are weakly interconnected._