"""Simulation API routes (road blocking).

Blocking a road mutates the stored scenario, recomputes zone accessibility and
travel costs, and returns the before/after accessibility so the frontend can
show a real change — not a cosmetic one.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_current_user, require_road_block
from app.models.schemas import RoadBlockRequest, Scenario
from app.services.scenario_store import scenario_store
from app.simulation.road_simulator import recompute_accessibility, travel_costs

router = APIRouter(
    prefix="/api/simulation",
    tags=["simulation"],
    dependencies=[Depends(get_current_user)],
)


class RoadBlockResult(BaseModel):
    scenario: Scenario
    road_id: str
    blocked: bool
    accessibility_before: Dict[str, float]
    accessibility_after: Dict[str, float]
    travel_costs_after: Dict[str, Optional[float]]
    changed_zones: List[str]
    unreachable_zones: List[str]


@router.post("/road-block", response_model=RoadBlockResult)
def toggle_road(req: RoadBlockRequest, user: dict = Depends(get_current_user)) -> RoadBlockResult:
    require_road_block(user)
    scenario = scenario_store.get(req.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario '{req.scenario_id}' not found")

    road = next((r for r in scenario.roads if r.id == req.road_id), None)
    if road is None:
        raise HTTPException(status_code=404, detail=f"Road '{req.road_id}' not found in scenario")

    accessibility_before = {z.id: z.road_accessibility for z in scenario.zones}

    road.blocked = req.blocked
    recompute_accessibility(scenario)
    scenario_store.update(scenario)

    accessibility_after = {z.id: z.road_accessibility for z in scenario.zones}
    costs = travel_costs(scenario)
    costs_after = {zid: (None if c == float("inf") else round(c, 3)) for zid, c in costs.items()}

    changed = [
        zid for zid in accessibility_before
        if abs(accessibility_before[zid] - accessibility_after[zid]) > 1e-9
    ]
    unreachable = [zid for zid, c in costs.items() if c == float("inf")]

    return RoadBlockResult(
        scenario=scenario,
        road_id=req.road_id,
        blocked=req.blocked,
        accessibility_before=accessibility_before,
        accessibility_after=accessibility_after,
        travel_costs_after=costs_after,
        changed_zones=changed,
        unreachable_zones=unreachable,
    )
