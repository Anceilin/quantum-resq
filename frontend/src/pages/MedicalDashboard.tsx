import { useState, type CSSProperties } from 'react'
import {
  HeartPulse,
  Package,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Check,
  Edit2,
  RefreshCw,
  Clock,
  Activity,
  X,
  Info,
  Plus,
  RotateCcw,
  Truck,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatNumber, formatPct, severityLabel, SEVERITY_COLOR } from '../utils/format'
import { Spinner } from '../components/ui'
import type { MedicalZoneDispatch } from '../types/medical'

export default function MedicalDashboard() {
  const {
    scenario,
    medicalStockAvailable,
    medicalAllocatedMap,
    medicalProposal,
    medicalDispatchHistory,
    medicalAuditLog,
    optimizing,
    loadMedicalDemoData,
    updateZoneMedicalDemand,
    adjustMedicalInventory,
    optimizeMedicalAllocation,
    confirmMedicalDispatch,
    cancelMedicalDispatch,
    completeMedicalDispatch,
    clearMedicalProposal,
  } = useApp()

  // State for zone demand editing
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [editDemandValue, setEditDemandValue] = useState<number>(0)

  // State for Stock Adjustment modal/form
  const [invModalOpen, setInvModalOpen] = useState<boolean>(false)
  const [invType, setInvType] = useState<'addition' | 'correction'>('addition')
  const [invQty, setInvQty] = useState<number>(100)
  const [invReason, setInvReason] = useState<string>('')
  const [invSubmitting, setInvSubmitting] = useState<boolean>(false)
  const [invModalError, setInvModalError] = useState<string | null>(null)

  // State for Proposal Manual Adjustments
  const [manualDispatches, setManualDispatches] = useState<Record<string, number>>({})

  // Feedback alerts
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [valError, setValError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<boolean>(false)

  if (!scenario) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner label="Loading medical scenario…" />
      </div>
    )
  }

  // Calculate live totals from scenario & state
  const totalAllocated = Object.values(medicalAllocatedMap).reduce((s, v) => s + v, 0)
  const totalUnmetDemand = scenario.zones.reduce((s, z) => {
    const allocated = medicalAllocatedMap[z.id] ?? 0
    return s + Math.max(0, z.medical_demand - allocated)
  }, 0)

  const shortageZones = scenario.zones.filter((z) => {
    const allocated = medicalAllocatedMap[z.id] ?? 0
    return z.medical_demand > allocated
  })

  const handleStartEdit = (zoneId: string, currentDemand: number) => {
    setEditingZoneId(zoneId)
    setEditDemandValue(currentDemand)
  }

  const handleSaveEdit = async (zoneId: string) => {
    setSuccessMsg(null)
    setValError(null)
    await updateZoneMedicalDemand(zoneId, editDemandValue)
    setEditingZoneId(null)
    setSuccessMsg(`Medical demand for zone updated to ${editDemandValue} kits. Proposal invalidated for fresh calculation.`)
  }

  const handleAdjustInventorySubmit = async () => {
    setSuccessMsg(null)
    setValError(null)
    setInvModalError(null)
    if (!invReason.trim()) {
      setInvModalError('Please specify an audit reason for the inventory adjustment.')
      return
    }
    if (invType === 'addition' && invQty <= 0) {
      setInvModalError('Addition quantity must be greater than 0.')
      return
    }
    if (invType === 'correction' && invQty < 0) {
      setInvModalError('Stock correction cannot be negative.')
      return
    }

    setInvSubmitting(true)
    try {
      await adjustMedicalInventory(invType, invQty, invReason)
      setInvModalOpen(false)
      setInvReason('')
      setSuccessMsg(
        `Inventory ${invType === 'addition' ? `added (+${invQty} kits)` : `corrected to ${invQty} kits`}. Audit log recorded.`,
      )
    } catch (err: any) {
      setInvModalError(err?.message || 'Failed to persist inventory adjustment to backend')
    } finally {
      setInvSubmitting(false)
    }
  }

  const handleOptimize = async () => {
    setSuccessMsg(null)
    setValError(null)
    const prop = await optimizeMedicalAllocation()
    if (prop) {
      // Initialize manual adjustments map with proposed dispatch values
      const initMap: Record<string, number> = {}
      prop.dispatches.forEach((d) => {
        initMap[d.zoneId] = d.dispatchUnits
      })
      setManualDispatches(initMap)
    }
  }

  const handleManualDispatchChange = (zoneId: string, units: number) => {
    setManualDispatches((prev) => ({ ...prev, [zoneId]: Math.max(0, units) }))
  }

  const handleConfirm = async () => {
    if (!medicalProposal) return
    setSuccessMsg(null)
    setValError(null)

    // Calculate total manually adjusted dispatch
    const totalCustom = Object.values(manualDispatches).reduce((s, v) => s + v, 0)
    if (totalCustom > medicalStockAvailable) {
      setValError(`Cannot confirm dispatch: Total custom allocation (${totalCustom}) exceeds available stock (${medicalStockAvailable}).`)
      return
    }

    // Check individual zone demand limits
    for (const z of scenario.zones) {
      const units = manualDispatches[z.id] ?? 0
      if (units > z.medical_demand) {
        setValError(`Cannot confirm dispatch: Allocation for ${z.name} (${units}) exceeds remaining demand (${z.medical_demand}).`)
        return
      }
    }

    // Build custom dispatch items
    const customItems: MedicalZoneDispatch[] = medicalProposal.dispatches.map((d) => {
      const dispatchUnits = manualDispatches[d.zoneId] ?? d.dispatchUnits
      const demandAfter = Math.max(0, d.demandBefore - d.allocatedBefore - dispatchUnits)
      const statusAfter =
        demandAfter === 0
          ? 'Fully Supplied'
          : d.allocatedBefore + dispatchUnits > 0
            ? 'Partially Supplied'
            : 'Shortage'
      return {
        ...d,
        dispatchUnits,
        demandAfter,
        statusAfter,
      }
    })

    setConfirming(true)
    const ok = await confirmMedicalDispatch(medicalProposal, customItems)
    setConfirming(false)
    if (ok) {
      setSuccessMsg(
        `Dispatch confirmed & persisted to backend! Dispatched ${totalCustom.toLocaleString()} medical kits across zones. Inventory and zone demands updated.`,
      )
    }
  }

  const handleCancelDispatch = async (dispatchId: string) => {
    setSuccessMsg(null)
    setValError(null)
    const ok = await cancelMedicalDispatch(dispatchId)
    if (ok) {
      setSuccessMsg(`Dispatch ${dispatchId} cancelled. Reserved inventory and zone demand safely restored.`)
    }
  }

  const handleCompleteDispatch = async (dispatchId: string) => {
    setSuccessMsg(null)
    setValError(null)
    const ok = await completeMedicalDispatch(dispatchId)
    if (ok) {
      setSuccessMsg(`Dispatch ${dispatchId} delivery completed. Status updated to Delivered.`)
    }
  }

  return (
    <div className="med-page">
      {/* ── Demo Data Notice Banner ───────────────────────────────── */}
      <div className="med-demo-banner">
        <Info size={16} className="med-demo-icon" />
        <div style={{ flex: 1 }}>
          <strong>SIMULATION / DEMO DATA</strong> — Medical Coordinator Operational Workspace. All updates, dispatches, and inventory adjustments persist to backend database.
        </div>
        <button
          className="btn btn-sm"
          onClick={loadMedicalDemoData}
          title="Reset to standard 1,000 kit supply vs 915 total demand baseline"
        >
          <RefreshCw size={13} /> Reset Medical Baseline (1,000 Kits / 915 Demand)
        </button>
      </div>

      {/* ── Success Alert Message ──────────────────────────────────── */}
      {successMsg && (
        <div className="med-alert-success">
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{successMsg}</span>
          <button className="pop-x" onClick={() => setSuccessMsg(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Validation Error Message ───────────────────────────────── */}
      {valError && (
        <div className="med-alert-success" style={{ background: 'rgba(248, 113, 113, 0.12)', borderColor: 'rgba(248, 113, 113, 0.3)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--warn)' }} />
          <span style={{ flex: 1, color: 'var(--warn)' }}>{valError}</span>
          <button className="pop-x" onClick={() => setValError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="head">
        <div>
          <div className="sec">Medical Coordinator Operations</div>
          <h1>Medical Inventory, Demand &amp; Dispatch Control</h1>
          <p className="sub">
            Direct operational control: Edit zone medical requirements, manage medical kit stock, run knapsack optimization, reassign proposed supplies, confirm dispatches, and track deliveries.
          </p>
        </div>
        <div className="btns">
          <button className="btn cy" onClick={() => setInvModalOpen(true)}>
            <Plus size={15} /> Adjust Inventory Stock
          </button>
          {optimizing ? (
            <span className="badge info"><Activity size={12} className="animate-spin" /> Optimizing pool…</span>
          ) : medicalProposal ? (
            <span className="badge warn">Proposal Pending Review</span>
          ) : (
            <span className="badge ok">Live Inventory Operational</span>
          )}
        </div>
      </div>

      {/* ── Inventory Adjustment Modal ────────────────────────────── */}
      {invModalOpen && (
        <>
          <div className="pop-back" onClick={() => !invSubmitting && setInvModalOpen(false)} />
          <div className="pop" style={{ maxWidth: 480, width: '100%', padding: 20 }}>
            <div className="pop-h" style={{ marginBottom: 14 }}>
              Record Inventory Stock Adjustment
              <button className="pop-x" disabled={invSubmitting} onClick={() => setInvModalOpen(false)}><X size={14} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {invModalError && (
                <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', color: 'var(--warn)', fontSize: 13, border: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>{invModalError}</span>
                </div>
              )}

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Adjustment Type</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className={invType === 'addition' ? 'btn cy' : 'btn'}
                    onClick={() => setInvType('addition')}
                    disabled={invSubmitting}
                    style={{ flex: 1 }}
                  >
                    Add Stock (+Kits)
                  </button>
                  <button
                    className={invType === 'correction' ? 'btn cy' : 'btn'}
                    onClick={() => setInvType('correction')}
                    disabled={invSubmitting}
                    style={{ flex: 1 }}
                  >
                    Set / Correct Total Stock
                  </button>
                </div>
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  {invType === 'addition' ? 'Quantity to Add' : 'Corrected Total Stock Quantity'}
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: '100%' }}
                  value={invQty}
                  disabled={invSubmitting}
                  onChange={(e) => setInvQty(parseInt(e.target.value) || 0)}
                  min={0}
                />
              </div>

              <div>
                <label className="sub" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Audit Reason (Required)</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={invReason}
                  disabled={invSubmitting}
                  onChange={(e) => setInvReason(e.target.value)}
                  placeholder="e.g. Received emergency regional kit shipment"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button className="btn" disabled={invSubmitting} onClick={() => setInvModalOpen(false)}>Cancel</button>
                <button className="btn cy" disabled={invSubmitting} onClick={handleAdjustInventorySubmit}>
                  {invSubmitting ? <Spinner label="Saving…" /> : 'Save Adjustment & Log Audit'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── SECTION 1: TOP SUMMARY CARDS ───────────────────────────── */}
      <div className="med-cards-grid">
        <div className="med-card" style={{ '--mc': 'var(--sky)' } as CSSProperties}>
          <div className="med-card-icon"><Package size={22} /></div>
          <div>
            <div className="med-card-val">{formatNumber(medicalStockAvailable)}</div>
            <div className="med-card-title">Total Available Medical Kits</div>
            <div className="med-card-sub">Current unallocated stock in emergency pool</div>
          </div>
        </div>

        <div className="med-card" style={{ '--mc': 'var(--teal)' } as CSSProperties}>
          <div className="med-card-icon"><HeartPulse size={22} /></div>
          <div>
            <div className="med-card-val">{formatNumber(totalAllocated)}</div>
            <div className="med-card-title">Total Kits Allocated</div>
            <div className="med-card-sub">{medicalDispatchHistory.filter((d) => d.status !== 'Cancelled').length} confirmed dispatches</div>
          </div>
        </div>

        <div className="med-card" style={{ '--mc': 'var(--amber)' } as CSSProperties}>
          <div className="med-card-icon"><AlertTriangle size={22} /></div>
          <div>
            <div className="med-card-val">{formatNumber(totalUnmetDemand)}</div>
            <div className="med-card-title">Total Unmet Demand</div>
            <div className="med-card-sub">
              {totalUnmetDemand > medicalStockAvailable
                ? `Deficit of ${formatNumber(totalUnmetDemand - medicalStockAvailable)} kits beyond stock`
                : totalUnmetDemand > 0
                  ? `Sufficient stock (${formatNumber(medicalStockAvailable)} kits available)`
                  : 'All zone medical demand satisfied'}
            </div>
          </div>
        </div>

        <div className="med-card" style={{ '--mc': shortageZones.length > 0 ? 'var(--warn)' : 'var(--ok)' } as CSSProperties}>
          <div className="med-card-icon"><Activity size={22} /></div>
          <div>
            <div className="med-card-val">{shortageZones.length} / {scenario.zones.length}</div>
            <div className="med-card-title">Zones With Unmet Demand</div>
            <div className="med-card-sub">
              {shortageZones.length > 0 ? 'Requires priority medical dispatch' : 'No undersupplied zones'}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: HOSPITAL & ZONE STATUS TABLE ────────────────── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Hospital &amp; Zone Medical Status</h2>
            <p className="sub">Inspect demands, medical allocations, hospital free beds, and edit zone requirements.</p>
          </div>
          {totalUnmetDemand > 0 && (
            <span className={totalUnmetDemand > medicalStockAvailable ? 'badge bad' : 'badge info'}>
              <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
              {totalUnmetDemand > medicalStockAvailable
                ? `${formatNumber(totalUnmetDemand - medicalStockAvailable)} Kits Deficit`
                : `${formatNumber(totalUnmetDemand)} Kits Unmet Demand`}
            </span>
          )}
        </div>

        <div className="scroll">
          <table className="qtable">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Emergency Priority</th>
                <th className="r">Medical Kits Required (Demand)</th>
                <th className="r">Kits Allocated</th>
                <th className="r">Still Needed</th>
                <th>Hospital Free Beds</th>
                <th>Supply Status</th>
                <th className="r">Action</th>
              </tr>
            </thead>
            <tbody>
              {[...scenario.zones]
                .sort((a, b) => b.priority_score - a.priority_score)
                .map((z) => {
                  const allocated = medicalAllocatedMap[z.id] ?? 0
                  const needed = Math.max(0, z.medical_demand - allocated)
                  const freeBeds = Math.max(0, z.hospital_capacity - z.hospital_occupancy)
                  const statusLabel: 'Fully Supplied' | 'Partially Supplied' | 'Shortage' =
                    needed === 0
                      ? 'Fully Supplied'
                      : allocated > 0
                        ? 'Partially Supplied'
                        : 'Shortage'

                  const statusClass =
                    statusLabel === 'Fully Supplied'
                      ? 'badge ok'
                      : statusLabel === 'Partially Supplied'
                        ? 'badge info'
                        : 'badge bad'

                  const isEditing = editingZoneId === z.id

                  return (
                    <tr key={z.id}>
                      <td>
                        <b>
                          <i
                            className="zdot"
                            style={{ background: SEVERITY_COLOR[z.severity] }}
                          />
                          {z.name}
                        </b>
                        <div className="sub" style={{ fontSize: 11 }}>
                          {severityLabel(z.severity)} severity
                        </div>
                      </td>
                      <td>
                        <b className="mono">{z.priority_score.toFixed(1)}</b> / 100
                      </td>
                      <td className="r">
                        {isEditing ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              className="input"
                              style={{ width: 90, padding: '4px 8px', fontSize: 13 }}
                              value={editDemandValue}
                              onChange={(e) => setEditDemandValue(parseInt(e.target.value) || 0)}
                              min={0}
                            />
                            <button
                              className="btn btn-sm cy"
                              onClick={() => handleSaveEdit(z.id)}
                              title="Save demand"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => setEditingZoneId(null)}
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontWeight: 600 }}>{formatNumber(z.medical_demand)} kits</span>
                        )}
                      </td>
                      <td className="r mono" style={{ color: 'var(--accent)' }}>
                        {formatNumber(allocated)}
                      </td>
                      <td className="r mono" style={{ color: needed > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                        {formatNumber(needed)}
                      </td>
                      <td>
                        {/* Bug 4 fix: Explicit label free beds / total beds */}
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {freeBeds} free / {z.hospital_capacity} total beds
                        </span>
                        <div className="sub" style={{ fontSize: 11 }}>
                          {z.hospital_capacity > 0 ? formatPct((freeBeds / z.hospital_capacity) * 100) : '0%'} headroom
                        </div>
                      </td>
                      <td>
                        <span className={statusClass}>{statusLabel}</span>
                      </td>
                      <td className="r">
                        {!isEditing && (
                          <button
                            className="btn btn-sm"
                            onClick={() => handleStartEdit(z.id, z.medical_demand)}
                            title="Edit medical demand"
                          >
                            <Edit2 size={13} /> Edit Demand
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 3: OPTIMIZE MEDICAL ALLOCATION ACTION ──────────── */}
      <div className="med-opt-action-card">
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: 'var(--ink)' }}>
            <Zap size={18} style={{ color: 'var(--violet)', display: 'inline', marginRight: 6 }} />
            Calculate Optimal Medical Dispatch
          </h3>
          <p className="sub" style={{ margin: 0, maxWidth: 680 }}>
            Runs priority-weighted knapsack optimization across all 6 zones considering medical kit demands, hospital bed headroom, and emergency severity scores.
          </p>
        </div>
        <button
          className="btn cy lg"
          onClick={handleOptimize}
          disabled={optimizing}
          style={{ padding: '12px 24px', fontSize: 15 }}
        >
          {optimizing ? <Spinner label="Calculating proposed allocation…" /> : 'Optimize Medical Allocation'}
        </button>
      </div>

      {/* ── SECTION 4: PROPOSED ALLOCATION TABLE & MANUAL ADJUSTMENTS ─ */}
      {medicalProposal && (
        <div className="card med-proposal-card animate-in">
          <div className="head" style={{ marginBottom: 14 }}>
            <div>
              <div className="sec" style={{ color: 'var(--violet)' }}>
                Proposed Dispatch Recommendation &amp; Manual Override
              </div>
              <h2 style={{ margin: '2px 0 0' }}>Review &amp; Reassign Proposed Supplies</h2>
              <p className="sub">{medicalProposal.verdictNote}</p>
            </div>
            <div className="btns">
              <span className="badge info">{medicalProposal.solverUsed}</span>
              <span className="sub">Generated at {medicalProposal.timestamp}</span>
            </div>
          </div>

          <div className="scroll" style={{ marginBottom: 16 }}>
            <table className="qtable">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Priority</th>
                  <th className="r">Current Demand</th>
                  <th className="r">Already Allocated</th>
                  <th className="r" style={{ color: 'var(--violet)' }}>Proposed Dispatch (Editable)</th>
                  <th className="r">Projected Still Needed</th>
                  <th>Projected Status</th>
                </tr>
              </thead>
              <tbody>
                {medicalProposal.dispatches.map((d) => {
                  const currentCustom = manualDispatches[d.zoneId] ?? d.dispatchUnits
                  const projNeeded = Math.max(0, d.demandBefore - d.allocatedBefore - currentCustom)
                  const projStatus = projNeeded === 0 ? 'Fully Supplied' : (d.allocatedBefore + currentCustom > 0 ? 'Partially Supplied' : 'Shortage')

                  return (
                    <tr key={d.zoneId}>
                      <td><b>{d.zoneName}</b></td>
                      <td className="mono">{d.priority.toFixed(1)}</td>
                      <td className="r">{formatNumber(d.demandBefore)}</td>
                      <td className="r mono">{formatNumber(d.allocatedBefore)}</td>
                      <td className="r">
                        <input
                          type="number"
                          className="input mono"
                          style={{ width: 110, padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--violet)' }}
                          value={currentCustom}
                          min={0}
                          max={d.demandBefore}
                          onChange={(e) => handleManualDispatchChange(d.zoneId, parseInt(e.target.value) || 0)}
                        />
                      </td>
                      <td className="r mono" style={{ color: projNeeded > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                        {formatNumber(projNeeded)}
                      </td>
                      <td>
                        <span className={projStatus === 'Fully Supplied' ? 'badge ok' : projStatus === 'Partially Supplied' ? 'badge info' : 'badge bad'}>
                          {projStatus}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Proposal Summary Bar */}
          <div className="med-proposal-summary">
            <div className="med-prop-stat">
              <span>Proposed Dispatch Total:</span>
              <b style={{ color: 'var(--violet)' }}>
                {formatNumber(Object.values(manualDispatches).reduce((s, v) => s + v, 0))} kits
              </b>
            </div>
            <div className="med-prop-stat">
              <span>Projected Remaining Inventory:</span>
              <b>
                {formatNumber(Math.max(0, medicalStockAvailable - Object.values(manualDispatches).reduce((s, v) => s + v, 0)))} kits
              </b>
            </div>
            <div className="med-prop-stat">
              <span>Projected Unmet Demand:</span>
              <b style={{ color: 'var(--warn)' }}>
                {formatNumber(
                  scenario.zones.reduce((s, z) => {
                    const alloc = (medicalAllocatedMap[z.id] ?? 0) + (manualDispatches[z.id] ?? 0)
                    return s + Math.max(0, z.medical_demand - alloc)
                  }, 0),
                )}{' '}
                kits
              </b>
            </div>
          </div>

          <div className="btns" style={{ marginTop: 20, justifyContent: 'flex-end', gap: 12 }}>
            <button className="btn" onClick={clearMedicalProposal} disabled={confirming}>
              Discard Proposal
            </button>
            <button
              className="btn vi lg"
              onClick={handleConfirm}
              disabled={confirming}
              style={{ padding: '12px 28px', fontSize: 15 }}
            >
              {confirming ? <Spinner label="Persisting dispatch to backend…" /> : 'Confirm Dispatch & Update Inventory'}
            </button>
          </div>
        </div>
      )}

      {/* ── SECTION 5: ALLOCATION & DISPATCH HISTORY WITH CANCELLATION/DELIVERY ACTIONS ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 14 }}>
          <div>
            <h2>Medical Allocation &amp; Dispatch History</h2>
            <p className="sub">Persisted backend record of confirmed dispatches, delivery confirmations, and single-restoration cancellations.</p>
          </div>
          <span className="badge info">{medicalDispatchHistory.length} Logged Dispatches</span>
        </div>

        {medicalDispatchHistory.length === 0 ? (
          <p className="sub" style={{ padding: '16px 0' }}>
            No dispatches confirmed yet in this scenario. Run optimization and click Confirm Dispatch to log allocations.
          </p>
        ) : (
          <div className="scroll">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Dispatch Time</th>
                  <th>Status</th>
                  <th className="r">Kits Dispatched</th>
                  <th className="r">Stock After</th>
                  <th>Zone Distribution Breakdown</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {medicalDispatchHistory.map((h) => {
                  const statusClass =
                    h.status === 'Delivered'
                      ? 'badge ok'
                      : h.status === 'Cancelled'
                        ? 'badge bad'
                        : 'badge info'

                  return (
                    <tr key={h.id}>
                      <td>
                        <span className="mono" style={{ fontSize: 12 }}>
                          <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
                          {h.timestamp}
                        </span>
                        {h.userEmail && (
                          <div className="sub" style={{ fontSize: 11 }}>{h.userEmail}</div>
                        )}
                      </td>
                      <td><span className={statusClass}>{h.status || 'Confirmed'}</span></td>
                      <td className="r mono" style={{ fontWeight: 700, color: h.status === 'Cancelled' ? 'var(--muted)' : 'var(--violet)' }}>
                        +{formatNumber(h.totalDispatched)}
                      </td>
                      <td className="r mono">{formatNumber(h.remainingStockAfter)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {h.dispatches
                            .filter((d) => d.dispatchUnits > 0)
                            .map((d) => (
                              <span key={d.zoneId} className="chip open static" style={{ fontSize: 11 }}>
                                {d.zoneName}: +{d.dispatchUnits}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="r">
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {h.status !== 'Delivered' && h.status !== 'Cancelled' && (
                            <button
                              className="btn btn-sm cy"
                              onClick={() => handleCompleteDispatch(h.id)}
                              title="Mark delivery completed"
                            >
                              <Truck size={13} /> Mark Delivered
                            </button>
                          )}
                          {h.status !== 'Cancelled' && h.status !== 'Delivered' && (
                            <button
                              className="btn btn-sm"
                              onClick={() => handleCancelDispatch(h.id)}
                              title="Cancel pending dispatch and restore stock reservation safely"
                            >
                              <RotateCcw size={13} /> Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SECTION 6: INVENTORY AUDIT TRAIL ────────────────────────── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 14 }}>
          <div>
            <h2>Inventory Stock Audit Trail</h2>
            <p className="sub">Traceable log of all stock additions, corrections, dispatch deductions, and cancellation restorations.</p>
          </div>
          <span className="badge info">{medicalAuditLog.length} Audit Entries</span>
        </div>

        {medicalAuditLog.length === 0 ? (
          <p className="sub" style={{ padding: '16px 0' }}>
            No stock adjustments recorded yet. Use the Adjust Inventory button to add or correct stock.
          </p>
        ) : (
          <div className="scroll">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action Type</th>
                  <th className="r">Quantity</th>
                  <th className="r">Stock Before → After</th>
                  <th>Audit Reason</th>
                </tr>
              </thead>
              <tbody>
                {medicalAuditLog.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{a.timestamp}</td>
                    <td className="sub">{a.userEmail}</td>
                    <td>
                      <span className={a.type.includes('addition') || a.type.includes('restoration') ? 'badge ok' : 'badge info'}>
                        {a.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="r mono" style={{ fontWeight: 700 }}>
                      {a.type.includes('addition') || a.type.includes('restoration') ? `+${a.quantity}` : `${a.quantity}`}
                    </td>
                    <td className="r mono">
                      {a.stockBefore} → <b>{a.stockAfter}</b>
                    </td>
                    <td className="sub">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
