"""Automated pytest suite for Medical Operations, RBAC, Inventory, Dispatches, and QAOA reporting."""
from __future__ import annotations

import time
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_auth_override():
    """Remove conftest dependency override so real auth & RBAC are enforced."""
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


def test_medical_coordinator_permissions():
    data, _ = _register("medical_coordinator")
    assert data["permissions"]["can_edit_resources"] == ["medical_kits"]
    assert "medical_demand" in data["permissions"]["can_edit_zone_fields"]
    assert data["permissions"]["can_manage_scenarios"] is False


def test_medical_demand_editing():
    med, _ = _register("medical_coordinator")
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "MedDemand"}).json()
    sid = sc["id"]
    zid = sc["zones"][0]["id"]

    # Medical coordinator can update medical_demand
    ok = client.post(
        f"/api/scenarios/{sid}/medical/demand",
        headers=_auth(med["token"]),
        json={"zone_id": zid, "medical_demand": 450},
    )
    assert ok.status_code == 200
    updated_z = next(z for z in ok.json()["zones"] if z["id"] == zid)
    assert updated_z["medical_demand"] == 450

    # Shelter coordinator CANNOT update medical_demand
    no = client.post(
        f"/api/scenarios/{sid}/medical/demand",
        headers=_auth(shl["token"]),
        json={"zone_id": zid, "medical_demand": 600},
    )
    assert no.status_code == 403


def test_medical_inventory_adjustment_and_audit():
    med, _ = _register("medical_coordinator")
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "InvAdj"}).json()
    sid = sc["id"]

    # Medical coordinator can add stock
    ok_add = client.post(
        f"/api/scenarios/{sid}/medical/inventory/adjust",
        headers=_auth(med["token"]),
        json={"type": "addition", "quantity": 250, "reason": "Emergency shipment arrival"},
    )
    assert ok_add.status_code == 200
    assert ok_add.json()["resources"]["medical_kits"] == 850  # 600 base + 250

    # Medical coordinator can correct stock
    ok_corr = client.post(
        f"/api/scenarios/{sid}/medical/inventory/adjust",
        headers=_auth(med["token"]),
        json={"type": "correction", "quantity": 1000, "reason": "Inventory audit recount"},
    )
    assert ok_corr.status_code == 200
    assert ok_corr.json()["resources"]["medical_kits"] == 1000

    # Negative correction rejected
    bad = client.post(
        f"/api/scenarios/{sid}/medical/inventory/adjust",
        headers=_auth(med["token"]),
        json={"type": "correction", "quantity": -50, "reason": "Invalid"},
    )
    assert bad.status_code == 400

    # Shelter coordinator CANNOT adjust medical inventory
    no = client.post(
        f"/api/scenarios/{sid}/medical/inventory/adjust",
        headers=_auth(shl["token"]),
        json={"type": "addition", "quantity": 100, "reason": "Unauthorized"},
    )
    assert no.status_code == 403


def test_medical_optimization_proposal():
    med, _ = _register("medical_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "OptProp"}).json()
    sid = sc["id"]

    # Reset to standard baseline: 1,000 kits, 915 demand across 6 zones
    client.post(f"/api/scenarios/{sid}/medical/reset-baseline", headers=_auth(med["token"]))

    res = client.post(f"/api/scenarios/{sid}/medical/optimize", headers=_auth(med["token"]))
    assert res.status_code == 200
    prop = res.json()
    assert prop["scenario_id"] == sid
    assert prop["total_proposed_dispatch"] == 915
    assert prop["projected_unmet_demand"] == 0
    assert prop["projected_remaining_stock"] == 85
    assert len(prop["dispatches"]) == 6

    # Insufficient stock test: 500 available kits for 915 demand
    client.post(
        f"/api/scenarios/{sid}/medical/inventory/adjust",
        headers=_auth(med["token"]),
        json={"type": "correction", "quantity": 500, "reason": "Insufficient stock test"},
    )
    res500 = client.post(f"/api/scenarios/{sid}/medical/optimize", headers=_auth(med["token"]))
    assert res500.status_code == 200
    prop500 = res500.json()
    assert prop500["total_proposed_dispatch"] == 500
    assert prop500["projected_unmet_demand"] == 415
    assert prop500["projected_remaining_stock"] == 0


def test_medical_dispatch_lifecycle_and_single_restoration():
    med, _ = _register("medical_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "LifeCycle"}).json()
    sid = sc["id"]

    # 1. Reset to standard 1000 baseline
    reset_res = client.post(f"/api/scenarios/{sid}/medical/reset-baseline", headers=_auth(med["token"]))
    assert reset_res.status_code == 200
    assert reset_res.json()["resources"]["medical_kits"] == 1000

    # 2. Generate proposal
    prop = client.post(f"/api/scenarios/{sid}/medical/optimize", headers=_auth(med["token"])).json()
    proposed_units = prop["total_proposed_dispatch"]

    # 3. Confirm dispatch
    conf_res = client.post(
        f"/api/scenarios/{sid}/medical/dispatch/confirm",
        headers=_auth(med["token"]),
        json={"note": "Batch dispatch #1"},
    )
    assert conf_res.status_code == 200
    disp_rec = conf_res.json()["dispatch_record"]
    assert disp_rec["status"] == "Confirmed"
    disp_id = disp_rec["id"]

    # Verify stock deducted
    stock_after = conf_res.json()["scenario"]["resources"]["medical_kits"]
    assert stock_after == 1000 - proposed_units

    # 4. Cancel dispatch -> restores stock & zone demands
    cancel_res = client.post(
        f"/api/scenarios/{sid}/medical/dispatch/{disp_id}/cancel",
        headers=_auth(med["token"]),
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["dispatch_record"]["status"] == "Cancelled"
    restored_stock = cancel_res.json()["scenario"]["resources"]["medical_kits"]
    assert restored_stock == 1000

    # 5. Duplicate cancellation MUST BE REJECTED (ensures single-restoration safety!)
    dup_cancel = client.post(
        f"/api/scenarios/{sid}/medical/dispatch/{disp_id}/cancel",
        headers=_auth(med["token"]),
    )
    assert dup_cancel.status_code == 400
    assert "already cancelled" in dup_cancel.json()["detail"]


def test_medical_dispatch_completion():
    med, _ = _register("medical_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "Comp"}).json()
    sid = sc["id"]

    client.post(f"/api/scenarios/{sid}/medical/reset-baseline", headers=_auth(med["token"]))
    client.post(f"/api/scenarios/{sid}/medical/optimize", headers=_auth(med["token"]))
    conf_res = client.post(f"/api/scenarios/{sid}/medical/dispatch/confirm", headers=_auth(med["token"]))
    assert conf_res.status_code == 200, conf_res.text
    conf = conf_res.json()
    disp_id = conf["dispatch_record"]["id"]

    comp = client.post(
        f"/api/scenarios/{sid}/medical/dispatch/{disp_id}/complete",
        headers=_auth(med["token"]),
    )
    assert comp.status_code == 200
    assert comp.json()["dispatch_record"]["status"] == "Delivered"

    # Delivered dispatches cannot be cancelled directly
    no_cancel = client.post(
        f"/api/scenarios/{sid}/medical/dispatch/{disp_id}/cancel",
        headers=_auth(med["token"]),
    )
    assert no_cancel.status_code == 400


def test_qaoa_failure_handling_and_reporting():
    dmo, _ = _register("disaster_management_officer")
    p = {
        "scenario_id": "scn_demo",
        "zones_count": 6,
        "resources": ["ambulances", "rescue_teams", "medical_kits", "food_units", "shelter_capacity", "emergency_vehicles"],
        "reps": 1,
        "shots": 100,
        "optimizer": "COBYLA",
    }
    r = client.post("/api/optimize/qaoa", headers=_auth(dmo["token"]), json=p)
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert data["kind"] == "qaoa"
