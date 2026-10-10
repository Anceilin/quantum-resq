"""Build the QAOA cost operator and parameterised ansatz circuit from a QUBO.

Everything here is real Qiskit: the QUBO Ising coefficients become a
`SparsePauliOp` cost Hamiltonian, and the ansatz alternates cost evolution
exp(-i*gamma*H_C) with the transverse-field mixer exp(-i*beta*sum X).
"""
from __future__ import annotations

import warnings
from typing import List, Tuple

from qiskit.circuit import ParameterVector, QuantumCircuit
from qiskit.quantum_info import SparsePauliOp

from app.quantum.qubo_builder import QUBO

# Qiskit's text drawer warns about the cp1252 console charset when rendering
# box-drawing characters. It is purely cosmetic, so silence it globally.
warnings.filterwarnings(
    "ignore", category=RuntimeWarning, module=r"qiskit\.visualization\.circuit\.text"
)


def _pauli_label(n: int, positions: List[int]) -> str:
    """Qiskit labels are little-endian: rightmost char == qubit 0."""
    chars = ["I"] * n
    for p in positions:
        chars[p] = "Z"
    return "".join(reversed(chars))


def build_cost_operator(qubo: QUBO) -> SparsePauliOp:
    """Ising cost Hamiltonian H_C whose ground state minimises the QUBO.

    Kept for inspection/metadata; the ansatz below realises exp(-i*gamma*H_C)
    directly with native rz/cx gates so Aer can execute it without transpiling.
    """
    h, J, offset = qubo.to_ising()
    n = qubo.num_qubits
    labels: List[str] = []
    coeffs: List[float] = []
    for i, c in h.items():
        if abs(c) < 1e-12:
            continue
        labels.append(_pauli_label(n, [i]))
        coeffs.append(c)
    for (i, j), c in J.items():
        if abs(c) < 1e-12:
            continue
        labels.append(_pauli_label(n, [i, j]))
        coeffs.append(c)
    if not labels:
        labels.append("I" * n)
        coeffs.append(0.0)
    op = SparsePauliOp(labels, coeffs)
    if abs(offset) > 1e-12:
        op = op + SparsePauliOp("I" * n, [offset])
    return op.simplify()


def build_qaoa_circuit(qubo: QUBO, reps: int) -> Tuple[QuantumCircuit, ParameterVector, ParameterVector]:
    """Parameterised QAOA ansatz with measurement, plus its gamma/beta vectors.

    The cost unitary exp(-i*gamma*H_C) for a diagonal Ising Hamiltonian is
    exactly:  RZ(2*gamma*h_i) on each qubit, and CX-RZ(2*gamma*J_ij)-CX for each
    ZZ coupling. These are Aer-native gates (no synthesis/transpile needed).
    """
    n = qubo.num_qubits
    h, J, _offset = qubo.to_ising()
    gammas = ParameterVector("γ", reps)
    betas = ParameterVector("β", reps)

    qc = QuantumCircuit(n, n, name="QAOA")
    qc.h(range(n))
    for layer in range(reps):
        gamma = gammas[layer]
        # Cost layer: diagonal Ising evolution.
        for i, c in h.items():
            if abs(c) < 1e-12:
                continue
            qc.rz(2 * gamma * c, i)
        for (i, j), c in J.items():
            if abs(c) < 1e-12:
                continue
            qc.cx(i, j)
            qc.rz(2 * gamma * c, j)
            qc.cx(i, j)
        # Mixer layer: transverse field.
        beta = betas[layer]
        for q in range(n):
            qc.rx(2 * beta, q)
        qc.barrier()
    qc.measure(range(n), range(n))
    return qc, gammas, betas



def circuit_ascii(qc: QuantumCircuit, params: List[float] | None = None) -> str:
    """Text drawing of the circuit for the Quantum Engine page.

    If `params` is given (gammas then betas) the bound circuit is drawn.
    """
    drawn = qc
    if params is not None:
        try:
            drawn = qc.assign_parameters(params)
        except Exception:
            drawn = qc
    import warnings

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return drawn.draw("text", fold=-1).single_dump()
    except Exception:
        return str(drawn)


def circuit_stats(qc: QuantumCircuit) -> dict:
    bound = qc
    try:
        # Depth/op counts are structural; unbound parameters are fine for counting.
        return {
            "num_qubits": qc.num_qubits,
            "num_clbits": qc.num_clbits,
            "depth": qc.depth(),
            "size": qc.size(),
            "op_counts": {k: v for k, v in qc.count_ops().items()},
        }
    except Exception:
        return {"num_qubits": bound.num_qubits}
