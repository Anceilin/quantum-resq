"""Read-only store for the HISTORICAL disaster-response archive.

Mirrors the scenario_store pattern: backed by MongoDB so the archive survives a
restart, with a transparent in-memory fallback when Mongo is unavailable. The
records are fixed SIMULATION / DEMO archive data — seeded once and treated as
read-only (they are never mutated by the live optimization pipeline).
"""
from __future__ import annotations

import threading
from typing import List, Optional

from app.models.schemas import HistoricalRecord
from app.services.db import get_collection
from app.simulation.historical_data import build_historical_records


class HistoricalStore:
    def __init__(self) -> None:
        self._records: dict[str, HistoricalRecord] = {}
        self._order: List[str] = []
        self._lock = threading.Lock()
        self._bootstrap()

    @property
    def _col(self):
        return get_collection("historical_records")

    def _persist(self, record: HistoricalRecord) -> None:
        col = self._col
        if col is None:
            return
        col.update_one({"id": record.id}, {"$set": record.model_dump(mode="json")}, upsert=True)

    def _bootstrap(self) -> None:
        col = self._col
        if col is not None:
            for doc in col.find({}):
                doc.pop("_id", None)
                try:
                    rec = HistoricalRecord.model_validate(doc)
                except Exception:
                    continue
                self._records[rec.id] = rec
                self._order.append(rec.id)
            if self._order:
                return
        # Seed the fixed demo archive (in memory, then persist if Mongo is on).
        for rec in build_historical_records():
            with self._lock:
                self._records[rec.id] = rec
                self._order.append(rec.id)
            self._persist(rec)

    def list(self) -> List[HistoricalRecord]:
        return [self._records[i] for i in self._order if i in self._records]

    def get(self, record_id: str) -> Optional[HistoricalRecord]:
        return self._records.get(record_id)


historical_store = HistoricalStore()
