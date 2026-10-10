"""Transparent priority scoring.

The priority score is a weighted, normalised combination of need factors so a
user can understand *why* a zone ranks highly. Every factor is returned in a
breakdown dict for the explainability panel.
"""
from __future__ import annotations

from typing import Dict, List

from app.models.schemas import SeverityLevel, Zone

# Severity mapped to a 0-1 scale.
SEVERITY_WEIGHT_VALUE: Dict[SeverityLevel, float] = {
    SeverityLevel.critical: 1.0,
    SeverityLevel.high: 0.75,
    SeverityLevel.moderate: 0.5,
    SeverityLevel.low: 0.25,
}

# Contribution of each normalised factor to the final 0-100 score.
PRIORITY_WEIGHTS: Dict[str, float] = {
    "severity": 0.30,
    "population": 0.20,
    "vulnerable": 0.15,
    "medical_demand": 0.15,
    "rescue_demand": 0.10,
    "access_difficulty": 0.10,
}


def _safe_ratio(value: float, max_value: float) -> float:
    if max_value <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_value))


def compute_priority_breakdown(zone: Zone, reference: Dict[str, float]) -> Dict[str, float]:
    """Return each normalised factor (0-1) for a zone given scenario maxima."""
    return {
        "severity": SEVERITY_WEIGHT_VALUE[zone.severity],
        "population": _safe_ratio(zone.population, reference["population"]),
        "vulnerable": _safe_ratio(zone.vulnerable_population, reference["vulnerable"]),
        "medical_demand": _safe_ratio(zone.medical_demand, reference["medical_demand"]),
        "rescue_demand": _safe_ratio(zone.rescue_demand, reference["rescue_demand"]),
        "access_difficulty": 1.0 - zone.road_accessibility,
    }


def compute_reference(zones: List[Zone]) -> Dict[str, float]:
    """Scenario-wide maxima used to normalise each factor to 0-1."""
    if not zones:
        return {"population": 1, "vulnerable": 1, "medical_demand": 1, "rescue_demand": 1}
    return {
        "population": max(z.population for z in zones) or 1,
        "vulnerable": max(z.vulnerable_population for z in zones) or 1,
        "medical_demand": max(z.medical_demand for z in zones) or 1,
        "rescue_demand": max(z.rescue_demand for z in zones) or 1,
    }


def compute_priority_score(zone: Zone, reference: Dict[str, float]) -> float:
    """Weighted sum of normalised factors, scaled to 0-100."""
    breakdown = compute_priority_breakdown(zone, reference)
    score = sum(PRIORITY_WEIGHTS[k] * breakdown[k] for k in PRIORITY_WEIGHTS)
    total_weight = sum(PRIORITY_WEIGHTS.values())
    return round(100.0 * score / total_weight, 1)


def assign_priority_scores(zones: List[Zone]) -> List[Zone]:
    """Mutate and return zones with a freshly computed priority_score."""
    reference = compute_reference(zones)
    for zone in zones:
        zone.priority_score = compute_priority_score(zone, reference)
    return zones
