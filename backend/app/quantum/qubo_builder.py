"""QUBO construction from the shared optimisation instance.

The QUBO encodes the SAME objective as the classical path (minimise -net) plus
penalties that bias QAOA toward the feasible region:

  * forbidden variables (capacity / accessibility / demand gates, or a resource
    with zero availability) get a large linear penalty M.
  * resource availability `sum_z x[r][z] <= cap[r]` is encoded EXACTLY with
    slack bits and a quadratic penalty P*(S_r + slack - cap)^2. When capacity is
    not binding (cap == n_zones) no penalty is needed because a binary variable
    per zone already cannot exceed it.

Hard constraints that cannot be written as a small quadratic penalty (the
currency budget) are enforced exactly at decode time by `constraints.py`; the
per-assignment cost term in `net` already discourages overspending inside the
QUBO. This split is documented in the README.

QUBO cost(x) = sum_{i<=j} Q[(i,j)] x_i x_j + offset   (MINIMISE)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from app.optimization.objective import OptimizationInstance


def _slack_weights(cap: int) -> List[int]:
    """Binary weights able to represent every integer in [0, cap]."""
    weights: List[int] = []
    remaining = cap
    w = 1
    while remaining > 0:
        take = min(w, remaining)
        weights.append(take)
        remaining -= take
        w *= 2
    return weights


@dataclass
class QUBO:
    num_primary: int
    num_slack: int
    num_qubits: int
    Q: Dict[Tuple[int, int], float]
    offset: float
    penalty_forbid: float
    penalty_avail: float
    resource_vars: Dict[str, List[int]]
    slack_layout: Dict[str, List[Tuple[int, int]]]
    cap: Dict[str, int]
    instance: OptimizationInstance = field(repr=False)

    # ---- evaluation -------------------------------------------------------
    def cost(self, x: List[int]) -> float:
        if len(x) != self.num_qubits:
            raise ValueError(f"expected {self.num_qubits} bits, got {len(x)}")
        total = self.offset
        for (i, j), coeff in self.Q.items():
            if coeff == 0.0:
                continue
            total += coeff * x[i] * x[j] if i != j else coeff * x[i]
        return total

    def primary_bits(self, x: List[int]) -> List[int]:
        return list(x[: self.num_primary])

    def to_ising(self) -> Tuple[Dict[int, float], Dict[Tuple[int, int], float], float]:
        """Convert to Ising (h, J, offset) with s in {-1,+1}, x=(1-s)/2."""
        h: Dict[int, float] = {}
        J: Dict[Tuple[int, int], float] = {}
        const = self.offset
        for (i, j), q in self.Q.items():
            if q == 0.0:
                continue
            if i == j:
                h[i] = h.get(i, 0.0) - q / 2.0
                const += q / 2.0
            else:
                J[(i, j)] = J.get((i, j), 0.0) + q / 4.0
                h[i] = h.get(i, 0.0) - q / 4.0
                h[j] = h.get(j, 0.0) - q / 4.0
                const += q / 4.0
        return h, J, const


def _expand_square(
    qubo: QUBO, terms: List[Tuple[int, float]], constant: float, P: float
) -> None:
    """Add P * (sum a_i v_i + constant)^2 into the QUBO (binary v_i^2 = v_i)."""
    for i, a in terms:
        qubo.Q[(i, i)] = qubo.Q.get((i, i), 0.0) + P * (a * a + 2.0 * constant * a)
    for u in range(len(terms)):
        for v in range(u + 1, len(terms)):
            i, a = terms[u]
            j, b = terms[v]
            key = (i, j) if i <= j else (j, i)
            qubo.Q[key] = qubo.Q.get(key, 0.0) + P * (2.0 * a * b)
    qubo.offset += P * constant * constant


def build_qubo(instance: OptimizationInstance) -> QUBO:
    n_primary = instance.n_vars
    n_zones = instance.n_zones

    base_scale = sum(abs(v) for v in instance.net) + 1.0
    penalty_forbid = 10.0 * base_scale
    penalty_avail = 10.0 * base_scale

    resource_vars: Dict[str, List[int]] = {}
    for r_idx, r in enumerate(instance.resource_keys):
        resource_vars[r] = [r_idx * n_zones + z for z in range(n_zones)]

    # Reserve slack qubits for resources whose availability actually binds.
    slack_layout: Dict[str, List[Tuple[int, int]]] = {}
    num_slack = 0
    for r in instance.resource_keys:
        cap = instance.cap[r]
        if 0 < cap < n_zones:
            weights = _slack_weights(cap)
            slack_layout[r] = [(n_primary + num_slack + k, w) for k, w in enumerate(weights)]
            num_slack += len(weights)

    qubo = QUBO(
        num_primary=n_primary,
        num_slack=num_slack,
        num_qubits=n_primary + num_slack,
        Q={},
        offset=0.0,
        penalty_forbid=penalty_forbid,
        penalty_avail=penalty_avail,
        resource_vars=resource_vars,
        slack_layout=slack_layout,
        cap=dict(instance.cap),
        instance=instance,
    )

    # 1. Objective: minimise -net[i] * x_i  (== maximise net).
    for i in range(n_primary):
        qubo.Q[(i, i)] = qubo.Q.get((i, i), 0.0) - instance.net[i]

    # 2. Forbidden variables (ineligible gates) and unavailable resources.
    for i in range(n_primary):
        if not instance.allowed[i]:
            qubo.Q[(i, i)] = qubo.Q.get((i, i), 0.0) + penalty_forbid
    for r in instance.resource_keys:
        if instance.bundles_available[r] <= 0:
            for i in resource_vars[r]:
                qubo.Q[(i, i)] = qubo.Q.get((i, i), 0.0) + penalty_forbid

    # 3. Availability inequality penalties with slack encoding.
    for r, slacks in slack_layout.items():
        cap = instance.cap[r]
        terms: List[Tuple[int, float]] = [(i, 1.0) for i in resource_vars[r]]
        terms += [(q, float(w)) for q, w in slacks]
        _expand_square(qubo, terms, constant=-float(cap), P=penalty_avail)

    # Drop zero coefficients.
    qubo.Q = {k: v for k, v in qubo.Q.items() if abs(v) > 1e-12}
    return qubo


def qubo_summary(qubo: QUBO) -> Dict[str, object]:
    """Human-readable summary of the formulation for the Quantum Engine page."""
    inst = qubo.instance
    diag = sum(1 for (i, j) in qubo.Q if i == j)
    offdiag = sum(1 for (i, j) in qubo.Q if i != j)
    return {
        "num_primary_vars": qubo.num_primary,
        "num_slack_vars": qubo.num_slack,
        "num_qubits": qubo.num_qubits,
        "num_linear_terms": diag,
        "num_quadratic_terms": offdiag,
        "offset": round(qubo.offset, 6),
        "penalty_forbid": round(qubo.penalty_forbid, 4),
        "penalty_avail": round(qubo.penalty_avail, 4),
        "resources": inst.resource_keys,
        "zones": [z.name for z in inst.zones],
        "cap_per_resource": qubo.cap,
        "objective": "maximise sum(net[r][z] * x[r][z]); net = priority*demand - travel - cost",
        "constraints_encoded": [
            "resource availability (exact, slack-encoded quadratic penalty)",
            "eligibility gates: hospital/shelter capacity, road accessibility, non-zero demand (linear penalty)",
        ],
        "constraints_enforced_at_decode": [
            "currency budget",
            "resource availability (re-checked exactly)",
            "capacity / accessibility / demand gates (re-checked exactly)",
        ],
        "variable_indexing": "qubit = resource_index * n_zones + zone_index (slack bits appended last)",
    }
