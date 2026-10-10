import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, type OptimizeParams } from '../services/api'
import { useAuth } from './AuthContext'
import type {
  CompareResult,
  RecordedAllocationItem,
  ReoptimizeResult,
  RoadBlockResult,
  Scenario,
  ScenarioUpdate,
} from '../types'
import type { InventoryAuditRecord, MedicalDispatchRecord, MedicalProposal } from '../types/medical'
import type { ShelterOverview, ShelterProposal } from '../types/shelter'

export interface OptConfig {
  zones_count: number
  resources: string[]
  reps: number
  shots: number
  optimizer: string
  maxiter: number
  seed: number | null
}

export const DEFAULT_OPT_CONFIG: OptConfig = {
  zones_count: 4,
  resources: ['ambulances', 'rescue_teams', 'medical_kits', 'shelter_capacity'],
  reps: 1,
  shots: 1024,
  optimizer: 'COBYLA',
  maxiter: 60,
  seed: 42,
}

interface AppState {
  scenario: Scenario | null
  compare: CompareResult | null
  reopt: ReoptimizeResult | null
  roadBlock: RoadBlockResult | null
  config: OptConfig
  loadingScenario: boolean
  optimizing: boolean
  error: string | null
  dirty: boolean
  demoRunning: boolean
  demoStep: string | null
  historicalBaseline: HistoricalBaseline | null
  // Medical Coordinator workflow state
  medicalStockAvailable: number
  medicalAllocatedMap: Record<string, number>
  medicalProposal: MedicalProposal | null
  medicalDispatchHistory: MedicalDispatchRecord[]
  medicalAuditLog: InventoryAuditRecord[]
  // Shelter Coordinator workflow state
  shelterOverview: ShelterOverview | null
  shelterProposal: ShelterProposal | null
  shelterLoading: boolean
  shelterError: string | null
}

export interface HistoricalBaseline {
  recordId: string
  name: string
  allocation: RecordedAllocationItem[]
}

interface AppActions {
  init: () => Promise<void>
  loadScenario: (id: string) => Promise<void>
  resetDemo: () => Promise<void>
  setConfig: (patch: Partial<OptConfig>) => void
  runCompare: () => Promise<CompareResult | null>
  blockRoad: (roadId: string, blocked: boolean) => Promise<RoadBlockResult | null>
  applyPreset: (preset: string, autoRun?: boolean) => Promise<void>
  updateScenario: (patch: ScenarioUpdate) => Promise<void>
  reoptimize: () => Promise<ReoptimizeResult | null>
  loadHistoricalAsScenario: (recordId: string) => Promise<Scenario | null>
  setError: (e: string | null) => void
  setDemo: (running: boolean, step?: string | null) => void
  // Medical Coordinator actions
  loadMedicalOverview: (scenarioId?: string) => Promise<void>
  loadMedicalDemoData: () => Promise<void>
  updateZoneMedicalDemand: (zoneId: string, newDemand: number) => Promise<void>
  adjustMedicalInventory: (type: 'addition' | 'correction', quantity: number, reason: string) => Promise<boolean>
  optimizeMedicalAllocation: () => Promise<MedicalProposal | null>
  confirmMedicalDispatch: (proposal: MedicalProposal, customDispatches?: any[]) => Promise<boolean>
  cancelMedicalDispatch: (dispatchId: string) => Promise<boolean>
  completeMedicalDispatch: (dispatchId: string) => Promise<boolean>
  clearMedicalProposal: () => void
  // Shelter Coordinator actions
  loadShelterOverview: (scenarioId?: string) => Promise<void>
  retryShelterOverview: () => Promise<void>
  recordShelterIntake: (zoneId: string, count: number, notes?: string) => Promise<boolean>
  requestAdditionalBeds: (body: any) => Promise<boolean>
  updateBedRequestStatus: (requestId: string, status: string, deployedQuantity?: number, notes?: string) => Promise<boolean>
  addFoodItem: (body: any) => Promise<boolean>
  requestFoodDelivery: (body: any) => Promise<boolean>
  receiveFoodDelivery: (deliveryId: string, quantity: number, notes?: string) => Promise<boolean>
  distributeFoodToZone: (zoneId: string, items: any[], notes?: string) => Promise<boolean>
  recordFoodWaste: (itemId: string, quantity: number, reason: string) => Promise<boolean>
  optimizeShelterAllocation: () => Promise<ShelterProposal | null>
  applyShelterOptimization: (proposalId: string) => Promise<boolean>
  clearShelterProposal: () => void
}

type Ctx = AppState & AppActions

const AppContext = createContext<Ctx | null>(null)

function params(scenarioId: string, cfg: OptConfig): OptimizeParams {
  return {
    scenario_id: scenarioId,
    zones_count: cfg.zones_count,
    resources: cfg.resources,
    reps: cfg.reps,
    shots: cfg.shots,
    optimizer: cfg.optimizer,
    maxiter: cfg.maxiter,
    seed: cfg.seed,
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [compare, setCompare] = useState<CompareResult | null>(null)
  const [reopt, setReopt] = useState<ReoptimizeResult | null>(null)
  const [roadBlock, setRoadBlock] = useState<RoadBlockResult | null>(null)
  const [config, setConfigState] = useState<OptConfig>(DEFAULT_OPT_CONFIG)
  const [loadingScenario, setLoadingScenario] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [demoRunning, setDemoRunningState] = useState(false)
  const [demoStep, setDemoStep] = useState<string | null>(null)
  const [historicalBaseline, setHistoricalBaseline] = useState<HistoricalBaseline | null>(null)

  // Medical Coordinator state
  const [medicalStockAvailable, setMedicalStockAvailable] = useState<number>(1000)
  const [medicalAllocatedMap, setMedicalAllocatedMap] = useState<Record<string, number>>({})
  const [medicalProposal, setMedicalProposal] = useState<MedicalProposal | null>(null)
  const [medicalDispatchHistory, setMedicalDispatchHistory] = useState<MedicalDispatchRecord[]>([])

  // Shelter Coordinator state
  const [shelterOverview, setShelterOverview] = useState<ShelterOverview | null>(null)
  const [shelterProposal, setShelterProposal] = useState<ShelterProposal | null>(null)
  const [shelterLoading, setShelterLoading] = useState(false)
  const [shelterError, setShelterError] = useState<string | null>(null)

  const scenarioRef = useRef<Scenario | null>(null)
  scenarioRef.current = scenario
  const configRef = useRef(config)
  configRef.current = config
  const userRoleRef = useRef<string>('')
  userRoleRef.current = user?.role ?? ''

  const setConfig = useCallback((patch: Partial<OptConfig>) => {
    setConfigState((c) => ({ ...c, ...patch }))
    setDirty(true)
  }, [])

  const loadScenario = useCallback(async (id: string) => {
    setLoadingScenario(true)
    setError(null)
    try {
      const s = await api.getScenario(id)
      setScenario(s)
      setCompare(null)
      setReopt(null)
      setRoadBlock(null)
      setHistoricalBaseline(null)
      setDirty(false)
      setMedicalStockAvailable(s.resources.medical_kits || 1000)
      setMedicalAllocatedMap({})
      setMedicalProposal(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingScenario(false)
    }
  }, [])

  const runCompare = useCallback(async (): Promise<CompareResult | null> => {
    const s = scenarioRef.current
    if (!s) return null
    setOptimizing(true)
    setError(null)
    try {
      const res = await api.optimizeCompare(params(s.id, configRef.current))
      setCompare(res)
      setDirty(false)
      return res
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setOptimizing(false)
    }
  }, [])

  // Roles that don't need QAOA optimization to be run on login
  const COORDINATOR_ROLES = new Set([
    'medical_coordinator',
    'rescue_coordinator',
    'shelter_coordinator',
    'resource_coordinator',
  ])

  const init = useCallback(async () => {
    setLoadingScenario(true)
    setError(null)
    setHistoricalBaseline(null)
    try {
      const s = await api.getScenario('scn_demo')
      setScenario(s)
      scenarioRef.current = s
      setLoadingScenario(false)
      setMedicalStockAvailable(1000)
      setMedicalAllocatedMap({})
      setMedicalProposal(null)
      // Skip QAOA optimization for coordinator roles — they don't need it
      // and it causes a spurious "Execution failed" error banner on their dashboards.
      // userRoleRef.current is always up-to-date (no stale closure risk).
      if (!COORDINATOR_ROLES.has(userRoleRef.current)) {
        const res = await api.optimizeCompare(params(s.id, configRef.current))
        setCompare(res)
      }
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
      setLoadingScenario(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetDemo = useCallback(async () => {
    setCompare(null)
    setReopt(null)
    setRoadBlock(null)
    setMedicalStockAvailable(1000)
    setMedicalAllocatedMap({})
    setMedicalProposal(null)
    setShelterOverview(null)
    setShelterProposal(null)
    await loadScenario('scn_demo')
  }, [loadScenario])

  const blockRoad = useCallback(async (roadId: string, blocked: boolean) => {
    const s = scenarioRef.current
    if (!s) return null
    setError(null)
    try {
      const res = await api.blockRoad(s.id, roadId, blocked)
      setRoadBlock(res)
      setScenario(res.scenario)
      scenarioRef.current = res.scenario
      setDirty(true)
      return res
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [])

  const applyPreset = useCallback(async (preset: string, autoRun = true) => {
    setLoadingScenario(true)
    setError(null)
    try {
      const s = await api.createPreset(preset)
      setScenario(s)
      scenarioRef.current = s
      setCompare(null)
      setReopt(null)
      setRoadBlock(null)
      setHistoricalBaseline(null)
      setMedicalStockAvailable(s.resources.medical_kits || 1000)
      setMedicalAllocatedMap({})
      setMedicalProposal(null)
      setLoadingScenario(false)
      if (autoRun) {
        setOptimizing(true)
        const res = await api.optimizeCompare(params(s.id, configRef.current))
        setCompare(res)
        setDirty(false)
        setOptimizing(false)
      } else {
        setDirty(true)
      }
    } catch (e) {
      setError((e as Error).message)
      setLoadingScenario(false)
    }
  }, [])

  const updateScenario = useCallback(async (patch: ScenarioUpdate) => {
    const s = scenarioRef.current
    if (!s) return
    setError(null)
    try {
      const updated = await api.updateScenario(s.id, patch)
      setScenario(updated)
      scenarioRef.current = updated
      setDirty(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const reoptimize = useCallback(async (): Promise<ReoptimizeResult | null> => {
    const s = scenarioRef.current
    if (!s) return null
    setOptimizing(true)
    setError(null)
    try {
      const cfg = configRef.current
      const res = await api.reoptimize(s.id, {
        zones_count: cfg.zones_count,
        resources: cfg.resources,
        reps: cfg.reps,
        shots: cfg.shots,
        optimizer: cfg.optimizer,
        maxiter: cfg.maxiter,
        seed: cfg.seed,
      })
      setReopt(res)
      setCompare(res.compare)
      setScenario((prev) => (prev ? { ...prev } : prev))
      setDirty(false)
      return res
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setOptimizing(false)
    }
  }, [])

  const loadHistoricalAsScenario = useCallback(async (recordId: string): Promise<Scenario | null> => {
    setLoadingScenario(true)
    setError(null)
    try {
      const [rec, s] = await Promise.all([api.getHistorical(recordId), api.loadHistorical(recordId)])
      setScenario(s)
      scenarioRef.current = s
      setCompare(null)
      setReopt(null)
      setRoadBlock(null)
      setHistoricalBaseline({ recordId: rec.id, name: rec.name, allocation: rec.recorded_allocation })
      setMedicalStockAvailable(s.resources.medical_kits || 1000)
      setMedicalAllocatedMap({})
      setMedicalProposal(null)
      setDirty(true)
      return s
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setLoadingScenario(false)
    }
  }, [])

  const setDemo = useCallback((running: boolean, step: string | null = null) => {
    setDemoRunningState(running)
    setDemoStep(step)
  }, [])

  const [medicalAuditLog, setMedicalAuditLog] = useState<InventoryAuditRecord[]>([])

  const mapBackendDispatchRecord = (rec: any): MedicalDispatchRecord => ({
    id: rec.id,
    timestamp: rec.timestamp,
    scenarioId: rec.scenario_id,
    userEmail: rec.user_email,
    totalDispatched: rec.total_dispatched,
    remainingStockAfter: rec.remaining_stock_after,
    status: rec.status,
    note: rec.note,
    dispatches: (rec.dispatches || []).map((d: any) => ({
      zoneId: d.zone_id,
      zoneName: d.zone_name,
      priority: d.priority,
      demandBefore: d.demand_before,
      allocatedBefore: d.allocated_before,
      dispatchUnits: d.dispatch_units,
      demandAfter: d.demand_after,
      statusAfter: d.status_after,
    })),
  })

  const mapBackendAuditRecord = (rec: any): InventoryAuditRecord => ({
    id: rec.id,
    scenarioId: rec.scenario_id,
    timestamp: rec.timestamp,
    userEmail: rec.user_email,
    type: rec.type,
    quantity: rec.quantity,
    reason: rec.reason,
    stockBefore: rec.stock_before,
    stockAfter: rec.stock_after,
  })

  const mapBackendProposal = (prop: any): MedicalProposal => ({
    id: prop.id,
    timestamp: prop.timestamp,
    scenarioId: prop.scenario_id,
    availableStock: prop.available_stock,
    totalDemand: prop.total_demand,
    totalProposedDispatch: prop.total_proposed_dispatch,
    projectedRemainingStock: prop.projected_remaining_stock,
    projectedUnmetDemand: prop.projected_unmet_demand,
    solverUsed: prop.solver_used,
    verdictNote: prop.verdict_note,
    isStale: prop.is_stale,
    dispatches: (prop.dispatches || []).map((d: any) => ({
      zoneId: d.zone_id,
      zoneName: d.zone_name,
      priority: d.priority,
      demandBefore: d.demand_before,
      allocatedBefore: d.allocated_before,
      dispatchUnits: d.dispatch_units,
      demandAfter: d.demand_after,
      statusAfter: d.status_after,
    })),
  })

  const loadMedicalOverview = useCallback(async (scenarioId?: string) => {
    const sid = scenarioId || scenarioRef.current?.id
    if (!sid) return
    try {
      const res = await api.getMedicalOverview(sid)
      setMedicalStockAvailable(res.available_stock)
      setMedicalAllocatedMap(res.allocated_map || {})
      setMedicalDispatchHistory((res.history?.dispatches || []).map(mapBackendDispatchRecord))
      setMedicalAuditLog((res.history?.audit_log || []).map(mapBackendAuditRecord))
    } catch (e) {
      // Silently handle — medical endpoint 404s must not pollute the global error banner.
      // The medical dashboard shows empty/default state when data is unavailable.
      console.warn('[medical] loadMedicalOverview failed:', (e as Error).message)
    }
  }, [])

  // Medical Coordinator Actions
  const loadMedicalDemoData = useCallback(async () => {
    const s = scenarioRef.current
    if (!s) return
    try {
      const updated = await api.resetMedicalBaseline(s.id)
      setScenario(updated)
      scenarioRef.current = updated
      setMedicalProposal(null)
      await loadMedicalOverview(s.id)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [loadMedicalOverview])

  const updateZoneMedicalDemand = useCallback(async (zoneId: string, newDemand: number) => {
    const s = scenarioRef.current
    if (!s) return
    try {
      const updated = await api.updateMedicalDemand(s.id, zoneId, Math.max(0, newDemand))
      setScenario(updated)
      scenarioRef.current = updated
      setMedicalProposal(null) // Proposal is now stale
      await loadMedicalOverview(s.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [loadMedicalOverview])

  const adjustMedicalInventory = useCallback(
    async (type: 'addition' | 'correction', quantity: number, reason: string): Promise<boolean> => {
      const s = scenarioRef.current
      if (!s) throw new Error('No scenario loaded to adjust inventory')
      try {
        const updated = await api.adjustMedicalInventory(s.id, type, quantity, reason)
        setScenario(updated)
        scenarioRef.current = updated
        setMedicalProposal(null)
        await loadMedicalOverview(s.id)
        return true
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [loadMedicalOverview],
  )

  const optimizeMedicalAllocation = useCallback(async (): Promise<MedicalProposal | null> => {
    const s = scenarioRef.current
    if (!s) return null
    setOptimizing(true)
    setError(null)
    try {
      const res = await api.optimizeMedical(s.id)
      const prop = mapBackendProposal(res)
      setMedicalProposal(prop)
      return prop
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setOptimizing(false)
    }
  }, [])

  const confirmMedicalDispatch = useCallback(
    async (proposal: MedicalProposal, customDispatches?: any[]): Promise<boolean> => {
      const s = scenarioRef.current
      if (!s) return false

      try {
        const payloadDispatches = (customDispatches || proposal.dispatches).map((d) => ({
          zone_id: d.zoneId,
          zone_name: d.zoneName,
          priority: d.priority,
          demand_before: d.demandBefore,
          allocated_before: d.allocatedBefore,
          dispatch_units: d.dispatchUnits,
          demand_after: d.demandAfter,
          status_after: d.statusAfter,
        }))

        const res = await api.confirmMedicalDispatch(s.id, payloadDispatches, proposal.verdictNote)
        setScenario(res.scenario)
        scenarioRef.current = res.scenario
        setMedicalProposal(null)
        await loadMedicalOverview(s.id)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      }
    },
    [loadMedicalOverview],
  )

  const cancelMedicalDispatch = useCallback(
    async (dispatchId: string): Promise<boolean> => {
      const s = scenarioRef.current
      if (!s) return false
      try {
        const res = await api.cancelMedicalDispatch(s.id, dispatchId)
        setScenario(res.scenario)
        scenarioRef.current = res.scenario
        await loadMedicalOverview(s.id)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      }
    },
    [loadMedicalOverview],
  )

  const completeMedicalDispatch = useCallback(
    async (dispatchId: string): Promise<boolean> => {
      const s = scenarioRef.current
      if (!s) return false
      try {
        const res = await api.completeMedicalDispatch(s.id, dispatchId)
        setScenario(res.scenario)
        scenarioRef.current = res.scenario
        await loadMedicalOverview(s.id)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      }
    },
    [loadMedicalOverview],
  )

  const clearMedicalProposal = useCallback(() => {
    setMedicalProposal(null)
  }, [])

  const loadShelterOverview = useCallback(async (scenarioId?: string) => {
    const sid = scenarioId || scenarioRef.current?.id
    if (!sid) return
    setShelterLoading(true)
    setShelterError(null)
    try {
      const res = await api.getShelterOverview(sid)
      // Map snake_case to camelCase
      const overview: ShelterOverview = {
        scenarioId: res.scenario_id,
        totalCapacity: res.total_capacity,
        totalOccupancy: res.total_occupancy,
        totalFreeBeds: res.total_free_beds,
        occupancyRate: res.occupancy_rate,
        totalFoodUnits: res.total_food_units,
        totalFoodDemand: res.total_food_demand,
        foodShortage: res.food_shortage,
        demandModel: res.demand_model,
        zones: (res.zones || []).map((z: any) => ({
          zoneId: z.zone_id,
          zoneName: z.zone_name,
          capacity: z.capacity,
          occupancy: z.occupancy,
          freeBeds: z.free_beds,
          occupancyPct: z.occupancy_pct,
          additionalBedsPending: z.additional_beds_pending,
          additionalBedsDeployed: z.additional_beds_deployed,
          foodDemand: z.food_demand,
          priority: z.priority,
          severity: z.severity,
        })),
        foodItems: (res.food_items || []).map((f: any) => ({
          id: f.id, scenarioId: f.scenario_id, name: f.name, category: f.category,
          quantity: f.quantity, unit: f.unit, storageLocation: f.storage_location,
          source: f.source, receiptDate: f.receipt_date, expiryDate: f.expiry_date,
          minStockThreshold: f.min_stock_threshold, notes: f.notes, createdAt: f.created_at,
        })),
        intakeHistory: (res.intake_history || []).map((r: any) => ({
          id: r.id, scenarioId: r.scenario_id, timestamp: r.timestamp,
          userEmail: r.user_email, zoneId: r.zone_id, zoneName: r.zone_name,
          count: r.count, occupancyBefore: r.occupancy_before,
          occupancyAfter: r.occupancy_after, capacity: r.capacity, notes: r.notes,
        })),
        bedRequests: (res.bed_requests || []).map((b: any) => ({
          id: b.id, scenarioId: b.scenario_id, timestamp: b.timestamp,
          userEmail: b.user_email, zoneId: b.zone_id, zoneName: b.zone_name,
          quantity: b.quantity, reason: b.reason, bedType: b.bed_type,
          source: b.source, requestedDate: b.requested_date, notes: b.notes,
          status: b.status, deployedQuantity: b.deployed_quantity,
        })),
        foodDeliveries: (res.food_deliveries || []).map((d: any) => ({
          id: d.id, scenarioId: d.scenario_id, timestamp: d.timestamp,
          userEmail: d.user_email, foodItemName: d.food_item_name,
          category: d.category, quantity: d.quantity,
          receivedQuantity: d.received_quantity, unit: d.unit,
          destination: d.destination, reason: d.reason, priority: d.priority,
          expectedDate: d.expected_date, supplier: d.supplier, notes: d.notes,
          status: d.status,
        })),
        foodDistributions: (res.food_distributions || []).map((d: any) => ({
          id: d.id, scenarioId: d.scenario_id, timestamp: d.timestamp,
          userEmail: d.user_email, zoneId: d.zone_id, zoneName: d.zone_name,
          items: d.items, notes: d.notes,
        })),
        auditLog: (res.audit_log || []).map((a: any) => ({
          id: a.id, scenarioId: a.scenario_id, timestamp: a.timestamp,
          userEmail: a.user_email, type: a.type, description: a.description,
          details: a.details,
        })),
      }
      setShelterOverview(overview)
      setShelterError(null)
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load shelter data'
      console.warn('[shelter] loadShelterOverview failed:', msg)
      setShelterError(msg)
    } finally {
      setShelterLoading(false)
    }
  }, [])

  const retryShelterOverview = useCallback(async () => {
    await loadShelterOverview()
  }, [loadShelterOverview])

  const recordShelterIntake = useCallback(async (zoneId: string, count: number, notes: string = ''): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      const res = await api.recordShelterIntake(s.id, zoneId, count, notes)
      setScenario(res.scenario)
      scenarioRef.current = res.scenario
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const requestAdditionalBeds = useCallback(async (body: any): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.requestBeds(s.id, body)
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const updateBedRequestStatus = useCallback(async (requestId: string, status: string, deployedQuantity?: number, notes: string = ''): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      const res = await api.updateBedRequestStatus(s.id, requestId, { status, deployed_quantity: deployedQuantity, notes })
      if (res.scenario) {
        setScenario(res.scenario)
        scenarioRef.current = res.scenario
      }
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const addFoodItem = useCallback(async (body: any): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.addFoodItem(s.id, body)
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const requestFoodDelivery = useCallback(async (body: any): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.requestFoodDelivery(s.id, body)
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const receiveFoodDelivery = useCallback(async (deliveryId: string, quantity: number, notes: string = ''): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.receiveFoodDelivery(s.id, deliveryId, quantity, notes)
      const updated = await api.getScenario(s.id)
      setScenario(updated)
      scenarioRef.current = updated
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const distributeFoodToZone = useCallback(async (zoneId: string, items: any[], notes: string = ''): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.distributeFoodToZone(s.id, zoneId, items, notes)
      const updated = await api.getScenario(s.id)
      setScenario(updated)
      scenarioRef.current = updated
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const recordFoodWaste = useCallback(async (itemId: string, quantity: number, reason: string): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.recordFoodWaste(s.id, itemId, quantity, reason)
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const optimizeShelterAllocation = useCallback(async (): Promise<ShelterProposal | null> => {
    const s = scenarioRef.current
    if (!s) return null
    setOptimizing(true)
    setError(null)
    try {
      const res = await api.optimizeShelter(s.id)
      const prop: ShelterProposal = {
        id: res.id, timestamp: res.timestamp, scenarioId: res.scenario_id,
        totalShelterCapacity: res.total_shelter_capacity,
        totalOccupancy: res.total_occupancy, totalFreeBeds: res.total_free_beds,
        totalFoodAvailable: res.total_food_available,
        totalFoodDemand: res.total_food_demand,
        foodAllocations: (res.food_allocations || []).map((a: any) => ({
          zoneId: a.zone_id, zoneName: a.zone_name, population: a.population,
          foodDemand: a.food_demand, foodAllocated: a.food_allocated,
          foodDistributed: a.food_distributed, remainingUnmet: a.remaining_unmet,
          priority: a.priority, status: a.status,
        })),
        bedRecommendations: res.bed_recommendations || [],
        solverUsed: res.solver_used, verdictNote: res.verdict_note,
      }
      setShelterProposal(prop)
      return prop
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setOptimizing(false)
    }
  }, [])

  const applyShelterOptimization = useCallback(async (proposalId: string): Promise<boolean> => {
    const s = scenarioRef.current
    if (!s) return false
    try {
      await api.applyShelterOptimization(s.id, proposalId)
      const updated = await api.getScenario(s.id)
      setScenario(updated)
      scenarioRef.current = updated
      setShelterProposal(null)
      await loadShelterOverview(s.id)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }, [loadShelterOverview])

  const clearShelterProposal = useCallback(() => {
    setShelterProposal(null)
  }, [])

  // Load the dashboard only once an official is authenticated; clear it on logout.
  useEffect(() => {
    if (status === 'authenticated') {
      if (!scenarioRef.current) init().then(() => { loadMedicalOverview(); loadShelterOverview() })
      else { loadMedicalOverview(); loadShelterOverview() }
    } else if (status === 'unauthenticated') {
      setScenario(null)
      setCompare(null)
      setReopt(null)
      setRoadBlock(null)
      setHistoricalBaseline(null)
      setError(null)
      setMedicalStockAvailable(1000)
      setMedicalAllocatedMap({})
      setMedicalProposal(null)
      setMedicalDispatchHistory([])
      setMedicalAuditLog([])
      setShelterOverview(null)
      setShelterProposal(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const value = useMemo<Ctx>(
    () => ({
      scenario,
      compare,
      reopt,
      roadBlock,
      config,
      loadingScenario,
      optimizing,
      error,
      dirty,
      demoRunning,
      demoStep,
      historicalBaseline,
      medicalStockAvailable,
      medicalAllocatedMap,
      medicalProposal,
      medicalDispatchHistory,
      medicalAuditLog,
      init,
      loadScenario,
      resetDemo,
      setConfig,
      runCompare,
      blockRoad,
      applyPreset,
      updateScenario,
      reoptimize,
      loadHistoricalAsScenario,
      setError,
      setDemo,
      loadMedicalOverview,
      loadMedicalDemoData,
      updateZoneMedicalDemand,
      adjustMedicalInventory,
      optimizeMedicalAllocation,
      confirmMedicalDispatch,
      cancelMedicalDispatch,
      completeMedicalDispatch,
      clearMedicalProposal,
      shelterOverview,
      shelterProposal,
      shelterLoading,
      shelterError,
      loadShelterOverview,
      retryShelterOverview,
      recordShelterIntake,
      requestAdditionalBeds,
      updateBedRequestStatus,
      addFoodItem,
      requestFoodDelivery,
      receiveFoodDelivery,
      distributeFoodToZone,
      recordFoodWaste,
      optimizeShelterAllocation,
      applyShelterOptimization,
      clearShelterProposal,
    }),
    [
      scenario,
      compare,
      reopt,
      roadBlock,
      config,
      loadingScenario,
      optimizing,
      error,
      dirty,
      demoRunning,
      demoStep,
      historicalBaseline,
      medicalStockAvailable,
      medicalAllocatedMap,
      medicalProposal,
      medicalDispatchHistory,
      medicalAuditLog,
      init,
      loadScenario,
      resetDemo,
      setConfig,
      runCompare,
      blockRoad,
      applyPreset,
      updateScenario,
      reoptimize,
      loadHistoricalAsScenario,
      setError,
      setDemo,
      loadMedicalOverview,
      loadMedicalDemoData,
      updateZoneMedicalDemand,
      adjustMedicalInventory,
      optimizeMedicalAllocation,
      confirmMedicalDispatch,
      cancelMedicalDispatch,
      completeMedicalDispatch,
      clearMedicalProposal,
      shelterOverview,
      shelterProposal,
      shelterLoading,
      shelterError,
      loadShelterOverview,
      retryShelterOverview,
      recordShelterIntake,
      requestAdditionalBeds,
      updateBedRequestStatus,
      addFoodItem,
      requestFoodDelivery,
      receiveFoodDelivery,
      distributeFoodToZone,
      recordFoodWaste,
      optimizeShelterAllocation,
      applyShelterOptimization,
      clearShelterProposal,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
