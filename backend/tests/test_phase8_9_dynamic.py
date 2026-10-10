"""Phase 8/9 tests: dynamic re-optimization and analytics endpoints.

Verifies that road blockage, resource shortage and hospital capacity changes
actually flow into the optimization (not cosmetic), and that analytics is
derived from real solver output.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SMALL = {
    "zones_count": 3,
    "resources": ["ambulances", "rescue_teams"],
    "shots": 256,
    "maxiter": 20,
    "reps": 1,
}


def _fresh_scenario() -> str:
    r = client.post("/api/scenarios", json={})
    assert r.status_code == 201
    return r.json()["id"]


def test_scenario_update_partial_resources_merges():
    sid = _fresh_scenario()
    before = client.get(f"/api/scenarios/{sid}").json()["resources"]
    r = client.post(
        f"/api/scenarios/{sid}/update",
        json={"resources": {"ambulances": before["ambulances"] - 4}},
    )
    assert r.status_code == 200
    after = r.json()["resources"]
    assert after["ambulances"] == before["ambulances"] - 4
    # Untouched keys preserved.
    assert after["rescue_teams"] == before["rescue_teams"]


def test_scenario_update_rejects_unknown_resource():
    sid = _fresh_scenario()
    r = client.post(f"/api/scenarios/{sid}/update", json={"resources": {"unicorn": 3}})
    assert r.status_code == 400


def test_reoptimize_returns_diff_and_explanation():
    sid = _fresh_scenario()
    # Seed a 'before' comparison.
    client.post("/api/optimize/compare", json={"scenario_id": sid, **SMALL})
    r = client.post(f"/api/scenarios/{sid}/reoptimize", json=SMALL)
    assert r.status_code == 200
    body = r.json()
    assert body["scenario_id"] == sid
    assert "before" in body and "after" in body
    assert isinstance(body["changes"], list)
    assert isinstance(body["explanation"], list) and body["explanation"]
    assert body["compare"]["kind"] == "compare"


def test_resource_shortage_changes_allocation():
    sid = _fresh_scenario()
    base = client.get(f"/api/scenarios/{sid}").json()
    client.post("/api/optimize/compare", json={"scenario_id": sid, **SMALL})

    # Slash ambulances to zero -> ambulance allocations must disappear.
    client.post(f"/api/scenarios/{sid}/update", json={"resources": {"ambulances": 0}})
    r = client.post(f"/api/scenarios/{sid}/reoptimize", json=SMALL)
    body = r.json()
    after_resources = {a["resource"] for a in body["after"]["assignments"]}
    assert "ambulances" not in after_resources
    removed = [c for c in body["changes"] if c["type"] == "removed" and c["resource"] == "ambulances"]
    assert removed, "expected ambulance allocations to be removed under shortage"
    assert any("Ambulance availability changed" in e for e in body["explanation"])


def test_road_block_makes_zone_unreachable_in_reoptimize():
    sid = _fresh_scenario()
    scen = client.get(f"/api/scenarios/{sid}").json()
    client.post("/api/optimize/compare", json={"scenario_id": sid, **SMALL})

    # Block every road incident to the first zone to isolate it.
    target = scen["zones"][0]["id"]
    for road in scen["roads"]:
        if road["source"] == target or road["target"] == target:
            client.post(
                "/api/simulation/road-block",
                json={"scenario_id": sid, "road_id": road["id"], "blocked": True},
            )
    r = client.post(f"/api/scenarios/{sid}/reoptimize", json=SMALL)
    assert r.status_code == 200
    body = r.json()
    after_zones = {a["zone_id"] for a in body["after"]["assignments"]}
    assert target not in after_zones


def test_analytics_from_compare_result():
    sid = _fresh_scenario()
    rid = client.post("/api/optimize/compare", json={"scenario_id": sid, **SMALL}).json()["result_id"]
    r = client.get(f"/api/analytics/{rid}")
    assert r.status_code == 200
    body = r.json()
    assert body["scenario_id"] == sid
    assert isinstance(body["demand_vs_allocation"], list)
    assert isinstance(body["resource_utilization"], list)
    assert isinstance(body["priority_coverage"], list)
    metrics = {row["metric"] for row in body["classical_vs_qaoa"]}
    assert "Objective" in metrics
    assert body["shortage"]["target_coverage_pct"] == 90.0


def test_analytics_shortage_recommends_additional_units():
    sid = _fresh_scenario()
    # Remove all resources so nothing can be served -> shortage recommendations.
    client.post(
        f"/api/scenarios/{sid}/update",
        json={"resources": {"ambulances": 0, "rescue_teams": 0, "medical_kits": 0, "shelter_capacity": 0}},
    )
    rid = client.post("/api/optimize/compare", json={"scenario_id": sid, **SMALL}).json()["result_id"]
    body = client.get(f"/api/analytics/{rid}").json()
    shortage = body["shortage"]
    assert shortage["current_coverage_pct"] < shortage["target_coverage_pct"]
    assert shortage["recommendations"], "expected additional-resource recommendations under full shortage"
    for rec in shortage["recommendations"]:
        assert rec["additional_units"] > 0


def test_analytics_missing_result_404():
    assert client.get("/api/analytics/does_not_exist").status_code == 404
