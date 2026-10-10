import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play, Plus, Presentation, RotateCcw, Save, TriangleAlert } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useDemo } from '../hooks/useDemo'
import { api } from '../services/api'
import ScenarioTabs from '../components/ScenarioTabs'
import { EmptyState, Spinner } from '../components/ui'
import { RESOURCE_LABEL, disasterLabel, formatNumber, severityLabel } from '../utils/format'
import type { DisasterType, Resources, ScenarioSummary, ScenarioUpdate, SeverityLevel, ZoneUpdate } from '../types'

const RESOURCE_KEYS = [
  'ambulances',
  'rescue_teams',
  'medical_kits',
  'food_units',
  'shelter_capacity',
  'emergency_vehicles',
] as const

const PRESETS = [
  { key: 'normal', label: 'Normal Disaster', desc: 'Baseline simulated flood scenario.' },
  { key: 'major_road_block', label: 'Major Road Block', desc: 'Primary routes to the top-2 priority zones are cut.' },
  { key: 'resource_shortage', label: '30% Resource Shortage', desc: 'Every resource pool reduced to 70%.' },
  { key: 'hospital_capacity_reduced', label: 'Hospital Capacity Reduced', desc: 'All hospital capacity halved.' },
  { key: 'new_critical_zone', label: 'New Critical Zone', desc: 'A new high-population critical zone appears.' },
]

const SEVERITIES: SeverityLevel[] = ['critical', 'high', 'moderate', 'low']
const DISASTER_TYPES: DisasterType[] = ['flood', 'cyclone', 'earthquake', 'wildfire', 'accident']

export default function Scenarios() {
  const { scenario, compare, applyPreset, updateScenario, reoptimize, loadScenario, optimizing, dirty, loadingScenario, demoRunning } =
    useApp()
  const { permissions } = useAuth()
  const { run: runDemo } = useDemo()
  const canRunDemo = !!permissions?.can_block_roads

  const [resDraft, setResDraft] = useState<Resources | null>(null)
  const [budgetDraft, setBudgetDraft] = useState<number>(0)
  const [zoneDrafts, setZoneDrafts] = useState<Record<string, ZoneUpdate>>({})

  const [summaries, setSummaries] = useState<ScenarioSummary[]>([])
  const [showCreate, setShowCreate] = useState(false)

  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'active' | 'whatif'>(
    searchParams.get('tab') === 'what-if' ? 'whatif' : 'active',
  )

  const canManage = !!permissions?.can_manage_scenarios
  const editableResources = useMemo(() => new Set(permissions?.can_edit_resources ?? []), [permissions])
  const editableZoneFields = useMemo(() => new Set(permissions?.can_edit_zone_fields ?? []), [permissions])

  useEffect(() => {
    api.listScenarios().then(setSummaries).catch(() => setSummaries([]))
  }, [])

  useEffect(() => {
    if (scenario) {
      setResDraft({ ...scenario.resources })
      setBudgetDraft(scenario.budget)
      setZoneDrafts({})
    }
  }, [scenario?.id, scenario?.resources, scenario?.budget])

  const utilization = useMemo(() => {
    const u = compare?.classical.solution.metrics.resource_utilization ?? {}
    return u as Record<string, { units_used: number; available_units: number; utilization_pct: number }>
  }, [compare])

  if (!scenario || !resDraft) return <EmptyState message="No scenario loaded." />

  const resChanged =
    RESOURCE_KEYS.some((k) => editableResources.has(k) && resDraft[k] !== scenario.resources[k]) ||
    (canManage && budgetDraft !== scenario.budget)

  const applyResources = async () => {
    const patch: Partial<Resources> = {}
    for (const k of RESOURCE_KEYS)
      if (editableResources.has(k) && resDraft[k] !== scenario!.resources[k]) patch[k] = resDraft[k]
    const body: ScenarioUpdate = {}
    if (Object.keys(patch).length) body.resources = patch
    if (canManage && budgetDraft !== scenario.budget) body.budget = budgetDraft
    await updateScenario(body)
  }

  const applyZone = async (id: string) => {
    const draft = zoneDrafts[id]
    if (!draft) return
    const picked: Record<string, unknown> = { id }
    for (const [f, v] of Object.entries(draft)) {
      if (f !== 'id' && editableZoneFields.has(f)) picked[f] = v
    }
    if (Object.keys(picked).length <= 1) return
    await updateScenario({ zone_updates: [picked as unknown as ZoneUpdate] })
    setZoneDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const setZoneField = (id: string, field: keyof ZoneUpdate, value: number | SeverityLevel) => {
    if (!editableZoneFields.has(field)) return
    setZoneDrafts((prev) => ({ ...prev, [id]: { ...prev[id], id, [field]: value } as ZoneUpdate }))
  }

  const onCreated = async (createdId: string) => {
    setShowCreate(false)
    await loadScenario(createdId)
    const list = await api.listScenarios().catch(() => summaries)
    setSummaries(list)
  }

  const zoneFieldEditable = (f: keyof ZoneUpdate) => editableZoneFields.has(f)
  const zoneHasDraft = (id: string) => {
    const d = zoneDrafts[id]
    return !!d && Object.keys(d).some((k) => k !== 'id')
  }

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Scenarios &amp; What-If</h1>
          <p>Create, load and edit scenarios. Role permissions decide which fields each coordinator may edit.</p>
        </div>
        <div className="btns">
          {optimizing && <Spinner />}
          {canManage && (
            <button className="btn" onClick={() => applyPreset('normal', false)} disabled={optimizing || loadingScenario}>
              <RotateCcw size={15} /> Reset
            </button>
          )}
          {canManage && (
            <button className="btn cy" onClick={() => setShowCreate(true)} disabled={loadingScenario}>
              <Plus size={15} /> NEW SCENARIO
            </button>
          )}
          <button
            className="btn cy"
            onClick={async () => {
              await reoptimize()
            }}
            disabled={optimizing || !dirty}
            title={dirty ? 'Re-run optimization on the edited scenario' : 'No pending changes'}
          >
            <Play size={15} /> RE-OPTIMIZE
          </button>
        </div>
      </div>

      <ScenarioTabs view={tab} onTab={setTab} />

      {/* Optional automated walkthrough — presentation mode, off the operational header */}
      {tab === 'whatif' && canRunDemo && (
        <div className="card">
          <div className="head" style={{ marginBottom: 0 }}>
            <div>
              <div className="sec" style={{ margin: 0 }}>Demo / Presentation Mode</div>
              <p className="sub" style={{ marginTop: 6, maxWidth: 640 }}>
                Optional automated ~3-minute walkthrough of the full pipeline against the demo scenario:
                Scenario → Map → Optimization → QAOA → Results → Re-Optimize. Every step runs real backend
                operations; nothing is faked. Not part of the normal operational flow.
              </p>
            </div>
            <div className="btns">
              <button
                className="btn vi"
                onClick={runDemo}
                disabled={demoRunning || optimizing || loadingScenario || !scenario}
                title="Automated ~3-minute walkthrough of the full pipeline"
              >
                {demoRunning ? <Spinner /> : <Presentation size={15} />}
                {demoRunning ? 'DEMO RUNNING' : 'RUN PRESENTATION DEMO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scenario manager: load / switch */}
      {tab === 'active' && (
      <div className="card">
        <div className="sec">Scenario library</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <label className="label" style={{ margin: 0 }}>Load scenario</label>
          <select
            style={{ width: 'auto' }}
            value={scenario.id}
            onChange={(e) => loadScenario(e.target.value)}
            disabled={loadingScenario}
          >
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {disasterLabel(s.disaster_type)} · {s.num_zones} zones
                {s.is_demo ? ' (demo)' : ''}
              </option>
            ))}
          </select>
          {!canManage && (
            <span className="sub">
              Creating or resetting scenarios requires the Disaster Management Officer role. You can edit the fields
              your role owns and re-optimize.
            </span>
          )}
        </div>
        <div className="g4" style={{ marginTop: 14 }}>
          <Metric label="Disaster" value={disasterLabel(scenario.disaster_type)} />
          <Metric label="Affected People" value={formatNumber(scenario.zones.reduce((a, z) => a + z.population, 0))} />
          <Metric label="Zones" value={String(scenario.zones.length)} />
          <Metric label="Budget" value={`$${formatNumber(scenario.budget)}`} />
        </div>
      </div>
      )}

      {/* Presets (DMO only — they create new scenarios) */}
      {tab === 'whatif' && canManage && (
        <div className="card">
          <div className="sec">What-If presets</div>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className="preset"
                onClick={() => applyPreset(p.key, true)}
                disabled={optimizing || loadingScenario}
              >
                <b>{p.label}</b>
                <span>{p.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Resource pool — editable only by roles that own resource quantities */}
      {tab === 'active' && (
      <>
      <div className="card">
        <div className="head" style={{ marginBottom: 12 }}>
          <div className="sec" style={{ margin: 0 }}>Resource pool</div>
          <div className="btns">
            {editableResources.size === 0 && <span className="sub">Your role cannot edit resource quantities.</span>}
            {resChanged && (
              <button className="btn cy" onClick={applyResources} disabled={optimizing}>
                <Save size={15} /> Apply changes
              </button>
            )}
          </div>
        </div>
        <div className="g4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {RESOURCE_KEYS.map((k) => {
            const u = utilization[k]
            const allocated = u?.units_used ?? 0
            const available = resDraft[k]
            const remaining = Math.max(0, available - allocated)
            const editable = editableResources.has(k)
            return (
              <div
                key={k}
                style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--card2)', padding: 12 }}
              >
                <div className="head" style={{ marginBottom: 6 }}>
                  <b style={{ fontSize: 13 }}>{RESOURCE_LABEL[k]}</b>
                  {resDraft[k] < scenario.resources[k] && <span className="badge bad">shortage</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(scenario.resources[k], 1) * 2}
                    value={resDraft[k]}
                    onChange={(e) => setResDraft((d) => (d ? { ...d, [k]: Number(e.target.value) } : d))}
                    disabled={!editable}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={0}
                    value={resDraft[k]}
                    onChange={(e) => setResDraft((d) => (d ? { ...d, [k]: Math.max(0, Number(e.target.value)) } : d))}
                    disabled={!editable}
                    style={{ width: 78, textAlign: 'center', padding: '6px 8px' }}
                  />
                </div>
                <div className="legend" style={{ marginTop: 8 }}>
                  <span>Avail <b>{formatNumber(available)}</b></span>
                  <span>Alloc <b style={{ color: 'var(--accent)' }}>{formatNumber(allocated)}</b></span>
                  <span>Left <b>{formatNumber(remaining)}</b></span>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <label className="label" style={{ margin: 0, width: 90 }}>Budget ($)</label>
          <input
            type="number"
            min={1}
            value={budgetDraft}
            onChange={(e) => setBudgetDraft(Math.max(1, Number(e.target.value)))}
            disabled={!canManage}
            style={{ width: 160 }}
          />
          <span className="sub">
            {canManage
              ? 'Lowering the budget constrains how many bundles the optimizer can deploy.'
              : 'Budget is editable by the Disaster Management Officer.'}
          </span>
        </div>
      </div>

      {/* Zone editor — each field gated by role */}
      <div className="card">
        <div className="sec">Affected zones</div>
        <div className="scroll">
          <table className="qtable" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Severity</th>
                <th>Population</th>
                <th>Medical</th>
                <th>Rescue</th>
                <th>Hosp. cap</th>
                <th>Shelter cap</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.zones.map((z) => {
                const d = zoneDrafts[z.id] ?? {}
                const val = (f: keyof ZoneUpdate, fallback: number | string) =>
                  (d[f] as number | string | undefined) ?? fallback
                return (
                  <tr key={z.id}>
                    <td>
                      <b>{z.name}</b>
                      <div className="sub">P{z.priority_score.toFixed(0)}</div>
                    </td>
                    <td>
                      <select
                        style={{ padding: '6px 8px', fontSize: 12 }}
                        value={val('severity', z.severity) as string}
                        onChange={(e) => setZoneField(z.id, 'severity', e.target.value as SeverityLevel)}
                        disabled={!zoneFieldEditable('severity')}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {severityLabel(s)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <NumCell value={val('population', z.population) as number} editable={zoneFieldEditable('population')} onChange={(v) => setZoneField(z.id, 'population', v)} />
                    <NumCell value={val('medical_demand', z.medical_demand) as number} editable={zoneFieldEditable('medical_demand')} onChange={(v) => setZoneField(z.id, 'medical_demand', v)} />
                    <NumCell value={val('rescue_demand', z.rescue_demand) as number} editable={zoneFieldEditable('rescue_demand')} onChange={(v) => setZoneField(z.id, 'rescue_demand', v)} />
                    <NumCell value={val('hospital_capacity', z.hospital_capacity) as number} editable={zoneFieldEditable('hospital_capacity')} onChange={(v) => setZoneField(z.id, 'hospital_capacity', v)} />
                    <NumCell value={val('shelter_capacity', z.shelter_capacity) as number} editable={zoneFieldEditable('shelter_capacity')} onChange={(v) => setZoneField(z.id, 'shelter_capacity', v)} />
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn"
                        style={{ padding: '5px 9px' }}
                        onClick={() => applyZone(z.id)}
                        disabled={!zoneHasDraft(z.id) || optimizing}
                      >
                        <Save size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="notice" style={{ marginTop: 12 }}>
          <TriangleAlert size={14} style={{ verticalAlign: -2 }} /> Edits recompute priority scores and accessibility on
          the backend. Greyed-out cells are fields your role may not edit. Press RE-OPTIMIZE to run the classical + QAOA
          pipeline against the edited scenario. All data is SIMULATION / DEMO.
        </div>
      </div>
      </>
      )}

      {showCreate && <CreateScenarioModal onClose={() => setShowCreate(false)} onCreated={onCreated} />}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--card2)', padding: '10px 12px' }}>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function NumCell({
  value,
  onChange,
  editable = true,
}: {
  value: number
  onChange: (v: number) => void
  editable?: boolean
}) {
  return (
    <td>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        disabled={!editable}
        style={{ width: 92, padding: '6px 8px', fontSize: 12 }}
      />
    </td>
  )
}

function CreateScenarioModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('New Emergency Scenario')
  const [disaster, setDisaster] = useState<DisasterType>('flood')
  const [budget, setBudget] = useState(45000)
  const [res, setRes] = useState<Resources>({
    ambulances: 10,
    rescue_teams: 8,
    medical_kits: 600,
    food_units: 3500,
    shelter_capacity: 1500,
    emergency_vehicles: 6,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const s = await api.createScenario({
        name,
        disaster_type: disaster,
        budget,
        resources: res,
      } as Partial<import('../types').Scenario>)
      await onCreated(s.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg card-pad" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title mb-3">Create scenario</div>
        <p className="mb-3 text-[11px] text-slate-400">
          Zones, hospitals and shelters are seeded from the simulated base template and become editable
          (per your role) after creation. All data is SIMULATION / DEMO.
        </p>
        {error && (
          <div className="mb-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        <div className="space-y-3">
          <div>
            <label className="label">Scenario name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Disaster type</label>
              <select className="input" value={disaster} onChange={(e) => setDisaster(e.target.value as DisasterType)}>
                {DISASTER_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {disasterLabel(d)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Budget ($)</label>
              <input
                type="number"
                min={1}
                className="input"
                value={budget}
                onChange={(e) => setBudget(Math.max(1, Number(e.target.value)))}
              />
            </div>
          </div>
          <div>
            <span className="label">Resource pool</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RESOURCE_KEYS.map((k) => (
                <div key={k}>
                  <label className="text-[10px] text-slate-400">{RESOURCE_LABEL[k]}</label>
                  <input
                    type="number"
                    min={0}
                    className="input px-2 py-1 text-xs"
                    value={res[k]}
                    onChange={(e) => setRes((r) => ({ ...r, [k]: Math.max(0, Number(e.target.value)) }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Plus className="h-4 w-4" />} CREATE
          </button>
        </div>
      </div>
    </div>
  )
}
