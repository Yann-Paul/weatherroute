"""Self-check for the POI-to-route distance helper (api_app._point_to_polyline_m).

Run directly: python test_poi_distance.py
"""

from api_app import _point_to_polyline_m

# A short, roughly east-west segment near 47°N.
ROUTE = [(47.0, 11.0), (47.0, 11.02)]

# Point sitting on the segment -> ~0 m.
assert _point_to_polyline_m(47.0, 11.01, ROUTE) < 1

# Point offset ~500 m north of the segment's midpoint.
d = _point_to_polyline_m(47.0037, 11.01, ROUTE)
assert 400 < d < 600, d

# Point beyond the segment's end clamps to the endpoint, not the infinite line.
d_end = _point_to_polyline_m(47.0, 11.05, ROUTE)
d_direct = _point_to_polyline_m(47.0, 11.05, [ROUTE[1]])
assert abs(d_end - d_direct) < 5, (d_end, d_direct)

# Multi-segment polyline picks the nearest of all segments, not just the first.
route2 = [(47.0, 11.0), (47.0, 11.02), (47.01, 11.02)]
near_second_segment = _point_to_polyline_m(47.005, 11.021, route2)
assert near_second_segment < 200, near_second_segment

# A single-point "polyline" falls back to straight-line distance.
d_single = _point_to_polyline_m(47.001, 11.0, [(47.0, 11.0)])
assert 100 < d_single < 120, d_single

print("ok")
