"""Authentication API: register, login, me.

Passwords are hashed with bcrypt (never stored in plaintext). Sessions use JWT
signed with a secret from the environment. Registration captures the five
official fields: Full Name, Email, Password, Organization/Agency, Role.

All data is SIMULATION / DEMO DATA.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import current_permissions, get_current_user
from app.models.user_models import (
    UserCreate,
    UserLogin,
    UserOut,
    UserPublic,
    permissions_for_role,
    Role,
)
from app.services.security import create_access_token, hash_password, verify_password
from app.services.user_store import user_store

router = APIRouter(prefix="/api/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _public(user: dict) -> UserPublic:
    return UserPublic(
        id=user["id"],
        full_name=user["full_name"],
        email=user["email"],
        organization=user["organization"],
        role=Role(user["role"]),
    )


def _issue(user: dict) -> UserOut:
    token = create_access_token(subject=user["id"], role=user["role"])
    return UserOut(
        user=_public(user),
        permissions=permissions_for_role(Role(user["role"])),
        token=token,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate) -> UserOut:
    email = payload.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")
    if user_store.get_by_email(email) is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    record = {
        "id": user_store.new_id(),
        "full_name": payload.full_name.strip(),
        "email": email,
        "organization": payload.organization.strip(),
        "role": payload.role.value,
        "password_hash": hash_password(payload.password),
    }
    user_store.create(record)
    return _issue(record)


@router.post("/login", response_model=UserOut)
def login(payload: UserLogin) -> UserOut:
    email = payload.email.strip().lower()
    user = user_store.get_by_email(email)
    # Same message for unknown email and wrong password (no user enumeration).
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _issue(user)


@router.get("/me", response_model=UserOut)
def me(user: dict = Depends(get_current_user)) -> UserOut:
    return UserOut(user=_public(user), permissions=current_permissions(user))
