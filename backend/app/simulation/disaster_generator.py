"""Deterministic generator for SIMULATION / DEMO disaster scenarios.

Coordinates, populations and demands are entirely synthetic. The base scenario
uses six zones (Alpha..Foxtrot) with a central supply depot and a small road
network so that road-block simulation and re-optimisation are meaningful.
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Dict, List

from app.models.schemas import (
    DisasterType,
    Resources,
    Road,
    Scenario,
    SeverityLevel,
    Zone,
)
from app.utils.priority import assign_priority_scores

DEPOT_ID = "DEPOT"

# Synthetic geographic centre for the demo region.
CENTER_LAT = 21.15
CENTER_LON = 79.10

DEFAULT_RESOURCE_COSTS: Dict[str, float] = {
    "ambulances": 1200.0,
    "rescue_teams": 900.0,
    "medical_kits": 150.0,
    "food_units": 40.0,
    "shelter_capacity": 25.0,
    "emergency_vehicles": 700.0,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _base_zones() -> List[Zone]:
    zones = [
        Zone(
            id="zone_alpha",
            name="Alpha",
            latitude=CENTER_LAT + 0.10,
            longitude=CENTER_LON + 0.02,
            population=42000,
            severity=SeverityLevel.critical,
            children=9000,
            elderly=5200,
            disabled=1400,
            medical_demand=320,
            food_demand=1800,
            rescue_demand=90,
            priority_score=0.0,
            hospital_capacity=400,
            hospital_occupancy=340,
            shelter_capacity=1200,
            shelter_occupancy=900,
            road_accessibility=1.0,
        ),
        Zone(
            id="zone_bravo",
            name="Bravo",
            latitude=CENTER_LAT + 0.04,
            longitude=CENTER_LON - 0.11,
            population=27000,
            severity=SeverityLevel.high,
            children=5600,
            elderly=3100,
            disabled=900,
            medical_demand=210,
            food_demand=1400,
            rescue_demand=55,
            priority_score=0.0,
            hospital_capacity=260,
            hospital_occupancy=190,
            shelter_capacity=900,
            shelter_occupancy=500,
            road_accessibility=0.9,
        ),
        Zone(
            id="zone_charlie",
            name="Charlie",
            latitude=CENTER_LAT - 0.08,
            longitude=CENTER_LON + 0.09,
            population=18500,
            severity=SeverityLevel.high,
            children=3900,
            elderly=2400,
            disabled=700,
            medical_demand=180,
            food_demand=1000,
            rescue_demand=70,
            priority_score=0.0,
            hospital_capacity=200,
            hospital_occupancy=170,
            shelter_capacity=600,
            shelter_occupancy=420,
            road_accessibility=0.75,
        ),
        Zone(
            id="zone_delta",
            name="Delta",
            latitude=CENTER_LAT - 0.05,
            longitude=CENTER_LON - 0.08,
            population=12000,
            severity=SeverityLevel.moderate,
            children=2300,
            elderly=1700,
            disabled=400,
            medical_demand=95,
            food_demand=700,
            rescue_demand=30,
            priority_score=0.0,
            hospital_capacity=150,
            hospital_occupancy=80,
            shelter_capacity=500,
            shelter_occupancy=200,
            road_accessibility=1.0,
        ),
        Zone(
            id="zone_echo",
            name="Echo",
            latitude=CENTER_LAT + 0.12,
            longitude=CENTER_LON - 0.05,
            population=9000,
            severity=SeverityLevel.moderate,
            children=1700,
            elderly=1300,
            disabled=350,
            medical_demand=70,
            food_demand=520,
            rescue_demand=25,
            priority_score=0.0,
            hospital_capacity=120,
            hospital_occupancy=60,
            shelter_capacity=400,
            shelter_occupancy=150,
            road_accessibility=0.6,
        ),
        Zone(
            id="zone_foxtrot",
            name="Foxtrot",
            latitude=CENTER_LAT - 0.12,
            longitude=CENTER_LON + 0.01,
            population=6500,
            severity=SeverityLevel.low,
            children=1100,
            elderly=900,
            disabled=200,
            medical_demand=40,
            food_demand=350,
            rescue_demand=12,
            priority_score=0.0,
            hospital_capacity=90,
            hospital_occupancy=30,
            shelter_capacity=300,
            shelter_occupancy=90,
            road_accessibility=1.0,
        ),
    ]
    return assign_priority_scores(zones)


def _base_resources() -> Resources:
    return Resources(
        ambulances=10,
        rescue_teams=8,
        medical_kits=600,
        food_units=3500,
        shelter_capacity=1500,
        emergency_vehicles=6,
    )


def _base_roads() -> List[Road]:
    # Primary spokes from the depot to every zone, plus a few cross links that
    # provide alternate routing when a primary road is blocked.
    roads = [
        Road(id="road_depot_alpha", source=DEPOT_ID, target="zone_alpha", distance_km=12.0, is_primary=True),
        Road(id="road_depot_bravo", source=DEPOT_ID, target="zone_bravo", distance_km=9.5, is_primary=True),
        Road(id="road_depot_charlie", source=DEPOT_ID, target="zone_charlie", distance_km=14.0, is_primary=True),
        Road(id="road_depot_delta", source=DEPOT_ID, target="zone_delta", distance_km=7.5, is_primary=True),
        Road(id="road_depot_echo", source=DEPOT_ID, target="zone_echo", distance_km=11.0, is_primary=True),
        Road(id="road_depot_foxtrot", source=DEPOT_ID, target="zone_foxtrot", distance_km=16.0, is_primary=True),
        Road(id="road_alpha_echo", source="zone_alpha", target="zone_echo", distance_km=6.0, is_primary=False),
        Road(id="road_bravo_delta", source="zone_bravo", target="zone_delta", distance_km=5.5, is_primary=False),
        Road(id="road_charlie_foxtrot", source="zone_charlie", target="zone_foxtrot", distance_km=8.0, is_primary=False),
    ]
    return roads


def build_base_scenario() -> Scenario:
    scenario = Scenario(
        id=f"scn_{uuid.uuid4().hex[:8]}",
        name="Regional Flood Response — Demo",
        disaster_type=DisasterType.flood,
        description=(
            "Simulated multi-zone flood event. Limited resources must be "
            "allocated across six affected zones subject to capacity, budget, "
            "accessibility and demand constraints."
        ),
        is_demo=True,
        budget=45000.0,
        zones=_base_zones(),
        resources=_base_resources(),
        roads=_base_roads(),
        resource_costs=dict(DEFAULT_RESOURCE_COSTS),
        created_at=_now(),
    )
    return scenario


def apply_preset(base: Scenario, preset: str) -> Scenario:
    """Return a NEW scenario derived from `base` for a What-If preset.

    Each preset changes actual input data (not just the UI). See spec section 15.
    """
    scenario = copy.deepcopy(base)
    scenario.id = f"scn_{uuid.uuid4().hex[:8]}"
    key = preset.strip().lower().replace(" ", "_")

    if key in ("normal", "normal_disaster"):
        scenario.name = "Normal Disaster"

    elif key in ("major_road_block", "road_block"):
        scenario.name = "Major Road Block"
        # Block the primary roads to the two highest-priority zones.
        ranked = sorted(scenario.zones, key=lambda z: z.priority_score, reverse=True)
        blocked_targets = {ranked[0].id, ranked[1].id} if len(ranked) >= 2 else set()
        for road in scenario.roads:
            if road.is_primary and road.target in blocked_targets:
                road.blocked = True

    elif key in ("resource_shortage", "30_resource_shortage", "30%_resource_shortage"):
        scenario.name = "30% Resource Shortage"
        r = scenario.resources
        scenario.resources = Resources(
            ambulances=int(r.ambulances * 0.7),
            rescue_teams=int(r.rescue_teams * 0.7),
            medical_kits=int(r.medical_kits * 0.7),
            food_units=int(r.food_units * 0.7),
            shelter_capacity=int(r.shelter_capacity * 0.7),
            emergency_vehicles=int(r.emergency_vehicles * 0.7),
        )

    elif key in ("hospital_capacity_reduced", "hospital_reduced"):
        scenario.name = "Hospital Capacity Reduced"
        for zone in scenario.zones:
            zone.hospital_capacity = int(zone.hospital_capacity * 0.5)
            zone.hospital_occupancy = min(zone.hospital_occupancy, zone.hospital_capacity)

    elif key in ("new_critical_zone",):
        scenario.name = "New Critical Zone"
        new_zone = Zone(
            id=f"zone_golf_{uuid.uuid4().hex[:4]}",
            name="Golf",
            latitude=CENTER_LAT + 0.02,
            longitude=CENTER_LON + 0.14,
            population=35000,
            severity=SeverityLevel.critical,
            children=7800,
            elderly=4600,
            disabled=1200,
            medical_demand=300,
            food_demand=1600,
            rescue_demand=85,
            priority_score=0.0,
            hospital_capacity=180,
            hospital_occupancy=165,
            shelter_capacity=500,
            shelter_occupancy=430,
            road_accessibility=0.8,
        )
        scenario.zones.append(new_zone)
        scenario.roads.append(
            Road(id=f"road_depot_{new_zone.id}", source=DEPOT_ID, target=new_zone.id,
                 distance_km=13.0, is_primary=True)
        )

    else:
        raise ValueError(f"Unknown preset: {preset}")

    # Recompute priority scores because underlying data changed.
    assign_priority_scores(scenario.zones)
    scenario.created_at = _now()
    return scenario


PRESET_KEYS = [
    "normal",
    "major_road_block",
    "resource_shortage",
    "hospital_capacity_reduced",
    "new_critical_zone",
]
