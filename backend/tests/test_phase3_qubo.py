"""Phase 3 tests: QUBO variables, constraints, and objective consistency."""
from __future__ import annotations

import numpy as np

from app.optimization.classical_optimizer import solve_classical
from app.optimization.objective import build_instance, evaluate_bits
from app.quantum.qubo_builder import build_qubo, qubo_summary
from app.simulation.disaster_generator import build_base_scenario
from app.simulation.road_simulator import recompute_accessibility


def _scenario(**resource_overrides):
    scn = build_base_scenario()
    for k, v in resource_overrides.items():
        setattr(scn.resources, k, v)
    recompute_accessibility(scn)
    return scn


def _qubo_ground_state(qubo):
    """Brute-force the QUBO minimum over all qubits (primary + slack)."""
    n = qubo.num_qubits
    nums = np.arange(1 << n, dtype=np.int64)
    shifts = np.arange(n, dtype=np.int64)
    bits = ((nums[:, None] >> shifts[None, :]) & 1).astype(np.float64)
    costs = np.full(bits.shape[0], qubo.offset)
    for (i, j), coeff in qubo.Q.items():
        costs += coeff * bits[:, i] * bits[:, j]
    best = int(np.argmin(costs))
    return [int(b) for b in bits[best]], float(costs[best])


def test_qubo_dimensions():
    inst = build_instance(_scenario(), zones_count=4)
    qubo = build_qubo(inst)
    assert qubo.num_primary == inst.n_vars == 16
    # Default resources are abundant -> cap == n_zones -> no slack needed.
    assert qubo.num_slack == 0
    assert qubo.num_qubits == 16


def test_slack_added_when_scarce():
    inst = build_instance(_scenario(ambulances=2), zones_count=4)
    qubo = build_qubo(inst)
    assert qubo.cap["ambulances"] == 2
    assert qubo.num_slack >= 2
    assert qubo.num_qubits == qubo.num_primary + qubo.num_slack


def test_feasible_assignment_cost_equals_negative_objective():
    scn = _scenario(ambulances=2)
    inst = build_instance(scn, zones_count=4)
    qubo = build_qubo(inst)

    # Build a feasible primary assignment: 1 ambulance to the top zone only.
    primary = [0] * qubo.num_primary
    z_idx = 0
    primary[inst.var_index(inst.resource_keys.index("ambulances"), z_idx)] = 1
    ev = evaluate_bits(inst, primary)
    assert ev.feasible

    # Set slack so availability equality holds (S + slack == cap) -> zero penalty.
    x = primary + [0] * qubo.num_slack
    for r, slacks in qubo.slack_layout.items():
        s_r = sum(primary[i] for i in qubo.resource_vars[r])
        remaining = qubo.cap[r] - s_r
        for q, w in slacks:
            take = 1 if remaining >= w else 0
            x[q] = take
            remaining -= w * take
    cost = qubo.cost(x)
    assert abs(cost - (-ev.objective_value)) < 1e-6


def test_forbidden_variable_is_penalised():
    scn = _scenario()
    # Make one zone unreachable so its variables are forbidden.
    top = max(scn.zones, key=lambda z: z.priority_score)
    for road in scn.roads:
        if top.id in (road.source, road.target):
            road.blocked = True
    recompute_accessibility(scn)
    inst = build_instance(scn, zones_count=4)
    qubo = build_qubo(inst)

    zone_ids = [z.id for z in inst.zones]
    if top.id in zone_ids:
        zi = zone_ids.index(top.id)
        vi = inst.var_index(0, zi)
        assert inst.allowed[vi] is False
        x0 = [0] * qubo.num_qubits
        x1 = list(x0)
        x1[vi] = 1
        delta = qubo.cost(x1) - qubo.cost(x0)
        # The forbid penalty must dominate any possible objective gain so QAOA
        # is pushed away from ineligible assignments.
        assert delta > sum(abs(v) for v in inst.net)


def test_availability_violation_penalised():
    inst = build_instance(_scenario(ambulances=1), zones_count=4)
    qubo = build_qubo(inst)
    amb = inst.resource_keys.index("ambulances")
    # Assign ambulances to 2 zones -> exceeds cap of 1.
    x = [0] * qubo.num_qubits
    x[inst.var_index(amb, 0)] = 1
    x[inst.var_index(amb, 1)] = 1
    cost_violation = qubo.cost(x)

    y = [0] * qubo.num_qubits
    y[inst.var_index(amb, 0)] = 1
    # slack satisfies cap==1
    for q, w in qubo.slack_layout["ambulances"]:
        y[q] = 0
    cost_ok = qubo.cost(y)
    assert cost_violation > cost_ok


def test_qubo_ground_state_matches_classical_objective():
    scn = _scenario(ambulances=2, medical_kits=250)
    inst = build_instance(scn, zones_count=4)
    qubo = build_qubo(inst)

    classical = solve_classical(inst)
    best_bits, _ = _qubo_ground_state(qubo)
    primary = qubo.primary_bits(best_bits)
    ev = evaluate_bits(inst, primary)

    assert ev.feasible, ev.violations
    assert abs(ev.objective_value - classical["evaluation"].objective_value) < 1e-6


def test_summary_fields():
    inst = build_instance(_scenario(), zones_count=4)
    qubo = build_qubo(inst)
    s = qubo_summary(qubo)
    assert s["num_qubits"] == qubo.num_qubits
    assert s["num_primary_vars"] == 16
    assert "resources" in s and "zones" in s
