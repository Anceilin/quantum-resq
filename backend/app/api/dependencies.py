"""FastAPI auth + RBAC dependencies.

get_current_user protects every operational route. The RBAC helpers enforce, on
the server, exactly which scenario fields/actions a role may edit — the frontend
mirrors the same rules from GET /api/auth/me, but the backend is authoritative.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.models.user_models import Permissions, Role, permissions_for_role
from app.services.security import decode_access_token
from app.services.user_store import user_store

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """Return the authenticated user record or raise 401."""
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(creds.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = user_store.get_by_id(payload["sub"])
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def current_permissions(user: dict) -> Permissions:
    return permissions_for_role(Role(user["role"]))


def _denied(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def require_scenario_management(user: dict) -> None:
    """Guard create/edit/load/delete of whole scenarios (DMO only)."""
    if not current_permissions(user).can_manage_scenarios:
        _denied("Only a Disaster Management Officer may manage scenarios")


def require_resource_edit(user: dict, keys: List[str]) -> None:
    allowed = set(current_permissions(user).can_edit_resources)
    bad = [k for k in keys if k not in allowed]
    if bad:
        _denied(f"Role '{user['role']}' may not edit these resources: {bad}")


def require_zone_field_edit(user: dict, fields: List[str]) -> None:
    allowed = set(current_permissions(user).can_edit_zone_fields)
    bad = [f for f in fields if f not in allowed]
    if bad:
        _denied(f"Role '{user['role']}' may not edit these zone fields: {bad}")


def require_road_block(user: dict) -> None:
    if not current_permissions(user).can_block_roads:
        _denied(f"Role '{user['role']}' may not block or open roads")
