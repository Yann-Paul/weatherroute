# WeatherRoute

Wetter-optimierter Reiseroutenplaner für Europa. Die Anwendung berechnet die beste Route zwischen mehreren Städten basierend auf Temperaturwünschen, Höhenprofilen und historischen Klimadaten.

---

## Funktionen

### Routenplanung & Zielsuche (`/`)

Die Hauptseite bietet zwei Modi, umschaltbar über einen Tab-Schalter oben:

---

#### Modus 1: Route planen

Der klassische Modus. Der Nutzer gibt Städte ein, die er besuchen möchte, und das System findet die optimale Reihenfolge sowie den besten Weg dazwischen.

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
- Funktioniert auch für GPX-Uploads und Streckenplaner-Routen (siehe [GPX-Ergebnisse](#gpx-analyse-gpx)) — dort werden zusätzlich die auf der Karte aktiven POIs mitgespeichert

---

#### Modus 2: Ziel finden (`/destination/results/:jobId`)

Wenn noch kein Reiseziel feststeht, findet dieser Modus automatisch die besten Zielregionen und plant wetter-optimierte Routen dorthin. Der Nutzer gibt nur an:

- **Startstadt** und **Startdatum**
- **Reisetage** und **maximale km/Tag** (bestimmen den erreichbaren Radius)
- Wettereinstellungen (Wunschtemperaturen, Gewichtungen)

Der Algorithmus läuft in zwei Phasen:

**Phase 1 — Zielstädte ermitteln**

```
Luftdistanz-Radius = Reisetage × km/Tag ÷ 0,7
    │
    ▼
Alle Städte im Radius auswerten
(historische Klimanormale für den Ankunftstag)
    │
    ▼
Score = Temperaturabweichung² + Wind- und Regengewichtung
    │
    ▼
Top 10 Zielstädte mit Mindestabstand (Radius ÷ 5) zueinander
(greedy Auswahl: beste Stadt → nächstbeste außerhalb der Sperrzone → ...)
```

**Phase 2 — Beam-Search Routensuche**

```
Start: 20 parallele Routen ab der Startstadt
    │
    ▼  (pro Tag)
Kandidaten = direkte Nachbarstädte (1-Hop)
           + Nachbarn der Nachbarn (2-Hop, zählt als 2 Tage)
    │
    ▼
Score pro Kandidat (3 Komponenten):
  1. Wetter-Score
     temp_weight × |T − Twunsch|² + wind_weight × (wspd/2)² + rain_weight × (prcp/2)²

  2. Zielrichtungs-Penalty (quadratisch)
     Wenn Distanz zur nächsten Zielstadt > 0,7 × verbleibende Luftdistanz:
     Penalty = (Distanz / (0,7 × Restdistanz) − 1)²

  3. Richtungskontinuität-Penalty (quadratisch)
     Abweichung vom mittleren Bearing der letzten 3 Städte:
     Penalty = (Winkelabweichung / 180°)²

  Bei 2-Hop: bessere Richtung (via Zwischenstadt oder direkt zum Ziel) zählt
    │
    ▼
Beam-Pruning: 20 → 5 Beams (graduell, ~1 Beam alle 3 Schritte)
Deduplizierung: kein doppeltes Endstadtpaar
    │
    ▼
5 beste Routen → OSRM-Straßenrouting + Wetterdaten
```

> Die Zielstädte sind nur eine **Orientierung** — die Route muss keinen Zielort exakt treffen.

---

### Fortschrittsanzeige (`/progress/:jobId`)

Da die Routenberechnung mehrere Minuten dauern kann, läuft sie asynchron im Hintergrund. Die Fortschrittsseite zeigt in Echtzeit:

- Aktuellen Berechnungsschritt mit Beschreibung
- Fortschrittsbalken für OSRM-Straßenrouting (Segmente)
- Fortschrittsbalken für Höhendatenabruf (Batches)
- Fortschrittsbalken für Wetterprognose
- Vorschaukarte mit dem ungefähren Routenverlauf (sobald verfügbar)

Für **Zielsuche-Jobs** werden statt der üblichen Schritte angezeigt: „Zielstädte suchen" → „Beam-Search" → „Straßenrouting".

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

**Wettermodell-Umschalter**
- Neben der Tab-Leiste platziert — bleibt beim Wechsel zwischen den Ansichten erhalten
- Auswahl zwischen `best_match`, `ECMWF` (`ecmwf_ifs025`), `ICON` (`icon_seamless`) und `GFS` (`gfs_seamless`)
- Einmal geladene Modelldaten werden gecacht — kein erneuter Abruf beim Zurückwechseln
- Hover über das aktive Modell-Badge hebt die Vorhersage-Zone auf der Karte gelb hervor
- Ein blauer Balken zeigt welcher Streckenanteil Vorhersagedaten hat (skaliert auf Gesamtroute)
- Wettergitter: Spalte `+0d` zeigt Live-Vorhersagedaten des gewählten Modells (☁-Indikator im Spaltenkopf), alle anderen Spalten zeigen weiterhin historische Klimanormale

**Route speichern**
- Aktuelle Route mit Name versehen und für spätere Nutzung speichern

---

### GPX-Analyse (`/gpx`)

Für bereits geplante Routen (z. B. aus Wanderungs- oder Radfahrplanern):

- GPX-Datei hochladen
- Startdatum und maximale Tageskilometer eingeben
- Vorschau des Höhenprofils vor der Berechnung

**GPX-Ergebnisse (`/gpx/results/:jobId`)**

Diese Seite zeigt sowohl hochgeladene GPX-Dateien als auch die vom Streckenplaner analysierten Routen (beide laufen durch dieselbe Wetter-Pipeline).

- Karte mit dem hochgeladenen GPX-Pfad
- Temperaturverlauf entlang der Route
- Höhenprofil
- Wettertabelle nach Etappen
- Wettermodell-Umschalter (`best_match`, `ECMWF`, `ICON`, `GFS`) — neben der Tab-Leiste, aktualisiert alle vier Ansichten; gecacht wie in der Routenplaner-Ansicht
- **„Speichern"**: legt Route + aktuell auf der Karte aktive POIs (siehe [POI-Overlays](#streckenplaner-route-planner)) unter „Gespeicherte Routen" ab. Beim Wiederöffnen erscheinen Track und POIs sofort, ohne erneute Overpass-Abfrage; weitere Kategorien lassen sich danach wie gewohnt zuschalten
- **„GPX herunterladen"**: exportiert Track + aktive POIs als `.gpx`-Datei (POIs als `<wpt>`-Wegpunkte mit Name/Kategorie)
- **Regenradar-Overlay (Prototyp)** — Panel oben links auf der Karte:
  - Ein/Aus-Schalter, Zeit-Slider mit Play/Pause-Animation über die letzten 2h (10-Min-Schritte) und Deckkraft-Regler
  - Folgt automatisch dem neuesten Radar-Frame ("Live"), springt per Klick zurück, sobald man manuell in die Vergangenheit scrubbt
  - Standort-Button in den Kartensteuerelementen (unten rechts) zeigt die aktuelle Position als pulsierenden Marker — praktisch zur Prüfung, ob es gerade über einem selbst regnet
  - Datenquelle: [RainViewer](https://www.rainviewer.com/api.html), **nur privat/nicht-kommerziell nutzbar**, max. Zoomstufe 7, keine Vorhersage (nur Vergangenheitsdaten)

### Streckenplaner (`/route-planner`)

Interaktive Punkt-für-Punkt-Routenplanung mit BRouter — die Karte füllt das gesamte Browserfenster, alle Einstellungen liegen als schwebende Panels darüber:

**Karte (füllt das Fenster)**
- Start-/Via-/Zielpunkte per Klick setzen, per Drag & Drop verschieben, per Klick auf einen Punkt entfernen
- Sobald bereits eine Strecke existiert (≥ 2 Punkte), öffnet ein Kartenklick ein Popup mit der Wahl **„Ans Ende anhängen"** oder **„In Strecke einfügen"** — beim Einfügen wird der Punkt automatisch in das nächstgelegene Segment der gerouteten Strecke eingesetzt (Projektion auf die Vorschaulinie; ohne Vorschau dient die Luftlinie zwischen den Wegpunkten als Fallback)
- Live-Routenvorschau (BRouter) mit Distanz/Höhenmetern, debounced bei jeder Änderung

**Kartenebenen (Layer-Menü oben rechts)**
- **Basiskarte**: Standard (Carto hell/dunkel, folgt dem App-Theme), Topographisch (OpenTopoMap mit Höhenlinien), Fahrrad (CyclOSM — Radinfrastruktur & Radfernwege wie EuroVelo oder Berlin–Kopenhagen), Straßen (offizielle OSM-Standardkarte mit farblich abgestufter Straßenhierarchie von Bundesstraße bis Feldweg) oder ÖPNV (ÖPNVKarte/memomaps mit Bus-/Bahnlinien und Haltestellen) — diese Optionen schließen sich gegenseitig aus (Kartenwechsel statt Überlagerung)
- **Karten überlagern**: Topographisch (OpenTopoMap) und Fahrrad (CyclOSM) lassen sich zusätzlich als halbtransparente Ebene *über* der aktiven Basiskarte einblenden (je eigener Ein/Aus-Schalter + Deckkraft-Regler), beliebig kombinierbar miteinander und mit jeder Basiskarte — z. B. Radinfrastruktur über der Standardkarte oder Höhenlinien über der ÖPNV-Karte
- **POI-Overlays** entlang eines Korridors um die geroutete Strecke (OpenStreetMap via Overpass), einzeln zuschaltbar mit eigener Punktfarbe:
  - Schutzhütten, Picknickplätze, Trinkwasser, Toiletten, Duschen, Raststellplätze (Wohnmobilstellplätze + Autobahnraststätten/Rastplätze)
  - Tankstellen, Supermärkte (inkl. Convenience-Läden), Restaurants & Imbisse, Bäckereien, Cafés, Radcafés (fahrradfreundliche Cafés mit Reparatur-/Pumpservice)
  - Campingplätze, Unterkünfte (Gästehäuser, Motels, Ferienwohnungen, Chalets, Alpen-/Schutzhütten), Hostels, Hotels
  - Geldautomaten, Apotheken, Fahrradreparatur (Läden + Reparaturstationen), Schlauchautomaten, Bahnhöfe
  - Baumärkte, Decathlon, Campingausrüster, Angelshops, Radmarkenshops (z. B. Rapha)
  - Parks, Strände, Sehenswürdigkeiten (inkl. Aussichtspunkte), Pässe, Friedhöfe
  - Beim **Hovern** über einen POI erscheint ein Tooltip mit Name, Kategorie und weiteren OSM-Details (z. B. überdacht, Gebühr, Öffnungszeiten, Küche, Rollstuhlgerecht, Höhe bei Pässen) sowie einem Link **„In Google Maps öffnen"** (öffnet die Koordinaten in neuem Tab, kein API-Key nötig); auf Touch-Geräten öffnet ein Tipp auf den Punkt dasselbe Popup
- **Wald-Overlay**: halbtransparente Waldflächen aus dem Korridor um die Route (Grundlage der Windschutz-Analyse)
- **Regenradar** (Panel unter dem Ebenen-Menü, oben rechts): dasselbe RainViewer-Overlay wie in den [GPX-Ergebnissen](#gpx-analyse-gpx) — Ein/Aus-Schalter, Zeit-Slider mit Play/Pause über die letzten 2h, Deckkraft-Regler, „Live"-Modus; rein client-seitig, nur privat/nicht-kommerziell nutzbar
- **Windexposition**: färbt die Route segmentweise nach effektivem Wind — kombiniert die Windvorhersage (Geschwindigkeit + Richtung relativ zur Fahrtrichtung: Gegenwind zählt voll, Rückenwind kaum) mit der Landbedeckung (Wald/Bebauung dämpfen den Wind); Legende grün/gelb/rot (geschützt / mäßig / stark exponiert). Benötigt geladene Wetterdaten
- Alle Overlays setzen eine berechnete Route voraus. POI-Kategorien werden einzeln geladen — jede neu aktivierte, noch nicht geladene Kategorie löst ihre eigene Overpass-Anfrage aus (nicht gebündelt); bereits geladene Kategorien werden pro Streckensignatur gecacht, damit ein Toggle nicht erneut abfragt. Siehe [Overpass-Zuverlässigkeit](#overpass-zuverlässigkeit-streckenplaner-overlays) für Details zu Mirror-Racing und Query-Caching

**Einstellungs-Panel (oben links, einklappbar)**
- **Adresssuche**: Suchfeld mit Autovervollständigung für Adressen und Orte (inkl. Hausnummern, Photon-Geocoder). Bei Auswahl fliegt die Karte zum Treffer; der Ort wird als Wegpunkt angehängt bzw. bei bestehender Strecke erscheint dieselbe Anhängen/Einfügen-Wahl wie beim Kartenklick
- Profilwahl (Trekking/Rennrad/MTB/Safety)
- Startdatum sowie Tagesplanung (Startzeit, Geschwindigkeit, km/Tag) — wahlweise einheitlich für alle Tage oder individuell pro Etappe, bereits beim Zeichnen der Route einstellbar
- „Route analysieren" schickt die fertige Strecke durch dieselbe Wetter-Pipeline wie die GPX-Analyse und landet auf der GPX-Ergebnisseite

**Höhenprofil & Wetter (unten links)**
- Sobald Route und Einstellungen einen gültigen Stand erreichen, wird automatisch (debounced, ohne Klick) eine Wettervorschau berechnet — derselbe Job wie bei der finalen Analyse, nur ohne Weiterleitung
- Zeigt dieselbe farbcodierte Höhenprofil-Ansicht wie die GPX-Ergebnisse (Temperaturverlauf, Etappenmarkierungen); bleibt bei einer neuen Berechnung sichtbar und wird erst bei Erfolg ersetzt, mit Hinweis „veraltet" bei zwischenzeitlichen Änderungen
- Manueller „Aktualisieren"-Button für Wiederholungsversuche
- Klickt man danach auf „Route analysieren" ohne die Route zu ändern, wird der bereits berechnete Job wiederverwendet statt neu zu rechnen

**Wetterpunkte auf der Karte**
- Sobald eine Wettervorschau vorliegt, erscheinen dieselben Wetter-Marker wie in der GPX-Kartenansicht direkt auf der Route (Temperatur, Sonne/Wolken/Regen-Symbol, Windpfeile, Niederschlagsmenge, Klick für Details)

Siehe [Lokale BRouter-Instanz](#starten) für den optionalen Eigenbetrieb der Routing-Engine.

---

## Berechnungsablauf

### Modus: Route planen

```
Städteeingabe
    │
    ▼
Graphsuche + Temperaturbewertung
(NetworkX, Klimanormale 1991–2020)
    │
    ▼
Straßenrouting via OSRM/Valhalla/BRouter
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

### Modus: Ziel finden

```
Startstadt + Startdatum + Reisetage + km/Tag
    │
    ▼
Phase 1: Zielstädte ermitteln
  Luftdistanzradius = Reisetage × km/Tag ÷ 0,7
  → Alle Städte im Radius nach Wetter am Ankunftstag bewerten
  → Top 10 mit Mindestabstand zueinander auswählen
    │
    ▼
Phase 2: Beam-Search (20 → 5 parallele Routen)
  Pro Tag, pro Beam:
    1-Hop und 2-Hop Nachbarn bewerten:
    Score = Wetter-Score
          + Zielrichtungs-Penalty (quadratisch bei Abweichung)
          + Richtungskontinuität-Penalty (letzten 3 Städte)
  Beste Route nach gradueller Beam-Reduzierung
    │
    ▼
Top 5 Routen → OSRM-Straßenrouting
    │
    ▼
Ergebnis: Zielstädte-Übersicht + 5 vergleichbare Routen
```

---

## Algorithmen im Detail

### Gemeinsame Grundlagen

#### Wetter-Interpolation (`get_interpolated_weather`)

Wetterdaten liegen als **Monatsmittelwerte** vor (Klimanormale 1991–2020). Für einen konkreten Tag `d` wird zwischen den Mittelpunkten des aktuellen und des Nachbarmonats **linear interpoliert**:

```
weight = Abstand von d zum Mittelpunkt des Nachbarmonats
         ─────────────────────────────────────────────────
         Abstand zwischen den beiden Monatsmittelpunkten

interpolierter Wert = aktueller_Monat × weight + Nachbarmonat × (1 − weight)
```

Wind wird **vektoriell** interpoliert (Richtung via sin/cos, dann zurück in Grad), nicht arithmetisch.

Rückgabeformat: `[T_nacht, T_tag, prcp_mm_d, wspd_km_h, wdir_deg, wspd_resultant]`

Der `warming_factor` wird nach der Interpolation auf T_nacht und T_tag addiert.

#### Normierte Wetter-Score-Berechnung

Alle drei Algorithmen verwenden dieselbe normierte Formel:

```
temp_score = (|T_nacht − T_nacht_wunsch|² + |T_tag − T_tag_wunsch|²) / 2
             (nur wenn desired_low_temp / desired_high_temp gesetzt)

w_score = temp_weight  × (temp_score          / TEMP_SCORE_REF)
        + wind_weight  × ((wspd / WIND_SCALE)² / WIND_SCORE_REF)
        + rain_weight  × ((prcp / RAIN_SCALE)² / RAIN_SCORE_REF)
```

**Normierungskonstanten** (Werte oberhalb = Ausreißer, Score > 1,0; kein Capping):

| Konstante | Wert | Bedeutung |
|---|---|---|
| `TEMP_SCORE_REF` | 100,0 | 10 °C Abweichung ergibt Score = 1,0 |
| `WIND_SCALE` | 2,0 km/h | 2 km/h Gegenwind ≈ 1 °C Äquivalent |
| `WIND_SCORE_REF` | 56,25 | 15 km/h Gegenwind ergibt Score = 1,0 |
| `RAIN_SCALE` | 2,0 mm/d | 2 mm/d Regen ≈ 1 °C Äquivalent |
| `RAIN_SCORE_REF` | 100,0 | 20 mm/d Regen ergibt Score = 1,0 |

Niedrigerer Score = besseres Wetter. Wenn Temperaturgrenzwerte (`min/max_low/high_temp`) verletzt werden, gibt die Funktion `float('inf')` zurück → Stadt wird ausgeschlossen.

---

### Phase 1 — Zielstädte ermitteln (`find_destination_cities`)

**Parameter**

| Parameter | Standardwert | Bedeutung |
|---|---|---|
| `start_city` | — | Startstadt (Graph-ID) |
| `start_day` | — | Starttag (1–365) |
| `max_days` | — | Maximale Reisetage |
| `daily_km` | — | km pro Tag |
| `desired_low_temp` | `None` | Wunsch-Nachttemperatur (°C) |
| `desired_high_temp` | `None` | Wunsch-Tagtemperatur (°C) |
| `min/max_low/high_temp` | `±∞` | Harte Temperaturgrenzwerte |
| `temp_weight` | 1,0 | Gewicht Temperatur |
| `wind_weight` | 0,0 | Gewicht Wind |
| `rain_weight` | 0,0 | Gewicht Regen |
| `count` | 10 | Anzahl zurückgegebener Zielstädte |

**Schritt 1 — Radius und Ankunftstag bestimmen**

```
max_air_distance = max_days × daily_km × 0,7
  (Faktor 0,7: Straßenstrecke ≈ 40% länger als Luftlinie)

min_spacing  = max_air_distance / 5
  (Minimalabstand zwischen Zielstädten)

target_day = ((start_day + max_days − 1) % 365) + 1
  (Kalender-Tag des geschätzten Ankunftstages)
```

**Schritt 2 — Alle Städte im Radius bewerten**

```
Für jede Stadt C im Graphen (außer start_city):
  dist = Haversine(start_pos, C_pos)           [km]
  wenn dist > max_air_distance → überspringen

  Wetter interpolieren für target_day
  Temperaturgrenzwerte prüfen → bei Verletzung überspringen

  score(C) = w_score(C, target_day)  [normierte Formel, s.o.]
             (hier noch ohne Normierung durch TEMP_SCORE_REF / WIND_SCORE_REF / RAIN_SCORE_REF,
              da diese Funktion die ältere Score-Variante verwendet)
```

**Schritt 3 — Greedy-Auswahl mit Mindestabstand**

```
Kandidaten sortieren nach score (aufsteigend = besser)
selected = []

Für jeden Kandidaten C (bester zuerst):
  wenn Abstand(C, jede bereits gewählte Stadt) ≥ min_spacing:
    selected.append(C)
  wenn len(selected) == count:
    break

Rückgabe: [(city_id, score, luftdistanz), ...]
```

---

### Phase 2a — Beam Search (`beam_search_route`)

**Parameter**

| Parameter | Standardwert | Bedeutung |
|---|---|---|
| `initial_beam_width` | 20 | Parallele Routen zu Beginn |
| `final_beam_width` | 5 | Parallele Routen am Ende |
| `direction_weight` | 0,3 | Gewicht der Zielrichtungs-Penalty |
| `continuity_weight` | 2,0 | Gewicht der Richtungskontinuität-Penalty |
| `max_days` | — | Max. Reisetage (Abbruchbedingung und Schleifenlimit) |
| `daily_km` | — | km/Tag (für Tagesberechnung aus Kantenlängen) |

**Datenstruktur eines Beams**

```python
{
  'cities':      [city_id, ...],   # besuchte Städte (chronologisch)
  'days':        [float, ...],     # Ankunftstag je Stadt (fraktional, z.B. 3.5)
  'scores':      [float, ...],     # Kandidaten-Score je Stadt
  'total_score': float             # Durchschnitt aller scores
}
```

**Initialisierung**

```
20 identische Beams, alle starten in start_city am start_day:
  beam = { cities: [start_city], days: [start_day], scores: [], total_score: 0.0 }
```

**Hauptschleife: bis zu max_days Iterationen**

Pro Iteration `step` (0 bis max_days−1):

```
1. Beam-Breite für diesen Schritt berechnen:
   progress           = step / max(1, max_days − 1)
   current_beam_width = max(final_beam_width,
                            int(initial_beam_width
                                − progress × (initial_beam_width − final_beam_width)))

2. Für jeden aktiven Beam:

   a. Aktuellen Stand lesen:
      current_city = beam['cities'][-1]
      current_day  = beam['days'][-1]    ← echter fraktionaler Tag (km-basiert)

   b. Abbruchprüfung für diesen Beam:
      wenn (current_day − start_day) ≥ max_days:
        Beam unverändert in all_expansions aufnehmen → nächster Beam

   c. Besuchssperre: visited = die letzten 5 Städte im Beam

   d. Kandidaten generieren und bewerten:

      1-Hop: Für jeden direkten Nachbarn N von current_city
             (nicht in visited):
             score = score_candidate(N, current_day, beam)

      2-Hop: Für jeden Nachbarn N1 von current_city
             (nicht in visited),
             für jeden Nachbarn N2 von N1
             (nicht in visited, ≠ current_city):
             score = score_candidate(N2, current_day, beam,
                                     is_2hop=True, via_id=N1)

   e. Kandidaten sortieren (aufsteigend nach score)
      → beste 3 für diesen Beam weiterverfolgen

   f. Für jeden der 3 besten Kandidaten neuen Beam bauen:

      1-Hop (current_city → cand_city):
        dist     = edge_weight(current_city, cand_city)   [km]
        day_cand = current_day + dist / daily_km
        Beam erweitern: cities += [cand_city],
                        days   += [day_cand],
                        scores += [score]

      2-Hop (current_city → via_city → cand_city):
        dist_1   = edge_weight(current_city, via_city)    [km]
        dist_2   = edge_weight(via_city, cand_city)       [km]
        day_via  = current_day + dist_1 / daily_km
        day_cand = current_day + (dist_1 + dist_2) / daily_km

        via_score = score_candidate(via_city, current_day, beam)
                    [1-Hop Score für die Zwischenstadt]

        Beam erweitern: cities += [via_city, cand_city],
                        days   += [day_via,  day_cand],
                        scores += [via_score, score]

   g. total_score neu berechnen:
      total_score = sum(scores) / len(scores)   [Durchschnitt aller Stadtscores]

3. Alle Expansionen sortieren (aufsteigend nach total_score)

4. Deduplizierung: pro Endstadt (cities[-1]) nur den besten Beam behalten

5. Die besten current_beam_width Beams behalten → nächste Iteration

6. Schleife bricht auch ab wenn keine Expansionen erzeugt wurden
```

**Score eines Kandidaten (`score_candidate`)**

```
score = w_score + direction_weight × dir_penalty + continuity_weight × cont_penalty
```

*Wetter-Score `w_score`*

1-Hop (current_city → candidate), Ankunftstag `t = current_day + dist/daily_km`:
```
w_score = w_score_normiert(candidate, t)
        = temp_weight  × (temp_score(candidate, t) / TEMP_SCORE_REF)
        + wind_weight  × ((wspd(candidate, t) / 2,0)² / 56,25)
        + rain_weight  × ((prcp(candidate, t) / 2,0)² / 100,0)
```

2-Hop (current_city → via → candidate), distanzgewichtet:
```
w1 = dist_1 / (dist_1 + dist_2)              [Anteil 1. Segment]
w2 = dist_2 / (dist_1 + dist_2)              [Anteil 2. Segment]
t_via  = current_day + dist_1 / daily_km
t_cand = current_day + (dist_1 + dist_2) / daily_km

w_score = w1 × w_score_normiert(via, t_via)
        + w2 × w_score_normiert(candidate, t_cand)
```

Beispiel: A→B (200 km) + B→C (400 km) → w1=1/3, w2=2/3

*Zielrichtungs-Penalty `dir_penalty`*

Bewertet ob der Kandidat noch erreichbar weit von einer Zielstadt entfernt liegt:
```
arrival_day   = tatsächlicher Ankunftstag beim Kandidaten
remaining_days = max_days − (arrival_day − start_day)
remaining_air  = remaining_days × daily_km × 0,7   [erreichbare Luftdistanz]
min_dest_dist  = kleinste Haversine-Distanz zu einer der Zielstädte

wenn min_dest_dist > remaining_air  UND  remaining_air > 0:
    dir_penalty = (min_dest_dist / remaining_air)²
    [quadratisch — je weiter weg, desto stärker bestraft]
sonst:
    dir_penalty = 0
```

*Richtungskontinuität-Penalty `cont_penalty`*

Bestraft Richtungswechsel gegenüber der bisherigen Fahrtrichtung:
```
Positionen der letzten 3 besuchten Städte: p1, p2, p3

Bearings berechnen:
  b1 = Bearing(p1 → p2)
  b2 = Bearing(p2 → p3)

Gewichteter Kreismittelwert (vermeidet 0°/360°-Sprung):
  sin_avg = sin(b2) × 0,7 + sin(b1) × 0,3
  cos_avg = cos(b2) × 0,7 + cos(b1) × 0,3
  avg_bearing = atan2(sin_avg, cos_avg) [in Grad]

bearing_to_candidate = Bearing(p3 → candidate_pos)
deviation = |avg_bearing − bearing_to_candidate|  (0°–180°)

cont_penalty = (deviation / 180°)^1,5
  [0° Abweichung → 0; 180° Kehrtwendung → 1]
```

Bei 2-Hop:
```
cont_penalty = min(penalty_direkt_zu_candidate,
                   penalty_über_via_zu_candidate)
```

Bei < 3 bekannten Städten: keine Penalty (0).

**Rückgabe**

```
Nach der letzten Iteration:
  Beams sortieren nach total_score
  Rückgabe der besten final_beam_width Beams als:
  [{ 'cities': [(city_id, day), ...], 'score': total_score }, ...]
```

---

### Phase 2b — Hierarchische Wegpunktsuche (`hierarchical_waypoint_route`)

**Parameter**

| Parameter | Standardwert | Bedeutung |
|---|---|---|
| `min_segment_days` | 10 | Segmente mit weniger Tagen werden nicht weiter unterteilt |
| `top_k` | 10 | Beste Kombinationen die pro Iteration behalten werden |

**Datenstruktur einer Kombination**

```python
[(city_id, day), (city_id, day), ...]
# geordnete Liste von Wegpunkten mit zugewiesenem Reisetag
# day ist fraktional (z.B. 12.7 = Tag 12 + 0,7 Tage)
```

**Schritt 1 — Initialisierung**

```
Für jede Zielstadt D (aus Phase 1):
  end_day = start_day + max_days
    [entspricht dem target_day aus Phase 1 — volle Reisedauer]

  Kombination = [(start_city, start_day), (D, end_day)]
```

**Schritt 2 — Iterative Verfeinerung**

```
Solange mindestens ein Segment (to_day − from_day) ≥ min_segment_days:

  Für jede Kombination:
    Für jedes Segment (A, from_day) → (B, to_day):

      wenn (to_day − from_day) < min_segment_days:
        keine Unterteilung → Segment bleibt unverändert

      sonst:
        [_find_waypoint_cities aufrufen:]

        segment_days  = (to_day − from_day) / 2,0       [verfügbare Fahrtage pro Hälfte]
        travelable    = segment_days × daily_km          [erreichbare Luftdistanz in km]

        Alle Graphstädte C prüfen:
          dist_from = Haversine(A, C)
          dist_to   = Haversine(B, C)
          Bedingung: 0,5 × travelable ≤ dist_from ≤ 0,7 × travelable
                 und 0,5 × travelable ≤ dist_to   ≤ 0,7 × travelable
            [C muss in 50–70 % der fahrbaren Tagesdistanz von A und von B liegen]

          Ankunftstag berechnen:
            dist_ratio = dist_from / (dist_from + dist_to)
            mid_day_C  = from_day + dist_ratio × (to_day − from_day)
            target_day = ((int(mid_day_C) − 1) % 365) + 1

          Wetter interpolieren für target_day
          Grenzwerte prüfen → bei Verletzung überspringen
          score = w_score_normiert(C, target_day)

        Kandidaten sortieren nach score
        Geografische Auswahl (Mindestabstand = segment_dist / 5):
          greedy: besten Kandidaten wählen, nächsten nur wenn
          Abstand zu allen bereits gewählten ≥ min_spacing
          → maximal 2 Kandidaten pro Segment

    Kartesisches Produkt aller Segment-Optionen:
      Segment 1: [opt_A, opt_B]  (2 Kandidaten)
      Segment 2: [opt_C]         (1 Kandidat)
      → Kombinationen: [opt_A+opt_C, opt_B+opt_C]

  Deduplizierung (nach Stadtsequenz)
  Alle Kombinationen mit _score_waypoint_combo bewerten
  Beste top_k behalten
```

**Score einer Kombination (`_score_waypoint_combo`)**

Summiert die normierten Wetter-Scores aller Wegpunkte (ohne Startstadt):
```
combo_score = Σ w_score_normiert(city_i, day_i)
              für alle (city_i, day_i) in combo[1:]

  target_day_i = ((int(day_i) − 1) % 365) + 1
  w_score_normiert(city, day) wie oben (temp + wind + rain normiert)
```

**Schritt 3 — Pfadbau mit Hybrid A* (`optimized_travel_planner`)**

```
Für jede der top_k Kombinationen:
  full_path = []
  current_day = start_day

  Für jedes Segment (A, from_day) → (B, to_day):
    expected_days = max(1.0, to_day − from_day)
    Pfad A→B via optimized_travel_planner(
      graph, A, B, current_day, temperatures,
      daily_km, expected_days, ..., distance_weight=0.85
    )
    full_path += Graphpfad (Zwischenstädte eingeschlossen)
    current_day += expected_days
```

**Schritt 4 — Tagesberechnung in der Endroute**

```
day = start_day
Für jede Kante (city_j → city_{j+1}) im fertigen full_path:
  day_{j+1} = day_j + edge_weight(city_j, city_{j+1}) / daily_km
    [Kantenlänge in km ÷ km/Tag = Tage für diese Etappe]
```

**Finaler Score und Rückgabe**

```
route_score = _score_waypoint_combo(route_cities) / (len(route_cities) − 1)
            = normierter Durchschnitts-Wetterscore pro Stadt (ohne Start)

Routen sortieren nach route_score (aufsteigend = besser)
Rückgabe: beste 5 Routen als [{ 'cities': [(city_id, day), ...], 'score': float }]
```

---

## Externe APIs (kostenlos, kein API-Key erforderlich)

| API | Verwendung |
|---|---|
| [OSRM](https://router.project-osrm.org) | Straßenentfernungen und Routengeometrien |
| [Open-Elevation](https://api.open-elevation.com) | SRTM-Höhendaten (56°S–60°N) |
| [OpenTopoData](https://api.opentopodata.org) | ASTER-Höhendaten (Polarregionen bis 83°N) |
| [Nominatim](https://nominatim.openstreetmap.org) | Geocoding für Städte außerhalb des Graphen |
| [Photon](https://photon.komoot.io) | Adress-/Ortssuche im Streckenplaner (Autocomplete inkl. Hausnummern) |
| [Overpass](https://overpass-api.de) | OSM-Abfragen für Streckenplaner-Overlays: POIs (Schutzhütten, Trinkwasser, Tankstellen, Supermärkte, Bahnhöfe, Sehenswürdigkeiten, Pässe u. v. m.) und Wald-/Landbedeckung für die Windexposition |
| [BRouter](https://brouter.de) | Fahrrad-/Trekking-Routing im Streckenplaner (alternativ [lokale Instanz](#starten)) |
| [OpenTopoMap](https://opentopomap.org) | Topographische Basiskarten-Kacheln im Streckenplaner |
| [CyclOSM](https://www.cyclosm.org) | Basiskarten-Kacheln mit Radinfrastruktur & Radfernwegen (EuroVelo u. a.) im Streckenplaner |
| [OpenStreetMap-Standardkarte](https://www.openstreetmap.org) | Basiskarten-Kacheln mit farblich abgestufter Straßenhierarchie im Streckenplaner |
| [memomaps ÖPNVKarte](https://memomaps.de) | Basiskarten-Kacheln mit öffentlichem Verkehr (Linien/Haltestellen) im Streckenplaner |
| [Open-Meteo](https://api.open-meteo.com) | Live-Wettervorhersage (16 Tage) mit wählbarem Modell (`best_match`, ECMWF, ICON, GFS, …) |

### Client-seitiger Fallback für Open-Meteo

Der Server (z. B. auf Render) ruft Open-Meteo standardmäßig selbst auf. Da Render-Webservices ohne
gebuchtes Static-Outbound-IP-Add-on eine gemeinsam genutzte, dynamische Absender-IP verwenden, kann
diese IP gelegentlich von Open-Meteo rate-limitet werden, auch wenn die eigene Nutzung im
Free-Tier-Rahmen liegt. Für diesen Fall gibt es einen automatischen Fallback:

1. Schlägt der serverseitige Open-Meteo-Aufruf nach 4 Retry-Versuchen endgültig fehl
   (`OpenMeteoUnreachableError` in `module.py`), schließt der Job trotzdem normal ab, aber mit
   `forecastError: "CLIENT_FALLBACK_NEEDED"` statt Wetterdaten.
2. Das Frontend erkennt dieses Flag und ruft `api.open-meteo.com` direkt aus dem Browser der
   Nutzerin/des Nutzers auf (siehe `fetchForecastViaBrowser`/`fetchGpxStopsViaBrowser` in
   `frontend/src/api/client.ts`) – also über deren eigene IP statt der des Servers.
3. Die rohe Open-Meteo-Antwort wird an zwei zustandslose Backend-Endpunkte zurückgeschickt, die
   dieselbe Parsing-/Höhenkorrektur-Logik wie der serverseitige Pfad anwenden:
   `POST /api/forecast/parse` (Routenpunkte, Modellwechsel) und
   `POST /api/forecast/parse-gpx-stops` (GPX-Übernachtungsstopps).
4. Das Ergebnis wird nahtlos ins UI eingefügt; sichtbar ist nur ein kurzer Hinweistext
   ("Wetterdienst über den Server nicht erreichbar – Wetterdaten werden über deinen Browser
   geladen…").

Dieser Mechanismus greift für die Hauptrouten-, Zielsuche- und GPX-Jobs sowie für den manuellen
Modellwechsel-Button; für die einmalige Abfrage historischer Klimanormalwerte
(`archive-api.open-meteo.com`, nur beim erstmaligen Hinzufügen neuer Städte) ist er nicht
implementiert, da dieser Pfad selten aufgerufen wird und nicht zeitkritisch ist.

### Overpass-Zuverlässigkeit (Streckenplaner-Overlays)

POI- und Windschutz-Abfragen laufen über den öffentlichen Overpass-Dienst, der bei Überlastung
langsam oder zeitweise unerreichbar sein kann. Um Wartezeiten zu begrenzen:

- **Mirror-Racing**: Der primäre Server (`overpass-api.de`) bekommt 8s Vorsprung; antwortet er nicht
  rechtzeitig, wird parallel ein zweiter Spiegel-Server (`maps.mail.ru`) angefragt ("hedged request")
  — es gewinnt, wer zuerst erfolgreich antwortet, statt beide Server sequenziell mit vollem Timeout
  (bis zu 45s je Server) durchzuprobieren.
- **Grid-gerasterter Cache**: Routenpunkte werden vor dem Query-Bau auf ein ~110m-Gitter gerundet, so
  dass kleine Routenänderungen oder GPX-Resampling-Jitter dieselbe Overpass-Query erzeugen und den
  30-minütigen In-Memory-Cache (serverseitig, pro Query-Hash) treffen, statt einen neuen
  Server-Roundtrip auszulösen.
- POI- und Windschutz-Anfragen werden serverseitig serialisiert (globaler Lock), damit das
  Per-IP-Rate-Limit des öffentlichen Overpass-Dienstes nicht durch gleichzeitige Anfragen desselben
  Servers verletzt wird — das gilt auch, seit POI-Kategorien einzeln statt gebündelt abgefragt werden.

### Regenradar (RainViewer, rein client-seitig)

Anders als die Wetter-APIs oben läuft das Regenradar-Overlay (GPX-Ergebnisse und Streckenplaner)
**nie über den Server** — sowohl die Frame-Liste (`api.rainviewer.com/public/weather-maps.json`)
als auch die Kachelbilder selbst (`tilecache.rainviewer.com`) werden direkt vom Browser der
Nutzerin/des Nutzers geladen (`RainRadar.tsx`). Das hat zwei Konsequenzen:

- Das Rate-Limit von RainViewer (100 Requests/IP/Minute) gilt pro Besucher, nicht aggregiert über
  alle App-Nutzer.
- Bei RainViewer erscheint die öffentliche IP des jeweiligen Endgeräts, nicht die des Servers.

RainViewers kostenlose API ist laut Nutzungsbedingungen nur für **private/nicht-kommerzielle**
Nutzung freigegeben; seit der API-Umstellung Anfang 2026 gibt es außerdem nur noch
Vergangenheitsdaten (letzte 2h) und eine auf Zoomstufe 7 begrenzte Auflösung.

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
│       │   │   ├── SavedRoutesList.tsx # Gespeicherte Routen
│       │   │   ├── RoutePlannerPage.tsx # Streckenplaner (BRouter, Vollbild-Karte)
│       │   │   ├── MapLayers.tsx       # Layer-Menü + POI-/Wald-/Windexpositions-Overlays
│       │   │   ├── RainRadar.tsx       # Regenradar-Overlay + Panel (RainViewer, geteilt mit GPX)
│       │   │   └── AddressSearch.tsx   # Adress-/Ortssuche (Photon)
│       │   ├── progress/
│       │   │   ├── ProgressPage.tsx    # Fortschrittsanzeige
│       │   │   ├── PreviewMap.tsx      # Vorschaukarte
│       │   │   └── StepIndicator.tsx   # Schrittanzeige
│       │   ├── results/
│       │   │   ├── ResultsPage.tsx              # Ergebnisseite (Route planen)
│       │   │   ├── DestinationResultsPage.tsx   # Ergebnisseite (Ziel finden)
│       │   │   ├── ForecastMap.tsx     # Interaktive Karte
│       │   │   ├── TemperatureChart.tsx # Temperaturdiagramm
│       │   │   ├── ElevationChart.tsx  # Höhenprofil
│       │   │   ├── WeatherGrid.tsx     # Wettertabelle
│       │   │   ├── ModelBadges.tsx     # Wettermodell-Umschalter (best_match / ECMWF / ICON / GFS)
│       │   │   └── RouteList.tsx       # Stadtliste mit Details
│       │   ├── gpx/
│       │   │   ├── GpxPage.tsx         # GPX-Upload
│       │   │   ├── GpxResultsPage.tsx  # GPX-Ergebnisse
│       │   │   ├── GpxRouteMap.tsx     # GPX-Karte
│       │   │   ├── GpxElevationChart.tsx
│       │   │   ├── GpxTemperatureChart.tsx
│       │   │   ├── GpxWeatherTable.tsx
│       │   │   └── GpxModelBadges.tsx  # Wettermodell-Umschalter für GPX
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
| `GET` | `/api/geocode/search` | Adress-/Ortssuche (Photon) für den Streckenplaner |
| `GET` | `/api/countries/search` | Ländersuche |
| `POST` | `/api/jobs` | Routenberechnung starten |
| `GET` | `/api/jobs/{id}/status` | Berechnungsfortschritt abfragen |
| `GET` | `/api/jobs/{id}/results` | Fertige Ergebnisse abrufen |
| `GET` | `/api/jobs/{id}/forecast/{model}` | Vorhersage mit alternativem Wettermodell abrufen (Routenplaner) |
| `GET` | `/api/jobs/{id}/gpx-forecast/{model}` | Vorhersage mit alternativem Wettermodell abrufen (GPX) |
| `POST` | `/api/forecast/parse` | [Client-Fallback](#client-seitiger-fallback-für-open-meteo): vom Browser geholte Open-Meteo-Rohdaten serverseitig parsen (Routenpunkte) |
| `POST` | `/api/forecast/parse-gpx-stops` | [Client-Fallback](#client-seitiger-fallback-für-open-meteo): vom Browser geholte Open-Meteo-Rohdaten serverseitig parsen (GPX-Übernachtungsstopps) |
| `POST` | `/api/destination-jobs` | Zielsuche starten |
| `POST` | `/api/gpx/jobs` | GPX-Analyse starten |
| `POST` | `/api/route-planner/preview` | Streckenplaner: Live-Routenvorschau (BRouter) |
| `POST` | `/api/route-planner/pois` | Streckenplaner: POIs (31 Kategorien: Schutzhütten, Trinkwasser, Duschen, Raststellplätze, Tankstellen, Supermärkte, Apotheken, Unterkünfte/Hostels/Hotels, Bahnhöfe, Pässe, Friedhöfe, Baumärkte, Angelshops, Radmarkenshops, …) im Routenkorridor (Overpass) |
| `POST` | `/api/route-planner/wind-shelter` | Streckenplaner: Waldflächen + Windschutz-Samples für Wald-/Windexpositions-Overlay (Overpass) |
| `POST` | `/api/route-planner/jobs` | Streckenplaner: Route + Wetteranalyse starten |
| `GET` | `/api/saved-routes` | Gespeicherte Routen auflisten |
| `POST` | `/api/saved-routes` | Route speichern (optional inkl. POIs, bei GPX-/Streckenplaner-Routen) |
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

**Lokale BRouter-Instanz (für den Streckenplaner)**

Der Streckenplaner (`/route-planner`) nutzt standardmäßig den öffentlichen `brouter.de`-Endpunkt. Für Entwicklung/Tests lässt sich stattdessen eine eigene BRouter-Instanz mit Kartendaten für Deutschland/Österreich/Schweiz betreiben:

```bash
# 1. BRouter-Quellcode klonen (einmalig)
git clone --depth 1 https://github.com/abrensch/brouter.git brouter-src

# 2. Kartensegmente für DACH herunterladen (einmalig, ~1-2 GB)
scripts/download-brouter-segments.sh      # Linux/macOS
scripts\download-brouter-segments.bat     # Windows

# 3. Instanz starten (baut das Image beim ersten Mal)
docker compose -f docker-compose.brouter.yml up -d --build
# Ältere Docker-Installationen ohne "docker compose"-Plugin (Docker < 20.10):
docker-compose -f docker-compose.brouter.yml up -d --build
```

Läuft danach auf `http://localhost:17777`. Test: `curl "http://localhost:17777/brouter?lonlats=13.4,52.5|13.5,52.5&profile=trekking&format=geojson"`.

Backend per Umgebungsvariable auf die lokale Instanz umstellen:

```bash
BROUTER_URL=http://localhost:17777/brouter uvicorn api_app:app --reload
```

Ohne gesetzte Variable nutzt das Backend weiterhin den öffentlichen `brouter.de`-Endpunkt (Standard in Produktion).
