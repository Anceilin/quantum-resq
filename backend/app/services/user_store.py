"""User persistence: MongoDB-backed with persistent file-store and in-memory fallbacks."""
from __future__ import annotations

import threading
import uuid
from typing import Dict, Optional

from app.services.db import get_collection
from app.services.file_store import JsonFileCollection


class UserStore:
    def __init__(self) -> None:
        self._mem: Dict[str, dict] = {}
        self._by_email: Dict[str, str] = {}
        self._file_col = JsonFileCollection("users")
        self._lock = threading.Lock()
        self._bootstrap()

    @property
    def _col(self):
        return get_collection("users")

    def _bootstrap(self) -> None:
        col = self._col
        docs = list(col.find({})) if col is not None else self._file_col.find_all()
        with self._lock:
            for doc in docs:
                rec = self._to_record(doc)
                self._mem[rec["id"]] = rec
                self._by_email[rec["email"]] = rec["id"]

    @staticmethod
    def _norm_email(email: str) -> str:
        return email.strip().lower()

    def get_by_email(self, email: str) -> Optional[dict]:
        col = self._col
        norm = self._norm_email(email)
        if col is not None:
            doc = col.find_one({"email": norm})
            if doc is not None:
                return self._to_record(doc)
        doc = self._file_col.find_one({"email": norm})
        if doc is not None:
            return self._to_record(doc)
        with self._lock:
            uid = self._by_email.get(norm)
            return self._mem[uid] if uid else None

    def get_by_id(self, user_id: str) -> Optional[dict]:
        col = self._col
        if col is not None:
            doc = col.find_one({"id": user_id})
            if doc is not None:
                return self._to_record(doc)
        doc = self._file_col.find_one({"id": user_id})
        if doc is not None:
            return self._to_record(doc)
        with self._lock:
            return self._mem.get(user_id)

    def create(self, record: dict) -> dict:
        col = self._col
        if col is not None:
            col.update_one({"id": record["id"]}, {"$set": record}, upsert=True)
        self._file_col.upsert({"id": record["id"]}, record)
        with self._lock:
            self._mem[record["id"]] = record
            self._by_email[record["email"]] = record["id"]
        return record

    @staticmethod
    def _to_record(doc: dict) -> dict:
        rec = dict(doc)
        rec.pop("_id", None)
        return rec

    def count(self) -> int:
        col = self._col
        if col is not None:
            return col.count_documents({})
        return len(self._file_col.find_all())

    def new_id(self) -> str:
        return f"usr_{uuid.uuid4().hex[:10]}"


user_store = UserStore()
