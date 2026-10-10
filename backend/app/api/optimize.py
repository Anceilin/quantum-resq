"""Optimisation API routes: classical, QAOA, compare, results, circuit."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import get_current_user
from app.optimization.objective import DEFAULT_INSTANCE_RESOURCES, RESOURCE_PROFILES
from app.quantum.qaoa_optimizer import OPTIMIZERS
from app.services import optimization_service as svc
from app.services.scenario_store import result_store, scenario_store

router = APIRouter(
    prefix="/api",
    tags=["optimization"],
    dependencies=[Depends(get_current_user)],
)


class OptimizeRequest(BaseModel):
    scenario_id: str
    zones_count: Optional[int] = Field(default=None, ge=1, le=8)
    resources: Optional[List[str]] = None
    # QAOA configuration (ignored by the classical endpoint).
    reps: Optional[int] = Field(default=None, ge=1, le=5)
    shots: Optional[int] = Field(default=None, ge=64, le=8192)
    optimizer: Optional[str] = None
    seed: Optional[int] = None
    maxiter: Optional[int] = Field(default=None, ge=1, le=500)

    def to_options(self) -> svc.OptOptions:
        d = self.model_dump(exclude_none=True)
        d.pop("scenario_id", None)
        if "resources" in d:
            bad = [r for r in d["resources"] if r not in RESOURCE_PROFILES]
            if bad:
                raise ValueError(f"Unknown resource keys: {bad}")
        if d.get("optimizer") and d["optimizer"] not in OPTIMIZERS:
            raise ValueError(f"optimizer must be one of {OPTIMIZERS}")
        return svc.OptOptions.from_dict(d)


def _get_scenario(scenario_id: str):
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return scenario


def _options(req: OptimizeRequest) -> svc.OptOptions:
    try:
        return req.to_options()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/optimize/classical")
def optimize_classical(req: OptimizeRequest) -> Dict[str, Any]:
    scenario = _get_scenario(req.scenario_id)
    return svc.run_classical(scenario, _options(req))


@router.post("/optimize/qaoa")
def optimize_qaoa(req: OptimizeRequest) -> Dict[str, Any]:
    """Run the QAOA pipeline. Returns status='failed' with the real error if
    QAOA fails — it is never silently replaced by the classical answer."""
    scenario = _get_scenario(req.scenario_id)
    return svc.run_qaoa_pipeline(scenario, _options(req))


@router.post("/optimize/compare")
def optimize_compare(req: OptimizeRequest) -> Dict[str, Any]:
    scenario = _get_scenario(req.scenario_id)
    return svc.run_compare(scenario, _options(req))


@router.get("/results")
def list_results() -> Dict[str, Any]:
    return {"result_ids": result_store.list_ids()}


@router.get("/results/{result_id}")
def get_result(result_id: str) -> Dict[str, Any]:
    payload = result_store.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Result '{result_id}' not found")
    return payload


@router.get("/quantum/circuit/{result_id}")
def get_circuit(result_id: str) -> Dict[str, Any]:
    """Return the QAOA circuit + QUBO summary stored for a qaoa/compare result."""
    payload = result_store.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Result '{result_id}' not found")
    qaoa = payload.get("qaoa") if payload.get("kind") == "compare" else payload
    if not isinstance(qaoa, dict) or qaoa.get("kind") != "qaoa":
        raise HTTPException(status_code=400, detail="Result has no QAOA/circuit data")
    return {
        "result_id": result_id,
        "status": qaoa.get("status"),
        "num_qubits": qaoa.get("num_qubits"),
        "num_slack_qubits": qaoa.get("num_slack_qubits"),
        "qubo": qaoa.get("qubo"),
        "config": qaoa.get("config"),
        "circuit_ascii": qaoa.get("circuit_ascii"),
        "circuit_stats": qaoa.get("circuit_stats"),
        "optimal_parameters": qaoa.get("optimal_parameters"),
        "error": qaoa.get("error"),
    }


@router.get("/analytics/{result_id}")
def get_analytics(result_id: str) -> Dict[str, Any]:
    """Chart-ready analytics derived from a stored comparison (or single) result."""
    payload = result_store.get(result_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Result '{result_id}' not found")

    kind = payload.get("kind")
    if kind == "compare":
        compare = payload
    elif kind in ("classical", "qaoa"):
        # Wrap a single-sided result so analytics can still render.
        compare = {"result_id": result_id, "scenario_id": payload.get("scenario_id"), kind: payload}
    else:
        raise HTTPException(status_code=400, detail="Result is not an optimisation result")

    scenario_id = compare.get("scenario_id")
    scenario = scenario_store.get(scenario_id) if scenario_id else None
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario for this result no longer exists")
    return svc.build_analytics(compare, scenario)


@router.get("/resources")
def list_resources() -> Dict[str, Any]:
    """Available resource types the optimiser understands (for extensibility)."""
    return {
        "resources": [
            {
                "key": p.key,
                "label": p.label,
                "demand_key": p.demand_key,
                "capacity_gate": p.capacity_gate,
                "bundle_units": p.bundle_units,
                "bundle_service": p.bundle_service,
            }
            for p in RESOURCE_PROFILES.values()
        ],
        "default_instance_resources": DEFAULT_INSTANCE_RESOURCES,
        "optimizers": OPTIMIZERS,
    }
