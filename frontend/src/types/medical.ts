export interface MedicalZoneDispatch {
  zoneId: string
  zoneName: string
  priority: number
  demandBefore: number
  allocatedBefore: number
  dispatchUnits: number
  demandAfter: number
  statusAfter: 'Fully Supplied' | 'Partially Supplied' | 'Shortage'
}

export interface MedicalProposal {
  id: string
  timestamp: string
  scenarioId: string
  availableStock: number
  totalDemand: number
  totalProposedDispatch: number
  projectedRemainingStock: number
  projectedUnmetDemand: number
  dispatches: MedicalZoneDispatch[]
  solverUsed: string
  verdictNote: string
  isStale?: boolean
}

export interface MedicalDispatchRecord {
  id: string
  timestamp: string
  scenarioId?: string
  userEmail?: string
  totalDispatched: number
  remainingStockAfter: number
  status?: 'Confirmed' | 'Dispatched' | 'Delivered' | 'Cancelled'
  dispatches: MedicalZoneDispatch[]
  solverUsed?: string
  note?: string
}

export interface InventoryAuditRecord {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  type: string
  quantity: number
  reason: string
  stockBefore: number
  stockAfter: number
}
