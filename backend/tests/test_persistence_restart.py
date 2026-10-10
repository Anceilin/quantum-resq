"""Integration tests for disk & database persistence survival across backend restarts."""
from __future__ import annotations

import time
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.main import app
from app.services.medical_store import MedicalStore, medical_store
from app.services.scenario_store import ScenarioStore, scenario_store

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_auth_override():
    prev = app.dependency_overrides.pop(get_current_user, None)
    yield
    if prev is not None:
        app.dependency_overrides[get_current_user] = prev


def _auth_header(role: str = "medical_coordinator") -> dict:
    email = f"persist_{role}_{time.time_ns()}@test.local"
    body = {
        "full_name": "Persist User",
        "email": email,
        "password": "password123",
        "organization": "Testing Agency",
        "role": role,
    }
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_inventory_adjustment_persists_across_restart():
    headers = _auth_header("medical_coordinator")

    # 1. Reset baseline to 1000 kits
    client.post("/api/scenarios/scn_demo/medical/reset-baseline", headers=headers)

    # 2. Add 10 kits
    adj_res = client.post(
        "/api/scenarios/scn_demo/medical/inventory/adjust",
        headers=headers,
        json={"type": "addition", "quantity": 10, "reason": "Test addition +10"},
    )
    assert adj_res.status_code == 200
    assert adj_res.json()["resources"]["medical_kits"] == 1010

    # 3. Simulate backend restart by re-instantiating ScenarioStore & MedicalStore
    restarted_scenario_store = ScenarioStore()
    restarted_medical_store = MedicalStore()

    restarted_scenario = restarted_scenario_store.get("scn_demo")
    assert restarted_scenario is not None
    assert restarted_scenario.resources.medical_kits == 1010

    history = restarted_medical_store.get_history("scn_demo")
    assert len(history["audit_log"]) > 0
    found_audit = next((a for a in history["audit_log"] if a["reason"] == "Test addition +10"), None)
    assert found_audit is not None
    assert found_audit["stock_after"] == 1010


def test_zone_demand_update_persists_across_restart():
    headers = _auth_header("medical_coordinator")

    # 1. Update zone_alpha demand to 499 kits
    res = client.post(
        "/api/scenarios/scn_demo/medical/demand",
        headers=headers,
        json={"zone_id": "zone_alpha", "medical_demand": 499},
    )
    assert res.status_code == 200

    # 2. Simulate backend restart
    restarted_scenario_store = ScenarioStore()
    sc = restarted_scenario_store.get("scn_demo")
    assert sc is not None
    z_alpha = next(z for z in sc.zones if z.id == "zone_alpha")
    assert z_alpha.medical_demand == 499


def test_dispatch_lifecycle_persists_across_restart():
    headers = _auth_header("medical_coordinator")

    # Reset
    client.post("/api/scenarios/scn_demo/medical/reset-baseline", headers=headers)

    # Generate proposal & confirm dispatch
    client.post("/api/scenarios/scn_demo/medical/optimize", headers=headers)
    conf = client.post(
        "/api/scenarios/scn_demo/medical/dispatch/confirm",
        headers=headers,
        json={"note": "Restart survival dispatch"},
    )
    assert conf.status_code == 200
    disp_rec = conf.json()["dispatch_record"]
    disp_id = disp_rec["id"]
    stock_after = conf.json()["scenario"]["resources"]["medical_kits"]

    # Simulate restart
    restarted_medical_store = MedicalStore()
    restarted_scenario_store = ScenarioStore()

    sc = restarted_scenario_store.get("scn_demo")
    assert sc.resources.medical_kits == stock_after

    history = restarted_medical_store.get_history("scn_demo")
    records = history["dispatches"]
    found = next((r for r in records if r["id"] == disp_id), None)
    assert found is not None
    assert found["status"] == "Confirmed"

