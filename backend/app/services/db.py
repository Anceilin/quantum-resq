"""MongoDB connection helper.

The prototype stores users, scenarios and optimisation results in MongoDB so
created scenarios survive a backend restart. When Mongo is unreachable (or no
URI is configured) every store transparently falls back to an in-memory cache,
so the local Qiskit-Aer simulator and the test suite keep working with zero
external dependencies.

Uses the synchronous `pymongo` driver because every API route is a plain
`def` endpoint — no async rewrite is needed elsewhere in the app.
"""
from __future__ import annotations

import threading
from typing import Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from app.config import settings

_client: Optional[MongoClient] = None
_database: Optional[Database] = None
_lock = threading.Lock()
_attempted = False


def _connect() -> None:
    global _client, _database, _attempted
    _attempted = True
    if not settings.mongo_uri:
        return
    try:
        client = MongoClient(
            settings.mongo_uri,
            serverSelectionTimeoutMS=15000,
            connectTimeoutMS=10000,
        )
        # Fail fast if the server is not actually reachable.
        client.admin.command("ping")
        _client = client
        _database = client[settings.mongo_db_name]
    except Exception as exc:
        print(f"MongoDB connection failed: {type(exc).__name__}: {exc}")
        _client = None
        _database = None


def get_database() -> Optional[Database]:
    """Return the Mongo database, or None when persistence is unavailable."""
    global _attempted
    if not _attempted:
        with _lock:
            if not _attempted:
                _connect()
    return _database


def get_collection(name: str) -> Optional[Collection]:
    db = get_database()
    return db[name] if db is not None else None


def mongo_available() -> bool:
    return get_database() is not None
