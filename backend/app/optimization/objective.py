"""Shared optimisation model: instance construction, objective and evaluation.

This module defines ONE canonical binary optimisation instance derived from a
scenario. Both the classical baseline and the QAOA pipeline consume this exact
same instance, objective and feasibility rules, so the head-to-head comparison
is apples-to-apples (spec sections 7, 8, 11).

Model
-----
Binary decision variable x[r][z] in {0,1}: "deploy one standard bundle of
resource r to zone z". A bundle is a fixed quantity of a resource (1 ambulance,
a pallet of medical kits, ...) so the number of binary variables stays small:

    n_vars = len(resources) * len(zones)   (target ~12-16 qubits)

Objective (MAXIMISE), separable per variable:

    net[r][z] = W_GAIN   * priority_norm[z] * demand_norm[r][z]
              - W_TRAVEL * travel_norm[z]
              - W_COST   * cost_norm[r]

Hard constraints (enforced exactly at decode / by the classical solver):
    * resource availability  : bundles assigned to r <= bundles_available[r]
    * budget                 : total currency cost <= budget
    * hospital capacity      : medical resources need hospital_remaining[z] > 0
    * shelter capacity       : shelter resource needs shelter_remaining[z] > 0
    * road accessibility     : unreachable zones cannot be served
    * zone demand            : no deployment where demand for r is zero
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from app.models.schemas import Scenario, SeverityLevel, Zone
from app.simulation.road_simulator import travel_costs

# Objective weights.
W_GAIN = 1.0
W_TRAVEL = 0.25
W_COST = 0.25

# How much shelter need each severity implies (fraction of population displaced).
DISPLACEMENT_RATE: Dict[SeverityLevel, float] = {
    SeverityLevel.critical: 0.25,
    SeverityLevel.high: 0.18,
    SeverityLevel.moderate: 0.10,
    SeverityLevel.low: 0.05,
}


@dataclass(frozen=True)
class ResourceProfile:
    key: str
    label: str
    demand_key: str          # zone attribute (or computed) this resource serves
    capacity_gate: Optional[str]  # "hospital" | "shelter" | None
    bundle_units: int        # resource units consumed per bundle
    bundle_service: int      # demand units satisfied per bundle


RESOURCE_PROFILES: Dict[str, ResourceProfile] = {
    "ambulances": ResourceProfile("ambulances", "Ambulance", "medical_demand", "hospital", 1, 30),
    "rescue_teams": ResourceProfile("rescue_teams", "Rescue Team", "rescue_demand", None, 1, 25),
    "medical_kits": ResourceProfile("medical_kits", "Medical Kit Pallet", "medical_demand", "hospital", 100, 100),
    "food_units": ResourceProfile("food_units", "Food Pallet", "food_demand", None, 500, 500),
    "shelter_capacity": ResourceProfile("shelter_capacity", "Shelter Block", "shelter_need", "shelter", 150, 150),
    "emergency_vehicles": ResourceProfile("emergency_vehicles", "Emergency Vehicle", "rescue_demand", None, 1, 20),
}

# Default resource set for the small quantum instance (exercises both hospital
# and shelter capacity gates plus travel/budget trade-offs).
DEFAULT_INSTANCE_RESOURCES = ["ambulances", "rescue_teams", "medical_kits", "shelter_capacity"]
DEFAULT_INSTANCE_ZONES = 4


def compute_shelter_need(zone: Zone) -> int:
    displaced = int(zone.population * DISPLACEMENT_RATE[zone.severity])
    return max(0, displaced - zone.shelter_occupancy)


def zone_demand(zone: Zone, demand_key: str) -> int:
    if demand_key == "shelter_need":
        return compute_shelter_need(zone)
    return int(getattr(zone, demand_key, 0))


@dataclass
class OptimizationInstance:
    """A fully-specified small binary optimisation instance."""

    scenario_id: str
    resource_keys: List[str]
    zones: List[Zone]                       # the included (small) zone subset
    n_resources: int
    n_zones: int
    n_vars: int
    # Per (r_idx, z_idx) matrices flattened row-major: idx = r_idx*n_zones + z_idx
    gain: List[float]
    travel_norm: List[float]
    cost_norm: List[float]
    net: List[float]
    allowed: List[bool]                     # eligibility gate per variable
    demand: List[int]                       # demand units for r at z
    bundle_service: List[int]
    bundle_units: List[int]
    bundle_cost: List[float]                # currency cost per bundle of r (per z, constant in z)
    # Per-resource data.
    bundles_available: Dict[str, int]
    cap: Dict[str, int]                     # max assignable bundles (min(avail, n_zones))
    available_units: Dict[str, int]         # raw resource units in the scenario pool
    unit_cost: Dict[str, float]
    priority_norm: Dict[str, float]
    distance: Dict[str, float]              # depot->zone km (inf if unreachable)
    accessibility: Dict[str, float]
    hospital_remaining: Dict[str, int]
    shelter_remaining: Dict[str, int]
    budget: float
    total_demand: Dict[str, int]            # per resource across included zones

    def var_index(self, r_idx: int, z_idx: int) -> int:
        return r_idx * self.n_zones + z_idx

    def unpack(self, idx: int) -> Tuple[int, int]:
        return divmod(idx, self.n_zones)

    def resource_key(self, r_idx: int) -> str:
        return self.resource_keys[r_idx]


def _safe_norm(value: float, max_value: float) -> float:
    if max_value <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_value))


def build_instance(
    scenario: Scenario,
    zones_count: int = DEFAULT_INSTANCE_ZONES,
    resource_keys: Optional[List[str]] = None,
) -> OptimizationInstance:
    """Build the small binary instance from a scenario.

    The highest-priority `zones_count` zones are selected so the quantum demo is
    clearly a SMALL, well-defined sub-problem of the (larger) displayed scenario.
    """
    resource_keys = list(resource_keys or DEFAULT_INSTANCE_RESOURCES)
    resource_keys = [r for r in resource_keys if r in RESOURCE_PROFILES]
    if not resource_keys:
        raise ValueError("No valid resource keys for the optimisation instance")

    ranked = sorted(scenario.zones, key=lambda z: z.priority_score, reverse=True)
    zones = ranked[: max(1, min(zones_count, len(ranked)))]
    n_zones = len(zones)
    n_res = len(resource_keys)
    n_vars = n_res * n_zones

    costs = travel_costs(scenario)
    zone_by_id = {z.id: z for z in scenario.zones}

    # Reference maxima across included zones for normalisation.
    finite_distances = [costs[z.id] for z in zones if costs[z.id] != float("inf")]
    max_distance = max(finite_distances) if finite_distances else 1.0
    max_unit_cost = max(
        scenario.resource_costs.get(r, 1.0) for r in resource_keys
    ) or 1.0

    demand_by_res: Dict[str, List[int]] = {}
    for r in resource_keys:
        prof = RESOURCE_PROFILES[r]
        demand_by_res[r] = [zone_demand(z, prof.demand_key) for z in zones]
    max_demand = {r: (max(demand_by_res[r]) or 1) for r in resource_keys}

    gain: List[float] = [0.0] * n_vars
    travel_norm: List[float] = [0.0] * n_vars
    cost_norm: List[float] = [0.0] * n_vars
    net: List[float] = [0.0] * n_vars
    allowed: List[bool] = [False] * n_vars
    demand_flat: List[int] = [0] * n_vars
    bundle_service: List[int] = [0] * n_vars
    bundle_units: List[int] = [0] * n_vars
    bundle_cost: List[float] = [0.0] * n_vars

    priority_norm: Dict[str, float] = {}
    distance: Dict[str, float] = {}
    accessibility: Dict[str, float] = {}
    hospital_remaining: Dict[str, int] = {}
    shelter_remaining: Dict[str, int] = {}
    unit_cost: Dict[str, float] = {}
    bundles_available: Dict[str, int] = {}
    available_units: Dict[str, int] = {}
    cap: Dict[str, int] = {}
    total_demand: Dict[str, int] = {}

    for z in zones:
        priority_norm[z.id] = z.priority_score / 100.0
        distance[z.id] = costs[z.id]
        accessibility[z.id] = z.road_accessibility
        hospital_remaining[z.id] = z.hospital_remaining
        shelter_remaining[z.id] = z.shelter_remaining

    for ri, r in enumerate(resource_keys):
        prof = RESOURCE_PROFILES[r]
        uc = float(scenario.resource_costs.get(r, 1.0))
        unit_cost[r] = uc
        avail_units = int(scenario.resources.as_dict().get(r, 0))
        available_units[r] = avail_units
        bundles_available[r] = avail_units // prof.bundle_units if prof.bundle_units else 0
        cap[r] = min(bundles_available[r], n_zones)
        total_demand[r] = sum(demand_by_res[r])
        cn = _safe_norm(uc * prof.bundle_units, max_unit_cost * max(
            RESOURCE_PROFILES[x].bundle_units for x in resource_keys))

        for zi, z in enumerate(zones):
            idx = ri * n_zones + zi
            d = demand_by_res[r][zi]
            demand_flat[idx] = d
            bundle_service[idx] = prof.bundle_service
            bundle_units[idx] = prof.bundle_units
            bundle_cost[idx] = uc * prof.bundle_units

            # Eligibility gates (hard constraints expressed per-variable).
            reachable = costs[z.id] != float("inf") and z.road_accessibility > 0.0
            gate_ok = True
            if prof.capacity_gate == "hospital":
                gate_ok = z.hospital_remaining > 0
            elif prof.capacity_gate == "shelter":
                gate_ok = z.shelter_remaining > 0
            allowed[idx] = bool(reachable and gate_ok and d > 0)

            g = priority_norm[z.id] * _safe_norm(d, max_demand[r])
            tn = _safe_norm(costs[z.id], max_distance) if costs[z.id] != float("inf") else 1.0
            gain[idx] = g
            travel_norm[idx] = tn
            cost_norm[idx] = cn
            net[idx] = W_GAIN * g - W_TRAVEL * tn - W_COST * cn

    return OptimizationInstance(
        scenario_id=scenario.id,
        resource_keys=resource_keys,
        zones=zones,
        n_resources=n_res,
        n_zones=n_zones,
        n_vars=n_vars,
        gain=gain,
        travel_norm=travel_norm,
        cost_norm=cost_norm,
        net=net,
        allowed=allowed,
        demand=demand_flat,
        bundle_service=bundle_service,
        bundle_units=bundle_units,
        bundle_cost=bundle_cost,
        bundles_available=bundles_available,
        cap=cap,
        available_units=available_units,
        unit_cost=unit_cost,
        priority_norm=priority_norm,
        distance=distance,
        accessibility=accessibility,
        hospital_remaining=hospital_remaining,
        shelter_remaining=shelter_remaining,
        budget=float(scenario.budget),
        total_demand=total_demand,
    )


@dataclass
class Assignment:
    resource: str
    resource_label: str
    zone_id: str
    zone_name: str
    bundles: int
    units: int
    demand: int
    served: int
    travel_km: float
    currency_cost: float


@dataclass
class SolutionEvaluation:
    bits: List[int]
    objective_value: float
    feasible: bool
    violations: List[str] = field(default_factory=list)
    assignments: List[Assignment] = field(default_factory=list)
    metrics: Dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "bits": self.bits,
            "bitstring": "".join(str(b) for b in self.bits),
            "objective_value": round(self.objective_value, 6),
            "feasible": self.feasible,
            "violations": self.violations,
            "assignments": [a.__dict__ for a in self.assignments],
            "metrics": self.metrics,
        }


def assignments_from_bits(instance: OptimizationInstance, bits: List[int]) -> List[Tuple[int, int, int]]:
    """Return list of (r_idx, z_idx, var_index) for every set bit."""
    out = []
    for idx, b in enumerate(bits):
        if b:
            r_idx, z_idx = instance.unpack(idx)
            out.append((r_idx, z_idx, idx))
    return out


def evaluate_bits(instance: OptimizationInstance, bits: List[int]) -> SolutionEvaluation:
    """Evaluate a candidate bitstring against the shared objective + constraints.

    Used identically by the classical solver (to rank enumerated candidates) and
    by the QAOA decoder (to pick the best feasible measured bitstring).
    """
    from app.optimization.constraints import check_feasibility

    bits = [int(b) & 1 for b in bits]
    if len(bits) != instance.n_vars:
        raise ValueError(f"Expected {instance.n_vars} bits, got {len(bits)}")

    active = assignments_from_bits(instance, bits)
    objective_value = sum(instance.net[idx] for _, _, idx in active)

    assignments: List[Assignment] = []
    served_by_resource: Dict[str, int] = {r: 0 for r in instance.resource_keys}
    units_used: Dict[str, int] = {r: 0 for r in instance.resource_keys}
    travel_total = 0.0
    currency_total = 0.0
    # per-zone coverage accumulation for priority coverage
    zone_cover_num: Dict[str, float] = {z.id: 0.0 for z in instance.zones}
    zone_cover_den: Dict[str, float] = {z.id: 0.0 for z in instance.zones}

    for r_idx, z_idx, idx in active:
        r = instance.resource_key(r_idx)
        z = instance.zones[z_idx]
        prof = RESOURCE_PROFILES[r]
        d = instance.demand[idx]
        served = min(d, instance.bundle_service[idx])
        assignments.append(
            Assignment(
                resource=r,
                resource_label=prof.label,
                zone_id=z.id,
                zone_name=z.name,
                bundles=1,
                units=instance.bundle_units[idx],
                demand=d,
                served=served,
                travel_km=(instance.distance[z.id] if instance.distance[z.id] != float("inf") else 0.0),
                currency_cost=instance.bundle_cost[idx],
            )
        )
        served_by_resource[r] += served
        units_used[r] += instance.bundle_units[idx]
        travel_total += instance.distance[z.id] if instance.distance[z.id] != float("inf") else 0.0
        currency_total += instance.bundle_cost[idx]
        if d > 0:
            zone_cover_num[z.id] += (served / d) * instance.priority_norm[z.id]
            zone_cover_den[z.id] += instance.priority_norm[z.id]

    feasible, violations = check_feasibility(instance, bits)

    total_demand_all = sum(instance.total_demand.values()) or 1
    total_served_all = sum(served_by_resource.values())
    demand_satisfied_pct = 100.0 * total_served_all / total_demand_all

    cover_den_sum = sum(zone_cover_den.values())
    priority_coverage = (100.0 * sum(zone_cover_num.values()) / cover_den_sum) if cover_den_sum > 0 else 0.0

    utilization = {
        r: {
            "available_units": instance.available_units[r],
            "bundles_available": instance.bundles_available[r],
            "bundles_cap": instance.cap[r],
            "units_used": units_used[r],
            "utilization_pct": (100.0 * units_used[r] / (instance.bundles_available[r] * RESOURCE_PROFILES[r].bundle_units))
            if instance.bundles_available[r] > 0 else 0.0,
        }
        for r in instance.resource_keys
    }

    unmet_by_resource = {
        r: max(0, instance.total_demand[r] - served_by_resource[r]) for r in instance.resource_keys
    }

    metrics: Dict[str, object] = {
        "n_vars": instance.n_vars,
        "assignments_count": len(assignments),
        "objective_value": round(objective_value, 6),
        "gain_total": round(sum(instance.gain[idx] for _, _, idx in active), 6),
        "travel_total_km": round(travel_total, 3),
        "travel_cost_norm": round(sum(W_TRAVEL * instance.travel_norm[idx] for _, _, idx in active), 6),
        "currency_cost": round(currency_total, 2),
        "budget": instance.budget,
        "budget_remaining": round(instance.budget - currency_total, 2),
        "demand_satisfied_pct": round(demand_satisfied_pct, 2),
        "total_demand": total_demand_all,
        "total_served": total_served_all,
        "unserved_demand": total_demand_all - total_served_all,
        "priority_coverage_pct": round(priority_coverage, 2),
        "served_by_resource": served_by_resource,
        "unmet_by_resource": unmet_by_resource,
        "resource_utilization": utilization,
        "constraint_violations": len(violations),
        "feasible": feasible,
    }

    return SolutionEvaluation(
        bits=bits,
        objective_value=objective_value,
        feasible=feasible,
        violations=violations,
        assignments=assignments,
        metrics=metrics,
    )
