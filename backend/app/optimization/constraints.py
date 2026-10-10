"""Hard constraints and feasibility checking.

These rules are applied EXACTLY (not approximated) when ranking candidate
solutions. The classical solver enumerates only feasible solutions; the QAOA
decoder selects the best feasible measured bitstring against these same rules.
The QUBO builder (Phase 3) adds quadratic penalties to *bias* QAOA toward this
feasible region, but feasibility is always decided here.
"""
from __future__ import annotations

from typing import List, Tuple

from app.optimization.objective import (
    RESOURCE_PROFILES,
    OptimizationInstance,
    assignments_from_bits,
)


def check_feasibility(instance: OptimizationInstance, bits: List[int]) -> Tuple[bool, List[str]]:
    """Return (feasible, violations) for a candidate bitstring."""
    violations: List[str] = []
    active = assignments_from_bits(instance, bits)

    # 1. Resource availability: bundles per resource within available pool.
    per_resource: dict[str, int] = {r: 0 for r in instance.resource_keys}
    for r_idx, z_idx, _ in active:
        per_resource[instance.resource_key(r_idx)] += 1
    for r, count in per_resource.items():
        if count > instance.bundles_available[r]:
            violations.append(
                f"Availability exceeded for {r}: {count} assigned > {instance.bundles_available[r]} available"
            )

    # 2. Budget: total currency cost within budget.
    currency_total = sum(instance.bundle_cost[idx] for _, _, idx in active)
    if currency_total > instance.budget + 1e-9:
        violations.append(
            f"Budget exceeded: cost {currency_total:.2f} > budget {instance.budget:.2f}"
        )

    # 3-6. Per-variable eligibility gates (capacity, accessibility, demand).
    for r_idx, z_idx, idx in active:
        r = instance.resource_key(r_idx)
        z = instance.zones[z_idx]
        prof = RESOURCE_PROFILES[r]

        if instance.distance[z.id] == float("inf") or z.road_accessibility <= 0.0:
            violations.append(f"Zone {z.name} is unreachable (road blocked) but was assigned {r}")
            continue
        if prof.capacity_gate == "hospital" and z.hospital_remaining <= 0:
            violations.append(f"Zone {z.name} has no remaining hospital capacity for {r}")
        if prof.capacity_gate == "shelter" and z.shelter_remaining <= 0:
            violations.append(f"Zone {z.name} has no remaining shelter capacity for {r}")
        if instance.demand[idx] <= 0:
            violations.append(f"Zone {z.name} has zero {prof.demand_key} for {r}")

    return (len(violations) == 0), violations


def violation_count(instance: OptimizationInstance, bits: List[int]) -> int:
    return len(check_feasibility(instance, bits)[1])
