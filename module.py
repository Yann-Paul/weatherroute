# Helper function to convert day-of-year to month
import networkx as nx
import json
import heapq
from datetime import datetime, timedelta
import math
from collections import deque, Counter
import requests
import polyline as polyline_codec
from math import radians, sin, cos, sqrt, atan2, ceil
from datetime import datetime, timedelta
from itertools import permutations, product as itertools_product
import time
import random
from sklearn.cluster import AgglomerativeClustering
import numpy as np

# No API keys needed — both services are free and open
OSRM_BASE      = "https://router.project-osrm.org"
VALHALLA_BASE  = "https://valhalla1.openstreetmap.de"
OPEN_ELEV_SRTM = "https://api.opentopodata.org/v1/srtm30m"        # SRTM: 60°S–60°N
OPEN_ELEV_ASTER= "https://api.opentopodata.org/v1/aster30m"       # ASTER: global to 83°N

# Wind / rain scoring constants
# These relate weather units to temperature-equivalent units so that
# temp_weight, wind_weight and rain_weight produce comparable score magnitudes.
WIND_SCALE = 2.0   # 2 km/h effective headwind  ≈ 1 °C temperature deviation
RAIN_SCALE = 2.0   # 2 mm/day precipitation      ≈ 1 °C temperature deviation

# Normalisation references for beam-search w_score.
# Values above these thresholds are considered "clearly bad" (score > 1).
# Outliers are NOT capped — they may exceed 1.0 freely so they are naturally
# deprioritised, but they do not distort the scale for well-behaved candidates.
TEMP_SCORE_REF = 10.0 ** 2          # 10 °C average deviation from desired
WIND_SCORE_REF = (15.0 / WIND_SCALE) ** 2  # 15 km/h headwind
RAIN_SCORE_REF = (20.0 / RAIN_SCALE) ** 2  # 20 mm/day precipitation

def _elev_api(latlons):
    """Return (url, batch_size, payload_fn) for the appropriate elevation API.
    Uses ASTER (opentopodata) for routes above 59°N or below 56°S; SRTM otherwise.
    Coordinates are rounded to 4 decimal places (~11 m precision), sufficient for elevation."""
    if any(lat > 59.0 or lat < -56.0 for lat, lon in latlons):
        return (OPEN_ELEV_ASTER, 100,
                lambda b: {"locations": "|".join(f"{round(lat,4)},{round(lon,4)}" for lat, lon in b)})
    return (OPEN_ELEV_SRTM, 100,
            lambda b: {"locations": "|".join(f"{round(lat,4)},{round(lon,4)}" for lat, lon in b)})

def day_to_month(day):
    """Convert day-of-year (1-366) to month (1-12)."""
    date = datetime(2024, 1, 1) + timedelta(days=day - 1)
    return date.month

# Load data
def load_data(path):
    # Load and convert graph node IDs to strings
    city_graph = nx.read_gexf(path + "european_cities_graph.gexf")
    city_graph = nx.relabel_nodes(city_graph, {n: str(n) for n in city_graph.nodes()})
    
    # Load and preprocess temperature data
    with open(path + "european_city_climate_normals.json") as f:
        temperatures = json.load(f)
    
    for city_id in temperatures:
        city_data = temperatures[city_id]
        if "0" in city_data:
            city_data["12"] = city_data["0"]
            del city_data["0"]
        temperatures[city_id] = {str(k): v for k, v in city_data.items()}
    
    return city_graph, temperatures

def load_city_ids_by_country(file_path='city_ids_by_country.json'):
    """
    Loads the city IDs by country dictionary from a JSON file.
    
    Args:
        file_path (str): Path to the JSON file containing city IDs by country.
    
    Returns:
        dict: A dictionary mapping country codes to lists of city IDs.
    """
    with open(file_path, 'r') as f:
        city_ids_by_country = json.load(f)
    return city_ids_by_country

def calculate_bearing(lat1, lon1, lat2, lon2):
    """Return initial bearing (0-360°) from point 1 to point 2."""
    lat1, lat2 = radians(lat1), radians(lat2)
    dlon = radians(lon2 - lon1)
    x = sin(dlon) * cos(lat2)
    y = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dlon)
    return (math.degrees(atan2(x, y)) + 360) % 360

def remove_nodes_for_blocked_countries(graph, blocked_countries, city_ids_by_country):
    # Collect all city IDs to block
    cities_to_block = set()
    for country in blocked_countries:
        if country in city_ids_by_country:
            cities_to_block.update(city_ids_by_country[country])
    
    # Remove nodes connected to blocked cities
    for city_id in cities_to_block:
        try:
            graph.remove_node(str(city_id))
        except nx.NetworkXError:
            print(f"City ID {city_id} not found in the graph.")
            pass
    
    return graph


def calculate_bearing(lat1, lon1, lat2, lon2):
    """Calculate compass bearing between two points in degrees"""
    lat1 = math.radians(lat1)
    lon1 = math.radians(lon1)
    lat2 = math.radians(lat2)
    lon2 = math.radians(lon2)
    
    d_lon = lon2 - lon1
    x = math.sin(d_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360

def angle_difference(a, b):
    """Calculate smallest difference between two angles"""
    diff = abs(a - b) % 360
    return diff if diff <= 180 else 360 - diff

def haversine(coord1, coord2):
    """Calculate distance between two coordinates in km"""
    lat1, lon1 = coord1
    lat2, lon2 = coord2
    R = 6371  # Earth radius in km
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (sin(dlat/2)**2 + cos(radians(lat1)) * 
         cos(radians(lat2)) * sin(dlon/2)**2)
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def calc_targets_day_estimates(graph, cities, daily_max_km, distance_weight=1.0):
    targets_day_estimates = {}
    weather_factor = 1 + 0.3 * (1 - distance_weight)  # more slack when weather matters
    for i, from_city in enumerate(cities):
        for j, to_city in enumerate(cities):
            if i < j:
                travel_days = 0
                try:
                    # Get detailed path through graph edges
                    path_segment = nx.shortest_path(graph, from_city, to_city, weight='weight')
                    for k in range(len(path_segment)-1):

                        current = path_segment[k]
                        next_city = path_segment[k+1]

                        # Get edge data and calculate travel days
                        edge_data = graph.get_edge_data(current, next_city)
                        distance = edge_data['weight']
                        # adjust for longer route due to weather optimization
                        distance = distance * weather_factor
                        travel_days += distance / daily_max_km

                    targets_day_estimates[from_city +"_"+ to_city] = targets_day_estimates[to_city +"_"+ from_city] = travel_days
                except:
                    print("Error couldn't calculate travel day estimate for ",graph.nodes[from_city]['name'],graph.nodes[to_city]['name'])
    return targets_day_estimates


def get_month_day(day_of_year):
    """
    Convert day of year to month and day of month.
    Returns (month, day_of_month)
    """
    while day_of_year > 365:
        day_of_year -= 365
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    days_passed = 0
    
    for month, days in enumerate(days_in_month, 1):
        if days_passed + days >= day_of_year:
            day_of_month = day_of_year - days_passed
            return month, day_of_month
        days_passed += days
    
    return 12, 31  # Fallback for day 365/366


def get_interpolated_temperature(city, day_of_year, temperatures, warming_factor=0.0):
    """
    Get temperature interpolated between months based on day of year.
    Returns (low_temp, high_temp) or (None, None) if data missing.
    warming_factor is added to both tmin and tmax.
    """
    month, day = get_month_day(day_of_year)
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    
    # Get middle day of current month
    mid_month_day = days_in_month[month-1] // 2
    
    # Get temperatures for current month
    current_month_temps = temperatures.get(city, {}).get(str(month), [None]*6)[:2]
    if None in current_month_temps:
        return None, None

        
    # Determine which adjacent month to use based on day of month
    if day <= mid_month_day:
        # Use previous month
        prev_month = 12 if month == 1 else month - 1
        adjacent_temps = temperatures.get(city, {}).get(str(prev_month), [None]*6)[:2]
        if None in adjacent_temps:
            return current_month_temps[0] + warming_factor, current_month_temps[1] + warming_factor

        # Calculate interpolation weight (0 at middle of previous month, 1 at middle of current month)
        prev_mid_day = days_in_month[prev_month-1] // 2
        total_days = (days_in_month[prev_month-1] - prev_mid_day) + mid_month_day
        days_from_prev_mid = (days_in_month[prev_month-1] - prev_mid_day) + day
        weight = days_from_prev_mid / total_days
        
    else:
        # Use next month
        next_month = 1 if month == 12 else month + 1
        adjacent_temps = temperatures.get(city, {}).get(str(next_month), [None]*6)[:2]
        if None in adjacent_temps:
            return current_month_temps[0] + warming_factor, current_month_temps[1] + warming_factor

        # Calculate interpolation weight (0 at middle of current month, 1 at middle of next month)
        next_mid_day = days_in_month[next_month-1] // 2
        total_days = (days_in_month[month-1] - mid_month_day) + next_mid_day
        days_from_current_mid = day - mid_month_day
        weight = 1 - (days_from_current_mid / total_days)
    
    # Interpolate temperatures - fixed to use current_month_temps instead of current_temps
    low_temp = current_month_temps[0] * weight + adjacent_temps[0] * (1 - weight) + warming_factor
    high_temp = current_month_temps[1] * weight + adjacent_temps[1] * (1 - weight) + warming_factor

    return low_temp, high_temp

def get_interpolated_weather(city, day_of_year, temperatures, warming_factor=0.0):
    """
    Get temperature interpolated between months based on day of year.
    Returns [tmin, tmax, prcp, wspd, ...]. warming_factor is added to tmin and tmax.
    """
    month, day = get_month_day(day_of_year)
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    interp_output = []

    
    # Get middle day of current month
    mid_month_day = days_in_month[month-1] // 2
    
    # Get temperatures for current month
    current_month_temps = temperatures[city].get(str(month), [None]*6)

        
    # Determine which adjacent month to use based on day of month
    if day <= mid_month_day:
        # Use previous month
        prev_month = 12 if month == 1 else month - 1
        adjacent_temps = temperatures[city].get(str(prev_month), [None]*6)
            
        # Calculate interpolation weight (0 at middle of previous month, 1 at middle of current month)
        prev_mid_day = days_in_month[prev_month-1] // 2
        total_days = (days_in_month[prev_month-1] - prev_mid_day) + mid_month_day
        days_from_prev_mid = (days_in_month[prev_month-1] - prev_mid_day) + day
        weight = days_from_prev_mid / total_days
        
    else:
        # Use next month
        next_month = 1 if month == 12 else month + 1
        adjacent_temps = temperatures[city].get(str(next_month), [None]*6)
            
        # Calculate interpolation weight (0 at middle of current month, 1 at middle of next month)
        next_mid_day = days_in_month[next_month-1] // 2
        total_days = (days_in_month[month-1] - mid_month_day) + next_mid_day
        days_from_current_mid = day - mid_month_day
        weight = 1 - (days_from_current_mid / total_days)
    
    # Interpolate temperatures - fixed to use current_month_temps instead of current_temps
    for index in range(4):
        if current_month_temps[index] is not None:
            if adjacent_temps[index] is not None:
                value = current_month_temps[index] * weight + adjacent_temps[index] * (1 - weight)
                interp_output.append(value)
            else:
                interp_output.append(current_month_temps[index])
        else:
            if adjacent_temps[index] is not None:
                interp_output.append(adjacent_temps[index])
            else:
                interp_output.append(None)
    
    # wdir and wspd_resultant can only be interpolated if both values exist vor both months
    if None in current_month_temps[4:6] or None in adjacent_temps[4:6]:
        for index in range(4,6):
            if current_month_temps[index] is not None:
                interp_output.append(current_month_temps[index])
            else:
                interp_output.append(adjacent_temps[index])
    else:
        # calculate vector-averaged wind
        directions_rad = np.deg2rad([current_month_temps[4] , adjacent_temps[4]])
        x_components = [current_month_temps[5] , adjacent_temps[5]] * np.cos(directions_rad)
        y_components = [current_month_temps[5] , adjacent_temps[5]] * np.sin(directions_rad)
        
        interp_x = x_components[0] * weight + x_components[1] * (1 - weight)
        interp_y = y_components[0] * weight + y_components[1] * (1 - weight)
        
        interp_dir_rad = np.arctan2(interp_y, interp_x)
        interp_output.append(np.rad2deg(interp_dir_rad) % 360)
        interp_output.append(np.sqrt(interp_x**2 + interp_y**2))

    if warming_factor and len(interp_output) >= 2:
        if interp_output[0] is not None: interp_output[0] += warming_factor
        if interp_output[1] is not None: interp_output[1] += warming_factor
    return interp_output

def calculate_temperature_score(temp_data, exp = 2, desired_low_temp=None, desired_high_temp=None, 
                             min_low_temp=float('-inf'), max_low_temp=float('inf'),
                             min_high_temp=float('-inf'), max_high_temp=float('inf')):
    """
    Calculate temperature score for a single location and time.
    Takes interpolated temperatures as input.
    Returns (score, violated_constraints)
    """
    if temp_data[0] is None or temp_data[1] is None:
        return float('inf'), True
        
    low_temp, high_temp = temp_data[0], temp_data[1]
    score = 0
    violated_constraints = False
    num_scores = 0
    
    # Check temperature range constraints if specified
    if not (min_low_temp <= low_temp <= max_low_temp) or not (min_high_temp <= high_temp <= max_high_temp):
        violated_constraints = True
    
    # Calculate temperature preference scores if specified
    if desired_low_temp is not None:
        score += abs(low_temp - desired_low_temp) ** exp
        num_scores += 1
    
    if desired_high_temp is not None:
        score += abs(high_temp - desired_high_temp) ** exp
        num_scores += 1
        
    # Normalize score by number of temperature comparisons made
    if num_scores > 0 and not violated_constraints:
        score = score / num_scores
        
    return score, violated_constraints

def calculate_daily_temperature_scores(from_city, to_city, start_day, travel_days, temperatures, exp = 2,
                                    desired_low_temp=None, desired_high_temp=None,
                                    min_low_temp=float('-inf'), max_low_temp=float('inf'),
                                    min_high_temp=float('-inf'), max_high_temp=float('inf'),
                                    interpol_tt=None, spatial_i_tt=None, warming_factor=0.0,
                                    from_coords=None, to_coords=None,
                                    wind_weight=0.0, rain_weight=0.0):
    """
    Calculate temperature, wind and rain scores for each day of travel between cities.
    Uses both temporal (between months) and spatial (between cities) interpolation.
    Returns (avg_temp_score, avg_wind_score, avg_rain_score, violated_constraints,
             interpol_tt, spatial_i_tt)
    """
    daily_scores = []
    daily_wind_scores = []
    daily_rain_scores = []
    violations = 0

    need_weather = (wind_weight > 0 or rain_weight > 0) and from_coords and to_coords

    # Get interpolated temperatures for both cities for start and end day
    start_time = time.time()
    from_temps = get_interpolated_temperature(from_city, start_day, temperatures, warming_factor)
    to_temps = get_interpolated_temperature(to_city, start_day+travel_days, temperatures, warming_factor)

    if need_weather:
        from_weather = get_interpolated_weather(from_city, start_day, temperatures, warming_factor)
        to_weather = get_interpolated_weather(to_city, start_day+travel_days, temperatures, warming_factor)
        bearing = calculate_bearing(from_coords[0], from_coords[1],
                                    to_coords[0], to_coords[1])

    if interpol_tt is not None:
        interpol_tt += time.time() - start_time

    start_time = time.time()
    for day_offset in range(max(1, ceil(travel_days))):

        if None in from_temps or None in to_temps:
            return float('inf'), 0, 0, True, interpol_tt, spatial_i_tt

        # Spatially interpolate between cities based on progress
        progress = min(1.0, (day_offset + 1) / travel_days)
        current_low = from_temps[0] + (to_temps[0] - from_temps[0]) * progress
        current_high = from_temps[1] + (to_temps[1] - from_temps[1]) * progress

        # Check temperature constraints
        if not (min_low_temp <= current_low <= max_low_temp) or \
           not (min_high_temp <= current_high <= max_high_temp):
            violations += 1
            continue

        # Calculate temperature preference scores
        daily_score = 0
        num_scores = 0

        if desired_low_temp is not None:
            daily_score += abs(current_low - desired_low_temp) ** exp
            num_scores += 1

        if desired_high_temp is not None:
            daily_score += abs(current_high - desired_high_temp) ** exp
            num_scores += 1

        if num_scores > 0:
            daily_scores.append(daily_score / num_scores)

        # --- Wind score ---
        if need_weather and wind_weight > 0:
            # Indices: 4=wdir (vector-averaged), 5=wspd_resultant (vector-averaged magnitude)
            fw_wdir = from_weather[4] if len(from_weather) > 4 else None
            fw_wspd = from_weather[5] if len(from_weather) > 5 else None
            tw_wdir = to_weather[4] if len(to_weather) > 4 else None
            tw_wspd = to_weather[5] if len(to_weather) > 5 else None

            if fw_wspd is not None and fw_wdir is not None and tw_wspd is not None and tw_wdir is not None:
                # Spatially interpolate wind (vector average)
                fw_rad = radians(fw_wdir)
                tw_rad = radians(tw_wdir)
                wx = fw_wspd * cos(fw_rad) * (1 - progress) + tw_wspd * cos(tw_rad) * progress
                wy = fw_wspd * sin(fw_rad) * (1 - progress) + tw_wspd * sin(tw_rad) * progress
                wspd_interp = sqrt(wx**2 + wy**2)
                wdir_interp = math.degrees(atan2(wy, wx)) % 360

                # Direction wind blows TO = wdir + 180
                angle_diff = radians((wdir_interp + 180) - bearing)
                effective_wind = wspd_interp * (cos(angle_diff) - 0.5)  # neutral at 60° from tailwind

                # Score: headwind (negative effective) → positive score (bad)
                wind_equiv = -effective_wind / WIND_SCALE
                wind_day_score = math.copysign(abs(wind_equiv) ** exp, wind_equiv)
                daily_wind_scores.append(wind_day_score)
            # else: skip day (no penalty)

        # --- Rain score ---
        if need_weather and rain_weight > 0:
            fp = from_weather[2] if len(from_weather) > 2 else None
            tp = to_weather[2] if len(to_weather) > 2 else None

            if fp is not None and tp is not None:
                prcp_interp = fp * (1 - progress) + tp * progress
                rain_equiv = prcp_interp / RAIN_SCALE
                daily_rain_scores.append(rain_equiv ** exp)
            # else: skip day (excluded from average)

    if spatial_i_tt is not None:
        spatial_i_tt += time.time() - start_time

    if not daily_scores:
        return float('inf'), 0, 0, violations > 0, interpol_tt, spatial_i_tt

    avg_temp = sum(daily_scores) / len(daily_scores)
    avg_wind = sum(daily_wind_scores) / len(daily_wind_scores) if daily_wind_scores else 0
    avg_rain = sum(daily_rain_scores) / len(daily_rain_scores) if daily_rain_scores else 0

    return avg_temp, avg_wind, avg_rain, violations > 0, interpol_tt, spatial_i_tt

# The rest of the custom_shortest_path_with_averaging function remains the same

def optimized_travel_planner(G, source, target, current_day, temperatures,
                            daily_max_km, expected_travel_days,
                            desired_low_temp, desired_high_temp,
                            min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                            temp_weight=0.5, exp=2, time_penalty_weight=0.3, distance_weight=0.5,
                            heuristic_weight=2,
                            interpol_tt=None, spatial_i_tt=None,
                            warming_factor=0.0):
    """
    Hybrid A* implementation with geographical heuristic guidance and time-aware state pruning.
    Now ensures only the best instance for each city remains in the priority queue.
    """
    node = G.nodes[target]
    target_pos = (node['lat'], node['lon'])

    # State tracking with heuristic-guided priority and best scores per node
    state_map = {node: {} for node in G.nodes()}
    best_node_scores = {node: float('inf') for node in G.nodes()}  # Track best f_score per node
    pq = []
    initial_f_score = 0
    heapq.heappush(pq, (initial_f_score, 0, source, 0, 0))
    state_map[source][(0, 0)] = initial_f_score
    best_node_scores[source] = initial_f_score  # Initialize best score for source
    
    # calc haversine distance for heuristic score
    source_node = G.nodes[source]
    source_pos = (source_node['lat'], source_node['lon'])
    total_dist = haversine(source_pos,target_pos)

    predecessors = {}
    counter = 0

    while pq:
        f_score, g_score, current_node, acc_days, temp_sum = heapq.heappop(pq)

        # Skip if a better path to this node has already been found
        if f_score > best_node_scores[current_node]:
            continue

        if current_node == target:
            break

        for neighbor in G.neighbors(current_node):
            edge_data = G.get_edge_data(current_node, neighbor)
            distance = edge_data['weight']
            edge_days = distance / daily_max_km
            new_acc_days = acc_days + edge_days

            (temp_score, _w, _r, violated, interpol_tt, spatial_i_tt) = \
                calculate_daily_temperature_scores(
                    current_node, neighbor, current_day + acc_days, edge_days,
                    temperatures, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                    interpol_tt, spatial_i_tt, warming_factor
                )

            if violated:
                continue

            new_temp_sum = temp_sum + temp_score * edge_days
            avg_temp = new_temp_sum / new_acc_days if new_acc_days > 0 else 0

            temp_component = (1 - distance_weight) * avg_temp
            time_component = distance_weight * new_acc_days
            new_g_score = time_component + temp_component

            # Heuristic calculation: estimate the remaining days by comparing the remaining dist with total dist and 
            # calc the difference from the estimated remaining days and actual remaining days
            try:
                node = G.nodes[neighbor]
                neighbor_pos = (node['lat'], node['lon'])
                remaining_dist = haversine(neighbor_pos, target_pos)
                remaining_days = expected_travel_days - new_acc_days
                est_remaining_days = remaining_dist/total_dist*expected_travel_days
                h_time_penalty = abs(est_remaining_days - remaining_days)
                h_score = (0.5 * est_remaining_days + h_time_penalty) * heuristic_weight
            except KeyError:
                h_score = 0

            new_f_score = new_g_score + h_score

            current_state = (new_acc_days, new_temp_sum)
            if new_f_score < best_node_scores[neighbor]:
            
            #if new_f_score < state_map[neighbor].get(current_state, float('inf')):
                state_map[neighbor][current_state] = new_f_score

                # Update best_node_scores if this is the new best for the neighbor
                if new_f_score < best_node_scores[neighbor]:
                    best_node_scores[neighbor] = new_f_score

                predecessors[(neighbor, *current_state)] = {
                    'node': current_node,
                    'days': acc_days,
                    'temp_sum': temp_sum
                }

                if len(pq) % 400 == 300:
                    print(f"Queue size: {len(pq)} | Best score: {pq[0][0] if pq else 'None'}")
                heapq.heappush(pq, (new_f_score, new_g_score, neighbor, new_acc_days, new_temp_sum))

    # Path reconstruction remains unchanged
    if not state_map.get(target):
        raise nx.NetworkXNoPath(f"No path between {source} and {target}")

    best_state = min(state_map[target].items(), key=lambda x: x[1])
    (best_days, best_temp_sum), best_score = best_state

    path = []
    current_state = (target, best_days, best_temp_sum)
    while current_state[0] != source:
        path.append(current_state[0])
        current_state = (
            predecessors[current_state]['node'],
            predecessors[current_state]['days'],
            predecessors[current_state]['temp_sum']
        )
    path.append(source)
    path.reverse()

    return path, best_score, interpol_tt, spatial_i_tt

def calculate_path_score(G, route, connections_dict, start_day, temperatures, desired_low_temp, desired_high_temp,
           min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, daily_max_km, max_days, exp=2,
           interpol_tt=None, spatial_i_tt=None, warming_factor=0.0,
           wind_weight=0.0, rain_weight=0.0, city_coords=None, distance_weight=0.5):
    """
    Cluster-compatible score calculation.
    """
    temp_sum = 0
    wind_sum = 0
    rain_sum = 0
    total_days = 0
    violations = 0
    current_day = start_day
    wind_days = 0
    rain_days = 0

    for i in range(len(route) - 1):
        from_city, to_city = route[i], route[i + 1]
        if connections_dict.get(from_city) == to_city:
            distance = 0
            edge_days = 1
        else:
            edge_data = G.get_edge_data(from_city, to_city)
            distance = edge_data['weight']
            edge_days = distance / daily_max_km

        from_c = city_coords.get(from_city) if city_coords else None
        to_c = city_coords.get(to_city) if city_coords else None

        if temp_weight > 0 or wind_weight > 0 or rain_weight > 0 or max_high_temp < float('inf') or max_low_temp < float('inf') or min_high_temp > float('-inf') or min_low_temp > float('-inf'):
            (temp_score, w_score, r_score, violated, interpol_tt, spatial_i_tt) = \
                calculate_daily_temperature_scores(
                    from_city, to_city, current_day + total_days, edge_days,
                    temperatures, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                    interpol_tt, spatial_i_tt, warming_factor,
                    from_coords=from_c, to_coords=to_c,
                    wind_weight=wind_weight, rain_weight=rain_weight
                )

            if violated:
                violations += 1

            temp_sum += temp_score * edge_days
            if w_score != 0:
                wind_sum += w_score * edge_days
                wind_days += edge_days
            if r_score != 0:
                rain_sum += r_score * edge_days
                rain_days += edge_days

        total_days += edge_days

        if total_days > max_days:
            return float('inf'), float('inf'), interpol_tt, spatial_i_tt

    temp_score = temp_sum / total_days if total_days > 0 else 0
    wind_score = wind_sum / wind_days if wind_days > 0 else 0
    rain_score = rain_sum / rain_days if rain_days > 0 else 0
    weather_score = temp_score * temp_weight + wind_score * wind_weight + rain_score * rain_weight
    end_score = 3 * (1 - distance_weight) * weather_score + distance_weight * total_days + 100 * violations
    if math.isnan(end_score):
        print("score is nan")
    return end_score, total_days, interpol_tt, spatial_i_tt

# ---------------------- Modified Route Calculation ----------------------
def calculate_route_score(route, current_day, targets_day_estimates, temperatures, desired_low_temp, desired_high_temp,
           min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp=2,
           interpol_tt=None, spatial_i_tt=None,
           city_to_cluster=None, cluster_info=None, warming_factor=0.0, city_coords=None, distance_weight=0.5):
    """
    Cluster-compatible score calculation.
    """
    total_temp_score = 0
    total_wind_score = 0
    total_rain_score = 0
    total_days = 0
    violations = 0
    prev_cluster = None
    days_track = []


    # Create default cluster mapping if not provided
    local_cluster_map = city_to_cluster or {city: city for city in route}
    local_cluster_info = cluster_info or {}

    for i in range(len(route) - 1):
        from_city, to_city = route[i], route[i + 1]
        try:
            base_days = targets_day_estimates[from_city + "_" + to_city]
        except KeyError:
            #print(f"Error: No travel estimate found for {from_city} -> {to_city}")
            total_temp_score += 1000
            days_track.append(1)
            total_days += 1
            continue
        travel_days = base_days

        # Apply cluster transition days if cluster info exists
        if city_to_cluster is not None:
            from_rep = local_cluster_map.get(from_city, from_city)
            to_rep = local_cluster_map.get(to_city, to_city)

            if from_rep != to_rep:
                if prev_cluster and prev_cluster != from_rep:
                    travel_days += local_cluster_info.get(prev_cluster, {}).get('additional_days', 0) / 2

                travel_days += local_cluster_info.get(from_rep, {}).get('additional_days', 0) / 2
                travel_days += local_cluster_info.get(to_rep, {}).get('additional_days', 0) / 2
                prev_cluster = to_rep

        from_c = city_coords.get(from_city) if city_coords else None
        to_c = city_coords.get(to_city) if city_coords else None

        if temp_weight > 0 or wind_weight > 0 or rain_weight > 0 or max_high_temp < float('inf') or max_low_temp < float('inf') or min_high_temp > float('-inf') or min_low_temp > float('-inf'):
            temp_score, w_score, r_score, violated, interpol_tt, spatial_i_tt = calculate_daily_temperature_scores(
                from_city, to_city, current_day + total_days, travel_days, temperatures, exp, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp, interpol_tt, spatial_i_tt, warming_factor,
                from_coords=from_c, to_coords=to_c,
                wind_weight=wind_weight, rain_weight=rain_weight
            )

            if temp_weight > 0:
                total_temp_score += temp_score * temp_weight
            if wind_weight > 0:
                total_wind_score += w_score * wind_weight
            if rain_weight > 0:
                total_rain_score += r_score * rain_weight
            if violated:
                violations += 1

        total_days += travel_days
        days_track.append(travel_days)

        if total_days > max_days:
            return float('inf'), float('inf'), days_track, interpol_tt, spatial_i_tt

    total_weather = (total_temp_score + total_wind_score + total_rain_score) / (len(route)-1)
    end_score = 3 * (1 - distance_weight) * total_weather + distance_weight * total_days + 100 * violations
    if math.isnan(end_score):
        print("score is nan")
    return end_score, total_days, days_track, interpol_tt, spatial_i_tt

# ---------------------- Modified Nearest Neighbor ----------------------
def nearest_neighbor_with_random(start, target_cities, connections_dict, targets_day_estimates, city_names, max_days, start_day, temperatures,
                                desired_low_temp, desired_high_temp, min_low_temp, max_low_temp, min_high_temp,
                                max_high_temp, temp_weight, rain_weight, wind_weight, randomization=0, exp=2,
                                interpol_tt=None, spatial_i_tt=None,
                                city_to_cluster=None, cluster_info=None, warming_factor=0.0, city_coords=None,
                                distance_weight=0.5):
    """
    Cluster-compatible version of nearest neighbor algorithm.
    """
    unvisited = set(target_cities) - {start}
    current = start
    route = [current]
    current_days = 0
    
    # Create default cluster mapping if not provided
    local_cluster_map = city_to_cluster or {city: city for city in target_cities}
    local_cluster_info = cluster_info or {}
    
    while unvisited:
        neighbor_scores = []
        
        if connections_dict.get(current) in unvisited:
            next_city = connections_dict[current]
            selected = next_city
            days = targets_day_estimates[current + "_" + next_city]
            # Update route and tracking
            route.append(selected)
            current_days += days
            unvisited.remove(selected)
            current = selected
            continue

        
        for next_city in unvisited:
            try:
                # Get base travel days
                travel_days = targets_day_estimates[current + "_" + next_city]
                
                # Calculate cluster-adjusted days if cluster info available
                if city_to_cluster and cluster_info:
                    from_rep = local_cluster_map.get(current, current)
                    to_rep = local_cluster_map.get(next_city, next_city)
                    
                    # Add cluster transition days
                    effective_days = travel_days
                    if from_rep != to_rep:
                        effective_days += local_cluster_info.get(from_rep, {}).get('additional_days', 0) / 2
                        effective_days += local_cluster_info.get(to_rep, {}).get('additional_days', 0) / 2
                else:
                    effective_days = travel_days
                
                if current_days + effective_days <= max_days:
                    score, _, _, interpol_tt, spatial_i_tt = calculate_route_score(
                        [current, next_city], start_day + current_days, targets_day_estimates, temperatures,
                        desired_low_temp, desired_high_temp, min_low_temp, max_low_temp, min_high_temp,
                        max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp, interpol_tt,
                        spatial_i_tt, city_to_cluster, cluster_info, warming_factor, city_coords,
                        distance_weight
                    )
                    neighbor_scores.append((score, next_city, effective_days))
            
            except KeyError:
                continue
        
        if not neighbor_scores:
            print("No valid neighbors found for city", city_names[current], [city_names[city] for city in unvisited])
            selected = unvisited.pop()
            route.append(selected)
            current = selected
            continue

        # Sort and select candidates
        neighbor_scores.sort()
        candidates = neighbor_scores[:max(1, int(len(neighbor_scores) * randomization))]
        _, selected, days = random.choice(candidates)
        
        # Update route and tracking
        route.append(selected)
        current_days += days
        unvisited.remove(selected)
        current = selected
    
    return route, interpol_tt, spatial_i_tt


def improve_route(route, connections_dict, current_day, targets_day_estimates, temperatures,
                 desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                 min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp=2, interpol_tt=None, spatial_i_tt=None,
                 city_to_cluster=None, cluster_info=None, warming_factor=0.0, city_coords=None,
                 distance_weight=0.5):
   """
   Optimizes route using 2-opt local search:
   1. Try swapping all possible pairs of route segments
   2. If swap improves score, keep the change
   3. Repeat until no improvements found

   Returns:
   - Optimized route and its score
   - Updated interpolation trackers
   """
   if not route:
       return None, float('inf'), interpol_tt, spatial_i_tt

   improved = True
   best_score, _, days_track, interpol_tt, spatial_i_tt = calculate_route_score(
       route, current_day, targets_day_estimates, temperatures, desired_low_temp,
       desired_high_temp, min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp,
       interpol_tt, spatial_i_tt, city_to_cluster, cluster_info, warming_factor, city_coords,
       distance_weight
       )
   best_route = route
   best_days_track = days_track

   while improved:
       improved = False
       for i in range(1, len(route) - 1):
           for j in range(i + 1, len(route)):
                #if (not connections_dict.get(route[i])) & (not connections_dict.get(route[j])):
                if j < len(route)-1:
                    route_j_and_one = route[j+1]
                else:
                    route_j_and_one = None
                if connections_dict.get(route[i]) != route[i-1] and connections_dict.get(route[j]) != route_j_and_one:
                    new_route = route[:i] + list(reversed(route[i:j + 1])) + route[j + 1:]
                    new_score, _, days_track, interpol_tt, spatial_i_tt = calculate_route_score(
                        new_route, current_day, targets_day_estimates, temperatures, desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp, interpol_tt, spatial_i_tt,
                        city_to_cluster, cluster_info, warming_factor, city_coords,
                        distance_weight
                        )

                    if  new_score < best_score:
                        best_score = new_score
                        best_route = new_route
                        best_days_track = days_track
                        improved = True
                        route = new_route  # Update the route for the next iteration
                        #break
                #if improved:
                #   break

                if (connections_dict.get(route[i])!= route[i-1]) & (not connections_dict.get(route[j])):
                    #if j == len(route)-1:
                    #    new_route = route[:i] + route[j:j+1] + route[i:j]
                    #else:
                    new_route = route[:i] + route[j:j+1] + route[i:j] +  route[j + 1:]
                    new_score, _, days_track, interpol_tt, spatial_i_tt = calculate_route_score(
                        new_route, current_day, targets_day_estimates, temperatures, desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight, max_days, exp, interpol_tt, spatial_i_tt,
                        city_to_cluster, cluster_info, warming_factor, city_coords,
                        distance_weight
                        )

                    if  new_score < best_score:
                        best_score = new_score
                        best_route = new_route
                        best_days_track = days_track
                        improved = True
                        route = new_route  # Update the route for the next iteration


   return best_route, best_score, best_days_track, interpol_tt, spatial_i_tt


def optimize_clusters_in_route(main_route, cluster_info, start_city, targets_day_estimates, city_names, temperatures,
                              desired_low_temp, desired_high_temp, max_days = float('inf'), exp=2):
    """
    Optimize the route within each cluster segment of the main route.
    Returns optimized full route with intra-cluster optimizations.
    """
    optimized_route = [start_city] if start_city else []
    i = 0
    while i < len(main_route):
        cluster_rep = main_route[i]
        
        if cluster_rep in cluster_info:
            # Find cluster segment boundaries
            cluster_cities = cluster_info[cluster_rep]['cities']
            if start_city in cluster_cities:
                cluster_cities.remove(start_city)
            
            if cluster_cities:
                # Get entry and exit points
                entry_city = optimized_route[-1]if len(optimized_route) > 0 else None
                exit_city = main_route[i+1] if i+1 < len(main_route) else None
                
                # Optimize intra-cluster route
                optimized_cluster, _ = solve_cluster_tsp(
                    entry_city=entry_city,
                    exit_city=exit_city,
                    cluster_cities=cluster_cities,
                    targets_day_estimates=targets_day_estimates,
                    city_names=city_names,
                    temperatures=temperatures,
                    desired_low_temp=desired_low_temp,
                    desired_high_temp=desired_high_temp,
                    min_low_temp=float('-inf'),
                    max_low_temp=float('inf'),
                    min_high_temp=float('-inf'),
                    max_high_temp=float('inf'),
                    max_days=max_days,
                    exp=exp
                )
                
                # Remove entry/exit cities 
                if optimized_cluster[0] == entry_city:
                    optimized_cluster = optimized_cluster[1:]
                if optimized_cluster[-1] == exit_city:
                    optimized_cluster = optimized_cluster[:-1]
                    
                # add optimized cluster to route
                optimized_route.extend(optimized_cluster)
            
        i += 1
    
    return optimized_route

def solve_cluster_tsp(entry_city = None, exit_city = None, cluster_cities = None, targets_day_estimates = None, city_names = None, temperatures = None,
                     desired_low_temp = None, desired_high_temp = None, min_low_temp = float('-inf'), max_low_temp = float('inf'), min_high_temp = float('-inf'),
                     max_high_temp = float('inf'), max_days = float('inf'), exp = 2,
                     interpol_tt = None, spatial_i_tt = None, warming_factor=0.0):
    """
    Solves TSP for cluster cities with optional entry/exit constraints.
    Uses your existing algorithm with temp_weight=0 rain_weight=0 and wind_weight=0.
    """
    # Handle edge cases
    if len(cluster_cities) == 0:
        return []
    if len(cluster_cities) == 1:
        return cluster_cities, 0
    
    routes = []
    
    # Create modified target list
    modified_cities = cluster_cities.copy()
    if entry_city and entry_city in modified_cities:
        modified_cities.remove(entry_city)
    if exit_city and exit_city in modified_cities:
        modified_cities.remove(exit_city)
    
    
    # Try different starting points if no entry city specified
    start_candidates = [entry_city] if entry_city else modified_cities
    
    for start in start_candidates:
        for _ in range(min(len(modified_cities), 5)):
            # Generate route using your existing algorithm with temp_weight=0 and no cluster constraints
            route, _, _ = nearest_neighbor_with_random(
                start=start,
                target_cities=modified_cities,
                connections_dict={},
                targets_day_estimates=targets_day_estimates,
                city_names = city_names,
                max_days=max_days,
                start_day=0,  # Actual day doesn't matter for temp_weight=0
                temperatures=temperatures,
                desired_low_temp=desired_low_temp,
                desired_high_temp=desired_high_temp,
                min_low_temp=min_low_temp,
                max_low_temp=max_low_temp,
                min_high_temp=min_high_temp,
                max_high_temp=max_high_temp,
                temp_weight=0,  # Force distance-only optimization
                rain_weight=0,
                wind_weight=0,
                randomization=0.1,
                exp=exp,
                warming_factor=warming_factor
            )
        
            if route:
                improved_route, score, _, gtt, stt = improve_route(
                    route, {}, 0, targets_day_estimates, temperatures,
                    desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                    min_high_temp, max_high_temp, 0, 0, 0, max_days, exp,
                    warming_factor=warming_factor
                )
                
                
                # Add exit city if specified
                if exit_city:
                    if improved_route[-1] != exit_city:
                        # Try to find path to exit city
                        improved_route.append(exit_city)
                        
                score,days,_,interpol_tt,spatial_i_tt = calculate_route_score(
                    improved_route, 0, targets_day_estimates, temperatures,
                    desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp,
                    min_high_temp, max_high_temp,
                    0, 0, 0, max_days, exp, interpol_tt, spatial_i_tt,
                    warming_factor=warming_factor
                )

                heapq.heappush(routes, (score, improved_route, days))
        
                
    routes.sort()
    
    if routes[0][0] < float('inf'):
        return routes[0][1], routes[0][2]
    else:
        return [], float('inf')

def dynamic_cluster_cities(cities, city_coords, temperatures, targets_day_estimates,
                            current_day, desired_low_temp, desired_high_temp, distance_weight,
                            auto_threshold_percentile=25):
    """
    Dynamically cluster cities using adaptive threshold based on:
    - Combined geographic/temperature distance
    - Automatic threshold calculation
    - Single-city clusters for outliers
    """
    
    # Short-circuit: single city needs no clustering
    if len(cities) <= 1:
        return {0: cities} if cities else {}

    # 1. Calculate normalized combined distance matrix
    combined_dist = create_combined_distance_matrix(
        cities, city_coords, temperatures, targets_day_estimates, current_day,
        desired_low_temp, desired_high_temp, distance_weight
    )
    
    # 2. Calculate automatic distance threshold
    triu_indices = np.triu_indices_from(combined_dist, k=1)
    distance_values = combined_dist[triu_indices]
    threshold = np.percentile(distance_values, auto_threshold_percentile)
    
    # 3. Perform adaptive clustering
    cluster_model = AgglomerativeClustering(
        n_clusters=None,
        affinity='precomputed',
        linkage='average',
        distance_threshold=threshold
    ).fit(combined_dist)
    
    # 4. Create clusters dictionary
    clusters = {}
    for idx, label in enumerate(cluster_model.labels_):
        clusters.setdefault(label, []).append(cities[idx])
        
    return clusters


def create_combined_distance_matrix(cities, city_coords, temperatures, targets_day_estimates, current_day,
                                   desired_low_temp, desired_high_temp, distance_weight):
    """
    Enhanced distance matrix with automatic normalization:
    - Geographic distances normalized to [0,1]
    - Temperature distances normalized to [0,1]
    - Weighted combination based on distance_weight
    """
    num_cities = len(cities)
    day_dist = np.zeros((num_cities, num_cities))
    temp_dist = np.zeros((num_cities, num_cities))
    
    # Calculate raw geographic distances
    day_values = []
    for i, city1 in enumerate(cities):
        for j, city2 in enumerate(cities):
            if i < j:
                try:
                    dist = targets_day_estimates[city1 +"_"+ city2]
                except:
                    dist = 20000
                day_dist[i,j] = day_dist[j,i] = dist
                day_values.append(dist)

    # Normalize geographic distances (guard against single-city case)
    if day_values:
        max_day = max(day_values)
        if max_day > 0:
            day_dist = day_dist / max_day

    # Calculate temperature compatibility scores
    temp_scores = {}
    for city in cities:
        temps = get_interpolated_temperature(city, current_day, temperatures)
        temp_scores[city] = temps[1]

    # Normalize temperature differences (guard against all-equal temps)
    all_scores = list(temp_scores.values())
    max_temp_diff = max(all_scores) - min(all_scores) if len(all_scores) > 1 else 0
    if max_temp_diff > 0:
        for i, city1 in enumerate(cities):
            for j, city2 in enumerate(cities):
                if i < j:
                    temp_dist[i,j] = temp_dist[j,i] = abs(temp_scores[city1] - temp_scores[city2]) / max_temp_diff
                
    # Combine distances: lower distance_weight → more weather influence on clustering
    weather_influence = 1 - distance_weight
    return weather_influence * temp_dist + 2 * day_dist

def calculate_cluster_metrics(graph, cluster_cities, city_names, city_coords, daily_max_km):
    """Calculate representative city and additional days for a cluster"""
    if len(cluster_cities) == 1:
        return cluster_cities[0], 0
    
    # 1. Find representative city (closest to centroid)
    lats = [city_coords[city][0] for city in cluster_cities]
    lons = [city_coords[city][1] for city in cluster_cities]
    centroid = (np.mean(lats), np.mean(lons))
    
    min_dist = float('inf')
    representative = cluster_cities[0]
    for city in cluster_cities:
        dist = haversine(city_coords[city], centroid)
        if dist < min_dist:
            min_dist = dist
            representative = city
    
    # 2. Calculate additional days
    # Step 1: TSP days with temp_weight=0
    targets_day_estimates = calc_targets_day_estimates(graph, cluster_cities, daily_max_km, distance_weight=1.0)
    intra_cluster_route, cluster_days = solve_cluster_tsp(cluster_cities = cluster_cities, targets_day_estimates = targets_day_estimates,
                                            city_names = city_names, max_days = float('inf'), exp = 0)
    
    # Step 2: max targets_day_estimates
    step2_days = 0
    estimates = [targets_day_estimates[item] for item in targets_day_estimates]
    step2_days = max(estimates)
    
    # Step 3: Additional days
    additional_days = ceil(max(0, cluster_days - 0.5*step2_days))
    
    return representative, additional_days

def preprocess_clusters(graph, target_cities, city_coords, temperatures, targets_day_estimates, city_names,
                        daily_max_km, current_day, desired_low_temp, desired_high_temp,
                        distance_weight, auto_threshold_percentile
                        ):
    """Cluster cities and calculate cluster metrics"""
    # Use previous dynamic clustering implementation
    clusters = dynamic_cluster_cities(target_cities, city_coords, temperatures, targets_day_estimates,
                                      current_day, desired_low_temp, desired_high_temp,
                                      distance_weight, auto_threshold_percentile)
    
    cluster_info = {}
    city_to_cluster = {}
    for cluster_id, cities in clusters.items():
        rep, days = calculate_cluster_metrics(graph, cities, city_names, city_coords, daily_max_km)
        cluster_info[rep] = {
            'cities': cities,
            'additional_days': days,
            'cluster_id': cluster_id
        }
        for city in cities:
            city_to_cluster[city] = rep
    
    return cluster_info, city_to_cluster

def check_route_feasibility(graph, target_cities, start_city, connections,
                            blocked_countries, city_ids_by_country):
    """
    Fast pre-check on a copy of the graph (does not modify the global graph).
    Returns a list of German human-readable error strings, empty if all OK.
    """
    # Work on a copy so we don't mutate the global graph
    test_graph = graph.copy()
    test_graph = remove_nodes_for_blocked_countries(
        test_graph, blocked_countries, city_ids_by_country
    )

    # Collect all cities that must be reachable
    all_cities = list(target_cities)
    if start_city and start_city not in all_cities:
        all_cities = [start_city] + all_cities
    if connections:
        for c1, c2 in connections:
            if c1 not in all_cities:
                all_cities.append(c1)
            if c2 not in all_cities:
                all_cities.append(c2)

    issues = []

    # 1. Which cities were removed by blocked-country filtering?
    existing = []
    for city_id in all_cities:
        if city_id not in test_graph.nodes:
            if city_id in graph.nodes:
                name = graph.nodes[city_id].get('name', str(city_id))
                issues.append(
                    f'Stadt „{name}" liegt in einem gesperrten Land '
                    f'und kann daher nicht besucht werden.'
                )
            else:
                issues.append(
                    f'Stadt (ID {city_id}) wurde nicht im Graphen gefunden.'
                )
        else:
            existing.append(city_id)

    if len(existing) < 2:
        return issues  # Can't check connectivity with fewer than 2 cities

    # 2. Connected-component check – find cities cut off from the others
    comp_of = {node: cid
               for cid, comp in enumerate(nx.connected_components(test_graph))
               for node in comp}

    city_comps = {c: comp_of[c] for c in existing if c in comp_of}
    unique_comps = set(city_comps.values())

    if len(unique_comps) > 1:
        comp_count = Counter(city_comps.values())
        main_comp  = comp_count.most_common(1)[0][0]
        for city_id, comp in city_comps.items():
            if comp != main_comp:
                name = test_graph.nodes[city_id].get('name', str(city_id))
                issues.append(
                    f'Stadt „{name}" ist von den anderen Städten abgeschnitten '
                    f'und kann nicht erreicht werden (kein Pfad im Straßengraphen).'
                )

    return issues


def find_optimal_route(graph, blocked_countries, city_ids_by_country, temperatures, target_cities, start_city=None,
                      connections=None, start_day=None, low_temp_range=(float('-inf'), float('inf')),
                      high_temp_range=(float('-inf'), float('inf')), daily_max_km=100,
                      max_days=30, candidate_limit=8,
                      desired_low_temp=15, desired_high_temp=25,
                      temp_weight=0.5, rain_weight=0.0, wind_weight=0.0, distance_weight=0.5,
                      auto_threshold_percentile=20, exp=2,
                      sorted_input=False, city_rest_days=None, warming_factor=0.0):
    """
    Find optimal route considering both distance and temperature preferences.
    temp_weight: Weight factor for temperature score (0.0 to 1.0)
    sorted_input: If True, use target_cities order as-is, skip clustering and pre-sorting.
                  Directly builds and evaluates a single full route in the given order.
    """

    # Remove edges for blocked countries
    graph = remove_nodes_for_blocked_countries(graph, blocked_countries, city_ids_by_country)

    # Failure-reason tracking (Counter of reason strings → most common = best diagnosis)
    _fail_counter = Counter()

    # Initialize timing accumulators
    interpol_tt = 0.0
    spatial_i_tt = 0.0
    total_advanced_preroute_time = 0.0
    total_shortest_path_time = 0.0

    min_low_temp, max_low_temp = low_temp_range
    min_high_temp, max_high_temp = high_temp_range

    start_day_provided = start_day is not None
    if start_day is None:
        start_day = 111
        if temp_weight > 0 or wind_weight > 0 or rain_weight > 0:
            start_day_list = [20, 111, 202, 293]
        else:
            start_day_list = [start_day]
    else:
        start_day_list = [start_day]

    city_names = {city: graph.nodes[city]['name'] for city in target_cities}
    if start_city:
        city_names[start_city] = graph.nodes[start_city]['name']
    if connections:
        for city1, city2 in connections:
            city_names[city1] = graph.nodes[city1]['name']
            city_names[city2] = graph.nodes[city2]['name']

    coords = {}
    for city in target_cities:
        try:
            node = graph.nodes[city]
            coords[city] = (node['lat'], node['lon'])
        except KeyError:
            print("city: " + str(city) + " not found in graph")
            reason = (f'Stadt (ID {city}) ist nicht im Graphen – '
                      f'möglicherweise in einem gesperrten Land.')
            return None, None, reason

    # Build city_coords for all graph nodes (needed for wind/rain scoring)
    city_coords = {cid: (graph.nodes[cid]['lat'], graph.nodes[cid]['lon']) for cid in graph.nodes()}

    connections_dict = {}
    if connections:
        for city1, city2 in connections:
            if city1 not in target_cities:
                target_cities.append(city1)
            if city2 not in target_cities:
                target_cities.append(city2)
            connections_dict[city1] = city2
            connections_dict[city2] = city1

    # ══════════════════════════════════════════════════════════════════
    # SORTED INPUT: skip clustering, use given order directly
    # ══════════════════════════════════════════════════════════════════
    if sorted_input:
        # Build candidate_order: start_city first (if given), then target_cities in order
        candidate_order = []
        if start_city:
            candidate_order.append(start_city)
        for city in target_cities:
            if city not in candidate_order:
                candidate_order.append(city)

        # Insert connection cities at their correct positions (right after their pair partner)
        if connections:
            for city1, city2 in connections:
                # city1 → city2 must be adjacent; insert city2 right after city1 if not already
                if city1 in candidate_order and city2 in candidate_order:
                    idx1 = candidate_order.index(city1)
                    idx2 = candidate_order.index(city2)
                    if idx2 != idx1 + 1:
                        candidate_order.remove(city2)
                        candidate_order.insert(idx1 + 1, city2)

        print("sorted_input mode — using fixed order:", [city_names[c] for c in candidate_order])

        # We only evaluate this single route for the given start_day
        final_solutions = [(0, candidate_order, start_day_list[0])]
        all_evaluated_routes = []

        # Jump directly to route evaluation (shared code block below)

    # ══════════════════════════════════════════════════════════════════
    # NORMAL MODE: clustering + optimization
    # ══════════════════════════════════════════════════════════════════
    else:
        targets_day_estimates = calc_targets_day_estimates(graph, target_cities, daily_max_km, distance_weight)

        start_time = time.time()

        cluster_cities = list(target_cities)
        add_cities_to_cluster = []
        if start_city:
            add_cities_to_cluster.append(start_city)
            if start_city in cluster_cities:
                cluster_cities.remove(start_city)
        if connections:
            for city1, city2 in connections:
                if city1 in cluster_cities:
                    cluster_cities.remove(city1)
                if city2 in cluster_cities:
                    cluster_cities.remove(city2)
                add_cities_to_cluster.append(city1)
                add_cities_to_cluster.append(city2)
                targets_day_estimates[city1 + "_" + city2] = 1
                targets_day_estimates[city2 + "_" + city1] = 1

        cluster_info, city_to_cluster = preprocess_clusters(
            graph, cluster_cities, coords, temperatures,
            targets_day_estimates, city_names, daily_max_km, start_day,
            desired_low_temp, desired_high_temp, distance_weight, auto_threshold_percentile
        )

        for city in add_cities_to_cluster:
            cluster_info[city] = {
                'cities': [city],
                'additional_days': 0,
                'cluster_id': len(cluster_info)
            }
            city_to_cluster[city] = city

        print("clusters: " + str(len(cluster_info)))
        for cluster in cluster_info:
            cities = [graph.nodes[city]['name'] for city in cluster_info[cluster]['cities']]
            print("cities: " + str(cities) + " additional days: " + str(cluster_info[cluster]['additional_days']))

        initial_cities = [city_to_cluster.get(start_city)] if start_city else cluster_info

        solutions = []
        for sd in start_day_list:
            for start in initial_cities:
                for _ in range(min(len(cluster_info), 5)):
                    initial_route, interpol_tt, spatial_i_tt = nearest_neighbor_with_random(
                        start, cluster_info, connections_dict, targets_day_estimates, city_names,
                        max_days, sd, temperatures, desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                        temp_weight, rain_weight, wind_weight, randomization=0.2, exp=exp,
                        interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                        city_to_cluster=city_to_cluster, cluster_info=cluster_info,
                        warming_factor=warming_factor, city_coords=city_coords,
                        distance_weight=distance_weight
                    )
                    score, _, _, interpol_tt, spatial_i_tt = calculate_route_score(
                        initial_route, sd, targets_day_estimates, temperatures,
                        desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                        min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight,
                        max_days, exp, interpol_tt, spatial_i_tt,
                        warming_factor=warming_factor, city_coords=city_coords,
                        distance_weight=distance_weight
                    )
                    print("initial route:", [city_names[city] for city in initial_route], score)

                    if initial_route:
                        improved_route, score, days_track, interpol_tt, spatial_i_tt = improve_route(
                            initial_route, connections_dict, sd, targets_day_estimates, temperatures,
                            desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                            min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight,
                            max_days, exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                            city_to_cluster=city_to_cluster, cluster_info=cluster_info,
                            warming_factor=warming_factor, city_coords=city_coords,
                            distance_weight=distance_weight
                        )
                        heapq.heappush(solutions, (score, improved_route, days_track, sd))
                        print("improved route:", [city_names[city] for city in improved_route], score)

        total_advanced_preroute_time += time.time() - start_time

        solutions.sort()
        top_candidates = []
        top_solutions = []
        while solutions and len(top_candidates) < candidate_limit:
            score, route, days_track, sd = heapq.heappop(solutions)
            if (route, sd) not in top_candidates:
                top_candidates.append((route, sd))
                top_solutions.append((score, route, sd))
                route_cities = [graph.nodes[city]['name'] for city in route]
                days_track_sum = sum(days_track)
                days_track = [str(sum(days_track[:i + 1])) for i in range(len(days_track))]
                print(route_cities + days_track + [str(days_track_sum)] + [str(score)])

        final_solutions = []
        for score, route, sd in top_solutions:
            optimized_route = optimize_clusters_in_route(
                route, cluster_info, start_city,
                targets_day_estimates, city_names, temperatures, max_days, exp
            )
            optimized_score, _, _, interpol_tt, spatial_i_tt = calculate_route_score(
                optimized_route, sd, targets_day_estimates, temperatures,
                desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                min_high_temp, max_high_temp, temp_weight, rain_weight, wind_weight,
                max_days, exp, interpol_tt, spatial_i_tt,
                warming_factor=warming_factor, city_coords=city_coords,
                distance_weight=distance_weight
            )
            heapq.heappush(final_solutions, (optimized_score, optimized_route, sd))

        final_solutions.sort()
        all_evaluated_routes = []

    # ══════════════════════════════════════════════════════════════════
    # SHARED: build full routes from candidate_order list
    # ══════════════════════════════════════════════════════════════════
    for _, candidate_order, route_start_day in final_solutions[:candidate_limit]:
        full_route = []
        current_day = route_start_day
        total_days = 0
        valid = True
        visited_targets = set()
        subgraph = graph.copy()
        print("starting with route:", [city_names[city] for city in candidate_order])

        try:
            current_city = candidate_order[0]
            city_name = graph.nodes[current_city].get('name')
            full_route.append((current_city, current_day, city_name, 0))
            if current_city in target_cities:
                visited_targets.add(current_city)
                month = day_to_month(current_day)
                temp_data = temperatures.get(current_city, {}).get(str(month), [None] * 6)[:2]
                temp_score, violated = calculate_temperature_score(
                    temp_data, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp
                )
                if violated:
                    print("Violation in temperature score for route",
                          [city_names[city] for city in candidate_order],
                          "with weather data", str(temp_score), "for city", city_names[current_city])
                    valid = False
        except KeyError:
            continue

        if not valid:
            continue

        for i in range(len(candidate_order) - 1):
            from_city = candidate_order[i]
            to_city = candidate_order[i + 1]
            print("get connection from city", city_names[from_city], "to city", city_names[to_city])

            if connections_dict.get(from_city) == to_city:
                total_days += 1
                current_day += 1
                full_route.append((to_city, current_day, graph.nodes[to_city].get('name'), 0))
                next_city = to_city
                if next_city in target_cities:
                    visited_targets.add(next_city)
                    month = day_to_month(current_day)
                    temp_data = temperatures.get(next_city, {}).get(str(month), [None] * 6)[:2]
                    if temp_data[0] is None or temp_data[1] is None or \
                       not ((min_low_temp <= temp_data[0] <= max_low_temp) and
                            (min_high_temp <= temp_data[1] <= max_high_temp)):
                        valid = False
                        print("weather data out of bound", str(temp_data))
                        break
                # Add rest days for this city (shifts departure to next city)
                rest = (city_rest_days or {}).get(next_city, 0)
                if rest > 0:
                    current_day += rest
                    total_days  += rest
                continue

            # Shortest path: inside cluster → nx.shortest_path, across clusters → optimized_travel_planner
            # In sorted_input mode city_to_cluster is not defined, always use optimized_travel_planner
            use_simple_path = (not sorted_input and
                               city_to_cluster.get(from_city) == city_to_cluster.get(to_city))

            if use_simple_path:
                try:
                    t0 = time.time()
                    path_segment = nx.shortest_path(subgraph, from_city, to_city, weight='weight')
                    total_shortest_path_time += time.time() - t0
                except Exception as error:
                    print("an error occurred during nx.shortest_path:", str(error))
                    _fail_counter[
                        f'Keine Verbindung zwischen „{city_names[from_city]}" und '
                        f'„{city_names[to_city]}" gefunden.'
                    ] += 1
                    break
            else:
                try:
                    t0 = time.time()
                    # For sorted_input we need targets_day_estimates on demand
                    if sorted_input:
                        coord_from = (graph.nodes[from_city]['lat'], graph.nodes[from_city]['lon'])
                        coord_to   = (graph.nodes[to_city]['lat'],   graph.nodes[to_city]['lon'])
                        dist_km    = haversine(coord_from, coord_to)
                        expected_travel_days = dist_km / daily_max_km
                    else:
                        expected_travel_days = targets_day_estimates[from_city + "_" + to_city]

                    path_segment, segment_score, interpol_tt, spatial_i_tt = optimized_travel_planner(
                        subgraph, from_city, to_city, current_day, temperatures,
                        daily_max_km, expected_travel_days, desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                        temp_weight, exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                        warming_factor=warming_factor, distance_weight=distance_weight
                    )
                    total_shortest_path_time += time.time() - t0
                except Exception as error:
                    print("an error occurred during optimized_travel_planner:", str(error))
                    _fail_counter[
                        f'Kein Weg von „{city_names[from_city]}" nach '
                        f'„{city_names[to_city]}" gefunden – Städte möglicherweise '
                        f'nicht verbunden oder Tagesstrecke zu kurz.'
                    ] += 1
                    break

            for j in range(len(path_segment) - 1):
                current = path_segment[j]
                next_city = path_segment[j + 1]

                edge_data = graph.get_edge_data(current, next_city)
                distance = edge_data['weight']
                seg_days = distance / daily_max_km
                arrival_day = current_day + seg_days

                city_name = graph.nodes[next_city].get('name')
                full_route.append((next_city, arrival_day, city_name, distance))

                current_day = arrival_day
                total_days += seg_days

                # Add rest days for target cities (shifts departure to next city)
                if next_city in target_cities:
                    rest = (city_rest_days or {}).get(next_city, 0)
                    if rest > 0:
                        current_day += rest
                        total_days  += rest

                if next_city in target_cities:
                    visited_targets.add(next_city)
                    month = day_to_month(arrival_day)
                    temp_data = temperatures.get(next_city, {}).get(str(month), (None, None))[:2]
                    if temp_data[0] is None or temp_data[1] is None or \
                       not ((min_low_temp <= temp_data[0] <= max_low_temp) and
                            (min_high_temp <= temp_data[1] <= max_high_temp)):
                        valid = False
                        print("weather data out of bound", str(temp_data))
                        _fail_counter[
                            f'Temperatur in „{city_names[next_city]}" liegt außerhalb '
                            f'des erlaubten Bereichs (Wert: {temp_data}).'
                        ] += 1
                        break

                try:
                    subgraph.remove_edge(current, next_city)
                except:
                    pass

            if total_days > max_days:
                valid = False
                print("Exceeded max days", str(total_days), "days out of", str(max_days),
                      "with route:", [city_names[city] for city, _, _, _ in full_route])
                _fail_counter[
                    f'Route benötigt {total_days} Tage, aber das Maximum ist {max_days}. '
                    f'Erhöhe „Max. Reisetage" oder „Max. Tagesstrecke".'
                ] += 1
                break

            if not valid:
                break

        if valid and all([target in visited_targets for target in target_cities]):
            current_route = [city for city, _, _, _ in full_route]
            full_score, _, interpol_tt, spatial_i_tt = calculate_path_score(
                graph, current_route, connections_dict, route_start_day, temperatures,
                desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                min_high_temp, max_high_temp, temp_weight, daily_max_km, max_days,
                exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                warming_factor=warming_factor,
                wind_weight=wind_weight, rain_weight=rain_weight, city_coords=city_coords,
                distance_weight=distance_weight
            )
            all_evaluated_routes.append((full_score, current_route, route_start_day, full_route))
            print(f"Valid route found with score: {full_score:.2f}, start day: {route_start_day}")
        elif not all([target in visited_targets for target in target_cities]):
            print("Not all targets visited in route:", [city_names[city] for city in candidate_order])
            unvisited = [city_names[t] for t in target_cities if t not in visited_targets]
            if unvisited:
                _fail_counter[
                    f'Folgende Städte konnten nicht eingebunden werden: '
                    f'{", ".join(unvisited)}.'
                ] += 1

    all_evaluated_routes.sort(key=lambda x: x[0])

    # ══════════════════════════════════════════════════════════════════
    # FINE-TUNING (only in normal mode with multiple start days)
    # ══════════════════════════════════════════════════════════════════
    # Fine-tuning runs unless start_day was explicitly provided by the caller
    if not start_day_provided and len(start_day_list) > 1:
        print(f"\n{'='*60}")
        print(f"FINE-TUNING START DAYS FOR TOP 4 ROUTES")
        print(f"{'='*60}\n")

        fine_tuned_results = []
        for idx, (initial_score, route_order, initial_start_day, initial_full_route) in \
                enumerate(all_evaluated_routes[:4], 1):
            print(f"Initial score: {initial_score:.2f}, initial start day: {initial_start_day}")

            best_start_day = initial_start_day
            best_score = initial_score

            for interval in [46, 23, 12, 6, 3, 1]:
                improved = False

                earlier_day = (best_start_day - interval) % 365
                if 1 <= earlier_day <= 365:
                    score_earlier, _, interpol_tt, spatial_i_tt = calculate_path_score(
                        graph, route_order, connections_dict, earlier_day, temperatures,
                        desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                        min_high_temp, max_high_temp, temp_weight, daily_max_km, max_days,
                        exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                        warming_factor=warming_factor,
                        wind_weight=wind_weight, rain_weight=rain_weight, city_coords=city_coords,
                        distance_weight=distance_weight
                    )
                    print(f"  Day {earlier_day} (−{interval}): score {score_earlier:.2f}")
                    if score_earlier < best_score:
                        best_score = score_earlier
                        best_start_day = earlier_day
                        improved = True

                later_day = (best_start_day + interval) % 365
                if 1 <= later_day <= 365:
                    score_later, _, interpol_tt, spatial_i_tt = calculate_path_score(
                        graph, route_order, connections_dict, later_day, temperatures,
                        desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                        min_high_temp, max_high_temp, temp_weight, daily_max_km, max_days,
                        exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                        warming_factor=warming_factor,
                        wind_weight=wind_weight, rain_weight=rain_weight, city_coords=city_coords,
                        distance_weight=distance_weight
                    )
                    print(f"  Day {later_day} (+{interval}): score {score_later:.2f}")
                    if score_later < best_score:
                        best_score = score_later
                        best_start_day = later_day
                        improved = True

                if improved:
                    print(f"  → Improved! New best: day {best_start_day}, score {best_score:.2f}")
                else:
                    print(f"  No improvement at ±{interval} days")

            improvement = initial_score - best_score
            improvement_pct = (improvement / initial_score * 100) if initial_score > 0 else 0
            print(f"\nRoute {idx} final: start day {best_start_day}, score {best_score:.2f}")
            print(f"Improvement: {improvement:.2f} ({improvement_pct:.1f}%)")
            fine_tuned_results.append((best_score, route_order, best_start_day, initial_full_route))
    else:
        if start_day_provided:
            print("\nNo fine-tuning applied (start_day explicitly provided).")
        else:
            print("\nNo fine-tuning applied (single start day).")
        fine_tuned_results = all_evaluated_routes

    # ══════════════════════════════════════════════════════════════════
    # SELECT BEST ROUTE
    # ══════════════════════════════════════════════════════════════════
    if fine_tuned_results:
        fine_tuned_results.sort(key=lambda x: x[0])
        best_score, best_route_order, best_start_day, original_full_route = fine_tuned_results[0]

        if original_full_route and best_start_day != original_full_route[0][1]:
            print(f"\nRebuilding route with optimized start day {best_start_day}...")
            day_offset = best_start_day - original_full_route[0][1]
            best_full_route = [
                (city_id, day + day_offset, city_name, distance)
                for city_id, day, city_name, distance in original_full_route
            ]
        else:
            best_full_route = original_full_route

        print(f"\n{'='*60}")
        print(f"FINAL BEST ROUTE{'  [sorted_input]' if sorted_input else ''}")
        print(f"{'='*60}")
        print(f"Score: {best_score:.2f}  |  Start day: {best_start_day}")
        print(f"{'='*60}\n")
    else:
        print("\nWarning: No valid routes found")
        best_full_route = None
        best_start_day = None

    # Timing summary
    print(f"Best score: {best_score:.2f}" if best_full_route else "No route found")
    print(f"Best start day: {best_start_day if best_full_route else None}")
    print(f"Total time for advanced preroute:          {total_advanced_preroute_time:.2f}s")
    print(f"Total time for get_interpolated_temperature: {interpol_tt:.2f}s")
    print(f"Total time for spatial temperature interp:   {spatial_i_tt:.2f}s")
    print(f"Total time for shortest path calls:          {total_shortest_path_time:.2f}s")

    if best_full_route:
        return best_full_route, best_start_day, None
    else:
        # Pick the most frequently occurring failure reason as the diagnosis
        if _fail_counter:
            fail_reason = _fail_counter.most_common(1)[0][0]
        else:
            fail_reason = ('Kein gültiger Routenverlauf gefunden. '
                           'Überprüfe Städte, Temperaturgrenzen und Reiselimits.')
        return None, None, fail_reason



def get_osrm_route(route_locations, skip_segments=None, routing_mode='car', progress_callback=None, chunk_callback=None):
    """
    Fetch road geometry for each city-to-city segment.
    routing_mode: 'car'              – OSRM driving (default)
                  'bicycle'          – OSRM cycling
                  'car_no_highway'   – Valhalla auto with use_highways=0
                  'brouter_trekking' – BRouter trekking bike
                  'brouter_fastbike' – BRouter road/fast bike
                  'brouter_mtb'      – BRouter mountain bike
                  'brouter_safety'   – BRouter safety-first routing
    skip_segments: set of int indices i where segment (i → i+1) should be skipped.
    Returns: list of road-geometry chunks [ [(lat,lon), ...], ... ]
    """
    skip_segments = skip_segments or set()
    road_chunks = []

    # Valhalla costing options for car_no_highway
    _valhalla_opts = {"auto": {"use_highways": 0.0, "use_tolls": 0.5}}

    # BRouter profile name mapping (store key → BRouter API name)
    _brouter_profiles = {
        'trekking': 'trekking',
        'fastbike': 'fastbike',
        'mtb': 'MTB',
        'safety': 'safety',
    }

    n_segs = sum(1 for i in range(len(route_locations) - 1) if i not in skip_segments)
    _mode_labels = {
        'car': 'OSRM Auto', 'bicycle': 'OSRM Fahrrad',
        'car_no_highway': 'Valhalla (ohne Autobahn)',
        'brouter_trekking': 'BRouter Trekking', 'brouter_fastbike': 'BRouter Fastbike',
        'brouter_mtb': 'BRouter MTB', 'brouter_safety': 'BRouter Safety',
    }
    mode_label = _mode_labels.get(routing_mode, routing_mode)
    print(f"[Routing] {mode_label} — {n_segs} Segment(e)", flush=True)
    seg_done = 0

    for i in range(len(route_locations) - 1):
        if i in skip_segments:
            continue

        start = route_locations[i]
        end   = route_locations[i + 1]

        try:
            if routing_mode == 'car_no_highway':
                # ── Valhalla ─────────────────────────────────────────────────
                body = {
                    "locations": [
                        {"lon": start[1], "lat": start[0], "type": "break"},
                        {"lon": end[1],   "lat": end[0],   "type": "break"},
                    ],
                    "costing": "auto",
                    "costing_options": _valhalla_opts,
                    "directions_type": "none",
                }
                resp = requests.post(
                    f"{VALHALLA_BASE}/route", json=body, timeout=30
                )
                resp.raise_for_status()
                data = resp.json()
                shape = data["trip"]["legs"][0]["shape"]
                # Valhalla encodes with polyline6 (precision=6)
                decoded = polyline_codec.decode(shape, 6)
            elif routing_mode.startswith('brouter_'):
                # ── BRouter ──────────────────────────────────────────────────
                profile_key = routing_mode[len('brouter_'):]
                profile = _brouter_profiles.get(profile_key, 'trekking')
                lonlats = f"{start[1]},{start[0]}|{end[1]},{end[0]}"
                resp = requests.get(
                    "https://brouter.de/brouter",
                    params={
                        "lonlats": lonlats,
                        "profile": profile,
                        "alternativeidx": "0",
                        "format": "geojson",
                    },
                    timeout=45,
                    headers={"User-Agent": "WeatherRoute/1.0"},
                )
                resp.raise_for_status()
                data = resp.json()
                features = data.get("features", [])
                if not features:
                    print(f"  BRouter: keine Route für Segment {i}", flush=True)
                    road_chunks.append([start, end])
                    continue
                coords = features[0]["geometry"]["coordinates"]
                # BRouter returns [lon, lat] — convert to (lat, lon)
                decoded = [(c[1], c[0]) for c in coords]
            else:
                # ── OSRM ─────────────────────────────────────────────────────
                profile  = "cycling" if routing_mode == 'bicycle' else "driving"
                coord_str = f"{start[1]},{start[0]};{end[1]},{end[0]}"
                resp = requests.get(
                    f"{OSRM_BASE}/route/v1/{profile}/{coord_str}",
                    params={"overview": "full", "geometries": "polyline"},
                    timeout=20,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != "Ok":
                    print(f"OSRM error segment {i}: {data.get('message')}")
                    road_chunks.append([start, end])
                    continue
                decoded = polyline_codec.decode(data["routes"][0]["geometry"])

            if decoded and not isinstance(decoded[0], (list, tuple)):
                decoded = [(decoded[idx], decoded[idx + 1])
                           for idx in range(0, len(decoded) - 1, 2)]
            road_chunks.append(decoded)
            seg_done += 1
            print(f"  Segment {seg_done}/{n_segs} — {len(decoded)} Punkte", flush=True)
            if chunk_callback:
                chunk_callback(i, decoded)
            if progress_callback:
                progress_callback(seg_done, n_segs)

        except Exception as e:
            print(f"  Segment {i+1} fehlgeschlagen ({routing_mode}): {e}", flush=True)
            road_chunks.append([start, end])
            seg_done += 1
            if chunk_callback:
                chunk_callback(i, [start, end])
            if progress_callback:
                progress_callback(seg_done, n_segs)

    print(f"[Routing] Fertig — {len(road_chunks)} Chunks gesamt", flush=True)
    return road_chunks


def sample_chunk_fixed_density(chunk, points_per_km):
    """
    Sample a single OSRM road chunk at a fixed density (points per km).
    Returns list of (lat, lon, local_km) where local_km is the cumulative distance
    from the start of this chunk.
    """
    coords_km = []
    cum_km = 0.0
    prev = None
    for point in chunk:
        if not (isinstance(point, (list, tuple)) and len(point) == 2):
            continue
        lat, lon = float(point[0]), float(point[1])
        if prev is not None:
            cum_km += haversine(prev, (lat, lon))
        coords_km.append((lat, lon, cum_km))
        prev = (lat, lon)

    if not coords_km:
        return []

    total_km = coords_km[-1][2]
    n_target = max(2, round(total_km * points_per_km))
    n = len(coords_km)

    if n <= n_target:
        return coords_km

    step = n / n_target
    indices = [int(i * step) for i in range(n_target)]
    indices[-1] = n - 1
    return [coords_km[idx] for idx in indices]


def get_elevation_profile(route_locations, city_names, skip_segments=None, max_elev_points=5000):
    """
    Get elevation profile using OSRM + Open-Elevation.
    Uses global haversine() function (returns km).
    Returns: {"profile": [(km, ele_m), ...], "city_marks": [(km, name), ...]}
    """
    skip_segments = skip_segments or set()
    
    road_chunks = get_osrm_route(route_locations, skip_segments)
    if not road_chunks:
        return None
    
    # Flatten to coordinate list
    road_coords = []
    for chunk in road_chunks:
        for point in chunk:
            if isinstance(point, (list, tuple)) and len(point) == 2:
                road_coords.append((float(point[0]), float(point[1])))
    
    if not road_coords:
        return None
    
    # Compute leg distances
    seg_to_chunk = {}
    chunk_idx = 0
    for i in range(len(route_locations) - 1):
        if i not in skip_segments:
            seg_to_chunk[i] = chunk_idx
            chunk_idx += 1
    
    leg_distances_km = []
    for i in range(len(route_locations) - 1):
        if i in skip_segments:
            leg_distances_km.append(0.0)
        else:
            chunk = road_chunks[seg_to_chunk[i]]
            d = sum(haversine((chunk[j][0], chunk[j][1]), 
                              (chunk[j+1][0], chunk[j+1][1]))
                    for j in range(len(chunk) - 1))
            leg_distances_km.append(d)
    
    # Subsample for elevation
    n = len(road_coords)
    if n > max_elev_points:
        step = n / max_elev_points
        indices = [int(i * step) for i in range(max_elev_points)]
        indices[-1] = n - 1
        road_coords = [road_coords[i] for i in indices]
    
    # Elevation lookup — SRTM for ≤59°N, ASTER for higher latitudes (batched)
    _elev_url, _ELEV_BATCH, _payload_fn = _elev_api(road_coords)
    results = []
    try:
        for b_start in range(0, len(road_coords), _ELEV_BATCH):
            batch = road_coords[b_start:b_start + _ELEV_BATCH]
            resp = requests.post(_elev_url, json=_payload_fn(batch), timeout=30)
            resp.raise_for_status()
            results.extend(resp.json()["results"])
    except Exception as e:
        print(f"Open-Elevation request failed: {e}")
        return None

    # Build elevation profile (stop at first flight)
    profile = []
    max_road_km = sum(d for d in leg_distances_km if d > 0)

    for i, r in enumerate(results):
        loc = r.get("location", {})
        lat = r.get("latitude") or loc.get("lat", 0)
        lon = r.get("longitude") or loc.get("lng", 0)
        ele = r["elevation"] or 0
        if i == 0:
            profile.append((0.0, ele))
        else:
            prev = results[i - 1]
            d = haversine((prev["latitude"], prev["longitude"]), (lat, lon))
            new_dist = profile[-1][0] + d
            if new_dist > max_road_km * 1.01:
                break
            profile.append((new_dist, ele))
    
    # City markers (only for road-connected cities)
    city_marks = [(0.0, city_names[0])]
    cum = 0.0
    
    for i, dist_km in enumerate(leg_distances_km):
        if dist_km > 0:
            cum += dist_km
            if i + 1 < len(city_names):
                city_marks.append((cum, city_names[i + 1]))
    
    return {"profile": profile, "city_marks": city_marks}


def compute_distances_from_chunks(road_chunks, route_locations, skip_segments=None):
    """Compute segment distances from pre-fetched road chunks."""
    skip_segments = skip_segments or set()
    seg_to_chunk = {}
    chunk_idx = 0
    for i in range(len(route_locations) - 1):
        if i not in skip_segments:
            seg_to_chunk[i] = chunk_idx
            chunk_idx += 1
    
    distances_km = []
    for i in range(len(route_locations) - 1):
        if i in skip_segments:
            distances_km.append(0.0)
        else:
            chunk = road_chunks[seg_to_chunk[i]]
            d = sum(haversine((chunk[j][0], chunk[j][1]), 
                              (chunk[j+1][0], chunk[j+1][1]))
                    for j in range(len(chunk) - 1))
            distances_km.append(d)
    
    return distances_km


def prepare_elevation_sampling(sub_route_data, points_per_1000km=1000):
    """
    Steps 1+2 of build_combined_elevation_profile: build route geometry and subsample.
    Returns a dict with sampling data (no API calls), or None on failure.
    """
    print(f"[Höhenprofil] Vorbereitung für {len(sub_route_data)} Teilroute(n)", flush=True)

    # Step 1: For each sub-route build a (lat, lon, cum_km) list from the full
    # road geometry and compute leg distances for city markers from the same source.
    sub_info = []
    total_coords = 0
    for item in sub_route_data:
        coords_km = []
        cum_km = 0.0
        prev = None
        for chunk in item['chunks']:
            for point in chunk:
                if not (isinstance(point, (list, tuple)) and len(point) == 2):
                    continue
                lat, lon = float(point[0]), float(point[1])
                if prev is not None:
                    cum_km += haversine(prev, (lat, lon))
                coords_km.append((lat, lon, cum_km))
                prev = (lat, lon)

        leg_distances_km = []
        locs = item['locations']
        for ci in range(len(locs) - 1):
            if ci < len(item['chunks']):
                chunk = item['chunks'][ci]
                d = sum(haversine((chunk[j][0], chunk[j][1]),
                                  (chunk[j+1][0], chunk[j+1][1]))
                        for j in range(len(chunk) - 1))
                leg_distances_km.append(d)
            else:
                leg_distances_km.append(0.0)

        route_km = coords_km[-1][2] if coords_km else 0.0
        sub_info.append({
            'coords_km': coords_km,
            'leg_distances_km': leg_distances_km,
            'city_names': item['city_names'],
            'city_temps': item.get('city_temps', []),
        })
        total_coords += len(coords_km)

    if total_coords == 0:
        print("[Höhenprofil] Keine Koordinaten gefunden — Abbruch", flush=True)
        return None

    # Derive max_elev_points from total route distance and desired density.
    total_km = sum(
        info['coords_km'][-1][2] for info in sub_info if info['coords_km']
    )
    max_elev_points = max(200, round(total_km * points_per_1000km / 1000))

    print(f"[Höhenprofil] Vorbereitung Schritt 1 — {total_coords} Punkte, "
          f"{total_km:.1f} km, Ziel: {max_elev_points} Höhenpunkte", flush=True)

    # Step 2: Proportional subsampling
    all_sampled_latlon = []
    all_sub_sampled_kms = []
    all_sub_sampled_latlons = []
    sub_sample_counts = []
    for info in sub_info:
        coords_km = info['coords_km']
        n = len(coords_km)
        if n == 0:
            sub_sample_counts.append(0)
            all_sub_sampled_kms.append([])
            all_sub_sampled_latlons.append([])
            continue
        n_alloc = max(2, round(n / total_coords * max_elev_points))
        if n > n_alloc:
            step = n / n_alloc
            indices = [int(i * step) for i in range(n_alloc)]
            indices[-1] = n - 1
        else:
            indices = list(range(n))
        seg_latlons = [(coords_km[idx][0], coords_km[idx][1]) for idx in indices]
        all_sampled_latlon.extend(seg_latlons)
        all_sub_sampled_kms.append([coords_km[idx][2] for idx in indices])
        all_sub_sampled_latlons.append(seg_latlons)
        sub_sample_counts.append(len(indices))

    n_sampled = len(all_sampled_latlon)
    print(f"[Höhenprofil] Vorbereitung Schritt 2 — {n_sampled} Punkte nach Abtastung", flush=True)

    # Build flat_km: absolute km for each point in all_sampled_latlon
    flat_km = []
    km_off = 0.0
    for kms in all_sub_sampled_kms:
        if kms:
            flat_km.extend(km_off + k for k in kms)
            km_off += kms[-1]

    return {
        "sub_info": sub_info,
        "all_sampled_latlon": all_sampled_latlon,
        "sub_sample_counts": sub_sample_counts,
        "all_sub_sampled_kms": all_sub_sampled_kms,
        "all_sub_sampled_latlons": all_sub_sampled_latlons,
        "n_sampled": n_sampled,
        "total_km": total_km,
        "flat_km": flat_km,
    }


def assemble_elevation_profile(api_results, prep):
    """
    Step 4 of build_combined_elevation_profile: assemble the profile from API results.
    api_results: list of {"elevation": float} dicts (may be partial).
    prep: dict returned by prepare_elevation_sampling.
    Returns same dict format as build_combined_elevation_profile, or None.
    """
    sub_info = prep["sub_info"]
    sub_sample_counts = prep["sub_sample_counts"]
    all_sub_sampled_kms = prep["all_sub_sampled_kms"]
    all_sub_sampled_latlons = prep["all_sub_sampled_latlons"]

    combined_profile = []
    combined_latlons = []
    combined_city_marks = []
    combined_city_data = []
    km_offset = 0.0
    result_offset = 0

    for info, count, sampled_kms, seg_latlons in zip(
            sub_info, sub_sample_counts, all_sub_sampled_kms, all_sub_sampled_latlons):
        if count == 0:
            continue
        available = len(api_results) - result_offset
        if available <= 0:
            break
        take = min(count, available)
        sub_results = api_results[result_offset:result_offset + take]
        result_offset += take

        for (slat, slon), km, r in zip(seg_latlons[:take], sampled_kms[:take], sub_results):
            combined_profile.append((km_offset + km, r["elevation"] or 0))
            combined_latlons.append((slat, slon))

        if not combined_profile:
            continue

        # Determine how far we have elevation data
        covered_km = combined_profile[-1][0]

        city_temps_sub = info.get('city_temps', [])
        t0 = city_temps_sub[0] if city_temps_sub else (None, None, None)
        combined_city_marks.append((km_offset, info['city_names'][0]))
        combined_city_data.append({"km": km_offset, "name": info['city_names'][0],
                                   "tmin": t0[0], "tmax": t0[1],
                                   "prcp": t0[2] if len(t0) > 2 else None,
                                   "ele": None})
        cum = 0.0
        for i, d in enumerate(info['leg_distances_km']):
            cum += d
            if i + 1 < len(info['city_names']):
                city_km = km_offset + cum
                # Only include cities within covered elevation data
                if city_km <= covered_km + 1:
                    combined_city_marks.append((city_km, info['city_names'][i + 1]))
                    tp = city_temps_sub[i + 1] if i + 1 < len(city_temps_sub) else (None, None, None)
                    combined_city_data.append({"km": city_km,
                                               "name": info['city_names'][i + 1],
                                               "tmin": tp[0], "tmax": tp[1],
                                               "prcp": tp[2] if len(tp) > 2 else None,
                                               "ele": None})

        km_offset += sampled_kms[-1] if sampled_kms else 0.0

    if not combined_profile:
        return None

    # Fill in city elevations by interpolating from the completed profile
    def _interp_profile_ele(km_target):
        for i in range(len(combined_profile) - 1):
            km0, e0 = combined_profile[i]
            km1, e1 = combined_profile[i + 1]
            if km0 <= km_target <= km1:
                t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
                return e0 + t * (e1 - e0)
        return combined_profile[-1][1]

    for cd in combined_city_data:
        cd["ele"] = _interp_profile_ele(cd["km"])

    max_ele = max((e for _, e in combined_profile), default=0)
    min_ele = min((e for _, e in combined_profile), default=0)
    print(f"[Höhenprofil] Assemblierung — {len(combined_profile)} Profilpunkte, "
          f"{len(combined_city_data)} Städte, "
          f"Höhe: {min_ele:.0f}–{max_ele:.0f} m", flush=True)

    return {"profile": combined_profile, "profile_latlons": combined_latlons,
            "city_marks": combined_city_marks, "city_data": combined_city_data}


def build_combined_elevation_profile(sub_route_data, max_elev_points=None, points_per_1000km=1000):
    """
    Build a combined elevation profile from multiple continuous road sub-routes
    using a single Open-Elevation API call.

    sub_route_data: list of dicts, each with:
        'chunks'     – road_chunks returned by get_osrm_route (no skip_segments)
        'locations'  – [(lat, lon), ...] for this sub-route
        'city_names' – [str, ...] matching locations

    Returns {"profile": [(km, ele_m), ...], "city_marks": [(km, name), ...]}
    or None on failure.

    Key design: cumulative km values come from the full road geometry *before*
    subsampling. This ensures the elevation profile x-axis and the city marker
    x-axis use the exact same distance source and cannot drift apart.
    """
    print(f"[Höhenprofil] Starte Verarbeitung für {len(sub_route_data)} Teilroute(n)", flush=True)

    # Step 1: For each sub-route build a (lat, lon, cum_km) list from the full
    # road geometry and compute leg distances for city markers from the same source.
    sub_info = []
    total_coords = 0
    for item in sub_route_data:
        coords_km = []       # (lat, lon, cum_km)
        cum_km = 0.0
        prev = None
        for chunk in item['chunks']:
            for point in chunk:
                if not (isinstance(point, (list, tuple)) and len(point) == 2):
                    continue
                lat, lon = float(point[0]), float(point[1])
                if prev is not None:
                    cum_km += haversine(prev, (lat, lon))
                coords_km.append((lat, lon, cum_km))
                prev = (lat, lon)

        # Leg distances from the same geometry (used for city marker positions)
        leg_distances_km = []
        locs = item['locations']
        for ci in range(len(locs) - 1):
            if ci < len(item['chunks']):
                chunk = item['chunks'][ci]
                d = sum(haversine((chunk[j][0], chunk[j][1]),
                                  (chunk[j+1][0], chunk[j+1][1]))
                        for j in range(len(chunk) - 1))
                leg_distances_km.append(d)
            else:
                leg_distances_km.append(0.0)

        route_km = coords_km[-1][2] if coords_km else 0.0
        print(f"  Teilroute {len(sub_info)+1}: {len(coords_km)} Rohdatenpunkte, "
              f"{route_km:.1f} km — Städte: {', '.join(item['city_names'])}", flush=True)
        sub_info.append({
            'coords_km': coords_km,
            'leg_distances_km': leg_distances_km,
            'city_names': item['city_names'],
            'city_temps': item.get('city_temps', []),  # [(tmin, tmax), ...] per city
        })
        total_coords += len(coords_km)

    if total_coords == 0:
        print("[Höhenprofil] Keine Koordinaten gefunden — Abbruch", flush=True)
        return None

    # Derive max_elev_points from total route distance and desired density if not set.
    if max_elev_points is None:
        total_km = sum(
            info['coords_km'][-1][2] for info in sub_info if info['coords_km']
        )
        max_elev_points = max(200, round(total_km * points_per_1000km / 1000))

    total_km = sum(info['coords_km'][-1][2] for info in sub_info if info['coords_km'])
    print(f"[Höhenprofil] Schritt 1 fertig — {total_coords} Punkte gesamt, "
          f"{total_km:.1f} km, Ziel: {max_elev_points} Höhenpunkte "
          f"({points_per_1000km}/1000km)", flush=True)

    # Step 2: Proportional subsampling — keep the pre-computed km value for each
    # sampled point so x-positions are derived from geometry, not from the API.
    all_sampled_latlon = []
    all_sub_sampled_kms = []
    all_sub_sampled_latlons = []
    sub_sample_counts = []
    for info in sub_info:
        coords_km = info['coords_km']
        n = len(coords_km)
        if n == 0:
            sub_sample_counts.append(0)
            all_sub_sampled_kms.append([])
            all_sub_sampled_latlons.append([])
            continue
        n_alloc = max(2, round(n / total_coords * max_elev_points))
        if n > n_alloc:
            step = n / n_alloc
            indices = [int(i * step) for i in range(n_alloc)]
            indices[-1] = n - 1
        else:
            indices = list(range(n))
        seg_latlons = [(coords_km[idx][0], coords_km[idx][1]) for idx in indices]
        all_sampled_latlon.extend(seg_latlons)
        all_sub_sampled_kms.append([coords_km[idx][2] for idx in indices])
        all_sub_sampled_latlons.append(seg_latlons)
        sub_sample_counts.append(len(indices))

    n_sampled = len(all_sampled_latlon)
    print(f"[Höhenprofil] Schritt 2 fertig — {n_sampled} Punkte nach Abtastung "
          f"(Reduktion: {total_coords} → {n_sampled})", flush=True)

    # Step 3: Open-Elevation calls (batched to stay within API payload limits)
    import time as _time
    _elev_url, _ELEV_BATCH, _payload_fn = _elev_api(all_sampled_latlon)
    _BATCH_DELAY = 1.1 if _elev_url == OPEN_ELEV_ASTER else 0.0
    _MAX_RETRIES = 4
    _RETRY_DELAYS = [5, 15, 30, 60]   # backoff schedule for 429 / transient errors
    n_batches = (n_sampled + _ELEV_BATCH - 1) // _ELEV_BATCH
    print(f"[Höhenprofil] Schritt 3 — Elevation-Anfrage mit {n_sampled} Koordinaten "
          f"in {n_batches} Batch(es) via {_elev_url.split('/')[2]} …", flush=True)
    all_results = []
    try:
        for batch_idx, b_start in enumerate(range(0, n_sampled, _ELEV_BATCH)):
            if batch_idx > 0:
                _time.sleep(_BATCH_DELAY)
            batch = all_sampled_latlon[b_start:b_start + _ELEV_BATCH]
            for attempt in range(_MAX_RETRIES):
                try:
                    resp = requests.post(_elev_url, json=_payload_fn(batch), timeout=45)
                    resp.raise_for_status()
                    all_results.extend(resp.json()["results"])
                    break
                except Exception as batch_err:
                    is_rate_limit = (
                        hasattr(batch_err, "response")
                        and batch_err.response is not None
                        and batch_err.response.status_code == 429
                    )
                    if attempt < _MAX_RETRIES - 1:
                        wait = _RETRY_DELAYS[attempt]
                        if is_rate_limit:
                            wait = max(wait, 10)  # back off harder on 429
                        print(f"[Höhenprofil] Batch {batch_idx+1}/{n_batches} Fehler "
                              f"(Versuch {attempt+1}/{_MAX_RETRIES}): {batch_err} — "
                              f"warte {wait}s …", flush=True)
                        _time.sleep(wait)
                    else:
                        raise
        print(f"[Höhenprofil] Schritt 3 fertig — {len(all_results)} Höhenwerte empfangen",
              flush=True)
    except Exception as e:
        print(f"[Höhenprofil] Open-Elevation Anfrage fehlgeschlagen: {e}", flush=True)
        return None

    # Step 4: Build combined profile.
    # x-positions come from pre-computed road-geometry km values (no haversine on
    # API results), so profile and city markers share the same distance reference.
    combined_profile = []
    combined_latlons = []
    combined_city_marks = []
    combined_city_data = []   # {km, name, tmin, tmax, ele} — ele filled in after
    km_offset = 0.0
    result_offset = 0

    for info, count, sampled_kms, seg_latlons in zip(
            sub_info, sub_sample_counts, all_sub_sampled_kms, all_sub_sampled_latlons):
        if count == 0:
            continue
        sub_results = all_results[result_offset:result_offset + count]
        result_offset += count

        for (slat, slon), km, r in zip(seg_latlons, sampled_kms, sub_results):
            combined_profile.append((km_offset + km, r["elevation"] or 0))
            combined_latlons.append((slat, slon))

        city_temps_sub = info.get('city_temps', [])
        t0 = city_temps_sub[0] if city_temps_sub else (None, None, None)
        combined_city_marks.append((km_offset, info['city_names'][0]))
        combined_city_data.append({"km": km_offset, "name": info['city_names'][0],
                                   "tmin": t0[0], "tmax": t0[1],
                                   "prcp": t0[2] if len(t0) > 2 else None,
                                   "ele": None})
        cum = 0.0
        for i, d in enumerate(info['leg_distances_km']):
            cum += d
            if i + 1 < len(info['city_names']):
                combined_city_marks.append((km_offset + cum, info['city_names'][i + 1]))
                tp = city_temps_sub[i + 1] if i + 1 < len(city_temps_sub) else (None, None, None)
                combined_city_data.append({"km": km_offset + cum,
                                           "name": info['city_names'][i + 1],
                                           "tmin": tp[0], "tmax": tp[1],
                                           "prcp": tp[2] if len(tp) > 2 else None,
                                           "ele": None})

        km_offset += sampled_kms[-1] if sampled_kms else 0.0

    if not combined_profile:
        return None

    # Fill in city elevations by interpolating from the completed profile
    def _interp_profile_ele(km_target):
        for i in range(len(combined_profile) - 1):
            km0, e0 = combined_profile[i]
            km1, e1 = combined_profile[i + 1]
            if km0 <= km_target <= km1:
                t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
                return e0 + t * (e1 - e0)
        return combined_profile[-1][1]

    for cd in combined_city_data:
        cd["ele"] = _interp_profile_ele(cd["km"])

    max_ele = max((e for _, e in combined_profile), default=0)
    min_ele = min((e for _, e in combined_profile), default=0)
    print(f"[Höhenprofil] Schritt 4 fertig — {len(combined_profile)} Profilpunkte, "
          f"{len(combined_city_data)} Städte, "
          f"Höhe: {min_ele:.0f}–{max_ele:.0f} m", flush=True)

    return {"profile": combined_profile, "profile_latlons": combined_latlons,
            "city_marks": combined_city_marks, "city_data": combined_city_data}


def create_loading_route_map(graph, temperatures, route, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp, warming_factor=0.0):
    """
    Returns compact JSON-serializable city data for the loading page map.
    {"cities": [{lat, lon, name, rel_day, day, color, tmin, tmax}, ...], "center": [lat, lon]}
    """
    start_day = route[0][1] if route else 0

    all_temps_data = []
    for city_id, day, city_name, distance in route:
        try:
            graph.nodes[city_id]  # ensure node exists
            temps = get_interpolated_weather(city_id, day, temperatures, warming_factor)
            temp_score, _ = calculate_temperature_score(
                temps, exp, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp
            )
            all_temps_data.append((city_id, day, city_name, temps, temp_score))
        except KeyError:
            continue

    if not all_temps_data:
        return None

    scores = [d[4] for d in all_temps_data]
    mn, mx = min(scores), max(scores)
    rng = mx - mn if mx > mn else 1

    cities = []
    for city_id, day, city_name, temps, temp_score in all_temps_data:
        try:
            nd = graph.nodes[city_id]
            lat, lon = float(nd['lat']), float(nd['lon'])
            ns = (temp_score - mn) / rng
            if ns < 0.5:
                r = int(ns * 2 * 255); g = 200; b = 50
            else:
                r = 255; g = int((1 - (ns - 0.5) * 2) * 200); b = 50
            cities.append({
                "lat": lat, "lon": lon, "name": city_name,
                "rel_day": day - start_day, "day": day,
                "color": f"rgb({r},{g},{b})",
                "tmin": round(float(temps[0]), 1) if temps[0] is not None else None,
                "tmax": round(float(temps[1]), 1) if temps[1] is not None else None,
            })
        except KeyError:
            continue

    if not cities:
        return None

    center_lat = sum(c["lat"] for c in cities) / len(cities)
    center_lon = sum(c["lon"] for c in cities) / len(cities)
    return {"cities": cities, "center": [center_lat, center_lon]}


def select_forecast_points(profile, latlons, min_spacing_km=15, max_spacing_km=25):
    """Select ~20-40 forecast points at elevation extrema along the route."""
    if not profile or len(profile) < 2 or len(profile) != len(latlons):
        return []

    total_km = profile[-1][0]
    max_spacing_km = max(max_spacing_km, total_km / 40) if total_km > 0 else max_spacing_km

    n = len(profile)
    avg_spacing = total_km / (n - 1) if n > 1 else 1.0
    window = max(3, round(5.0 / avg_spacing)) if avg_spacing > 0 else 3

    mean_ele = sum(e for _, e in profile) / n

    candidates = set()
    for i in range(n):
        lo = max(0, i - window)
        hi = min(n - 1, i + window)
        eles = [profile[j][1] for j in range(lo, hi + 1)]
        e = profile[i][1]
        if e >= max(eles) or e <= min(eles):
            candidates.add(i)
    candidates.add(0)
    candidates.add(n - 1)

    sorted_cands = sorted(candidates, key=lambda i: profile[i][0])

    merged = []
    for idx in sorted_cands:
        if not merged:
            merged.append(idx)
        else:
            prev_km = profile[merged[-1]][0]
            cur_km  = profile[idx][0]
            if cur_km - prev_km < min_spacing_km:
                prev_dev = abs(profile[merged[-1]][1] - mean_ele)
                cur_dev  = abs(profile[idx][1]        - mean_ele)
                if cur_dev > prev_dev:
                    merged[-1] = idx
            else:
                merged.append(idx)

    if not merged or merged[0] != 0:
        merged.insert(0, 0)
    if merged[-1] != n - 1:
        merged.append(n - 1)
    merged = sorted(set(merged), key=lambda i: profile[i][0])

    while True:
        new_merged = [merged[0]]
        gap_found  = False
        for i in range(1, len(merged)):
            km0 = profile[merged[i - 1]][0]
            km1 = profile[merged[i]][0]
            if km1 - km0 > max_spacing_km:
                gap_found = True
                mid_km  = (km0 + km1) / 2.0
                mid_idx = min(range(n), key=lambda j: abs(profile[j][0] - mid_km))
                new_merged.append(mid_idx)
            new_merged.append(merged[i])
        merged = sorted(set(new_merged), key=lambda i: profile[i][0])
        if not gap_found:
            break

    return [
        {
            "km":  round(profile[idx][0], 2),
            "lat": round(latlons[idx][0], 6),
            "lon": round(latlons[idx][1], 6),
            "ele": round(profile[idx][1], 1),
        }
        for idx in merged
    ]


def fetch_open_meteo_forecast(points, on_progress=None):
    """Fetch Open-Meteo forecast for a list of points with target_date."""
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date as _date

    OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
    HOUR_STEPS = [0, 6, 12, 18, 24]

    LAPSE_RATE = 0.0065  # °C per metre (standard environmental lapse rate)

    def fetch_one(args):
        i, pt = args
        try:
            target = pt.get("target_date")
            if not target:
                return i, {"ok": False}
            resp = requests.get(OPEN_METEO, params={
                "latitude":      pt["lat"],
                "longitude":     pt["lon"],
                "hourly":        "temperature_2m,precipitation,windspeed_10m,winddirection_10m,cloudcover,sunshine_duration",
                "daily":         "precipitation_sum,windspeed_10m_max,sunshine_duration,temperature_2m_max,temperature_2m_min",
                "models":        "best_match",
                "forecast_days": 16,
                "timezone":      "auto",
            }, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            # Elevation correction: actual GPS elevation vs. model terrain elevation.
            # Open-Meteo returns "elevation" (model orography) automatically.
            model_ele = data.get("elevation")
            actual_ele = pt.get("ele")
            elev_corr = (actual_ele - model_ele) * LAPSE_RATE if (model_ele is not None and actual_ele is not None) else 0.0

            def _tc(v):
                return round(v - elev_corr, 1) if v is not None else None

            htimes = data.get("hourly", {}).get("time", [])
            htemp  = data.get("hourly", {}).get("temperature_2m", [])
            hprcp  = data.get("hourly", {}).get("precipitation", [])
            hwspd  = data.get("hourly", {}).get("windspeed_10m", [])
            hwdir  = data.get("hourly", {}).get("winddirection_10m", [])
            hcloud = data.get("hourly", {}).get("cloudcover", [])
            hsun   = data.get("hourly", {}).get("sunshine_duration", [])

            dtimes = data.get("daily", {}).get("time", [])
            dprcp  = data.get("daily", {}).get("precipitation_sum", [])
            dwspd  = data.get("daily", {}).get("windspeed_10m_max", [])
            dsun   = data.get("daily", {}).get("sunshine_duration", [])
            dtmax  = data.get("daily", {}).get("temperature_2m_max", [])
            dtmin  = data.get("daily", {}).get("temperature_2m_min", [])

            next_str = (_date.fromisoformat(target) + timedelta(days=1)).isoformat()

            hourly_result = {}
            for h in HOUR_STEPS:
                lookup = f"{next_str}T00:00" if h == 24 else f"{target}T{h:02d}:00"
                if lookup in htimes:
                    idx = htimes.index(lookup)
                    sun_min = round(hsun[idx] / 60.0, 1) if idx < len(hsun) and hsun[idx] is not None else None
                    hourly_result[str(h)] = {
                        "temp":  _tc(htemp[idx]  if idx < len(htemp)  else None),
                        "prcp":  hprcp[idx]  if idx < len(hprcp)  else None,
                        "wspd":  hwspd[idx]  if idx < len(hwspd)  else None,
                        "wdir":  hwdir[idx]  if idx < len(hwdir)  else None,
                        "cloud": hcloud[idx] if idx < len(hcloud) else None,
                        "sun":   sun_min,
                    }

            daily_result = {}
            if target in dtimes:
                di = dtimes.index(target)
                daily_result = {
                    "prcp": dprcp[di] if di < len(dprcp) else None,
                    "wspd": dwspd[di] if di < len(dwspd) else None,
                    "sun":  round(dsun[di] / 3600.0, 2) if di < len(dsun) and dsun[di] is not None else None,
                    "tmax": _tc(dtmax[di] if di < len(dtmax) else None),
                    "tmin": _tc(dtmin[di] if di < len(dtmin) else None),
                }

            return i, {"ok": True, "hourly": hourly_result, "daily": daily_result}
        except Exception as exc:
            print(f"[Forecast] Point {i} failed: {exc}")
            return i, {"ok": False}

    def fetch_one_tracked(args):
        result = fetch_one(args)
        if on_progress:
            on_progress()
        return result

    result = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        for i, data in ex.map(fetch_one_tracked, enumerate(points)):
            result[i] = data
    return result


# ---------------------------------------------------------------------------
# Destination Finder — find best destination regions & beam-search routes
# ---------------------------------------------------------------------------

def find_destination_cities(graph, temperatures, start_city, start_day, max_days, daily_km,
                            desired_low_temp=None, desired_high_temp=None,
                            min_low_temp=float('-inf'), max_low_temp=float('inf'),
                            min_high_temp=float('-inf'), max_high_temp=float('inf'),
                            warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                            count=10):
    """
    Find the best destination cities reachable from start_city in max_days.
    Returns list of (city_id, score, distance) sorted by score (best first).
    Cities are spaced at least max_air_distance/5 apart.
    """
    max_air_distance = max_days * daily_km *0.7
    min_spacing = max_air_distance / 5
    target_day = ((start_day + max_days - 1) % 365) + 1

    start_node = graph.nodes[start_city]
    start_pos = (float(start_node['lat']), float(start_node['lon']))

    # Score all cities within radius
    candidates = []
    for cid in graph.nodes():
        if cid == start_city:
            continue
        if cid not in temperatures:
            continue
        nd = graph.nodes[cid]
        pos = (float(nd['lat']), float(nd['lon']))
        dist = haversine(start_pos, pos)
        if dist > max_air_distance:
            continue

        weather = get_interpolated_weather(cid, target_day, temperatures, warming_factor)
        temp_score, violated = calculate_temperature_score(
            weather, 2, desired_low_temp, desired_high_temp,
            min_low_temp, max_low_temp, min_high_temp, max_high_temp
        )
        if violated:
            continue

        # Composite score including wind/rain
        score = temp_weight * temp_score
        if wind_weight > 0 and len(weather) > 3 and weather[3] is not None:
            wind_score = (weather[3] / WIND_SCALE) ** 2
            score += wind_weight * wind_score
        if rain_weight > 0 and len(weather) > 2 and weather[2] is not None:
            rain_score = (weather[2] / RAIN_SCALE) ** 2
            score += rain_weight * rain_score

        candidates.append((cid, score, dist, pos))

    # Sort by score (lower = better)
    candidates.sort(key=lambda x: x[1])

    # Select top cities with minimum spacing
    selected = []
    for cid, score, dist, pos in candidates:
        too_close = False
        for _, _, _, sel_pos in selected:
            if haversine(pos, sel_pos) < min_spacing:
                too_close = True
                break
        if not too_close:
            selected.append((cid, score, dist, pos))
            if len(selected) >= count:
                break

    return [(cid, score, dist) for cid, score, dist, _ in selected]


def _bearing_continuity_penalty(route_cities, candidate_pos, graph):
    """
    Calculate penalty for deviating from the travel direction of the last 3 cities.
    Returns value 0..1 (0 = same direction, 1 = reverse).
    """
    if len(route_cities) < 2:
        return 0.0

    # Get positions of last few cities
    positions = []
    for cid in route_cities[-3:]:
        nd = graph.nodes[cid]
        positions.append((float(nd['lat']), float(nd['lon'])))

    # Average bearing from recent travel
    bearings = []
    for i in range(len(positions) - 1):
        b = calculate_bearing(positions[i][0], positions[i][1],
                              positions[i + 1][0], positions[i + 1][1])
        bearings.append(b)

    # Circular weighted mean (handles 0°/360° wraparound correctly)
    from math import sin, cos, atan2, degrees, radians
    if len(bearings) == 1:
        avg_bearing = bearings[0]
    else:
        w1, w2 = 0.7, 0.3
        sin_val = sin(radians(bearings[-1])) * w1 + sin(radians(bearings[-2])) * w2
        cos_val = cos(radians(bearings[-1])) * w1 + cos(radians(bearings[-2])) * w2
        avg_bearing = degrees(atan2(sin_val, cos_val)) % 360

    # Bearing to candidate
    last_pos = positions[-1]
    new_bearing = calculate_bearing(last_pos[0], last_pos[1],
                                     candidate_pos[0], candidate_pos[1])

    deviation = angle_difference(avg_bearing, new_bearing)
    return (deviation / 180.0) ** 1.5


def beam_search_route(graph, temperatures, start_city, start_day, max_days, daily_km,
                      destination_cities, desired_low_temp=None, desired_high_temp=None,
                      min_low_temp=float('-inf'), max_low_temp=float('inf'),
                      min_high_temp=float('-inf'), max_high_temp=float('inf'),
                      warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                      direction_weight=0.3, continuity_weight=2,
                      revisit_weight=1.0,
                      initial_beam_width=20, final_beam_width=5,
                      on_progress=None):
    """
    Beam-search route from start_city guided by destination_cities.
    Returns list of top routes, each: {'cities': [(city_id, day)], 'score': float}
    """
    # Precompute destination positions
    dest_positions = []
    for cid, _score, _dist in destination_cities:
        nd = graph.nodes[cid]
        dest_positions.append((cid, float(nd['lat']), float(nd['lon'])))

    # Each beam: {'cities': [city_id, ...], 'days': [day, ...], 'scores': [score, ...]}
    beams = [{
        'cities': [start_city],
        'days': [start_day],
        'scores': [],
        'total_score': 0.0,
    }]

    # Duplicate initial beam
    beams = [dict(b) for b in beams] * initial_beam_width
    # Make independent copies
    beams = [{'cities': list(b['cities']), 'days': list(b['days']),
              'scores': list(b['scores']), 'total_score': 0.0} for b in beams]

    city_coords_cache = {}
    def get_coords(cid):
        if cid not in city_coords_cache:
            nd = graph.nodes[cid]
            city_coords_cache[cid] = (float(nd['lat']), float(nd['lon']))
        return city_coords_cache[cid]

    def _weather_score(city_id, arrival_day):
        """Compute normalised weather score for a city at a given (fractional) day."""
        doy = (int(arrival_day) % 365) + 1
        weather = get_interpolated_weather(city_id, doy, temperatures, warming_factor)
        temp_score, violated = calculate_temperature_score(
            weather, 2, desired_low_temp, desired_high_temp,
            min_low_temp, max_low_temp, min_high_temp, max_high_temp
        )
        if violated:
            return float('inf'), True
        w = temp_weight * (temp_score / TEMP_SCORE_REF)
        if wind_weight > 0 and len(weather) > 3 and weather[3] is not None:
            w += wind_weight * ((weather[3] / WIND_SCALE) ** 2 / WIND_SCORE_REF)
        if rain_weight > 0 and len(weather) > 2 and weather[2] is not None:
            w += rain_weight * ((weather[2] / RAIN_SCALE) ** 2 / RAIN_SCORE_REF)
        return w, False

    def score_candidate(candidate_id, current_day, beam, is_2hop=False, via_id=None):
        """Score a candidate city. Returns (score, via_city_or_None).

        current_day is the actual (fractional) day when leaving the current city.
        Edge distances are used to compute arrival days and to weight the weather
        scores of intermediate and final cities proportionally to segment length.
        """
        if candidate_id not in temperatures:
            return float('inf'), None

        current_city = beam['cities'][-1]

        if is_2hop and via_id:
            if via_id not in temperatures:
                return float('inf'), None
            edge_1 = graph.get_edge_data(current_city, via_id)
            edge_2 = graph.get_edge_data(via_id, candidate_id)
            if edge_1 is None or edge_2 is None:
                return float('inf'), None
            dist_1 = edge_1['weight']
            dist_2 = edge_2['weight']
            total_dist = dist_1 + dist_2
            w1 = dist_1 / total_dist if total_dist > 0 else 0.5
            w2 = dist_2 / total_dist if total_dist > 0 else 0.5

            day_via  = current_day + dist_1 / daily_km
            day_cand = current_day + total_dist / daily_km

            ws_via,  v1 = _weather_score(via_id,       day_via)
            ws_cand, v2 = _weather_score(candidate_id, day_cand)
            if v1 or v2:
                return float('inf'), None

            w_score     = w1 * ws_via + w2 * ws_cand
            arrival_day = day_cand
        else:
            edge = graph.get_edge_data(current_city, candidate_id)
            dist = edge['weight'] if edge else 0
            arrival_day = current_day + dist / daily_km

            w_score, violated = _weather_score(candidate_id, arrival_day)
            if violated:
                return float('inf'), None

        # Direction penalty — distance to nearest destination
        cand_pos = get_coords(candidate_id)
        remaining_days = max_days - (arrival_day - start_day)
        if remaining_days > 0:
            remaining_air = remaining_days * daily_km * 0.7
            min_dest_dist = float('inf')
            for _, dlat, dlon in dest_positions:
                d = haversine(cand_pos, (dlat, dlon))
                if d < min_dest_dist:
                    min_dest_dist = d
            if min_dest_dist > remaining_air and remaining_air > 0:
                overshoot = min_dest_dist / remaining_air
                dir_penalty = overshoot ** 2
            else:
                dir_penalty = 0.0
        else:
            dir_penalty = 0.0

        # Continuity penalty
        cont_penalty = _bearing_continuity_penalty(beam['cities'], cand_pos, graph)
        best_cont = cont_penalty
        if is_2hop and via_id:
            via_pos = get_coords(via_id)
            cont_via = _bearing_continuity_penalty(beam['cities'], via_pos, graph)
            best_cont = min(cont_penalty, cont_via)

        # Proximity penalty — penalise coming close to older visited cities (excluding last 5)
        prox_penalty = 0.0
        if revisit_weight > 0:
            older_cities = beam['cities'][:-5] if len(beam['cities']) > 5 else []
            if older_cities:
                min_dist = min(haversine(cand_pos, get_coords(c)) for c in older_cities)
                if min_dist < 500:
                    prox_penalty = (1.0 - min_dist / 500.0) ** 2
                if is_2hop and via_id:
                    via_pos_p = get_coords(via_id)
                    min_dist_via = min(haversine(via_pos_p, get_coords(c)) for c in older_cities)
                    if min_dist_via < 500:
                        prox_penalty = max(prox_penalty, (1.0 - min_dist_via / 500.0) ** 2)

        total = w_score + direction_weight * dir_penalty + continuity_weight * best_cont + revisit_weight * prox_penalty
        return total, via_id

    for step in range(max_days):
        current_day_offset = step + 1
        progress = step / max(1, max_days - 1)
        current_beam_width = max(final_beam_width,
                                  int(initial_beam_width - progress * (initial_beam_width - final_beam_width)))

        all_expansions = []

        for beam_idx, beam in enumerate(beams):
            current_city = beam['cities'][-1]
            current_day  = beam['days'][-1]  # actual fractional day at current city

            # Skip if beam has used up all available days
            if current_day - start_day >= max_days:
                all_expansions.append((beam['total_score'], beam, None, None, False))
                continue

            visited = set(beam['cities'][-5:])  # avoid very recent revisits

            best_candidates = []

            # 1-hop neighbors
            for neighbor in graph.neighbors(current_city):
                if neighbor in visited:
                    continue
                score, _ = score_candidate(neighbor, current_day, beam)
                if score < float('inf'):
                    best_candidates.append((score, neighbor, False, None))

            # 2-hop neighbors
            for neighbor1 in graph.neighbors(current_city):
                if neighbor1 in visited:
                    continue
                for neighbor2 in graph.neighbors(neighbor1):
                    if neighbor2 in visited or neighbor2 == current_city:
                        continue
                    score, _ = score_candidate(neighbor2, current_day, beam,
                                                is_2hop=True, via_id=neighbor1)
                    if score < float('inf'):
                        best_candidates.append((score, neighbor2, True, neighbor1))

            # Take best candidates for this beam
            best_candidates.sort(key=lambda x: x[0])
            for score, cand_city, is_2hop, via_city in best_candidates[:3]:
                new_beam = {
                    'cities': list(beam['cities']),
                    'days': list(beam['days']),
                    'scores': list(beam['scores']),
                    'total_score': 0.0,
                }
                if is_2hop and via_city:
                    edge_1 = graph.get_edge_data(current_city, via_city)
                    edge_2 = graph.get_edge_data(via_city, cand_city)
                    dist_1 = edge_1['weight'] if edge_1 else 0
                    dist_2 = edge_2['weight'] if edge_2 else 0
                    day_via  = current_day + dist_1 / daily_km
                    day_cand = current_day + (dist_1 + dist_2) / daily_km

                    new_beam['cities'].append(via_city)
                    new_beam['days'].append(day_via)
                    via_score, _ = score_candidate(via_city, current_day, beam)
                    if via_score == float('inf'):
                        via_score = score  # fallback
                    new_beam['scores'].append(via_score)
                    new_beam['cities'].append(cand_city)
                    new_beam['days'].append(day_cand)
                    new_beam['scores'].append(score)
                else:
                    edge = graph.get_edge_data(current_city, cand_city)
                    dist = edge['weight'] if edge else 0
                    day_cand = current_day + dist / daily_km
                    new_beam['cities'].append(cand_city)
                    new_beam['days'].append(day_cand)
                    new_beam['scores'].append(score)

                # Recalculate average score
                if new_beam['scores']:
                    new_beam['total_score'] = sum(new_beam['scores']) / len(new_beam['scores'])

                all_expansions.append((new_beam['total_score'], new_beam, cand_city, via_city, is_2hop))

        if not all_expansions:
            break

        # Sort by total score and keep best beams
        all_expansions.sort(key=lambda x: x[0])

        # Deduplicate: don't keep beams ending at same city
        seen_endings = set()
        new_beams = []
        for total_score, beam, _, _, _ in all_expansions:
            end_city = beam['cities'][-1]
            if end_city not in seen_endings:
                seen_endings.add(end_city)
                new_beams.append(beam)
                if len(new_beams) >= current_beam_width:
                    break

        if not new_beams:
            break

        beams = new_beams

        # Handle 2-hop step consuming 2 days
        # Some beams may have advanced 2 days, adjust step count
        if on_progress:
            on_progress(step, max_days)

    # Return top routes
    beams.sort(key=lambda b: b['total_score'])
    results = []
    for beam in beams[:final_beam_width]:
        route = list(zip(beam['cities'], beam['days']))
        results.append({
            'cities': route,
            'score': beam['total_score'],
        })
    return results


def find_destination_route(graph, temperatures, start_city, start_day, max_days, daily_km,
                           desired_low_temp=None, desired_high_temp=None,
                           min_low_temp=float('-inf'), max_low_temp=float('inf'),
                           min_high_temp=float('-inf'), max_high_temp=float('inf'),
                           warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                           direction_weight=0.3, continuity_weight=2,
                           revisit_weight=1.0,
                           blocked_countries=None, city_ids_by_country=None,
                           on_progress=None):
    """
    Main entry point: find destinations + beam-search routes.
    Returns (destination_cities, routes) where routes is list of route dicts.
    """
    work_graph = graph.copy()
    if blocked_countries and city_ids_by_country:
        work_graph = remove_nodes_for_blocked_countries(work_graph, blocked_countries, city_ids_by_country)

    if start_city not in work_graph.nodes:
        return [], []

    destinations = find_destination_cities(
        work_graph, temperatures, start_city, start_day, max_days, daily_km,
        desired_low_temp, desired_high_temp,
        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
        warming_factor, temp_weight, wind_weight, rain_weight,
    )

    if not destinations:
        return [], []

    routes = beam_search_route(
        work_graph, temperatures, start_city, start_day, max_days, daily_km,
        destinations, desired_low_temp, desired_high_temp,
        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
        warming_factor, temp_weight, wind_weight, rain_weight,
        direction_weight, continuity_weight,
        revisit_weight,
        on_progress=on_progress,
    )

    return destinations, routes


# ---------------------------------------------------------------------------
# Hierarchical Waypoint Search — divide-and-conquer route planning
# ---------------------------------------------------------------------------

def _find_waypoint_cities(graph, temperatures, from_city, from_day, to_city, to_day,
                          daily_km, desired_low_temp=None, desired_high_temp=None,
                          min_low_temp=float('-inf'), max_low_temp=float('inf'),
                          min_high_temp=float('-inf'), max_high_temp=float('inf'),
                          warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                          count=2):
    """
    Find the best 'count' waypoint cities for the midpoint of a route segment.

    The midpoint must have air distance to both from_city and to_city between 50%
    and 70% of segment_days * daily_km (where segment_days = (to_day - from_day) / 2),
    and the best weather score for the middle day.

    Returns list of (city_id, score, pos) sorted by score (best first).
    """
    from_node = graph.nodes[from_city]
    to_node = graph.nodes[to_city]
    from_pos = (float(from_node['lat']), float(from_node['lon']))
    to_pos = (float(to_node['lat']), float(to_node['lon']))

    segment_dist = haversine(from_pos, to_pos)
    if segment_dist < 1.0:
        return []

    segment_days = (to_day - from_day) / 2.0
    travelable = segment_days * daily_km
    min_dist = 0.5 * travelable
    max_dist = 0.7 * travelable

    candidates = []
    for cid in graph.nodes():
        if cid == from_city or cid == to_city:
            continue
        if cid not in temperatures:
            continue
        nd = graph.nodes[cid]
        pos = (float(nd['lat']), float(nd['lon']))
        dist_from = haversine(from_pos, pos)
        dist_to = haversine(to_pos, pos)

        if dist_from < min_dist or dist_from > max_dist:
            continue
        if dist_to < min_dist or dist_to > max_dist:
            continue

        denom = dist_from + dist_to
        dist_ratio = dist_from / denom if denom > 0 else 0.5
        mid_day_C = from_day + dist_ratio * (to_day - from_day)
        target_day = ((int(mid_day_C) - 1) % 365) + 1

        weather = get_interpolated_weather(cid, target_day, temperatures, warming_factor)
        temp_score, violated = calculate_temperature_score(
            weather, 2, desired_low_temp, desired_high_temp,
            min_low_temp, max_low_temp, min_high_temp, max_high_temp
        )
        if violated:
            continue

        score = temp_weight * (temp_score / TEMP_SCORE_REF)
        if wind_weight > 0 and len(weather) > 3 and weather[3] is not None:
            score += wind_weight * ((weather[3] / WIND_SCALE) ** 2 / WIND_SCORE_REF)
        if rain_weight > 0 and len(weather) > 2 and weather[2] is not None:
            score += rain_weight * ((weather[2] / RAIN_SCALE) ** 2 / RAIN_SCORE_REF)

        candidates.append((cid, score, pos))

    if not candidates:
        return []

    candidates.sort(key=lambda x: x[1])

    # Select with minimum spacing to ensure geographic diversity
    min_spacing = segment_dist / 5
    selected = []
    for cid, score, pos in candidates:
        too_close = any(haversine(pos, s_pos) < min_spacing for _, _, s_pos in selected)
        if not too_close:
            selected.append((cid, score, pos))
            if len(selected) >= count:
                break

    return selected


def _score_waypoint_combo(combo, temperatures, desired_low_temp, desired_high_temp,
                          min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                          warming_factor, temp_weight, wind_weight, rain_weight):
    """Score a waypoint combination (lower = better). Skips start city."""
    total = 0.0
    for cid, day in combo[1:]:
        target_day = ((int(day) - 1) % 365) + 1
        weather = get_interpolated_weather(cid, target_day, temperatures, warming_factor)
        temp_score, _ = calculate_temperature_score(
            weather, 2, desired_low_temp, desired_high_temp,
            min_low_temp, max_low_temp, min_high_temp, max_high_temp
        )
        total += temp_weight * (temp_score / TEMP_SCORE_REF)
        if wind_weight > 0 and len(weather) > 3 and weather[3] is not None:
            total += wind_weight * ((weather[3] / WIND_SCALE) ** 2 / WIND_SCORE_REF)
        if rain_weight > 0 and len(weather) > 2 and weather[2] is not None:
            total += rain_weight * ((weather[2] / RAIN_SCALE) ** 2 / RAIN_SCORE_REF)
    return total


def _expand_combination(combo, graph, temperatures, daily_km,
                        desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                        warming_factor, temp_weight, wind_weight, rain_weight,
                        min_segment_days=10):
    """
    Expand a combination by finding midpoints for all long segments.

    For each segment with day_gap >= min_segment_days, finds up to 2 midpoint cities.
    Returns all new combos as a cartesian product of midpoint choices per segment.
    """
    # Collect midpoint options per segment
    segments_midpoints = []
    for i in range(len(combo) - 1):
        from_city, from_day = combo[i]
        to_city, to_day = combo[i + 1]

        if (to_day - from_day) >= min_segment_days:
            from_node = graph.nodes[from_city]
            to_node = graph.nodes[to_city]
            from_pos = (float(from_node['lat']), float(from_node['lon']))
            to_pos = (float(to_node['lat']), float(to_node['lon']))
            midpoints = _find_waypoint_cities(
                graph, temperatures, from_city, from_day, to_city, to_day,
                daily_km, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                warming_factor, temp_weight, wind_weight, rain_weight, count=2
            )
            opts = []
            for cid, _, mid_pos in midpoints:
                d_from = haversine(from_pos, mid_pos)
                d_to = haversine(to_pos, mid_pos)
                denom = d_from + d_to
                dist_ratio = d_from / denom if denom > 0 else 0.5
                mid_day = from_day + dist_ratio * (to_day - from_day)
                opts.append((cid, mid_day))
        else:
            opts = []
        segments_midpoints.append(opts)

    # Build expanded combos iteratively (cartesian product of segment choices)
    expanded = [[combo[0]]]
    for i, opts in enumerate(segments_midpoints):
        to_wp = combo[i + 1]
        new_expanded = []
        if opts:
            for partial in expanded:
                for mid_wp in opts:
                    new_expanded.append(partial + [mid_wp, to_wp])
        else:
            for partial in expanded:
                new_expanded.append(partial + [to_wp])
        expanded = new_expanded

    return expanded


def hierarchical_waypoint_route(graph, temperatures, start_city, start_day, max_days, daily_km,
                                destination_cities,
                                desired_low_temp=None, desired_high_temp=None,
                                min_low_temp=float('-inf'), max_low_temp=float('inf'),
                                min_high_temp=float('-inf'), max_high_temp=float('inf'),
                                warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                                min_segment_days=10, top_k=10,
                                on_progress=None):
    """
    Hierarchical waypoint search.

    1. Initialises one combination per destination city
    2. Iteratively inserts midpoint cities for each long segment (day_gap >= min_segment_days)
       - Each segment gets up to 2 candidate midpoints
       - All cartesian products are scored; best top_k kept
    3. Once all segments are short, uses Hybrid A* (optimized_travel_planner) to
       build actual graph paths between consecutive waypoints
    4. Returns top 5 routes sorted by average weather score
    """
    # Initial combinations: start → each destination
    # Compute realistic travel days for each destination from its air distance.
    # find_destination_cities uses max_air_distance = max_days*daily_km*0.7.
    # Estimate actual road days as dist/(0.7*daily_km).
    combinations = []
    for cid, _score, dist in destination_cities:
        realistic_days = dist / (0.7 * daily_km)
        travel_days = min(float(max_days), realistic_days)
        end_day = float(start_day) + travel_days
        combinations.append([(start_city, float(start_day)), (cid, end_day)])

    # Iteratively refine until all segments are short
    iteration = 0
    while True:
        any_long = any(
            (to_day - from_day) >= min_segment_days
            for combo in combinations
            for (_f, from_day), (_t, to_day) in zip(combo, combo[1:])
        )
        if not any_long:
            break

        if on_progress:
            on_progress(iteration, iteration + 2)

        before_keys = {tuple(cid for cid, _ in combo) for combo in combinations}

        new_combos = []
        for combo in combinations:
            expanded = _expand_combination(
                combo, graph, temperatures, daily_km,
                desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                warming_factor, temp_weight, wind_weight, rain_weight,
                min_segment_days
            )
            new_combos.extend(expanded)

        # Deduplicate by city sequence
        seen = set()
        unique = []
        for combo in new_combos:
            key = tuple(cid for cid, _ in combo)
            if key not in seen:
                seen.add(key)
                unique.append(combo)

        after_keys = {tuple(cid for cid, _ in combo) for combo in unique}
        if after_keys == before_keys:
            # No midpoints found for any long segment — cannot refine further
            break

        # Score and keep best top_k
        scored = sorted(
            ((_score_waypoint_combo(
                combo, temperatures,
                desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                warming_factor, temp_weight, wind_weight, rain_weight
            ), combo) for combo in unique),
            key=lambda x: x[0]
        )
        combinations = [combo for _, combo in scored[:top_k]]
        iteration += 1

    if on_progress:
        on_progress(iteration, iteration + 1)

    # Build actual graph routes with Hybrid A*
    routes = []
    for combo in combinations:
        try:
            full_path = []
            current_day = float(start_day)
            interpol_tt = None
            spatial_i_tt = None

            for i in range(len(combo) - 1):
                from_city_id, from_day = combo[i]
                to_city_id, to_day = combo[i + 1]
                expected_days = max(1.0, to_day - from_day)

                try:
                    seg_path, _seg_score, interpol_tt, spatial_i_tt = optimized_travel_planner(
                        graph, from_city_id, to_city_id, current_day, temperatures,
                        daily_km, expected_days,
                        desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                        temp_weight=temp_weight, warming_factor=warming_factor,
                        distance_weight=0.85,
                        interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt
                    )
                except Exception:
                    seg_path = nx.shortest_path(
                        graph, from_city_id, to_city_id, weight='weight'
                    )

                if not full_path:
                    full_path.extend(seg_path)
                else:
                    full_path.extend(seg_path[1:])

                current_day += expected_days

            # Assign days to each city in path
            route_cities = []
            day = float(start_day)
            for j, cid in enumerate(full_path):
                route_cities.append((cid, day))
                if j < len(full_path) - 1:
                    edge = graph.get_edge_data(cid, full_path[j + 1])
                    if edge:
                        day += edge['weight'] / daily_km

            score = _score_waypoint_combo(
                route_cities, temperatures,
                desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                warming_factor, temp_weight, wind_weight, rain_weight
            ) / max(1, len(route_cities) - 1)

            routes.append({'cities': route_cities, 'score': score})

        except Exception:
            continue

    routes.sort(key=lambda x: x['score'])
    return routes[:5]


def find_destination_route_hierarchical(graph, temperatures, start_city, start_day, max_days, daily_km,
                                       desired_low_temp=None, desired_high_temp=None,
                                       min_low_temp=float('-inf'), max_low_temp=float('inf'),
                                       min_high_temp=float('-inf'), max_high_temp=float('inf'),
                                       warming_factor=0.0, temp_weight=1.0, wind_weight=0.0, rain_weight=0.0,
                                       blocked_countries=None, city_ids_by_country=None,
                                       on_progress=None):
    """
    Hierarchical waypoint destination route finder.
    Finds 10 destination cities, then refines routes via divide-and-conquer waypoint search.
    Returns (destination_cities, routes).
    """
    work_graph = graph.copy()
    if blocked_countries and city_ids_by_country:
        work_graph = remove_nodes_for_blocked_countries(work_graph, blocked_countries, city_ids_by_country)

    if start_city not in work_graph.nodes:
        return [], []

    destinations = find_destination_cities(
        work_graph, temperatures, start_city, start_day, max_days, daily_km,
        desired_low_temp, desired_high_temp,
        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
        warming_factor, temp_weight, wind_weight, rain_weight,
    )

    if not destinations:
        return [], []

    # Keep only destinations on the same supercontinent as start city.
    # Americas: lon < -30;  Afrika-Eurasia-Australien: lon >= -30
    start_lon = float(work_graph.nodes[start_city]['lon'])
    start_in_americas = start_lon < -30.0
    destinations = [
        (cid, score, dist) for cid, score, dist in destinations
        if (float(work_graph.nodes[cid]['lon']) < -30.0) == start_in_americas
    ]

    if not destinations:
        return [], []

    routes = hierarchical_waypoint_route(
        work_graph, temperatures, start_city, start_day, max_days, daily_km,
        destinations, desired_low_temp, desired_high_temp,
        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
        warming_factor, temp_weight, wind_weight, rain_weight,
        on_progress=on_progress,
    )

    return destinations, routes
