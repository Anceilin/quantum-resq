"""Medical Operations & Dispatch Store.

Provides thread-safe, persistent management of medical inventory adjustments,
priority knapsack allocation proposals, atomic dispatch confirmations,
delivery tracking, and cancellation with single-restoration safety.

All data is SIMULATION / DEMO DATA.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.schemas import (
    InventoryAdjustmentRequest,
    InventoryAuditRecord,
    MedicalDispatchConfirmRequest,
    MedicalDispatchItem,
    MedicalDispatchRecord,
    MedicalProposal,
    Scenario,
)
from app.services.db import get_collection
from app.services.file_store import JsonFileCollection
from app.services.scenario_store import scenario_store
from app.utils.priority import assign_priority_scores


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%I:%M:%S %p")


class MedicalStore:
    def __init__(self) -> None:
        self._dispatches: Dict[str, List[MedicalDispatchRecord]] = {}
        self._audit_logs: Dict[str, List[InventoryAuditRecord]] = {}
        self._allocated_maps: Dict[str, Dict[str, int]] = {}
        self._proposals: Dict[str, MedicalProposal] = {}
        self._file_dispatches = JsonFileCollection("medical_dispatches")
        self._file_audit = JsonFileCollection("medical_audit")
        self._lock = threading.Lock()
        self._bootstrap()

    @property
    def _col_dispatches(self):
        return get_collection("medical_dispatches")

    @property
    def _col_audit(self):
        return get_collection("medical_inventory_audit")

    def _bootstrap(self) -> None:
        col_d = self._col_dispatches
        dispatch_docs = list(col_d.find({})) if col_d is not None else self._file_dispatches.find_all()
        for doc in dispatch_docs:
            doc.pop("_id", None)
            try:
                rec = MedicalDispatchRecord.model_validate(doc)
                self._dispatches.setdefault(rec.scenario_id, []).append(rec)
                if rec.status in ("Confirmed", "Dispatched", "Delivered"):
                    allocated = self._allocated_maps.setdefault(rec.scenario_id, {})
                    for item in rec.dispatches:
                        allocated[item.zone_id] = (
                            allocated.get(item.zone_id, 0) + item.dispatch_units
                        )
            except Exception:
                continue

        col_a = self._col_audit
        audit_docs = list(col_a.find({})) if col_a is not None else self._file_audit.find_all()
        for doc in audit_docs:
            doc.pop("_id", None)
            try:
                rec = InventoryAuditRecord.model_validate(doc)
                self._audit_logs.setdefault(rec.scenario_id, []).append(rec)
            except Exception:
                continue

    def get_allocated_map(self, scenario_id: str) -> Dict[str, int]:
        with self._lock:
            return dict(self._allocated_maps.get(scenario_id, {}))

    def get_history(self, scenario_id: str) -> Dict[str, Any]:
        with self._lock:
            dispatches = [
                d.model_dump(mode="json")
                for d in self._dispatches.get(scenario_id, [])
            ]
            audits = [
                a.model_dump(mode="json")
                for a in self._audit_logs.get(scenario_id, [])
            ]
            return {"dispatches": dispatches, "audit_log": audits}

    def record_audit(
        self,
        scenario_id: str,
        user_email: str,
        audit_type: str,
        quantity: int,
        reason: str,
        stock_before: int,
        stock_after: int,
    ) -> InventoryAuditRecord:
        record = InventoryAuditRecord(
            id=f"audit_{datetime.now(timezone.utc).timestamp():.3f}",
            scenario_id=scenario_id,
            timestamp=_now(),
            user_email=user_email,
            type=audit_type,
            quantity=quantity,
            reason=reason,
            stock_before=stock_before,
            stock_after=stock_after,
        )
        with self._lock:
            self._audit_logs.setdefault(scenario_id, []).insert(0, record)
        doc = record.model_dump(mode="json")
        col = self._col_audit
        if col is not None:
            col.update_one(
                {"id": record.id},
                {"$set": doc},
                upsert=True,
            )
        self._file_audit.upsert({"id": record.id}, doc)
        return record

    def adjust_inventory(
        self,
        scenario: Scenario,
        user_email: str,
        req: InventoryAdjustmentRequest,
    ) -> Scenario:
        with self._lock:
            stock_before = scenario.resources.medical_kits
            if req.type == "addition":
                if req.quantity <= 0:
                    raise ValueError("Stock addition quantity must be greater than 0")
                stock_after = stock_before + req.quantity
            elif req.type == "correction":
                if req.quantity < 0:
                    raise ValueError("Stock correction quantity cannot be negative")
                stock_after = req.quantity
            else:
                raise ValueError(f"Unknown inventory adjustment type: '{req.type}'")

            scenario.resources.medical_kits = stock_after
            scenario_store.update(scenario)

        # Record audit entry
        self.record_audit(
            scenario_id=scenario.id,
            user_email=user_email,
            audit_type=f"inventory_{req.type}",
            quantity=req.quantity,
            reason=req.reason,
            stock_before=stock_before,
            stock_after=stock_after,
        )

        # Invalidate active proposal
        with self._lock:
            if scenario.id in self._proposals:
                self._proposals[scenario.id].is_stale = True

        return scenario

    def calculate_proposal(
        self, scenario: Scenario, solver_name: str = "Priority Knapsack"
    ) -> MedicalProposal:
        allocated_map = self.get_allocated_map(scenario.id)
        sorted_zones = sorted(scenario.zones, key=lambda z: z.priority_score, reverse=True)

        stock_remaining = scenario.resources.medical_kits
        total_demand = 0
        total_proposed_dispatch = 0
        total_projected_unmet = 0

        dispatches: List[MedicalDispatchItem] = []
        for z in sorted_zones:
            demand = z.medical_demand
            total_demand += demand
            current_alloc = allocated_map.get(z.id, 0)
            remaining_unmet = max(0, demand - current_alloc)

            dispatch_units = min(stock_remaining, remaining_unmet)
            stock_remaining -= dispatch_units
            total_proposed_dispatch += dispatch_units

            projected_alloc = current_alloc + dispatch_units
            projected_unmet = max(0, demand - projected_alloc)
            total_projected_unmet += projected_unmet

            status_after = "Shortage"
            if projected_unmet == 0:
                status_after = "Fully Supplied"
            elif projected_alloc > 0:
                status_after = "Partially Supplied"

            dispatches.append(
                MedicalDispatchItem(
                    zone_id=z.id,
                    zone_name=z.name,
                    priority=round(z.priority_score, 1),
                    demand_before=demand,
                    allocated_before=current_alloc,
                    dispatch_units=dispatch_units,
                    demand_after=projected_unmet,
                    status_after=status_after,
                )
            )

        verdict_note = (
            f"Proposed dispatch allocates {total_proposed_dispatch:,} medical kits across {len(scenario.zones)} zones. "
            f"{total_projected_unmet:,} kits shortage remains."
            if total_projected_unmet > 0
            else "All medical demand fully satisfied under proposed dispatch."
        )

        proposal = MedicalProposal(
            id=f"prop_{datetime.now(timezone.utc).timestamp():.3f}",
            timestamp=_now(),
            scenario_id=scenario.id,
            available_stock=scenario.resources.medical_kits,
            total_demand=total_demand,
            total_proposed_dispatch=total_proposed_dispatch,
            projected_remaining_stock=stock_remaining,
            projected_unmet_demand=total_projected_unmet,
            dispatches=dispatches,
            solver_used=solver_name,
            verdict_note=verdict_note,
            is_stale=False,
        )

        with self._lock:
            self._proposals[scenario.id] = proposal

        return proposal

    def confirm_dispatch(
        self,
        scenario: Scenario,
        user_email: str,
        req: MedicalDispatchConfirmRequest,
    ) -> MedicalDispatchRecord:
        with self._lock:
            proposal = self._proposals.get(scenario.id)

            if req.dispatches is not None:
                dispatch_items = req.dispatches
            elif proposal is not None and not proposal.is_stale:
                dispatch_items = proposal.dispatches
            else:
                raise ValueError("No active or valid medical allocation proposal to confirm")

            # Check for duplicate zones and negative values
            seen_zones = set()
            for item in dispatch_items:
                if item.zone_id in seen_zones:
                    raise ValueError(f"Duplicate zone '{item.zone_id}' in dispatch request")
                seen_zones.add(item.zone_id)
                if item.dispatch_units < 0:
                    raise ValueError(f"Dispatch quantity cannot be negative for zone '{item.zone_id}'")

            total_to_dispatch = sum(item.dispatch_units for item in dispatch_items)
            stock_before = scenario.resources.medical_kits

            if total_to_dispatch > stock_before:
                raise ValueError(
                    f"Requested total dispatch ({total_to_dispatch}) exceeds available medical stock ({stock_before})"
                )

            # Validate each zone dispatch does not exceed remaining demand (total requirement - already allocated)
            by_id = {z.id: z for z in scenario.zones}
            allocated_map = self._allocated_maps.setdefault(scenario.id, {})
            for item in dispatch_items:
                z = by_id.get(item.zone_id)
                if not z:
                    raise ValueError(f"Zone '{item.zone_id}' not found")
                current_alloc = allocated_map.get(item.zone_id, 0)
                remaining_demand = max(0, z.medical_demand - current_alloc)
                if item.dispatch_units > remaining_demand:
                    raise ValueError(
                        f"Allocation for zone '{z.name}' ({item.dispatch_units}) exceeds remaining demand ({remaining_demand})"
                    )

            # Deduct stock and update allocation map (keep z.medical_demand as total requirement)
            stock_after = stock_before - total_to_dispatch
            scenario.resources.medical_kits = stock_after

            for item in dispatch_items:
                if item.dispatch_units > 0:
                    allocated_map[item.zone_id] = allocated_map.get(item.zone_id, 0) + item.dispatch_units

            scenario_store.update(scenario)

            record = MedicalDispatchRecord(
                id=f"disp_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario.id,
                timestamp=_now(),
                user_email=user_email,
                total_dispatched=total_to_dispatch,
                remaining_stock_after=stock_after,
                status="Confirmed",
                dispatches=dispatch_items,
                note=req.note,
            )

            self._dispatches.setdefault(scenario.id, []).insert(0, record)
            if scenario.id in self._proposals:
                del self._proposals[scenario.id]

        # Audit log
        self.record_audit(
            scenario_id=scenario.id,
            user_email=user_email,
            audit_type="dispatch_deduction",
            quantity=total_to_dispatch,
            reason=f"Confirmed dispatch {record.id}",
            stock_before=stock_before,
            stock_after=stock_after,
        )

        col_d = self._col_dispatches
        doc = record.model_dump(mode="json")
        if col_d is not None:
            col_d.update_one(
                {"id": record.id},
                {"$set": doc},
                upsert=True,
            )
        self._file_dispatches.upsert({"id": record.id}, doc)

        return record

    def cancel_dispatch(
        self, scenario: Scenario, dispatch_id: str, user_email: str
    ) -> MedicalDispatchRecord:
        with self._lock:
            dispatches = self._dispatches.get(scenario.id, [])
            record = next((d for d in dispatches if d.id == dispatch_id), None)
            if not record:
                raise ValueError(f"Dispatch '{dispatch_id}' not found")

            if record.status == "Cancelled":
                raise ValueError(f"Dispatch '{dispatch_id}' is already cancelled")
            if record.status == "Delivered":
                raise ValueError("Completed/delivered dispatches cannot be cancelled without return audit")

            record.status = "Cancelled"

            stock_before = scenario.resources.medical_kits
            total_restored = record.total_dispatched
            stock_after = stock_before + total_restored
            scenario.resources.medical_kits = stock_after

            allocated_map = self._allocated_maps.setdefault(scenario.id, {})

            for item in record.dispatches:
                if item.dispatch_units > 0:
                    allocated_map[item.zone_id] = max(
                        0, allocated_map.get(item.zone_id, 0) - item.dispatch_units
                    )

            scenario_store.update(scenario)

        # Audit entry
        self.record_audit(
            scenario_id=scenario.id,
            user_email=user_email,
            audit_type="cancellation_restoration",
            quantity=total_restored,
            reason=f"Cancelled dispatch {dispatch_id}, restored stock and zone demand",
            stock_before=stock_before,
            stock_after=stock_after,
        )

        col_d = self._col_dispatches
        doc = record.model_dump(mode="json")
        if col_d is not None:
            col_d.update_one(
                {"id": record.id},
                {"$set": doc},
                upsert=True,
            )
        self._file_dispatches.upsert({"id": record.id}, doc)

        return record

    def complete_dispatch(
        self, scenario: Scenario, dispatch_id: str, user_email: str
    ) -> MedicalDispatchRecord:
        with self._lock:
            dispatches = self._dispatches.get(scenario.id, [])
            record = next((d for d in dispatches if d.id == dispatch_id), None)
            if not record:
                raise ValueError(f"Dispatch '{dispatch_id}' not found")
            if record.status in ("Cancelled", "Delivered"):
                raise ValueError(f"Dispatch status is '{record.status}', cannot mark delivered")

            record.status = "Delivered"

        col_d = self._col_dispatches
        doc = record.model_dump(mode="json")
        if col_d is not None:
            col_d.update_one(
                {"id": record.id},
                {"$set": doc},
                upsert=True,
            )
        self._file_dispatches.upsert({"id": record.id}, doc)

        return record

    def reset_medical_baseline(self, scenario: Scenario, user_email: str) -> Scenario:
        baseline_demands = {
            "zone_alpha": 320,
            "zone_bravo": 210,
            "zone_charlie": 180,
            "zone_delta": 95,
            "zone_echo": 70,
            "zone_foxtrot": 40,
        }
        with self._lock:
            stock_before = scenario.resources.medical_kits
            scenario.resources.medical_kits = 1000
            stock_after = 1000

            for z in scenario.zones:
                if z.id in baseline_demands:
                    z.medical_demand = baseline_demands[z.id]

            self._allocated_maps[scenario.id] = {}
            self._dispatches[scenario.id] = []
            if scenario.id in self._proposals:
                del self._proposals[scenario.id]

            assign_priority_scores(scenario.zones)
            scenario_store.update(scenario)

        self.record_audit(
            scenario_id=scenario.id,
            user_email=user_email,
            audit_type="baseline_reset",
            quantity=1000,
            reason="Reset medical baseline to 1,000 kits available / 915 demand across 6 zones",
            stock_before=stock_before,
            stock_after=stock_after,
        )

        return scenario


medical_store = MedicalStore()

