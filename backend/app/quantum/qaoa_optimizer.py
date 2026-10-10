"""QAOA execution on the Qiskit Aer simulator.

Real quantum pipeline: QUBO -> Ising SparsePauliOp -> parameterised QAOA ansatz
-> Aer simulator -> measurement counts. A classical optimiser (SciPy COBYLA by
default) tunes the gamma/beta angles by minimising the shot-averaged QUBO cost.

Error handling (spec section 25): QAOA never crashes the API. Timeouts and
exceptions are captured and returned as a `status="failed"` result with the real
error message. We NEVER silently substitute the classical answer.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np
from scipy.optimize import minimize

from app.quantum.circuit_builder import build_qaoa_circuit, circuit_ascii, circuit_stats
from app.quantum.qubo_builder import QUBO

OPTIMIZERS = ["COBYLA", "Powell", "Nelder-Mead"]


class QAOATimeout(Exception):
    pass


@dataclass
class QAOAConfig:
    reps: int = 1
    shots: int = 1024
    optimizer: str = "COBYLA"
    seed: Optional[int] = 42
    maxiter: int = 60
    timeout_seconds: float = 60.0
    backend: str = "aer"

    @classmethod
    def from_dict(cls, d: Dict[str, object]) -> "QAOAConfig":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known and v is not None})


def _key_to_bits(key: str, n: int) -> List[int]:
    s = key.replace(" ", "")
    if set(s) <= {"0", "1"}:
        bits_be = s.zfill(n)[-n:]
    else:
        bits_be = format(int(key, 0), f"0{n}b")
    return [int(c) for c in reversed(bits_be)]


def run_qaoa(qubo: QUBO, config: QAOAConfig) -> Dict[str, object]:
    """Execute QAOA and return measurement results + metadata (never raises)."""
    start = time.perf_counter()
    n = qubo.num_qubits

    # Import Qiskit lazily so a broken quantum env still lets the API boot.
    try:
        from qiskit_aer import AerSimulator
    except Exception as exc:  # pragma: no cover
        return _failed(start, f"Qiskit Aer unavailable: {exc}", "import_error", config, n)

    if config.optimizer not in OPTIMIZERS:
        return _failed(
            start,
            f"Unsupported optimizer '{config.optimizer}'. Choose one of {OPTIMIZERS}.",
            "config_error",
            config,
            n,
        )

    try:
        qc, gammas, betas = build_qaoa_circuit(qubo, config.reps)
        method = "matrix_product_state" if n > 20 else "automatic"
        simulator = AerSimulator(method=method, seed_simulator=config.seed)
        rng = np.random.default_rng(config.seed)

        param_order = list(gammas) + list(betas)

        def bind(x: np.ndarray):
            mapping = {param_order[i]: float(x[i]) for i in range(len(param_order))}
            return qc.assign_parameters(mapping)

        history: List[float] = []
        eval_count = {"n": 0}

        def objective(x: np.ndarray) -> float:
            elapsed = time.perf_counter() - start
            if elapsed > config.timeout_seconds:
                raise QAOATimeout(
                    f"QAOA exceeded timeout of {config.timeout_seconds:.0f}s "
                    f"after {eval_count['n']} evaluations"
                )
            bound = bind(x)
            res = simulator.run(bound, shots=config.shots).result()
            counts = res.get_counts()
            total = sum(counts.values())
            avg_cost = 0.0
            for key, cnt in counts.items():
                avg_cost += cnt * qubo.cost(_key_to_bits(key, n))
            avg_cost /= max(1, total)
            eval_count["n"] += 1
            history.append(round(avg_cost, 6))
            return avg_cost

        x0 = np.concatenate([
            rng.uniform(0.0, 2.0 * np.pi, config.reps),
            rng.uniform(0.0, np.pi, config.reps),
        ])

        options: Dict[str, object] = {"maxiter": config.maxiter, "disp": False}
        if config.optimizer == "COBYLA":
            options["rhobeg"] = 0.1
        opt_result = minimize(
            objective,
            x0,
            method=config.optimizer,
            options=options,
        )
        best_params = np.asarray(opt_result.x, dtype=float)

        # Final sampled readout at the optimised angles.
        final_circuit = bind(best_params)
        final_res = simulator.run(final_circuit, shots=config.shots).result()
        counts = final_res.get_counts()

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        param_values = [float(v) for v in best_params]
        return {
            "status": "success",
            "backend": f"AerSimulator ({config.backend})",
            "num_qubits": n,
            "reps": config.reps,
            "shots": config.shots,
            "optimizer": config.optimizer,
            "seed": config.seed,
            "counts": {str(k): int(v) for k, v in counts.items()},
            "optimal_parameters": {
                "gammas": param_values[: config.reps],
                "betas": param_values[config.reps:],
            },
            "optimizer_iterations": int(eval_count["n"]),
            "converged": bool(getattr(opt_result, "success", True)),
            "expectation_history": history,
            "final_expectation": history[-1] if history else None,
            "execution_time_ms": round(elapsed_ms, 3),
            "circuit_ascii": circuit_ascii(qc, param_values),
            "circuit_stats": circuit_stats(qc),
        }
    except QAOATimeout as exc:
        return _failed(start, str(exc), "timeout", config, n)
    except Exception as exc:  # pragma: no cover - surfaced honestly to the user
        return _failed(start, f"{type(exc).__name__}: {exc}", "execution_error", config, n)


def _failed(
    start: float, message: str, error_type: str, config: QAOAConfig, n: int
) -> Dict[str, object]:
    return {
        "status": "failed",
        "error_type": error_type,
        "error": message,
        "backend": f"AerSimulator ({config.backend})",
        "num_qubits": n,
        "reps": config.reps,
        "shots": config.shots,
        "optimizer": config.optimizer,
        "execution_time_ms": round((time.perf_counter() - start) * 1000.0, 3),
    }
