"""Historical Records — read-only archive + load-as-scenario.

These assert the ADDITIONAL feature works and, crucially, that the archive is
never fabricated by the optimizer: `load` produces a real editable scenario the
existing classical/QAOA pipeline can solve unchanged.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.main import app

client = TestClient(app)


def test_list_returns_fixed_records():
    r = client.get("/api/historical")
    assert r.status_code == 200
    recs = r.json()
    assert len(recs) >= 4
    ids = {x["id"] for x in recs}
    assert {"hr_cyclone_amphan", "hr_earthquake_kutch", "hr_wildfire_similipal", "hr_accident_nh48"} <= ids
    for x in recs:
        assert x["status"] in ("completed", "historical")
        assert x["num_zones"] > 0
        assert x["affected_people"] > 0
        # resources_allocated is derived from the archive's recorded allocation, not a solver
        assert x["resources_allocated"] > 0


def test_get_detail_exposes_original_conditions_and_recorded_allocation():
    r = client.get("/api/historical/hr_cyclone_amphan")
    assert r.status_code == 200
    d = r.json()
    assert d["scenario"]["id"]  # embedded full scenario for load-as-copy
    assert len(d["scenario"]["zones"]) > 0
    assert len(d["recorded_allocation"]) > 0
    for a in d["recorded_allocation"]:
        assert a["resource"] and a["zone_id"] and a["units"] >= 0


def test_get_missing_is_404():
    assert client.get("/api/historical/hr_does_not_exist").status_code == 404


def test_load_makes_new_editable_scenario_and_runs_real_pipeline():
    r = client.post("/api/historical/hr_earthquake_kutch/load")
    assert r.status_code == 201
    scn = r.json()
    assert scn["id"].startswith("scn_")
    assert scn["is_demo"] is False
    assert "historical" in scn["name"].lower()
    assert len(scn["zones"]) > 0

    # The EXISTING optimizer runs on the loaded copy — real output, no fabrication.
    c = client.post(
        "/api/optimize/classical",
        json={"scenario_id": scn["id"], "zones_count": 3,
              "resources": ["ambulances", "rescue_teams"], "seed": 7},
    )
    assert c.status_code == 200
    body = c.json()
    assert body["kind"] == "classical"
    assert body["solution"]["feasible"] is True
    assert "objective_value" in body["solution"]
    assert len(body["solution"]["assignments"]) > 0


def test_load_requires_scenario_management():
    prev = app.dependency_overrides.pop(get_current_user, None)
    try:
        assert client.post("/api/historical/hr_accident_nh48/load").status_code == 401
    finally:
        if prev is not None:
            app.dependency_overrides[get_current_user] = prev
