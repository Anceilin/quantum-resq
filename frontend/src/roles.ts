import type { LucideIcon } from 'lucide-react'
import { ShieldCheck, Package, HeartPulse, LifeBuoy, Home } from 'lucide-react'
import type { Role } from './types'

export interface RoleMeta {
  icon: LucideIcon
  color: string
  short: string
  blurb: string
  focus: string
}

export const ROLE_META: Record<Role, RoleMeta> = {
  disaster_management_officer: {
    icon: ShieldCheck,
    color: '#B4A7E5',
    short: 'Officer',
    blurb: 'Command view and final approvals',
    focus: 'Full control: scenarios, zones, roads and the final plan.',
  },
  resource_coordinator: {
    icon: Package,
    color: '#7FD1C7',
    short: 'Resources',
    blurb: 'Stock, supply and dispatch',
    focus: 'Keep track of every ambulance, kit and vehicle, and where it goes.',
  },
  medical_coordinator: {
    icon: HeartPulse,
    color: '#F2A3A3',
    short: 'Medical',
    blurb: 'Hospitals, triage and supplies',
    focus: 'Watch hospital beds and medical demand in each zone.',
  },
  rescue_coordinator: {
    icon: LifeBuoy,
    color: '#E8C27A',
    short: 'Rescue',
    blurb: 'Teams, routes and missions',
    focus: 'Send rescue teams where people are trapped and keep roads open.',
  },
  shelter_coordinator: {
    icon: Home,
    color: '#8AB4F8',
    short: 'Shelter',
    blurb: 'Capacity, intake and food',
    focus: 'Make sure every shelter has space, food and supplies.',
  },
}

export const ROLE_ORDER = Object.keys(ROLE_META) as Role[]

export function isRole(v: string | undefined): v is Role {
  return v !== undefined && Object.prototype.hasOwnProperty.call(ROLE_META, v)
}

