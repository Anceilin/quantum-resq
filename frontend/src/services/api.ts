// Thin fetch wrapper around the FastAPI backend (proxied via Vite at /api).
import type {
  AnalyticsPayload,
  AuthOut,
  ClassicalResult,
  CompareResult,
  HistoricalRecord,
  HistoricalRecordSummary,
  QaoaResult,
  RegisterRequest,
  ReoptimizeResult,
  RoadBlockResult,
  Scenario,
  ScenarioSummary,
  ScenarioUpdate,
} from '../types'

const BASE = '/api'
const TOKEN_KEY = 'qresue_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* ignore parse errors */
    }
    const err = new Error(detail) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

export interface OptimizeParams {
  scenario_id: string
  zones_count?: number
  resources?: string[]
  reps?: number
  shots?: number
  optimizer?: string
  seed?: number | null
  maxiter?: number
}

export const api = {
  health: () => req<{ status: string; notice: string; persistence: string }>('/health'),

  register: (body: RegisterRequest) =>
    req<AuthOut>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    req<AuthOut>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => req<AuthOut>('/auth/me'),

  listScenarios: () => req<ScenarioSummary[]>('/scenarios'),
  getScenario: (id: string) => req<Scenario>(`/scenarios/${id}`),
  createScenario: (body: Partial<Scenario> = {}) =>
    req<Scenario>('/scenarios', { method: 'POST', body: JSON.stringify(body) }),
  createPreset: (preset: string) =>
    req<Scenario>(`/scenarios/preset/${preset}`, { method: 'POST' }),
  updateScenario: (id: string, patch: ScenarioUpdate) =>
    req<Scenario>(`/scenarios/${id}/update`, { method: 'POST', body: JSON.stringify(patch) }),
  travelCosts: (id: string) => req<Record<string, number | null>>(`/scenarios/${id}/travel-costs`),

  blockRoad: (scenario_id: string, road_id: string, blocked: boolean) =>
    req<RoadBlockResult>('/simulation/road-block', {
      method: 'POST',
      body: JSON.stringify({ scenario_id, road_id, blocked }),
    }),

  optimizeClassical: (p: OptimizeParams) =>
    req<ClassicalResult>('/optimize/classical', { method: 'POST', body: JSON.stringify(p) }),
  optimizeQaoa: (p: OptimizeParams) =>
    req<QaoaResult>('/optimize/qaoa', { method: 'POST', body: JSON.stringify(p) }),
  optimizeCompare: (p: OptimizeParams) =>
    req<CompareResult>('/optimize/compare', { method: 'POST', body: JSON.stringify(p) }),

  reoptimize: (scenario_id: string, p: Omit<OptimizeParams, 'scenario_id'> = {}) =>
    req<ReoptimizeResult>(`/scenarios/${scenario_id}/reoptimize`, {
      method: 'POST',
      body: JSON.stringify(p),
    }),

  getResult: (id: string) => req<CompareResult | ClassicalResult | QaoaResult>(`/results/${id}`),
  getCircuit: (id: string) => req<Record<string, unknown>>(`/quantum/circuit/${id}`),
  getAnalytics: (id: string) => req<AnalyticsPayload>(`/analytics/${id}`),
  getResources: () =>
    req<{ resources: { key: string; label: string }[]; optimizers: string[] }>('/resources'),

  // Historical Records — read-only archive. `load` deep-copies a record's
  // original conditions into a fresh scenario for the REAL optimizer pipeline.
  listHistorical: () => req<HistoricalRecordSummary[]>('/historical'),
  getHistorical: (id: string) => req<HistoricalRecord>(`/historical/${id}`),
  loadHistorical: (id: string) =>
    req<Scenario>(`/historical/${id}/load`, { method: 'POST' }),

  // Medical Coordinator Operational API
  getMedicalOverview: (scenarioId: string) =>
    req<{
      scenario_id: string
      available_stock: number
      total_allocated: number
      total_unmet_demand: number
      shortage_zones_count: number
      allocated_map: Record<string, number>
      history: { dispatches: any[]; audit_log: any[] }
    }>(`/scenarios/${scenarioId}/medical/overview`),

  updateMedicalDemand: (scenarioId: string, zoneId: string, medicalDemand: number) =>
    req<Scenario>(`/scenarios/${scenarioId}/medical/demand`, {
      method: 'POST',
      body: JSON.stringify({ zone_id: zoneId, medical_demand: medicalDemand }),
    }),

  adjustMedicalInventory: (
    scenarioId: string,
    type: 'addition' | 'correction',
    quantity: number,
    reason: string,
  ) =>
    req<Scenario>(`/scenarios/${scenarioId}/medical/inventory/adjust`, {
      method: 'POST',
      body: JSON.stringify({ type, quantity, reason }),
    }),

  optimizeMedical: (scenarioId: string) =>
    req<any>(`/scenarios/${scenarioId}/medical/optimize`, { method: 'POST' }),

  confirmMedicalDispatch: (scenarioId: string, dispatches?: any[], note?: string) =>
    req<{ status: string; dispatch_record: any; scenario: Scenario }>(
      `/scenarios/${scenarioId}/medical/dispatch/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ dispatches, note }),
      },
    ),

  cancelMedicalDispatch: (scenarioId: string, dispatchId: string) =>
    req<{ status: string; dispatch_record: any; scenario: Scenario }>(
      `/scenarios/${scenarioId}/medical/dispatch/${dispatchId}/cancel`,
      { method: 'POST' },
    ),

  completeMedicalDispatch: (scenarioId: string, dispatchId: string) =>
    req<{ status: string; dispatch_record: any; scenario: Scenario }>(
      `/scenarios/${scenarioId}/medical/dispatch/${dispatchId}/complete`,
      { method: 'POST' },
    ),

  resetMedicalBaseline: (scenarioId: string) =>
    req<Scenario>(`/scenarios/${scenarioId}/medical/reset-baseline`, { method: 'POST' }),

  getMedicalHistory: (scenarioId: string) =>
    req<{ dispatches: any[]; audit_log: any[] }>(`/scenarios/${scenarioId}/medical/history`),

  // Shelter Coordinator Operational API
  getShelterOverview: (scenarioId: string) =>
    req<any>(`/scenarios/${scenarioId}/shelter/overview`),

  recordShelterIntake: (scenarioId: string, zoneId: string, count: number, notes: string = '') =>
    req<any>(`/scenarios/${scenarioId}/shelter/intake`, {
      method: 'POST',
      body: JSON.stringify({ zone_id: zoneId, count, notes }),
    }),

  getShelterIntakeHistory: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/intake/history`),

  requestBeds: (scenarioId: string, body: any) =>
    req<any>(`/scenarios/${scenarioId}/shelter/beds/request`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateBedRequestStatus: (scenarioId: string, requestId: string, body: any) =>
    req<any>(`/scenarios/${scenarioId}/shelter/beds/${requestId}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getBedRequests: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/beds/requests`),

  addFoodItem: (scenarioId: string, body: any) =>
    req<any>(`/scenarios/${scenarioId}/shelter/food/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getFoodItems: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/food/items`),

  requestFoodDelivery: (scenarioId: string, body: any) =>
    req<any>(`/scenarios/${scenarioId}/shelter/food/deliveries/request`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  receiveFoodDelivery: (scenarioId: string, deliveryId: string, receivedQuantity: number, notes: string = '') =>
    req<any>(`/scenarios/${scenarioId}/shelter/food/deliveries/${deliveryId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ received_quantity: receivedQuantity, notes }),
    }),

  getFoodDeliveries: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/food/deliveries`),

  distributeFoodToZone: (scenarioId: string, zoneId: string, items: any[], notes: string = '') =>
    req<any>(`/scenarios/${scenarioId}/shelter/food/distribute`, {
      method: 'POST',
      body: JSON.stringify({ zone_id: zoneId, items, notes }),
    }),

  getFoodDistributions: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/food/distributions`),

  recordFoodWaste: (scenarioId: string, itemId: string, quantity: number, reason: string) =>
    req<any>(`/scenarios/${scenarioId}/shelter/food/${itemId}/waste`, {
      method: 'POST',
      body: JSON.stringify({ quantity, reason }),
    }),

  optimizeShelter: (scenarioId: string) =>
    req<any>(`/scenarios/${scenarioId}/shelter/optimize`, { method: 'POST' }),

  applyShelterOptimization: (scenarioId: string, proposalId: string) =>
    req<any>(`/scenarios/${scenarioId}/shelter/optimize/apply`, {
      method: 'POST',
      body: JSON.stringify({ proposal_id: proposalId }),
    }),

  getShelterAudit: (scenarioId: string) =>
    req<any[]>(`/scenarios/${scenarioId}/shelter/audit`),

  configureShelterDemand: (scenarioId: string, rationPerPerson: number, planningDays: number) =>
    req<any>(`/scenarios/${scenarioId}/shelter/demand/configure`, {
      method: 'POST',
      body: JSON.stringify({ ration_per_person: rationPerPerson, planning_days: planningDays }),
    }),
}
