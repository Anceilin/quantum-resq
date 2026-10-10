"""Auth + RBAC tests. These exercise the REAL dependency (override cleared)."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_auth_override():
    """Remove the conftest override so real tokens/roles are enforced."""
    prev = app.dependency_overrides.pop(get_current_user, None)
    yield
    if prev is not None:
        app.dependency_overrides[get_current_user] = prev


def _uniq() -> str:
    return str(int(time.time_ns()))


def _register(role: str):
    email = f"u_{_uniq()}@test.local"
    body = {
        "full_name": "Test User",
        "email": email,
        "password": "secret123",
        "organization": "Test Agency",
        "role": role,
    }
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r.json(), email


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_operational_route_requires_auth():
    assert client.get("/api/scenarios").status_code == 401
    assert client.get("/api/scenarios/scn_demo").status_code == 401


def test_register_returns_token_and_permissions():
    data, _ = _register("medical_coordinator")
    assert data["token"]
    assert data["user"]["role"] == "medical_coordinator"
    assert data["permissions"]["can_edit_resources"] == ["medical_kits"]
    assert data["permissions"]["can_edit_zone_fields"] == [
        "hospital_capacity",
        "hospital_occupancy",
        "medical_demand",
    ]
    assert data["permissions"]["can_manage_scenarios"] is False


def test_duplicate_email_rejected():
    _, email = _register("resource_coordinator")
    dup = client.post("/api/auth/register", json={
        "full_name": "Dup", "email": email, "password": "secret123",
        "organization": "X", "role": "resource_coordinator",
    })
    assert dup.status_code == 409


def test_login_and_wrong_password():
    _, email = _register("shelter_coordinator")
    ok = client.post("/api/auth/login", json={"email": email, "password": "secret123"})
    assert ok.status_code == 200 and ok.json()["token"]
    bad = client.post("/api/auth/login", json={"email": email, "password": "WRONG"})
    assert bad.status_code == 401


def test_me_endpoint():
    data, _ = _register("disaster_management_officer")
    me = client.get("/api/auth/me", headers=_auth(data["token"]))
    assert me.status_code == 200
    assert me.json()["user"]["full_name"] == "Test User"
    assert me.json()["permissions"]["can_manage_scenarios"] is True


def test_coordinator_cannot_create_scenario():
    data, _ = _register("medical_coordinator")
    r = client.post("/api/scenarios", headers=_auth(data["token"]), json={"name": "X"})
    assert r.status_code == 403


def test_dmo_can_create_and_officer_field_gates():
    dmo, _ = _register("disaster_management_officer")
    med, _ = _register("medical_coordinator")
    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "Gate"})
    assert sc.status_code == 201
    sid = sc.json()["id"]
    zid = sc.json()["zones"][0]["id"]
    # medical may edit hospital capacity
    ok = client.post(
        f"/api/scenarios/{sid}/update", headers=_auth(med["token"]),
        json={"zone_updates": [{"id": zid, "hospital_capacity": 5}]},
    )
    assert ok.status_code == 200
    # medical may NOT edit shelter capacity
    no = client.post(
        f"/api/scenarios/{sid}/update", headers=_auth(med["token"]),
        json={"zone_updates": [{"id": zid, "shelter_capacity": 5}]},
    )
    assert no.status_code == 403


def test_resource_coordinator_edits_only_resources():
    dmo, _ = _register("disaster_management_officer")
    res, _ = _register("resource_coordinator")
    sid = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "R"}).json()["id"]
    ok = client.post(f"/api/scenarios/{sid}/update", headers=_auth(res["token"]),
                     json={"resources": {"ambulances": 3}})
    assert ok.status_code == 200
    no = client.post(f"/api/scenarios/{sid}/update", headers=_auth(res["token"]),
                     json={"budget": 12345})
    assert no.status_code == 403


def test_road_block_permission():
    dmo, _ = _register("disaster_management_officer")
    resc, _ = _register("rescue_coordinator")
    med, _ = _register("medical_coordinator")
    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "Road"}).json()
    road = sc["roads"][0]["id"]
    # rescue coordinator may block roads
    assert client.post("/api/simulation/road-block", headers=_auth(resc["token"]),
                       json={"scenario_id": sc["id"], "road_id": road, "blocked": True}).status_code == 200
    # medical coordinator may not
    assert client.post("/api/simulation/road-block", headers=_auth(med["token"]),
                       json={"scenario_id": sc["id"], "road_id": road, "blocked": False}).status_code == 403


def test_invalid_token_rejected():
    assert client.get("/api/auth/me", headers=_auth("not.a.token")).status_code == 401
