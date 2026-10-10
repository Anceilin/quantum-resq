"""Application configuration loaded from environment / .env.

Secrets (IBM Quantum credentials, API keys) are NEVER hard-coded. The local
Qiskit Aer simulator works without any credentials; IBM Quantum execution is
optional and only used when credentials are supplied via the environment.
"""
from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Q-RESCUE"
    app_subtitle: str = "Quantum-Assisted Emergency Resource Allocation"
    version: str = "0.1.0"
    environment: str = "development"

    # CORS origins for the Vite dev server (comma-separated).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Quantum backend selection: "aer" (local simulator, default) or "ibm".
    quantum_backend: str = "aer"

    # Optional IBM Quantum credentials. Leave empty to use the local simulator.
    ibm_quantum_token: Optional[str] = None
    ibm_quantum_instance: Optional[str] = None
    ibm_quantum_backend_name: Optional[str] = None

    # Guardrails so QAOA never hangs the API.
    qaoa_timeout_seconds: float = 60.0
    max_qubits: int = 16

    # --- Persistence (MongoDB) ---
    # NoSQL store for users, scenarios and optimisation results so created
    # scenarios survive a backend restart. When Mongo is unreachable the app
    # transparently falls back to an in-memory store (prototype / test mode).
    mongo_uri: Optional[str] = None
    mongo_db_name: str = "quantumresq"

    # --- Authentication ---
    # JWT signing secret. NEVER hard-coded: supply it via .env / environment.
    # If absent, an ephemeral secret is generated at startup (tokens then do
    # not survive a restart, which is acceptable for local simulation).
    jwt_secret: Optional[str] = None
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def resolved_jwt_secret(self) -> str:
        """Return the configured JWT secret, or an ephemeral one if unset.

        The secret is never hard-coded in source. When it is not supplied via
        the environment we generate a random one for this process only.
        """
        if self.jwt_secret:
            return self.jwt_secret
        import secrets

        return secrets.token_urlsafe(32)


settings = Settings()
