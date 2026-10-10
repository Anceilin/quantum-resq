import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ArrowLeft, Search, MapPin, CalendarDays, Upload, TriangleAlert } from 'lucide-react'
import { api } from '../services/api'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import ScenarioTabs from '../components/ScenarioTabs'
import { EmptyState, ErrorBanner, Spinner } from '../components/ui'
import { disasterLabel, formatNumber, resourceLabel, severityLabel } from '../utils/format'
import type {
  DisasterType,
  HistoricalRecord,
  HistoricalRecordSummary,
  RecordedAllocationItem,
} from '../types'

const DISASTER_FILTERS: (DisasterType | 'all')[] = [
  'all',
  'cyclone',
  'earthquake',
  'wildfire',
  'accident',
  'flood',
]

export default function HistoricalRecords() {
  const navigate = useNavigate()
  const { loadHistoricalAsScenario, loadingScenario } = useApp()
  const { permissions } = useAuth()
  const canManage = !!permissions?.can_manage_scenarios

  const [summaries, setSummaries] = useState<HistoricalRecordSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<DisasterType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'historical'>('all')

  const [selected, setSelected] = useState<HistoricalRecord | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listHistorical()
      .then(setSummaries)
      .catch((e) => setError((e as Error).message))
  }, [])

  const filtered = useMemo(() => {
    if (!summaries) return []
    const q = query.trim().toLowerCase()
    return summaries.filter((r) => {
      if (typeFilter !== 'all' && r.disaster_type !== typeFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        disasterLabel(r.disaster_type).toLowerCase().includes(q)
      )
    })
  }, [summaries, query, typeFilter, statusFilter])

  const openDetail = async (id: string) => {
    setDetailError(null)
    setError(null)
    try {
      const rec = await api.getHistorical(id)
      setSelected(rec)
    } catch (e) {
      setDetailError((e as Error).message)
    }
  }

  const doLoad = async (id: string) => {
    setError(null)
    const s = await loadHistoricalAsScenario(id)
    if (s) navigate('/scenarios')
  }

  if (selected) {
    return (
      <div className="page">
        <ScenarioTabs
          view="historical"
          onTab={(v) => navigate(v === 'whatif' ? '/scenarios?tab=what-if' : '/scenarios')}
        />
        <Detail
          record={selected}
          loading={loadingScenario}
          canManage={canManage}
          onBack={() => setSelected(null)}
          onLoad={() => doLoad(selected.id)}
        />
        {detailError && <ErrorBanner message={detailError} onDismiss={() => setDetailError(null)} />}
      </div>
    )
  }

  return (
    <div className="page">
      <ScenarioTabs
        view="historical"
        onTab={(v) => navigate(v === 'whatif' ? '/scenarios?tab=what-if' : '/scenarios')}
      />

      <div className="head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Archive size={22} color="var(--violet)" /> Historical Records
          </h1>
          <p>
            A read-only archive of PAST, completed disaster responses. These are fixed SIMULATION / DEMO records — not
            live operations and not optimizer output. Load one as a new scenario to modify its conditions and re-run the
            real classical + QAOA pipeline against the recorded allocation.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Filters / search */}
      <div className="card">
        <div className="head" style={{ marginBottom: 0, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or location…"
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DisasterType | 'all')} style={{ width: 'auto' }}>
            {DISASTER_FILTERS.map((d) => (
              <option key={d} value={d}>
                {d === 'all' ? 'All disaster types' : disasterLabel(d)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed' | 'historical')}
            style={{ width: 'auto' }}
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="historical">Historical</option>
          </select>
        </div>
      </div>

      {!summaries ? (
        <div style={{ padding: 24 }}>
          <Spinner label="Loading archive…" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No historical records match your filters." />
      ) : (
        <div className="g4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
          {filtered.map((r) => (
            <button
              key={r.id}
              className="card hist-card animate-in"
              onClick={() => openDetail(r.id)}
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--card2)' }}
            >
              <div className="head" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>{r.name}</b>
                <StatusTag status={r.status} />
              </div>
              <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={12} /> {r.location}
              </div>
              <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <CalendarDays size={12} /> {r.date} · {disasterLabel(r.disaster_type)}
              </div>
              <div className="hist-grid">
                <Stat label="Zones" value={String(r.num_zones)} />
                <Stat label="Affected" value={formatNumber(r.affected_people)} />
                <Stat label="Recorded alloc" value={formatNumber(r.resources_allocated)} />
                <Stat label="Available" value={formatNumber(r.resources_available)} />
                <Stat label="Road blocks" value={String(r.road_blockages)} tone={r.road_blockages > 0 ? 'warn' : undefined} />
                <Stat label="Hosp beds free" value={formatNumber(r.hospital_beds_free)} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Detail({
  record,
  loading,
  canManage,
  onBack,
  onLoad,
}: {
  record: HistoricalRecord
  loading: boolean
  canManage: boolean
  onBack: () => void
  onLoad: () => void
}) {
  const s = record.scenario
  const blockedRoads = s.roads.filter((r) => r.blocked)
  const totalPop = s.zones.reduce((a, z) => a + z.population, 0)
  const hospFree = s.zones.reduce((a, z) => a + Math.max(0, z.hospital_capacity - z.hospital_occupancy), 0)
  const shelterFree = s.zones.reduce((a, z) => a + Math.max(0, z.shelter_capacity - z.shelter_occupancy), 0)

  const allocByResource = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of record.recorded_allocation) m[a.resource] = (m[a.resource] ?? 0) + a.units
    return m
  }, [record])

  return (
    <>
      <div className="head">
        <button className="btn" onClick={onBack}>
          <ArrowLeft size={15} /> Back to archive
        </button>
      </div>

      <div className="card animate-in">
        <div className="head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>{record.name}</h1>
              <StatusTag status={record.status} />
            </div>
            <p className="sub" style={{ marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={13} /> {record.location}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CalendarDays size={13} /> {record.date}
              </span>
              <span>{disasterLabel(record.disaster_type)}</span>
            </p>
          </div>
          <div className="btns">
            {canManage ? (
              <button className="btn vi" onClick={onLoad} disabled={loading} title="Copy conditions into a new editable scenario">
                {loading ? <Spinner /> : <Upload size={15} />} Load as new scenario
              </button>
            ) : (
              <span className="sub" style={{ maxWidth: 220, textAlign: 'right' }}>
                Loading a record as a scenario requires the Disaster Management Officer role.
              </span>
            )}
          </div>
        </div>
        <p style={{ marginTop: 8, color: 'var(--muted2)', fontSize: 13 }}>{record.description}</p>
        <div className="notice" style={{ marginTop: 12 }}>
          <TriangleAlert size={14} style={{ verticalAlign: -2 }} /> This is a fixed SIMULATION / DEMO archive entry. Its
          recorded allocation is historical response data, NOT classical or QAOA optimizer output. Re-optimization always
          runs the real pipeline on a copy.
        </div>
      </div>

      {/* Summary metrics */}
      <div className="g4">
        <BigStat label="Affected people" value={formatNumber(totalPop)} />
        <BigStat label="Zones" value={String(s.zones.length)} />
        <BigStat label="Road blockages" value={String(blockedRoads.length)} tone={blockedRoads.length ? 'warn' : 'ok'} />
        <BigStat label="Recorded allocation" value={formatNumber(record.recorded_allocation.reduce((a, x) => a + x.units, 0))} />
        <BigStat label="Hospital beds free" value={formatNumber(hospFree)} />
        <BigStat label="Shelter beds free" value={formatNumber(shelterFree)} />
        <BigStat label="Budget" value={`$${formatNumber(s.budget)}`} />
        <BigStat label="Resources available" value={formatNumber(Object.values(s.resources).reduce((a, b) => a + b, 0))} />
      </div>

      <div className="split">
        {/* Zones — original conditions */}
        <div className="card">
          <div className="sec">Original conditions · Zones</div>
          <div className="scroll">
            <table className="qtable" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Severity</th>
                  <th style={{ textAlign: 'right' }}>Population</th>
                  <th style={{ textAlign: 'right' }}>Med</th>
                  <th style={{ textAlign: 'right' }}>Food</th>
                  <th style={{ textAlign: 'right' }}>Rescue</th>
                  <th style={{ textAlign: 'right' }}>Hosp free</th>
                  <th style={{ textAlign: 'right' }}>Shelter free</th>
                </tr>
              </thead>
              <tbody>
                {s.zones.map((z) => (
                  <tr key={z.id}>
                    <td>
                      <b>{z.name}</b>
                      <div className="sub">P{z.priority_score.toFixed(0)}</div>
                    </td>
                    <td>
                      <span className="badge info">{severityLabel(z.severity)}</span>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(z.population)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(z.medical_demand)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(z.food_demand)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(z.rescue_demand)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(Math.max(0, z.hospital_capacity - z.hospital_occupancy))}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatNumber(Math.max(0, z.shelter_capacity - z.shelter_occupancy))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resources + roads */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="sec">Resources available</div>
            <div className="row first">
              <span>Resource</span>
              <span>Available · Recorded</span>
            </div>
            {Object.entries(s.resources).map(([k, v]) => (
              <div className="row" key={k}>
                <span>{resourceLabel(k)}</span>
                <b className="mono">
                  {formatNumber(v)} <span style={{ color: 'var(--muted)' }}>·</span>{' '}
                  <span style={{ color: 'var(--violet)' }}>{formatNumber(allocByResource[k] ?? 0)}</span>
                </b>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="sec">Road network</div>
            {blockedRoads.length === 0 ? (
              <p className="sub" style={{ color: 'var(--ok)' }}>All routes open at the time of this record.</p>
            ) : (
              <div className="scroll" style={{ maxHeight: 200 }}>
                {blockedRoads.map((r) => (
                  <div className="row" key={r.id}>
                    <span>
                      {nameOf(s, r.source)} → {nameOf(s, r.target)}
                    </span>
                    <span className="badge bad">BLOCKED · {r.distance_km} km</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recorded allocation */}
      <div className="card">
        <div className="head" style={{ marginBottom: 10 }}>
          <div className="sec" style={{ margin: 0 }}>Final recorded allocation</div>
          <span className="badge info">Archived DEMO data</span>
        </div>
        <div className="scroll">
          <table className="qtable" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Zone</th>
                <th style={{ textAlign: 'right' }}>Units deployed</th>
              </tr>
            </thead>
            <tbody>
              {[...record.recorded_allocation]
                .sort((a, b) => a.resource_label.localeCompare(b.resource_label) || a.zone_name.localeCompare(b.zone_name))
                .map((a, i) => (
                  <AllocRow key={`${a.resource}-${a.zone_id}-${i}`} a={a} />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function AllocRow({ a }: { a: RecordedAllocationItem }) {
  return (
    <tr>
      <td>{a.resource_label || resourceLabel(a.resource)}</td>
      <td>{a.zone_name}</td>
      <td className="mono" style={{ textAlign: 'right', color: 'var(--violet)', fontWeight: 600 }}>
        {formatNumber(a.units)}
      </td>
    </tr>
  )
}

function nameOf(s: HistoricalRecord['scenario'], id: string): string {
  if (id === 'DEPOT') return 'Depot'
  return s.zones.find((z) => z.id === id)?.name ?? id
}

function StatusTag({ status }: { status: 'completed' | 'historical' }) {
  return (
    <span className={status === 'completed' ? 'badge' : 'badge info'}>
      {status === 'completed' ? 'COMPLETED' : 'HISTORICAL'}
    </span>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card)', padding: '8px 10px' }}>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: tone === 'warn' ? 'var(--warn)' : 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

function BigStat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'ok' }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--ink)'
  return (
    <div className="card" style={{ background: 'var(--card2)' }}>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2, color }}>{value}</div>
    </div>
  )
}
