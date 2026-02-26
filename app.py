# app.py
from flask import Flask, render_template, request, jsonify
import networkx as nx
from module import find_optimal_route, create_route_map, load_data, load_city_ids_by_country, get_interpolated_weather
import folium
import json
import pycountry

app = Flask(__name__)

# Load your data once at startup
def import_data():
    global city_graph, temperatures, city_names
    path = "data/"
    city_graph, temperatures = load_data(path)
    city_names = {}
    for node in city_graph.nodes(data=True):
        city_id = node[0]
        name = node[1].get('name', 'Unknown City')
        city_names[name.lower()] = city_id

import_data()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search')
def search_cities():
    query = request.args.get('term', '').lower()
    matches = [name for name in city_names.keys() if query in name]
    return jsonify(matches[:10])

@app.route('/search_countries')
def search_countries():
    query = request.args.get('term', '').lower()
    countries = [c.name for c in pycountry.countries]
    matches = [c for c in countries if query in c.lower()]
    return jsonify(matches[:10])


def build_route_weather_json(graph, temperatures, route, start_day):
    """
    Berechnet Wetterdaten für jeden Stadt-Stop auf der Route
    für einen Puffer von ±70 Tagen um den Starttag.
    """
    all_start_days = [((start_day + offset - 1 + 365) % 365) + 1
                      for offset in range(-70, 71)]

    result = []
    for city_id, abs_day, city_name, distance in route:
        rel_day = abs_day - route[0][1]

        weather_by_startday = {}
        for sd in all_start_days:
            cal_day = ((sd + rel_day - 1) % 365) + 1
            try:
                w = get_interpolated_weather(city_id, cal_day, temperatures)
                weather_by_startday[str(sd)] = [
                    round(v, 2) if v is not None else None
                    for v in w
                ]
            except Exception:
                weather_by_startday[str(sd)] = [None] * 6

        result.append({
            "city_name":           city_name,
            "rel_day":             rel_day,
            "weather_by_startday": weather_by_startday,
        })

    return json.dumps(result)


@app.route('/calculate', methods=['POST'])
def calculate_route():
    # Get form data
    cities = request.form.getlist('cities')
    start_city = request.form.get('start_city', '')
    connection_starts = request.form.getlist('connection_start')
    connection_stops = request.form.getlist('connection_stop')

    start_day = request.form.get('start_day', '').strip()
    start_day = int(start_day) if start_day else None

    high_temp = float(request.form.get('high_temp', 25))
    low_temp  = float(request.form.get('low_temp', 15))

    high_temp_min = request.form.get('high_temp_min', '').strip()
    high_temp_min = float(high_temp_min) if high_temp_min else float('-inf')

    high_temp_max = request.form.get('high_temp_max', '').strip()
    high_temp_max = float(high_temp_max) if high_temp_max else float('inf')

    low_temp_min = request.form.get('low_temp_min', '').strip()
    low_temp_min = float(low_temp_min) if low_temp_min else float('-inf')

    low_temp_max = request.form.get('low_temp_max', '').strip()
    low_temp_max = float(low_temp_max) if low_temp_max else float('inf')

    daily_km  = float(request.form.get('daily_km', 100))
    max_days  = int(request.form.get('max_days', 30))
    elev_points_per_1000km = int(request.form.get('elev_points_per_1000km', 1000))
    temp_weight = float(request.form.get('temp_weight', 0.5))

    # Routing mode: car / bicycle / car_no_highway
    routing_mode = request.form.get('routing_mode', 'car')
    if routing_mode not in ('car', 'bicycle', 'car_no_highway'):
        routing_mode = 'car'

    # Checkbox: present in form → True, absent → False
    sorted_input = request.form.get('sorted_input') == 'true'

    # Blocked countries
    blocked_countries = request.form.getlist('blocked_countries')
    additional_blocked = request.form.getlist('additional_blocked_countries')
    country_map = {c.name: c.alpha_2 for c in pycountry.countries}
    for name in additional_blocked:
        code = country_map.get(name)
        if code:
            blocked_countries.append(code)

    # Convert city names to IDs + collect rest days per city
    city_rest_days_raw = request.form.getlist('city_rest_days')
    city_ids = []
    city_rest_days = {}
    for i, city in enumerate(cities):
        if city.lower() in city_names:
            city_id = city_names[city.lower()]
            city_ids.append(city_id)
            try:
                rest = int(city_rest_days_raw[i]) if i < len(city_rest_days_raw) else 0
            except (ValueError, TypeError):
                rest = 0
            if rest > 0:
                city_rest_days[city_id] = rest

    # Connections
    connections = []
    for start, stop in zip(connection_starts, connection_stops):
        if start.lower() in city_names and stop.lower() in city_names:
            connections.append((city_names[start.lower()], city_names[stop.lower()]))

    # Start city
    if start_city.lower() in city_names:
        start_city = city_names[start_city.lower()]
    else:
        start_city = None

    print("Connections:", connections)
    print("start city:", start_city)
    print("cities:", city_ids)
    print("sorted_input:", sorted_input)
    print(blocked_countries)

    city_ids_by_country = load_city_ids_by_country('data/city_ids_by_country.json')

    # Run algorithm
    route, start_day = find_optimal_route(
        city_graph,
        blocked_countries,
        city_ids_by_country,
        temperatures,
        target_cities=city_ids,
        start_city=start_city,
        connections=connections,
        start_day=start_day,
        desired_low_temp=low_temp,
        desired_high_temp=high_temp,
        temp_weight=temp_weight,
        auto_threshold_percentile=10,
        exp=2,
        low_temp_range=(low_temp_min, low_temp_max),
        high_temp_range=(high_temp_min, high_temp_max),
        daily_max_km=daily_km,
        max_days=max_days,
        sorted_input=sorted_input,
        city_rest_days=city_rest_days,
    )

    """if route:
        route_map = create_route_map(
            city_graph, temperatures, route, 2, low_temp, high_temp,
            low_temp_min, low_temp_max, high_temp_min, high_temp_max
        )
        overall_distance = sum(distance for _, _, _, distance in route)

        route_weather_json = build_route_weather_json(
            city_graph, temperatures, route, start_day
        )

        return render_template(
            'results.html',
            map_html=route_map._repr_html_(),
            route=route,
            start_day=start_day,
            overall_distance=overall_distance,
            route_weather_json=route_weather_json,
            desired_low_temp=low_temp,
            desired_high_temp=high_temp,
        )"""
    if route:
        
        route_map, elevation_svg, osrm_distances = create_route_map(
            city_graph, temperatures, route, 2,
            low_temp, high_temp,
            low_temp_min, low_temp_max, high_temp_min, high_temp_max,
            connections=connections,
            show_elevation=True,
            routing_mode=routing_mode,
            elev_points_per_1000km=elev_points_per_1000km,
        )

        # Berechne Gesamtdistanz aus OSRM-Werten (exklusive Flüge die 0.0 sind)
        overall_distance = sum(d for d in osrm_distances if d > 0)  # nur Straßen  
         
        # Baue route_with_osrm_distances für Template
        route_with_osrm = [
            (city_id, day, city_name, osrm_distances[i] if i < len(osrm_distances) else 0)
            for i, (city_id, day, city_name, _) in enumerate(route)
        ]
        
        route_weather_json = build_route_weather_json(
            city_graph, temperatures, route, start_day  
        )
            
        return render_template('results.html',
                            map_html=route_map._repr_html_(),
                            elevation_svg=elevation_svg,
                            route_weather_json=route_weather_json,
                            route=route_with_osrm,  # ← jetzt mit OSRM-Distanzen
                            start_day=start_day,
                            overall_distance=overall_distance,
                            desired_low_temp=low_temp,
                            desired_high_temp=high_temp,
                            city_rest_days=city_rest_days)
    else:
        return render_template('error.html', message="No valid route found")


if __name__ == '__main__':
    app.run(debug=True)
