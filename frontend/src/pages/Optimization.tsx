import { useState } from 'react'
import { Play, Atom, Cpu, GitCompareArrows } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Spinner } from '../components/ui'
import ComparisonCharts from '../components/ComparisonCharts'
import AllocationPanel from '../components/AllocationPanel'
import ReoptPanel from '../components/ReoptPanel'
import HistoricalComparison from '../components/HistoricalComparison'
import { RESOURCE_LABEL } from '../utils/format'

const ALL_RESOURCES = [
  'ambulances',
  'rescue_teams',
  'medical_kits',
  'food_units',
  'shelter_capacity',
  'emergency_vehicles',
]
const OPTIMIZERS = ['COBYLA', 'Powell', 'Nelder-Mead']

export default function Optimization() {
  const { scenario, compare, reopt, config, setConfig, runCompare, optimizing, dirty, historicalBaseline } = useApp()
  const [tab, setTab] = useState<'classical' | 'qaoa'>('classical')

  if (!scenario)
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No scenario loaded.</div>

  const toggleResource = (r: string) => {
    const has = config.resources.includes(r)
    if (has && config.resources.length === 1) return
    setConfig({ resources: has ? config.resources.filter((x) => x !== r) : [...config.resources, r] })
  }

  const qubitEstimate = config.zones_count * config.resources.length
  const instanceZones = [...scenario.zones]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, config.zones_count)
    .map((z) => z.name)

  const activeSol =
    tab === 'qaoa'
      ? compare?.qaoa.status === 'success'
        ? compare.qaoa.solution
        : null
      : compare?.classical.solution

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Optimization</h1>
          <p>Classical baseline and quantum-assisted QAOA solve the identical small binary instance.</p>
        </div>
        <button className="btn cy" onClick={runCompare} disabled={optimizing}>
          {optimizing ? <Spinner /> : <GitCompareArrows size={15} />}
          RUN OPTIMIZATION
        </button>
      </div>

      {reopt && <ReoptPanel reopt={reopt} />}

      <div className="split">
        {/* ---- Config ---- */}
        <div className="card form">
          <div className="sec" style={{ margin: 0 }}>Instance &amp; QAOA configuration</div>

          <div>
            <label htmlFor="z" style={{ fontWeight: 600 }}>
              Zones in quantum instance: {config.zones_count}
            </label>
            <input
              id="z"
              type="range"
              min={2}
              max={6}
              value={config.zones_count}
              onChange={(e) => setConfig({ zones_count: Number(e.target.value) })}
              style={{ marginTop: 8 }}
            />
            <div className="sub">Top {config.zones_count} by priority: {instanceZones.join(', ')}</div>
          </div>

          <div>
            <b>Resources (binary decisions)</b>
            <div className="checks" style={{ marginTop: 8 }}>
              {ALL_RESOURCES.map((r) => (
                <label key={r}>
                  <input
                    type="checkbox"
                    checked={config.resources.includes(r)}
                    onChange={() => toggleResource(r)}
                  />
                  {RESOURCE_LABEL[r]}
                </label>
              ))}
            </div>
          </div>

          <div className="even">
            <div>
              <label htmlFor="p" style={{ fontWeight: 600 }}>QAOA layers (p)</label>
              <input
                id="p"
                type="number"
                min={1}
                max={5}
                value={config.reps}
                onChange={(e) => setConfig({ reps: Number(e.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="s" style={{ fontWeight: 600 }}>Shots</label>
              <input
                id="s"
                type="number"
                min={64}
                max={8192}
                step={64}
                value={config.shots}
                onChange={(e) => setConfig({ shots: Number(e.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="o" style={{ fontWeight: 600 }}>Optimizer</label>
              <select id="o" value={config.optimizer} onChange={(e) => setConfig({ optimizer: e.target.value })}>
                {OPTIMIZERS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="m" style={{ fontWeight: 600 }}>Max iter</label>
              <input
                id="m"
                type="number"
                min={5}
                max={500}
                value={config.maxiter}
                onChange={(e) => setConfig({ maxiter: Number(e.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="seed" style={{ fontWeight: 600 }}>Seed</label>
              <input
                id="seed"
                type="number"
                value={config.seed ?? 0}
                onChange={(e) => setConfig({ seed: Number(e.target.value) })}
              />
            </div>
          </div>

          <div
            style={{
              border: '1px solid color-mix(in srgb, var(--violet) 35%, transparent)',
              background: 'color-mix(in srgb, var(--violet) 6%, transparent)',
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--violet)', marginBottom: 6 }}>
              <Atom size={14} /> Small QAOA instance
            </div>
            <div className="mono" style={{ color: 'var(--muted2)' }}>
              {config.zones_count} zones × {config.resources.length} resources ={' '}
              <span style={{ color: 'var(--violet)' }}>{qubitEstimate} qubits</span> (+ slack)
            </div>
            {qubitEstimate > 16 && <div className="sub" style={{ color: 'var(--amber)', marginTop: 4 }}>Large — simulation may be slow. Consider fewer zones/resources.</div>}
          </div>
        </div>

        {/* ---- Latest result ---- */}
        {!compare ? (
          <div className="card" style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
            <p style={{ textAlign: 'center', padding: 20 }}>
              Configure the instance and run the optimization to see classical vs QAOA results.
            </p>
          </div>
        ) : (
          <div className="card">
            <div className="head">
              <h2>Latest result</h2>
              <span className={compare.comparison.winner === 'qaoa' ? 'badge' : 'badge info'}>
                {compare.comparison.winner === 'tie'
                  ? 'Tie'
                  : compare.comparison.winner === 'classical'
                    ? 'Classical wins'
                    : 'QAOA wins'}
              </span>
            </div>
            <p className="sub" style={{ margin: '4px 0 8px' }}>
              {compare.comparison.verdict}
            </p>
            <div className="row first">
              <span>Classical objective</span>
              <b className="mono">{compare.comparison.classical.objective_value.toFixed(4)}</b>
            </div>
            <div className="row">
              <span>QAOA objective</span>
              <b className="mono">
                {compare.qaoa.status === 'success' ? compare.comparison.qaoa.objective_value.toFixed(4) : 'failed'}
              </b>
            </div>
            <div className="row">
              <span>Classical time</span>
              <b className="mono">{compare.comparison.classical.execution_time_ms.toFixed(0)} ms</b>
            </div>
            <div className="row">
              <span>QAOA time</span>
              <b className="mono">
                {compare.qaoa.status === 'success'
                  ? `${(compare.comparison.qaoa.execution_time_ms / 1000).toFixed(2)} s`
                  : '—'}
              </b>
            </div>
            {compare.comparison.identical_solution && (
              <div className="row">
                <span>Identical solution</span>
                <span className="badge info">Yes</span>
              </div>
            )}
          </div>
        )}
      </div>

      {compare && (
        <>
          <ComparisonCharts comparison={compare.comparison} />

          <div className="card">
            <div className="head" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className={tab === 'classical' ? 'btn cy' : 'btn'} onClick={() => setTab('classical')}>
                  <Cpu size={15} /> Classical Baseline
                </button>
                <button className={tab === 'qaoa' ? 'btn vi' : 'btn'} onClick={() => setTab('qaoa')}>
                  <Atom size={15} /> Quantum-Assisted QAOA
                </button>
              </div>
              {tab === 'qaoa' ? (
                compare.qaoa.status !== 'success' ? (
                  <span className="badge bad">Failed</span>
                ) : compare.qaoa.found_feasible ? (
                  <span className="badge">Feasible</span>
                ) : (
                  <span className="badge bad">Infeasible</span>
                )
              ) : (
                <span className={compare.classical.solution.feasible ? 'badge' : 'badge bad'}>
                  {compare.classical.solution.feasible ? 'Feasible' : 'Infeasible'}
                </span>
              )}
            </div>

            {tab === 'qaoa' && compare.qaoa.status !== 'success' ? (
              <div
                className="card"
                style={{ borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)', boxShadow: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--warn)' }}>
                  <Play size={15} /> QAOA execution failed
                </div>
                <p className="mono" style={{ fontSize: 12, color: 'var(--muted2)', wordBreak: 'break-all', marginTop: 8 }}>
                  {compare.qaoa.error}
                </p>
                <p className="sub" style={{ marginTop: 8 }}>
                  The classical baseline is shown for usability, but the quantum result was NOT substituted — this
                  failure is reported honestly.
                </p>
              </div>
            ) : activeSol ? (
              <AllocationPanel solution={activeSol} scenario={scenario} />
            ) : (
              <p className="sub">No solution available.</p>
            )}
          </div>
        </>
      )}

      {historicalBaseline && compare && (
        <HistoricalComparison baseline={historicalBaseline} compare={compare} />
      )}

      {dirty && compare && (
        <div
          className="card"
          style={{ borderColor: 'rgba(232,194,122,.3)', background: 'rgba(232,194,122,.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <span style={{ color: 'var(--amber)' }}>
            The scenario changed since this result. Re-run to reflect the new constraints.
          </span>
          <button className="btn cy" onClick={runCompare} disabled={optimizing}>
            {optimizing ? <Spinner /> : <Play size={15} />} Re-run
          </button>
        </div>
      )}
    </div>
  )
}
