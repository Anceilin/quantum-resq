"""Historical Records API — a read-only archive of PAST disaster responses.

This is an ADDITIONAL feature. It never touches the live optimization, QAOA,
auth, or scenario logic. Records are fixed SIMULATION / DEMO archive data. The
only write path is `load`-as-new-scenario, which deep-copies a record's original
conditions into a fresh scenario so the EXISTING classical/QAOA pipeline can run
on it — no optimizer output is fabricated here.
"""
from __future__ import annotations

import copy
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_current_user, require_scenario_management
from app.models.schemas import (
    HistoricalRecord,
    HistoricalRecordSummary,
    Scenario,
)
from app.services.historical_store import historical_store
from app.services.scenario_store import scenario_store
from app.simulation.road_simulator import recompute_accessibility

router = APIRouter(
    prefix="/api/historical",
    tags=["historical"],
    dependencies=[Depends(get_current_user)],
)


def _summary(record: HistoricalRecord) -> HistoricalRecordSummary:
    s = record.scenario
    return HistoricalRecordSummary(
        id=record.id,
        name=record.name,
        disaster_type=record.disaster_type,
        location=record.location,
        date=record.date,
        status=record.status,
        num_zones=len(s.zones),
        affected_people=sum(z.population for z in s.zones),
        resources_available=sum(s.resources.as_dict().values()),
        resources_allocated=sum(a.units for a in record.recorded_allocation),
        road_blockages=sum(1 for r in s.roads if r.blocked),
        hospital_beds_free=sum(z.hospital_remaining for z in s.zones),
        shelter_beds_free=sum(z.shelter_remaining for z in s.zones),
    )


@router.get("", response_model=List[HistoricalRecordSummary])
def list_historical() -> List[HistoricalRecordSummary]:
    return [_summary(r) for r in historical_store.list()]


@router.get("/{record_id}", response_model=HistoricalRecord)
def get_historical(record_id: str) -> HistoricalRecord:
    record = historical_store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Historical record '{record_id}' not found")
    return record


@router.post("/{record_id}/load", response_model=Scenario, status_code=201)
def load_as_scenario(
    record_id: str,
    user: dict = Depends(get_current_user),
) -> Scenario:
    """Deep-copy a historical record's conditions into a NEW editable scenario.

    The archive itself is never mutated; the copy gets a fresh id and is marked
    non-demo so the existing optimization / QAOA / analytics pipeline runs on it
    unchanged. Requires scenario-management rights (Disaster Management Officer).
    """
    require_scenario_management(user)
    record = historical_store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Historical record '{record_id}' not found")

    scenario = copy.deepcopy(record.scenario)
    scenario.id = f"scn_{uuid.uuid4().hex[:8]}"
    scenario.name = f"{record.name} (from historical)"
    scenario.is_demo = False
    recompute_accessibility(scenario)
    scenario_store.create(scenario)
    return scenario
