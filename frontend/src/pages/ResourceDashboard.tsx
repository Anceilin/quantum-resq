import { useState, type CSSProperties } from 'react'
import {
  Ambulance,
  Users,
  Car,
  UtensilsCrossed,
  Home,
  Package,
  CheckCircle2,
  Info,
  X,
  RefreshCw,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatNumber, severityLabel, SEVERITY_COLOR } from '../utils/format'
import { Spinner } from '../components/ui'

interface DispatchEntry {
  id: string
  timestamp: string
  resource: string
  zone: string
  units: number
}

export default function ResourceDashboard() {
  const { scenario, compare, optimizing } = useApp()
  const [dispatchLog, setDispatchLog] = useState<DispatchEntry[]>([])
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [pendingDispatch, setPendingDispatch] = useState<Record<string, number>>({})

  if (!scenario) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner label="Loading resource data…" />
      </div>
    )
  }

  const res = scenario.resources
  const totalAmbulancesDeployed = dispatchLog.filter((d) => d.resource === 'ambulances').reduce((s, d) => s + d.units, 0)
  const totalTeamsDeployed = dispatchLog.filter((d) => d.resource === 'rescue_teams').reduce((s, d) => s + d.units, 0)

  // Derive a simple "supply score" per zone from compare data
  const zoneScores: Record<string, number> = {}
  if (compare?.classical?.solution?.assignments) {
    compare.classical.solution.assignments.forEach((a) => {
      zoneScores[a.zone_id] = (zoneScores[a.zone_id] ?? 0) + a.served
    })
  }

  const handleDispatch = (resource: string, zone: string, units: number) => {
    if (units <= 0) return
    const entry: DispatchEntry = {
      id: `dp_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      resource,
      zone,
      units,
    }
    setDispatchLog((prev) => [entry, ...prev])
    setSuccessMsg(`${units} ${resource.replace('_', ' ')} dispatched to ${zone} zone.`)
    setPendingDispatch({})
  }

  return (
    <div className="res-page">
      {/* ── Demo banner ── */}
      <div className="res-demo-banner">
        <Info size={16} className="res-demo-icon" />
        <div style={{ flex: 1 }}>
          <strong>SIMULATION / DEMO DATA</strong> — Resource pool values reflect the active scenario. Dispatches are session-only and do not modify the backend scenario.
        </div>
      </div>

      {successMsg && (
        <div className="res-alert-success">
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{successMsg}</span>
          <button className="pop-x" onClick={() => setSuccessMsg(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="head">
        <div>
          <div className="sec">Resource Coordinator Operations</div>
          <h1>Resource Stock &amp; Dispatch</h1>
          <p className="sub">
            Monitor current resource pools, review zone-level optimization allocations, and log manual dispatches.
          </p>
        </div>
        <div className="btns">
          {optimizing ? (
            <span className="badge info"><RefreshCw size={12} className="animate-spin" /> Optimizing…</span>
          ) : compare ? (
            <span className="badge ok">Optimization available</span>
          ) : (
            <span className="badge">Awaiting optimization</span>
          )}
        </div>
      </div>

      {/* ── Top resource cards ── */}
      <div className="res-cards-grid">
        <div className="res-card" style={{ '--rc2': 'var(--teal)' } as CSSProperties}>
          <div className="res-card-icon"><Ambulance size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.ambulances)}</div>
            <div className="res-card-title">Ambulances</div>
            <div className="res-card-sub">{totalAmbulancesDeployed} dispatched this session</div>
          </div>
        </div>

        <div className="res-card" style={{ '--rc2': 'var(--amber)' } as CSSProperties}>
          <div className="res-card-icon"><Users size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.rescue_teams)}</div>
            <div className="res-card-title">Rescue Teams</div>
            <div className="res-card-sub">{totalTeamsDeployed} deployed this session</div>
          </div>
        </div>

        <div className="res-card" style={{ '--rc2': 'var(--sky)' } as CSSProperties}>
          <div className="res-card-icon"><Package size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.medical_kits)}</div>
            <div className="res-card-title">Medical Kits</div>
            <div className="res-card-sub">Scenario pool (see Medical Coordinator for allocation)</div>
          </div>
        </div>

        <div className="res-card" style={{ '--rc2': 'var(--violet)' } as CSSProperties}>
          <div className="res-card-icon"><UtensilsCrossed size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.food_units)}</div>
            <div className="res-card-title">Food Units</div>
            <div className="res-card-sub">Emergency rations in pool</div>
          </div>
        </div>

        <div className="res-card" style={{ '--rc2': 'var(--rose)' } as CSSProperties}>
          <div className="res-card-icon"><Home size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.shelter_capacity)}</div>
            <div className="res-card-title">Shelter Capacity</div>
            <div className="res-card-sub">Total beds across active shelters</div>
          </div>
        </div>

        <div className="res-card" style={{ '--rc2': 'var(--muted)' } as CSSProperties}>
          <div className="res-card-icon"><Car size={22} /></div>
          <div>
            <div className="res-card-val">{formatNumber(res.emergency_vehicles)}</div>
            <div className="res-card-title">Emergency Vehicles</div>
            <div className="res-card-sub">Available for deployment</div>
          </div>
        </div>
      </div>

      {/* ── Zone allocation table from classical optimization ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Zone Allocation Status</h2>
            <p className="sub">Derived from classical optimizer results. Run Re-Optimize to refresh.</p>
          </div>
          <span className="badge info">{scenario.zones.length} Active Zones</span>
        </div>

        <div className="scroll">
          <table className="qtable">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Severity</th>
                <th className="r">Population</th>
                <th className="r">Ambulances Allocated</th>
                <th className="r">Rescue Teams Allocated</th>
                <th className="r">Medical Kits Allocated</th>
                <th>Road Access</th>
                <th className="r">Priority Score</th>
              </tr>
            </thead>
            <tbody>
              {[...scenario.zones]
                .sort((a, b) => b.priority_score - a.priority_score)
                .map((z) => {
                  const getZoneAlloc = (resource: string) => {
                    if (!compare?.classical?.solution?.assignments) return '—'
                    const a = compare.classical.solution.assignments.find(
                      (a) => a.zone_id === z.id && a.resource === resource,
                    )
                    return a ? formatNumber(a.units) : '0'
                  }
                  const roadPct = Math.round(z.road_accessibility * 100)
                  return (
                    <tr key={z.id}>
                      <td>
                        <b>
                          <i className="zdot" style={{ background: SEVERITY_COLOR[z.severity] }} />
                          {z.name}
                        </b>
                      </td>
                      <td>
                        <span
                          className={
                            z.severity === 'critical'
                              ? 'badge bad'
                              : z.severity === 'high'
                                ? 'badge bad'
                                : z.severity === 'moderate'
                                  ? 'badge info'
                                  : 'badge ok'
                          }
                        >
                          {severityLabel(z.severity)}
                        </span>
                      </td>
                      <td className="r mono">{formatNumber(z.population)}</td>
                      <td className="r mono">{getZoneAlloc('ambulances')}</td>
                      <td className="r mono">{getZoneAlloc('rescue_teams')}</td>
                      <td className="r mono">{getZoneAlloc('medical_kits')}</td>
                      <td>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: 'var(--line)',
                            width: 80,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${roadPct}%`,
                              background: roadPct > 70 ? 'var(--ok)' : roadPct > 40 ? 'var(--amber)' : 'var(--warn)',
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>{roadPct}%</div>
                      </td>
                      <td className="r mono" style={{ fontWeight: 700 }}>{z.priority_score.toFixed(1)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Quick dispatch form ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Quick Dispatch Log</h2>
            <p className="sub">Log a manual resource dispatch. Session-only — does not modify the backend scenario.</p>
          </div>
        </div>

        <div className="res-dispatch-form">
          {scenario.zones.map((z) => {
            const key = z.id
            const val = pendingDispatch[key] ?? 0
            return (
              <div className="res-dispatch-row" key={key}>
                <div style={{ flex: 1 }}>
                  <div className="res-dispatch-sub">
                    <i className="zdot" style={{ background: SEVERITY_COLOR[z.severity] }} />
                    {z.name}
                  </div>
                  <label htmlFor={`dp-${key}`}>Ambulances to dispatch</label>
                </div>
                <input
                  id={`dp-${key}`}
                  type="number"
                  className="input"
                  style={{ width: 70, padding: '4px 8px', fontSize: 13 }}
                  value={val || ''}
                  onChange={(e) =>
                    setPendingDispatch((prev) => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                  placeholder="0"
                />
                <button
                  className="btn btn-sm cy"
                  onClick={() => handleDispatch('ambulances', z.name, val)}
                  disabled={val <= 0}
                >
                  Log
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Dispatch log ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 14 }}>
          <div>
            <h2>Dispatch History</h2>
            <p className="sub">Session-only record of logged resource dispatches.</p>
          </div>
          <span className="badge info">{dispatchLog.length} Logged</span>
        </div>

        {dispatchLog.length === 0 ? (
          <p className="sub" style={{ padding: '12px 0' }}>
            No dispatches logged yet. Use the Quick Dispatch form above.
          </p>
        ) : (
          <div className="scroll">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Resource</th>
                  <th>Zone</th>
                  <th className="r">Units</th>
                </tr>
              </thead>
              <tbody>
                {dispatchLog.map((d) => (
                  <tr key={d.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{d.timestamp}</td>
                    <td>{d.resource.replace('_', ' ')}</td>
                    <td>{d.zone}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>+{d.units}</td>
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

