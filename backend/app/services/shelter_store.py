"""Shelter Operations & Inventory Store."""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.schemas import (
    ShelterIntakeRequest, ShelterIntakeRecord,
    BedRequestCreate, BedRequest, BedRequestStatusUpdate,
    FoodItem, FoodItemCreate,
    FoodDeliveryRequest, FoodDelivery, FoodDeliveryReceive,
    FoodDistributionRequest, FoodDistributionRecord,
    ShelterFoodAllocation, ShelterProposal,
    ShelterAuditRecord, Scenario
)
from app.services.db import get_collection
from app.services.file_store import JsonFileCollection
from app.services.scenario_store import scenario_store
from app.utils.priority import assign_priority_scores

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%I:%M:%S %p")

class ShelterStore:
    def __init__(self) -> None:
        self._intakes: Dict[str, List[ShelterIntakeRecord]] = {}
        self._bed_requests: Dict[str, List[BedRequest]] = {}
        self._food_items: Dict[str, List[FoodItem]] = {}
        self._food_deliveries: Dict[str, List[FoodDelivery]] = {}
        self._food_distributions: Dict[str, List[FoodDistributionRecord]] = {}
        self._audit_logs: Dict[str, List[ShelterAuditRecord]] = {}
        self._proposals: Dict[str, ShelterProposal] = {}
        
        self._file_intakes = JsonFileCollection("shelter_intakes")
        self._file_bed_requests = JsonFileCollection("shelter_bed_requests")
        self._file_food_items = JsonFileCollection("shelter_food_items")
        self._file_food_deliveries = JsonFileCollection("shelter_food_deliveries")
        self._file_food_distributions = JsonFileCollection("shelter_food_distributions")
        self._file_audit = JsonFileCollection("shelter_audit")
        
        self._lock = threading.Lock()
        self._bootstrap()

    def _get_col(self, name: str):
        return get_collection(name)

    def _bootstrap(self) -> None:
        self._load_col("shelter_intakes", self._file_intakes, ShelterIntakeRecord, self._intakes)
        self._load_col("shelter_bed_requests", self._file_bed_requests, BedRequest, self._bed_requests)
        self._load_col("shelter_food_items", self._file_food_items, FoodItem, self._food_items)
        self._load_col("shelter_food_deliveries", self._file_food_deliveries, FoodDelivery, self._food_deliveries)
        self._load_col("shelter_food_distributions", self._file_food_distributions, FoodDistributionRecord, self._food_distributions)
        self._load_col("shelter_audit", self._file_audit, ShelterAuditRecord, self._audit_logs)

        # Seed baseline demo intakes if missing
        if not self._intakes.get("scn_demo"):
            demo_intakes = [
                ShelterIntakeRecord(
                    id="int_demo_2",
                    scenario_id="scn_demo",
                    timestamp="10:15:00 AM",
                    user_email="coordinator@shelter.qrescue",
                    zone_id="zone_alpha",
                    zone_name="Alpha",
                    count=120,
                    occupancy_before=910,
                    occupancy_after=1030,
                    capacity=1200,
                    notes="Emergency intake relocation batch 2"
                ),
                ShelterIntakeRecord(
                    id="int_demo_1",
                    scenario_id="scn_demo",
                    timestamp="09:00:00 AM",
                    user_email="coordinator@shelter.qrescue",
                    zone_id="zone_alpha",
                    zone_name="Alpha",
                    count=10,
                    occupancy_before=900,
                    occupancy_after=910,
                    capacity=1200,
                    notes="Initial intake batch 1"
                ),
            ]
            self._intakes["scn_demo"] = demo_intakes
            for rec in demo_intakes:
                doc = rec.model_dump(mode="json")
                col = self._get_col("shelter_intakes")
                if col is not None:
                    col.update_one({"id": rec.id}, {"$set": doc}, upsert=True)
                self._file_intakes.upsert({"id": rec.id}, doc)

        # Seed baseline demo food stock if missing
        if not self._food_items.get("scn_demo"):
            demo_food = [
                FoodItem(
                    id="fi_demo_1",
                    scenario_id="scn_demo",
                    name="Emergency Rations Pack",
                    category="packaged_meals",
                    quantity=3500.0,
                    unit="units",
                    storage_location="Central Depot",
                    source="Regional Food Bank",
                    receipt_date="2026-10-10",
                    expiry_date="2026-12-31",
                    min_stock_threshold=500.0,
                    notes="Initial demo food stock",
                    created_at="08:00:00 AM"
                )
            ]
            self._food_items["scn_demo"] = demo_food
            for fi in demo_food:
                doc = fi.model_dump(mode="json")
                col = self._get_col("shelter_food_items")
                if col is not None:
                    col.update_one({"id": fi.id}, {"$set": doc}, upsert=True)
                self._file_food_items.upsert({"id": fi.id}, doc)

    def _load_col(self, col_name, file_store, model_cls, target_dict):
        col = self._get_col(col_name)
        docs = list(col.find({})) if col is not None else file_store.find_all()
        for doc in docs:
            doc.pop("_id", None)
            try:
                rec = model_cls.model_validate(doc)
                target_dict.setdefault(rec.scenario_id, []).append(rec)
            except Exception:
                continue

    def record_audit(self, scenario_id: str, user_email: str, audit_type: str, description: str, details: dict = None) -> ShelterAuditRecord:
        record = ShelterAuditRecord(
            id=f"sa_{datetime.now(timezone.utc).timestamp():.3f}",
            scenario_id=scenario_id,
            timestamp=_now(),
            user_email=user_email,
            type=audit_type,
            description=description,
            details=details or {}
        )
        with self._lock:
            self._audit_logs.setdefault(scenario_id, []).insert(0, record)
        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_audit")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_audit.upsert({"id": record.id}, doc)
        return record

    def record_intake(self, scenario: Scenario, user_email: str, req: ShelterIntakeRequest) -> ShelterIntakeRecord:
        with self._lock:
            zone = next((z for z in scenario.zones if z.id == req.zone_id), None)
            if not zone:
                raise ValueError(f"Zone '{req.zone_id}' not found")
            
            if req.count <= 0:
                raise ValueError("Intake count must be greater than 0")
                
            free_beds = zone.shelter_capacity - zone.shelter_occupancy
            if req.count > free_beds:
                raise ValueError(f"Intake count ({req.count}) exceeds free beds ({free_beds}) in zone '{zone.name}'")

            occ_before = zone.shelter_occupancy
            zone.shelter_occupancy += req.count
            occ_after = zone.shelter_occupancy
            
            zone.food_demand = zone.shelter_occupancy * 3
            scenario_store.update(scenario)

            record = ShelterIntakeRecord(
                id=f"si_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario.id,
                timestamp=_now(),
                user_email=user_email,
                zone_id=zone.id,
                zone_name=zone.name,
                count=req.count,
                occupancy_before=occ_before,
                occupancy_after=occ_after,
                capacity=zone.shelter_capacity,
                notes=req.notes
            )
            self._intakes.setdefault(scenario.id, []).insert(0, record)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_intakes")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_intakes.upsert({"id": record.id}, doc)

        self.record_audit(scenario.id, user_email, "intake", f"Intake of {req.count} people in {zone.name}", {"zone_id": zone.id, "count": req.count})
        return record

    def get_intake_history(self, scenario_id: str) -> List[ShelterIntakeRecord]:
        with self._lock:
            return list(self._intakes.get(scenario_id, []))

    def create_bed_request(self, scenario: Scenario, user_email: str, req: BedRequestCreate) -> BedRequest:
        with self._lock:
            zone = next((z for z in scenario.zones if z.id == req.zone_id), None)
            if not zone:
                raise ValueError(f"Zone '{req.zone_id}' not found")
                
            record = BedRequest(
                id=f"br_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario.id,
                timestamp=_now(),
                user_email=user_email,
                zone_id=zone.id,
                zone_name=zone.name,
                quantity=req.quantity,
                reason=req.reason,
                bed_type=req.bed_type,
                source=req.source,
                requested_date=req.requested_date,
                notes=req.notes,
                status="Requested",
                deployed_quantity=0
            )
            self._bed_requests.setdefault(scenario.id, []).insert(0, record)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_bed_requests")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_bed_requests.upsert({"id": record.id}, doc)
        
        self.record_audit(scenario.id, user_email, "bed_request", f"Requested {req.quantity} beds for {zone.name}")
        return record

    def update_bed_request_status(self, scenario: Scenario, bed_request_id: str, user_email: str, req: BedRequestStatusUpdate) -> BedRequest:
        with self._lock:
            req_list = self._bed_requests.get(scenario.id, [])
            record = next((r for r in req_list if r.id == bed_request_id), None)
            if not record:
                raise ValueError(f"Bed request '{bed_request_id}' not found")

            if record.status == "Deployed":
                raise ValueError("Bed request is already Deployed")

            record.status = req.status
            if req.notes:
                record.notes = req.notes
                
            deployed = 0
            if req.status == "Deployed" and req.deployed_quantity is not None and req.deployed_quantity > 0:
                deployed = req.deployed_quantity
                record.deployed_quantity = deployed
                
                zone = next((z for z in scenario.zones if z.id == record.zone_id), None)
                if zone:
                    zone.shelter_capacity += deployed
                    scenario.resources.shelter_capacity += deployed
                    scenario_store.update(scenario)
                    
        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_bed_requests")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_bed_requests.upsert({"id": record.id}, doc)

        if deployed > 0:
            self.record_audit(scenario.id, user_email, "bed_deploy", f"Deployed {deployed} beds to {record.zone_name}")
            
        return record

    def get_bed_requests(self, scenario_id: str) -> List[BedRequest]:
        with self._lock:
            return list(self._bed_requests.get(scenario_id, []))

    def add_food_item(self, scenario_id: str, user_email: str, req: FoodItemCreate) -> FoodItem:
        with self._lock:
            record = FoodItem(
                id=f"fi_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario_id,
                name=req.name,
                category=req.category,
                quantity=req.quantity,
                unit=req.unit,
                storage_location=req.storage_location,
                source=req.source,
                receipt_date=req.receipt_date,
                expiry_date=req.expiry_date,
                min_stock_threshold=req.min_stock_threshold,
                notes=req.notes,
                created_at=_now()
            )
            self._food_items.setdefault(scenario_id, []).insert(0, record)
            
            scenario = scenario_store.get(scenario_id)
            if scenario:
                scenario.resources.food_units += int(req.quantity)
                scenario_store.update(scenario)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_food_items")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_food_items.upsert({"id": record.id}, doc)
        
        self.record_audit(scenario_id, user_email, "food_add", f"Added food item {req.name} ({req.quantity} {req.unit})")
        return record

    def get_food_items(self, scenario_id: str) -> List[FoodItem]:
        with self._lock:
            return list(self._food_items.get(scenario_id, []))

    def create_food_delivery_request(self, scenario_id: str, user_email: str, req: FoodDeliveryRequest) -> FoodDelivery:
        with self._lock:
            record = FoodDelivery(
                id=f"fd_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario_id,
                timestamp=_now(),
                user_email=user_email,
                food_item_name=req.food_item_name,
                category=req.category,
                quantity=req.quantity,
                unit=req.unit,
                destination=req.destination,
                reason=req.reason,
                priority=req.priority,
                expected_date=req.expected_date,
                supplier=req.supplier,
                notes=req.notes
            )
            self._food_deliveries.setdefault(scenario_id, []).insert(0, record)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_food_deliveries")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_food_deliveries.upsert({"id": record.id}, doc)
        
        return record

    def receive_food_delivery(self, scenario_id: str, delivery_id: str, user_email: str, req: FoodDeliveryReceive) -> FoodDelivery:
        with self._lock:
            req_list = self._food_deliveries.get(scenario_id, [])
            record = next((r for r in req_list if r.id == delivery_id), None)
            if not record:
                raise ValueError(f"Food delivery '{delivery_id}' not found")

            if record.status == "Received":
                raise ValueError("Delivery is already fully Received")

            record.received_quantity += req.received_quantity
            if record.received_quantity >= record.quantity:
                record.status = "Received"
            else:
                record.status = "Partially Received"
            
            if req.notes:
                record.notes = req.notes
                
            fi = FoodItem(
                id=f"fi_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario_id,
                name=record.food_item_name,
                category=record.category,
                quantity=req.received_quantity,
                unit=record.unit,
                storage_location=record.destination,
                source=record.supplier,
                created_at=_now()
            )
            self._food_items.setdefault(scenario_id, []).insert(0, fi)
            
            scenario = scenario_store.get(scenario_id)
            if scenario:
                scenario.resources.food_units += int(req.received_quantity)
                scenario_store.update(scenario)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_food_deliveries")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_food_deliveries.upsert({"id": record.id}, doc)
        
        fi_doc = fi.model_dump(mode="json")
        fi_col = self._get_col("shelter_food_items")
        if fi_col is not None:
            fi_col.update_one({"id": fi.id}, {"$set": fi_doc}, upsert=True)
        self._file_food_items.upsert({"id": fi.id}, fi_doc)
        
        self.record_audit(scenario_id, user_email, "food_receive", f"Received {req.received_quantity} {record.unit} of {record.food_item_name}")
        return record

    def get_food_deliveries(self, scenario_id: str) -> List[FoodDelivery]:
        with self._lock:
            return list(self._food_deliveries.get(scenario_id, []))

    def distribute_food(self, scenario: Scenario, user_email: str, req: FoodDistributionRequest) -> FoodDistributionRecord:
        with self._lock:
            zone = next((z for z in scenario.zones if z.id == req.zone_id), None)
            if not zone:
                raise ValueError(f"Zone '{req.zone_id}' not found")

            items = self._food_items.get(scenario.id, [])
            total_distributed = 0
            
            # Pre-check
            for d_item in req.items:
                fi_id = d_item.get("food_item_id")
                qty = d_item.get("quantity", 0)
                fi = next((f for f in items if f.id == fi_id), None)
                if not fi:
                    raise ValueError(f"Food item '{fi_id}' not found")
                if fi.quantity < qty:
                    raise ValueError(f"Insufficient stock for {fi.name}")
                    
            dist_details = []
            for d_item in req.items:
                fi_id = d_item.get("food_item_id")
                qty = d_item.get("quantity", 0)
                fi = next((f for f in items if f.id == fi_id))
                fi.quantity -= qty
                total_distributed += qty
                dist_details.append({
                    "food_item_id": fi.id,
                    "food_item_name": fi.name,
                    "quantity": qty,
                    "unit": fi.unit
                })
                
                fi_doc = fi.model_dump(mode="json")
                fi_col = self._get_col("shelter_food_items")
                if fi_col is not None:
                    fi_col.update_one({"id": fi.id}, {"$set": fi_doc}, upsert=True)
                self._file_food_items.upsert({"id": fi.id}, fi_doc)
                
            scenario.resources.food_units = max(0, scenario.resources.food_units - int(total_distributed))
            scenario_store.update(scenario)

            record = FoodDistributionRecord(
                id=f"fdist_{datetime.now(timezone.utc).timestamp():.3f}",
                scenario_id=scenario.id,
                timestamp=_now(),
                user_email=user_email,
                zone_id=zone.id,
                zone_name=zone.name,
                items=dist_details,
                notes=req.notes
            )
            self._food_distributions.setdefault(scenario.id, []).insert(0, record)

        doc = record.model_dump(mode="json")
        col = self._get_col("shelter_food_distributions")
        if col is not None:
            col.update_one({"id": record.id}, {"$set": doc}, upsert=True)
        self._file_food_distributions.upsert({"id": record.id}, doc)
        
        self.record_audit(scenario.id, user_email, "food_distribute", f"Distributed food to {zone.name}", {"zone_id": zone.id})
        return record

    def get_food_distributions(self, scenario_id: str) -> List[FoodDistributionRecord]:
        with self._lock:
            return list(self._food_distributions.get(scenario_id, []))

    def record_food_waste(self, scenario_id: str, food_item_id: str, user_email: str, quantity: float, reason: str) -> FoodItem:
        with self._lock:
            items = self._food_items.get(scenario_id, [])
            fi = next((f for f in items if f.id == food_item_id), None)
            if not fi:
                raise ValueError(f"Food item '{food_item_id}' not found")
            if fi.quantity < quantity:
                raise ValueError("Waste quantity exceeds available stock")
                
            fi.quantity -= quantity
            
            scenario = scenario_store.get(scenario_id)
            if scenario:
                scenario.resources.food_units = max(0, scenario.resources.food_units - int(quantity))
                scenario_store.update(scenario)

            fi_doc = fi.model_dump(mode="json")
            fi_col = self._get_col("shelter_food_items")
            if fi_col is not None:
                fi_col.update_one({"id": fi.id}, {"$set": fi_doc}, upsert=True)
            self._file_food_items.upsert({"id": fi.id}, fi_doc)

        self.record_audit(scenario_id, user_email, "food_waste", f"Recorded {quantity} {fi.unit} waste for {fi.name} ({reason})")
        return fi

    def calculate_proposal(self, scenario: Scenario) -> ShelterProposal:
        with self._lock:
            # We don't track distribution history against demand strictly here in simple model,
            # just allocate what's available vs what's demanded.
            sorted_zones = sorted(scenario.zones, key=lambda z: z.priority_score, reverse=True)
            
            total_food = scenario.resources.food_units
            total_demand = sum(z.food_demand for z in scenario.zones)
            
            allocations = []
            stock_remaining = total_food
            
            for z in sorted_zones:
                demand = z.food_demand
                alloc = min(stock_remaining, demand)
                stock_remaining -= alloc
                unmet = demand - alloc
                
                status = "Fully Supplied" if unmet == 0 else ("Partially Supplied" if alloc > 0 else "Shortage")
                allocations.append(ShelterFoodAllocation(
                    zone_id=z.id,
                    zone_name=z.name,
                    population=z.population,
                    food_demand=demand,
                    food_allocated=alloc,
                    food_distributed=0,
                    remaining_unmet=unmet,
                    priority=round(z.priority_score, 1),
                    status=status
                ))

            prop = ShelterProposal(
                id=f"sprop_{datetime.now(timezone.utc).timestamp():.3f}",
                timestamp=_now(),
                scenario_id=scenario.id,
                total_shelter_capacity=sum(z.shelter_capacity for z in scenario.zones),
                total_occupancy=sum(z.shelter_occupancy for z in scenario.zones),
                total_free_beds=sum(z.shelter_capacity - z.shelter_occupancy for z in scenario.zones),
                total_food_available=total_food,
                total_food_demand=total_demand,
                food_allocations=allocations,
                solver_used="Priority Resource Allocator",
                verdict_note="Priority based food allocation."
            )
            self._proposals[scenario.id] = prop
        self.record_audit(scenario.id, "system", "optimization", f"Generated shelter allocation proposal ({len(allocations)} zones)")
        return prop

    def apply_proposal(self, scenario: Scenario, proposal_id: str, user_email: str) -> dict:
        with self._lock:
            prop = self._proposals.get(scenario.id)
            if not prop or prop.id != proposal_id:
                raise ValueError("Proposal not found")
                
            items = self._food_items.get(scenario.id, [])
            if not items and scenario.resources.food_units > 0:
                auto_item = FoodItem(
                    id=f"item_{datetime.now(timezone.utc).timestamp():.3f}",
                    scenario_id=scenario.id,
                    name="Emergency Rations Pool",
                    category="packaged_meals",
                    quantity=float(scenario.resources.food_units),
                    unit="units",
                    storage_location="Central Depot",
                    source="Emergency Stock Pool",
                    receipt_date=_now(),
                    expiry_date="",
                    min_stock_threshold=0.0,
                    notes="Auto-created from scenario resource pool",
                    created_at=_now(),
                )
                self._food_items.setdefault(scenario.id, []).append(auto_item)
                items = [auto_item]
                
            if not items:
                raise ValueError("No food inventory available to distribute")

        # Basic application: allocate from available food items
        for alloc in prop.food_allocations:
            if alloc.food_allocated > 0:
                to_allocate = alloc.food_allocated
                dist_items = []
                with self._lock:
                    for fi in self._food_items.get(scenario.id, []):
                        if to_allocate <= 0:
                            break
                        if fi.quantity > 0:
                            qty = min(fi.quantity, to_allocate)
                            dist_items.append({"food_item_id": fi.id, "quantity": qty})
                            to_allocate -= qty
                            
                if dist_items:
                    req = FoodDistributionRequest(zone_id=alloc.zone_id, items=dist_items, notes="Applied from proposal")
                    self.distribute_food(scenario, user_email, req)

        self.record_audit(scenario.id, user_email, "optimization", f"Applied shelter optimization proposal {proposal_id}")
        return {"status": "success"}

    def get_overview(self, scenario_id: str) -> dict:
        scenario = scenario_store.get(scenario_id)
        if not scenario:
            return {}
        with self._lock:
            ration = getattr(self, "_ration_per_person", 3)
            days = getattr(self, "_planning_days", 1)
            for z in scenario.zones:
                z.food_demand = z.shelter_occupancy * ration * days

            bed_reqs = self._bed_requests.get(scenario_id, [])
            pending_beds_by_zone: Dict[str, int] = {}
            deployed_beds_by_zone: Dict[str, int] = {}
            for br in bed_reqs:
                if br.status in ("Requested", "Approved", "In Transit"):
                    pending_beds_by_zone[br.zone_id] = pending_beds_by_zone.get(br.zone_id, 0) + br.quantity
                elif br.status == "Deployed":
                    deployed_beds_by_zone[br.zone_id] = deployed_beds_by_zone.get(br.zone_id, 0) + br.deployed_quantity

            zones_data = []
            for z in scenario.zones:
                free = max(0, z.shelter_capacity - z.shelter_occupancy)
                pct = (z.shelter_occupancy / z.shelter_capacity * 100.0) if z.shelter_capacity > 0 else 0.0
                zones_data.append({
                    "zone_id": z.id,
                    "zone_name": z.name,
                    "capacity": z.shelter_capacity,
                    "occupancy": z.shelter_occupancy,
                    "free_beds": free,
                    "occupancy_pct": round(pct, 1),
                    "additional_beds_pending": pending_beds_by_zone.get(z.id, 0),
                    "additional_beds_deployed": deployed_beds_by_zone.get(z.id, 0),
                    "food_demand": z.food_demand,
                    "priority": round(z.priority_score, 1),
                    "severity": z.severity.value if hasattr(z.severity, "value") else str(z.severity),
                })

            tot_cap = sum(z.shelter_capacity for z in scenario.zones)
            tot_occ = sum(z.shelter_occupancy for z in scenario.zones)
            tot_free = max(0, tot_cap - tot_occ)
            tot_food_demand = sum(z.food_demand for z in scenario.zones)
            tot_food_units = scenario.resources.food_units
            occ_rate = round((tot_occ / tot_cap * 100.0), 1) if tot_cap > 0 else 0.0

            food_items = [f.model_dump(mode="json") for f in self._food_items.get(scenario_id, [])]
            intake_history = [r.model_dump(mode="json") for r in self._intakes.get(scenario_id, [])]
            bed_requests = [b.model_dump(mode="json") for b in bed_reqs]
            food_deliveries = [d.model_dump(mode="json") for d in self._food_deliveries.get(scenario_id, [])]
            food_distributions = [d.model_dump(mode="json") for d in self._food_distributions.get(scenario_id, [])]
            audit_log = [a.model_dump(mode="json") for a in self._audit_logs.get(scenario_id, [])]

            return {
                "scenario_id": scenario_id,
                "total_capacity": tot_cap,
                "total_shelter_capacity": tot_cap,
                "total_occupancy": tot_occ,
                "total_free_beds": tot_free,
                "occupancy_rate": occ_rate,
                "total_food_units": tot_food_units,
                "total_food_available": tot_food_units,
                "total_food_demand": tot_food_demand,
                "food_shortage": max(0, tot_food_demand - tot_food_units),
                "demand_model": {
                    "ration_per_person": ration,
                    "planning_days": days,
                },
                "zones": zones_data,
                "food_items": food_items,
                "intake_history": intake_history,
                "bed_requests": bed_requests,
                "food_deliveries": food_deliveries,
                "food_distributions": food_distributions,
                "audit_log": audit_log,
            }

    def get_audit_log(self, scenario_id: str) -> List[ShelterAuditRecord]:
        with self._lock:
            return list(self._audit_logs.get(scenario_id, []))

shelter_store = ShelterStore()
