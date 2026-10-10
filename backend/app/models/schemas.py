"""Pydantic data models for QuantumResQ.

All disaster data is SIMULATION / DEMO DATA. No real emergency-service data is
used or implied.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class SeverityLevel(str, Enum):
    critical = "critical"
    high = "high"
    moderate = "moderate"
    low = "low"


class DisasterType(str, Enum):
    flood = "flood"
    cyclone = "cyclone"
    earthquake = "earthquake"
    wildfire = "wildfire"
    accident = "accident"


class Zone(BaseModel):
    """A single affected zone in the simulated disaster."""

    id: str
    name: str
    latitude: float
    longitude: float
    population: int = Field(ge=0)
    severity: SeverityLevel
    children: int = Field(ge=0)
    elderly: int = Field(ge=0)
    disabled: int = Field(ge=0)
    medical_demand: int = Field(ge=0)
    food_demand: int = Field(ge=0)
    rescue_demand: int = Field(ge=0)
    priority_score: float = Field(ge=0, le=100)
    hospital_capacity: int = Field(ge=0)
    hospital_occupancy: int = Field(ge=0)
    shelter_capacity: int = Field(ge=0)
    shelter_occupancy: int = Field(ge=0)
    road_accessibility: float = Field(ge=0.0, le=1.0)

    @property
    def vulnerable_population(self) -> int:
        return self.children + self.elderly + self.disabled

    @property
    def hospital_remaining(self) -> int:
        return max(0, self.hospital_capacity - self.hospital_occupancy)

    @property
    def shelter_remaining(self) -> int:
        return max(0, self.shelter_capacity - self.shelter_occupancy)


class Resources(BaseModel):
    """Pool of deployable emergency resources available to the agency."""

    ambulances: int = Field(ge=0)
    rescue_teams: int = Field(ge=0)
    medical_kits: int = Field(ge=0)
    food_units: int = Field(ge=0)
    shelter_capacity: int = Field(ge=0)
    emergency_vehicles: int = Field(ge=0)

    def as_dict(self) -> Dict[str, int]:
        return {
            "ambulances": self.ambulances,
            "rescue_teams": self.rescue_teams,
            "medical_kits": self.medical_kits,
            "food_units": self.food_units,
            "shelter_capacity": self.shelter_capacity,
            "emergency_vehicles": self.emergency_vehicles,
        }


RESOURCE_KEYS = [
    "ambulances",
    "rescue_teams",
    "medical_kits",
    "food_units",
    "shelter_capacity",
    "emergency_vehicles",
]


class Road(BaseModel):
    """A road segment connecting two nodes (the depot or a zone)."""

    id: str
    source: str
    target: str
    distance_km: float = Field(gt=0)
    blocked: bool = False
    is_primary: bool = True


class Scenario(BaseModel):
    """A complete simulated emergency scenario."""

    id: str
    name: str
    disaster_type: DisasterType
    description: str
    is_demo: bool = True
    budget: float = Field(gt=0)
    zones: List[Zone]
    resources: Resources
    roads: List[Road] = Field(default_factory=list)
    # Per-resource unit deployment cost used by the budget constraint.
    resource_costs: Dict[str, float] = Field(default_factory=dict)
    created_at: str = ""


class ScenarioCreate(BaseModel):
    """Request body used to create a custom scenario."""

    name: Optional[str] = None
    disaster_type: DisasterType = DisasterType.flood
    budget: Optional[float] = None
    zones: Optional[List[Zone]] = None
    resources: Optional[Resources] = None
    roads: Optional[List[Road]] = None


class RoadBlockRequest(BaseModel):
    """Toggle the OPEN / BLOCKED state of a road within a scenario."""

    scenario_id: str
    road_id: str
    blocked: bool


class ZoneUpdate(BaseModel):
    """Partial edit of a single zone (drives re-optimization)."""

    id: str
    population: Optional[int] = Field(default=None, ge=0)
    severity: Optional[SeverityLevel] = None
    medical_demand: Optional[int] = Field(default=None, ge=0)
    food_demand: Optional[int] = Field(default=None, ge=0)
    rescue_demand: Optional[int] = Field(default=None, ge=0)
    hospital_capacity: Optional[int] = Field(default=None, ge=0)
    hospital_occupancy: Optional[int] = Field(default=None, ge=0)
    shelter_capacity: Optional[int] = Field(default=None, ge=0)
    shelter_occupancy: Optional[int] = Field(default=None, ge=0)


class ScenarioUpdate(BaseModel):
    """Partial edit of a scenario: resources, budget, and per-zone overrides.

    `resources` is a partial mapping (resource key -> new integer count); only
    the keys present are changed, the rest keep their current value.
    """

    resources: Optional[Dict[str, int]] = None
    budget: Optional[float] = Field(default=None, gt=0)
    zone_updates: Optional[List[ZoneUpdate]] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    simulation: bool = True
    notice: str = "SIMULATION / DEMO DATA"
    persistence: str = "memory"


class ScenarioSummary(BaseModel):
    id: str
    name: str
    disaster_type: DisasterType
    num_zones: int
    total_population: int
    total_resources: int
    budget: float
    is_demo: bool


# ---------------------------------------------------------------------------
# Medical Operations & Dispatch schemas
# ---------------------------------------------------------------------------

class MedicalDispatchItem(BaseModel):
    zone_id: str
    zone_name: str
    priority: float
    demand_before: int = Field(ge=0)
    allocated_before: int = Field(ge=0)
    dispatch_units: int = Field(ge=0)
    demand_after: int = Field(ge=0)
    status_after: str  # 'Fully Supplied' | 'Partially Supplied' | 'Shortage'


class MedicalProposal(BaseModel):
    id: str
    timestamp: str
    scenario_id: str
    available_stock: int = Field(ge=0)
    total_demand: int = Field(ge=0)
    total_proposed_dispatch: int = Field(ge=0)
    projected_remaining_stock: int = Field(ge=0)
    projected_unmet_demand: int = Field(ge=0)
    dispatches: List[MedicalDispatchItem]
    solver_used: str
    verdict_note: str
    is_stale: bool = False


class MedicalDispatchConfirmRequest(BaseModel):
    dispatches: Optional[List[MedicalDispatchItem]] = None
    note: Optional[str] = None


class InventoryAdjustmentRequest(BaseModel):
    type: str = Field(description="'addition' | 'correction'")
    quantity: int = Field(description="Quantity to add (positive) or set/correct")
    reason: str = Field(min_length=1, description="Audit reason for stock change")


class MedicalDispatchRecord(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    total_dispatched: int = Field(ge=0)
    remaining_stock_after: int = Field(ge=0)
    status: str = "Confirmed"  # 'Confirmed' | 'Dispatched' | 'Delivered' | 'Cancelled'
    dispatches: List[MedicalDispatchItem]
    note: Optional[str] = None


class InventoryAuditRecord(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    type: str  # 'addition' | 'correction' | 'dispatch_deduction' | 'cancellation_restoration'
    quantity: int
    reason: str
    stock_before: int
    stock_after: int


# ---------------------------------------------------------------------------
# Shelter Operations schemas
# ---------------------------------------------------------------------------

class ShelterIntakeRequest(BaseModel):
    zone_id: str
    count: int = Field(gt=0, description="Number of people to intake")
    notes: str = Field(default="", description="Optional intake notes")


class ShelterIntakeRecord(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    zone_id: str
    zone_name: str
    count: int = Field(gt=0)
    occupancy_before: int
    occupancy_after: int
    capacity: int
    notes: str = ""


class BedRequestCreate(BaseModel):
    zone_id: str
    quantity: int = Field(gt=0)
    reason: str = Field(min_length=1)
    bed_type: str = Field(default="cots", description="cots|temporary_shelter|overflow|additional_capacity")
    source: str = Field(default="", description="Supplying organization")
    requested_date: str = Field(default="", description="Expected deployment date")
    notes: str = ""


class BedRequest(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    zone_id: str
    zone_name: str
    quantity: int = Field(gt=0)
    reason: str
    bed_type: str = "cots"
    source: str = ""
    requested_date: str = ""
    notes: str = ""
    status: str = "Requested"  # Requested|Approved|In Transit|Deployed|Rejected|Cancelled
    deployed_quantity: int = Field(default=0, ge=0)


class BedRequestStatusUpdate(BaseModel):
    status: str = Field(description="Approved|In Transit|Deployed|Rejected|Cancelled")
    deployed_quantity: Optional[int] = Field(default=None, ge=0)
    notes: str = ""


class FoodItem(BaseModel):
    id: str
    scenario_id: str
    name: str
    category: str  # rice_grains|pulses_lentils|packaged_meals|ready_to_eat|drinking_water|cooking_oil|other
    quantity: float = Field(ge=0)
    unit: str  # kg|litres|packets|crates|meal_portions
    storage_location: str = ""
    source: str = ""
    receipt_date: str = ""
    expiry_date: str = ""
    min_stock_threshold: float = Field(default=0, ge=0)
    notes: str = ""
    created_at: str = ""


class FoodItemCreate(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(default="other")
    quantity: float = Field(ge=0)
    unit: str = Field(default="kg")
    storage_location: str = ""
    source: str = ""
    receipt_date: str = ""
    expiry_date: str = ""
    min_stock_threshold: float = Field(default=0, ge=0)
    notes: str = ""


class FoodDeliveryRequest(BaseModel):
    food_item_name: str = Field(min_length=1)
    category: str = Field(default="other")
    quantity: float = Field(gt=0)
    unit: str = Field(default="kg")
    destination: str = Field(default="central_warehouse")
    reason: str = Field(default="")
    priority: str = Field(default="normal")  # low|normal|high|critical
    expected_date: str = ""
    supplier: str = ""
    notes: str = ""


class FoodDelivery(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    food_item_name: str
    category: str
    quantity: float = Field(gt=0)
    received_quantity: float = Field(default=0, ge=0)
    unit: str
    destination: str = "central_warehouse"
    reason: str = ""
    priority: str = "normal"
    expected_date: str = ""
    supplier: str = ""
    notes: str = ""
    status: str = "Requested"  # Requested|Approved|In Transit|Partially Received|Received|Rejected|Cancelled


class FoodDeliveryReceive(BaseModel):
    received_quantity: float = Field(gt=0)
    notes: str = ""


class FoodDistributionRequest(BaseModel):
    zone_id: str
    items: List[dict] = Field(description="List of {food_item_id, quantity}")
    notes: str = ""


class FoodDistributionRecord(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    zone_id: str
    zone_name: str
    items: List[dict]  # [{food_item_id, food_item_name, quantity, unit}]
    notes: str = ""


class ShelterFoodAllocation(BaseModel):
    zone_id: str
    zone_name: str
    population: int
    food_demand: int
    food_allocated: int
    food_distributed: int
    remaining_unmet: int
    priority: float
    status: str  # Fully Supplied|Partially Supplied|Shortage


class ShelterProposal(BaseModel):
    id: str
    timestamp: str
    scenario_id: str
    total_shelter_capacity: int = Field(ge=0)
    total_occupancy: int = Field(ge=0)
    total_free_beds: int = Field(ge=0)
    total_food_available: float = Field(ge=0)
    total_food_demand: int = Field(ge=0)
    food_allocations: List[ShelterFoodAllocation]
    bed_recommendations: List[dict] = Field(default_factory=list)
    solver_used: str
    verdict_note: str


class ShelterAuditRecord(BaseModel):
    id: str
    scenario_id: str
    timestamp: str
    user_email: str
    type: str  # intake|bed_request|bed_deploy|food_add|food_receive|food_distribute|food_waste|optimization
    description: str
    details: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Historical Records — a read-only archive of PAST, completed disaster
# responses. These are fixed SIMULATION / DEMO archive entries, NOT live
# operations and NOT optimizer output. Each record embeds the original
# scenario conditions plus the final allocation that was historically recorded.
# ---------------------------------------------------------------------------

class RecordedAllocationItem(BaseModel):
    """One line of a historical record's final recorded allocation.

    This is archived past-tense response data (demo), explicitly NOT a
    classical/QAOA solver result.
    """

    resource: str
    resource_label: str
    zone_id: str
    zone_name: str
    units: int = Field(ge=0)


class HistoricalRecord(BaseModel):
    id: str
    name: str
    disaster_type: DisasterType
    location: str
    date: str
    status: str = "historical"  # 'completed' | 'historical'
    description: str
    scenario: Scenario
    recorded_allocation: List[RecordedAllocationItem] = Field(default_factory=list)


class HistoricalRecordSummary(BaseModel):
    id: str
    name: str
    disaster_type: DisasterType
    location: str
    date: str
    status: str
    num_zones: int
    affected_people: int
    resources_available: int
    resources_allocated: int
    road_blockages: int
    hospital_beds_free: int
    shelter_beds_free: int
