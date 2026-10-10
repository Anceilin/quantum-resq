// Types mirroring the FastAPI backend models. All data is SIMULATION / DEMO.

export type SeverityLevel = 'critical' | 'high' | 'moderate' | 'low'
export type DisasterType = 'flood' | 'cyclone' | 'earthquake' | 'wildfire' | 'accident'

// --- Authentication / RBAC ---
export type Role =
  | 'disaster_management_officer'
  | 'resource_coordinator'
  | 'medical_coordinator'
  | 'rescue_coordinator'
  | 'shelter_coordinator'

export const ROLE_LABELS: Record<Role, string> = {
  disaster_management_officer: 'Disaster Management Officer',
  resource_coordinator: 'Resource Coordinator',
  medical_coordinator: 'Medical Coordinator',
  rescue_coordinator: 'Rescue Coordinator',
  shelter_coordinator: 'Shelter Coordinator',
}

export interface Permissions {
  role: Role
  role_label: string
  can_manage_scenarios: boolean
  can_edit_resources: string[]
  can_edit_zone_fields: string[]
  can_block_roads: boolean
  can_run_optimization: boolean
  can_reoptimize: boolean
}

export interface UserPublic {
  id: string
  full_name: string
  email: string
  organization: string
  role: Role
}

export interface AuthOut {
  user: UserPublic
  permissions: Permissions
  token?: string
  token_type?: string
}

export interface RegisterRequest {
  full_name: string
  email: string
  password: string
  organization: string
  role: Role
}

export interface Zone {
  id: string
  name: string
  latitude: number
  longitude: number
  population: number
  severity: SeverityLevel
  children: number
  elderly: number
  disabled: number
  medical_demand: number
  food_demand: number
  rescue_demand: number
  priority_score: number
  hospital_capacity: number
  hospital_occupancy: number
  shelter_capacity: number
  shelter_occupancy: number
  road_accessibility: number
}

export interface Resources {
  ambulances: number
  rescue_teams: number
  medical_kits: number
  food_units: number
  shelter_capacity: number
  emergency_vehicles: number
}

export interface Road {
  id: string
  source: string
  target: string
  distance_km: number
  blocked: boolean
  is_primary: boolean
}

export interface Scenario {
  id: string
  name: string
  disaster_type: DisasterType
  description: string
  is_demo: boolean
  budget: number
  zones: Zone[]
  resources: Resources
  roads: Road[]
  resource_costs: Record<string, number>
  created_at: string
}

export interface ScenarioSummary {
  id: string
  name: string
  disaster_type: DisasterType
  num_zones: number
  total_population: number
  total_resources: number
  budget: number
  is_demo: boolean
}

export interface Assignment {
  resource: string
  resource_label: string
  zone_id: string
  zone_name: string
  bundles: number
  units: number
  demand: number
  served: number
  travel_km: number
  currency_cost: number
}

export interface ResourceUtilization {
  available_units: number
  bundles_available: number
  bundles_cap: number
  units_used: number
  utilization_pct: number
}

export interface SolutionMetrics {
  n_vars: number
  assignments_count: number
  objective_value: number
  gain_total: number
  travel_total_km: number
  travel_cost_norm: number
  currency_cost: number
  budget: number
  budget_remaining: number
  demand_satisfied_pct: number
  total_demand: number
  total_served: number
  unserved_demand: number
  priority_coverage_pct: number
  served_by_resource: Record<string, number>
  unmet_by_resource: Record<string, number>
  resource_utilization: Record<string, ResourceUtilization>
  constraint_violations: number
  feasible: boolean
}

export interface Solution {
  bits: number[]
  bitstring: string
  objective_value: number
  feasible: boolean
  violations: string[]
  assignments: Assignment[]
  metrics: SolutionMetrics
}

export interface QuboSummary {
  num_primary_vars: number
  num_slack_vars: number
  num_qubits: number
  num_linear_terms: number
  num_quadratic_terms: number
  offset: number
  penalty_forbid: number
  penalty_avail: number
  resources: string[]
  zones: string[]
  cap_per_resource: Record<string, number>
  objective: string
  constraints_encoded: string[]
  constraints_enforced_at_decode: string[]
  variable_indexing: string
}

export interface TopBitstring {
  bitstring: string
  counts: number
  objective_value: number
  feasible: boolean
  violations: number
}

export interface ClassicalResult {
  kind: 'classical'
  result_id: string
  scenario_id: string
  method: string
  solver: string
  n_vars: number
  zones: string[]
  resources: string[]
  iterations: number
  feasible_candidates: number
  execution_time_ms: number
  scenario_snapshot: ScenarioSnapshot
  solution: Solution
}

export interface QaoaResult {
  kind: 'qaoa'
  result_id: string
  scenario_id: string
  status: 'success' | 'failed'
  error?: string
  error_type?: string
  backend?: string
  n_vars: number
  num_qubits: number
  num_slack_qubits: number
  zones: string[]
  resources: string[]
  qubo: QuboSummary
  config: { reps: number; shots: number; optimizer: string; seed: number | null; maxiter: number }
  scenario_snapshot: ScenarioSnapshot
  execution_time_ms?: number
  optimizer_iterations?: number
  converged?: boolean
  optimal_parameters?: { gammas: number[]; betas: number[] }
  expectation_history?: number[]
  final_expectation?: number | null
  circuit_ascii?: string
  circuit_stats?: Record<string, unknown>
  counts?: Record<string, number>
  top_counts?: Record<string, number>
  measurement?: {
    distinct_bitstrings: number
    total_shots: number
    feasible_shot_fraction: number
    top_bitstrings: TopBitstring[]
  }
  found_feasible?: boolean
  solution?: Solution
}

export interface ScenarioSnapshot {
  budget: number
  resources: Resources
  blocked_roads: string[]
  zones: Record<
    string,
    {
      name: string
      priority_score: number
      road_accessibility: number
      hospital_remaining: number
      shelter_remaining: number
      population: number
      severity: SeverityLevel
    }
  >
}

export interface ComparisonSide {
  objective_value: number
  priority_coverage_pct: number
  demand_satisfied_pct: number
  unserved_demand: number
  resource_utilization_pct: number
  travel_cost_km: number
  currency_cost: number
  constraint_violations: number
  feasible: boolean
  execution_time_ms: number
  iterations: number | null
  qubit_count: number | null
}

export interface Comparison {
  winner: 'classical' | 'qaoa' | 'tie'
  verdict: string
  identical_solution: boolean
  classical: ComparisonSide
  qaoa: ComparisonSide
  qaoa_failed: boolean
  note: string
}

export interface CompareResult {
  kind: 'compare'
  result_id: string
  scenario_id: string
  scenario_snapshot: ScenarioSnapshot
  classical_result_id: string
  qaoa_result_id: string
  classical: ClassicalResult
  qaoa: QaoaResult
  comparison: Comparison
}

export interface ZoneUpdate {
  id: string
  population?: number
  severity?: SeverityLevel
  medical_demand?: number
  food_demand?: number
  rescue_demand?: number
  hospital_capacity?: number
  hospital_occupancy?: number
  shelter_capacity?: number
  shelter_occupancy?: number
}

export interface ScenarioUpdate {
  resources?: Partial<Resources>
  budget?: number
  zone_updates?: ZoneUpdate[]
}

export interface RoadBlockResult {
  scenario: Scenario
  road_id: string
  blocked: boolean
  accessibility_before: Record<string, number>
  accessibility_after: Record<string, number>
  travel_costs_after: Record<string, number | null>
  changed_zones: string[]
  unreachable_zones: string[]
}

export interface ReoptimizeResult {
  result_id: string
  scenario_id: string
  before: { result_id: string | null; assignments: Assignment[]; objective_value: number | null }
  after: { result_id: string; assignments: Assignment[]; objective_value: number }
  changes: AllocationChange[]
  explanation: string[]
  compare: CompareResult
}

export interface AllocationChange {
  resource: string
  resource_label: string
  zone_id: string
  zone_name: string
  type: 'added' | 'removed' | 'unchanged'
  reason?: string
}

// --- Historical Records (read-only archive of PAST responses) ---
// Fixed SIMULATION / DEMO archive data. recorded_allocation is archived past
// response data, NOT classical/QAOA solver output.
export interface RecordedAllocationItem {
  resource: string
  resource_label: string
  zone_id: string
  zone_name: string
  units: number
}

export interface HistoricalRecordSummary {
  id: string
  name: string
  disaster_type: DisasterType
  location: string
  date: string
  status: 'completed' | 'historical'
  num_zones: number
  affected_people: number
  resources_available: number
  resources_allocated: number
  road_blockages: number
  hospital_beds_free: number
  shelter_beds_free: number
}

export interface HistoricalRecord {
  id: string
  name: string
  disaster_type: DisasterType
  location: string
  date: string
  status: 'completed' | 'historical'
  description: string
  scenario: Scenario
  recorded_allocation: RecordedAllocationItem[]
}

export interface AnalyticsPayload {
  result_id: string
  scenario_id: string
  demand_vs_allocation: { zone: string; demand: number; served: number }[]
  resource_utilization: { resource: string; used: number; available: number; pct: number }[]
  priority_coverage: { zone: string; priority: number; coverage: number }[]
  classical_vs_qaoa: { metric: string; classical: number; qaoa: number }[]
  allocation_by_zone: { zone: string; resource: string; units: number }[]
  shortage: ShortageAnalysis | null
}

export interface ShortageAnalysis {
  target_coverage_pct: number
  current_coverage_pct: number
  recommendations: { resource: string; label: string; additional_units: number; unmet_demand: number }[]
}
