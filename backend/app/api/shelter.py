"""Shelter Coordinator Operational API routes."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.dependencies import (
    get_current_user,
    require_resource_edit,
    require_zone_field_edit,
)
from app.models.schemas import (
    ShelterIntakeRequest, BedRequestCreate, BedRequestStatusUpdate,
    FoodItemCreate, FoodDeliveryRequest, FoodDeliveryReceive,
    FoodDistributionRequest, ShelterProposal, Scenario
)
from app.services.shelter_store import shelter_store
from app.services.scenario_store import scenario_store

router = APIRouter(
    prefix="/api/scenarios/{scenario_id}/shelter",
    tags=["shelter"],
    dependencies=[Depends(get_current_user)],
)

@router.get("/overview")
def get_shelter_overview(scenario_id: str) -> Dict[str, Any]:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return shelter_store.get_overview(scenario_id)

@router.post("/intake")
def record_intake(
    scenario_id: str,
    payload: ShelterIntakeRequest,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_zone_field_edit(user, ["shelter_occupancy"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.record_intake(scenario, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/intake/history")
def get_intake_history(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_intake_history(scenario_id)]

@router.post("/beds/request")
def request_beds(
    scenario_id: str,
    payload: BedRequestCreate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_zone_field_edit(user, ["shelter_capacity"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.create_bed_request(scenario, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/beds/{request_id}/status")
def update_bed_request_status(
    scenario_id: str,
    request_id: str,
    payload: BedRequestStatusUpdate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_zone_field_edit(user, ["shelter_capacity"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.update_bed_request_status(scenario, request_id, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/beds/requests")
def get_bed_requests(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_bed_requests(scenario_id)]

@router.post("/food/items")
def add_food_item(
    scenario_id: str,
    payload: FoodItemCreate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_resource_edit(user, ["food_units"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.add_food_item(scenario_id, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/food/items")
def get_food_items(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_food_items(scenario_id)]

@router.post("/food/deliveries/request")
def request_food_delivery(
    scenario_id: str,
    payload: FoodDeliveryRequest,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.create_food_delivery_request(scenario_id, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/food/deliveries/{delivery_id}/receive")
def receive_food_delivery(
    scenario_id: str,
    delivery_id: str,
    payload: FoodDeliveryReceive,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_resource_edit(user, ["food_units"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.receive_food_delivery(scenario_id, delivery_id, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/food/deliveries")
def get_food_deliveries(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_food_deliveries(scenario_id)]

@router.post("/food/distribute")
def distribute_food(
    scenario_id: str,
    payload: FoodDistributionRequest,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_resource_edit(user, ["food_units"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.distribute_food(scenario, user["email"], payload)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/food/distributions")
def get_food_distributions(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_food_distributions(scenario_id)]

class WastePayload(BaseModel):
    quantity: float
    reason: str

@router.post("/food/{item_id}/waste")
def record_food_waste(
    scenario_id: str,
    item_id: str,
    payload: WastePayload,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_resource_edit(user, ["food_units"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        record = shelter_store.record_food_waste(scenario_id, item_id, user["email"], payload.quantity, payload.reason)
        return record.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/optimize", response_model=ShelterProposal)
def optimize_shelter(
    scenario_id: str, user: dict = Depends(get_current_user)
) -> ShelterProposal:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return shelter_store.calculate_proposal(scenario)

class ApplyProposalPayload(BaseModel):
    proposal_id: str

@router.post("/optimize/apply")
def apply_proposal(
    scenario_id: str,
    payload: ApplyProposalPayload,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        return shelter_store.apply_proposal(scenario, payload.proposal_id, user["email"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/audit")
def get_audit_log(scenario_id: str) -> list:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return [r.model_dump() for r in shelter_store.get_audit_log(scenario_id)]

class DemandConfigurePayload(BaseModel):
    ration_per_person: float
    planning_days: int

@router.post("/demand/configure")
def configure_demand(
    scenario_id: str,
    payload: DemandConfigurePayload,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    require_zone_field_edit(user, ["food_demand"])
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    
    # Update all zones
    for zone in scenario.zones:
        zone.food_demand = int(zone.shelter_occupancy * payload.ration_per_person * payload.planning_days)
    
    scenario_store.update(scenario)
    shelter_store.record_audit(
        scenario_id, user["email"], "demand_configure", 
        f"Configured food demand: {payload.ration_per_person} per person for {payload.planning_days} days"
    )
    return {"status": "success"}
