import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Compass, Package, Zap } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { SEVERITY_COLOR, formatNumber, formatPct, severityLabel, disasterLabel } from '../utils/format'
import type { Road, Solution, Zone } from '../types'

// The simulated supply depot sits at the region centre (matches the generator).
const DEPOT: [number, number] = [21.15, 79.1]

const depotIcon = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:6px;background:#8AB4F8;border:2px solid #16181D;
         display:flex;align-items:center;justify-content:center;color:#04121a;font-weight:700;font-size:11px;">D</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function nodeCoord(node: string, zones: Zone[]): [number, number] | null {
  if (node === 'DEPOT') return DEPOT
  const z = zones.find((x) => x.id === node)
  return z ? [z.latitude, z.longitude] : null
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  if (target) map.panTo(target, { animate: true })
  return null
}

function MapResizer({ selected }: { selected: string | null }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 100)
    return () => clearTimeout(timer)
  }, [map, selected])
  return null
}

function activeSolution(compare: ReturnType<typeof useApp>['compare']): Solution | null {
  if (!compare) return null
  const q = compare.qaoa
  if (q.status === 'success' && q.solution) return q.solution
  return compare.classical.solution ?? null
}

export default function DisasterMap() {
  const { scenario, compare, blockRoad, optimizing, dirty } = useApp()
  const { permissions } = useAuth()
  const canBlock = !!permissions?.can_block_roads
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedRoad, setSelectedRoad] = useState<string | null>(null)

  const sol = activeSolution(compare)

  const allocationsByZone = useMemo(() => {
    const map = new Map<string, { label: string; units: number }[]>()
    const assign = sol?.assignments ?? []
    for (const a of assign) {
      const list = map.get(a.zone_id) ?? []
      list.push({ label: a.resource_label, units: a.units })
      map.set(a.zone_id, list)
    }
    return map
  }, [sol])

  if (!scenario)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
        No scenario loaded.
      </div>
    )

  const zone = selected ? scenario.zones.find((z) => z.id === selected) ?? null : null
  const center: [number, number] = scenario.zones.length
    ? [
        scenario.zones.reduce((s, z) => s + z.latitude, 0) / scenario.zones.length,
        scenario.zones.reduce((s, z) => s + z.longitude, 0) / scenario.zones.length,
      ]
    : DEPOT
  const zoneAlloc = zone ? allocationsByZone.get(zone.id) ?? [] : []

  // Calculated operational intelligence values
  const totalPopulation = scenario.zones.reduce((s, z) => s + z.population, 0)
  const criticalZones = scenario.zones.filter((z) => z.severity === 'critical')
  const reachableZones = scenario.zones.filter((z) => z.road_accessibility > 0)
  const blockedRoads = scenario.roads.filter((r) => r.blocked)
  const topZone = [...scenario.zones].sort((a, b) => b.priority_score - a.priority_score)[0]

  // Resource utilization metrics
  const resUsed = sol?.metrics?.resource_utilization
  const ambUsed = resUsed?.ambulances?.units_used ?? 0
  const rescueUsed = resUsed?.rescue_teams?.units_used ?? 0
  const medKitsUsed = resUsed?.medical_kits?.units_used ?? 0
  const totalShelterCap = scenario.zones.reduce((s, z) => s + (z.shelter_capacity - z.shelter_occupancy), 0)

  return (
    <div className="dm-page">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="head">
        <div>
          <h1>Disaster Map &amp; Operational Command</h1>
          <p className="sub">
            Real-time geospatial view of {scenario.zones.length} zones, road network status, and resource deployments.
          </p>
        </div>
        <div className="btns">
          {optimizing ? (
            <span className="badge info">Optimizing network…</span>
          ) : dirty ? (
            <span className="badge bad">Roads updated — Re-optimize required</span>
          ) : compare ? (
            <span className="badge">Allocation active</span>
          ) : (
            <span className="badge info">Ready for optimization</span>
          )}
        </div>
      </div>

      {/* ── HERO MAP LAYOUT (Stretches Map & Side Panel) ───────────── */}
      <div className="dm-hero-grid">
        {/* ---- Map Hero Card ---- */}
        <div className="dm-map-card">
          <MapContainer className="dm-map-container" center={center} zoom={12} scrollWheelZoom>
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <FlyTo target={zone ? [zone.latitude, zone.longitude] : null} />
            <MapResizer selected={selected} />

            {scenario.roads.map((road: Road) => {
              const a = nodeCoord(road.source, scenario.zones)
              const b = nodeCoord(road.target, scenario.zones)
              if (!a || !b) return null
              const isSel = selectedRoad === road.id
              const color = road.blocked ? '#F2A3A3' : isSel ? '#8AB4F8' : road.is_primary ? '#7FD1C7' : '#475569'
              return (
                <Polyline
                  key={road.id}
                  positions={[a, b]}
                  pathOptions={{
                    color,
                    weight: isSel ? 5 : road.is_primary ? 3 : 2,
                    dashArray: road.blocked ? '6 6' : undefined,
                    opacity: road.blocked ? 0.9 : 0.7,
                  }}
                  eventHandlers={{ click: () => setSelectedRoad(road.id) }}
                >
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <b>
                        {road.source} → {road.target}
                      </b>
                      <div>
                        {road.distance_km} km · {road.blocked ? 'BLOCKED' : 'OPEN'}
                      </div>
                    </div>
                  </Popup>
                </Polyline>
              )
            })}

            <Marker position={DEPOT} icon={depotIcon}>
              <Popup>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Supply Depot (simulated)</div>
              </Popup>
            </Marker>

            {scenario.zones.map((z) => {
              const alloc = allocationsByZone.get(z.id) ?? []
              const radius = 9 + Math.min(12, z.population / 5000)
              return (
                <CircleMarker
                  key={z.id}
                  center={[z.latitude, z.longitude]}
                  radius={radius}
                  pathOptions={{
                    color: selected === z.id ? '#EEF2FA' : SEVERITY_COLOR[z.severity],
                    weight: selected === z.id ? 3 : 2,
                    fillColor: SEVERITY_COLOR[z.severity],
                    fillOpacity: z.road_accessibility <= 0 ? 0.15 : 0.5,
                    dashArray: z.road_accessibility <= 0 ? '4 4' : undefined,
                  }}
                  eventHandlers={{ click: () => setSelected(z.id) }}
                >
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{z.name}</div>
                      <div>Severity: {severityLabel(z.severity)}</div>
                      <div>Priority: {z.priority_score.toFixed(1)}</div>
                      <div>Accessibility: {(z.road_accessibility * 100).toFixed(0)}%</div>
                      <div>Allocations: {alloc.length}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>

          <div className="legend">
            <span>
              <i className="dot" style={{ background: SEVERITY_COLOR.critical }} />
              Critical
            </span>
            <span>
              <i className="dot" style={{ background: SEVERITY_COLOR.high }} />
              High
            </span>
            <span>
              <i className="dot" style={{ background: SEVERITY_COLOR.moderate }} />
              Moderate
            </span>
            <span>
              <i className="dot" style={{ background: SEVERITY_COLOR.low }} />
              Low
            </span>
            <span>
              <i className="dot" style={{ background: '#F2A3A3' }} />
              Blocked road
            </span>
            <span>
              <i className="dot" style={{ background: '#7FD1C7' }} />
              Open road
            </span>
          </div>
        </div>

        {/* ---- Side Panel (Zone Details & Road Network) ---- */}
        <div className="dm-side-panel">
          <div className="dm-side-card dm-zone-details-card">
            <div className="sec">Zone Details</div>
            {!zone ? (
              <p className="sub">Click a zone marker on the map to inspect telemetry and allocations.</p>
            ) : (
              <div>
                <div className="head" style={{ marginBottom: 6 }}>
                  <b style={{ color: SEVERITY_COLOR[zone.severity] }}>{zone.name}</b>
                  <span className={zone.severity === 'critical' ? 'badge bad' : 'badge info'}>
                    {severityLabel(zone.severity)}
                  </span>
                </div>
                <div className="row first">
                  <span>Population</span>
                  <b>{formatNumber(zone.population)}</b>
                </div>
                <div className="row">
                  <span>Vulnerable</span>
                  <b>{formatNumber(zone.children + zone.elderly + zone.disabled)}</b>
                </div>
                <div className="row">
                  <span>Priority</span>
                  <b className="mono">{zone.priority_score.toFixed(1)}</b>
                </div>
                <div className="row">
                  <span>Accessibility</span>
                  <b className="mono" style={{ color: zone.road_accessibility <= 0 ? 'var(--warn)' : undefined }}>
                    {(zone.road_accessibility * 100).toFixed(0)}%
                  </b>
                </div>
                <div className="row">
                  <span>Medical demand</span>
                  <b>{formatNumber(zone.medical_demand)}</b>
                </div>
                <div className="row">
                  <span>Food demand</span>
                  <b>{formatNumber(zone.food_demand)}</b>
                </div>
                <div className="row">
                  <span>Rescue demand</span>
                  <b>{formatNumber(zone.rescue_demand)}</b>
                </div>
                <div className="row">
                  <span>Hospital free</span>
                  <b>
                    {Math.max(0, zone.hospital_capacity - zone.hospital_occupancy)}/{zone.hospital_capacity}
                  </b>
                </div>
                <div className="row">
                  <span>Shelter free</span>
                  <b>
                    {Math.max(0, zone.shelter_capacity - zone.shelter_occupancy)}/{zone.shelter_capacity}
                  </b>
                </div>

                <div className="sec" style={{ marginTop: 12 }}>
                  Current Allocation
                </div>
                {zoneAlloc.length === 0 ? (
                  <p className="sub">No resources assigned.</p>
                ) : (
                  zoneAlloc.map((a, i) => (
                    <div className="row" key={i}>
                      <span>{a.label}</span>
                      <b className="mono" style={{ color: 'var(--accent)' }}>
                        ×{a.units}
                      </b>
                    </div>
                  ))
                )}

                {zone.road_accessibility <= 0 && (
                  <div
                    className="notice"
                    style={{
                      marginTop: 12,
                      color: 'var(--warn)',
                      borderColor: 'rgba(248,113,113,.4)',
                      background: 'rgba(248,113,113,.08)',
                    }}
                  >
                    This zone is currently cut off.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="dm-side-card dm-road-network-card">
            <div className="sec">Road Network</div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {scenario.roads.map((road) => (
                <div
                  key={road.id}
                  className="row first"
                  style={{
                    padding: '6px 0',
                    borderColor: selectedRoad === road.id ? 'var(--accent)' : undefined,
                  }}
                >
                  <button
                    style={{
                      background: 'none',
                      border: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--muted2)',
                      padding: 0,
                    }}
                    onClick={() => setSelectedRoad(road.id)}
                  >
                    {road.source.replace('zone_', '').replace('DEPOT', 'Depot')} →{' '}
                    {road.target.replace('zone_', '').replace('DEPOT', 'Depot')}
                    <span className="sub" style={{ marginLeft: 6 }}>
                      {road.distance_km}km
                    </span>
                  </button>
                  <button
                    className={`chip ${road.blocked ? 'blocked' : 'open'} ${canBlock ? '' : 'static'}`}
                    onClick={() => canBlock && blockRoad(road.id, !road.blocked)}
                    disabled={!canBlock || optimizing}
                    title={canBlock ? (road.blocked ? 'Reopen road' : 'Block road') : 'Your role cannot edit road blockages'}
                  >
                    {road.blocked ? 'BLOCKED' : 'OPEN'}
                  </button>
                </div>
              ))}
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              {canBlock
                ? 'Toggling a road recomputes accessibility on the backend.'
                : 'Road blockages managed by Rescue Coordinator / Officer.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: OPERATIONAL INTELLIGENCE (3 CARDS) ──────────── */}
      <section>
        <div className="ov-section-label">Operational Intelligence</div>
        <div className="dm-intel-grid">
          {/* Card 1: Situation Overview */}
          <div className="dm-intel-card" style={{ '--ic': 'var(--sky)' } as CSSProperties}>
            <div className="dm-intel-header">
              <div className="dm-intel-icon">
                <Compass size={20} />
              </div>
              <div>
                <h3 className="dm-intel-title">Situation Overview</h3>
                <div className="dm-intel-sub">{disasterLabel(scenario.disaster_type)} scenario</div>
              </div>
            </div>
            <div className="dm-intel-rows">
              <div className="dm-intel-row">
                <span className="k">Active Zones</span>
                <span className="v">{scenario.zones.length}</span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Affected Population</span>
                <span className="v">{formatNumber(totalPopulation)}</span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Critical Zones</span>
                <span className="v" style={{ color: criticalZones.length > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                  {criticalZones.length > 0 ? `${criticalZones.length} (${criticalZones[0].name})` : 'None'}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Accessibility</span>
                <span className="v">
                  {reachableZones.length}/{scenario.zones.length} zones reachable
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Resource Status */}
          <div className="dm-intel-card" style={{ '--ic': 'var(--teal)' } as CSSProperties}>
            <div className="dm-intel-header">
              <div className="dm-intel-icon">
                <Package size={20} />
              </div>
              <div>
                <h3 className="dm-intel-title">Resource Status</h3>
                <div className="dm-intel-sub">Pool utilization telemetry</div>
              </div>
            </div>
            <div className="dm-intel-rows">
              <div className="dm-intel-row">
                <span className="k">Ambulances Available</span>
                <span className="v">
                  {ambUsed} / {scenario.resources.ambulances}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Rescue Teams Deployed</span>
                <span className="v">
                  {rescueUsed} / {scenario.resources.rescue_teams}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Medical Kits Allocated</span>
                <span className="v">
                  {medKitsUsed} / {scenario.resources.medical_kits}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Shelter Capacity Free</span>
                <span className="v">{formatNumber(Math.max(0, totalShelterCap))} beds</span>
              </div>
            </div>
          </div>

          {/* Card 3: AI Recommendation */}
          <div className="dm-intel-card" style={{ '--ic': 'var(--violet)' } as CSSProperties}>
            <div className="dm-intel-header">
              <div className="dm-intel-icon">
                <Zap size={20} />
              </div>
              <div>
                <h3 className="dm-intel-title">AI Recommendation</h3>
                <div className="dm-intel-sub">Decision support briefing</div>
              </div>
            </div>
            <div className="dm-intel-rows">
              <div className="dm-intel-row">
                <span className="k">Most Urgent Zone</span>
                <span className="v" style={{ color: 'var(--violet)' }}>
                  {topZone ? `${topZone.name} (${topZone.priority_score.toFixed(0)}/100)` : '—'}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Deployment Priority</span>
                <span className="v">
                  {topZone ? `Priority dispatch to ${topZone.name}` : 'Standard distribution'}
                </span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Coverage Summary</span>
                <span className="v">{sol?.metrics ? formatPct(sol.metrics.demand_satisfied_pct) : 'Pending'}</span>
              </div>
              <div className="dm-intel-row">
                <span className="k">Optimization Status</span>
                <span className="v">
                  {compare?.qaoa.status === 'success'
                    ? 'QAOA Converged'
                    : compare?.classical
                      ? 'Classical Feasible'
                      : 'Awaiting Run'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: MISSION TIMELINE ────────────────────────────── */}
      <section className="dm-timeline-card">
        <div className="ov-section-label" style={{ marginBottom: 4 }}>
          Mission Timeline
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0', color: 'var(--ink)' }}>
          Operation Lifecycle &amp; Dispatch Progression
        </h3>

        <div className="dm-timeline-steps">
          {/* Step 1 */}
          <div className="dm-timeline-step done">
            <span className="dm-step-num">Step 01 · Initialized</span>
            <div className="dm-step-title">Scenario Created</div>
            <div className="dm-step-detail">{scenario.name}</div>
          </div>

          {/* Step 2 */}
          <div className={`dm-timeline-step ${blockedRoads.length > 0 ? 'active' : 'done'}`}>
            <span className="dm-step-num">Step 02 · Geospatial</span>
            <div className="dm-step-title">Roads Updated</div>
            <div className="dm-step-detail">
              {blockedRoads.length > 0 ? `${blockedRoads.length} road(s) blocked` : 'All roads open'}
            </div>
          </div>

          {/* Step 3 */}
          <div className={`dm-timeline-step ${optimizing ? 'active' : compare ? 'done' : ''}`}>
            <span className="dm-step-num">Step 03 · Pipeline</span>
            <div className="dm-step-title">Optimization Run</div>
            <div className="dm-step-detail">
              {optimizing ? 'Solver running…' : compare ? `${compare.comparison.winner.toUpperCase()} solver` : 'Pending'}
            </div>
          </div>

          {/* Step 4 */}
          <div className={`dm-timeline-step ${compare ? 'done' : ''}`}>
            <span className="dm-step-num">Step 04 · Deployment</span>
            <div className="dm-step-title">Allocation Generated</div>
            <div className="dm-step-detail">
              {compare ? `${sol?.assignments.length ?? 0} active dispatches` : 'Awaiting solver'}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
