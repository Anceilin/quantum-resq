import { useMemo, useState } from 'react'
import { Cpu, Atom, History } from 'lucide-react'
import type { CompareResult } from '../types'
import type { HistoricalBaseline } from '../context/AppContext'
import { resourceLabel } from '../utils/format'

type Key = string // `${resource}::${zone_id}`

interface Row {
  key: Key
  resource: string
  resourceLabel: string
  zoneId: string
  zoneName: string
  recorded: number | null
  fresh: number | null
}

// Presentation-only diff between a historical record's RECORDED allocation
// (fixed DEMO archive data) and a freshly produced classical/QAOA allocation on
// a scenario loaded from that record. It never invents numbers — every value
// comes straight from the archive or the real optimizer output.
export default function HistoricalComparison({
  baseline,
  compare,
}: {
  baseline: HistoricalBaseline
  compare: CompareResult
}) {
  const [method, setMethod] = useState<'classical' | 'qaoa'>('classical')
  const qaoaOk = compare.qaoa.status === 'success' && !!compare.qaoa.solution

  const freshAssignments = method === 'qaoa' && qaoaOk ? compare.qaoa.solution!.assignments : compare.classical.solution.assignments

  const { rows } = useMemo(() => {
    const map = new Map<Key, Row>()
    const touch = (resource: string, resourceLabelStr: string, zoneId: string, zoneName: string) => {
      const key: Key = `${resource}::${zoneId}`
      let r = map.get(key)
      if (!r) {
        r = { key, resource, resourceLabel: resourceLabelStr, zoneId, zoneName, recorded: null, fresh: null }
        map.set(key, r)
      }
      return r
    }
    for (const a of baseline.allocation) {
      touch(a.resource, a.resource_label, a.zone_id, a.zone_name).recorded = a.units
    }
    for (const a of freshAssignments) {
      if (!a.units) continue
      const r = touch(a.resource, a.resource_label, a.zone_id, a.zone_name)
      r.fresh = (r.fresh ?? 0) + a.units
    }
    const list = [...map.values()]
    // Stable ordering: by resource label, then zone name.
    list.sort((a, b) => a.resourceLabel.localeCompare(b.resourceLabel) || a.zoneName.localeCompare(b.zoneName))
    return { rows: list }
  }, [baseline, freshAssignments])

  const recordedTotal = rows.reduce((s, r) => s + (r.recorded ?? 0), 0)
  const freshTotal = rows.reduce((s, r) => s + (r.fresh ?? 0), 0)
  const gained = rows.filter((r) => (r.fresh ?? 0) > (r.recorded ?? 0)).length
  const reduced = rows.filter((r) => (r.fresh ?? 0) < (r.recorded ?? 0)).length

  return (
    <div className="card animate-in" style={{ borderColor: 'color-mix(in srgb, var(--violet) 30%, transparent)' }}>
      <div className="head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={18} color="var(--violet)" />
          <div>
            <h2 style={{ margin: 0 }}>New run vs historical record</h2>
            <p className="sub" style={{ marginTop: 2 }}>
              Comparing the fresh {method === 'qaoa' ? 'QAOA' : 'classical'} allocation with the recorded allocation of{' '}
              <b style={{ color: 'var(--ink)' }}>{baseline.name}</b>.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={method === 'classical' ? 'btn cy' : 'btn'} onClick={() => setMethod('classical')}>
            <Cpu size={14} /> Classical
          </button>
          <button
            className={method === 'qaoa' ? 'btn vi' : 'btn'}
            onClick={() => setMethod('qaoa')}
            disabled={!qaoaOk}
            title={qaoaOk ? 'Compare against QAOA' : 'QAOA did not produce a usable allocation'}
          >
            <Atom size={14} /> QAOA
          </button>
        </div>
      </div>

      <div className="g4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginTop: 6 }}>
        <Stat label="Recorded units" value={recordedTotal.toLocaleString()} tone="muted" />
        <Stat label="New units" value={freshTotal.toLocaleString()} tone="accent" />
        <Stat label="Positions increased" value={String(gained)} tone="ok" />
        <Stat label="Positions reduced" value={String(reduced)} tone="warn" />
      </div>

      <div className="scroll" style={{ marginTop: 14 }}>
        <table className="qtable" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Zone</th>
              <th style={{ textAlign: 'right' }}>Recorded</th>
              <th style={{ textAlign: 'right' }}>New</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const recorded = r.recorded ?? 0
              const fresh = r.fresh ?? 0
              const delta = fresh - recorded
              const color =
                delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--warn)' : 'var(--muted)'
              return (
                <tr key={r.key}>
                  <td>{r.resourceLabel || resourceLabel(r.resource)}</td>
                  <td>{r.zoneName}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--muted2)' }}>
                    {r.recorded === null ? '—' : recorded.toLocaleString()}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {r.fresh === null ? '—' : fresh.toLocaleString()}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color, fontWeight: 600 }}>
                    {delta === 0 ? '·' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="sub" style={{ marginTop: 10 }}>
        The recorded column is archived DEMO response data for this historical event, not an optimizer result. The new
        column is the live classical/QAOA output for the scenario you loaded and edited. Zone ids are matched where
        they carry over from the archive.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'muted' | 'accent' | 'ok' | 'warn' }) {
  const color =
    tone === 'accent' ? 'var(--accent)' : tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)'
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--card2)', padding: '10px 12px' }}>
      <div className="lbl">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color }}>{value}</div>
    </div>
  )
}
