"""User, official-role and permission models for authentication + RBAC.

Five official roles share ONE unified dashboard. The role only decides which
scenario fields/actions a user may EDIT — everyone can view the dashboard and
run/view optimisation. Permissions are enforced on the backend (see
app.api.dependencies) and mirrored on the frontend via the payload returned by
GET /api/auth/me, so there is a single source of truth.

All data is SIMULATION / DEMO DATA.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Role(str, Enum):
    disaster_management_officer = "disaster_management_officer"
    resource_coordinator = "resource_coordinator"
    medical_coordinator = "medical_coordinator"
    rescue_coordinator = "rescue_coordinator"
    shelter_coordinator = "shelter_coordinator"


ROLE_LABELS: Dict[Role, str] = {
    Role.disaster_management_officer: "Disaster Management Officer",
    Role.resource_coordinator: "Resource Coordinator",
    Role.medical_coordinator: "Medical Coordinator",
    Role.rescue_coordinator: "Rescue Coordinator",
    Role.shelter_coordinator: "Shelter Coordinator",
}

# Every zone field a coordinator role may edit (used as the universe for gates).
ALL_ZONE_FIELDS = [
    "population",
    "severity",
    "medical_demand",
    "food_demand",
    "rescue_demand",
    "hospital_capacity",
    "hospital_occupancy",
    "shelter_capacity",
    "shelter_occupancy",
]

ALL_RESOURCE_KEYS = [
    "ambulances",
    "rescue_teams",
    "medical_kits",
    "food_units",
    "shelter_capacity",
    "emergency_vehicles",
]


class Permissions(BaseModel):
    """Resolved, serialisable edit/action rights for a single user."""

    role: Role
    role_label: str
    can_manage_scenarios: bool = False
    can_edit_resources: List[str] = Field(default_factory=list)
    can_edit_zone_fields: List[str] = Field(default_factory=list)
    can_block_roads: bool = False
    can_run_optimization: bool = True
    can_reoptimize: bool = True


def permissions_for_role(role: Role) -> Permissions:
    label = ROLE_LABELS[role]
    if role == Role.disaster_management_officer:
        return Permissions(
            role=role,
            role_label=label,
            can_manage_scenarios=True,
            can_edit_resources=list(ALL_RESOURCE_KEYS),
            can_edit_zone_fields=list(ALL_ZONE_FIELDS),
            can_block_roads=True,
        )
    if role == Role.resource_coordinator:
        return Permissions(
            role=role,
            role_label=label,
            can_edit_resources=list(ALL_RESOURCE_KEYS),
        )
    if role == Role.medical_coordinator:
        return Permissions(
            role=role,
            role_label=label,
            can_edit_resources=["medical_kits"],
            can_edit_zone_fields=["hospital_capacity", "hospital_occupancy", "medical_demand"],
        )
    if role == Role.rescue_coordinator:
        return Permissions(
            role=role,
            role_label=label,
            can_edit_zone_fields=["rescue_demand", "population", "severity"],
            can_block_roads=True,
        )
    if role == Role.shelter_coordinator:
        return Permissions(
            role=role,
            role_label=label,
            can_edit_resources=["food_units", "shelter_capacity"],
            can_edit_zone_fields=["shelter_capacity", "shelter_occupancy", "food_demand"],
        )
    # Defensive default: read-only.
    return Permissions(role=role, role_label=label)


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=128)
    organization: str = Field(min_length=1, max_length=160)
    role: Role


class UserLogin(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class UserPublic(BaseModel):
    id: str
    full_name: str
    email: str
    organization: str
    role: Role


class UserOut(BaseModel):
    """Returned by register/login/me — public fields + token when authed."""

    user: UserPublic
    permissions: Permissions
    token: Optional[str] = None
    token_type: str = "bearer"
