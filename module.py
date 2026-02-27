# Helper function to convert day-of-year to month
import networkx as nx
import json
import heapq
import folium
import folium.plugins
from datetime import datetime, timedelta
import math
from collections import deque, Counter
import requests
import polyline as polyline_codec
from math import radians, sin, cos, sqrt, atan2, ceil
from datetime import datetime, timedelta
from itertools import permutations
import time
import random
from sklearn.cluster import AgglomerativeClustering
import numpy as np

# No API keys needed — both services are free and open
OSRM_BASE     = "https://router.project-osrm.org"
VALHALLA_BASE = "https://valhalla1.openstreetmap.de"
OPEN_ELEV     = "https://api.open-elevation.com/api/v1/lookup"

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

def calc_targets_day_estimates(graph,cities,daily_max_km,temp_weight = 0):
    targets_day_estimates = {}
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
                        # adjust for longer routh due to temperature optimization
                        distance = distance * (1 + 0.3 * temp_weight)
                        travel_days += max(1, ceil(distance / daily_max_km))
    
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


def get_interpolated_temperature(city, day_of_year, temperatures):
    """
    Get temperature interpolated between months based on day of year.
    Returns (low_temp, high_temp) or (None, None) if data missing
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
            return current_month_temps  # Fallback to current month if adjacent unavailable
            
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
            return current_month_temps  # Fallback to current month if adjacent unavailable
            
        # Calculate interpolation weight (0 at middle of current month, 1 at middle of next month)
        next_mid_day = days_in_month[next_month-1] // 2
        total_days = (days_in_month[month-1] - mid_month_day) + next_mid_day
        days_from_current_mid = day - mid_month_day
        weight = 1 - (days_from_current_mid / total_days)
    
    # Interpolate temperatures - fixed to use current_month_temps instead of current_temps
    low_temp = current_month_temps[0] * weight + adjacent_temps[0] * (1 - weight)
    high_temp = current_month_temps[1] * weight + adjacent_temps[1] * (1 - weight)
    
    return low_temp, high_temp

def get_interpolated_weather(city, day_of_year, temperatures):
    """
    Get temperature interpolated between months based on day of year.
    Returns (low_temp, high_temp) or (None, None) if data missing
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
                                    interpol_tt=None, spatial_i_tt=None):
    """
    Calculate temperature scores for each day of travel between cities.
    Uses both temporal (between months) and spatial (between cities) interpolation.
    Returns (average_score, violated_constraints)
    """
    daily_scores = []
    violations = 0
    
    # Get interpolated temperatures for both cities for start and end day
    start_time = time.time()
    from_temps = get_interpolated_temperature(from_city, start_day, temperatures)
    to_temps = get_interpolated_temperature(to_city, start_day+travel_days, temperatures)
    if interpol_tt is not None:
        interpol_tt += time.time() - start_time   
    
    start_time = time.time()
    for day_offset in range(travel_days):
        
        if None in from_temps or None in to_temps:
            return float('inf'), True, interpol_tt, spatial_i_tt
        
        # Spatially interpolate between cities based on progress
        progress = (day_offset + 1) / travel_days
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
    if spatial_i_tt is not None:
        spatial_i_tt += time.time() - start_time  
        
    if not daily_scores:
        return float('inf'), violations > 0, interpol_tt, spatial_i_tt
    
    return sum(daily_scores) / len(daily_scores), violations > 0, interpol_tt, spatial_i_tt

# The rest of the custom_shortest_path_with_averaging function remains the same

def optimized_travel_planner(G, source, target, current_day, temperatures,
                            daily_max_km, expected_travel_days,
                            desired_low_temp, desired_high_temp,
                            min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                            temp_weight=0.5, exp=2, time_penalty_weight=0.3,
                            heuristic_weight=2,
                            interpol_tt=None, spatial_i_tt=None):
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
            edge_days = ceil(distance / daily_max_km)
            new_acc_days = acc_days + edge_days

            (temp_score, violated, interpol_tt, spatial_i_tt) = \
                calculate_daily_temperature_scores(
                    current_node, neighbor, current_day + acc_days, edge_days,
                    temperatures, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                    interpol_tt, spatial_i_tt
                )

            if violated:
                continue

            new_temp_sum = temp_sum + temp_score * edge_days
            avg_temp = new_temp_sum / new_acc_days if new_acc_days > 0 else 0

            temp_component = temp_weight * avg_temp
            time_component = (1 - temp_weight) * new_acc_days
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

def calculate_path_score(G,route, connections_dict, start_day, temperatures, desired_low_temp, desired_high_temp,
           min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, daily_max_km, max_days, exp=2, 
           interpol_tt=None, spatial_i_tt=None):
    """
    Cluster-compatible score calculation.
    """
    temp_sum = 0
    total_score = 0
    total_days = 0
    violations = 0
    current_day = start_day
    
    
    for i in range(len(route) - 1):
        from_city, to_city = route[i], route[i + 1]
        if connections_dict.get(from_city) == to_city:
            distance = 0
            edge_days = 1
        else:
            edge_data = G.get_edge_data(from_city, to_city)
            distance = edge_data['weight']
            edge_days = ceil(distance / daily_max_km)

        if temp_weight > 0 or max_high_temp < float('inf') or max_low_temp < float('inf') or min_high_temp > float('-inf') or min_low_temp > float('-inf'):
            (temp_score, violated, interpol_tt, spatial_i_tt) = \
                calculate_daily_temperature_scores(
                    from_city, to_city, current_day + total_days, edge_days,
                    temperatures, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                    interpol_tt, spatial_i_tt
                )

            if violated:
                violations += 1

            temp_sum += temp_score * edge_days

            
        total_days += edge_days
        
        if total_days > max_days:
            return float('inf'), float('inf'), interpol_tt, spatial_i_tt
        
    
    temp_score = temp_sum / total_days if total_days > 0 else 0
    end_score = 3 * temp_score* temp_weight + (1 - temp_weight) * total_days + 100 * violations
    if math.isnan(end_score):
        print("score is nan")
    return end_score, total_days, interpol_tt, spatial_i_tt

# ---------------------- Modified Route Calculation ----------------------
def calculate_route_score(route, current_day, targets_day_estimates, temperatures, desired_low_temp, desired_high_temp,
           min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp=2, 
           interpol_tt=None, spatial_i_tt=None,
           city_to_cluster=None, cluster_info=None):
    """
    Cluster-compatible score calculation.
    """
    total_score = 0
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
            total_score += 1000
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

        travel_days = ceil(travel_days)
        if temp_weight > 0 or max_high_temp < float('inf') or max_low_temp < float('inf') or min_high_temp > float('-inf') or min_low_temp > float('-inf'):
            temp_score, violated, interpol_tt, spatial_i_tt = calculate_daily_temperature_scores(
                from_city, to_city, current_day + total_days, travel_days, temperatures, exp, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp, interpol_tt, spatial_i_tt
            )

            if temp_weight >0:
                total_score += temp_score * temp_weight
            if violated:
                violations += 1
            
        total_days += travel_days
        days_track.append(travel_days)
        
        if total_days > max_days:
            return float('inf'), float('inf'), days_track, interpol_tt, spatial_i_tt
    
    end_score = 3*total_score/(len(route)-1) + (1 - temp_weight) * total_days + 100 * violations
    if math.isnan(end_score):
        print("score is nan")
    return end_score, total_days, days_track, interpol_tt, spatial_i_tt

# ---------------------- Modified Nearest Neighbor ----------------------
def nearest_neighbor_with_random(start, target_cities, connections_dict, targets_day_estimates, city_names, max_days, start_day, temperatures, 
                                desired_low_temp, desired_high_temp, min_low_temp, max_low_temp, min_high_temp, 
                                max_high_temp, temp_weight, sun_weight, wind_weight, randomization=0, exp=2, 
                                interpol_tt=None, spatial_i_tt=None,
                                city_to_cluster=None, cluster_info=None):
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
                        max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp, interpol_tt, 
                        spatial_i_tt, city_to_cluster, cluster_info
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
                 min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp = 2, interpol_tt = None, spatial_i_tt = None,
                 city_to_cluster=None, cluster_info=None):
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
       desired_high_temp, min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp, 
       interpol_tt, spatial_i_tt, city_to_cluster, cluster_info
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
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp, interpol_tt, spatial_i_tt,
                        city_to_cluster, cluster_info
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
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight, max_days, exp, interpol_tt, spatial_i_tt,
                        city_to_cluster, cluster_info
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
                     interpol_tt = None, spatial_i_tt = None):
    """
    Solves TSP for cluster cities with optional entry/exit constraints.
    Uses your existing algorithm with temp_weight=0 sun_weight=0 and wind_weight=0.
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
                sun_weight=0,
                wind_weight=0,
                randomization=0.1,
                exp=exp
            )
        
            if route:
                improved_route, score, _, gtt, stt = improve_route(
                    route, {}, 0, targets_day_estimates, temperatures,
                    desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                    min_high_temp, max_high_temp, 0, 0, 0, max_days, exp,
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
                    0, 0, 0, max_days, exp, interpol_tt, spatial_i_tt
                )

                heapq.heappush(routes, (score, improved_route, days))
        
                
    routes.sort()
    
    if routes[0][0] < float('inf'):
        return routes[0][1], routes[0][2]
    else:
        return [], float('inf')

def dynamic_cluster_cities(cities, city_coords, temperatures, targets_day_estimates, 
                            current_day, desired_low_temp, desired_high_temp, temp_weight,
                            auto_threshold_percentile=25):
    """
    Dynamically cluster cities using adaptive threshold based on:
    - Combined geographic/temperature distance
    - Automatic threshold calculation
    - Single-city clusters for outliers
    """
    
    # 1. Calculate normalized combined distance matrix
    combined_dist = create_combined_distance_matrix(
        cities, city_coords, temperatures, targets_day_estimates, current_day,
        desired_low_temp, desired_high_temp, temp_weight
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
                                   desired_low_temp, desired_high_temp, temp_weight):
    """
    Enhanced distance matrix with automatic normalization:
    - Geographic distances normalized to [0,1]
    - Temperature distances normalized to [0,1]
    - Weighted combination based on temp_weight
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
    
    # Normalize geographic distances
    max_day = max(day_values)
    day_dist = day_dist / max_day
    
    # Calculate temperature compatibility scores
    temp_scores = {}
    for city in cities:
        temps = get_interpolated_temperature(city, current_day, temperatures)
        temp_scores[city] = temps[1]
    
    # Normalize temperature differences
    all_scores = list(temp_scores.values())
    max_temp_diff = max(all_scores) - min(all_scores)
    for i, city1 in enumerate(cities):
        for j, city2 in enumerate(cities):
            if i < j:
                temp_dist[i,j] = temp_dist[j,i] = abs(temp_scores[city1] - temp_scores[city2]) / max_temp_diff
                
    #return temp_weight * temp_dist + (1 - temp_weight) * 
    # Combine distances based on temp_weight 
    # but we always double count the day_dist since the days travelled will also account for temperature differences
    return temp_weight * temp_dist + 2 * day_dist

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
    targets_day_estimates = calc_targets_day_estimates(graph,cluster_cities,daily_max_km,temp_weight = 0)
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
                        temp_weight, auto_threshold_percentile
                        ):
    """Cluster cities and calculate cluster metrics"""
    # Use previous dynamic clustering implementation
    clusters = dynamic_cluster_cities(target_cities, city_coords, temperatures, targets_day_estimates, 
                                      current_day, desired_low_temp, desired_high_temp, 
                                      temp_weight, auto_threshold_percentile)
    
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
                      temp_weight=0.5, sun_weight=0.5, wind_weight=0.5, auto_threshold_percentile=20, exp=2,
                      sorted_input=False, city_rest_days=None):
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
        if temp_weight > 0:
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
        targets_day_estimates = calc_targets_day_estimates(graph, target_cities, daily_max_km, temp_weight)

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
            desired_low_temp, desired_high_temp, temp_weight, auto_threshold_percentile
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
                        temp_weight, sun_weight, wind_weight, randomization=0.2, exp=exp,
                        interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                        city_to_cluster=city_to_cluster, cluster_info=cluster_info
                    )
                    score, _, _, interpol_tt, spatial_i_tt = calculate_route_score(
                        initial_route, sd, targets_day_estimates, temperatures,
                        desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                        min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight,
                        max_days, exp, interpol_tt, spatial_i_tt
                    )
                    print("initial route:", [city_names[city] for city in initial_route], score)

                    if initial_route:
                        improved_route, score, days_track, interpol_tt, spatial_i_tt = improve_route(
                            initial_route, connections_dict, sd, targets_day_estimates, temperatures,
                            desired_low_temp, desired_high_temp, min_low_temp, max_low_temp,
                            min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight,
                            max_days, exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt,
                            city_to_cluster=city_to_cluster, cluster_info=cluster_info
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
                min_high_temp, max_high_temp, temp_weight, sun_weight, wind_weight,
                max_days, exp, interpol_tt, spatial_i_tt
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
                        expected_travel_days = max(1, ceil(dist_km / daily_max_km))
                    else:
                        expected_travel_days = targets_day_estimates[from_city + "_" + to_city]

                    path_segment, segment_score, interpol_tt, spatial_i_tt = optimized_travel_planner(
                        subgraph, from_city, to_city, current_day, temperatures,
                        daily_max_km, expected_travel_days, desired_low_temp, desired_high_temp,
                        min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                        temp_weight, exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt
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
                seg_days = max(1, ceil(distance / daily_max_km))
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
                exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt
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
                        exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt
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
                        exp=exp, interpol_tt=interpol_tt, spatial_i_tt=spatial_i_tt
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



def get_osrm_route(route_locations, skip_segments=None, routing_mode='car', progress_callback=None):
    """
    Fetch road geometry for each city-to-city segment.
    routing_mode: 'car'            – OSRM driving (default)
                  'bicycle'        – OSRM cycling
                  'car_no_highway' – Valhalla auto with use_highways=0
    skip_segments: set of int indices i where segment (i → i+1) should be skipped.
    Returns: list of road-geometry chunks [ [(lat,lon), ...], ... ]
    """
    skip_segments = skip_segments or set()
    road_chunks = []

    # Valhalla costing options for car_no_highway
    _valhalla_opts = {"auto": {"use_highways": 0.0, "use_tolls": 0.5}}

    n_segs = sum(1 for i in range(len(route_locations) - 1) if i not in skip_segments)
    mode_label = {'car': 'OSRM Auto', 'bicycle': 'OSRM Fahrrad',
                  'car_no_highway': 'Valhalla (ohne Autobahn)'}.get(routing_mode, routing_mode)
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
            if progress_callback:
                progress_callback(seg_done, n_segs)

        except Exception as e:
            print(f"  Segment {i+1} fehlgeschlagen ({routing_mode}): {e}", flush=True)
            road_chunks.append([start, end])
            seg_done += 1
            if progress_callback:
                progress_callback(seg_done, n_segs)

    print(f"[Routing] Fertig — {len(road_chunks)} Chunks gesamt", flush=True)
    return road_chunks


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
    
    # Open-Elevation lookup
    try:
        payload = {"locations": [{"latitude": lat, "longitude": lon}
                                  for lat, lon in road_coords]}
        resp = requests.post(OPEN_ELEV, json=payload, timeout=30)
        resp.raise_for_status()
        results = resp.json()["results"]
    except Exception as e:
        print(f"Open-Elevation request failed: {e}")
        return None
    
    # Build elevation profile (stop at first flight)
    profile = []
    max_road_km = sum(d for d in leg_distances_km if d > 0)
    
    for i, r in enumerate(results):
        lat, lon, ele = r["latitude"], r["longitude"], r["elevation"]
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


def _temp_to_rgb(temp, desired_temp, range_deg=15):
    """
    Map temperature relative to desired_temp → (r, g, b).
    7-stop scale: dark-purple → dark-blue → light-blue → white → light-red → dark-red → light-purple
    range_deg: °C offset that maps to ±1.0 (default ±15 °C).
    """
    diff = temp - desired_temp
    t = max(-1.0, min(1.0, diff / range_deg))
    # (t_pos, r, g, b)
    stops = [
        (-1.000,  80,   0, 130),   # dark purple  — extreme cold
        (-0.667,   0,   0, 210),   # dark blue
        (-0.333, 110, 185, 255),   # light blue
        ( 0.000, 255, 255, 255),   # white        — on target
        ( 0.333, 255, 130,  90),   # light red
        ( 0.667, 210,   0,   0),   # dark red
        ( 1.000, 215,  90, 225),   # light purple — extreme hot
    ]
    for i in range(len(stops) - 1):
        t0, r0, g0, b0 = stops[i]
        t1, r1, g1, b1 = stops[i + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0)
            return (int(r0 + f * (r1 - r0)),
                    int(g0 + f * (g1 - g0)),
                    int(b0 + f * (b1 - b0)))
    last = stops[-1]
    return last[1], last[2], last[3]


def _valid_prcp(v):
    """True if v is a usable precipitation value (not None, not NaN)."""
    try:
        return v is not None and not math.isnan(float(v))
    except (TypeError, ValueError):
        return False


def _interp_temp_at(city_data, p_km, p_ele, temp_key, prcp_threshold=5.0):
    """
    Interpolate lapse-rate-corrected temperature at profile point (p_km, p_ele).

    Algorithm:
    1. Find the two cities bracketing p_km (by road distance).
    2. Linearly interpolate temperature and reference elevation between them.
    3. Apply a dynamic lapse rate derived from interpolated precipitation:
         lapse = 1.0 - 0.4 * min(1, prcp / prcp_threshold)
       → 1.0 °C/100m (dry) at prcp=0, 0.6 °C/100m (moist) at prcp≥threshold

    Fallback for missing prcp (None / NaN):
      • Only one city has prcp  → use that value directly
      • Neither bracket city    → search all city_data for nearest valid prcp
      • No valid prcp anywhere  → use 0.6 °C/100m (moist adiabatic default)

    Returns float or None if temperature data is unavailable for that key.
    """
    if not city_data:
        return None

    # Find ca (last city with km ≤ p_km) and cb (first city with km ≥ p_km)
    ca, cb = city_data[0], city_data[-1]
    for cd in city_data:
        if cd["km"] <= p_km:
            ca = cd
        if cd["km"] >= p_km:
            cb = cd
            break

    ta = ca.get(temp_key)
    tb = cb.get(temp_key)
    if ta is None and tb is None:
        return None
    if ta is None:
        ta, ca = tb, cb
    if tb is None:
        tb, cb = ta, ca

    km_a, km_b = ca["km"], cb["km"]
    t = (p_km - km_a) / (km_b - km_a) if km_b > km_a else 0.0
    t = max(0.0, min(1.0, t))
    temp_ref = (1.0 - t) * ta + t * tb
    ele_ref  = (1.0 - t) * ca["ele"] + t * cb["ele"]

    # ── Dynamic lapse rate from precipitation ────────────────────────────
    prcp_a = ca.get("prcp")
    prcp_b = cb.get("prcp")
    va, vb = _valid_prcp(prcp_a), _valid_prcp(prcp_b)

    if va and vb:
        prcp_interp = (1.0 - t) * float(prcp_a) + t * float(prcp_b)
    elif va:
        prcp_interp = float(prcp_a)
    elif vb:
        prcp_interp = float(prcp_b)
    else:
        # Neither bracket city has prcp — search all city_data for nearest
        nearest = min(
            (cd for cd in city_data if _valid_prcp(cd.get("prcp"))),
            key=lambda cd: abs(cd["km"] - p_km),
            default=None,
        )
        prcp_interp = float(nearest["prcp"]) if nearest else None

    if prcp_interp is not None:
        lapse = 1.0 - 0.4 * min(1.0, prcp_interp / prcp_threshold)
    else:
        lapse = 0.6   # fallback: moist adiabatic lapse rate

    return temp_ref - (p_ele - ele_ref) / 100.0 * lapse


def build_elevation_svg(elev_data, desired_low_temp=12.0, desired_high_temp=25.0,
                        segment_km=1000, city_data_by_offset=None,
                        city_abs_days=None):
    """
    Render elevation profile as tabbed HTML with temperature colour-coding.

    Two tabs:
      • Tmax — fill colour shows interpolated max-temperature vs desired_high_temp
      • Tmin — fill colour shows interpolated min-temperature vs desired_low_temp

    Temperature at each profile point is computed by:
      1. Linear interpolation between the two nearest cities (by road distance).
      2. Lapse-rate correction: −0.6 °C per 100 m above the interpolated
         reference elevation of those two cities.

    Colours: blue = too cold  |  white = on target  |  red = too warm
    Each tab splits into multiple panels of segment_km width (default 1000 km).
    """
    if not elev_data or not elev_data.get("profile"):
        return ""

    profile    = elev_data["profile"]    # [(km, ele_m), ...]
    city_marks = elev_data["city_marks"]  # [(km, name), ...]
    city_data  = elev_data.get("city_data", [])   # [{km, name, tmin, tmax, ele}, ...]
    if not profile:
        return ""

    dist_vals = [p[0] for p in profile]
    ele_vals  = [p[1] for p in profile]
    total_km  = dist_vals[-1]

    ascent  = sum(max(0, ele_vals[i+1] - ele_vals[i]) for i in range(len(ele_vals) - 1))
    descent = sum(max(0, ele_vals[i] - ele_vals[i+1]) for i in range(len(ele_vals) - 1))

    n_segs = max(1, ceil(total_km / segment_km))

    def interp_ele(km_target):
        for i in range(len(profile) - 1):
            km0, e0 = profile[i]
            km1, e1 = profile[i + 1]
            if km0 <= km_target <= km1:
                t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
                return e0 + t * (e1 - e0)
        return profile[-1][1]

    # SVG canvas constants
    W     = 920
    H     = 290
    pad_l = 64
    pad_r = 22
    pad_t = 36
    pad_b = 104
    w     = W - pad_l - pad_r
    h     = H - pad_t - pad_b

    # ── Global Y-axis shared across all panels ────────────────────────────
    global_max_ele = max(ele_vals) if ele_vals else 1.0
    global_max_ele = max(global_max_ele, 1.0)
    y_bottom = -global_max_ele / 20.0
    y_top    = global_max_ele
    y_range  = y_top - y_bottom

    def yp(ele):
        return pad_t + h - (ele - y_bottom) / y_range * h

    ax_y     = pad_t + h        # panel bottom (= y_bottom)
    zero_y   = yp(0.0)          # sea-level line position

    # Round Y-tick interval
    if global_max_ele <= 200:    y_tick_iv = 50
    elif global_max_ele <= 500:  y_tick_iv = 100
    elif global_max_ele <= 1000: y_tick_iv = 200
    elif global_max_ele <= 2500: y_tick_iv = 500
    else:                        y_tick_iv = 1000

    # ── Day-label helpers ─────────────────────────────────────────────────
    # km → abs_day lookup (same order as city_data)
    city_km_to_absday = {}
    if city_abs_days:
        for _i, _cd in enumerate(city_data):
            if _i < len(city_abs_days):
                city_km_to_absday[_cd["km"]] = city_abs_days[_i]

    _MONTH_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun',
                    'Jul','Aug','Sep','Okt','Nov','Dez']
    _MONTH_DAYS  = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]  # 2024

    def _day_to_short(doy):
        """1-based day-of-year → short German date string (e.g. '15. Mär')."""
        d = ((int(doy) - 1) % 365)
        for nd, mn in zip(_MONTH_DAYS, _MONTH_NAMES):
            if d < nd:
                return f'{d + 1}. {mn}'
            d -= nd
        return '31. Dez'

    def render_panels(temp_key, desired_temp, panel_label):
        """Build all SVG panel strings for one temperature type (tmin or tmax)."""
        svgs = []
        for seg_idx in range(n_segs):
            s_km = seg_idx * segment_km
            e_km = min((seg_idx + 1) * segment_km, total_km)

            seg_profile = []
            if seg_idx > 0:
                seg_profile.append((s_km, interp_ele(s_km)))
            for km, ele in profile:
                if s_km <= km <= e_km:
                    seg_profile.append((km, ele))
            if seg_idx < n_segs - 1:
                seg_profile.append((e_km, interp_ele(e_km)))
            if not seg_profile:
                continue

            span_km = e_km - s_km if e_km > s_km else 1.0
            uid     = f"{temp_key}-{seg_idx}"

            def xp(km, _s=s_km, _sp=span_km): return pad_l + (km - _s) / _sp * w

            # ── Background defs ───────────────────────────────────────────────
            defs = (
                f'<defs>'
                f'<linearGradient id="bg-{uid}" x1="0" y1="0" x2="0" y2="1">'
                f'<stop offset="0%" stop-color="#f4f6fb"/>'
                f'<stop offset="100%" stop-color="#ffffff"/>'
                f'</linearGradient>'
                f'<clipPath id="cp-{uid}">'
                f'<rect x="{pad_l}" y="{pad_t}" width="{w}" height="{h}"/>'
                f'</clipPath>'
                f'</defs>'
            )

            # ── Temperature-coloured fill ─────────────────────────────────────
            colored_fill = f'<g clip-path="url(#cp-{uid})">'
            for i in range(len(seg_profile) - 1):
                km0, ele0 = seg_profile[i]
                km1, ele1 = seg_profile[i + 1]
                mid_km  = (km0 + km1) / 2
                mid_ele = (ele0 + ele1) / 2
                temp = _interp_temp_at(city_data, mid_km, mid_ele, temp_key)
                if temp is not None:
                    r, g, b = _temp_to_rgb(temp, desired_temp)
                else:
                    r, g, b = 200, 200, 200
                x0, x1 = xp(km0), xp(km1)
                y0, y1 = yp(ele0), yp(ele1)
                x1e = x1 + 0.5
                tip_temp = f"{temp:.1f}" if temp is not None else "null"
                colored_fill += (
                    f'<polygon points="{x0:.1f},{y0:.1f} {x1e:.1f},{y1:.1f} '
                    f'{x1e:.1f},{ax_y} {x0:.1f},{ax_y}" '
                    f'fill="rgb({r},{g},{b})" stroke="rgb({r},{g},{b})" stroke-width="0.5" '
                    f'data-km="{mid_km:.2f}" data-ele="{mid_ele:.1f}" data-key="{temp_key}" '
                    f'style="cursor:crosshair" '
                    f'onmousemove="showElevTip(event,{mid_km:.0f},{mid_ele:.0f},{tip_temp})" '
                    f'onmouseleave="hideElevTip()"/>'
                )
            colored_fill += '</g>'

            # ── Y-axis gridlines & labels ─────────────────────────────────────
            y_ticks = ""
            tick_ele = 0
            while tick_ele <= global_max_ele + y_tick_iv * 0.1:
                yv = yp(tick_ele)
                is_zero = (tick_ele == 0)
                grid_color  = "#c0c8d8" if is_zero else "#dde2ea"
                grid_width  = "1.2"     if is_zero else "0.8"
                label_color = "#374151" if is_zero else "#6b7280"
                fw          = ' font-weight="600"' if is_zero else ""
                y_ticks += (
                    f'<line x1="{pad_l}" y1="{yv:.1f}" x2="{pad_l+w}" y2="{yv:.1f}" '
                    f'stroke="{grid_color}" stroke-width="{grid_width}" stroke-dasharray="4,3"/>'
                    f'<line x1="{pad_l-6}" y1="{yv:.1f}" x2="{pad_l}" y2="{yv:.1f}" '
                    f'stroke="#8898aa" stroke-width="1.2"/>'
                    f'<text x="{pad_l-9}" y="{yv+4:.1f}" text-anchor="end" '
                    f'font-size="10.5" font-family="sans-serif" fill="{label_color}"{fw}>'
                    f'{int(tick_ele)} m</text>'
                )
                tick_ele += y_tick_iv

            # ── X-axis km ticks ───────────────────────────────────────────────
            if span_km <= 100:   tick_iv = 10
            elif span_km <= 300: tick_iv = 25
            elif span_km <= 600: tick_iv = 50
            else:                tick_iv = 100

            x_ticks = ""
            tick_km = ceil(s_km / tick_iv) * tick_iv
            while tick_km <= e_km:
                xv = xp(tick_km)
                x_ticks += (
                    f'<line x1="{xv:.1f}" y1="{ax_y}" x2="{xv:.1f}" y2="{ax_y+6}" '
                    f'stroke="#8898aa" stroke-width="1.1"/>'
                    f'<text x="{xv:.1f}" y="{ax_y+18:.1f}" text-anchor="middle" '
                    f'font-size="9.5" font-family="sans-serif" fill="#6b7280">{int(tick_km)}</text>'
                )
                tick_km += tick_iv

            # ── City marker lines, dots and rotated labels ────────────────────
            city_ticks = ""
            for km, name in city_marks:
                if s_km <= km <= e_km:
                    xv    = xp(km)
                    dot_y = yp(interp_ele(km))
                    safe  = name[:16]
                    lbl_y = ax_y + 14

                    # Date pill: horizontal, white background, top of guide line
                    abs_day = city_km_to_absday.get(km)
                    if abs_day is not None:
                        date_str_init = _day_to_short(abs_day)
                        pill_w = 36; pill_h = 12
                        pill_x = xv - pill_w / 2
                        pill_y = pad_t + 3
                        date_label = (
                            f'<rect x="{pill_x:.1f}" y="{pill_y:.1f}" '
                            f'width="{pill_w}" height="{pill_h}" '
                            f'rx="3" fill="white" opacity="0.9" '
                            f'stroke="#b0c4de" stroke-width="0.7"/>'
                            f'<text class="elev-city-date" data-absday="{abs_day}" '
                            f'x="{xv:.1f}" y="{pill_y + 9:.1f}" '
                            f'text-anchor="middle" font-size="8.5" '
                            f'font-family="sans-serif" fill="#1a2d45" font-weight="700">'
                            f'{date_str_init}</text>'
                        )
                    else:
                        date_label = ''

                    city_ticks += (
                        # dashed vertical guide
                        f'<line x1="{xv:.1f}" y1="{pad_t}" x2="{xv:.1f}" y2="{ax_y}" '
                        f'stroke="#4a6fa5" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>'
                        # dot on profile line
                        f'<circle cx="{xv:.1f}" cy="{dot_y:.1f}" r="3.5" '
                        f'fill="#fff" stroke="#4a6fa5" stroke-width="1.8"/>'
                        # rotated city name label
                        f'<text font-size="9.5" font-family="sans-serif" fill="#1e2d45" '
                        f'font-weight="600" text-anchor="end" '
                        f'transform="rotate(-38,{xv:.1f},{lbl_y:.1f}) '
                        f'translate({xv:.1f},{lbl_y:.1f})">{safe}</text>'
                        # date pill (updates with slider)
                        f'{date_label}'
                    )

            # ── Profile outline ───────────────────────────────────────────────
            pts = " ".join(f"{xp(km):.1f},{yp(ele):.1f}" for km, ele in seg_profile)
            profile_line = (
                f'<polyline points="{pts}" fill="none" stroke="#1a2d45" '
                f'stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" '
                f'clip-path="url(#cp-{uid})"/>'
            )

            # ── Legend bar ────────────────────────────────────────────────────
            leg_x  = pad_l
            leg_y  = ax_y + 50
            leg_w  = 200
            leg_h  = 10
            t_lo   = desired_temp - 15
            t_hi   = desired_temp + 15
            mid_x  = leg_x + leg_w // 2
            legend = (
                f'<defs><linearGradient id="tg-{uid}" x1="0" y1="0" x2="1" y2="0">'
                f'<stop offset="0%"     stop-color="rgb(80,0,130)"/>'
                f'<stop offset="16.7%" stop-color="rgb(0,0,210)"/>'
                f'<stop offset="33.3%" stop-color="rgb(110,185,255)"/>'
                f'<stop offset="50%"   stop-color="rgb(255,255,255)"/>'
                f'<stop offset="66.7%" stop-color="rgb(255,130,90)"/>'
                f'<stop offset="83.3%" stop-color="rgb(210,0,0)"/>'
                f'<stop offset="100%"  stop-color="rgb(215,90,225)"/>'
                f'</linearGradient></defs>'
                # panel label (e.g. "Tagestemperatur")
                f'<text x="{leg_x}" y="{leg_y-18}" font-size="9.5" '
                f'font-family="sans-serif" fill="#4a6fa5" font-weight="700">'
                f'{panel_label}</text>'
                # bar
                f'<rect x="{leg_x}" y="{leg_y}" width="{leg_w}" height="{leg_h}" '
                f'fill="url(#tg-{uid})" rx="3" stroke="#b0b8c8" stroke-width="0.8"/>'
                # center tick & label
                f'<line x1="{mid_x}" y1="{leg_y-3}" x2="{mid_x}" y2="{leg_y+leg_h+3}" '
                f'stroke="#374151" stroke-width="1.2"/>'
                f'<text x="{mid_x}" y="{leg_y-6}" text-anchor="middle" '
                f'font-size="8.5" font-family="sans-serif" fill="#374151" font-weight="700">'
                f'{desired_temp:.0f}\u00b0C \u2713</text>'
                # end labels
                f'<text x="{leg_x}" y="{leg_y+leg_h+12}" font-size="8.5" '
                f'font-family="sans-serif" fill="#6b7280" text-anchor="start">{t_lo:.0f}\u00b0C</text>'
                f'<text x="{leg_x+leg_w}" y="{leg_y+leg_h+12}" font-size="8.5" '
                f'font-family="sans-serif" fill="#6b7280" text-anchor="end">{t_hi:.0f}\u00b0C</text>'
            )

            # ── Stats header ──────────────────────────────────────────────────
            if seg_idx == 0:
                stat_str = (
                    f'\u2191 {int(ascent):,} m\u2002\u2003'
                    f'\u2193 {int(descent):,} m\u2002\u2003'
                    f'{total_km:.0f} km gesamt'
                )
            else:
                stat_str = f'Abschnitt {seg_idx+1}/{n_segs}\u2002\u2014\u2002{int(s_km)}\u2013{int(e_km)} km'

            panel_badge = ""
            if n_segs > 1:
                bx = pad_l + w - 2
                by = ax_y + 62
                panel_badge = (
                    f'<text x="{bx}" y="{by}" text-anchor="end" '
                    f'font-size="9" font-family="sans-serif" fill="#a0aab8">'
                    f'{int(s_km)}\u2013{int(e_km)} km</text>'
                )

            svgs.append(
                f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"'
                f' style="width:100%;height:auto;display:block;margin-bottom:8px;'
                f'border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08)">'
                # card background
                f'<rect width="{W}" height="{H}" fill="url(#bg-{uid})" rx="10"/>'
                f'{defs}'
                # plot area clip background
                f'<rect x="{pad_l}" y="{pad_t}" width="{w}" height="{h}" '
                f'fill="#f9fafb" rx="3"/>'
                # gridlines (behind fill)
                f'{y_ticks}'
                # coloured fill
                f'{colored_fill}'
                # sea-level emphasis line
                f'<line x1="{pad_l}" y1="{zero_y:.1f}" x2="{pad_l+w}" y2="{zero_y:.1f}" '
                f'stroke="#94a3b8" stroke-width="1" stroke-dasharray="6,3" opacity="0.6"/>'
                # profile outline
                f'{profile_line}'
                # axes
                f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{ax_y}" '
                f'stroke="#8898aa" stroke-width="1.5"/>'
                f'<line x1="{pad_l}" y1="{ax_y}" x2="{pad_l+w}" y2="{ax_y}" '
                f'stroke="#8898aa" stroke-width="1.5"/>'
                # x ticks
                f'{x_ticks}'
                # km unit label
                f'<text x="{pad_l+w+4}" y="{ax_y+18:.1f}" '
                f'font-size="9" font-family="sans-serif" fill="#94a3b8">km</text>'
                # city markers (on top)
                f'{city_ticks}'
                # y-axis title
                f'<text x="{pad_l-38}" y="{pad_t + h//2}" text-anchor="middle" '
                f'font-size="9.5" font-family="sans-serif" fill="#8898aa" '
                f'transform="rotate(-90,{pad_l-38},{pad_t + h//2})">'
                f'H\u00f6he (m)</text>'
                # stats header
                f'<text x="{pad_l+w}" y="{pad_t-10}" text-anchor="end" '
                f'font-size="10.5" font-family="sans-serif" fill="#4a6fa5" font-weight="600">'
                f'{stat_str}</text>'
                # legend
                f'{legend}'
                f'{panel_badge}'
                f'</svg>'
            )
        return "\n".join(svgs)

    tmax_html = render_panels("tmax", desired_high_temp, "Tagestemperatur")
    tmin_html = render_panels("tmin", desired_low_temp, "Nachttemperatur")

    # ── Build slider + JS data for ±30-day temperature preview ───────────
    slider_css  = ''
    slider_html = ''
    extra_js    = ''
    if city_data_by_offset:
        slider_css = (
            '.et-slider-wrap{'
            'display:flex;align-items:center;gap:10px;'
            'padding:8px 4px 2px;'
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
            'font-size:12px}'
            '.et-slider-wrap label{'
            'white-space:nowrap;font-weight:600;color:#4a6fa5;font-size:12px}'
            '.et-slider-wrap input[type=range]{'
            'accent-color:#4a6fa5;flex:1;max-width:240px;cursor:pointer}'
            '.et-slider-wrap span{'
            'min-width:56px;text-align:right;'
            'color:#4a6fa5;font-weight:700;font-size:13px}'
        )
        slider_html = (
            '<div class="et-slider-wrap">'
            '<label>Starttag\u00a0\u00b130\u00a0Tage</label>'
            '<input type="range" id="elev-day-slider"'
            ' min="-30" max="30" value="0" step="1"'
            ' oninput="onElevSlider(this.value)">'
            '<span id="elev-day-label">\u00b10 Tage</span>'
            '</div>'
        )
        # Compact city km / ele arrays (geometry, offset-independent)
        city_km_js  = '[' + ','.join(
            f'{cd["km"]:.2f}' for cd in city_data) + ']'
        city_ele_js = '[' + ','.join(
            f'{cd["ele"]:.1f}' if cd.get('ele') is not None else '0'
            for cd in city_data) + ']'
        # Per-offset temperature table
        parts = []
        for d in sorted(city_data_by_offset):
            entries = []
            for t in city_data_by_offset[d]:
                tmin_v = f'{t["tmin"]:.2f}' if t.get('tmin') is not None else 'null'
                tmax_v = f'{t["tmax"]:.2f}' if t.get('tmax') is not None else 'null'
                prcp_v = f'{t["prcp"]:.2f}' if t.get('prcp') is not None else 'null'
                entries.append(
                    '{"tmin":' + tmin_v +
                    ',"tmax":' + tmax_v +
                    ',"prcp":' + prcp_v + '}')
            parts.append(f'"{d}":[' + ','.join(entries) + ']')
        temps_js = '{' + ','.join(parts) + '}'

        extra_js = (
            f'var ELEV_CITY_KM={city_km_js};'
            f'var ELEV_CITY_ELE={city_ele_js};'
            f'var ELEV_TEMPS_BY_OFFSET={temps_js};'
            f'var ELEV_DESIRED_LOW={desired_low_temp:.2f};'
            f'var ELEV_DESIRED_HIGH={desired_high_temp:.2f};'
            # Interpolate lapse-rate-corrected temperature at profile point
            'function interpTempAtJS(ct,ck,ce,pk,pe,key){'
            'var n=ck.length;if(n===0)return null;'
            'var ai=0,bi=0,found=false;'
            'for(var i=0;i<n-1;i++){'
            'if(ck[i]<=pk&&pk<=ck[i+1]){ai=i;bi=i+1;found=true;break;}}'
            'if(!found){ai=bi=(pk<ck[0])?0:n-1;}'
            'var ca=ct[ai],cb=ct[bi];'
            'var kma=ck[ai],kmb=ck[bi],ela=ce[ai],elb=ce[bi];'
            'var t=(kmb>kma)?(pk-kma)/(kmb-kma):0;'
            'var ta=ca[key],tb=cb[key];'
            'if(ta==null&&tb==null)return null;'
            'var tr=(ta!=null&&tb!=null)?(1-t)*ta+t*tb:(ta!=null?ta:tb);'
            'var er=(1-t)*ela+t*elb;'
            'var pa=ca.prcp,pb=cb.prcp,prcp=null;'
            'if(pa!=null&&pb!=null)prcp=(1-t)*pa+t*pb;'
            'else if(pa!=null)prcp=pa;else if(pb!=null)prcp=pb;'
            'var lapse=(prcp!=null)?1.0-0.4*Math.min(1.0,prcp/5.0):0.6;'
            'return tr-(pe-er)/100.0*lapse;}'
            # Map temperature to RGB (7-stop scale, mirrors _temp_to_rgb)
            'function tempToRgbJS(temp,desired){'
            'var range=15,t=Math.max(-1,Math.min(1,(temp-desired)/range));'
            'var stops=[[-1,80,0,130],[-0.667,0,0,210],[-0.333,110,185,255],'
            '[0,255,255,255],[0.333,255,130,90],[0.667,210,0,0],[1,215,90,225]];'
            'for(var i=0;i<stops.length-1;i++){'
            'if(t<=stops[i+1][0]){'
            'var f=(t-stops[i][0])/(stops[i+1][0]-stops[i][0]);'
            'var r=Math.round(stops[i][1]+f*(stops[i+1][1]-stops[i][1]));'
            'var g=Math.round(stops[i][2]+f*(stops[i+1][2]-stops[i][2]));'
            'var b=Math.round(stops[i][3]+f*(stops[i+1][3]-stops[i][3]));'
            'return[r,g,b];}}'
            'var l=stops[stops.length-1];return[l[1],l[2],l[3]];}'
            # Convert 1-based day-of-year to short German date string
            'function _elevDayStr(doy){'
            'var mo=["Jan","Feb","Mär","Apr","Mai","Jun",'
            '"Jul","Aug","Sep","Okt","Nov","Dez"];'
            'var d=new Date(2024,0,1);d.setDate(d.getDate()+doy-1);'
            'return d.getDate()+". "+mo[d.getMonth()];}'
            # Update all polygon colours AND city date labels for a given day offset
            'function updateElevColors(offset){'
            'var data=ELEV_TEMPS_BY_OFFSET[String(offset)];'
            'if(!data)return;'
            'document.querySelectorAll("polygon[data-km]").forEach(function(poly){'
            'var km=parseFloat(poly.getAttribute("data-km"));'
            'var ele=parseFloat(poly.getAttribute("data-ele"));'
            'var key=poly.getAttribute("data-key");'
            'var desired=key==="tmax"?ELEV_DESIRED_HIGH:ELEV_DESIRED_LOW;'
            'var temp=interpTempAtJS(data,ELEV_CITY_KM,ELEV_CITY_ELE,km,ele,key);'
            'var col=temp!==null?tempToRgbJS(temp,desired):[200,200,200];'
            'var css="rgb("+col[0]+","+col[1]+","+col[2]+")";'
            'poly.style.fill=css;poly.style.stroke=css;});'
            # Update city date labels
            'document.querySelectorAll(".elev-city-date").forEach(function(el){'
            'var ad=parseInt(el.getAttribute("data-absday"));'
            'var cd=((ad+offset-1+365)%365)+1;'
            'el.textContent=_elevDayStr(cd);});}'
            'function onElevSlider(val){'
            'val=parseInt(val);'
            'document.getElementById("elev-day-label").textContent='
            '(val>=0?"+":"")+val+" Tage";'
            'updateElevColors(val);}'
        )

    return (
        '<style>'
        '.et-wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
        'margin:4px 0}'
        '.et-tabs{display:flex;gap:6px;margin-bottom:0;padding:0 2px}'
        '.et-btn{'
        'padding:7px 22px;border:none;background:#e8edf5;color:#4a6fa5;'
        'cursor:pointer;border-radius:20px;font-size:13px;font-weight:600;'
        'transition:background .15s,color .15s,box-shadow .15s;'
        'box-shadow:0 1px 3px rgba(0,0,0,.08)}'
        '.et-btn:hover{background:#d4ddf0}'
        '.et-btn.active{background:#4a6fa5;color:#fff;'
        'box-shadow:0 2px 8px rgba(74,111,165,.35)}'
        '.et-panel{padding:12px 4px 4px}'
        '#elev-tip{position:fixed;display:none;'
        'background:rgba(15,23,42,0.94);color:#e2e8f0;'
        'padding:8px 14px;border-radius:8px;font-size:12px;'
        'pointer-events:none;z-index:9999;white-space:pre;line-height:1.8;'
        'box-shadow:0 4px 16px rgba(0,0,0,.4);'
        'font-family:"SF Mono",Consolas,monospace;letter-spacing:.02em}'
        f'{slider_css}'
        '</style>'
        '<div id="elev-tip"></div>'
        '<div class="et-wrap">'
        '<div class="et-tabs">'
        f'<button class="et-btn active" onclick="showET(this,\'et-tmax\')">'
        f'Tagestemperatur &mdash; Ziel {desired_high_temp:.0f}\u00b0C</button>'
        f'<button class="et-btn" onclick="showET(this,\'et-tmin\')">'
        f'Nachttemperatur &mdash; Ziel {desired_low_temp:.0f}\u00b0C</button>'
        '</div>'
        f'{slider_html}'
        f'<div id="et-tmax" class="et-panel">{tmax_html}</div>'
        f'<div id="et-tmin" class="et-panel" style="display:none">{tmin_html}</div>'
        '</div>'
        '<script>'
        'function showET(btn,id){'
        'document.querySelectorAll(".et-panel").forEach(function(e){'
        'e.style.display="none"});'
        'document.querySelectorAll(".et-btn").forEach(function(e){'
        'e.classList.remove("active")});'
        'document.getElementById(id).style.display="block";'
        'btn.classList.add("active");}'
        'function showElevTip(evt,km,ele,temp){'
        'var tt=document.getElementById("elev-tip");'
        'var s=km+" km\\n"+ele+" m";'
        'if(temp!==null&&temp!==undefined)s+="\\n"+temp.toFixed(1)+" \u00b0C";'
        'tt.textContent=s;tt.style.display="block";'
        'tt.style.left=(evt.clientX+18)+"px";'
        'tt.style.top=(evt.clientY-16)+"px";}'
        'function hideElevTip(){'
        'document.getElementById("elev-tip").style.display="none";}'
        f'{extra_js}'
        '</script>'
    )


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


def compute_road_distances(route_locations, skip_segments=None):
    """Compute road distances using OSRM without elevation data."""
    road_chunks = get_osrm_route(route_locations, skip_segments)
    if not road_chunks:
        return [0.0] * (len(route_locations) - 1)
    return compute_distances_from_chunks(road_chunks, route_locations, skip_segments)


def _flatten_road_chunks(road_chunks):
    """Flatten road_chunks into a single list of (lat, lon) tuples."""
    coords = []
    for chunk in road_chunks:
        for point in chunk:
            if isinstance(point, (list, tuple)) and len(point) == 2:
                coords.append((float(point[0]), float(point[1])))
    return coords


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

    # Step 3: Single Open-Elevation call for all sub-routes
    print(f"[Höhenprofil] Schritt 3 — Open-Elevation Anfrage mit {n_sampled} Koordinaten …",
          flush=True)
    try:
        payload = {"locations": [{"latitude": lat, "longitude": lon}
                                  for lat, lon in all_sampled_latlon]}
        resp = requests.post(OPEN_ELEV, json=payload, timeout=30)
        resp.raise_for_status()
        all_results = resp.json()["results"]
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
            combined_profile.append((km_offset + km, r["elevation"]))
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


_COMPASS_DIRS = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW']

def _compass_dir(deg):
    return _COMPASS_DIRS[int((((deg % 360) + 360) % 360 + 11.25) / 22.5) % 16]


def _km_to_latlon(km_target, profile, latlons):
    """Interpolate lat/lon for a given km position along the elevation profile."""
    for i in range(len(profile) - 1):
        km0, km1 = profile[i][0], profile[i + 1][0]
        if km0 <= km_target <= km1:
            t = (km_target - km0) / (km1 - km0) if km1 > km0 else 0.0
            lat0, lon0 = latlons[i]
            lat1, lon1 = latlons[i + 1]
            return lat0 + t * (lat1 - lat0), lon0 + t * (lon1 - lon0)
    if latlons:
        return latlons[0] if km_target <= profile[0][0] else latlons[-1]
    return 0.0, 0.0


class MiniElevationControl:
    """
    Injects a mini elevation chart overlay into a Folium map via MacroElement.
    The chart sits at the bottom of the map and updates on viewport changes.
    """
    def __init__(self, elev_json, cities_json, desired_high, desired_low):
        self._elev_json    = elev_json
        self._cities_json  = cities_json
        self._desired_high = desired_high
        self._desired_low  = desired_low

    def add_to(self, m):
        """Add the mini elevation control to a Folium map."""
        from branca.element import MacroElement
        from jinja2 import Template

        dh = self._desired_high
        dl = self._desired_low
        ej = self._elev_json
        cj = self._cities_json

        class _Ctrl(MacroElement):
            _template = Template(u"""
            {%- macro script(this, kwargs) -%}
(function() {
var MINI_ELEV   = {{ this._ej }};
var MINI_CITIES = {{ this._cj }};
var D_HIGH = {{ this._dh }};
var D_LOW  = {{ this._dl }};
var _map = null;
document.addEventListener('DOMContentLoaded', function() {
    var tries = 0;
    var iv = setInterval(function() {
        tries++;
        for (var id in window) {
            if (id.startsWith('map_') && window[id] && window[id].getBounds) {
                _map = window[id]; clearInterval(iv); init(); return;
            }
        }
        if (tries > 100) clearInterval(iv);
    }, 50);
});

function init() {
    var isMobile = window.innerWidth < 640;
    var isLandscapeMobile = !isMobile && window.innerHeight < 500;
    var panelH = isMobile ? 150 : (isLandscapeMobile ? 100 : 200);
    var panel = document.createElement('div');
    panel.innerHTML = '<svg id="mini-elev-svg" width="100%" height="' + panelH + '" style="display:block"></svg>';
    panel.style.cssText = 'width:100%;height:' + panelH + 'px;' +
        'background:rgba(10,14,22,0.95);' +
        'border-top:2px solid rgba(61,142,248,0.3);box-sizing:border-box;';
    document.body.style.margin = '0';
    var mapContainer = document.querySelector('.folium-map');
    try {
        if (window.frameElement) {
            var curH = window.frameElement.offsetHeight || parseInt(window.frameElement.style.height) || 0;
            // Pin the map div to its current height BEFORE expanding the iframe.
            // Without this, .folium-map { height:100% } would stretch to fill the
            // larger iframe body, pushing the elevation panel out of view.
            if (mapContainer && curH) { mapContainer.style.height = curH + 'px'; }
            document.body.appendChild(panel);
            var newH = curH + panelH;
            window.frameElement.style.height = newH + 'px';
            // Fix the Folium inner wrapper (position:relative div)
            var fw = window.frameElement.parentElement;
            if (fw) { fw.style.paddingBottom = '0'; fw.style.height = newH + 'px'; }
            // Fix the Folium outer wrapper – needed on mobile where sizeMapIframe()
            // doesn't run, so the outer wrapper stays at the fixed CSS height.
            var outerFw = fw && fw.parentElement;
            if (outerFw && outerFw.tagName === 'DIV') {
                outerFw.style.paddingBottom = '0'; outerFw.style.height = newH + 'px';
            }
        } else {
            document.body.appendChild(panel);
        }
    } catch(e) {
        document.body.appendChild(panel);
    }
    _map.on('moveend zoomend resize', updateChart);
    window.addEventListener('resize', updateChart);
    updateChart();
}

function tempToRgb(temp, desired) {
    var STOPS = [
        [-1.0,[60,0,80]],[-0.667,[30,30,160]],[-0.333,[100,160,255]],
        [0.0,[255,255,255]],[0.333,[255,150,100]],[0.667,[200,40,40]],[1.0,[160,0,120]]
    ];
    var t = Math.max(-1, Math.min(1, (temp - desired) / 15));
    for (var i = 0; i < STOPS.length-1; i++) {
        if (t <= STOPS[i+1][0]) {
            var f = (t-STOPS[i][0])/(STOPS[i+1][0]-STOPS[i][0]);
            var r0=STOPS[i][1][0],g0=STOPS[i][1][1],b0=STOPS[i][1][2];
            var r1=STOPS[i+1][1][0],g1=STOPS[i+1][1][1],b1=STOPS[i+1][1][2];
            return 'rgb('+Math.round(r0+f*(r1-r0))+','+Math.round(g0+f*(g1-g0))+','+Math.round(b0+f*(b1-b0))+')';
        }
    }
    return 'rgb(160,0,120)';
}

function interpTemp(km, ele, cities, tempKey) {
    if (!cities.length) return null;
    var ci = -1;
    for (var k = 0; k < cities.length; k++) { if (cities[k].km >= km) { ci = k; break; } }
    if (ci < 0) ci = cities.length - 1;
    if (ci === 0) ci = 1;
    var c0 = cities[ci-1], c1 = cities[ci];
    var t = c1.km > c0.km ? (km - c0.km) / (c1.km - c0.km) : 0;
    var prcp = (c0.prcp||0) + t*((c1.prcp||0) - (c0.prcp||0));
    var lapse = (1.0 - 0.4*Math.min(1, prcp/5)) / 100;
    var eleRef = c0.ele + t*(c1.ele - c0.ele);
    return (c0[tempKey] + t*(c1[tempKey] - c0[tempKey])) - (ele - eleRef) * lapse;
}

function updateChart() {
    var panel = document.querySelector('#mini-elev-svg') &&
                document.querySelector('#mini-elev-svg').parentNode;
    var svg = document.querySelector('#mini-elev-svg');
    if (!svg || !_map) return;
    var W = svg.parentNode.offsetWidth;
    var H = svg.parentNode.offsetHeight || 150;
    if (W < 50) return;
    var bounds = _map.getBounds();
    var vis = MINI_ELEV.filter(function(p) {
        return p[1] >= bounds.getSouth() && p[1] <= bounds.getNorth() &&
               p[2] >= bounds.getWest() && p[2] <= bounds.getEast();
    });
    if (vis.length < 2) {
        svg.innerHTML = '<text x="'+(W/2)+'" y="'+(H/2+4)+'" text-anchor="middle" font-size="11" ' +
            'fill="rgba(255,255,255,0.35)" font-family="sans-serif">Route nicht sichtbar</text>';
        return;
    }
    var kmMin = vis[0][0], kmMax = vis[vis.length-1][0];
    var eles = vis.map(function(p){return p[3];});
    var eMin = Math.max(0, Math.min.apply(null,eles)-80);
    var eMax = Math.max.apply(null,eles)+50;
    var eRange = eMax - eMin;
    var PL=8, PR=8, PT=18, PB=20, cW=W-PL-PR, cH=H-PT-PB;
    function xp(km)  { return PL + (km-kmMin)/(kmMax-kmMin)*cW; }
    function yp(ele) { return PT + cH - (ele-eMin)/eRange*cH; }

    var out = '';
    for (var i = 0; i < vis.length-1; i++) {
        var km0=vis[i][0], e0=vis[i][3], km1=vis[i+1][0], e1=vis[i+1][3];
        var tv = interpTemp((km0+km1)/2, (e0+e1)/2, MINI_CITIES, 'tmax');
        var col = tv != null ? tempToRgb(tv, D_HIGH) : '#4a6fa5';
        out += '<polygon points="'+xp(km0)+','+yp(e0)+' '+xp(km1)+','+yp(e1)+
               ' '+xp(km1)+','+yp(eMin)+' '+xp(km0)+','+yp(eMin)+
               '" fill="'+col+'" opacity="0.85"/>';
    }
    var pts = vis.map(function(p){return xp(p[0])+','+yp(p[3]);}).join(' ');
    out += '<polyline points="'+pts+'" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>';

    var visCities = MINI_CITIES.filter(function(c){return c.km>=kmMin && c.km<=kmMax;});
    var cityFs = H >= 180 ? 9 : 7.5;
    visCities.forEach(function(c) {
        var cx = xp(c.km);
        out += '<line x1="'+cx+'" y1="'+PT+'" x2="'+cx+'" y2="'+(H-PB)+
               '" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" stroke-dasharray="2,2"/>';
        out += '<text x="'+cx+'" y="'+(PT-3)+'" text-anchor="middle" font-size="'+cityFs+'" ' +
               'fill="rgba(255,255,255,0.72)" font-family="sans-serif">'+c.name+'</text>';
    });
    var labelFs = H >= 180 ? 8.5 : 7;
    out += '<text x="'+(PL+2)+'" y="'+(PT+10)+'" font-size="'+labelFs+'" fill="rgba(255,255,255,0.45)" ' +
           'font-family="sans-serif">'+Math.round(eMax)+'m</text>';
    out += '<text x="'+(PL+2)+'" y="'+(H-PB-4)+'" font-size="'+labelFs+'" fill="rgba(255,255,255,0.35)" ' +
           'font-family="sans-serif">'+Math.round(eMin)+'m</text>';
    var km_range = Math.round(kmMax - kmMin);
    out += '<text x="'+(W/2)+'" y="'+(H-3)+'" text-anchor="middle" font-size="'+(labelFs-0.5)+'" ' +
           'fill="rgba(255,255,255,0.3)" font-family="sans-serif">' +
           'H\u00f6henprofil \u2013 sichtbarer Bereich ('+km_range+' km)</text>';

    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    svg.setAttribute('height', H);
    svg.innerHTML = out;
}
})();
            {%- endmacro -%}
            """)

            def __init__(self, ej, cj, dh, dl):
                super().__init__()
                self._name = 'MiniElevationControl'
                self._ej = ej
                self._cj = cj
                self._dh = dh
                self._dl = dl

        ctrl = _Ctrl(ej, cj, dh, dl)
        ctrl.add_to(m)


def create_route_map(graph, temperatures, route, exp, desired_low_temp, desired_high_temp,
                     min_low_temp, max_low_temp, min_high_temp, max_high_temp,
                     connections=None, show_elevation=True, routing_mode='car',
                     elev_points_per_1000km=1000, progress_callback=None):
    """
    Create Folium map with elevation profile.
    Returns: (folium_map, elevation_svg, osrm_distances_km)
    """
    route_locations = []
    city_names_ordered = []
    popups = []
    relative_days = []
    wind_data = []
    temp_scores = []
    weather_params = ['tmin', 'tmax', 'prcp', 'wspd', 'wdir', 'wspd_resultant']
    
    start_day = route[0][1] if route else 0
    
    # Collect temperature data
    all_temps_data = []
    for city_id, day, city_name, distance in route:
        try:
            node_data = graph.nodes[city_id]
            temps = get_interpolated_weather(city_id, day, temperatures)
            temp_score, violated = calculate_temperature_score(
                temps, exp, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp
            )
            all_temps_data.append((city_id, day, city_name, distance, temps, temp_score, violated))
        except KeyError:
            continue
    
    if not all_temps_data:
        return None, "", []
    
    scores_only = [d[5] for d in all_temps_data]
    min_score, max_score = min(scores_only), max(scores_only)
    score_range = max_score - min_score if max_score > min_score else 1
    
    # Build markers
    for city_id, day, city_name, distance, temps, temp_score, violated in all_temps_data:
        try:
            node_data = graph.nodes[city_id]
            lat, lon = node_data['lat'], node_data['lon']
            route_locations.append((lat, lon))
            city_names_ordered.append(city_name)
            
            rel_day = day - start_day
            relative_days.append(rel_day)
            
            ns = (temp_score - min_score) / score_range
            temp_scores.append(ns)
            
            if ns < 0.5:
                r = int(ns * 2 * 255); g = 200; b = 50
            else:
                r = 255; g = int((1 - (ns - 0.5) * 2) * 200); b = 50
            mc = f"rgb({r},{g},{b})"
            
            wdir = temps[4] if temps[4] is not None else None
            wspd = temps[5] if temps[5] is not None else None
            wind_data.append((wdir, wspd))
            
            tmin = temps[0]
            tmax = temps[1]
            temp_bars_html = ""
            
            if tmin is not None and desired_low_temp is not None:
                pos = max(0, min(100, ((tmin - (desired_low_temp - 20)) / 40) * 100))
                temp_bars_html += f"""
                <div style="margin:8px 0">
                  <div style="font-size:11px;margin-bottom:3px">
                    <b>Nachttemperatur:</b> {tmin:.1f}°C (Ziel: {desired_low_temp:.1f}°C)</div>
                  <div style="position:relative;width:100%;height:20px;
                       background:linear-gradient(to right,#3498DB,#95A5A6,#E74C3C);
                       border-radius:3px">
                    <div style="position:absolute;left:50%;top:0;width:2px;height:100%;
                         background:white;z-index:2"></div>
                    <div style="position:absolute;left:{pos}%;top:50%;
                         transform:translate(-50%,-50%);width:8px;height:8px;
                         background:black;border:2px solid white;border-radius:50%;
                         z-index:3"></div>
                  </div>
                </div>"""
            elif tmin is not None:
                temp_bars_html += f'<div style="margin:8px 0"><b>Nachttemperatur:</b> {tmin:.1f}°C</div>'
            else:
                temp_bars_html += '<div style="margin:8px 0"><b>Nachttemperatur:</b> N/A</div>'
            
            if tmax is not None and desired_high_temp is not None:
                pos = max(0, min(100, ((tmax - (desired_high_temp - 20)) / 40) * 100))
                temp_bars_html += f"""
                <div style="margin:8px 0">
                  <div style="font-size:11px;margin-bottom:3px">
                    <b>Tagestemperatur:</b> {tmax:.1f}°C (Ziel: {desired_high_temp:.1f}°C)</div>
                  <div style="position:relative;width:100%;height:20px;
                       background:linear-gradient(to right,#3498DB,#F39C12,#E74C3C);
                       border-radius:3px">
                    <div style="position:absolute;left:50%;top:0;width:2px;height:100%;
                         background:white;z-index:2"></div>
                    <div style="position:absolute;left:{pos}%;top:50%;
                         transform:translate(-50%,-50%);width:8px;height:8px;
                         background:black;border:2px solid white;border-radius:50%;
                         z-index:3"></div>
                  </div>
                </div>"""
            elif tmax is not None:
                temp_bars_html += f'<div style="margin:8px 0"><b>Tagestemperatur:</b> {tmax:.1f}°C</div>'
            else:
                temp_bars_html += '<div style="margin:8px 0"><b>Tagestemperatur:</b> N/A</div>'
            
            prcp_v  = temps[2]
            wspd_v  = temps[3]
            wdir_v  = temps[4]
            wspdR_v = temps[5]
            rain_html = (f"<br><b>Regen:</b> {prcp_v:.1f} mm" if prcp_v is not None
                         else "<br><b>Regen:</b> N/A")
            wind_lines = []
            if wspd_v is not None:
                wind_lines.append(f"{wspd_v:.1f} km/h")
            if wdir_v is not None:
                wind_lines.append(f"{wdir_v:.0f}° {_compass_dir(wdir_v)}")
            if wspdR_v is not None:
                wind_lines.append(f"<i>gewichtet: {wspdR_v:.1f} km/h</i>")
            wind_html = ("<br><b>Wind:</b><br>&nbsp;&nbsp;" + "<br>&nbsp;&nbsp;".join(wind_lines)
                         if wind_lines else "")
            other_weather_info = rain_html + wind_html
            
            date_str = (datetime(2024, 1, 1) + timedelta(days=day - 1)).strftime("%b %d")
            popup = f"""
            <div style="font-family:Arial,sans-serif;min-width:200px">
              <b>Stadt:</b> {city_name}<br>
              <b>Datum:</b> {date_str}<br>
              <b>Tag:</b> {rel_day}<br>
              <b>Temp-Score:</b> {temp_score:.2f} (norm: {ns:.2f})
              <hr style="margin:8px 0">
              {temp_bars_html}
              <hr style="margin:8px 0">
              {other_weather_info}
            </div>"""
            popups.append(popup)
            
        except KeyError:
            continue
    
    if not route_locations:
        return None, "", []
    
    # Identify direct connection segments (flights, ferries, trains)
    connection_set = set()
    if connections:
        for a, b in connections:
            connection_set.add((a, b))
            connection_set.add((b, a))

    direct_segments = set()
    for i in range(len(route_locations) - 1):
        id_a = all_temps_data[i][0]
        id_b = all_temps_data[i + 1][0]
        if (id_a, id_b) in connection_set or (id_b, id_a) in connection_set:
            direct_segments.add(i)

    # Split the route into continuous road sub-routes at direct connection boundaries
    sub_routes = []
    current_start = 0
    for i in range(len(route_locations) - 1):
        if i in direct_segments:
            if current_start < i:
                sub_routes.append((current_start, i))
            current_start = i + 1
    if current_start < len(route_locations) - 1:
        sub_routes.append((current_start, len(route_locations) - 1))

    # One get_osrm_route call per sub-route — chunks are reused for everything below
    all_sub_chunks = []
    for start, end in sub_routes:
        all_sub_chunks.append(get_osrm_route(
            route_locations[start:end + 1], routing_mode=routing_mode,
            progress_callback=progress_callback
        ))

    # Road distances — direct_segments stay 0.0
    osrm_distances_km = [0.0] * (len(route_locations) - 1)
    for (start, end), chunks in zip(sub_routes, all_sub_chunks):
        sub_locs = route_locations[start:end + 1]
        for j, d in enumerate(compute_distances_from_chunks(chunks, sub_locs)):
            osrm_distances_km[start + j] = d

    # Single Open-Elevation call across all sub-routes for the elevation profile
    elevation_svg = ""
    if show_elevation:
        sub_route_data = [
            {
                'chunks': chunks,
                'locations': route_locations[start:end + 1],
                'city_names': city_names_ordered[start:end + 1],
                # (tmin, tmax, prcp) per city in this sub-route
                'city_temps': [
                    (all_temps_data[i][4][0],
                     all_temps_data[i][4][1],
                     all_temps_data[i][4][2] if len(all_temps_data[i][4]) > 2 else None)
                    for i in range(start, end + 1)
                ],
            }
            for (start, end), chunks in zip(sub_routes, all_sub_chunks)
        ]
        # Collect (city_id, abs_day) for each city in the elevation profile,
        # in the same order that build_combined_elevation_profile will produce
        # its city_data list (first city of each sub-route, then the rest).
        elev_city_id_day = [
            (all_temps_data[i][0], all_temps_data[i][1])
            for start, end in sub_routes
            for i in range(start, end + 1)
        ]

        elev_data = build_combined_elevation_profile(
            sub_route_data, points_per_1000km=elev_points_per_1000km
        )
        if elev_data:
            # Pre-compute city temperatures for offsets −30 … +30 days so the
            # elevation profile can show an interactive start-day slider.
            city_data_by_offset = {}
            for d in range(-30, 31):
                temps_for_d = []
                for city_id, day in elev_city_id_day:
                    cal_day = ((day + d - 1) % 365) + 1
                    try:
                        w = get_interpolated_weather(city_id, cal_day, temperatures)
                        temps_for_d.append({
                            "tmin": round(float(w[0]), 2) if w[0] is not None else None,
                            "tmax": round(float(w[1]), 2) if w[1] is not None else None,
                            "prcp": round(float(w[2]), 2)
                                    if len(w) > 2 and w[2] is not None else None,
                        })
                    except Exception:
                        temps_for_d.append({"tmin": None, "tmax": None, "prcp": None})
                city_data_by_offset[d] = temps_for_d

            elevation_svg = build_elevation_svg(
                elev_data,
                desired_low_temp=desired_low_temp if desired_low_temp is not None else 12.0,
                desired_high_temp=desired_high_temp if desired_high_temp is not None else 25.0,
                city_data_by_offset=city_data_by_offset,
                city_abs_days=[day for _, day in elev_city_id_day],
            )
    
    # Create map
    center_lat = sum(c[0] for c in route_locations) / len(route_locations)
    center_lon = sum(c[1] for c in route_locations) / len(route_locations)
    m = folium.Map(location=[center_lat, center_lon], zoom_start=5)
    
    zoom_script = """
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        var checkMap = setInterval(function() {
            for (var id in window) {
                if (id.startsWith('map_') && window[id] && window[id].on) {
                    var lm = window[id]; clearInterval(checkMap);
                    updateSizes(lm.getZoom());
                    lm.on('zoomend', function() { updateSizes(lm.getZoom()); });
                    break;
                }
            }
        }, 100);
        function updateSizes(zoom) {
            // Minimal scaling, capped at 2× base size
            var s = Math.min(2.0, Math.pow(1.15, zoom - 5));

            // Month labels
            document.querySelectorAll('.month-label').forEach(function(el) {
                el.style.fontSize=(11*s)+'px';
                el.style.padding=(4*s)+'px '+(10*s)+'px';
                el.style.minWidth=(40*s)+'px'; el.style.borderWidth=(2*s)+'px';
                el.style.borderRadius=(6*s)+'px';
            });

            // City day-marker pins – grow from bottom-center (pin tip = map point)
            document.querySelectorAll('.day-marker-wrap').forEach(function(el) {
                el.style.transform = 'scale('+s+')';
                el.style.transformOrigin = '50% 100%';
            });

            // Wind arrows – grow from bottom-left (near city marker)
            document.querySelectorAll('.wind-arrow').forEach(function(el) {
                el.style.transform = 'scale('+s+')';
                el.style.transformOrigin = '0% 100%';
            });
        }
    });
    </script>"""
    m.get_root().html.add_child(folium.Element(zoom_script))
    
    # Add markers
    for idx, ((lat, lon), popup, rel_day, (wdir, wspd), ns) in enumerate(zip(
            route_locations, popups, relative_days, wind_data, temp_scores)):

        if ns < 0.5:
            r = int(ns * 2 * 255); g = 200; b = 50
        else:
            r = 255; g = int((1 - (ns - 0.5) * 2) * 200); b = 50

        # ── Day marker: small pin with tail ──────────────────────────────
        folium.Marker(
            location=[lat, lon],
            popup=folium.Popup(popup, max_width=300),
            icon=folium.DivIcon(
                html=f'''
                <div class="day-marker-wrap" style="display:flex;flex-direction:column;align-items:center;">
                  <div class="day-marker" style="
                      background-color:rgb({r},{g},{b});border:2px solid white;
                      border-radius:50%;width:26px;height:26px;display:flex;
                      align-items:center;justify-content:center;font-weight:700;
                      color:white;font-size:10px;
                      box-shadow:0 2px 6px rgba(0,0,0,0.45);z-index:1000">{rel_day}</div>
                  <div class="day-marker-pin" style="
                      width:0;height:0;
                      border-left:5px solid transparent;
                      border-right:5px solid transparent;
                      border-top:8px solid rgb({r},{g},{b})"></div>
                </div>''',
                icon_size=(26, 34),
                icon_anchor=(13, 34),
            )
        ).add_to(m)

        # ── Wind arrow: direction + strength ─────────────────────────────
        if wdir is not None and wspd is not None:
            # meteorological convention: wind FROM wdir → arrow points TO wdir+180
            rotation = (wdir + 180) % 360

            # Color by speed (m/s)
            if   wspd < 3:  wc = '#74b9ff'  # calm  – light blue
            elif wspd < 7:  wc = '#2ecc71'  # light – green
            elif wspd < 12: wc = '#f1c40f'  # mod.  – yellow
            elif wspd < 18: wc = '#e67e22'  # strong – orange
            else:           wc = '#e74c3c'  # storm  – red

            # Number of arrows indicates wind strength
            n_arrows = 1
            if wspd >= 3:  n_arrows = 2
            if wspd >= 7:  n_arrows = 3
            if wspd >= 12: n_arrows = 4

            aw = 14   # per-arrow horizontal slot (px) – wide enough for a clear head
            gap = 4   # gap between arrows (px)
            svg_w = n_arrows * aw + (n_arrows - 1) * gap
            svg_h = 30
            cx_svg = svg_w / 2
            cy_svg = svg_h / 2

            arrows_path = ''
            for ai in range(n_arrows):
                cx = ai * (aw + gap) + aw // 2
                # Head: wide triangle, tip at y=3, base at y=14 (±6 px)
                # Shaft: rect 4 px wide, from y=14 to y=27
                arrows_path += (
                    f'<polygon points="{cx},3 {cx-6},14 {cx+6},14"'
                    f' fill="{wc}" filter="url(#wf{idx})"/>'
                    f'<rect x="{cx-2}" y="14" width="4" height="13" rx="1"'
                    f' fill="{wc}" filter="url(#wf{idx})"/>'
                )

            folium.Marker(
                location=[lat, lon],
                icon=folium.DivIcon(html=f'''
                    <div class="wind-arrow" style="
                        z-index:999;margin-left:5px;margin-top:-30px;
                        display:inline-flex;flex-direction:column;
                        align-items:center;gap:2px">
                      <!-- Speed label at top = further from city = at arrow tip side -->
                      <div style="font-size:11px;font-weight:700;color:{wc};
                           background:rgba(10,20,30,0.82);border-radius:4px;
                           padding:1px 5px;white-space:nowrap;line-height:1.5">
                        {wspd:.0f}\u202fkm/h
                      </div>
                      <!-- Arrows rotate inside SVG; container stays upright -->
                      <svg width="{svg_w}" height="{svg_h}"
                           viewBox="0 0 {svg_w} {svg_h}" fill="none"
                           overflow="visible"
                           style="transform:rotate({rotation}deg);
                                  transform-origin:{cx_svg}px {cy_svg}px">
                        <defs>
                          <filter id="wf{idx}" x="-50%" y="-50%" width="200%" height="200%">
                            <feDropShadow dx="0" dy="0" stdDeviation="1.2"
                                          flood-color="black" flood-opacity="0.75"/>
                          </filter>
                        </defs>
                        {arrows_path}
                      </svg>
                    </div>''',
                    icon_size=(svg_w + 20, 52),
                    icon_anchor=(0, 52),
                )
            ).add_to(m)
    
    # Month labels
    month_names = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
    for i in range(len(route) - 1):
        _, day1, _, _ = route[i]
        _, day2, _, _ = route[i + 1]
        date1 = datetime(2024, 1, 1) + timedelta(days=day1 - 1)
        date2 = datetime(2024, 1, 1) + timedelta(days=day2 - 1)
        if date1.month != date2.month:
            m2 = date2.month
            days_in_month = [31,29,31,30,31,30,31,31,30,31,30,31]
            cd = sum(days_in_month[:m2-1]) + 1
            t = max(0, min(1, (cd - day1) / (day2 - day1))) if day2 > day1 else 0.5
            lat1, lon1 = route_locations[i]
            lat2, lon2 = route_locations[i + 1]
            folium.Marker(
                location=[lat1+t*(lat2-lat1), lon1+t*(lon2-lon1)],
                icon=folium.DivIcon(html=f'''
                    <div class="month-label" style="
                        background-color:rgba(46,204,113,0.95);
                        border:2px solid #27AE60;border-radius:6px;
                        padding:4px 10px;font-weight:bold;color:white;
                        font-size:11px;box-shadow:0 2px 5px rgba(0,0,0,0.3);
                        white-space:nowrap;z-index:1001;transition:all 0.3s ease;
                        min-width:40px;text-align:center">{month_names[m2-1]}</div>''')
            ).add_to(m)
    
    # Draw road routes using pre-fetched chunks (no additional OSRM call)
    for sub_chunks in all_sub_chunks:
        for chunk in sub_chunks:
            folium.plugins.AntPath(
                locations=chunk,
                color='#E74C3C', weight=3, opacity=0.8,
                delay=800, dash_array=[10, 20]
            ).add_to(m)

    # Draw direct connections as straight dashed lines
    for i in direct_segments:
        lat1, lon1 = route_locations[i]
        lat2, lon2 = route_locations[i + 1]
        folium.PolyLine(
            locations=[[lat1, lon1], [lat2, lon2]],
            color='#4fc3f7', weight=2, opacity=0.7, dash_array='8 6'
        ).add_to(m)
        mid_lat = (lat1 + lat2) / 2
        mid_lon = (lon1 + lon2) / 2
        folium.Marker(
            location=[mid_lat, mid_lon],
            icon=folium.DivIcon(html='''
                <div style="background:rgba(79,195,247,0.85);border:1px solid #0288d1;
                    border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;
                    color:#000;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3)">
                    ✈ / ⛴</div>''')
        ).add_to(m)

    # Add mini elevation chart overlay if elevation data is available
    if elev_data:
        profile  = elev_data["profile"]
        latlons  = elev_data.get("profile_latlons", [])
        city_data_elev = elev_data["city_data"]
        if latlons and len(latlons) == len(profile):
            # Subsample every 3rd point for a compact payload
            mini_elev = [
                [round(km, 2), round(lat, 5), round(lon, 5), round(ele, 1)]
                for (km, ele), (lat, lon) in zip(profile, latlons)
            ][::3]
            mini_cities = []
            for cd in city_data_elev:
                lat, lon = _km_to_latlon(cd["km"], profile, latlons)
                mini_cities.append({
                    "name": cd["name"],
                    "km":   round(cd["km"], 2),
                    "lat":  round(lat, 5),
                    "lon":  round(lon, 5),
                    "tmin": cd["tmin"] if cd["tmin"] is not None else 0.0,
                    "tmax": cd["tmax"] if cd["tmax"] is not None else 0.0,
                    "prcp": cd["prcp"] if cd["prcp"] is not None else 0.0,
                    "ele":  round(cd["ele"], 1) if cd["ele"] is not None else 0.0,
                })
            dh = desired_high_temp if desired_high_temp is not None else 25.0
            dl = desired_low_temp  if desired_low_temp  is not None else 12.0
            MiniElevationControl(
                json.dumps(mini_elev),
                json.dumps(mini_cities),
                dh, dl
            ).add_to(m)

    return m, elevation_svg, osrm_distances_km


def create_loading_route_map(graph, temperatures, route, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp):
    """
    Returns compact JSON-serializable city data for the loading page map.
    {"cities": [{lat, lon, name, rel_day, day, color, tmin, tmax}, ...], "center": [lat, lon]}
    """
    start_day = route[0][1] if route else 0

    all_temps_data = []
    for city_id, day, city_name, distance in route:
        try:
            graph.nodes[city_id]  # ensure node exists
            temps = get_interpolated_weather(city_id, day, temperatures)
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


# Legacy full-map version (kept for reference, not used by app.py)
def _create_loading_route_map_legacy(graph, temperatures, route, exp, desired_low_temp, desired_high_temp,
                    min_low_temp, max_low_temp, min_high_temp, max_high_temp):
    """Create Folium map with route markers showing dates and temperatures"""
    route_locations = []
    popups = []
    relative_days = []
    wind_data = []
    temp_scores = []
    weather_params = ['tmin', 'tmax', 'prcp', 'wspd', 'wdir', 'wspd_resultant']
    
    # Get start day from first city
    start_day = route[0][1] if route else 0
    
    # First pass: collect all temperature scores for normalization
    all_temps_data = []
    for city_id, day, city_name, distance in route:
        try:
            node_data = graph.nodes[city_id]
            temps = get_interpolated_weather(city_id, day, temperatures)
            temp_score, violated = calculate_temperature_score(
                temps, exp, desired_low_temp, desired_high_temp,
                min_low_temp, max_low_temp, min_high_temp, max_high_temp
            )
            all_temps_data.append((city_id, day, city_name, distance, temps, temp_score, violated))
        except KeyError:
            continue
    
    if not all_temps_data:
        return None
    
    # Normalize temperature scores to 0-1 range
    scores_only = [data[5] for data in all_temps_data]
    min_score = min(scores_only)
    max_score = max(scores_only)
    score_range = max_score - min_score if max_score > min_score else 1
    
    # Second pass: create markers with normalized colors
    for city_id, day, city_name, distance, temps, temp_score, violated in all_temps_data:
        try:
            node_data = graph.nodes[city_id]
            lat = node_data['lat']
            lon = node_data['lon']
            route_locations.append((lat, lon))
            
            # Calculate relative day
            rel_day = day - start_day
            relative_days.append(rel_day)
            
            # Normalize score (0 = best/green, 1 = worst/red)
            normalized_score = (temp_score - min_score) / score_range
            temp_scores.append(normalized_score)
            
            # Calculate color based on normalized score (green -> yellow -> red)
            if normalized_score < 0.5:
                # Green to Yellow
                r = int(normalized_score * 2 * 255)
                g = 200
                b = 50
            else:
                # Yellow to Red
                r = 255
                g = int((1 - (normalized_score - 0.5) * 2) * 200)
                b = 50
            
            marker_color = f"rgb({r}, {g}, {b})"
            
            # Store wind data
            wdir = temps[4] if temps[4] is not None else None
            wspd_resultant = temps[5] if temps[5] is not None else None
            wind_data.append((wdir, wspd_resultant))
            
            # Create temperature bars for tmin and tmax
            tmin = temps[0] if temps[0] is not None else None
            tmax = temps[1] if temps[1] is not None else None
            
            temp_bars_html = ""
            
            # Temperature bar for tmin
            if tmin is not None and desired_low_temp is not None:
                # Calculate position and deviation
                tmin_deviation = tmin - desired_low_temp
                tmin_bar_color = "#3498DB" if abs(tmin_deviation) < 5 else "#E74C3C"
                
                # Scale for bar (range: desired_low_temp ± 20°C)
                bar_range = 40
                tmin_position = ((tmin - (desired_low_temp - 20)) / bar_range) * 100
                tmin_position = max(0, min(100, tmin_position))
                desired_low_position = 50  # Center at desired temp
                
                temp_bars_html += f"""
                <div style="margin: 8px 0;">
                    <div style="font-size: 11px; margin-bottom: 3px;"><b>Nachttemperatur:</b> {tmin:.1f}°C (Ziel: {desired_low_temp:.1f}°C)</div>
                    <div style="position: relative; width: 100%; height: 20px; background: linear-gradient(to right, #3498DB, #95A5A6, #E74C3C); border-radius: 3px;">
                        <div style="position: absolute; left: {desired_low_position}%; top: 0; width: 2px; height: 100%; background: white; z-index: 2;"></div>
                        <div style="position: absolute; left: {tmin_position}%; top: 50%; transform: translate(-50%, -50%); width: 8px; height: 8px; background: black; border: 2px solid white; border-radius: 50%; z-index: 3;"></div>
                    </div>
                </div>
                """
            elif tmin is not None:
                temp_bars_html += f"""<div style="margin: 8px 0;"><b>Nachttemperatur:</b> {tmin:.1f}°C</div>"""
            else:
                temp_bars_html += f"""<div style="margin: 8px 0;"><b>Nachttemperatur:</b> N/A</div>"""
            
            # Temperature bar for tmax
            if tmax is not None and desired_high_temp is not None:
                tmax_deviation = tmax - desired_high_temp
                tmax_bar_color = "#E67E22" if abs(tmax_deviation) < 5 else "#E74C3C"
                
                # Scale for bar (range: desired_high_temp ± 20°C)
                bar_range = 40
                tmax_position = ((tmax - (desired_high_temp - 20)) / bar_range) * 100
                tmax_position = max(0, min(100, tmax_position))
                desired_high_position = 50  # Center at desired temp
                
                temp_bars_html += f"""
                <div style="margin: 8px 0;">
                    <div style="font-size: 11px; margin-bottom: 3px;"><b>Tagestemperatur:</b> {tmax:.1f}°C (Ziel: {desired_high_temp:.1f}°C)</div>
                    <div style="position: relative; width: 100%; height: 20px; background: linear-gradient(to right, #3498DB, #F39C12, #E74C3C); border-radius: 3px;">
                        <div style="position: absolute; left: {desired_high_position}%; top: 0; width: 2px; height: 100%; background: white; z-index: 2;"></div>
                        <div style="position: absolute; left: {tmax_position}%; top: 50%; transform: translate(-50%, -50%); width: 8px; height: 8px; background: black; border: 2px solid white; border-radius: 50%; z-index: 3;"></div>
                    </div>
                </div>
                """
            elif tmax is not None:
                temp_bars_html += f"""<div style="margin: 8px 0;"><b>Tagestemperatur:</b> {tmax:.1f}°C</div>"""
            else:
                temp_bars_html += f"""<div style="margin: 8px 0;"><b>Tagestemperatur:</b> N/A</div>"""
            
            # Build remaining weather info string
            prcp_v  = temps[2]
            wspd_v  = temps[3]
            wdir_v  = temps[4]
            wspdR_v = temps[5]
            rain_html = (f"<br><b>Regen:</b> {prcp_v:.1f} mm" if prcp_v is not None
                         else "<br><b>Regen:</b> N/A")
            wind_lines = []
            if wspd_v is not None:
                wind_lines.append(f"{wspd_v:.1f} km/h")
            if wdir_v is not None:
                wind_lines.append(f"{wdir_v:.0f}° {_compass_dir(wdir_v)}")
            if wspdR_v is not None:
                wind_lines.append(f"<i>gewichtet: {wspdR_v:.1f} km/h</i>")
            wind_html = ("<br><b>Wind:</b><br>&nbsp;&nbsp;" + "<br>&nbsp;&nbsp;".join(wind_lines)
                         if wind_lines else "")
            other_weather_info = rain_html + wind_html
            
            date_str = (datetime(2024, 1, 1) + timedelta(days=day-1)).strftime("%b %d")
            popup = f"""
            <div style="font-family: Arial, sans-serif; min-width: 200px;">
                <b>Stadt:</b> {city_name}<br>
                <b>Datum:</b> {date_str}<br>
                <b>Tag:</b> {rel_day}<br>
                <b>Temp-Score:</b> {temp_score:.2f} (norm: {normalized_score:.2f})
                <hr style="margin: 8px 0;">
                {temp_bars_html}
                <hr style="margin: 8px 0;">
                {other_weather_info}
            </div>
            """
            popups.append(popup)
            
        except KeyError:
            continue

    if not route_locations:
        return None

    # Create map
    center_lat = sum(coord[0] for coord in route_locations) / len(route_locations)
    center_lon = sum(coord[1] for coord in route_locations) / len(route_locations)
    m = folium.Map(location=[center_lat, center_lon], zoom_start=5)

    # Add custom CSS and JavaScript for zoom-dependent sizing
    zoom_script = """
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        var map = null;
        
        // Find the map object
        var checkMap = setInterval(function() {
            var mapDiv = document.querySelector('.folium-map');
            if (mapDiv && mapDiv._leaflet_id) {
                map = mapDiv;
                clearInterval(checkMap);
                
                // Get all Leaflet maps
                for (var id in window) {
                    if (id.startsWith('map_')) {
                        var leafletMap = window[id];
                        if (leafletMap && leafletMap.on) {
                            updateSizes(leafletMap.getZoom());
                            leafletMap.on('zoomend', function() {
                                updateSizes(leafletMap.getZoom());
                            });
                            break;
                        }
                    }
                }
            }
        }, 100);
        
        function updateSizes(zoom) {
            // Scale factor based on zoom level (exponential scaling)
            var scaleFactor = Math.pow(1.4, zoom - 5);
            
            // Update arrow sizes
            var arrowBaseSize = 30;
            var arrowSize = arrowBaseSize * scaleFactor;
            var arrows = document.querySelectorAll('.wind-arrow');
            arrows.forEach(function(arrow) {
                arrow.style.width = arrowSize + 'px';
                arrow.style.height = arrowSize + 'px';
                arrow.style.marginLeft = -(arrowSize/2) + 'px';
                arrow.style.marginTop = -(arrowSize/2) + 'px';
            });
            
            // Update day marker sizes
            var markerBaseSize = 35;
            var markerSize = markerBaseSize * scaleFactor;
            var fontSize = 14 * scaleFactor;
            var borderWidth = 3 * scaleFactor;
            
            var dayMarkers = document.querySelectorAll('.day-marker');
            dayMarkers.forEach(function(marker) {
                marker.style.width = markerSize + 'px';
                marker.style.height = markerSize + 'px';
                marker.style.fontSize = fontSize + 'px';
                marker.style.borderWidth = borderWidth + 'px';
            });
            
            // Update month label sizes
            var monthFontSize = 11 * scaleFactor;
            var monthPaddingVertical = 4 * scaleFactor;
            var monthPaddingHorizontal = 10 * scaleFactor;
            var monthMinWidth = 40 * scaleFactor;
            var monthBorderWidth = 2 * scaleFactor;
            var monthBorderRadius = 6 * scaleFactor;
            
            var monthLabels = document.querySelectorAll('.month-label');
            monthLabels.forEach(function(label) {
                label.style.fontSize = monthFontSize + 'px';
                label.style.padding = monthPaddingVertical + 'px ' + monthPaddingHorizontal + 'px';
                label.style.minWidth = monthMinWidth + 'px';
                label.style.borderWidth = monthBorderWidth + 'px';
                label.style.borderRadius = monthBorderRadius + 'px';
            });
        }
    });
    </script>
    """
    m.get_root().html.add_child(folium.Element(zoom_script))

    # Add markers with popups, relative days, and color-coded backgrounds
    for i, ((lat, lon), popup, rel_day, (wdir, wspd), norm_score) in enumerate(zip(route_locations, popups, relative_days, wind_data, temp_scores)):
        # Calculate color based on normalized score
        if norm_score < 0.5:
            r = int(norm_score * 2 * 255)
            g = 200
            b = 50
        else:
            r = 255
            g = int((1 - (norm_score - 0.5) * 2) * 200)
            b = 50
        
        marker_color = f"rgb({r}, {g}, {b})"
        
        # Add day marker with dynamic color
        folium.Marker(
            location=[lat, lon],
            popup=folium.Popup(popup, max_width=300),
            icon=folium.DivIcon(html=f'''
                <div class="day-marker" style="
                    background-color: {marker_color};
                    border: 3px solid white;
                    border-radius: 50%;
                    width: 35px;
                    height: 35px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    color: white;
                    font-size: 14px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                    z-index: 1000;
                    transition: all 0.3s ease;
                ">{rel_day}</div>
            ''')
        ).add_to(m)
        
        # Add wind arrow if wind data is available
        if wdir is not None and wspd is not None:
            rotation = (270 - wdir) % 360
            
            folium.Marker(
                location=[lat, lon],
                icon=folium.DivIcon(html=f'''
                    <div class="wind-arrow" style="
                        position: relative;
                        width: 30px;
                        height: 30px;
                        transform: rotate({rotation}deg);
                        transform-origin: center;
                        margin-left: -15px;
                        margin-top: -15px;
                        transition: all 0.3s ease;
                        z-index: 999;
                    ">
                        <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L12 20M12 20L5 13M12 20L19 13" 
                                  stroke="#2ECC71" 
                                  stroke-width="2.5" 
                                  stroke-linecap="round" 
                                  stroke-linejoin="round"
                                  filter="url(#shadow)"/>
                            <defs>
                                <filter id="shadow">
                                    <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.5"/>
                                </filter>
                            </defs>
                        </svg>
                    </div>
                ''')
            ).add_to(m)

    # Add month change markers
    month_names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
    
    for i in range(len(route) - 1):
        city_id1, day1, city_name1, distance1 = route[i]
        city_id2, day2, city_name2, distance2 = route[i + 1]
        
        date1 = datetime(2024, 1, 1) + timedelta(days=day1-1)
        date2 = datetime(2024, 1, 1) + timedelta(days=day2-1)
        month1 = date1.month
        month2 = date2.month
        
        if month1 != month2:
            days_in_month = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            cumulative_days = sum(days_in_month[:month2-1]) + 1
            
            if day2 > day1:
                t = (cumulative_days - day1) / (day2 - day1)
                t = max(0, min(1, t))
            else:
                t = 0.5
            
            lat1, lon1 = route_locations[i]
            lat2, lon2 = route_locations[i + 1]
            month_lat = lat1 + t * (lat2 - lat1)
            month_lon = lon1 + t * (lon2 - lon1)
            
            month_label = month_names[month2 - 1]
            folium.Marker(
                location=[month_lat, month_lon],
                icon=folium.DivIcon(html=f'''
                    <div class="month-label" style="
                        background-color: rgba(46, 204, 113, 0.95);
                        border: 2px solid #27AE60;
                        border-radius: 6px;
                        padding: 4px 10px;
                        font-weight: bold;
                        color: white;
                        font-size: 11px;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                        white-space: nowrap;
                        z-index: 1001;
                        transition: all 0.3s ease;
                        min-width: 40px;
                        text-align: center;
                    ">{month_label}</div>
                ''')
            ).add_to(m)

    # Add animated polyline with arrows
    folium.PolyLine(
        route_locations,
        color='#E74C3C',
        weight=3,
        opacity=0.8,
        smooth_factor=1
    ).add_to(m)
    
    for i in range(len(route_locations) - 1):
        folium.plugins.AntPath(
            locations=[route_locations[i], route_locations[i + 1]],
            color='#E74C3C',
            weight=3,
            opacity=0.8,
            delay=800,
            dash_array=[10, 20]
        ).add_to(m)

    return m

