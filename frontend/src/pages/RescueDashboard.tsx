import { useState, type CSSProperties } from 'react'
import {
  LifeBuoy,
  Navigation,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  X,
  MapPin,
  Zap,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatNumber, severityLabel, SEVERITY_COLOR } from '../utils/format'
import { Spinner } from '../components/ui'

interface Mission {
  id: string
  timestamp: string
  zone: string
  teams: number
  status: 'En Route' | 'Active' | 'Completed'
  note: string
}

const DEMO_MISSIONS_SEED: Mission[] = [
  {
    id: 'm1',
    timestamp: '08:14 AM',
    zone: 'Zone Alpha',
    teams: 4,
    status: 'Active',
    note: 'Search & rescue — structural collapse sector',
  },
  {
    id: 'm2',
    timestamp: '09:02 AM',
    zone: 'Zone Bravo',
    teams: 2,
    status: 'En Route',
    note: 'Flood evacuation — residential sector',
  },
]

export default function RescueDashboard() {
  const { scenario, roadBlock } = useApp()
  const [missions, setMissions] = useState<Mission[]>(DEMO_MISSIONS_SEED)
  const [deployZone, setDeployZone] = useState('')
  const [deployTeams, setDeployTeams] = useState(1)
  const [deployNote, setDeployNote] = useState('')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!scenario) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner label="Loading rescue data…" />
      </div>
    )
  }

  const totalTeams = scenario.resources.rescue_teams
  const activeMissions = missions.filter((m) => m.status !== 'Completed')
  const teamsDeployed = activeMissions.reduce((s, m) => s + m.teams, 0)
  const teamsAvailable = Math.max(0, totalTeams - teamsDeployed)

  const blockedRoads = scenario.roads.filter((r) => r.blocked).length
  const totalRoads = scenario.roads.length

  const criticalZones = scenario.zones.filter((z) => z.severity === 'critical' || z.severity === 'high')
  const totalRescueDemand = scenario.zones.reduce((s, z) => s + z.rescue_demand, 0)

  const handleDeploy = () => {
    if (!deployZone || deployTeams <= 0) return
    const m: Mission = {
      id: `m_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      zone: deployZone,
      teams: deployTeams,
      status: 'En Route',
      note: deployNote || 'Standard rescue deployment',
    }
    setMissions((prev) => [m, ...prev])
    setSuccessMsg(`${deployTeams} rescue team(s) dispatched to ${deployZone}. Status: En Route.`)
    setDeployZone('')
    setDeployTeams(1)
    setDeployNote('')
  }

  const completeMission = (id: string) => {
    setMissions((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'Completed' } : m)))
  }

  return (
    <div className="rsc-page">
      {/* ── Demo banner ── */}
      <div className="rsc-demo-banner">
        <Info size={16} className="rsc-demo-icon" />
        <div style={{ flex: 1 }}>
          <strong>SIMULATION / DEMO DATA</strong> — Pre-seeded demo missions shown. All rescue missions are session-only simulations.
        </div>
      </div>

      {successMsg && (
        <div className="med-alert-success">
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{successMsg}</span>
          <button className="pop-x" onClick={() => setSuccessMsg(null)}><X size={14} /></button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="head">
        <div>
          <div className="sec">Rescue Coordinator Operations</div>
          <h1>Rescue Teams &amp; Mission Control</h1>
          <p className="sub">
            Track rescue team deployments, monitor road accessibility, and manage active missions by zone.
          </p>
        </div>
        <div className="btns">
          {blockedRoads > 0 ? (
            <span className="badge bad"><AlertTriangle size={12} /> {blockedRoads} road(s) blocked</span>
          ) : (
            <span className="badge ok">All roads accessible</span>
          )}
        </div>
      </div>

      {/* ── Top stat cards ── */}
      <div className="rsc-cards-grid">
        <div className="rsc-card" style={{ '--rc3': 'var(--amber)' } as CSSProperties}>
          <div className="rsc-card-icon"><LifeBuoy size={22} /></div>
          <div>
            <div className="rsc-card-val">{formatNumber(totalTeams)}</div>
            <div className="rsc-card-title">Total Rescue Teams</div>
            <div className="rsc-card-sub">In scenario resource pool</div>
          </div>
        </div>

        <div className="rsc-card" style={{ '--rc3': 'var(--ok)' } as CSSProperties}>
          <div className="rsc-card-icon"><Navigation size={22} /></div>
          <div>
            <div className="rsc-card-val">{formatNumber(teamsAvailable)}</div>
            <div className="rsc-card-title">Available Teams</div>
            <div className="rsc-card-sub">{teamsDeployed} currently on active missions</div>
          </div>
        </div>

        <div className="rsc-card" style={{ '--rc3': 'var(--rose)' } as CSSProperties}>
          <div className="rsc-card-icon"><AlertTriangle size={22} /></div>
          <div>
            <div className="rsc-card-val">{criticalZones.length}</div>
            <div className="rsc-card-title">High-Priority Zones</div>
            <div className="rsc-card-sub">Critical or high severity needing rescue</div>
          </div>
        </div>

        <div className="rsc-card" style={{ '--rc3': 'var(--violet)' } as CSSProperties}>
          <div className="rsc-card-icon"><Zap size={22} /></div>
          <div>
            <div className="rsc-card-val">{formatNumber(totalRescueDemand)}</div>
            <div className="rsc-card-title">Total Rescue Demand</div>
            <div className="rsc-card-sub">Across all {scenario.zones.length} active zones</div>
          </div>
        </div>
      </div>

      {/* ── Road & zone status grid ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Zone Road Accessibility &amp; Rescue Demand</h2>
            <p className="sub">
              Road accessibility score and rescue demand per zone. Blocked roads are shown via the scenario road-block
              tool. {roadBlock ? 'Road block state updated.' : ''}
            </p>
          </div>
          <span className="badge info">
            {totalRoads - blockedRoads}/{totalRoads} roads open
          </span>
        </div>
        <div className="rsc-zones-grid">
          {[...scenario.zones]
            .sort((a, b) => b.priority_score - a.priority_score)
            .map((z) => {
              const roadPct = Math.round(z.road_accessibility * 100)
              const isBlocked = scenario.roads.some(
                (r) => r.blocked && (r.source === z.id || r.target === z.id),
              )
              return (
                <div className="rsc-zone-card" key={z.id}>
                  <div className="rsc-zone-header">
                    <div>
                      <span className="rsc-zone-name">
                        <i className="zdot" style={{ background: SEVERITY_COLOR[z.severity] }} />
                        {z.name}
                      </span>
                      <div className="rsc-zone-meta">{severityLabel(z.severity)} severity · Priority {z.priority_score.toFixed(1)}</div>
                    </div>
                    <div className="btns">
                      {isBlocked && <span className="badge bad" style={{ fontSize: 11 }}>Road Blocked</span>}
                      <span
                        className={
                          roadPct >= 70 ? 'badge ok' : roadPct >= 40 ? 'badge info' : 'badge bad'
                        }
                        style={{ fontSize: 11 }}
                      >
                        {roadPct}% access
                      </span>
                    </div>
                  </div>
                  <div className="rsc-progress-bar">
                    <div className="rsc-progress-fill" style={{ width: `${roadPct}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span className="sub">
                      <MapPin size={11} style={{ display: 'inline' }} /> Rescue demand: {formatNumber(z.rescue_demand)}
                    </span>
                    <span className="sub">
                      Population: {formatNumber(z.population)}
                    </span>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* ── Deploy teams form ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 16 }}>
          <div>
            <h2>Deploy Rescue Teams</h2>
            <p className="sub">Create a new rescue mission for a zone. Teams available: <b>{teamsAvailable}</b></p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
          <div>
            <label className="sub" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
              Zone
            </label>
            <select
              className="input"
              value={deployZone}
              onChange={(e) => setDeployZone(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— Select zone —</option>
              {scenario.zones.map((z) => (
                <option key={z.id} value={z.name}>{z.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="sub" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
              Teams to deploy
            </label>
            <input
              type="number"
              className="input"
              value={deployTeams}
              min={1}
              max={teamsAvailable}
              onChange={(e) => setDeployTeams(parseInt(e.target.value) || 1)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="sub" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
              Mission note (optional)
            </label>
            <input
              type="text"
              className="input"
              value={deployNote}
              onChange={(e) => setDeployNote(e.target.value)}
              placeholder="Rescue objective…"
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn cy lg"
            onClick={handleDeploy}
            disabled={!deployZone || deployTeams <= 0 || teamsAvailable <= 0}
          >
            <Navigation size={15} /> Dispatch Teams
          </button>
        </div>
      </div>

      {/* ── Active missions ── */}
      <div className="card">
        <div className="head" style={{ marginBottom: 14 }}>
          <div>
            <h2>Mission Log</h2>
            <p className="sub">Active and completed rescue missions this session.</p>
          </div>
          <span className="badge info">{missions.length} missions</span>
        </div>

        {missions.length === 0 ? (
          <p className="sub" style={{ padding: '12px 0' }}>No missions deployed yet. Use the form above.</p>
        ) : (
          <div className="scroll">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Zone</th>
                  <th className="r">Teams</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      <Clock size={11} style={{ display: 'inline', marginRight: 3 }} />{m.timestamp}
                    </td>
                    <td><b>{m.zone}</b></td>
                    <td className="r mono">{m.teams}</td>
                    <td>
                      <span className={
                        m.status === 'Completed' ? 'badge ok'
                          : m.status === 'Active' ? 'badge bad'
                            : 'badge info'
                      }>
                        {m.status}
                      </span>
                    </td>
                    <td className="sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.note}</td>
                    <td className="r">
                      {m.status !== 'Completed' && (
                        <button className="btn btn-sm" onClick={() => completeMission(m.id)}>
                          <CheckCircle2 size={13} /> Mark Done
                        </button>
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
  )
}

