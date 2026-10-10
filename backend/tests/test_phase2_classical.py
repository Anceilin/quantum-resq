"""Phase 2 tests: instance building, objective, constraints, classical solver."""
from __future__ import annotations

import numpy as np

from app.optimization.classical_optimizer import solve_bruteforce, solve_classical, solve_greedy
from app.optimization.constraints import check_feasibility
from app.optimization.objective import (
    DEFAULT_INSTANCE_RESOURCES,
    build_instance,
    compute_shelter_need,
    evaluate_bits,
)
from app.simulation.disaster_generator import build_base_scenario
from app.simulation.road_simulator import recompute_accessibility


def _scenario():
    scn = build_base_scenario()
    recompute_accessibility(scn)
    return scn


def test_instance_dimensions():
    inst = build_instance(_scenario(), zones_count=4)
    assert inst.n_zones == 4
    assert inst.n_resources == len(DEFAULT_INSTANCE_RESOURCES)
    assert inst.n_vars == 16
    assert len(inst.net) == 16
    assert len(inst.allowed) == 16


def test_all_zero_solution_is_feasible():
    inst = build_instance(_scenario())
    feasible, violations = check_feasibility(inst, [0] * inst.n_vars)
    assert feasible is True
    assert violations == []


def test_classical_finds_feasible_positive_objective():
    inst = build_instance(_scenario())
    res = solve_classical(inst)
    assert res["found_feasible"] is True
    ev = res["evaluation"]
    assert ev.feasible is True
    assert ev.objective_value > 0.0
    assert res["method"] == "brute_force"
    assert res["iterations"] == 1 << 16


def test_classical_respects_availability():
    scn = _scenario()
    # Force a tight availability so the constraint must bind.
    scn.resources.ambulances = 2
    inst = build_instance(scn)
    res = solve_classical(inst)
    bits = res["bits"]
    amb_idx = inst.resource_keys.index("ambulances")
    amb_assigned = sum(bits[amb_idx * inst.n_zones: (amb_idx + 1) * inst.n_zones])
    assert amb_assigned <= 2
    assert res["evaluation"].feasible


def test_classical_beats_or_equals_greedy():
    inst = build_instance(_scenario())
    bf = solve_bruteforce(inst)["evaluation"].objective_value
    greedy = solve_greedy(inst)["evaluation"].objective_value
    assert bf >= greedy - 1e-9


def test_road_block_makes_zone_unavailable():
    scn = _scenario()
    # Block EVERY road touching the top-priority zone so it is truly unreachable.
    top = max(scn.zones, key=lambda z: z.priority_score)
    for road in scn.roads:
        if top.id in (road.source, road.target):
            road.blocked = True
    recompute_accessibility(scn)
    assert top.road_accessibility == 0.0

    inst = build_instance(scn)
    zone_ids = [z.id for z in inst.zones]
    res = solve_classical(inst)
    assert res["evaluation"].feasible
    if top.id in zone_ids:
        z_idx = zone_ids.index(top.id)
        for r_idx in range(inst.n_resources):
            assert res["bits"][inst.var_index(r_idx, z_idx)] == 0


def test_partial_block_reduces_accessibility_but_stays_reachable():
    scn = _scenario()
    top = max(scn.zones, key=lambda z: z.priority_score)
    before = top.road_accessibility
    road = next(r for r in scn.roads if r.is_primary and r.target == top.id)
    road.blocked = True
    recompute_accessibility(scn)
    # A cross-link keeps the zone reachable, but at reduced accessibility.
    assert 0.0 < top.road_accessibility < before


def test_budget_constraint_enforced():
    scn = _scenario()
    scn.budget = 1.0  # impossibly small
    inst = build_instance(scn)
    res = solve_classical(inst)
    # Only the empty (or near-empty) solution can be feasible.
    assert res["evaluation"].metrics["currency_cost"] <= 1.0 + 1e-9


def test_evaluate_bits_metrics_shape():
    inst = build_instance(_scenario())
    res = solve_classical(inst)
    m = res["evaluation"].metrics
    for key in [
        "objective_value", "demand_satisfied_pct", "priority_coverage_pct",
        "unserved_demand", "currency_cost", "resource_utilization", "feasible",
    ]:
        assert key in m


def test_shelter_need_positive_for_severe_zone():
    scn = _scenario()
    alpha = next(z for z in scn.zones if z.name == "Alpha")
    assert compute_shelter_need(alpha) > 0


def test_evaluate_rejects_wrong_length():
    inst = build_instance(_scenario())
    try:
        evaluate_bits(inst, [0, 1, 0])
        assert False, "expected ValueError"
    except ValueError:
        pass
