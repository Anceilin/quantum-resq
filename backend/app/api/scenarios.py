"""Scenario and simulation API routes."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import (
    get_current_user,
    require_resource_edit,
    require_scenario_management,
    require_zone_field_edit,
)
from app.models.schemas import (
    RESOURCE_KEYS,
    Resources,
    RoadBlockRequest,
    Scenario,
    ScenarioCreate,
    ScenarioSummary,
    ScenarioUpdate,
)
from app.optimization.objective import RESOURCE_PROFILES
from app.quantum.qaoa_optimizer import OPTIMIZERS
from app.services import optimization_service as svc
from app.services.scenario_store import scenario_store
from app.simulation.disaster_generator import PRESET_KEYS, apply_preset, build_base_scenario
from app.simulation.road_simulator import recompute_accessibility, travel_costs
from app.utils.priority import assign_priority_scores

router = APIRouter(
    prefix="/api/scenarios",
    tags=["scenarios"],
    dependencies=[Depends(get_current_user)],
)


class ReoptimizeRequest(BaseModel):
    """Optional optimisation overrides for a re-optimization run."""

    zones_count: Optional[int] = Field(default=None, ge=1, le=8)
    resources: Optional[List[str]] = None
    reps: Optional[int] = Field(default=None, ge=1, le=5)
    shots: Optional[int] = Field(default=None, ge=64, le=8192)
    optimizer: Optional[str] = None
    seed: Optional[int] = None
    maxiter: Optional[int] = Field(default=None, ge=1, le=500)

    def to_options(self) -> svc.OptOptions:
        d = self.model_dump(exclude_none=True)
        if "resources" in d:
            bad = [r for r in d["resources"] if r not in RESOURCE_PROFILES]
            if bad:
                raise ValueError(f"Unknown resource keys: {bad}")
        if d.get("optimizer") and d["optimizer"] not in OPTIMIZERS:
            raise ValueError(f"optimizer must be one of {OPTIMIZERS}")
        return svc.OptOptions.from_dict(d)


def _summary(scenario: Scenario) -> ScenarioSummary:
    return ScenarioSummary(
        id=scenario.id,
        name=scenario.name,
        disaster_type=scenario.disaster_type,
        num_zones=len(scenario.zones),
        total_population=sum(z.population for z in scenario.zones),
        total_resources=sum(scenario.resources.as_dict().values()),
        budget=scenario.budget,
        is_demo=scenario.is_demo,
    )


@router.get("", response_model=list[ScenarioSummary])
def list_scenarios() -> list[ScenarioSummary]:
    return [_summary(s) for s in scenario_store.list()]


@router.post("", response_model=Scenario, status_code=201)
def create_scenario(payload: ScenarioCreate, user: dict = Depends(get_current_user)) -> Scenario:
    """Create a scenario. Requires scenario-management rights (Disaster Management Officer).

    With an empty/partial body a fresh simulated base scenario is generated.
    Provided zones/resources/roads fully override the generated defaults.
    """
    require_scenario_management(user)
    base = build_base_scenario()
    if payload.name:
        base.name = payload.name
    if payload.disaster_type:
        base.disaster_type = payload.disaster_type
    if payload.budget is not None:
        base.budget = payload.budget
    if payload.zones is not None:
        base.zones = payload.zones
    if payload.resources is not None:
        base.resources = payload.resources
    if payload.roads is not None:
        base.roads = payload.roads
    base.id = f"scn_{uuid.uuid4().hex[:8]}"
    base.is_demo = payload.zones is None
    recompute_accessibility(base)
    scenario_store.create(base)
    return base


@router.post("/preset/{preset}", response_model=Scenario, status_code=201)
def create_preset_scenario(preset: str, user: dict = Depends(get_current_user)) -> Scenario:
    """Create a What-If scenario by applying a preset to the demo base.

    Each preset changes real input data (see spec section 15). Creating a new
    scenario requires scenario-management rights (Disaster Management Officer).
    """
    require_scenario_management(user)
    if preset.strip().lower() not in PRESET_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown preset '{preset}'. Valid presets: {PRESET_KEYS}",
        )
    base = scenario_store.get("scn_demo") or build_base_scenario()
    scenario = apply_preset(base, preset)
    recompute_accessibility(scenario)
    scenario_store.create(scenario)
    return scenario


@router.get("/{scenario_id}", response_model=Scenario)
def get_scenario(scenario_id: str) -> Scenario:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return scenario


@router.get("/{scenario_id}/travel-costs")
def get_travel_costs(scenario_id: str) -> dict:
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    costs = travel_costs(scenario)
    return {zid: (None if c == float("inf") else round(c, 3)) for zid, c in costs.items()}


@router.post("/{scenario_id}/update", response_model=Scenario)
def update_scenario(
    scenario_id: str,
    patch: ScenarioUpdate,
    user: dict = Depends(get_current_user),
) -> Scenario:
    """Apply a partial edit (resources, budget, zone overrides) and recompute.

    Priority scores and road accessibility are recomputed so the change actually
    flows into the next optimization — this is not a cosmetic UI edit. Field
    access is enforced per official role on the backend.
    """
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

    if patch.budget is not None:
        require_scenario_management(user)
    if patch.zone_updates:
        touched: set[str] = set()
        for zu in patch.zone_updates:
            touched.update(zu.model_dump(exclude_none=True, exclude={"id"}).keys())
        require_zone_field_edit(user, sorted(touched))

    if patch.resources is not None:
        current = scenario.resources.as_dict()
        bad = [k for k in patch.resources if k not in RESOURCE_KEYS]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown resource keys: {bad}")
        # Permission check AFTER key validation so unknown keys always return 400.
        require_resource_edit(user, [k for k, v in patch.resources.items() if v is not None])
        for key, value in patch.resources.items():
            if value is None:
                continue
            if int(value) < 0:
                raise HTTPException(status_code=400, detail=f"Resource '{key}' cannot be negative")
            current[key] = int(value)
        scenario.resources = Resources(**current)
    if patch.budget is not None:
        scenario.budget = patch.budget

    if patch.zone_updates:
        by_id = {z.id: z for z in scenario.zones}
        for zu in patch.zone_updates:
            zone = by_id.get(zu.id)
            if zone is None:
                raise HTTPException(status_code=404, detail=f"Zone '{zu.id}' not found")
            data = zu.model_dump(exclude_none=True, exclude={"id"})
            for field, value in data.items():
                setattr(zone, field, value)
            # Occupancy can never exceed capacity.
            zone.hospital_occupancy = min(zone.hospital_occupancy, zone.hospital_capacity)
            zone.shelter_occupancy = min(zone.shelter_occupancy, zone.shelter_capacity)

    assign_priority_scores(scenario.zones)
    recompute_accessibility(scenario)
    scenario_store.update(scenario)
    return scenario


@router.post("/{scenario_id}/reoptimize")
def reoptimize_scenario(scenario_id: str, req: ReoptimizeRequest) -> Dict[str, Any]:
    """Re-run optimization on the CURRENT scenario and diff against the previous
    allocation. Used after road blocks, resource changes, capacity edits, etc.
    """
    scenario = scenario_store.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    try:
        opts = req.to_options()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return svc.run_reoptimize(scenario, opts)


@router.delete("/{scenario_id}")
def delete_scenario(scenario_id: str, user: dict = Depends(get_current_user)) -> dict:
    require_scenario_management(user)
    if scenario_id == "scn_demo":
        raise HTTPException(status_code=400, detail="Cannot delete the demo scenario")
    if not scenario_store.delete(scenario_id):
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")
    return {"deleted": True, "id": scenario_id}
