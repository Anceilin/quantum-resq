"""Road network simulation.

Builds an undirected weighted graph over the depot and zones, then computes
shortest *open* paths. When a road is blocked the graph changes, which changes
both the travel cost to each zone and its road_accessibility. This module is the
single source of truth so the optimiser always sees the changed scenario.
"""
from __future__ import annotations

import heapq
from typing import Dict, List, Tuple

from app.models.schemas import Road, Scenario, Zone
from app.simulation.disaster_generator import DEPOT_ID


def build_graph(roads: List[Road]) -> Dict[str, List[Tuple[str, float, str]]]:
    """Adjacency list of open roads: node -> [(neighbour, distance, road_id)]."""
    graph: Dict[str, List[Tuple[str, float, str]]] = {}
    for road in roads:
        if road.blocked:
            continue
        graph.setdefault(road.source, []).append((road.target, road.distance_km, road.id))
        graph.setdefault(road.target, []).append((road.source, road.distance_km, road.id))
    return graph


def dijkstra(graph: Dict[str, List[Tuple[str, float, str]]], start: str) -> Dict[str, float]:
    """Shortest open-path distance from `start` to every reachable node."""
    dist: Dict[str, float] = {start: 0.0}
    visited = set()
    heap: List[Tuple[float, str]] = [(0.0, start)]
    while heap:
        d, node = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)
        for neighbour, weight, _ in graph.get(node, []):
            nd = d + weight
            if nd < dist.get(neighbour, float("inf")):
                dist[neighbour] = nd
                heapq.heappush(heap, (nd, neighbour))
    return dist


def _primary_distance(roads: List[Road], zone_id: str) -> float:
    for road in roads:
        if road.is_primary and road.target == zone_id:
            return road.distance_km
    return 0.0


def recompute_accessibility(scenario: Scenario) -> Scenario:
    """Update each zone's road_accessibility from the current road block states.

    accessibility = clamp(ideal_distance / shortest_open_distance).
    1.0 when the direct road is open, <1 when a detour is required, 0 when the
    zone is unreachable. Mutates and returns the scenario.
    """
    graph = build_graph(scenario.roads)
    dist = dijkstra(graph, DEPOT_ID)
    for zone in scenario.zones:
        ideal = _primary_distance(scenario.roads, zone.id)
        actual = dist.get(zone.id)
        if actual is None or actual == float("inf"):
            zone.road_accessibility = 0.0
        elif ideal <= 0:
            zone.road_accessibility = 1.0
        else:
            zone.road_accessibility = round(max(0.0, min(1.0, ideal / actual)), 3)
    return scenario


def travel_costs(scenario: Scenario) -> Dict[str, float]:
    """Cheapest open travel cost (km) from the depot to each zone.

    Unreachable zones get float('inf') so the optimiser can exclude them.
    """
    graph = build_graph(scenario.roads)
    dist = dijkstra(graph, DEPOT_ID)
    costs: Dict[str, float] = {}
    for zone in scenario.zones:
        costs[zone.id] = dist.get(zone.id, float("inf"))
    return costs


def reachable_zone_ids(scenario: Scenario) -> List[str]:
    graph = build_graph(scenario.roads)
    dist = dijkstra(graph, DEPOT_ID)
    return [z.id for z in scenario.zones if z.id in dist]
