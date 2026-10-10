"""QuantumResQ / Q-RESCUE FastAPI application.

Quantum-assisted emergency resource allocation prototype.
A quantum-assisted optimization prototype using small-scale QAOA simulation.

All disaster data is SIMULATION / DEMO DATA.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, historical, medical, optimize, scenarios, shelter, simulation
from app.config import settings
from app.models.schemas import HealthResponse
from app.services.db import mongo_available

app = FastAPI(
    title=settings.app_name,
    description=(
        f"{settings.app_subtitle}. A quantum-assisted optimization prototype "
        "using small-scale QAOA simulation. SIMULATION / DEMO DATA only."
    ),
    version=settings.version,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(scenarios.router)
app.include_router(simulation.router)
app.include_router(optimize.router)
app.include_router(historical.router)
app.include_router(medical.router)
app.include_router(shelter.router)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.version,
        simulation=True,
        notice="SIMULATION / DEMO DATA",
        persistence="mongodb" if mongo_available() else "memory",
    )


@app.get("/", tags=["system"])
def root() -> dict:
    return {
        "service": settings.app_name,
        "subtitle": settings.app_subtitle,
        "version": settings.version,
        "docs": "/docs",
        "notice": "SIMULATION / DEMO DATA — quantum-assisted optimization prototype "
        "using small-scale QAOA simulation.",
    }
