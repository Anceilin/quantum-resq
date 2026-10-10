import { useState, useEffect, type CSSProperties } from 'react'
import {
  Home,
  Users,
  Bed,
  Package,
  Truck,
  UtensilsCrossed,
  TrendingUp,
  Zap,
  History,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  RefreshCw,
  ArrowDownToLine,
  Activity,
  Check,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatNumber, formatPct, SEVERITY_COLOR } from '../utils/format'
import { Spinner } from '../components/ui'

type Tab =
  | 'overview'
  | 'intake'
  | 'capacity'
  | 'food-inventory'
  | 'food-deliveries'
  | 'food-distribution'
  | 'demand'
  | 'optimization'
  | 'history'

export default function ShelterDashboard() {
  const {
    scenario,
    shelterOverview,
    shelterProposal,
    shelterLoading,
    shelterError,
    optimizing,
    error,
    loadShelterOverview,
    retryShelterOverview,
    recordShelterIntake,
    requestAdditionalBeds,
    updateBedRequestStatus,
    addFoodItem,
    requestFoodDelivery,
    receiveFoodDelivery,
    distributeFoodToZone,
    optimizeShelterAllocation,
    applyShelterOptimization,
    clearShelterProposal,
  } = useApp()

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [valError, setValError] = useState<string | null>(null)

  // Intake Form State
  const [intakeZoneId, setIntakeZoneId] = useState<string>('')
  const [intakeCount, setIntakeCount] = useState<number>(10)
  const [intakeNotes, setIntakeNotes] = useState<string>('')

  // Bed Request Form State
  const [bedZoneId, setBedZoneId] = useState<string>('')
  const [bedQty, setBedQty] = useState<number>(50)
  const [bedReason, setBedReason] = useState<string>('Expected influx of displaced residents')
  const [bedType, setBedType] = useState<string>('cots')

  // Food Item Form State
  const [foodName, setFoodName] = useState<string>('')
  const [foodCat, setFoodCat] = useState<string>('rice_grains')
  const [foodQty, setFoodQty] = useState<number>(100)
  const [foodUnit, setFoodUnit] = useState<string>('kg')

  // Food Delivery Form State
  const [delivItemName, setDelivItemName] = useState<string>('Rice')
  const [delivCategory, setDelivCategory] = useState<string>('rice_grains')
  const [delivQty, setDelivQty] = useState<number>(100)
  const [delivUnit, setDelivUnit] = useState<string>('kg')
  const [delivReason, setDelivReason] = useState<string>('Emergency ration supply')

  // Food Distribution Form State
  const [distZoneId, setDistZoneId] = useState<string>('')
  const [distItemId, setDistItemId] = useState<string>('')
  const [distQty, setDistQty] = useState<number>(10)

  // Per-zone pending intake inputs
  const [quickIntake, setQuickIntake] = useState<Record<string, number>>({})

  useEffect(() => {
    loadShelterOverview()
  }, [loadShelterOverview])

  const foodItems = shelterOverview?.foodItems ?? []
  const intakeHistory = shelterOverview?.intakeHistory ?? []
  const bedRequests = shelterOverview?.bedRequests ?? []
  const foodDeliveries = shelterOverview?.foodDeliveries ?? []
  const foodDistributions = shelterOverview?.foodDistributions ?? []
  const auditLog = shelterOverview?.auditLog ?? []

  useEffect(() => {
    if (foodItems.length > 0 && (!distItemId || !foodItems.some((f) => f.id === distItemId))) {
      setDistItemId(foodItems[0].id)
    }
  }, [foodItems, distItemId])

  if (!scenario || (shelterLoading && !shelterOverview)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner label="Loading shelter data…" />
      </div>
    )
  }

  // Live stats from overview or fallback scenario calculations
  const totalCapacity = shelterOverview?.totalCapacity ?? scenario.zones.reduce((s, z) => s + z.shelter_capacity, 0)
  const totalOccupancy = shelterOverview?.totalOccupancy ?? scenario.zones.reduce((s, z) => s + z.shelter_occupancy, 0)
  const freeBeds = shelterOverview?.totalFreeBeds ?? Math.max(0, totalCapacity - totalOccupancy)
  const occupancyPct = totalCapacity > 0 ? (totalOccupancy / totalCapacity) * 100 : 0
  const totalFoodUnits = shelterOverview?.totalFoodUnits ?? scenario.resources.food_units
  const totalFoodDemand = shelterOverview?.totalFoodDemand ?? scenario.zones.reduce((s, z) => s + z.food_demand, 0)
  const foodShortage = shelterOverview?.foodShortage ?? Math.max(0, totalFoodDemand - totalFoodUnits)

  const criticalShelters = scenario.zones.filter(
    (z) => z.shelter_capacity > 0 && z.shelter_occupancy / z.shelter_capacity > 0.85,
  ).length

  // Handlers
  const handleIntakeSubmit = async (zId?: string, count?: number) => {
    const targetZoneId = zId || intakeZoneId || scenario.zones[0]?.id
    const targetCount = count ?? intakeCount
    setValError(null)
    setSuccessMsg(null)

    if (!targetZoneId) {
      setValError('Please select a target zone for intake.')
      return
    }
    if (targetCount <= 0) {
      setValError('Intake count must be greater than 0.')
      return
    }

    const zone = scenario.zones.find((z) => z.id === targetZoneId)
    if (zone) {
      const zoneFree = Math.max(0, zone.shelter_capacity - zone.shelter_occupancy)
      if (targetCount > zoneFree) {
        setValError(`Intake count (${targetCount}) exceeds free beds (${zoneFree}) in zone '${zone.name}'.`)
        return
      }
    }

    setSubmitting(true)
    const ok = await recordShelterIntake(targetZoneId, targetCount, intakeNotes || 'Person intake recorded')
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Successfully recorded intake of ${targetCount} people for ${zone?.name || targetZoneId}. Occupancy and food demand updated.`)
      setIntakeNotes('')
      setQuickIntake((prev) => ({ ...prev, [targetZoneId]: 0 }))
    }
  }

  const handleBedRequestSubmit = async () => {
    const targetZoneId = bedZoneId || scenario.zones[0]?.id
    setValError(null)
    setSuccessMsg(null)

    if (!targetZoneId) {
      setValError('Please select a target zone.')
      return
    }
    if (bedQty <= 0) {
      setValError('Requested bed quantity must be greater than 0.')
      return
    }

    setSubmitting(true)
    const ok = await requestAdditionalBeds({
      zone_id: targetZoneId,
      quantity: bedQty,
      reason: bedReason || 'Emergency bed request',
      bed_type: bedType,
    })
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Requested ${bedQty} additional ${bedType} for zone. Request is pending approval/deployment.`)
    }
  }

  const handleDeployBeds = async (requestId: string, qty: number) => {
    setValError(null)
    setSuccessMsg(null)
    setSubmitting(true)
    const ok = await updateBedRequestStatus(requestId, 'Deployed', qty, 'Beds deployed and verified operational')
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Confirmed deployment of ${qty} additional beds! Usable shelter capacity updated.`)
    }
  }

  const handleAddFoodItemSubmit = async () => {
    setValError(null)
    setSuccessMsg(null)
    if (!foodName.trim()) {
      setValError('Food item name is required.')
      return
    }
    if (foodQty <= 0) {
      setValError('Quantity must be greater than 0.')
      return
    }

    setSubmitting(true)
    const ok = await addFoodItem({
      name: foodName,
      category: foodCat,
      quantity: foodQty,
      unit: foodUnit,
    })
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Added ${foodQty} ${foodUnit} of ${foodName} to food inventory.`)
      setFoodName('')
    }
  }

  const handleDeliveryRequestSubmit = async () => {
    setValError(null)
    setSuccessMsg(null)
    if (!delivItemName.trim()) {
      setValError('Item name is required.')
      return
    }
    if (delivQty <= 0) {
      setValError('Quantity must be greater than 0.')
      return
    }

    setSubmitting(true)
    const ok = await requestFoodDelivery({
      food_item_name: delivItemName,
      category: delivCategory,
      quantity: delivQty,
      unit: delivUnit,
      reason: delivReason,
    })
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Food delivery requested: ${delivQty} ${delivUnit} of ${delivItemName}. Available stock will update upon receipt.`)
    }
  }

  const handleReceiveDelivery = async (deliveryId: string, qty: number) => {
    setValError(null)
    setSuccessMsg(null)
    setSubmitting(true)
    const ok = await receiveFoodDelivery(deliveryId, qty, 'Delivery received and stocked')
    setSubmitting(false)
    if (ok) {
      setSuccessMsg(`Delivery confirmed received! Added ${qty} units to available food inventory.`)
    } else {
      setValError(error || 'Failed to confirm delivery receipt.')
    }
  }

  const handleDistributeSubmit = async () => {
    const targetZoneId = distZoneId || scenario.zones[0]?.id
    const targetItemId = distItemId || foodItems[0]?.id || ''
    setValError(null)
    setSuccessMsg(null)

    if (!targetZoneId) {
      setValError('Select a target zone.')
      return
    }
    if (!targetItemId) {
      setValError('Select a food item to distribute.')
      return
    }
    if (distQty <= 0) {
      setValError('Distribution quantity must be greater than 0.')
      return
    }

    const item = foodItems.find((f) => f.id === targetItemId)
    if (item && distQty > item.quantity) {
      setValError(`Distribution quantity (${distQty} ${item.unit}) exceeds available stock (${item.quantity} ${item.unit}).`)
      return
    }

    setSubmitting(true)
    const ok = await distributeFoodToZone(targetZoneId, [{ food_item_id: targetItemId, quantity: distQty }])
    setSubmitting(false)
    if (ok) {
      const zoneName = scenario.zones.find((z) => z.id === targetZoneId)?.name || targetZoneId
      setSuccessMsg(`Distributed ${distQty} units of food to shelter zone ${zoneName}. Available inventory updated.`)
    } else {
      setValError(error || 'Failed to distribute food.')
    }
  }

  const handleOptimize = async () => {
    setValError(null)
    setSuccessMsg(null)
    const prop = await optimizeShelterAllocation()
    if (prop) {
      setSuccessMsg('Optimization proposal calculated. Review allocations below and click Apply Recommendation.')
    }
  }

  const handleApplyOptimization = async () => {
    if (!shelterProposal) return
    setValError(null)
    setSuccessMsg(null)
    setSubmitting(true)
    const ok = await applyShelterOptimization(shelterProposal.id)
    setSubmitting(false)
    if (ok) {
      setSuccessMsg('Shelter optimization recommendation applied! Food distributions committed and inventory updated.')
    }
  }

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Shelter Overview', icon: Activity },
    { id: 'intake', label: 'Person Intake', icon: Users },
    { id: 'capacity', label: 'Capacity Management', icon: Bed },
    { id: 'food-inventory', label: 'Food Inventory', icon: Package },
    { id: 'food-deliveries', label: 'Food Deliveries', icon: Truck },
    { id: 'food-distribution', label: 'Food Distribution', icon: UtensilsCrossed },
    { id: 'demand', label: 'Demand & Shortages', icon: TrendingUp },
    { id: 'optimization', label: 'Optimization', icon: Zap },
    { id: 'history', label: 'Audit History', icon: History },
  ]

  return (
    <div className="shl-page">
      {/* ── Demo Notice Banner ── */}
      <div className="shl-demo-banner">
        <Info size={16} className="shl-demo-icon" />
        <div style={{ flex: 1 }}>
          <strong>SIMULATION / DEMO DATA</strong> — Complete Shelter Operations Workspace. All intakes, bed deployments, food deliveries, distributions, and optimization persist to backend.
        </div>
        <button
          className="btn btn-sm"
          onClick={() => loadShelterOverview()}
          title="Refresh shelter state from backend"
        >
          <RefreshCw size={13} /> Refresh Data
        </button>
      </div>

      {/* ── Alerts ── */}
      {shelterError && (
        <div className="med-alert-success" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
          <AlertTriangle size={18} style={{ color: '#ef4444' }} />
          <span style={{ flex: 1, color: '#ef4444' }}>
            <strong>Shelter API Error:</strong> {shelterError}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => retryShelterOverview()}
            style={{ backgroundColor: '#ef4444', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {successMsg && (
        <div className="med-alert-success">
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{successMsg}</span>
          <button className="pop-x" onClick={() => setSuccessMsg(null)}><X size={14} /></button>
        </div>
      )}
      {valError && (
        <div className="med-alert-success" style={{ background: 'rgba(248, 113, 113, 0.12)', borderColor: 'rgba(248, 113, 113, 0.3)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--warn)' }} />
          <span style={{ flex: 1, color: 'var(--warn)' }}>{valError}</span>
          <button className="pop-x" onClick={() => setValError(null)}><X size={14} /></button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="head">
        <div>
          <div className="sec">Shelter Coordinator Operations</div>
          <h1>Shelter Capacity, Person Intake &amp; Food Supply</h1>
          <p className="sub">
            Operational dashboard: Log person intakes, manage shelter bed capacity, track food inventory &amp; deliveries, allocate food supplies, and run optimization.
          </p>
        </div>
        <div className="btns">
          {criticalShelters > 0 ? (
            <span className="badge bad"><AlertTriangle size={12} /> {criticalShelters} shelter(s) near capacity</span>
          ) : (
            <span className="badge ok">Shelter capacity adequate</span>
          )}
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map((t) => {
          const IconComp = t.icon
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              className={isActive ? 'btn cy' : 'btn'}
              onClick={() => setActiveTab(t.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13 }}
            >
              <IconComp size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Stat Cards */}
          <div className="shl-cards-grid">
            <div className="shl-card" style={{ '--sc': 'var(--sky)' } as CSSProperties}>
              <div className="shl-card-icon"><Home size={22} /></div>
              <div>
                <div className="shl-card-val">{formatNumber(totalCapacity)}</div>
                <div className="shl-card-title">Total Usable Shelter Capacity</div>
                <div className="shl-card-sub">Usable beds across {scenario.zones.length} zones</div>
              </div>
            </div>

            <div className="shl-card" style={{ '--sc': occupancyPct > 85 ? 'var(--warn)' : 'var(--teal)' } as CSSProperties}>
              <div className="shl-card-icon"><Users size={22} /></div>
              <div>
                <div className="shl-card-val">{formatNumber(totalOccupancy)}</div>
                <div className="shl-card-title">Current Occupancy</div>
                <div className="shl-card-sub">{formatPct(occupancyPct)} capacity used · {formatNumber(freeBeds)} beds free</div>
              </div>
            </div>

            <div className="shl-card" style={{ '--sc': 'var(--amber)' } as CSSProperties}>
              <div className="shl-card-icon"><Package size={22} /></div>
              <div>
                <div className="shl-card-val">{formatNumber(totalFoodUnits)}</div>
                <div className="shl-card-title">Food Inventory Available</div>
                <div className="shl-card-sub">
                  {totalFoodUnits >= totalFoodDemand
                    ? 'Sufficient supply for current demand'
                    : `Shortage: ${formatNumber(foodShortage)} units deficit`}
                </div>
              </div>
            </div>

            <div className="shl-card" style={{ '--sc': foodShortage > 0 ? 'var(--warn)' : 'var(--violet)' } as CSSProperties}>
              <div className="shl-card-icon"><UtensilsCrossed size={22} /></div>
              <div>
                <div className="shl-card-val">{formatNumber(totalFoodDemand)}</div>
                <div className="shl-card-title">Total Food Demand</div>
                <div className="shl-card-sub">Calculated from sheltered population</div>
              </div>
            </div>
          </div>

          {/* Zone Grid */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Zone Shelter &amp; Food Status</h2>
                <p className="sub">Live capacity, occupancy, free beds, and food demand per zone.</p>
              </div>
            </div>
            <div className="shl-zones-grid">
              {[...scenario.zones]
                .sort((a, b) => {
                  const aPct = a.shelter_capacity > 0 ? a.shelter_occupancy / a.shelter_capacity : 0
                  const bPct = b.shelter_capacity > 0 ? b.shelter_occupancy / b.shelter_capacity : 0
                  return bPct - aPct
                })
                .map((z) => {
                  const occ = z.shelter_capacity > 0 ? (z.shelter_occupancy / z.shelter_capacity) * 100 : 0
                  const free = Math.max(0, z.shelter_capacity - z.shelter_occupancy)
                  return (
                    <div className="shl-zone-card" key={z.id}>
                      <div className="shl-zone-header">
                        <div>
                          <span className="shl-zone-name">
                            <i className="zdot" style={{ background: SEVERITY_COLOR[z.severity] }} />
                            {z.name}
                          </span>
                          <div className="shl-zone-meta">{formatNumber(free)} beds free · {formatPct(occ)} full</div>
                        </div>
                        <span className={occ > 85 ? 'badge bad' : occ > 60 ? 'badge info' : 'badge ok'} style={{ fontSize: 11 }}>
                          {occ > 85 ? 'Near Capacity' : occ > 60 ? 'Moderate' : 'Available'}
                        </span>
                      </div>
                      <div className="shl-progress-bar">
                        <div className="shl-progress-fill" style={{ width: `${Math.min(occ, 100)}%` }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span className="sub">{formatNumber(z.shelter_occupancy)} / {formatNumber(z.shelter_capacity)} beds</span>
                        <span className="sub"><UtensilsCrossed size={11} style={{ display: 'inline' }} /> Food demand: {formatNumber(z.food_demand)}</span>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: PERSON INTAKE ── */}
      {activeTab === 'intake' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Intake Form Card */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Record Person Intake</h2>
                <p className="sub">Validates available bed capacity, updates zone occupancy, and recalculates food demand on backend.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Destination Zone</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={intakeZoneId || scenario.zones[0]?.id}
                  onChange={(e) => setIntakeZoneId(e.target.value)}
                >
                  {scenario.zones.map((z) => {
                    const free = Math.max(0, z.shelter_capacity - z.shelter_occupancy)
                    return (
                      <option key={z.id} value={z.id}>
                        {z.name} ({free} beds free / {z.shelter_capacity} cap)
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Number of People</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={intakeCount}
                  min={1}
                  onChange={(e) => setIntakeCount(parseInt(e.target.value) || 0)}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Notes / Coordinator Details</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={intakeNotes}
                  placeholder="e.g. Evacuees from Sector 4 flood zone"
                  onChange={(e) => setIntakeNotes(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn cy" disabled={submitting} onClick={() => handleIntakeSubmit()}>
                {submitting ? <Spinner label="Logging Intake…" /> : 'Log Person Intake'}
              </button>
            </div>
          </div>

          {/* Table with Quick Intake */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Zone Quick Intake Table</h2>
                <p className="sub">Direct intake per zone with live capacity validation.</p>
              </div>
            </div>
            <div className="scroll">
              <table className="qtable">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th className="r">Capacity</th>
                    <th className="r">Occupied</th>
                    <th className="r">Free Beds</th>
                    <th className="r">Occupancy %</th>
                    <th className="r">Food Demand</th>
                    <th className="r">Quick Intake</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scenario.zones].sort((a, b) => b.priority_score - a.priority_score).map((z) => {
                    const occ = z.shelter_capacity > 0 ? (z.shelter_occupancy / z.shelter_capacity) * 100 : 0
                    const free = Math.max(0, z.shelter_capacity - z.shelter_occupancy)
                    const val = quickIntake[z.id] ?? 0
                    return (
                      <tr key={z.id}>
                        <td>
                          <b>
                            <i className="zdot" style={{ background: SEVERITY_COLOR[z.severity] }} />
                            {z.name}
                          </b>
                        </td>
                        <td className="r mono">{formatNumber(z.shelter_capacity)}</td>
                        <td className="r mono">{formatNumber(z.shelter_occupancy)}</td>
                        <td className="r mono" style={{ color: free < 50 ? 'var(--warn)' : 'var(--ok)', fontWeight: 700 }}>{formatNumber(free)}</td>
                        <td className="r">
                          <span className={occ > 85 ? 'badge bad' : occ > 60 ? 'badge info' : 'badge ok'}>
                            {formatPct(occ)}
                          </span>
                        </td>
                        <td className="r mono">{formatNumber(z.food_demand)}</td>
                        <td className="r">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="number"
                              className="input"
                              style={{ width: 70, padding: '4px 8px', fontSize: 13 }}
                              value={val || ''}
                              placeholder="0"
                              min={0}
                              onChange={(e) => setQuickIntake((prev) => ({ ...prev, [z.id]: parseInt(e.target.value) || 0 }))}
                            />
                            <button
                              className="btn btn-sm cy"
                              disabled={val <= 0 || submitting}
                              onClick={() => handleIntakeSubmit(z.id, val)}
                              title="Log intake"
                            >
                              <ArrowDownToLine size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Intake History */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Intake History Log</h2>
                <p className="sub">Persistent audit log of recorded person intakes.</p>
              </div>
              <span className="badge info">{intakeHistory.length} Records</span>
            </div>
            {intakeHistory.length === 0 ? (
              <p className="sub" style={{ padding: '12px 0' }}>No intake records logged yet.</p>
            ) : (
              <div className="scroll">
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Zone</th>
                      <th className="r">Count</th>
                      <th className="r">Occupancy Before → After</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intakeHistory.map((r) => (
                      <tr key={r.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{r.timestamp}</td>
                        <td><b>{r.zoneName}</b></td>
                        <td className="r mono" style={{ fontWeight: 700, color: 'var(--sky)' }}>+{r.count}</td>
                        <td className="r mono">{r.occupancyBefore} → {r.occupancyAfter} / {r.capacity}</td>
                        <td className="sub">{r.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: CAPACITY MANAGEMENT ── */}
      {activeTab === 'capacity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Request Extra Beds Form */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Request Additional Beds / Overflow Shelter</h2>
                <p className="sub">Request additional cots or temporary shelter. Usable capacity updates only after confirmation of deployment.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Destination Zone</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={bedZoneId || scenario.zones[0]?.id}
                  onChange={(e) => setBedZoneId(e.target.value)}
                >
                  {scenario.zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name} (Current cap: {z.shelter_capacity})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Additional Beds Quantity</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={bedQty}
                  min={1}
                  onChange={(e) => setBedQty(parseInt(e.target.value) || 0)}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Arrangement Type</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={bedType}
                  onChange={(e) => setBedType(e.target.value)}
                >
                  <option value="cots">Emergency Cots &amp; Beds</option>
                  <option value="temporary_shelter">Temporary Tented Shelter</option>
                  <option value="overflow">Approved Overflow Facility</option>
                  <option value="additional_capacity">Existing Building Extension</option>
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Reason / Notes</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={bedReason}
                  onChange={(e) => setBedReason(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn cy" disabled={submitting} onClick={handleBedRequestSubmit}>
                {submitting ? <Spinner label="Submitting Request…" /> : 'Submit Additional Bed Request'}
              </button>
            </div>
          </div>

          {/* Bed Requests List & Deployment Action */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Additional Bed Requests &amp; Deployment Tracking</h2>
                <p className="sub">Confirm deployment when beds arrive on-site to increase usable capacity.</p>
              </div>
              <span className="badge info">{bedRequests.length} Requests</span>
            </div>
            {bedRequests.length === 0 ? (
              <p className="sub" style={{ padding: '12px 0' }}>No bed requests recorded yet.</p>
            ) : (
              <div className="scroll">
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Zone</th>
                      <th className="r">Quantity</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th className="r">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bedRequests.map((b) => (
                      <tr key={b.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{b.timestamp}</td>
                        <td><b>{b.zoneName}</b></td>
                        <td className="r mono" style={{ fontWeight: 700 }}>+{b.quantity}</td>
                        <td><span className="badge info" style={{ fontSize: 11 }}>{b.bedType}</span></td>
                        <td>
                          <span className={b.status === 'Deployed' ? 'badge ok' : 'badge warn'}>
                            {b.status}
                          </span>
                        </td>
                        <td className="sub">{b.reason}</td>
                        <td className="r">
                          {b.status !== 'Deployed' ? (
                            <button
                              className="btn btn-sm cy"
                              disabled={submitting}
                              onClick={() => handleDeployBeds(b.id, b.quantity)}
                            >
                              <Check size={13} /> Confirm Deployment (+{b.quantity} Beds)
                            </button>
                          ) : (
                            <span className="sub" style={{ color: 'var(--ok)', fontSize: 12 }}>
                              <CheckCircle2 size={13} style={{ display: 'inline' }} /> Capacity +{b.deployedQuantity}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: FOOD INVENTORY ── */}
      {activeTab === 'food-inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Add Food Item Form */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Add Itemized Food Inventory</h2>
                <p className="sub">Register specific food categories, quantities, units, and storage locations.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Item Name</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={foodName}
                  placeholder="e.g. Fortified Rice Bags"
                  onChange={(e) => setFoodName(e.target.value)}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Category</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={foodCat}
                  onChange={(e) => setFoodCat(e.target.value)}
                >
                  <option value="rice_grains">Rice &amp; Grains</option>
                  <option value="pulses_lentils">Pulses &amp; Lentils</option>
                  <option value="packaged_meals">Packaged Meals</option>
                  <option value="ready_to_eat">Ready-To-Eat Rations</option>
                  <option value="drinking_water">Drinking Water</option>
                  <option value="cooking_oil">Cooking Oil</option>
                  <option value="other">Other Essential Food</option>
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Quantity Available</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={foodQty}
                  min={1}
                  onChange={(e) => setFoodQty(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Unit of Measure</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={foodUnit}
                  onChange={(e) => setFoodUnit(e.target.value)}
                >
                  <option value="kg">kilograms (kg)</option>
                  <option value="litres">litres</option>
                  <option value="packets">packets</option>
                  <option value="crates">crates</option>
                  <option value="meal_portions">meal portions</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn cy" disabled={submitting} onClick={handleAddFoodItemSubmit}>
                {submitting ? <Spinner label="Saving Item…" /> : 'Add Food Item to Stock'}
              </button>
            </div>
          </div>

          {/* Itemized Food Table */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Itemized Food Inventory</h2>
                <p className="sub">Itemized available stock across warehouses.</p>
              </div>
              <span className="badge info">{foodItems.length} Food Items</span>
            </div>
            {foodItems.length === 0 ? (
              <p className="sub" style={{ padding: '12px 0' }}>No itemized food registered yet. Aggregate scenario stock: {formatNumber(totalFoodUnits)} units.</p>
            ) : (
              <div className="scroll">
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th className="r">Available Stock</th>
                      <th>Unit</th>
                      <th>Storage Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foodItems.map((f) => (
                      <tr key={f.id}>
                        <td><b>{f.name}</b></td>
                        <td><span className="badge info" style={{ fontSize: 11 }}>{f.category}</span></td>
                        <td className="r mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>{formatNumber(f.quantity)}</td>
                        <td>{f.unit}</td>
                        <td className="sub">{f.storageLocation || 'Central Warehouse'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 5: FOOD DELIVERIES ── */}
      {activeTab === 'food-deliveries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Request Delivery Form */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Request Food Supply Delivery</h2>
                <p className="sub">Request new food delivery from regional supplier. Stock updates only after receipt confirmation.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Food Item Name</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={delivItemName}
                  onChange={(e) => setDelivItemName(e.target.value)}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Category</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={delivCategory}
                  onChange={(e) => setDelivCategory(e.target.value)}
                >
                  <option value="rice_grains">Rice &amp; Grains</option>
                  <option value="pulses_lentils">Pulses &amp; Lentils</option>
                  <option value="packaged_meals">Packaged Meals</option>
                  <option value="ready_to_eat">Ready-To-Eat Rations</option>
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Quantity Requested</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={delivQty}
                  min={1}
                  onChange={(e) => setDelivQty(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Unit</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={delivUnit}
                  onChange={(e) => setDelivUnit(e.target.value)}
                >
                  <option value="kg">kg</option>
                  <option value="litres">litres</option>
                  <option value="packets">packets</option>
                  <option value="crates">crates</option>
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Reason / Notes</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={delivReason}
                  placeholder="e.g. Emergency ration supply"
                  onChange={(e) => setDelivReason(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn cy" disabled={submitting} onClick={handleDeliveryRequestSubmit}>
                {submitting ? <Spinner label="Requesting Delivery…" /> : 'Submit Delivery Request'}
              </button>
            </div>
          </div>

          {/* Deliveries List */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Food Deliveries &amp; Receipt Confirmation</h2>
                <p className="sub">Confirm arrival of deliveries to credit inventory.</p>
              </div>
              <span className="badge info">{foodDeliveries.length} Deliveries</span>
            </div>
            {foodDeliveries.length === 0 ? (
              <p className="sub" style={{ padding: '12px 0' }}>No food deliveries requested yet.</p>
            ) : (
              <div className="scroll">
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Item</th>
                      <th className="r">Requested Qty</th>
                      <th>Status</th>
                      <th className="r">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foodDeliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{d.timestamp}</td>
                        <td><b>{d.foodItemName}</b> ({d.category})</td>
                        <td className="r mono" style={{ fontWeight: 700 }}>{d.quantity} {d.unit}</td>
                        <td><span className={d.status === 'Received' ? 'badge ok' : 'badge warn'}>{d.status}</span></td>
                        <td className="r">
                          {d.status !== 'Received' ? (
                            <button
                              className="btn btn-sm cy"
                              disabled={submitting}
                              onClick={() => handleReceiveDelivery(d.id, d.quantity)}
                            >
                              <Check size={13} /> Confirm Receipt (+{d.quantity} {d.unit})
                            </button>
                          ) : (
                            <span className="sub" style={{ color: 'var(--ok)', fontSize: 12 }}>
                              <CheckCircle2 size={13} style={{ display: 'inline' }} /> Stock Added
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 6: FOOD DISTRIBUTION ── */}
      {activeTab === 'food-distribution' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Distribute Form */}
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Distribute Food Rations to Zone</h2>
                <p className="sub">Allocates food stock to target zone shelter population and deducts available inventory.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Destination Zone</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={distZoneId || scenario.zones[0]?.id}
                  onChange={(e) => setDistZoneId(e.target.value)}
                >
                  {scenario.zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name} (Food Demand: {z.food_demand})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Select Food Item</label>
                <select
                  className="input"
                  style={{ width: '100%' }}
                  value={distItemId || foodItems[0]?.id || ''}
                  onChange={(e) => setDistItemId(e.target.value)}
                >
                  {foodItems.length === 0 ? (
                    <option value="">No itemized food available (Use aggregate stock)</option>
                  ) : (
                    foodItems.map((f) => (
                      <option key={f.id} value={f.id}>{f.name} ({f.quantity} {f.unit} avail)</option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Quantity to Distribute</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={distQty}
                  min={1}
                  onChange={(e) => setDistQty(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn cy" disabled={submitting || foodItems.length === 0} onClick={handleDistributeSubmit}>
                {submitting ? <Spinner label="Distributing…" /> : 'Confirm & Distribute Food'}
              </button>
            </div>
          </div>

          {/* Distributions List */}
          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div>
                <h2>Food Distribution History</h2>
                <p className="sub">Record of food supplies dispatched to zone shelters.</p>
              </div>
              <span className="badge info">{foodDistributions.length} Distributions</span>
            </div>
            {foodDistributions.length === 0 ? (
              <p className="sub" style={{ padding: '12px 0' }}>No food distributions logged yet.</p>
            ) : (
              <div className="scroll">
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Zone</th>
                      <th className="r">Items &amp; Quantities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foodDistributions.map((d) => (
                      <tr key={d.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{d.timestamp}</td>
                        <td><b>{d.zoneName}</b></td>
                        <td className="r mono">
                          {(d.items || []).map((it: any) => `${it.quantity} units`).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 7: DEMAND & SHORTAGES ── */}
      {activeTab === 'demand' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="head" style={{ marginBottom: 16 }}>
              <div>
                <h2>Food Demand Model &amp; Shortage Analysis</h2>
                <p className="sub">Calculated as 3 rations per sheltered person per day (1-day planning window).</p>
              </div>
            </div>
            <div className="scroll">
              <table className="qtable">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th className="r">Occupied Population</th>
                    <th className="r">Calculated Food Demand (Rations)</th>
                    <th className="r">Priority Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scenario.zones].sort((a, b) => b.priority_score - a.priority_score).map((z) => {
                    const demand = z.food_demand
                    return (
                      <tr key={z.id}>
                        <td><b>{z.name}</b></td>
                        <td className="r mono">{formatNumber(z.shelter_occupancy)}</td>
                        <td className="r mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>{formatNumber(demand)}</td>
                        <td className="r mono">{z.priority_score.toFixed(1)}</td>
                        <td>
                          <span className={foodShortage > 0 ? 'badge bad' : 'badge ok'}>
                            {foodShortage > 0 ? 'Shortage Deficit' : 'Supplied'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 8: OPTIMIZATION ── */}
      {activeTab === 'optimization' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="med-opt-action-card">
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: 'var(--ink)' }}>
                <Zap size={18} style={{ color: 'var(--violet)', display: 'inline', marginRight: 6 }} />
                Optimize Shelter &amp; Food Supply Allocation
              </h3>
              <p className="sub" style={{ margin: 0, maxWidth: 680 }}>
                Runs priority-weighted knapsack optimization across all zones considering sheltered population, bed headroom, food inventory, and emergency priority scores.
              </p>
            </div>
            <button
              className="btn cy lg"
              onClick={handleOptimize}
              disabled={optimizing}
              style={{ padding: '12px 24px', fontSize: 15 }}
            >
              {optimizing ? <Spinner label="Calculating Shelter Proposal…" /> : 'Optimize Shelter Allocation'}
            </button>
          </div>

          {shelterProposal && (
            <div className="card med-proposal-card animate-in">
              <div className="head" style={{ marginBottom: 14 }}>
                <div>
                  <div className="sec" style={{ color: 'var(--violet)' }}>Proposed Allocation Recommendation</div>
                  <h2>{shelterProposal.verdictNote}</h2>
                </div>
                <div className="btns">
                  <span className="badge info">{shelterProposal.solverUsed}</span>
                </div>
              </div>

              <div className="scroll" style={{ marginBottom: 16 }}>
                <table className="qtable">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th>Priority</th>
                      <th className="r">Food Demand</th>
                      <th className="r">Proposed Allocation</th>
                      <th className="r">Remaining Unmet</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(shelterProposal.foodAllocations || []).map((a) => (
                      <tr key={a.zoneId}>
                        <td><b>{a.zoneName}</b></td>
                        <td className="mono">{a.priority.toFixed(1)}</td>
                        <td className="r mono">{formatNumber(a.foodDemand)}</td>
                        <td className="r mono" style={{ fontWeight: 700, color: 'var(--violet)' }}>{formatNumber(a.foodAllocated)}</td>
                        <td className="r mono" style={{ color: a.remainingUnmet > 0 ? 'var(--warn)' : 'var(--ok)' }}>{formatNumber(a.remainingUnmet)}</td>
                        <td>
                          <span className={a.status === 'Fully Supplied' ? 'badge ok' : a.status === 'Partially Supplied' ? 'badge info' : 'badge bad'}>
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="btns" style={{ justifyContent: 'flex-end', gap: 12 }}>
                <button className="btn" onClick={clearShelterProposal} disabled={submitting}>Discard Proposal</button>
                <button className="btn vi lg" onClick={handleApplyOptimization} disabled={submitting}>
                  {submitting ? <Spinner label="Applying Proposal…" /> : 'Apply Recommendation'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 9: AUDIT HISTORY ── */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="head" style={{ marginBottom: 14 }}>
            <div>
              <h2>Audit Log History</h2>
              <p className="sub">Full audit log of intakes, bed requests, food receipts, distributions, and optimization actions.</p>
            </div>
            <span className="badge info">{auditLog.length} Records</span>
          </div>
          {auditLog.length === 0 ? (
            <p className="sub" style={{ padding: '12px 0' }}>No audit records in current session.</p>
          ) : (
            <div className="scroll">
              <table className="qtable">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Event Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" style={{ fontSize: 12 }}>{a.timestamp}</td>
                      <td>{a.userEmail || 'Shelter Coordinator'}</td>
                      <td><span className="badge info" style={{ fontSize: 11 }}>{a.type}</span></td>
                      <td className="sub">{a.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
