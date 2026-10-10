export interface ShelterIntakeRecord {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  zoneId: string
  zoneName: string
  count: number
  occupancyBefore: number
  occupancyAfter: number
  capacity: number
  notes: string
}

export interface BedRequest {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  zoneId: string
  zoneName: string
  quantity: number
  reason: string
  bedType: string
  source: string
  requestedDate: string
  notes: string
  status: 'Requested' | 'Approved' | 'In Transit' | 'Deployed' | 'Rejected' | 'Cancelled'
  deployedQuantity: number
}

export interface FoodItem {
  id: string
  scenarioId: string
  name: string
  category: string
  quantity: number
  unit: string
  storageLocation: string
  source: string
  receiptDate: string
  expiryDate: string
  minStockThreshold: number
  notes: string
  createdAt: string
}

export interface FoodDelivery {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  foodItemName: string
  category: string
  quantity: number
  receivedQuantity: number
  unit: string
  destination: string
  reason: string
  priority: string
  expectedDate: string
  supplier: string
  notes: string
  status: 'Requested' | 'Approved' | 'In Transit' | 'Partially Received' | 'Received' | 'Rejected' | 'Cancelled'
}

export interface FoodDistributionRecord {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  zoneId: string
  zoneName: string
  items: { foodItemId: string; foodItemName: string; quantity: number; unit: string }[]
  notes: string
}

export interface ShelterFoodAllocation {
  zoneId: string
  zoneName: string
  population: number
  foodDemand: number
  foodAllocated: number
  foodDistributed: number
  remainingUnmet: number
  priority: number
  status: 'Fully Supplied' | 'Partially Supplied' | 'Shortage'
}

export interface ShelterProposal {
  id: string
  timestamp: string
  scenarioId: string
  totalShelterCapacity: number
  totalOccupancy: number
  totalFreeBeds: number
  totalFoodAvailable: number
  totalFoodDemand: number
  foodAllocations: ShelterFoodAllocation[]
  bedRecommendations: any[]
  solverUsed: string
  verdictNote: string
}

export interface ShelterAuditRecord {
  id: string
  scenarioId: string
  timestamp: string
  userEmail: string
  type: string
  description: string
  details: Record<string, any>
}

export interface ShelterOverview {
  scenarioId: string
  totalCapacity: number
  totalOccupancy: number
  totalFreeBeds: number
  occupancyRate: number
  totalFoodUnits: number
  totalFoodDemand: number
  foodShortage: number
  demandModel: { rationPerPerson: number; planningDays: number }
  zones: {
    zoneId: string
    zoneName: string
    capacity: number
    occupancy: number
    freeBeds: number
    occupancyPct: number
    additionalBedsPending: number
    additionalBedsDeployed: number
    foodDemand: number
    priority: number
    severity: string
  }[]
  foodItems: FoodItem[]
  intakeHistory: ShelterIntakeRecord[]
  bedRequests: BedRequest[]
  foodDeliveries: FoodDelivery[]
  foodDistributions: FoodDistributionRecord[]
  auditLog: ShelterAuditRecord[]
}
