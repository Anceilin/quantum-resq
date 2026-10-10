"""Persistent JSON file store fallback when MongoDB is unreachable.

Guarantees data survives backend restarts even when MongoDB Atlas network connection
is offline or blocked by firewall.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).parent.parent.parent / "data"


class JsonFileCollection:
    def __init__(self, name: str) -> None:
        self.name = name
        self.filepath = DATA_DIR / f"{name}.json"
        self._lock = threading.Lock()
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    def _read_all(self) -> List[Dict[str, Any]]:
        if not self.filepath.exists():
            return []
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def _write_all(self, docs: List[Dict[str, Any]]) -> None:
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(docs, f, indent=2, default=str)

    def find_all(self) -> List[Dict[str, Any]]:
        with self._lock:
            return self._read_all()

    def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            docs = self._read_all()
            for doc in docs:
                if all(doc.get(k) == v for k, v in query.items()):
                    return dict(doc)
            return None

    def upsert(self, query: Dict[str, Any], doc: Dict[str, Any]) -> None:
        with self._lock:
            docs = self._read_all()
            updated = False
            for i, d in enumerate(docs):
                if all(d.get(k) == v for k, v in query.items()):
                    docs[i] = doc
                    updated = True
                    break
            if not updated:
                docs.append(doc)
            self._write_all(docs)

    def delete_one(self, query: Dict[str, Any]) -> bool:
        with self._lock:
            docs = self._read_all()
            new_docs = [d for d in docs if not all(d.get(k) == v for k, v in query.items())]
            if len(new_docs) < len(docs):
                self._write_all(new_docs)
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._write_all([])

