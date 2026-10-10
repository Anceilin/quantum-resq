"""Phase 1 tests: API startup, scenarios, presets, road blocking."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["simulation"] is True
    assert "SIMULATION" in body["notice"]


def test_list_scenarios_includes_demo():
    r = client.get("/api/scenarios")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert "scn_demo" in ids


def test_get_demo_scenario():
    r = client.get("/api/scenarios/scn_demo")
    assert r.status_code == 200
    scn = r.json()
    assert len(scn["zones"]) == 6
    assert scn["resources"]["ambulances"] > 0
    # Priority scores are populated and within range.
    for z in scn["zones"]:
        assert 0.0 <= z["priority_score"] <= 100.0


def test_get_missing_scenario_404():
    r = client.get("/api/scenarios/does_not_exist")
    assert r.status_code == 404


def test_create_custom_scenario():
    r = client.post("/api/scenarios", json={"name": "Custom Test", "budget": 30000})
    assert r.status_code == 201
    scn = r.json()
    assert scn["name"] == "Custom Test"
    assert scn["budget"] == 30000
    # Fetchable afterwards.
    r2 = client.get(f"/api/scenarios/{scn['id']}")
    assert r2.status_code == 200


def test_preset_resource_shortage_reduces_resources():
    base = client.get("/api/scenarios/scn_demo").json()
    r = client.post("/api/scenarios/preset/resource_shortage")
    assert r.status_code == 201
    scn = r.json()
    assert scn["resources"]["ambulances"] == int(base["resources"]["ambulances"] * 0.7)


def test_preset_road_block_changes_accessibility():
    r = client.post("/api/scenarios/preset/major_road_block")
    assert r.status_code == 201
    scn = r.json()
    blocked = [road for road in scn["roads"] if road["blocked"]]
    assert len(blocked) >= 1
    # At least one zone lost full accessibility.
    assert any(z["road_accessibility"] < 1.0 for z in scn["zones"])


def test_preset_unknown_400():
    r = client.post("/api/scenarios/preset/not_a_preset")
    assert r.status_code == 400


def test_road_block_toggle_endpoint():
    scn = client.get("/api/scenarios/scn_demo").json()
    road = next(rd for rd in scn["roads"] if rd["is_primary"])
    r = client.post(
        "/api/simulation/road-block",
        json={"scenario_id": "scn_demo", "road_id": road["id"], "blocked": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["blocked"] is True
    assert road["target"] in body["changed_zones"] or road["target"] in body["unreachable_zones"]

    # Restore so other tests see a clean demo scenario.
    client.post(
        "/api/simulation/road-block",
        json={"scenario_id": "scn_demo", "road_id": road["id"], "blocked": False},
    )


def test_road_block_unknown_road_404():
    r = client.post(
        "/api/simulation/road-block",
        json={"scenario_id": "scn_demo", "road_id": "nope", "blocked": True},
    )
    assert r.status_code == 404
