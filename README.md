# WeatherRoute

Wetter-optimierter Reiseroutenplaner für Europa. Die Anwendung berechnet die beste Route zwischen mehreren Städten basierend auf Temperaturwünschen, Höhenprofilen und historischen Klimadaten.

---

## Funktionen

### Routenplanung (`/`)

Der Kern der Anwendung. Der Nutzer gibt Städte ein, die er besuchen möchte, und das System findet die optimale Reihenfolge sowie den besten Weg dazwischen.

**Städteauswahl**
- Autovervollständigung mit Suche im europäischen Städtegraph (15.000+ Städte)
- Fallback auf Nominatim-Geocoding für nicht enthaltene Orte
- Drag-and-Drop zum Umsortieren der Städteliste
- Optional: feste Startstadt angeben

**Reisedatum**
- Automatische Erkennung (aktuelles Datum) oder manuelles Startdatum
- Das Datum bestimmt, welche Klimanormale für die Temperaturberechnung herangezogen werden

**Erweiterte Einstellungen** (aufklappbar)

| Einstellung | Beschreibung |
|---|---|
| Direktverbindungen | Erzwinge direkte Strecken zwischen bestimmten Städtepaaren |
| Wunschtemperatur Tag/Nacht | Zieltemperatur, nach der die Route optimiert wird |
| Temperaturbereich | Mindest- und Höchsttemperatur für Tag und Nacht (Grenzwerte) |
| Klimaerwärmungsfaktor | Korrektur der historischen Klimadaten um aktuellen Temperaturanstieg |
| Temperaturgewicht | Balance zwischen kürzester Route und bester Temperatur |
| Max. km pro Tag | Maximale Tageskilometer zur Reisedauerplanung |
| Max. Reisetage | Gesamtlimit für die Reisedauer |
| Höhenauflösung | Dichte der Höhenpunkte entlang der Route (100–3000 m) |
| Gesperrte Länder | Länder, durch die die Route nicht führen soll |

**Gespeicherte Routen**
- Frühere Routenberechnungen können gespeichert und wiederhergestellt werden
- Gespeicherte Routen lassen sich als Ausgangspunkt für neue Planungen laden

---

### Fortschrittsanzeige (`/progress/:jobId`)

Da die Routenberechnung mehrere Minuten dauern kann, läuft sie asynchron im Hintergrund. Die Fortschrittsseite zeigt in Echtzeit:

- Aktuellen Berechnungsschritt mit Beschreibung
- Fortschrittsbalken für OSRM-Straßenrouting (Segmente)
- Fortschrittsbalken für Höhendatenabruf (Batches)
- Fortschrittsbalken für Wetterprognose
- Vorschaukarte mit dem ungefähren Routenverlauf (sobald verfügbar)

---

### Ergebnisse (`/results/:jobId`)

Die fertige Route wird mit vollständigen Wetterdaten visualisiert:

**Interaktive Karte**
- Routenverlauf auf MapLibre-GL-Karte
- Stadtmarkierungen mit Tooltips
- Farbcodierung nach Temperatur

**Temperaturdiagramm**
- Tages- und Nachttemperaturen für jeden Reisetag
- Wunschtemperatur als Referenzlinie

**Höhenprofil**
- Geländehöhe entlang der gesamten Route
- Zeigt Gebirge, Pässe und Täler

**Wettergitter**
- Tabellarische Übersicht aller Reisetage
- Temperaturen, Niederschlag, Windgeschwindigkeit pro Stadt und Tag

**Route speichern**
- Aktuelle Route mit Name versehen und für spätere Nutzung speichern

---

### GPX-Analyse (`/gpx`)

Für bereits geplante Routen (z. B. aus Wanderungs- oder Radfahrplanern):

- GPX-Datei hochladen
- Startdatum und maximale Tageskilometer eingeben
- Vorschau des Höhenprofils vor der Berechnung

**GPX-Ergebnisse (`/gpx/results/:jobId`)**
- Karte mit dem hochgeladenen GPX-Pfad
- Temperaturverlauf entlang der Route
- Höhenprofil
- Wettertabelle nach Etappen

---

## Berechnungsablauf

```
Städteeingabe
    │
    ▼
Graphsuche + Temperaturbewertung
(NetworkX, Klimanormale 1991–2020)
    │
    ▼
Straßenrouting via OSRM
(reale Fahrstrecken zwischen Städten)
    │
    ▼
Höhendatenabruf
(SRTM bis 60°N · ASTER für Polarregionen)
    │
    ▼
Wetterinterpolation
(Klimanormale + Höhenkorrektur + Erwärmungsfaktor)
    │
    ▼
Ergebnis mit Karte, Diagrammen & Wettertabelle
```

---

## Externe APIs (kostenlos, kein API-Key erforderlich)

| API | Verwendung |
|---|---|
| [OSRM](https://router.project-osrm.org) | Straßenentfernungen und Routengeometrien |
| [Open-Elevation](https://api.open-elevation.com) | SRTM-Höhendaten (56°S–60°N) |
| [OpenTopoData](https://api.opentopodata.org) | ASTER-Höhendaten (Polarregionen bis 83°N) |
| [Nominatim](https://nominatim.openstreetmap.org) | Geocoding für Städte außerhalb des Graphen |

---

## Projektstruktur

```
weatherroute/
│
├── backend/
│   ├── api_app.py              # FastAPI-Server, alle API-Endpunkte
│   ├── module.py               # Berechnungslogik (Routing, Klima, Höhen)
│   └── data/
│       ├── european_cities_graph.gexf          # Städtegraph (NetworkX, 3 MB)
│       ├── european_city_climate_normals.json  # Klimanormale 1991–2020 (5 MB)
│       ├── german_city_names.json              # Deutsche Städtenamen → IDs
│       ├── city_ids_by_country.json            # Ländercode → Stadtliste
│       ├── nominatim_cities.json               # Cache für geocodierte Städte
│       └── saved_routes/                       # Gespeicherte Nutzerrouten (JSON)
│
├── frontend/
│   └── src/
│       ├── App.tsx                     # Routing (React Router)
│       ├── api/
│       │   ├── client.ts               # API-Aufrufe zum Backend
│       │   └── types.ts                # TypeScript-Typdefinitionen
│       ├── components/
│       │   ├── planner/                # Routenplaner-UI
│       │   │   ├── PlannerPage.tsx     # Hauptseite
│       │   │   ├── CityList.tsx        # Städteliste mit Drag & Drop
│       │   │   ├── CityCombobox.tsx    # Stadtsuche mit Autocomplete
│       │   │   ├── AdvancedPanel.tsx   # Erweiterte Einstellungen
│       │   │   ├── ConnectionList.tsx  # Direktverbindungen
│       │   │   └── SavedRoutesList.tsx # Gespeicherte Routen
│       │   ├── progress/
│       │   │   ├── ProgressPage.tsx    # Fortschrittsanzeige
│       │   │   ├── PreviewMap.tsx      # Vorschaukarte
│       │   │   └── StepIndicator.tsx   # Schrittanzeige
│       │   ├── results/
│       │   │   ├── ResultsPage.tsx     # Ergebnisseite
│       │   │   ├── ForecastMap.tsx     # Interaktive Karte
│       │   │   ├── TemperatureChart.tsx # Temperaturdiagramm
│       │   │   ├── ElevationChart.tsx  # Höhenprofil
│       │   │   ├── WeatherGrid.tsx     # Wettertabelle
│       │   │   └── RouteList.tsx       # Stadtliste mit Details
│       │   ├── gpx/
│       │   │   ├── GpxPage.tsx         # GPX-Upload
│       │   │   ├── GpxResultsPage.tsx  # GPX-Ergebnisse
│       │   │   ├── GpxRouteMap.tsx     # GPX-Karte
│       │   │   ├── GpxElevationChart.tsx
│       │   │   ├── GpxTemperatureChart.tsx
│       │   │   └── GpxWeatherTable.tsx
│       │   ├── layout/
│       │   │   └── TopBar.tsx          # Navigation
│       │   ├── ui/                     # Radix UI Basiskomponenten
│       │   └── magicui/                # Animierte UI-Elemente
│       ├── stores/
│       │   ├── plannerStore.ts         # Formularzustand (Zustand)
│       │   ├── jobStore.ts             # Aktuelle Job-ID
│       │   ├── resultsStore.ts         # Ergebnis-Cache
│       │   └── themeStore.ts           # Hell-/Dunkelmodus
│       ├── i18n/
│       │   ├── translations.ts         # Übersetzungstexte
│       │   ├── store.ts                # Sprachauswahl
│       │   └── useT.ts                 # Hook für Übersetzungen
│       └── utils/
│           └── constants.ts            # Konstanten (gesperrte Länder, etc.)
│
├── requirements.txt            # Python-Abhängigkeiten
├── Dockerfile                  # Multi-Stage Docker Build
├── render.yaml                 # Render.com Deployment-Konfiguration
├── start-dev.sh / .bat         # Entwicklungsserver starten
└── start-prod.sh / .bat        # Produktionsserver starten
```

### API-Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/cities/search` | Stadtsuche mit Autocomplete |
| `GET` | `/api/countries/search` | Ländersuche |
| `POST` | `/api/jobs` | Routenberechnung starten |
| `GET` | `/api/jobs/{id}/status` | Berechnungsfortschritt abfragen |
| `GET` | `/api/jobs/{id}/results` | Fertige Ergebnisse abrufen |
| `POST` | `/api/gpx/jobs` | GPX-Analyse starten |
| `GET` | `/api/saved-routes` | Gespeicherte Routen auflisten |
| `POST` | `/api/saved-routes` | Route speichern |
| `DELETE` | `/api/saved-routes/{id}` | Route löschen |
| `POST` | `/api/saved-routes/{id}/restore` | Route in Planer laden |

---

## Tech Stack

**Backend**
- Python 3.11, FastAPI, Uvicorn
- NetworkX (Graphalgorithmen)
- NumPy, SciPy, scikit-learn (Berechnungen)
- polyline (Koordinatenkodierung)

**Frontend**
- React 19, TypeScript, Vite
- TailwindCSS 4, Radix UI
- MapLibre GL (Karten)
- Zustand (State Management)
- Framer Motion (Animationen)
- @dnd-kit (Drag & Drop)

---

## Starten

**Entwicklung**

```bash
# Windows
start-dev.bat

# Linux/macOS
./start-dev.sh
```

Backend läuft auf `http://localhost:8000`, Frontend auf `http://localhost:5173` (mit Hot Reload).

**Produktion**

```bash
# Windows
start-prod.bat

# Linux/macOS
./start-prod.sh
```

Frontend wird gebaut und über FastAPI auf Port `8000` ausgeliefert.

**Docker**

```bash
docker build -t weatherroute .
docker run -p 8000:8000 weatherroute
```
