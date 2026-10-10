"""Decode QAOA measurement counts into a feasible resource allocation.

Spec pipeline step 8-9: "Select/decode the best feasible bitstring". QAOA is a
heuristic sampler, so its raw most-probable bitstring may violate a hard
constraint. We therefore evaluate every distinct measured bitstring against the
SHARED objective + constraints and return the best FEASIBLE one. If no measured
bitstring is feasible we say so honestly and return the least-violating candidate
(rather than silently substituting the classical answer).
"""
from __future__ import annotations

from typing import Dict, List, Tuple

from app.optimization.constraints import check_feasibility
from app.optimization.objective import OptimizationInstance, evaluate_bits
from app.quantum.qubo_builder import QUBO


def decode_counts(
    instance: OptimizationInstance,
    qubo: QUBO,
    counts: Dict[str, int],
    top_n: int = 10,
) -> Dict[str, object]:
    """Pick the best feasible bitstring from raw measurement counts.

    `counts` keys are Qiskit hex/int keys or bitstrings; we normalise to a
    little-endian bit list where index i == qubit i.
    """
    n = qubo.num_qubits

    def to_bits(key: str) -> List[int]:
        # Qiskit text counts are big-endian bitstrings (qubit n-1 ... qubit 0).
        s = key.replace(" ", "")
        if set(s) <= {"0", "1"}:
            bits_be = s
        else:
            bits_be = format(int(key, 0), f"0{n}b")
        bits_be = bits_be.zfill(n)[-n:]
        return [int(c) for c in reversed(bits_be)]  # -> index i == qubit i

    evaluated: List[Tuple[float, int, bool, int, List[int]]] = []
    for key, count in counts.items():
        bits = to_bits(key)
        primary = bits[: qubo.num_primary]
        ev = evaluate_bits(instance, primary)
        qubo_cost = qubo.cost(bits)
        evaluated.append((ev.objective_value, count, ev.feasible, len(ev.violations), primary))

    feasible = [e for e in evaluated if e[2]]
    if feasible:
        # Best feasible by objective; tie-break by higher shot count.
        best = max(feasible, key=lambda e: (e[0], e[1]))
        found_feasible = True
    else:
        # Least-violating, then highest objective.
        best = min(evaluated, key=lambda e: (e[3], -e[0]))
        found_feasible = False

    best_primary = best[4]
    evaluation = evaluate_bits(instance, best_primary)

    # Top bitstrings by shot count for the Measurement panel.
    top = sorted(evaluated, key=lambda e: e[1], reverse=True)[:top_n]
    top_bitstrings = [
        {
            "bitstring": "".join(str(b) for b in e[4]),
            "counts": e[1],
            "objective_value": round(e[0], 6),
            "feasible": e[2],
            "violations": e[3],
        }
        for e in top
    ]

    total_shots = sum(counts.values())
    feasible_shots = sum(e[1] for e in evaluated if e[2])
    return {
        "best_bitstring": "".join(str(b) for b in best_primary),
        "best_bits": best_primary,
        "found_feasible": found_feasible,
        "evaluation": evaluation,
        "top_bitstrings": top_bitstrings,
        "distinct_bitstrings": len(evaluated),
        "total_shots": total_shots,
        "feasible_shot_fraction": round(feasible_shots / total_shots, 4) if total_shots else 0.0,
    }
