import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Comparison } from '../types'
import { formatMs } from '../utils/format'

const CLASSICAL_COLOR = '#7FD1C7'
const QAOA_COLOR = '#B4A7E5'
const AXIS = '#93A0BA'
const GRID = '#2A2E37'

export default function ComparisonCharts({ comparison }: { comparison: Comparison }) {
  const { classical, qaoa } = comparison
  const pctData = [
    { metric: 'Demand satisfied', Classical: classical.demand_satisfied_pct, QAOA: qaoa.demand_satisfied_pct },
    { metric: 'Priority coverage', Classical: classical.priority_coverage_pct, QAOA: qaoa.priority_coverage_pct },
    { metric: 'Resource utilization', Classical: classical.resource_utilization_pct, QAOA: qaoa.resource_utilization_pct },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="sec">Coverage metrics (%) — Classical Baseline vs Quantum-Assisted QAOA</div>
        <div style={{ height: 256 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pctData} margin={{ top: 5, right: 10, left: -18, bottom: 5 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="metric" tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#16181D', border: '1px solid #2A2E37', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#EEF2FA' }}
                cursor={{ fill: 'rgba(147,160,186,0.06)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: AXIS }} />
              <Bar dataKey="Classical" fill={CLASSICAL_COLOR} radius={[4, 4, 0, 0]} maxBarSize={46} />
              <Bar dataKey="QAOA" fill={QAOA_COLOR} radius={[4, 4, 0, 0]} maxBarSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="g4">
        <Stat label="Objective" c={classical.objective_value.toFixed(4)} q={qaoa.objective_value.toFixed(4)} />
        <Stat label="Unserved demand" c={String(classical.unserved_demand)} q={String(qaoa.unserved_demand)} />
        <Stat label="Travel cost (km)" c={classical.travel_cost_km.toFixed(1)} q={qaoa.travel_cost_km.toFixed(1)} />
        <Stat label="Currency cost" c={`$${classical.currency_cost.toFixed(0)}`} q={`$${qaoa.currency_cost.toFixed(0)}`} />
        <Stat label="Violations" c={String(classical.constraint_violations)} q={String(qaoa.constraint_violations)} />
        <Stat label="Exec time" c={formatMs(classical.execution_time_ms)} q={formatMs(qaoa.execution_time_ms)} />
        <Stat label="Iterations" c={String(classical.iterations ?? '—')} q={String(qaoa.iterations ?? '—')} />
        <Stat label="Qubits" c="n/a (classical)" q={String(qaoa.qubit_count ?? '—')} />
      </div>
    </div>
  )
}

function Stat({ label, c, q }: { label: string; c: string; q: string }) {
  return (
    <div className="card">
      <div className="sec" style={{ marginBottom: 4 }}>{label}</div>
      <div className="row first">
        <span style={{ color: AXIS }}>
          <i className="dot" style={{ background: CLASSICAL_COLOR }} />
          Classical
        </span>
        <b className="mono">{c}</b>
      </div>
      <div className="row" style={{ marginTop: 2 }}>
        <span style={{ color: AXIS }}>
          <i className="dot" style={{ background: QAOA_COLOR }} />
          QAOA
        </span>
        <b className="mono">{q}</b>
      </div>
    </div>
  )
}
