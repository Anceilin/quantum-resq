"""Phase 10 end-to-end test (spec section 29).

Full flow: create scenario -> classical -> QAOA -> compare -> block road ->
re-optimize -> changed allocation -> explanation -> analytics. Every assertion
checks real solver output; nothing is hard-coded.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CFG = {
    "zones_count": 4,
    "resources": ["ambulances", "rescue_teams", "medical_kits"],
    "shots": 512,
    "maxiter": 30,
    "reps": 1,
}


def test_full_end_to_end_flow():
    # 1. Create scenario.
    sid = client.post("/api/scenarios", json={}).json()["id"]

    # 2. Classical optimization.
    r = client.post("/api/optimize/classical", json={"scenario_id": sid, **CFG})
    assert r.status_code == 200
    classical = r.json()
    assert classical["solution"]["feasible"] is True

    # 3. QAOA executes on a real simulator.
    r = client.post("/api/optimize/qaoa", json={"scenario_id": sid, **CFG})
    assert r.status_code == 200
    qaoa = r.json()
    assert qaoa["status"] == "success"
    assert sum(qaoa["counts"].values()) == CFG["shots"]
    assert qaoa["num_qubits"] == CFG["zones_count"] * len(CFG["resources"])

    # 4. Compare.
    r = client.post("/api/optimize/compare", json={"scenario_id": sid, **CFG})
    assert r.status_code == 200
    compare = r.json()
    assert compare["comparison"]["winner"] in ("classical", "tie", "qaoa")
    before_assignments = compare["classical"]["solution"]["assignments"]

    # 5. Block EVERY road incident to the top-priority zone to isolate it.
    scen = client.get(f"/api/scenarios/{sid}").json()
    top = max(scen["zones"], key=lambda z: z["priority_score"])
    for road in scen["roads"]:
        if road["target"] == top["id"] or road["source"] == top["id"]:
            rb = client.post(
                "/api/simulation/road-block",
                json={"scenario_id": sid, "road_id": road["id"], "blocked": True},
            )
            assert rb.status_code == 200

    # 6. Re-optimize.
    r = client.post(f"/api/scenarios/{sid}/reoptimize", json=CFG)
    assert r.status_code == 200
    reopt = r.json()

    # 7. Allocation actually changed and the isolated zone is no longer served.
    after_zones = {a["zone_id"] for a in reopt["after"]["assignments"]}
    assert top["id"] not in after_zones
    before_zones = {a["zone_id"] for a in before_assignments}
    assert before_zones != after_zones or reopt["changes"], "expected a detectable allocation change"

    # 8. Explanation is generated from real data.
    assert reopt["explanation"], "expected a non-empty dynamic explanation"
    assert any("blocked" in e.lower() or "unreachable" in e.lower() or "accessibility" in e.lower()
               for e in reopt["explanation"])

    # 9. Analytics for the fresh comparison.
    rid = reopt["compare"]["result_id"]
    r = client.get(f"/api/analytics/{rid}")
    assert r.status_code == 200
    analytics = r.json()
    assert analytics["scenario_id"] == sid
    assert analytics["demand_vs_allocation"]
    assert analytics["classical_vs_qaoa"]
    assert analytics["shortage"]["target_coverage_pct"] == 90.0


def test_hospital_capacity_reduction_blocks_medical_allocation():
    """Hospital capacity must actually constrain the optimization (spec section 18)."""
    sid = client.post("/api/scenarios", json={}).json()["id"]
    scen = client.get(f"/api/scenarios/{sid}").json()

    # Zero out hospital capacity everywhere -> medical resources cannot be placed.
    zone_updates = [
        {"id": z["id"], "hospital_capacity": z["hospital_occupancy"]} for z in scen["zones"]
    ]
    r = client.post(f"/api/scenarios/{sid}/update", json={"zone_updates": zone_updates})
    assert r.status_code == 200

    r = client.post(
        "/api/optimize/classical",
        json={"scenario_id": sid, "zones_count": 4, "resources": ["ambulances", "medical_kits"]},
    )
    assignments = r.json()["solution"]["assignments"]
    assert assignments == [], "no medical resource should be allocatable without hospital capacity"
