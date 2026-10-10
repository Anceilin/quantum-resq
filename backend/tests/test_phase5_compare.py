"""Phase 5 tests: classical vs QAOA comparison through the API."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SMALL = {"zones_count": 3, "resources": ["ambulances", "rescue_teams"], "shots": 256, "maxiter": 20, "reps": 1}


def test_classical_endpoint():
    r = client.post("/api/optimize/classical", json={"scenario_id": "scn_demo", **SMALL})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "classical"
    assert body["solution"]["feasible"] is True
    assert body["method"] == "brute_force"
    assert body["execution_time_ms"] >= 0


def test_qaoa_endpoint():
    r = client.post("/api/optimize/qaoa", json={"scenario_id": "scn_demo", **SMALL})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "qaoa"
    assert body["status"] == "success"
    assert body["num_qubits"] == 6
    assert sum(body["counts"].values()) == 256
    assert body["circuit_ascii"]
    assert "solution" in body


def test_compare_endpoint_and_honest_verdict():
    r = client.post("/api/optimize/compare", json={"scenario_id": "scn_demo", **SMALL})
    assert r.status_code == 200
    body = r.json()
    comp = body["comparison"]
    assert comp["winner"] in ("classical", "tie", "qaoa")
    assert "advantage" not in comp["verdict"].lower() or "no quantum advantage" in comp["note"].lower()
    c_obj = comp["classical"]["objective_value"]
    q_obj = comp["qaoa"]["objective_value"]
    # Classical is exact; QAOA (feasible) cannot exceed it.
    if comp["qaoa"]["feasible"]:
        assert q_obj <= c_obj + 1e-6
    assert comp["classical"]["qubit_count"] is None
    assert comp["qaoa"]["qubit_count"] == 6


def test_compare_stores_and_retrieves_result():
    r = client.post("/api/optimize/compare", json={"scenario_id": "scn_demo", **SMALL})
    rid = r.json()["result_id"]
    r2 = client.get(f"/api/results/{rid}")
    assert r2.status_code == 200
    assert r2.json()["kind"] == "compare"


def test_circuit_endpoint_from_compare():
    r = client.post("/api/optimize/compare", json={"scenario_id": "scn_demo", **SMALL})
    rid = r.json()["result_id"]
    rc = client.get(f"/api/quantum/circuit/{rid}")
    assert rc.status_code == 200
    body = rc.json()
    assert body["num_qubits"] == 6
    assert body["qubo"]["num_primary_vars"] == 6
    assert body["circuit_ascii"]


def test_unknown_scenario_404():
    r = client.post("/api/optimize/classical", json={"scenario_id": "nope"})
    assert r.status_code == 404


def test_bad_optimizer_400():
    r = client.post("/api/optimize/qaoa", json={"scenario_id": "scn_demo", "optimizer": "BOGUS"})
    assert r.status_code == 400


def test_bad_resource_400():
    r = client.post("/api/optimize/classical", json={"scenario_id": "scn_demo", "resources": ["unicorn"]})
    assert r.status_code == 400


def test_missing_result_404():
    assert client.get("/api/results/does_not_exist").status_code == 404
    assert client.get("/api/quantum/circuit/does_not_exist").status_code == 404


def test_resources_catalog():
    r = client.get("/api/resources")
    assert r.status_code == 200
    keys = {x["key"] for x in r.json()["resources"]}
    assert {"ambulances", "rescue_teams", "medical_kits", "food_units", "shelter_capacity"} <= keys
