"""Shared pytest setup.

Operational routes now require authentication. Existing functional tests target
the optimisation/simulation behaviour, not auth, so we override the
`get_current_user` dependency with a full-access Disaster Management Officer.
Auth and RBAC are tested explicitly in test_auth_rbac.py (which clears the
override to exercise the real 401/403 paths).

Tests are pointed at a throwaway MongoDB database so they never pollute the
developer's `quantumresq` database. If Mongo is unreachable the stores fall back
to in-memory automatically.
"""
from __future__ import annotations

import os

# Must be set BEFORE the app/config imports happen.
os.environ["MONGO_DB_NAME"] = "quantumresq_test"

from app.api.dependencies import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user_models import Role  # noqa: E402

_DMO_USER = {
    "id": "test_dmo",
    "full_name": "Test Officer",
    "email": "officer@test.local",
    "organization": "Test Agency",
    "role": Role.disaster_management_officer.value,
    "password_hash": "",
}

app.dependency_overrides[get_current_user] = lambda: _DMO_USER


def pytest_sessionstart(session):  # noqa: ARG001
    """Start each test run from an empty test database."""
    try:
        from app.services.db import get_database

        db = get_database()
        if db is not None:
            db.client.drop_database(db.name)
    except Exception:
        pass
