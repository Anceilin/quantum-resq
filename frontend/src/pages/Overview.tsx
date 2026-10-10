import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Map,
  Zap,
  BarChart2,
  Users,
  Package,
  TrendingUp,
  Target,
  Cpu,
  CheckCircle2,
  Clock,
  ArrowRight,
  AlertTriangle,
  Activity,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { formatNumber, formatPct, formatMs, disasterLabel } from '../utils/format'
import type { Solution } from '../types'
import { Spinner } from '../components/ui'

/* ── helpers ─────────────────────────────────────────────────── */
function activeSolution(compare: ReturnType<typeof useApp>['compare']): Solution | null {
  if (!compare) return null
  const q = compare.qaoa
  if (q.status === 'success' && q.solution) return q.solution
  return compare.classical.solution ?? null
}

function buildExecutiveSummary(
  scenario: NonNullable<ReturnType<typeof useApp>['scenario']>,
  sol: Solution | null,
): string[] {
  const m = sol?.metrics
  const lines: string[] = []

  const topZone = [...scenario.zones].sort((a, b) => b.priority_score - a.priority_score)[0]

  if (m) {
    lines.push(
      `Current allocation covers ${formatPct(m.demand_satisfied_pct)} of total demand across ${scenario.zones.length} zones.`,
    )
    lines.push(`Priority coverage reaches ${formatPct(m.priority_coverage_pct)}.`)
  } else {
    lines.push(
      `Scenario loaded with ${scenario.zones.length} active zones and ${formatNumber(scenario.zones.reduce((s, z) => s + z.population, 0))} affected citizens.`,
    )
    lines.push('No optimization has been run yet — results will appear after running the pipeline.')
  }

  if (topZone) {
    lines.push(`${topZone.name} remains the highest-priority zone (score ${topZone.priority_score.toFixed(0)}/100).`)
  }

  const criticalZones = scenario.zones.filter((z) => z.severity === 'critical')
  if (criticalZones.length > 0) {
    lines.push(
      `${criticalZones.length} zone${criticalZones.length > 1 ? 's are' : ' is'} at critical severity — immediate resource allocation is recommended.`,
    )
  }

  if (m && m.unserved_demand > 0) {
    lines.push(
      `${formatNumber(m.unserved_demand)} units of demand remain unmet. Redirecting available capacity toward high-priority populations will improve overall impact.`,
    )
  } else if (m) {
    lines.push('All demand has been fully met under the current allocation plan.')
  }

  const blockedRoads = scenario.roads.filter((r) => r.blocked).length
  if (blockedRoads > 0) {
    lines.push(`${blockedRoads} road${blockedRoads > 1 ? 's are' : ' is'} currently blocked — route accessibility may be limited.`)
  }

  return lines
}

/* ── severity dot ───────────────────────────────────────────── */
const SEV_COLOR: Record<string, string> = {
  critical: 'var(--warn)',
  high: 'var(--amber)',
  moderate: 'var(--sky)',
  low: 'var(--ok)',
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW PAGE
═══════════════════════════════════════════════════════════════ */
export default function Overview() {
  const { scenario, compare, optimizing } = useApp()
  const navigate = useNavigate()

  /* loading / empty ----------------------------------------- */
  if (!scenario) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <Spinner label="Loading scenario…" />
        </div>
      </div>
    )
  }

  const sol = activeSolution(compare)
  const m = sol?.metrics

  const totalPopulation = scenario.zones.reduce((s, z) => s + z.population, 0)
  const criticalZones = scenario.zones.filter((z) => z.severity === 'critical').length
  const resourcesAvailable = Object.values(scenario.resources).reduce((s, v) => s + v, 0)
  const topZone = [...scenario.zones].sort((a, b) => b.priority_score - a.priority_score)[0]

  const qaoaOk = compare?.qaoa.status === 'success'
  const winner = compare?.comparison.winner
  const winnerLabel =
    winner === 'tie'
      ? 'Classical = QAOA'
      : winner === 'qaoa'
        ? 'QAOA leads'
        : winner === 'classical'
          ? 'Classical leads'
          : null

  const executiveSummary = buildExecutiveSummary(scenario, sol)

  return (
    <div className="ov-page">

      {/* ══════════════════════════════════════════════════════
          SECTION 1 · SCENARIO HERO
      ══════════════════════════════════════════════════════ */}
      <section className="ov-hero">
        <div className="ov-hero-bg" aria-hidden />
        <div className="ov-hero-content">
          <div className="ov-hero-top">
            <div className="ov-hero-pill">
              <span
                className="ov-sev-dot"
                style={{ background: SEV_COLOR[topZone?.severity ?? 'low'] } as CSSProperties}
              />
              {disasterLabel(scenario.disaster_type)} · {scenario.zones.length} zones
            </div>
            {optimizing ? (
              <span className="ov-badge ov-badge--running">
                <Activity size={11} style={{ display: 'inline', marginRight: 4 }} />
                Optimizing…
              </span>
            ) : compare ? (
              <span className="ov-badge ov-badge--ok">
                <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4 }} />
                {winnerLabel ?? 'Optimization complete'}
              </span>
            ) : (
              <span className="ov-badge ov-badge--idle">
                <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />
                Awaiting optimization
              </span>
            )}
          </div>

          <h1 className="ov-hero-title">{scenario.name}</h1>
          <p className="ov-hero-desc">{scenario.description}</p>

          <div className="ov-hero-stats">
            <div className="ov-hero-stat">
              <span className="ov-hero-stat-val">{formatNumber(totalPopulation)}</span>
              <span className="ov-hero-stat-lbl">affected citizens</span>
            </div>
            <div className="ov-hero-divider" />
            <div className="ov-hero-stat">
              <span className="ov-hero-stat-val">{scenario.zones.length}</span>
              <span className="ov-hero-stat-lbl">active zones</span>
            </div>
            <div className="ov-hero-divider" />
            <div className="ov-hero-stat">
              <span className="ov-hero-stat-val">${formatNumber(scenario.budget)}</span>
              <span className="ov-hero-stat-lbl">budget</span>
            </div>
            <div className="ov-hero-divider" />
            <div className="ov-hero-stat">
              <span
                className="ov-hero-stat-val"
                style={{ color: criticalZones > 0 ? 'var(--warn)' : 'var(--ok)' } as CSSProperties}
              >
                {criticalZones}
              </span>
              <span className="ov-hero-stat-lbl">critical zones</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          SECTION 2 · MISSION STATUS
      ══════════════════════════════════════════════════════ */}
      <section>
        <div className="ov-section-label">Mission Status</div>
        <div className="ov-panels">

          <div className="ov-panel" style={{ '--pc': 'var(--sky)' } as CSSProperties}>
            <div className="ov-panel-icon"><Users size={20} /></div>
            <div className="ov-panel-body">
              <div className="ov-panel-val">{formatNumber(totalPopulation)}</div>
              <div className="ov-panel-name">People Affected</div>
              <div className="ov-panel-sub">
                {scenario.zones.length} zones · {criticalZones > 0 ? `${criticalZones} critical` : 'none critical'}
              </div>
            </div>
          </div>

          <div className="ov-panel" style={{ '--pc': 'var(--violet)' } as CSSProperties}>
            <div className="ov-panel-icon"><Package size={20} /></div>
            <div className="ov-panel-body">
              <div className="ov-panel-val">{formatNumber(resourcesAvailable)}</div>
              <div className="ov-panel-name">Resources Available</div>
              <div className="ov-panel-sub">Total units in agency pool</div>
            </div>
          </div>

          <div className="ov-panel" style={{ '--pc': 'var(--amber)' } as CSSProperties}>
            <div className="ov-panel-icon"><TrendingUp size={20} /></div>
            <div className="ov-panel-body">
              <div className="ov-panel-val">{m ? formatPct(m.demand_satisfied_pct) : '—'}</div>
              <div className="ov-panel-name">Demand Covered</div>
              <div className="ov-panel-sub">
                {m ? `${formatNumber(m.total_served)} of ${formatNumber(m.total_demand)} units` : 'Run optimization'}
              </div>
            </div>
          </div>

          <div className="ov-panel" style={{ '--pc': 'var(--ok)' } as CSSProperties}>
            <div className="ov-panel-icon"><Target size={20} /></div>
            <div className="ov-panel-body">
              <div className="ov-panel-val">{m ? formatPct(m.priority_coverage_pct) : '—'}</div>
              <div className="ov-panel-name">Priority Coverage</div>
              <div className="ov-panel-sub">Priority-weighted demand met</div>
            </div>
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          SECTION 3 · QUANTUM INSIGHTS
      ══════════════════════════════════════════════════════ */}
      <section className="ov-quantum">
        <div className="ov-quantum-glow" aria-hidden />
        <div className="ov-quantum-inner">
          <div className="ov-quantum-header">
            <div>
              <div className="ov-section-label" style={{ color: 'var(--violet)', borderColor: 'color-mix(in srgb, var(--violet) 30%, transparent)' }}>
                Quantum Engine
              </div>
              <h2 className="ov-quantum-title">
                <Cpu size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                Classical vs QAOA Analysis
              </h2>
            </div>
            {compare && (
              <span className={`ov-badge ${winner === 'qaoa' ? 'ov-badge--ok' : 'ov-badge--info'}`}>
                {winnerLabel}
              </span>
            )}
          </div>

          {compare ? (
            <div className="ov-quantum-grid">
              <div className="ov-qblock">
                <div className="ov-qblock-label">Classical Objective</div>
                <div className="ov-qblock-val ov-qblock-val--teal">
                  {compare.comparison.classical.objective_value.toFixed(4)}
                </div>
                <div className="ov-qblock-sub">
                  <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                  {formatMs(compare.comparison.classical.execution_time_ms)}
                </div>
              </div>

              <div className="ov-q-vs">vs</div>

              <div className="ov-qblock">
                <div className="ov-qblock-label">QAOA Objective</div>
                <div className="ov-qblock-val ov-qblock-val--violet">
                  {qaoaOk ? compare.comparison.qaoa.objective_value.toFixed(4) : 'Failed'}
                </div>
                <div className="ov-qblock-sub">
                  {qaoaOk ? (
                    <>
                      <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                      {formatMs(compare.comparison.qaoa.execution_time_ms)}
                    </>
                  ) : (
                    <span style={{ color: 'var(--warn)' }}>QAOA did not converge</span>
                  )}
                </div>
              </div>

              {qaoaOk && (
                <div className="ov-qblock">
                  <div className="ov-qblock-label">Qubit Count</div>
                  <div className="ov-qblock-val" style={{ color: 'var(--violet)' }}>
                    {compare.qaoa.num_qubits}
                  </div>
                  <div className="ov-qblock-sub">
                    {compare.qaoa.config.shots.toLocaleString()} shots · {compare.qaoa.config.reps} rep
                    {compare.qaoa.config.reps !== 1 ? 's' : ''}
                  </div>
                </div>
              )}

              <div className="ov-qblock ov-qblock--full">
                <div className="ov-qblock-label">Verdict</div>
                <div className="ov-qblock-verdict">{compare.comparison.verdict}</div>
                <div className="ov-qblock-sub">{compare.comparison.note}</div>
              </div>
            </div>
          ) : (
            <div className="ov-quantum-empty">
              {optimizing ? (
                <Spinner label="Running quantum-classical comparison…" />
              ) : (
                <p style={{ color: 'var(--muted)', margin: 0 }}>
                  No optimization result yet. Run the pipeline to see classical vs QAOA comparison.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          SECTION 4 · AI EXECUTIVE SUMMARY
      ══════════════════════════════════════════════════════ */}
      <section className="ov-summary">
        <div className="ov-summary-header">
          <div className="ov-section-label">AI Executive Summary</div>
          <span className="ov-summary-badge">
            <Zap size={10} style={{ display: 'inline', marginRight: 3 }} />
            Data-driven
          </span>
        </div>
        <div className="ov-summary-body">
          {executiveSummary.map((line, i) => (
            <p key={i} className="ov-summary-line">
              {line}
            </p>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          SECTION 5 · QUICK ACTIONS
      ══════════════════════════════════════════════════════ */}
      <section>
        <div className="ov-section-label">Quick Actions</div>
        <div className="ov-actions">
          <button className="ov-action ov-action--map" onClick={() => navigate('/map')}>
            <Map size={20} />
            <span>
              <strong>Disaster Map</strong>
              <small>View zones &amp; roads</small>
            </span>
            <ArrowRight size={16} className="ov-action-arrow" />
          </button>
          <button className="ov-action ov-action--opt" onClick={() => navigate('/optimization')}>
            <Zap size={20} />
            <span>
              <strong>Run Optimization</strong>
              <small>Classical + QAOA pipeline</small>
            </span>
            <ArrowRight size={16} className="ov-action-arrow" />
          </button>
          <button className="ov-action ov-action--analytics" onClick={() => navigate('/analytics')}>
            <BarChart2 size={20} />
            <span>
              <strong>Analytics</strong>
              <small>Charts &amp; allocation detail</small>
            </span>
            <ArrowRight size={16} className="ov-action-arrow" />
          </button>
        </div>
      </section>

    </div>
  )
}
