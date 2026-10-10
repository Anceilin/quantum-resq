import { ArrowRight, Lightbulb, MinusCircle, PlusCircle } from 'lucide-react'
import type { ReoptimizeResult } from '../types'

export default function ReoptPanel({ reopt }: { reopt: ReoptimizeResult }) {
  const added = reopt.changes.filter((c) => c.type === 'added')
  const removed = reopt.changes.filter((c) => c.type === 'removed')
  const beforeObj = reopt.before.objective_value
  const afterObj = reopt.after.objective_value

  return (
    <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}>
      <div className="head">
        <div className="sec" style={{ margin: 0 }}>Re-optimization result</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sub">
            Objective <b className="mono">{beforeObj === null ? '—' : beforeObj.toFixed(4)}</b>
          </span>
          <ArrowRight size={14} color="var(--accent)" />
          <b className="mono" style={{ color: 'var(--accent)' }}>
            {afterObj === null ? '—' : afterObj.toFixed(4)}
          </b>
        </div>
      </div>

      <div className="even" style={{ marginTop: 14 }}>
        <div>
          <div className="sec" style={{ color: 'var(--warn)' }}>
            <MinusCircle size={13} style={{ verticalAlign: -2 }} /> Removed ({removed.length})
          </div>
          {removed.length === 0 ? (
            <p className="sub">Nothing removed.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
              {removed.map((c, i) => (
                <li
                  key={i}
                  style={{ border: '1px solid rgba(248,113,113,.25)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, background: 'rgba(248,113,113,.05)' }}
                >
                  <b style={{ color: 'var(--ink)' }}>
                    {c.resource_label} → {c.zone_name}
                  </b>
                  {c.reason && <div className="sub">because {c.reason}</div>}
                </li>
              ))}
            </ul>
          )}

          <div className="sec" style={{ marginTop: 14, color: 'var(--ok)' }}>
            <PlusCircle size={13} style={{ verticalAlign: -2 }} /> Added ({added.length})
          </div>
          {added.length === 0 ? (
            <p className="sub">Nothing added.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
              {added.map((c, i) => (
                <li
                  key={i}
                  style={{ border: '1px solid rgba(147,211,162,.25)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, background: 'rgba(147,211,162,.05)' }}
                >
                  <b style={{ color: 'var(--ink)' }}>
                    {c.resource_label} → {c.zone_name}
                  </b>
                  {c.reason && <div className="sub">because {c.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="sec" style={{ color: 'var(--accent)' }}>
            <Lightbulb size={13} style={{ verticalAlign: -2 }} /> Why the allocation changed
          </div>
          <ul style={{ margin: '4px 0 0' }}>
            {reopt.explanation.map((line, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
