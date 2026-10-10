import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useApp } from '../context/AppContext'
import AllocationPanel from '../components/AllocationPanel'

// Reference palette hexes (kept concrete so Recharts renders correctly).
const VIOLET = '#B4A7E5'
const ACCENT = '#8AB4F8'
const SKY = '#8AB4F8'
const LINE = '#2A2E37'
const MUTED = '#93A0BA'
const INK = '#EEF2FA'

export default function QuantumEngine() {
  const { scenario, compare } = useApp()
  const qaoa = compare?.qaoa

  if (!scenario)
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No scenario loaded.</div>
  if (!qaoa)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
        Run the optimization first (Optimization page → RUN OPTIMIZATION) to execute QAOA.
      </div>
    )

  // Honest failure surface — never substituted with a classical or fabricated result.
  if (qaoa.status !== 'success') {
    return (
      <div className="page">
        <div className="head">
          <div>
            <h1>Quantum Engine</h1>
            <p>Small-scale QAOA simulation on Qiskit Aer</p>
          </div>
          <span className="badge bad">Failed</span>
        </div>
        <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)' }}>
          <div style={{ fontWeight: 600, color: 'var(--warn)', marginBottom: 8 }}>QAOA execution failed</div>
          <p className="mono" style={{ fontSize: 12, color: 'var(--muted2)', wordBreak: 'break-all' }}>{qaoa.error}</p>
          <p className="sub" style={{ marginTop: 8 }}>Error type: {qaoa.error_type}. The result was not replaced by the classical answer.</p>
        </div>
      </div>
    )
  }

  const qubo = qaoa.qubo
  const sol = qaoa.solution
  const meas = qaoa.measurement
  const history = (qaoa.expectation_history ?? []).map((v, i) => ({ iter: i + 1, expectation: v }))
  const top = meas?.top_bitstrings ?? []
  const maxCount = Math.max(1, ...top.map((b) => b.counts))
  const shots = qaoa.config.shots
  const totalCounts = top.reduce((s, b) => s + b.counts, 0)
  const restShots = Math.max(0, (meas?.total_shots ?? shots) - totalCounts)
  const classicalObj = compare?.comparison.classical.objective_value

  const stats: [string, string][] = [
    ['Primary binary vars', String(qubo.num_primary_vars)],
    ['Slack vars', String(qubo.num_slack_vars)],
    ['Total qubits', String(qubo.num_qubits)],
    ['Linear terms', String(qubo.num_linear_terms)],
    ['Quadratic terms', String(qubo.num_quadratic_terms)],
    ['Offset', qubo.offset.toFixed(4)],
    ['Forbid penalty', qubo.penalty_forbid.toFixed(2)],
    ['Availability penalty', qubo.penalty_avail.toFixed(2)],
  ]

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Quantum Engine</h1>
          <p>A quantum-assisted optimization prototype using small-scale QAOA simulation. Every value below comes from a real Qiskit Aer execution.</p>
        </div>
        <span className={qaoa.found_feasible ? 'badge' : 'badge bad'}>{qaoa.found_feasible ? 'Feasible' : 'No feasible shot'}</span>
      </div>

      {/* ---------- QUBO formulation (real values) ---------- */}
      <div className="card">
        <h2 style={{ marginBottom: 6 }}>QUBO formulation</h2>
        <div className="even" style={{ columnGap: 32 }}>
          {[stats.slice(0, 4), stats.slice(4)].map((col, i) => (
            <div key={i}>
              {col.map(([k, v], j) => (
                <div className={j ? 'row' : 'row first'} key={k}>
                  <span>{k}</span>
                  <b className="mono">{v}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="formula" style={{ marginTop: 14 }}>{qubo.objective}</div>
        <div className="even" style={{ marginTop: 16 }}>
          <div>
            <b>Encoded in QUBO</b>
            <ul>{qubo.constraints_encoded.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
          <div>
            <b>Enforced at decode</b>
            <ul>{qubo.constraints_enforced_at_decode.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        </div>
        <p className="sub" style={{ margin: '14px 0 8px' }}>
          Indexing: <span className="mono">{qubo.variable_indexing}</span>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {qubo.zones.map((z) => (
            <span className="chip static" key={z}>Zone {z}</span>
          ))}
          {qubo.resources.map((r) => (
            <span className="chip static" key={r} style={{ color: 'var(--teal)', borderColor: 'color-mix(in srgb, var(--teal) 40%, transparent)' }}>{r}</span>
          ))}
        </div>
      </div>

      <div className="split">
        {/* ---------- Measurement distribution (real Qiskit counts) ---------- */}
        <div className="card">
          <h2>Measurement distribution</h2>
          <p className="sub" style={{ margin: '4px 0 8px' }}>
            {meas?.distinct_bitstrings ?? 0} distinct bitstrings · {((meas?.feasible_shot_fraction ?? 0) * 100).toFixed(1)}% feasible shots · {shots} shots total.
          </p>
          {top.length ? (
            top.map((b, i) => (
              <div className="hrow" key={b.bitstring + i}>
                <span className="mono bits" style={{ color: b.feasible ? 'var(--ok)' : 'var(--warn)' }}>{b.bitstring}</span>
                <div className="track">
                  <div className="fill" style={{ width: (b.counts / maxCount) * 100 + '%', background: i === 0 ? ACCENT : VIOLET }} />
                </div>
                <span className="mono cnt">{b.counts} · {((b.counts / shots) * 100).toFixed(1)}%</span>
              </div>
            ))
          ) : (
            <p className="sub">No measurements recorded.</p>
          )}
          {restShots > 0 && <p className="sub" style={{ marginTop: 12 }}>Other bitstrings: {restShots} shots</p>}
        </div>

        {/* ---------- Optimizer convergence (real expectation history) ---------- */}
        <div className="card">
          <h2>Optimizer convergence</h2>
          <p className="sub" style={{ margin: '4px 0 8px' }}>
            {qaoa.config.optimizer}, p = {qaoa.config.reps}, {history.length} recorded iterations.
          </p>
          {history.length > 1 ? (
            <>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
                    <XAxis dataKey="iter" tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#1D2027', border: `1px solid ${LINE}`, borderRadius: 8, color: INK }}
                      formatter={(v) => [Number(v).toFixed(4), 'Expectation']}
                      labelFormatter={(l) => 'Iteration ' + l}
                    />
                    {typeof classicalObj === 'number' && (
                      <ReferenceLine y={classicalObj} stroke={SKY} strokeDasharray="5 5" />
                    )}
                    <Area type="monotone" dataKey="expectation" name="QAOA expectation" stroke={VIOLET} strokeWidth={2.4} fill={VIOLET} fillOpacity={0.14} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="legend">
                <span><i className="dot" style={{ background: VIOLET }} />QAOA expectation</span>
                <span><i className="dot" style={{ background: SKY }} />Classical objective ({classicalObj?.toFixed(4) ?? '—'})</span>
              </div>
            </>
          ) : (
            <p className="sub">Convergence history unavailable for this run.</p>
          )}
        </div>
      </div>

      {/* ---------- Circuit (real generated circuit) ---------- */}
      <div className="card">
        <div className="head" style={{ marginBottom: 10 }}>
          <h2>Generated QAOA circuit</h2>
          <span className="sub">
            depth {String((qaoa.circuit_stats as Record<string, unknown>)?.depth ?? '—')} · {qaoa.num_qubits} qubits
          </span>
        </div>
        <pre className="codeblock" style={{ maxHeight: 320, overflow: 'auto' }}>{qaoa.circuit_ascii}</pre>
      </div>

      {/* ---------- Measurement table (real) ---------- */}
      <div className="card scroll">
        <h2 style={{ marginBottom: 6 }}>Top measured bitstrings</h2>
        <table className="qtable">
          <thead>
            <tr>
              <th>Bitstring</th>
              <th className="r">Counts</th>
              <th className="r">Objective</th>
              <th>Feasible</th>
              <th className="r">Violations</th>
            </tr>
          </thead>
          <tbody>
            {top.map((b, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 11.5 }}>{b.bitstring}</td>
                <td className="r">{b.counts}</td>
                <td className="r mono">{b.objective_value.toFixed(4)}</td>
                <td>
                  <span className={b.feasible ? 'badge' : 'badge bad'}>{b.feasible ? 'yes' : 'no'}</span>
                </td>
                <td className="r">{b.violations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- Best decoded solution (real) ---------- */}
      {sol && (
        <div className="card">
          <div className="head" style={{ marginBottom: 12 }}>
            <div>
              <h2>Best decoded solution</h2>
              <p className="sub mono">bitstring {sol.bitstring}</p>
            </div>
            <div className="btns">
              <span className="badge info">objective {sol.objective_value.toFixed(4)}</span>
              <span className={sol.feasible ? 'badge' : 'badge bad'}>{sol.feasible ? 'Feasible' : 'Infeasible'}</span>
            </div>
          </div>
          {!qaoa.found_feasible && (
            <p className="notice" style={{ marginBottom: 12 }}>
              No measured bitstring was fully feasible; showing the least-violating candidate.
            </p>
          )}
          <AllocationPanel solution={sol} scenario={scenario} title="Decoded allocation" />
        </div>
      )}
    </div>
  )
}
