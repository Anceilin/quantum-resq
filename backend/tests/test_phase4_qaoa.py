"""Phase 4 tests: real QAOA execution on Qiskit Aer."""
from __future__ import annotations

import pytest

from app.optimization.objective import build_instance
from app.quantum.circuit_builder import build_cost_operator, build_qaoa_circuit
from app.quantum.qaoa_optimizer import OPTIMIZERS, QAOAConfig, run_qaoa
from app.quantum.qubo_builder import build_qubo
from app.quantum.result_decoder import decode_counts
from app.simulation.disaster_generator import build_base_scenario
from app.simulation.road_simulator import recompute_accessibility


def _scenario():
    scn = build_base_scenario()
    recompute_accessibility(scn)
    return scn


def test_tiny_qaoa_executes_and_measures():
    """A 2-variable problem must run a real circuit and produce counts."""
    inst = build_instance(_scenario(), zones_count=2, resource_keys=["ambulances"])
    qubo = build_qubo(inst)
    assert qubo.num_qubits == 2
    res = run_qaoa(qubo, QAOAConfig(reps=1, shots=256, maxiter=15, seed=7))
    assert res["status"] == "success", res.get("error")
    counts = res["counts"]
    assert counts
    assert sum(counts.values()) == 256
    # Bitstrings are 2 chars of 0/1.
    assert all(set(k) <= {"0", "1"} and len(k) == 2 for k in counts)


def test_cost_operator_is_hermitian_ising():
    inst = build_instance(_scenario(), zones_count=3)
    qubo = build_qubo(inst)
    op = build_cost_operator(qubo)
    assert op.num_qubits == qubo.num_qubits
    # Only I/Z paulis (diagonal Ising).
    for label in op.paulis.to_labels():
        assert set(label) <= {"I", "Z"}


def test_circuit_has_measurements():
    inst = build_instance(_scenario(), zones_count=3)
    qubo = build_qubo(inst)
    qc, gammas, betas = build_qaoa_circuit(qubo, reps=2)
    assert qc.num_qubits == qubo.num_qubits
    assert qc.num_clbits == qubo.num_qubits
    assert len(gammas) == 2 and len(betas) == 2
    assert "measure" in qc.count_ops()


def test_full_instance_qaoa_decodes_feasible():
    inst = build_instance(_scenario(), zones_count=4)
    qubo = build_qubo(inst)
    res = run_qaoa(qubo, QAOAConfig(reps=1, shots=512, maxiter=40, seed=42))
    assert res["status"] == "success", res.get("error")
    dec = decode_counts(inst, qubo, res["counts"])
    assert dec["total_shots"] == 512
    assert dec["distinct_bitstrings"] >= 1
    ev = dec["evaluation"]
    # The decoder must return a real evaluated solution consistent with the bits.
    assert len(dec["best_bitstring"]) == qubo.num_primary
    assert ev.metrics["n_vars"] == qubo.num_primary
    if dec["found_feasible"]:
        assert ev.feasible


def test_qaoa_never_exceeds_classical_objective():
    """QAOA is a heuristic; its feasible objective cannot beat the exact optimum."""
    from app.optimization.classical_optimizer import solve_classical

    inst = build_instance(_scenario(), zones_count=4)
    qubo = build_qubo(inst)
    classical_obj = solve_classical(inst)["evaluation"].objective_value
    res = run_qaoa(qubo, QAOAConfig(reps=1, shots=512, maxiter=40, seed=3))
    assert res["status"] == "success", res.get("error")
    dec = decode_counts(inst, qubo, res["counts"])
    assert dec["evaluation"].objective_value <= classical_obj + 1e-6


def test_timeout_is_handled_not_crash():
    inst = build_instance(_scenario(), zones_count=3)
    qubo = build_qubo(inst)
    res = run_qaoa(qubo, QAOAConfig(reps=1, shots=128, maxiter=50, seed=1, timeout_seconds=1e-6))
    assert res["status"] == "failed"
    assert res["error_type"] == "timeout"
    assert "timeout" in res["error"].lower()


def test_unsupported_optimizer_reports_error():
    inst = build_instance(_scenario(), zones_count=2)
    qubo = build_qubo(inst)
    res = run_qaoa(qubo, QAOAConfig(optimizer="NOT_REAL", shots=64, maxiter=5))
    assert res["status"] == "failed"
    assert res["error_type"] == "config_error"


@pytest.mark.parametrize("opt", OPTIMIZERS)
def test_all_optimizers_run(opt):
    inst = build_instance(_scenario(), zones_count=2, resource_keys=["ambulances"])
    qubo = build_qubo(inst)
    res = run_qaoa(qubo, QAOAConfig(reps=1, shots=128, optimizer=opt, maxiter=10, seed=5))
    assert res["status"] == "success", res.get("error")


def test_seed_reproducibility():
    inst = build_instance(_scenario(), zones_count=3)
    qubo = build_qubo(inst)
    cfg = QAOAConfig(reps=1, shots=256, maxiter=20, seed=99)
    a = run_qaoa(qubo, cfg)
    b = run_qaoa(qubo, cfg)
    assert a["status"] == "success" and b["status"] == "success"
    assert a["optimal_parameters"] == b["optimal_parameters"]
