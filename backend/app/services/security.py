"""Password hashing and JWT helpers.

Passwords are hashed with bcrypt (adaptive work factor) — plaintext passwords
are NEVER stored. JWT signing uses the secret from the environment; it is never
hard-coded in source.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from app.config import settings

_BCRYPT_MAX_INPUT_BYTES = 72


def _clamp_password(password: str) -> bytes:
    # bcrypt truncates at 72 bytes; encode explicitly so hashing and
    # verification behave identically.
    return password.encode("utf-8")[:_BCRYPT_MAX_INPUT_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_clamp_password(password), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_clamp_password(password), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, role: str, extra: Optional[dict] = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.resolved_jwt_secret(), algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(
            token,
            settings.resolved_jwt_secret(),
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None
