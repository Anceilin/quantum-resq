import type { SeverityLevel } from '../types'

export const DISASTER_LABEL: Record<string, string> = {
  flood: 'Flood',
  cyclone: 'Cyclone',
  earthquake: 'Earthquake',
  wildfire: 'Wildfire',
  accident: 'Industrial Accident',
}

export function disasterLabel(t: string): string {
  return DISASTER_LABEL[t] ?? t
}


export const SEVERITY_COLOR: Record<SeverityLevel, string> = {
  critical: '#fb7185',
  high: '#fb923c',
  moderate: '#fbbf24',
  low: '#34d399',
}

export const SEVERITY_RANK: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
}

export function severityLabel(s: SeverityLevel): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function priorityColor(score: number): string {
  if (score >= 70) return '#fb7185'
  if (score >= 45) return '#fb923c'
  if (score >= 25) return '#fbbf24'
  return '#34d399'
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—'
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export const RESOURCE_LABEL: Record<string, string> = {
  ambulances: 'Ambulances',
  rescue_teams: 'Rescue Teams',
  medical_kits: 'Medical Kits',
  food_units: 'Food Units',
  shelter_capacity: 'Shelter Capacity',
  emergency_vehicles: 'Emergency Vehicles',
}

export function resourceLabel(key: string): string {
  return RESOURCE_LABEL[key] ?? key
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
