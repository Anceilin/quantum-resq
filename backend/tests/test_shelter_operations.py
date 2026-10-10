"""Automated pytest suite for Shelter Operations, Intake, Bed Capacity, Food Inventory, Distributions, and Optimization."""
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


def test_shelter_coordinator_permissions():
    shl, _ = _register("shelter_coordinator")
    assert "food_units" in shl["permissions"]["can_edit_resources"]
    assert "shelter_capacity" in shl["permissions"]["can_edit_resources"]
    assert "shelter_occupancy" in shl["permissions"]["can_edit_zone_fields"]
    assert "shelter_capacity" in shl["permissions"]["can_edit_zone_fields"]


def test_intake_test_a_and_test_b():
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "IntakeTest"}).json()
    sid = sc["id"]

    # Test A: Foxtrot initially has 300 beds, 90 occupied, 210 free.
    # Record intake of 10 people at zone_foxtrot.
    res_intake = client.post(
        f"/api/scenarios/{sid}/shelter/intake",
        headers=_auth(shl["token"]),
        json={"zone_id": "zone_foxtrot", "count": 10, "notes": "Test A intake"},
    )
    assert res_intake.status_code == 200, res_intake.text
    sc_updated = client.get(f"/api/scenarios/{sid}", headers=_auth(shl["token"])).json()
    foxtrot = next(z for z in sc_updated["zones"] if z["id"] == "zone_foxtrot")
    assert foxtrot["shelter_occupancy"] == 100
    assert foxtrot["shelter_capacity"] - foxtrot["shelter_occupancy"] == 200

    # Verify overview calculations: Total occupied across all zones = 2,270; Total free beds = 1,630
    ov = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    assert ov["total_occupancy"] == 2270
    assert ov["total_free_beds"] == 1630

    # Test B: Over-capacity intake rejected (attempt 201 when only 200 free)
    rej = client.post(
        f"/api/scenarios/{sid}/shelter/intake",
        headers=_auth(shl["token"]),
        json={"zone_id": "zone_foxtrot", "count": 201, "notes": "Over capacity test"},
    )
    assert rej.status_code == 400
    assert "exceeds free beds" in rej.json()["detail"]


def test_bed_capacity_test_c_and_test_d():
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "BedTest"}).json()
    sid = sc["id"]

    # Test C: Request 50 additional beds. Usable capacity must remain 300 while pending.
    req_res = client.post(
        f"/api/scenarios/{sid}/shelter/beds/request",
        headers=_auth(shl["token"]),
        json={"zone_id": "zone_foxtrot", "quantity": 50, "reason": "Overflow expected", "bed_type": "cots"},
    )
    assert req_res.status_code == 200, req_res.text
    bed_req = req_res.json()
    assert bed_req["status"] == "Requested"
    req_id = bed_req["id"]

    ov1 = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    foxtrot1 = next(z for z in ov1["zones"] if z["zone_id"] == "zone_foxtrot")
    assert foxtrot1["capacity"] == 300

    # Test D: Confirm deployment of 50 beds. Usable capacity increases to 350.
    deploy_res = client.post(
        f"/api/scenarios/{sid}/shelter/beds/{req_id}/status",
        headers=_auth(shl["token"]),
        json={"status": "Deployed", "deployed_quantity": 50, "notes": "Cots delivered"},
    )
    assert deploy_res.status_code == 200, deploy_res.text

    ov2 = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    foxtrot2 = next(z for z in ov2["zones"] if z["zone_id"] == "zone_foxtrot")
    assert foxtrot2["capacity"] == 350


def test_food_request_and_receipt_test_e_and_test_f():
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "FoodDeliveryTest"}).json()
    sid = sc["id"]

    # Test E: Request 100 kg rice. Available stock unchanged while pending.
    deliv_req = client.post(
        f"/api/scenarios/{sid}/shelter/food/deliveries/request",
        headers=_auth(shl["token"]),
        json={
            "food_item_name": "Rice",
            "category": "rice_grains",
            "quantity": 100,
            "unit": "kg",
            "reason": "Emergency ration supply",
        },
    )
    assert deliv_req.status_code == 200, deliv_req.text
    deliv = deliv_req.json()
    assert deliv["status"] == "Requested"
    deliv_id = deliv["id"]

    # Test F: Receive 100 kg rice. Stock increases by 100.
    rcv_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/deliveries/{deliv_id}/receive",
        headers=_auth(shl["token"]),
        json={"received_quantity": 100, "notes": "Received batch 1"},
    )
    assert rcv_res.status_code == 200, rcv_res.text
    assert rcv_res.json()["status"] == "Received"

    items = client.get(f"/api/scenarios/{sid}/shelter/food/items", headers=_auth(shl["token"])).json()
    rice = next(i for i in items if i["name"] == "Rice")
    assert rice["quantity"] == 100


def test_food_distribution_test_g():
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "FoodDistTest"}).json()
    sid = sc["id"]

    # Add 200 kg food item
    item_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/items",
        headers=_auth(shl["token"]),
        json={"name": "Grains", "category": "rice_grains", "quantity": 200, "unit": "kg"},
    ).json()
    item_id = item_res["id"]

    # Distribute 50 kg to Alpha
    dist_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/distribute",
        headers=_auth(shl["token"]),
        json={"zone_id": "zone_alpha", "items": [{"food_item_id": item_id, "quantity": 50}]},
    )
    assert dist_res.status_code == 200, dist_res.text

    # Verify stock reduced to 150 kg
    items = client.get(f"/api/scenarios/{sid}/shelter/food/items", headers=_auth(shl["token"])).json()
    grains = next(i for i in items if i["id"] == item_id)
    assert grains["quantity"] == 150

    # Over-stock distribution rejected
    bad_dist = client.post(
        f"/api/scenarios/{sid}/shelter/food/distribute",
        headers=_auth(shl["token"]),
        json={"zone_id": "zone_alpha", "items": [{"food_item_id": item_id, "quantity": 999}]},
    )
    assert bad_dist.status_code == 400


def test_optimization_test_i_and_test_j():
    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "ShelterOptTest"}).json()
    sid = sc["id"]

    # Run optimizer (Test I)
    opt_res = client.post(f"/api/scenarios/{sid}/shelter/optimize", headers=_auth(shl["token"]))
    assert opt_res.status_code == 200, opt_res.text
    prop = opt_res.json()
    assert prop["scenario_id"] == sid
    assert len(prop["food_allocations"]) == len(sc["zones"])

    # Apply optimization (Test J)
    apply_res = client.post(
        f"/api/scenarios/{sid}/shelter/optimize/apply",
        headers=_auth(shl["token"]),
        json={"proposal_id": prop["id"]},
    )
    assert apply_res.status_code == 200, apply_res.text
