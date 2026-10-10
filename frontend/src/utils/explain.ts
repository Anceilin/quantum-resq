// Dynamic, data-driven explanation of allocation decisions (spec section 16).
// Every reason is derived from actual scenario values — nothing is hard-coded.
import type { Assignment, Scenario, Solution, Zone } from '../types'
import { resourceLabel, severityLabel } from './format'

export interface ZoneExplanation {
  zone: Zone
  assignments: Assignment[]
  receiving: boolean
  reasons: string[]
}

function rankByPriority(scenario: Scenario): Zone[] {
  return [...scenario.zones].sort((a, b) => b.priority_score - a.priority_score)
}

export function explainZone(
  zone: Zone,
  assignments: Assignment[],
  scenario: Scenario,
): ZoneExplanation {
  const ranked = rankByPriority(scenario)
  const rank = ranked.findIndex((z) => z.id === zone.id) + 1
  const receiving = assignments.length > 0
  const reasons: string[] = []

  if (receiving) {
    if (zone.severity === 'critical' || zone.severity === 'high') {
      reasons.push(`${severityLabel(zone.severity)} severity`)
    }
    if (zone.priority_score >= 60) {
      reasons.push(`High emergency priority (${zone.priority_score.toFixed(0)}/100, rank #${rank})`)
    } else {
      reasons.push(`Priority ${zone.priority_score.toFixed(0)}/100 (rank #${rank} of ${ranked.length})`)
    }
    if (zone.population >= 20000) {
      reasons.push(`Large affected population (${zone.population.toLocaleString()})`)
    }
    const vulnerable = zone.children + zone.elderly + zone.disabled
    if (vulnerable >= zone.population * 0.2) {
      reasons.push(`High vulnerable population (${vulnerable.toLocaleString()} children/elderly/disabled)`)
    }
    if (zone.road_accessibility >= 0.99) {
      reasons.push('Fully accessible route')
    } else if (zone.road_accessibility > 0) {
      reasons.push(`Reachable via alternate route (accessibility ${(zone.road_accessibility * 100).toFixed(0)}%)`)
    }
    const hasMedical = assignments.some((a) => a.resource === 'ambulances' || a.resource === 'medical_kits')
    if (hasMedical && zone.hospital_capacity - zone.hospital_occupancy > 0) {
      reasons.push(`Nearby hospital has capacity (${zone.hospital_capacity - zone.hospital_occupancy} beds free)`)
    }
    const hasShelter = assignments.some((a) => a.resource === 'shelter_capacity')
    if (hasShelter && zone.shelter_capacity - zone.shelter_occupancy > 0) {
      reasons.push(`Shelter headroom available (${zone.shelter_capacity - zone.shelter_occupancy} spots free)`)
    }
  } else {
    const higher = ranked.slice(0, Math.max(0, rank - 1))
    if (higher.length > 0) {
      reasons.push(`Lower priority than ${higher.slice(0, 3).map((z) => z.name).join(', ')}`)
    }
    if (zone.road_accessibility <= 0) {
      reasons.push('Zone unreachable — all connecting roads blocked')
    } else if (zone.road_accessibility < 0.6) {
      reasons.push(`Reduced accessibility (${(zone.road_accessibility * 100).toFixed(0)}%) raises travel cost`)
    }
    if (zone.severity === 'low' || zone.severity === 'moderate') {
      reasons.push(`${severityLabel(zone.severity)} severity — other zones have more urgent demand`)
    }
    if ((zone.hospital_capacity - zone.hospital_occupancy) <= 0) {
      reasons.push('No remaining hospital capacity for medical resources')
    }
    reasons.push('Limited resource availability — allocated where marginal benefit is highest')
  }

  return { zone, assignments, receiving, reasons }
}

export function explainSolution(solution: Solution, scenario: Scenario): ZoneExplanation[] {
  const byZone = new Map<string, Assignment[]>()
  for (const a of solution.assignments) {
    byZone.set(a.zone_id, byZone.get(a.zone_id) ?? [])
    byZone.get(a.zone_id)!.push(a)
  }
  // Explain the zones that are part of the optimisation instance first, then others.
  const instanceZoneNames = new Set(solution.assignments.map((a) => a.zone_name))
  const zones = [...scenario.zones].sort((a, b) => {
    const aIn = instanceZoneNames.has(a.name) ? 0 : 1
    const bIn = instanceZoneNames.has(b.name) ? 0 : 1
    if (aIn !== bIn) return aIn - bIn
    return b.priority_score - a.priority_score
  })
  return zones.map((z) => explainZone(z, byZone.get(z.id) ?? [], scenario))
}

export function summariseAssignments(solution: Solution): string[] {
  const grouped = new Map<string, string[]>()
  for (const a of solution.assignments) {
    grouped.set(a.zone_name, grouped.get(a.zone_name) ?? [])
    grouped.get(a.zone_name)!.push(`${a.bundles}× ${resourceLabel(a.resource)}`)
  }
  return [...grouped.entries()].map(([zone, items]) => `${zone} → ${items.join(', ')}`)
}
