"""Scenario and optimisation-result stores.

Backed by MongoDB so created scenarios (and their results) survive a backend
restart. An in-memory cache mirrors Mongo for fast reads and keeps the public
interface identical to the original prototype — so optimisation_service.py and
the API routes are unchanged.

Fallback: when Mongo is unreachable (or no URI is set) the stores behave exactly
like the original in-memory version, so the local simulator and the test suite
run with zero external dependencies.
"""
from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from app.models.schemas import Scenario
from app.services.db import get_collection
from app.services.file_store import JsonFileCollection
from app.simulation.disaster_generator import build_base_scenario
from app.simulation.road_simulator import recompute_accessibility


class ScenarioStore:
    def __init__(self) -> None:
        self._scenarios: Dict[str, Scenario] = {}
        self._file_col = JsonFileCollection("scenarios")
        self._lock = threading.Lock()
        self._bootstrap()

    # ---- persistence helpers ----
    @property
    def _col(self):
        return get_collection("scenarios")

    def _persist(self, scenario: Scenario) -> None:
        col = self._col
        doc = scenario.model_dump(mode="json")
        if col is not None:
            col.update_one({"id": scenario.id}, {"$set": doc}, upsert=True)
        self._file_col.upsert({"id": scenario.id}, doc)

    def _remove(self, scenario_id: str) -> None:
        col = self._col
        if col is not None:
            col.delete_one({"id": scenario_id})
        self._file_col.delete_one({"id": scenario_id})

    def _bootstrap(self) -> None:
        col = self._col
        docs = list(col.find({})) if col is not None else self._file_col.find_all()
        for doc in docs:
            doc.pop("_id", None)
            try:
                scenario = Scenario.model_validate(doc)
                self._scenarios[scenario.id] = scenario
            except Exception:
                continue
        # Always guarantee a demo scenario exists (seeded once, then persisted).
        if "scn_demo" not in self._scenarios:
            demo = build_base_scenario()
            demo.id = "scn_demo"
            demo.name = "Regional Flood Response — Demo"
            demo.resources.medical_kits = 1000
            demo.resources.food_units = 3500
            for z in demo.zones:
                if z.id == "zone_alpha":
                    z.shelter_occupancy = 1030
                    z.shelter_capacity = 1200
                z.food_demand = z.shelter_occupancy * 3
            recompute_accessibility(demo)
            self._scenarios[demo.id] = demo
            self._persist(demo)
        else:
            demo = self._scenarios["scn_demo"]
            alpha = next((z for z in demo.zones if z.id == "zone_alpha"), None)
            if alpha and alpha.shelter_occupancy < 1030:
                alpha.shelter_occupancy = 1030
            for z in demo.zones:
                z.food_demand = z.shelter_occupancy * 3
            demo.resources.food_units = 3500
            self._persist(demo)

    # ---- public interface (unchanged) ----
    def create(self, scenario: Scenario) -> Scenario:
        recompute_accessibility(scenario)
        with self._lock:
            self._scenarios[scenario.id] = scenario
        self._persist(scenario)
        return scenario

    def get(self, scenario_id: str) -> Optional[Scenario]:
        with self._lock:
            if scenario_id in self._scenarios:
                return self._scenarios[scenario_id]

        col = self._col
        if col is not None:
            doc = col.find_one({"id": scenario_id})
            if doc:
                doc.pop("_id", None)
                try:
                    scenario = Scenario.model_validate(doc)
                    with self._lock:
                        self._scenarios[scenario.id] = scenario
                    return scenario
                except Exception:
                    pass

        if scenario_id == "scn_demo":
            return self.reset_demo()

        return None

    def update(self, scenario: Scenario) -> Scenario:
        recompute_accessibility(scenario)
        with self._lock:
            self._scenarios[scenario.id] = scenario
        self._persist(scenario)
        return scenario

    def list(self) -> List[Scenario]:
        return list(self._scenarios.values())

    def delete(self, scenario_id: str) -> bool:
        with self._lock:
            existed = self._scenarios.pop(scenario_id, None) is not None
        if existed:
            self._remove(scenario_id)
        return existed

    def reset_demo(self) -> Scenario:
        demo = build_base_scenario()
        demo.id = "scn_demo"
        demo.name = "Regional Flood Response — Demo"
        demo.resources.medical_kits = 1000
        demo.resources.food_units = 3500
        for z in demo.zones:
            if z.id == "zone_alpha":
                z.shelter_occupancy = 1030
                z.shelter_capacity = 1200
            z.food_demand = z.shelter_occupancy * 3
        recompute_accessibility(demo)
        with self._lock:
            self._scenarios[demo.id] = demo
        self._persist(demo)
        return demo


class ResultStore:
    def __init__(self) -> None:
        self._results: Dict[str, Any] = {}
        self._order: List[str] = []
        self._seq = 0
        self._lock = threading.Lock()
        self._bootstrap()

    @property
    def _col(self):
        return get_collection("optimization_results")

    def _bootstrap(self) -> None:
        col = self._col
        if col is None:
            return
        docs = list(col.find({}).sort("seq", 1))
        for doc in docs:
            doc.pop("_id", None)
            rid = doc["result_id"]
            self._results[rid] = doc["payload"]
            self._order.append(rid)
            self._seq = max(self._seq, int(doc.get("seq", 0)))

    def save(self, result_id: str, payload: Dict[str, Any]) -> None:
        with self._lock:
            if result_id not in self._results:
                self._order.append(result_id)
            self._results[result_id] = payload
            self._seq += 1
            seq = self._seq
        col = self._col
        if col is not None:
            col.update_one(
                {"result_id": result_id},
                {"$set": {"result_id": result_id, "seq": seq, "payload": payload}},
                upsert=True,
            )

    def get(self, result_id: str) -> Optional[Dict[str, Any]]:
        return self._results.get(result_id)

    def latest(self) -> Optional[Dict[str, Any]]:
        return self._results[self._order[-1]] if self._order else None

    def list_ids(self) -> List[str]:
        return list(self._order)


scenario_store = ScenarioStore()
result_store = ResultStore()
