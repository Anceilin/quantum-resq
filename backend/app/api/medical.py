"""Medical Coordinator Operational API routes.

Provides endpoints for zone medical demand editing, inventory stock adjustments,
knapsack optimization proposals, atomic dispatch confirmations, delivery tracking,
and single-restoration cancellations.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.dependencies import (
    get_current_user,
    require_resource_edit,
    require_zone_field_edit,
)
from app.models.schemas import (
    InventoryAdjustmentRequest,
    MedicalDispatchConfirmRequest,
    MedicalProposal,
    Scenario,
)
from app.services.medical_store import medical_store
from app.services.scenario_store import scenario_store
from app.utils.priority import assign_priority_scores

router = APIRouter(
    prefix="/api/scenarios/{scenario_id}/medical",
    tags=["medical"],
    dependencies=[Depends(get_current_user)],
)


class ZoneDemandUpdate(BaseModel):
    zone_id: str
    medical_demand: int = Field(ge=0, description="New medical kit requirement")


@router.get("/overview")
def get_medical_overview(scenario_id: str) -> Dict[str, Any]:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    allocated_map = medical_store.get_allocated_map(scenario_id)
    history = medical_store.get_history(scenario_id)

    total_allocated = sum(allocated_map.values())
    total_unmet = sum(max(0, z.medical_demand - allocated_map.get(z.id, 0)) for z in scenario.zones)
    shortage_zones_count = sum(1 for z in scenario.zones if (z.medical_demand - allocated_map.get(z.id, 0)) > 0)

    return {
        "scenario_id": scenario_id,
        "available_stock": scenario.resources.medical_kits,
        "total_allocated": total_allocated,
        "total_unmet_demand": total_unmet,
        "shortage_zones_count": shortage_zones_count,
        "allocated_map": allocated_map,
        "history": history,
    }


@router.post("/demand", response_model=Scenario)
def update_zone_medical_demand(
    scenario_id: str,
    payload: ZoneDemandUpdate,
    user: dict = Depends(get_current_user),
) -> Scenario:
    """Edit a single zone's medical kit demand with RBAC checks and priority recalculation."""
    require_zone_field_edit(user, ["medical_demand"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    zone = next((z for z in scenario.zones if z.id == payload.zone_id), None)
    if not zone:
        raise HTTPException(status_code=404, detail=f"Zone '{payload.zone_id}' not found")

    zone.medical_demand = payload.medical_demand
    assign_priority_scores(scenario.zones)
    scenario_store.update(scenario)

    return scenario


@router.post("/inventory/adjust", response_model=Scenario)
def adjust_inventory(
    scenario_id: str,
    payload: InventoryAdjustmentRequest,
    user: dict = Depends(get_current_user),
) -> Scenario:
    """Record stock addition or stock correction with audit log."""
    require_resource_edit(user, ["medical_kits"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    try:
        updated = medical_store.adjust_inventory(scenario, user["email"], payload)
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/optimize", response_model=MedicalProposal)
def optimize_medical_allocation(
    scenario_id: str, user: dict = Depends(get_current_user)
) -> MedicalProposal:
    """Calculate priority knapsack allocation proposal for medical stock."""
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    return medical_store.calculate_proposal(scenario)


@router.post("/dispatch/confirm")
def confirm_medical_dispatch(
    scenario_id: str,
    payload: Optional[MedicalDispatchConfirmRequest] = None,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Confirm medical dispatch, atomically updating inventory & zone demands."""
    require_resource_edit(user, ["medical_kits"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    try:
        req = payload or MedicalDispatchConfirmRequest()
        record = medical_store.confirm_dispatch(scenario, user["email"], req)
        return {
            "status": "confirmed",
            "dispatch_record": record,
            "scenario": scenario,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/dispatch/{dispatch_id}/cancel")
def cancel_medical_dispatch(
    scenario_id: str,
    dispatch_id: str,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Cancel eligible pending dispatch and restore inventory/demands exactly once."""
    require_resource_edit(user, ["medical_kits"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    try:
        record = medical_store.cancel_dispatch(scenario, dispatch_id, user["email"])
        return {
            "status": "cancelled",
            "dispatch_record": record,
            "scenario": scenario,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/dispatch/{dispatch_id}/complete")
def complete_medical_dispatch(
    scenario_id: str,
    dispatch_id: str,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Mark dispatch as delivered/completed."""
    require_resource_edit(user, ["medical_kits"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    try:
        record = medical_store.complete_dispatch(scenario, dispatch_id, user["email"])
        return {
            "status": "delivered",
            "dispatch_record": record,
            "scenario": scenario,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/history")
def get_medical_history(scenario_id: str) -> Dict[str, Any]:
    return medical_store.get_history(scenario_id)


@router.post("/reset-baseline", response_model=Scenario)
def reset_medical_baseline(
    scenario_id: str, user: dict = Depends(get_current_user)
) -> Scenario:
    """Reset medical stock to 1,000 and demands to standard 915 baseline."""
    require_resource_edit(user, ["medical_kits"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    return medical_store.reset_medical_baseline(scenario, user["email"])
