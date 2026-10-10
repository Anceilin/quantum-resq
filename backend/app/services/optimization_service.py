"""Optimisation orchestration service.

Builds the shared instance from a scenario, runs the classical baseline and/or
the QAOA pipeline, decodes results, and produces an honest head-to-head
comparison. Results are stored so the frontend can fetch them by id.

The classical solver and QAOA consume the SAME `OptimizationInstance`, objective
and hard constraints, so the comparison is apples-to-apples.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.optimization.classical_optimizer import solve_classical
from app.optimization.objective import (
    DEFAULT_INSTANCE_RESOURCES,
    DEFAULT_INSTANCE_ZONES,
    RESOURCE_PROFILES,
    OptimizationInstance,
    SolutionEvaluation,
    build_instance,
)
from app.models.schemas import Scenario
from app.quantum.qaoa_optimizer import QAOAConfig, run_qaoa
from app.quantum.qubo_builder import build_qubo, qubo_summary
from app.quantum.result_decoder import decode_counts
from app.services.scenario_store import result_store


@dataclass
class OptOptions:
    zones_count: int = DEFAULT_INSTANCE_ZONES
    resources: Optional[List[str]] = None
    reps: int = 1
    shots: int = 1024
    optimizer: str = "COBYLA"
    seed: Optional[int] = 42
    maxiter: int = 60
    timeout_seconds: float = 60.0

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, object]]) -> "OptOptions":
        d = d or {}
        fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in d.items() if k in fields and v is not None})


# scenario_id -> {"compare": result_id, "classical": id, "qaoa": id}
_scenario_index: Dict[str, Dict[str, str]] = {}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def snapshot_scenario(scenario: Scenario) -> Dict[str, object]:
    """Capture the scenario state that drives optimisation, for before/after diffs."""
    return {
        "budget": scenario.budget,
        "resources": scenario.resources.as_dict(),
        "blocked_roads": [r.id for r in scenario.roads if r.blocked],
        "zones": {
            z.id: {
                "name": z.name,
                "priority_score": z.priority_score,
                "road_accessibility": z.road_accessibility,
                "hospital_remaining": z.hospital_remaining,
                "shelter_remaining": z.shelter_remaining,
                "population": z.population,
                "severity": z.severity.value,
            }
            for z in scenario.zones
        },
    }


def _index(scenario_id: str, kind: str, result_id: str) -> None:
    _scenario_index.setdefault(scenario_id, {})[kind] = result_id


def latest_result_id(scenario_id: str, kind: str = "compare") -> Optional[str]:
    return _scenario_index.get(scenario_id, {}).get(kind)


def instance_for(scenario: Scenario, opts: OptOptions) -> OptimizationInstance:
    return build_instance(
        scenario,
        zones_count=opts.zones_count,
        resource_keys=opts.resources or DEFAULT_INSTANCE_RESOURCES,
    )


def _evaluation_block(ev: SolutionEvaluation) -> Dict[str, object]:
    return ev.to_dict()


def run_classical(scenario: Scenario, opts: OptOptions) -> Dict[str, object]:
    inst = instance_for(scenario, opts)
    result = solve_classical(inst)
    ev: SolutionEvaluation = result["evaluation"]
    payload = {
        "kind": "classical",
        "result_id": _new_id("res"),
        "scenario_id": scenario.id,
        "method": result["method"],
        "scenario_snapshot": snapshot_scenario(scenario),
        "solver": "Classical Baseline (exact brute-force)" if result["method"] == "brute_force"
        else "Classical Baseline (greedy heuristic)",
        "n_vars": inst.n_vars,
        "zones": [z.name for z in inst.zones],
        "resources": inst.resource_keys,
        "iterations": result["iterations"],
        "feasible_candidates": result["feasible_candidates"],
        "execution_time_ms": result["execution_time_ms"],
        "solution": _evaluation_block(ev),
    }
    result_store.save(payload["result_id"], payload)
    _index(scenario.id, "classical", payload["result_id"])
    return payload


def run_qaoa_pipeline(scenario: Scenario, opts: OptOptions) -> Dict[str, object]:
    inst = instance_for(scenario, opts)
    qubo = build_qubo(inst)
    cfg = QAOAConfig(
        reps=opts.reps,
        shots=opts.shots,
        optimizer=opts.optimizer,
        seed=opts.seed,
        maxiter=opts.maxiter,
        timeout_seconds=opts.timeout_seconds,
    )
    qres = run_qaoa(qubo, cfg)

    payload: Dict[str, object] = {
        "kind": "qaoa",
        "result_id": _new_id("res"),
        "scenario_id": scenario.id,
        "status": qres["status"],
        "scenario_snapshot": snapshot_scenario(scenario),
        "backend": qres.get("backend"),
        "n_vars": inst.n_vars,
        "num_qubits": qres.get("num_qubits", qubo.num_qubits),
        "num_slack_qubits": qubo.num_slack,
        "zones": [z.name for z in inst.zones],
        "resources": inst.resource_keys,
        "qubo": qubo_summary(qubo),
        "config": {
            "reps": cfg.reps,
            "shots": cfg.shots,
            "optimizer": cfg.optimizer,
            "seed": cfg.seed,
            "maxiter": cfg.maxiter,
        },
    }

    if qres["status"] != "success":
        # Honest failure — do NOT substitute the classical answer.
        payload["error"] = qres.get("error")
        payload["error_type"] = qres.get("error_type")
        payload["execution_time_ms"] = qres.get("execution_time_ms")
        result_store.save(payload["result_id"], payload)
        _index(scenario.id, "qaoa", payload["result_id"])
        return payload

    decoded = decode_counts(inst, qubo, qres["counts"])
    ev: SolutionEvaluation = decoded["evaluation"]
    counts = qres["counts"]
    top_counts = dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:12])

    payload.update(
        {
            "execution_time_ms": qres["execution_time_ms"],
            "optimizer_iterations": qres["optimizer_iterations"],
            "converged": qres["converged"],
            "optimal_parameters": qres["optimal_parameters"],
            "expectation_history": qres["expectation_history"],
            "final_expectation": qres["final_expectation"],
            "circuit_ascii": qres["circuit_ascii"],
            "circuit_stats": qres["circuit_stats"],
            "counts": counts,
            "top_counts": top_counts,
            "measurement": {
                "distinct_bitstrings": decoded["distinct_bitstrings"],
                "total_shots": decoded["total_shots"],
                "feasible_shot_fraction": decoded["feasible_shot_fraction"],
                "top_bitstrings": decoded["top_bitstrings"],
            },
            "found_feasible": decoded["found_feasible"],
            "solution": _evaluation_block(ev),
        }
    )
    result_store.save(payload["result_id"], payload)
    _index(scenario.id, "qaoa", payload["result_id"])
    return payload


def _metrics_side(payload: Dict[str, object]) -> Dict[str, object]:
    sol = payload.get("solution") or {}
    m = sol.get("metrics", {}) if isinstance(sol, dict) else {}
    util = m.get("resource_utilization", {}) or {}
    avg_util = (
        sum(v.get("utilization_pct", 0.0) for v in util.values()) / len(util) if util else 0.0
    )
    return {
        "objective_value": m.get("objective_value", 0.0),
        "priority_coverage_pct": m.get("priority_coverage_pct", 0.0),
        "demand_satisfied_pct": m.get("demand_satisfied_pct", 0.0),
        "unserved_demand": m.get("unserved_demand", 0),
        "resource_utilization_pct": round(avg_util, 2),
        "travel_cost_km": m.get("travel_total_km", 0.0),
        "currency_cost": m.get("currency_cost", 0.0),
        "constraint_violations": m.get("constraint_violations", 0),
        "feasible": bool(sol.get("feasible", False)) if isinstance(sol, dict) else False,
        "execution_time_ms": payload.get("execution_time_ms", 0.0),
        "iterations": payload.get("optimizer_iterations", payload.get("iterations")),
        "qubit_count": payload.get("num_qubits"),
    }


def run_compare(scenario: Scenario, opts: OptOptions) -> Dict[str, object]:
    classical = run_classical(scenario, opts)
    qaoa = run_qaoa_pipeline(scenario, opts)

    c_side = _metrics_side(classical)
    q_side = _metrics_side(qaoa)

    qaoa_failed = qaoa.get("status") != "success"
    c_obj = float(c_side["objective_value"] or 0.0)
    q_obj = float(q_side["objective_value"] or 0.0)
    c_feasible = bool(c_side["feasible"])
    q_feasible = bool(q_side["feasible"]) and bool(qaoa.get("found_feasible"))

    if qaoa_failed:
        winner = "classical"
        verdict = "QAOA execution failed — classical baseline is the only available result."
    elif not q_feasible and c_feasible:
        winner = "classical"
        verdict = "QAOA produced no feasible bitstring in its samples; the classical baseline wins."
    elif abs(c_obj - q_obj) < 1e-6 and c_feasible and q_feasible:
        winner = "tie"
        verdict = "Both methods reached the same objective value on this instance."
    elif c_obj >= q_obj:
        winner = "classical"
        verdict = (
            f"Classical baseline wins (objective {c_obj:.4f} vs QAOA {q_obj:.4f}). "
            "This is expected: brute-force is exact on small instances while QAOA at "
            "low depth is a heuristic sampler."
        )
    else:  # pragma: no cover - exact classical should not be beaten
        winner = "qaoa"
        verdict = f"QAOA found a better feasible objective ({q_obj:.4f} vs {c_obj:.4f})."

    identical_bits = (
        classical.get("solution", {}).get("bitstring")
        == qaoa.get("solution", {}).get("bitstring")
    )

    comparison = {
        "winner": winner,
        "verdict": verdict,
        "identical_solution": bool(identical_bits and c_feasible and q_feasible),
        "classical": c_side,
        "qaoa": q_side,
        "qaoa_failed": qaoa_failed,
        "note": (
            "No quantum advantage is claimed. This is a small-scale QAOA simulation "
            "compared against an exact classical baseline on the identical instance."
        ),
    }

    payload = {
        "kind": "compare",
        "result_id": _new_id("res"),
        "scenario_id": scenario.id,
        "scenario_snapshot": snapshot_scenario(scenario),
        "classical_result_id": classical["result_id"],
        "qaoa_result_id": qaoa["result_id"],
        "classical": classical,
        "qaoa": qaoa,
        "comparison": comparison,
    }
    result_store.save(payload["result_id"], payload)
    _index(scenario.id, "compare", payload["result_id"])
    return payload


# --------------------------------------------------------------------------
# Dynamic re-optimization (spec section 14)
# --------------------------------------------------------------------------

def _classical_assignments(compare_payload: Dict[str, object]) -> List[Dict[str, object]]:
    classical = compare_payload.get("classical") or {}
    solution = classical.get("solution") or {}
    return list(solution.get("assignments", []) or [])


def _assignment_key(a: Dict[str, object]) -> str:
    return f"{a.get('resource')}::{a.get('zone_id')}"


def _explain_changes(
    before_snap: Dict[str, object],
    after_snap: Dict[str, object],
    changes: List[Dict[str, object]],
) -> List[str]:
    """Generate human-readable reasons from the ACTUAL scenario delta."""
    explanations: List[str] = []
    before_zones = before_snap.get("zones", {}) if isinstance(before_snap, dict) else {}
    after_zones = after_snap.get("zones", {}) if isinstance(after_snap, dict) else {}
    before_blocked = set(before_snap.get("blocked_roads", []) or [])
    after_blocked = set(after_snap.get("blocked_roads", []) or [])
    newly_blocked = after_blocked - before_blocked
    before_res = before_snap.get("resources", {}) or {}
    after_res = after_snap.get("resources", {}) or {}

    if newly_blocked:
        explanations.append(
            f"Road(s) {', '.join(sorted(newly_blocked))} became blocked, changing travel "
            "cost and accessibility for the affected zones."
        )

    for zid, z_after in after_zones.items():
        z_before = before_zones.get(zid, {})
        acc_b = z_before.get("road_accessibility", 0.0)
        acc_a = z_after.get("road_accessibility", 0.0)
        if acc_b > 0 and acc_a <= 0:
            explanations.append(
                f"{z_after.get('name', zid)} is now unreachable (accessibility {acc_b:.2f} → 0.00), "
                "so no resources can be routed there."
            )
        elif abs(acc_a - acc_b) > 1e-6:
            explanations.append(
                f"{z_after.get('name', zid)} accessibility changed {acc_b:.2f} → {acc_a:.2f}, "
                "altering its travel cost in the objective."
            )
        prio_b = z_before.get("priority_score", 0.0)
        prio_a = z_after.get("priority_score", 0.0)
        if abs(prio_a - prio_b) >= 1.0:
            explanations.append(
                f"{z_after.get('name', zid)} priority score changed {prio_b:.1f} → {prio_a:.1f}."
            )
        hosp_b = z_before.get("hospital_remaining", 0)
        hosp_a = z_after.get("hospital_remaining", 0)
        if hosp_b > 0 and hosp_a <= 0:
            explanations.append(
                f"{z_after.get('name', zid)} hospital capacity is exhausted, blocking medical allocations."
            )

    for r, after_count in after_res.items():
        before_count = before_res.get(r)
        if before_count is not None and after_count != before_count:
            label = RESOURCE_PROFILES[r].label if r in RESOURCE_PROFILES else r
            explanations.append(f"{label} availability changed {before_count} → {after_count}.")

    if not explanations:
        explanations.append(
            "No structural scenario change was detected; the allocation is stable for this input."
        )

    # Tie the concrete allocation deltas to a reason.
    for ch in changes:
        if ch["type"] == "removed":
            explanations.append(
                f"Removed {ch['resource_label']} → {ch['zone_name']}: "
                + (ch.get("reason") or "the zone no longer qualifies or a higher-priority zone took the resource.")
            )
        elif ch["type"] == "added":
            explanations.append(
                f"Added {ch['resource_label']} → {ch['zone_name']}: "
                + (ch.get("reason") or "the zone now has the highest priority-weighted unmet demand.")
            )
    return explanations


def _change_reason(
    change_type: str,
    resource: str,
    zone_id: str,
    before_snap: Dict[str, object],
    after_snap: Dict[str, object],
) -> Optional[str]:
    before_zones = before_snap.get("zones", {}) or {}
    after_zones = after_snap.get("zones", {}) or {}
    zb = before_zones.get(zone_id, {})
    za = after_zones.get(zone_id, {})

    if change_type == "removed":
        if za.get("road_accessibility", 0.0) <= 0 < zb.get("road_accessibility", 0.0):
            return "the route to this zone became inaccessible"
        prof = RESOURCE_PROFILES.get(resource)
        if prof and prof.capacity_gate == "hospital" and za.get("hospital_remaining", 0) <= 0:
            return "hospital capacity at this zone is exhausted"
        if prof and prof.capacity_gate == "shelter" and za.get("shelter_remaining", 0) <= 0:
            return "shelter capacity at this zone is exhausted"
        if za.get("priority_score", 0.0) < zb.get("priority_score", 0.0) - 1e-6:
            return "this zone's priority fell relative to others"
        return "a higher-priority zone now claims this limited resource"

    if change_type == "added":
        if za.get("priority_score", 0.0) > zb.get("priority_score", 0.0) + 1e-6:
            return "this zone's priority increased"
        if za.get("road_accessibility", 0.0) > zb.get("road_accessibility", 0.0) + 1e-6:
            return "the route to this zone reopened / improved"
        return "this zone now has the highest priority-weighted unmet demand"
    return None


def run_reoptimize(scenario: Scenario, opts: OptOptions) -> Dict[str, object]:
    """Re-run the full comparison after a scenario change and diff the allocation.

    The 'before' allocation is the most recent stored comparison for this
    scenario (if any); 'after' is a freshly executed one on the CURRENT scenario.
    Both come from real solver runs — nothing is fabricated.
    """
    before_id = latest_result_id(scenario.id, "compare")
    before_payload = result_store.get(before_id) if before_id else None

    after = run_compare(scenario, opts)

    if before_payload and before_payload.get("kind") == "compare":
        before_assignments = _classical_assignments(before_payload)
        before_snap = before_payload.get("scenario_snapshot", {})
        before_obj = (
            (before_payload.get("classical", {}).get("solution", {}) or {}).get("objective_value")
        )
        before_result_id = before_payload.get("classical_result_id")
    else:
        before_assignments = []
        before_snap = snapshot_scenario(scenario)
        before_obj = None
        before_result_id = None

    after_assignments = _classical_assignments(after)
    after_obj = (after.get("classical", {}).get("solution", {}) or {}).get("objective_value")

    before_map = {_assignment_key(a): a for a in before_assignments}
    after_map = {_assignment_key(a): a for a in after_assignments}

    changes: List[Dict[str, object]] = []
    for key, a in after_map.items():
        if key not in before_map:
            changes.append(
                {
                    "resource": a.get("resource"),
                    "resource_label": a.get("resource_label"),
                    "zone_id": a.get("zone_id"),
                    "zone_name": a.get("zone_name"),
                    "type": "added",
                    "reason": _change_reason(
                        "added", str(a.get("resource")), str(a.get("zone_id")), before_snap, after.get("scenario_snapshot", {})
                    ),
                }
            )
    for key, a in before_map.items():
        if key not in after_map:
            changes.append(
                {
                    "resource": a.get("resource"),
                    "resource_label": a.get("resource_label"),
                    "zone_id": a.get("zone_id"),
                    "zone_name": a.get("zone_name"),
                    "type": "removed",
                    "reason": _change_reason(
                        "removed", str(a.get("resource")), str(a.get("zone_id")), before_snap, after.get("scenario_snapshot", {})
                    ),
                }
            )
    for key in set(before_map) & set(after_map):
        a = after_map[key]
        changes.append(
            {
                "resource": a.get("resource"),
                "resource_label": a.get("resource_label"),
                "zone_id": a.get("zone_id"),
                "zone_name": a.get("zone_name"),
                "type": "unchanged",
            }
        )

    explanation = _explain_changes(before_snap, after.get("scenario_snapshot", {}), changes)

    payload = {
        "result_id": _new_id("reopt"),
        "scenario_id": scenario.id,
        "before": {
            "result_id": before_result_id,
            "assignments": before_assignments,
            "objective_value": before_obj,
        },
        "after": {
            "result_id": after.get("classical_result_id"),
            "assignments": after_assignments,
            "objective_value": after_obj,
        },
        "changes": changes,
        "explanation": explanation,
        "compare": after,
    }
    return payload


# --------------------------------------------------------------------------
# Analytics (spec sections 17, 22)
# --------------------------------------------------------------------------

def _shortage_analysis(
    metrics: Dict[str, object], target_pct: float = 90.0
) -> Dict[str, object]:
    current = float(metrics.get("demand_satisfied_pct", 0.0) or 0.0)
    unmet = metrics.get("unmet_by_resource", {}) or {}
    recommendations: List[Dict[str, object]] = []
    for r, unmet_units in unmet.items():
        prof = RESOURCE_PROFILES.get(r)
        if not prof or unmet_units <= 0:
            continue
        if current >= target_pct:
            continue
        extra_bundles = math.ceil(unmet_units / prof.bundle_service) if prof.bundle_service else 0
        extra_units = extra_bundles * prof.bundle_units
        if extra_units > 0:
            recommendations.append(
                {
                    "resource": r,
                    "label": prof.label,
                    "additional_units": extra_units,
                    "unmet_demand": int(unmet_units),
                }
            )
    return {
        "target_coverage_pct": target_pct,
        "current_coverage_pct": round(current, 2),
        "recommendations": recommendations,
    }


def build_analytics(compare_payload: Dict[str, object], scenario: Scenario) -> Dict[str, object]:
    """Derive chart-ready analytics from a stored comparison result.

    Every number comes from the actual classical/QAOA evaluation — nothing is
    hard-coded or invented.
    """
    classical = compare_payload.get("classical", {}) or {}
    qaoa = compare_payload.get("qaoa", {}) or {}
    c_sol = classical.get("solution", {}) or {}
    q_sol = qaoa.get("solution", {}) or {}
    c_metrics = c_sol.get("metrics", {}) or {}
    q_metrics = q_sol.get("metrics", {}) or {}
    c_assign = c_sol.get("assignments", []) or []

    # demand vs allocation + allocation by zone (from the classical solution).
    demand_by_zone: Dict[str, int] = {}
    served_by_zone: Dict[str, int] = {}
    allocation_by_zone: List[Dict[str, object]] = []
    zone_name = {z.id: z.name for z in scenario.zones}
    for a in c_assign:
        zid = a.get("zone_id")
        demand_by_zone[zid] = demand_by_zone.get(zid, 0) + int(a.get("demand", 0))
        served_by_zone[zid] = served_by_zone.get(zid, 0) + int(a.get("served", 0))
        allocation_by_zone.append(
            {
                "zone": zone_name.get(zid, zid),
                "resource": a.get("resource_label", a.get("resource")),
                "units": int(a.get("units", 0)),
            }
        )

    demand_vs_allocation = [
        {
            "zone": zone_name.get(zid, zid),
            "demand": demand_by_zone.get(zid, 0),
            "served": served_by_zone.get(zid, 0),
        }
        for zid in demand_by_zone
    ]

    util = c_metrics.get("resource_utilization", {}) or {}
    resource_utilization = [
        {
            "resource": RESOURCE_PROFILES[r].label if r in RESOURCE_PROFILES else r,
            "used": v.get("units_used", 0),
            "available": v.get("available_units", 0),
            "pct": round(float(v.get("utilization_pct", 0.0)), 2),
        }
        for r, v in util.items()
    ]

    priority_coverage = []
    for z in scenario.zones:
        dem = demand_by_zone.get(z.id, 0)
        srv = served_by_zone.get(z.id, 0)
        cov = (100.0 * srv / dem) if dem > 0 else 0.0
        priority_coverage.append(
            {"zone": z.name, "priority": round(z.priority_score, 1), "coverage": round(cov, 2)}
        )

    def _side(m: Dict[str, object], key: str) -> float:
        return round(float(m.get(key, 0.0) or 0.0), 4)

    classical_vs_qaoa = [
        {"metric": "Objective", "classical": _side(c_metrics, "objective_value"), "qaoa": _side(q_metrics, "objective_value")},
        {"metric": "Priority coverage %", "classical": _side(c_metrics, "priority_coverage_pct"), "qaoa": _side(q_metrics, "priority_coverage_pct")},
        {"metric": "Demand satisfied %", "classical": _side(c_metrics, "demand_satisfied_pct"), "qaoa": _side(q_metrics, "demand_satisfied_pct")},
        {"metric": "Unserved demand", "classical": _side(c_metrics, "unserved_demand"), "qaoa": _side(q_metrics, "unserved_demand")},
    ]

    shortage = _shortage_analysis(c_metrics)

    return {
        "result_id": compare_payload.get("result_id"),
        "scenario_id": scenario.id,
        "demand_vs_allocation": demand_vs_allocation,
        "resource_utilization": resource_utilization,
        "priority_coverage": priority_coverage,
        "classical_vs_qaoa": classical_vs_qaoa,
        "allocation_by_zone": allocation_by_zone,
        "shortage": shortage,
    }
