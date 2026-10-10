"""Fixed, read-only HISTORICAL disaster-response archive records.

These are SIMULATION / DEMO archive entries describing PAST, completed
responses — NOT live operations and NOT optimizer output. Each record embeds
the original scenario conditions (zones, resources, road network) and the final
allocation that was historically recorded for that event.

Nothing here is generated randomly or by a solver; every number is a static,
authored archive value. Loading a record as a new scenario hands the embedded
conditions to the REAL classical + QAOA pipeline (see api/historical.py).
"""
from __future__ import annotations

from typing import List, Tuple

from app.models.schemas import (
    DisasterType,
    HistoricalRecord,
    RecordedAllocationItem,
    Resources,
    Road,
    Scenario,
    SeverityLevel,
    Zone,
)
from app.optimization.objective import RESOURCE_PROFILES
from app.simulation.disaster_generator import DEFAULT_RESOURCE_COSTS, DEPOT_ID
from app.simulation.road_simulator import recompute_accessibility
from app.utils.priority import assign_priority_scores


def _z(
    zid: str,
    name: str,
    lat: float,
    lon: float,
    pop: int,
    sev: SeverityLevel,
    med: int,
    food: int,
    resc: int,
    hc: int,
    ho: int,
    sc: int,
    so: int,
) -> Zone:
    return Zone(
        id=zid,
        name=name,
        latitude=lat,
        longitude=lon,
        population=pop,
        severity=sev,
        children=pop // 5,
        elderly=pop // 9,
        disabled=pop // 30,
        medical_demand=med,
        food_demand=food,
        rescue_demand=resc,
        priority_score=0.0,
        hospital_capacity=hc,
        hospital_occupancy=ho,
        shelter_capacity=sc,
        shelter_occupancy=so,
        road_accessibility=1.0,
    )


def _spoke(zid: str, dist: float, blocked: bool = False, primary: bool = True) -> Road:
    return Road(
        id=f"road_depot_{zid}",
        source=DEPOT_ID,
        target=zid,
        distance_km=dist,
        blocked=blocked,
        is_primary=primary,
    )


def _link(a: str, b: str, dist: float, blocked: bool = False) -> Road:
    return Road(id=f"road_{a}__{b}", source=a, target=b, distance_km=dist, blocked=blocked, is_primary=False)


def _alloc(pairs: List[Tuple[str, str, str, int]]) -> List[RecordedAllocationItem]:
    items: List[RecordedAllocationItem] = []
    for resource, zone_id, zone_name, units in pairs:
        prof = RESOURCE_PROFILES.get(resource)
        label = prof.label if prof else resource
        items.append(
            RecordedAllocationItem(
                resource=resource,
                resource_label=label,
                zone_id=zone_id,
                zone_name=zone_name,
                units=units,
            )
        )
    return items


def _scenario(
    sid: str,
    name: str,
    dtype: DisasterType,
    description: str,
    budget: float,
    zones: List[Zone],
    resources: Resources,
    roads: List[Road],
) -> Scenario:
    assign_priority_scores(zones)
    scenario = Scenario(
        id=sid,
        name=name,
        disaster_type=dtype,
        description=description,
        is_demo=False,
        budget=budget,
        zones=zones,
        resources=resources,
        roads=roads,
        resource_costs=dict(DEFAULT_RESOURCE_COSTS),
        created_at="",
    )
    recompute_accessibility(scenario)
    return scenario


def _cyclone_amphan() -> HistoricalRecord:
    zones = [
        _z("c_port", "Port Town", 17.68, 83.30, 38000, SeverityLevel.critical, 300, 1700, 80, 360, 320, 1100, 880),
        _z("c_mangro", "Mangrove Delta", 17.55, 83.18, 22000, SeverityLevel.high, 180, 1200, 60, 220, 180, 800, 520),
        _z("c_kaling", "Kalingaapatnam", 17.42, 83.05, 16000, SeverityLevel.high, 150, 950, 45, 190, 150, 640, 430),
        _z("c_ulava", "Ulava Puram", 17.30, 83.22, 11000, SeverityLevel.moderate, 90, 640, 28, 140, 70, 460, 210),
        _z("c_sankha", "Sankha Islet", 17.20, 83.40, 5200, SeverityLevel.high, 60, 320, 22, 80, 74, 260, 240),
    ]
    resources = Resources(ambulances=12, rescue_teams=9, medical_kits=640, food_units=3600, shelter_capacity=1600, emergency_vehicles=7)
    roads = [
        _spoke("c_port", 11.0),
        _spoke("c_mangro", 13.5),
        _spoke("c_kaling", 16.0),
        _spoke("c_ulava", 9.0),
        _spoke("c_sankha", 21.0, blocked=True),  # causeway washed out
        _link("c_port", "c_mangro", 6.5),
        _link("c_kaling", "c_ulava", 7.0, blocked=True),
    ]
    scenario = _scenario(
        "hist_cyclone_amphan",
        "Cyclone Amphan Coastal Response",
        DisasterType.cyclone,
        "Recorded multi-zone cyclone response across a coastal district. Storm surge isolated the offshore islet and severed one inland link.",
        52000.0,
        zones,
        resources,
        roads,
    )
    allocation = _alloc([
        ("ambulances", "c_port", "Port Town", 4),
        ("ambulances", "c_mangro", "Mangrove Delta", 3),
        ("ambulances", "c_kaling", "Kalingaapatnam", 2),
        ("rescue_teams", "c_port", "Port Town", 3),
        ("rescue_teams", "c_mangro", "Mangrove Delta", 2),
        ("medical_kits", "c_port", "Port Town", 220),
        ("medical_kits", "c_mangro", "Mangrove Delta", 150),
        ("medical_kits", "c_kaling", "Kalingaapatnam", 120),
        ("medical_kits", "c_ulava", "Ulava Puram", 70),
        ("food_units", "c_port", "Port Town", 1300),
        ("food_units", "c_mangro", "Mangrove Delta", 900),
        ("food_units", "c_kaling", "Kalingaapatnam", 700),
        ("food_units", "c_ulava", "Ulava Puram", 450),
        ("shelter_capacity", "c_port", "Port Town", 700),
        ("shelter_capacity", "c_mangro", "Mangrove Delta", 450),
        ("shelter_capacity", "c_kaling", "Kalingaapatnam", 350),
        ("emergency_vehicles", "c_port", "Port Town", 3),
        ("emergency_vehicles", "c_mangro", "Mangrove Delta", 2),
    ])
    return HistoricalRecord(
        id="hr_cyclone_amphan",
        name="Cyclone Amphan Coastal Response",
        disaster_type=DisasterType.cyclone,
        location="Coastal And Pradesh, India",
        date="2023-05-26",
        status="completed",
        description="Completed archive response to a category-3 landfall. Allocation was executed over 6 days.",
        scenario=scenario,
        recorded_allocation=allocation,
    )


def _earthquake_kutch() -> HistoricalRecord:
    zones = [
        _z("e_bhuj", "Bhuj Ridge", 23.24, 69.67, 29000, SeverityLevel.critical, 260, 1400, 70, 300, 285, 900, 860),
        _z("e_mundra", "Mundra Flats", 22.84, 69.55, 17000, SeverityLevel.high, 140, 900, 40, 180, 150, 560, 470),
        _z("e_anjar", "Anjar Basin", 23.11, 69.99, 12500, SeverityLevel.moderate, 95, 700, 26, 150, 80, 480, 240),
        _z("e_rapar", "Rapar Corridor", 23.60, 69.80, 8000, SeverityLevel.high, 80, 460, 30, 110, 100, 320, 300),
    ]
    resources = Resources(ambulances=9, rescue_teams=11, medical_kits=520, food_units=2600, shelter_capacity=1300, emergency_vehicles=8)
    roads = [
        _spoke("e_bhuj", 14.0),
        _spoke("e_mundra", 18.5),
        _spoke("e_anjar", 10.0),
        _spoke("e_rapar", 22.0, blocked=True),  # landslide on mountain pass
        _link("e_bhuj", "e_anjar", 9.0),
        _link("e_mundra", "e_anjar", 6.0),
    ]
    scenario = _scenario(
        "hist_earthquake_kutch",
        "Kutch Inland Earthquake Response",
        DisasterType.earthquake,
        "Recorded response to a magnitude 6.1 inland quake. A mountain pass collapse cut the northern corridor off from the depot.",
        47000.0,
        zones,
        resources,
        roads,
    )
    allocation = _alloc([
        ("ambulances", "e_bhuj", "Bhuj Ridge", 4),
        ("ambulances", "e_mundra", "Mundra Flats", 2),
        ("ambulances", "e_anjar", "Anjar Basin", 2),
        ("rescue_teams", "e_bhuj", "Bhuj Ridge", 5),
        ("rescue_teams", "e_rapar", "Rapar Corridor", 3),
        ("rescue_teams", "e_mundra", "Mundra Flats", 2),
        ("medical_kits", "e_bhuj", "Bhuj Ridge", 210),
        ("medical_kits", "e_mundra", "Mundra Flats", 130),
        ("medical_kits", "e_anjar", "Anjar Basin", 95),
        ("food_units", "e_bhuj", "Bhuj Ridge", 1200),
        ("food_units", "e_mundra", "Mundra Flats", 760),
        ("food_units", "e_anjar", "Anjar Basin", 520),
        ("shelter_capacity", "e_bhuj", "Bhuj Ridge", 780),
        ("shelter_capacity", "e_rapar", "Rapar Corridor", 300),
        ("emergency_vehicles", "e_bhuj", "Bhuj Ridge", 3),
        ("emergency_vehicles", "e_rapar", "Rapar Corridor", 2),
    ])
    return HistoricalRecord(
        id="hr_earthquake_kutch",
        name="Kutch Inland Earthquake Response",
        disaster_type=DisasterType.earthquake,
        location="Kutch, Gujarat, India",
        date="2022-01-15",
        status="completed",
        description="Completed archive response. Heavy rescue was prioritised to collapsed structures; the cut-off corridor was reached by air.",
        scenario=scenario,
        recorded_allocation=allocation,
    )


def _wildfire_similipal() -> HistoricalRecord:
    zones = [
        _z("w_ridge", "Similipal Ridge", 22.05, 86.60, 14000, SeverityLevel.high, 120, 820, 55, 150, 120, 520, 470),
        _z("w_falls", "Barehpani Falls", 22.18, 86.48, 9000, SeverityLevel.critical, 95, 520, 40, 110, 105, 360, 350),
        _z("w_valley", "Nisanco Valley", 21.92, 86.72, 6500, SeverityLevel.moderate, 55, 380, 22, 90, 45, 300, 140),
    ]
    resources = Resources(ambulances=6, rescue_teams=7, medical_kits=340, food_units=1600, shelter_capacity=760, emergency_vehicles=5)
    roads = [
        _spoke("w_ridge", 15.0),
        _spoke("w_falls", 12.0, blocked=True),  # fire line closed the access road
        _spoke("w_valley", 9.5),
        _link("w_ridge", "w_valley", 7.0),
    ]
    scenario = _scenario(
        "hist_wildfire_similipal",
        "Similipal Ridge Wildfire Evacuation",
        DisasterType.wildfire,
        "Recorded forest-fire evacuation. The main falls access road was closed by the fire front, forcing routing through the valley.",
        28000.0,
        zones,
        resources,
        roads,
    )
    allocation = _alloc([
        ("ambulances", "w_ridge", "Similipal Ridge", 3),
        ("ambulances", "w_valley", "Nisanco Valley", 2),
        ("rescue_teams", "w_ridge", "Similipal Ridge", 4),
        ("rescue_teams", "w_falls", "Barehpani Falls", 2),
        ("medical_kits", "w_ridge", "Similipal Ridge", 140),
        ("medical_kits", "w_falls", "Barehpani Falls", 110),
        ("medical_kits", "w_valley", "Nisanco Valley", 60),
        ("food_units", "w_ridge", "Similipal Ridge", 620),
        ("food_units", "w_valley", "Nisanco Valley", 360),
        ("shelter_capacity", "w_ridge", "Similipal Ridge", 420),
        ("shelter_capacity", "w_valley", "Nisanco Valley", 260),
        ("emergency_vehicles", "w_ridge", "Similipal Ridge", 2),
    ])
    return HistoricalRecord(
        id="hr_wildfire_similipal",
        name="Similipal Ridge Wildfire Evacuation",
        disaster_type=DisasterType.wildfire,
        location="Mayurbhanj, Odisha, India",
        date="2021-04-18",
        status="historical",
        description="Archived evacuation response. The blocked access road is a defining constraint of this event.",
        scenario=scenario,
        recorded_allocation=allocation,
    )


def _accident_nh48() -> HistoricalRecord:
    zones = [
        _z("a_junction", "NH-48 Junction", 22.30, 73.20, 4200, SeverityLevel.critical, 160, 240, 30, 200, 190, 260, 250),
        _z("a_village", "Bedwa Village", 22.36, 73.32, 3100, SeverityLevel.high, 90, 210, 18, 120, 90, 200, 150),
        _z("a_township", "Sendhwa Township", 22.22, 73.10, 5600, SeverityLevel.moderate, 70, 300, 15, 140, 70, 320, 130),
    ]
    resources = Resources(ambulances=8, rescue_teams=5, medical_kits=260, food_units=900, shelter_capacity=520, emergency_vehicles=6)
    roads = [
        _spoke("a_junction", 4.0),
        _spoke("a_village", 7.5),
        _spoke("a_township", 6.0),
        _link("a_junction", "a_village", 3.5),
    ]
    scenario = _scenario(
        "hist_accident_nh48",
        "NH-48 Hazardous Spill Response",
        DisasterType.accident,
        "Recorded response to a tanker hazardous-materials spill at a highway junction, with a downwind residential zone.",
        19000.0,
        zones,
        resources,
        roads,
    )
    allocation = _alloc([
        ("ambulances", "a_junction", "NH-48 Junction", 5),
        ("ambulances", "a_village", "Bedwa Village", 2),
        ("rescue_teams", "a_junction", "NH-48 Junction", 3),
        ("medical_kits", "a_junction", "NH-48 Junction", 140),
        ("medical_kits", "a_village", "Bedwa Village", 80),
        ("medical_kits", "a_township", "Sendhwa Township", 40),
        ("food_units", "a_township", "Sendhwa Township", 300),
        ("food_units", "a_village", "Bedwa Village", 200),
        ("shelter_capacity", "a_township", "Sendhwa Township", 300),
        ("shelter_capacity", "a_village", "Bedwa Village", 150),
        ("emergency_vehicles", "a_junction", "NH-48 Junction", 4),
    ])
    return HistoricalRecord(
        id="hr_accident_nh48",
        name="NH-48 Hazardous Spill Response",
        disaster_type=DisasterType.accident,
        location="Burdwan, West Bengal corridor",
        date="2020-09-02",
        status="historical",
        description="Archived industrial-accident response. Casualty triage was concentrated at the junction; downwind zones were sheltered in place.",
        scenario=scenario,
        recorded_allocation=allocation,
    )


def build_historical_records() -> List[HistoricalRecord]:
    return [
        _cyclone_amphan(),
        _earthquake_kutch(),
        _wildfire_similipal(),
        _accident_nh48(),
    ]
