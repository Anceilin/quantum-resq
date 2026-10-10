import { CheckCircle2, MinusCircle, Truck } from 'lucide-react'
import type { Scenario, Solution } from '../types'
import { explainSolution } from '../utils/explain'
import { resourceLabel } from '../utils/format'

export default function AllocationPanel({
  solution,
  scenario,
  title = 'Decoded Allocation',
  compact = false,
}: {
  solution: Solution
  scenario: Scenario
  title?: string
  compact?: boolean
}) {
  const explained = explainSolution(solution, scenario)
  const receiving = explained.filter((e) => e.receiving)
  const notReceiving = explained.filter((e) => !e.receiving)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="head">
        <h2>{title}</h2>
        <span className={solution.feasible ? 'badge' : 'badge bad'}>
          {solution.feasible ? 'Feasible' : `${solution.violations.length} violation(s)`}
        </span>
      </div>

      {!solution.feasible && solution.violations.length > 0 && (
        <div
          className="card"
          style={{ borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)' }}
        >
          <ul style={{ margin: 0 }}>
            {solution.violations.map((v, i) => (
              <li key={i} style={{ color: 'var(--warn)' }}>
                {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      {receiving.length === 0 && (
        <p className="sub">
          No resources deployed in this solution (the optimizer found no beneficial feasible assignment under the
          current constraints).
        </p>
      )}

      <div className={compact ? '' : 'g4'} style={compact ? undefined : { gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
        {receiving.map(({ zone, assignments, reasons }) => (
          <div key={zone.id} className="card animate-in">
            <div className="head" style={{ marginBottom: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <Truck size={16} color="var(--accent)" /> {zone.name}
              </span>
              <span className="badge info">P {zone.priority_score.toFixed(0)}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {assignments.map((a, i) => (
                <span key={i} className="chip static">
                  {a.bundles}× {resourceLabel(a.resource)}
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    ({a.served}/{a.demand})
                  </span>
                </span>
              ))}
            </div>
            <div className="sec">Why this allocation?</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {reasons.map((r, i) => (
                <li key={i} style={{ display: 'flex', gap: 6, fontSize: 12.5, color: 'var(--muted2)', marginBottom: 4 }}>
                  <CheckCircle2 size={14} color="var(--ok)" style={{ flex: 'none', marginTop: 2 }} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {!compact && notReceiving.length > 0 && (
        <div>
          <div className="sec">Zones receiving no resources</div>
          <div className="g4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            {notReceiving.map(({ zone, reasons }) => (
              <div key={zone.id} className="card">
                <div className="head" style={{ marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--muted2)' }}>
                    <MinusCircle size={16} /> {zone.name}
                  </span>
                  <span className="badge info">P {zone.priority_score.toFixed(0)}</span>
                </div>
                <ul style={{ margin: 0 }}>
                  {reasons.slice(0, 4).map((r, i) => (
                    <li key={i} style={{ fontSize: 12, marginBottom: 3 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
