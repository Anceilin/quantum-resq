"""End-to-end verification of Confirm Receipt and Distribute Food API & database workflows."""
from __future__ import annotations

import time
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.main import app
from app.services.db import get_database, get_collection

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_auth_override():
    prev = app.dependency_overrides.pop(get_current_user, None)
    yield
    if prev is not None:
        app.dependency_overrides[get_current_user] = prev


def _uniq() -> str:
    return str(int(time.time_ns()))


def _register(role: str):
    email = f"u_{_uniq()}@test.local"
    body = {
        "full_name": "Test Coordinator",
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


def test_confirm_receipt_and_distribute_food_e2e():
    # Verify MongoDB is connected
    db = get_database()
    print(f"MongoDB Active: {db is not None}")

    shl, _ = _register("shelter_coordinator")
    dmo, _ = _register("disaster_management_officer")

    # Create scenario
    sc = client.post("/api/scenarios", headers=_auth(dmo["token"]), json={"name": "E2E Button Test"}).json()
    sid = sc["id"]

    # 1. Create a test delivery for 25 kg of Rice
    deliv_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/deliveries/request",
        headers=_auth(shl["token"]),
        json={
            "food_item_name": "Rice",
            "category": "rice_grains",
            "quantity": 25,
            "unit": "kg",
            "reason": "E2E Test Delivery",
        }
    )
    assert deliv_res.status_code == 200, deliv_res.text
    deliv = deliv_res.json()
    deliv_id = deliv["id"]
    assert deliv["status"] == "Requested"
    assert deliv["quantity"] == 25

    # 2. Click Confirm Receipt (25 kg)
    rcv_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/deliveries/{deliv_id}/receive",
        headers=_auth(shl["token"]),
        json={"received_quantity": 25, "notes": "Confirmed receipt of 25kg Rice"}
    )
    assert rcv_res.status_code == 200, rcv_res.text
    updated_deliv = rcv_res.json()
    assert updated_deliv["status"] == "Received"

    # 3. Verify the delivery status and inventory balance in backend DB / Store
    ov = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    items = ov["food_items"]
    rice_item = next((i for i in items if i["name"] == "Rice"), None)
    assert rice_item is not None, "Rice item should exist in inventory"
    assert rice_item["quantity"] == 25.0, f"Rice quantity should be 25, got {rice_item['quantity']}"

    # 4. Try confirming the same delivery again and verify stock is NOT credited twice
    rcv_again = client.post(
        f"/api/scenarios/{sid}/shelter/food/deliveries/{deliv_id}/receive",
        headers=_auth(shl["token"]),
        json={"received_quantity": 25, "notes": "Duplicate receive test"}
    )
    assert rcv_again.status_code == 400
    assert "already" in rcv_again.json()["detail"].lower()

    ov_after_dup = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    rice_after_dup = next(i for i in ov_after_dup["food_items"] if i["name"] == "Rice")
    assert rice_after_dup["quantity"] == 25.0, "Duplicate confirm must NOT credit stock twice"

    # 5. Distribute Food Test: Select Rice item, Select Alpha shelter, Enter 10 kg
    dist_res = client.post(
        f"/api/scenarios/{sid}/shelter/food/distribute",
        headers=_auth(shl["token"]),
        json={
            "zone_id": "zone_alpha",
            "items": [{"food_item_id": rice_item["id"], "quantity": 10}],
            "notes": "Distributed 10kg Rice to Alpha shelter"
        }
    )
    assert dist_res.status_code == 200, dist_res.text
    dist_record = dist_res.json()
    assert dist_record["zone_id"] == "zone_alpha"

    # 6. Verify inventory decreases by exactly 10 kg and a distribution record is created
    ov_after_dist = client.get(f"/api/scenarios/{sid}/shelter/overview", headers=_auth(shl["token"])).json()
    rice_after_dist = next(i for i in ov_after_dist["food_items"] if i["name"] == "Rice")
    assert rice_after_dist["quantity"] == 15.0, f"Rice quantity should be 15, got {rice_after_dist['quantity']}"
    assert len(ov_after_dist["food_distributions"]) > 0

    print("ALL E2E BUTTON TESTS PASSED CLEANLY!")

