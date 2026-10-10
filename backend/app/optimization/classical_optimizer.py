"""Classical baseline optimiser.

For the small instances used in this prototype (<= 20 binary variables) the
classical baseline is an EXACT solver: it enumerates every bitstring, applies
the identical hard constraints and objective as the quantum path, and returns
the true optimum. A greedy heuristic is used as a fallback for larger instances
so the API never becomes unusable.

Never generates fake results: the returned solution is a real enumeration of the
shared `OptimizationInstance`.
"""
from __future__ import annotations

import time
from typing import Dict, List

import numpy as np

from app.optimization.constraints import check_feasibility
from app.optimization.objective import (
    OptimizationInstance,
    SolutionEvaluation,
    evaluate_bits,
)

BRUTE_FORCE_MAX_VARS = 20


def _feasible_mask(instance: OptimizationInstance, bits: np.ndarray) -> np.ndarray:
    """Vectorised hard-constraint mask over a (N, n_vars) bit matrix."""
    n = bits.shape[0]
    mask = np.ones(n, dtype=bool)

    # Disallowed variables (capacity / accessibility / demand gates) must be 0.
    allowed = np.array(instance.allowed, dtype=bool)
    forbidden = ~allowed
    if forbidden.any():
        mask &= (bits[:, forbidden] == 0).all(axis=1)

    # Resource availability: bundles per resource <= bundles_available.
    for r_idx, r in enumerate(instance.resource_keys):
        cols = slice(r_idx * instance.n_zones, (r_idx + 1) * instance.n_zones)
        mask &= bits[:, cols].sum(axis=1) <= instance.bundles_available[r]

    # Budget: total currency cost <= budget.
    bundle_cost = np.array(instance.bundle_cost, dtype=float)
    mask &= (bits @ bundle_cost) <= instance.budget + 1e-9
    return mask


def _enumerate_bits(n_vars: int) -> np.ndarray:
    nums = np.arange(1 << n_vars, dtype=np.int64)
    shifts = np.arange(n_vars, dtype=np.int64)
    return ((nums[:, None] >> shifts[None, :]) & 1).astype(np.uint8)


def solve_bruteforce(instance: OptimizationInstance) -> Dict[str, object]:
    bits = _enumerate_bits(instance.n_vars)
    net = np.array(instance.net, dtype=float)
    objectives = bits @ net
    mask = _feasible_mask(instance, bits)

    feasible_count = int(mask.sum())
    if feasible_count == 0:
        # No feasible solution exists for this scenario (e.g. everything blocked).
        best_bits = [0] * instance.n_vars
        evaluation = evaluate_bits(instance, best_bits)
        return {
            "method": "brute_force",
            "iterations": int(bits.shape[0]),
            "feasible_candidates": 0,
            "bits": best_bits,
            "evaluation": evaluation,
            "found_feasible": False,
        }

    masked_obj = np.where(mask, objectives, -np.inf)
    best_idx = int(np.argmax(masked_obj))
    best_bits = [int(b) for b in bits[best_idx]]
    evaluation = evaluate_bits(instance, best_bits)
    return {
        "method": "brute_force",
        "iterations": int(bits.shape[0]),
        "feasible_candidates": feasible_count,
        "bits": best_bits,
        "evaluation": evaluation,
        "found_feasible": True,
    }


def solve_greedy(instance: OptimizationInstance) -> Dict[str, object]:
    """Greedy fallback for large instances: add best-net variables while feasible."""
    order = sorted(range(instance.n_vars), key=lambda i: instance.net[i], reverse=True)
    bits = [0] * instance.n_vars
    iterations = 0
    for idx in order:
        iterations += 1
        if not instance.allowed[idx]:
            continue
        bits[idx] = 1
        feasible, _ = check_feasibility(instance, bits)
        if not feasible:
            bits[idx] = 0
    evaluation = evaluate_bits(instance, bits)
    feasible, _ = check_feasibility(instance, bits)
    return {
        "method": "greedy",
        "iterations": iterations,
        "feasible_candidates": 1 if feasible else 0,
        "bits": bits,
        "evaluation": evaluation,
        "found_feasible": feasible,
    }


def solve_classical(instance: OptimizationInstance) -> Dict[str, object]:
    """Run the classical baseline and return solution + timing metadata."""
    start = time.perf_counter()
    if instance.n_vars <= BRUTE_FORCE_MAX_VARS:
        result = solve_bruteforce(instance)
    else:
        result = solve_greedy(instance)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    result["execution_time_ms"] = round(elapsed_ms, 3)
    result["n_vars"] = instance.n_vars
    return result
