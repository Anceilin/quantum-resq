import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { RefreshCw } from 'lucide-react'
import { api } from '../services/api'
import { useApp } from '../context/AppContext'
import { ErrorBanner, Spinner } from '../components/ui'
import type { AnalyticsPayload } from '../types'

const TOOLTIP = {
  contentStyle: { background: '#16181D', border: '1px solid #2A2E37', borderRadius: 8, fontSize: 12, color: '#EEF2FA' },
  labelStyle: { color: '#EEF2FA' },
  cursor: { fill: 'rgba(147,160,186,0.06)' },
}
const AXIS = { tick: { fill: '#93A0BA', fontSize: 11 }, axisLine: { stroke: '#2A2E37' }, tickLine: false } as const

const RESOURCE_COLORS: Record<string, string> = {
  Ambulance: '#8AB4F8',
  'Rescue Team': '#B4A7E5',
  'Medical Kit Pallet': '#7FD1C7',
  'Food Pallet': '#E8C27A',
  'Shelter Block': '#E5A0B5',
  'Emergency Vehicle': '#93D3A2',
}

export default function Analytics() {
  const { compare, scenario, optimizing } = useApp()
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resultId = compare?.result_id ?? null

  const load = useMemo(
    () => async () => {
      if (!resultId) {
        setData(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        setData(await api.getAnalytics(resultId))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [resultId],
  )

  useEffect(() => {
    load()
  }, [load])

  if (!scenario)
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No scenario loaded.</div>

  const head = (
    <div className="head">
      <div>
        <h1>Analytics</h1>
        <p>Every figure is derived from the actual solver output for the current scenario.</p>
      </div>
      {compare && (
        <button className="btn" onClick={load} disabled={loading || optimizing}>
          {loading ? <Spinner /> : <RefreshCw size={15} />} Refresh
        </button>
      )}
    </div>
  )

  if (!compare) {
    return (
      <div className="page">
        {head}
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          No optimization result yet. Go to Optimization and run it, or press RE-OPTIMIZE.
        </div>
      </div>
    )
  }

  // Pivot allocation_by_zone into a stacked-bar friendly shape.
  const allocPivot = (() => {
    if (!data) return []
    const zones = Array.from(new Set(data.allocation_by_zone.map((a) => a.zone)))
    const resources = Array.from(new Set(data.allocation_by_zone.map((a) => a.resource)))
    return zones.map((z) => {
      const row: Record<string, number | string> = { zone: z }
      for (const r of resources) {
        row[r] = data.allocation_by_zone
          .filter((a) => a.zone === z && a.resource === r)
          .reduce((s, a) => s + a.units, 0)
      }
      return row
    })
  })()
  const allocResources = data ? Array.from(new Set(data.allocation_by_zone.map((a) => a.resource))) : []

  return (
    <div className="page">
      {head}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading && !data && <div className="card"><Spinner label="Computing analytics…" /></div>}

      {data && (
        <>
          <div className="even">
            <ChartCard title="Demand vs allocation (units)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.demand_vs_allocation} margin={{ top: 5, right: 10, left: -12, bottom: 5 }}>
                  <CartesianGrid stroke="#2A2E37" vertical={false} />
                  <XAxis dataKey="zone" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="demand" name="Demand" fill="#475569" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="served" name="Served" fill="#8AB4F8" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Resource utilization (%)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.resource_utilization} margin={{ top: 5, right: 10, left: -12, bottom: 5 }}>
                  <CartesianGrid stroke="#2A2E37" vertical={false} />
                  <XAxis dataKey="resource" {...AXIS} interval={0} angle={-18} textAnchor="end" height={54} />
                  <YAxis domain={[0, 100]} {...AXIS} />
                  <Tooltip {...TOOLTIP} />
                  <Bar dataKey="pct" name="Utilization" fill="#B4A7E5" radius={[4, 4, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Priority vs coverage by zone">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.priority_coverage} margin={{ top: 5, right: 10, left: -12, bottom: 5 }}>
                  <CartesianGrid stroke="#2A2E37" vertical={false} />
                  <XAxis dataKey="zone" {...AXIS} />
                  <YAxis domain={[0, 100]} {...AXIS} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="priority" name="Priority score" fill="#E8C27A" radius={[4, 4, 0, 0]} maxBarSize={34} />
                  <Bar dataKey="coverage" name="Coverage %" fill="#93D3A2" radius={[4, 4, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Allocation by zone (units)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={allocPivot} margin={{ top: 5, right: 10, left: -12, bottom: 5 }}>
                  <CartesianGrid stroke="#2A2E37" vertical={false} />
                  <XAxis dataKey="zone" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {allocResources.map((r) => (
                    <Bar key={r} dataKey={r} stackId="a" fill={RESOURCE_COLORS[r] ?? '#64748b'} maxBarSize={54} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Shortage recommendations (spec section 17) */}
          {data.shortage && (
            <div className="card">
              <div className="sec">
                Resource shortage impact — reach {data.shortage.target_coverage_pct}% coverage
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
                <div>
                  <div className="lbl">Current coverage</div>
                  <div className="num" style={{ color: 'var(--accent)' }}>{data.shortage.current_coverage_pct.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="lbl">Target coverage</div>
                  <div className="num">{data.shortage.target_coverage_pct.toFixed(0)}%</div>
                </div>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div className="track" style={{ marginTop: 0, height: 10 }}>
                    <div className="fill" style={{ width: `${Math.min(100, data.shortage.current_coverage_pct)}%`, background: 'var(--accent)' }} />
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>Simulation estimate only.</div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                {data.shortage.recommendations.length === 0 ? (
                  <p className="sub" style={{ color: 'var(--ok)' }}>
                    Coverage target already met with the current resource pool — no additional resources recommended.
                  </p>
                ) : (
                  <div className="presets">
                    {data.shortage.recommendations.map((rec) => (
                      <div key={rec.resource} className="preset">
                        <div className="head" style={{ alignItems: 'center' }}>
                          <div>
                            <b>{rec.label}</b>
                            <div className="sub">unmet demand {rec.unmet_demand.toLocaleString()}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--amber)' }}>+{rec.additional_units}</div>
                            <div className="lbl">recommended</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="sub">
            Analytics reflect the latest comparison run. Re-optimize after editing the scenario to refresh these figures.
          </p>
        </>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="sec">{title}</div>
      <div style={{ height: 256 }}>{children}</div>
    </div>
  )
}
