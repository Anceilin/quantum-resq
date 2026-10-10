import type { CSSProperties } from 'react'
import { NavLink } from 'react-router-dom'
import { Archive, Layers, Wand2 } from 'lucide-react'

// Sub-navigation for the Scenarios section:
//   Scenarios ├─ Active Scenarios ├─ What-If Scenarios └─ Historical Records
// The first two are views inside the Scenarios page; Historical Records is a
// separate page. The sidebar/dashboard stays focused on live operations — this
// strip only appears within the Scenarios area.
export type ScenarioView = 'active' | 'whatif' | 'historical'

export default function ScenarioTabs({
  view,
  onTab,
}: {
  view: ScenarioView
  onTab: (v: 'active' | 'whatif') => void
}) {
  const isTabActive = (v: 'active' | 'whatif') => view === v
  return (
    <div className="scn-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
      <button className={`btn ${isTabActive('active') ? 'cy' : ''}`} onClick={() => onTab('active')}>
        <Layers size={15} /> Active Scenarios
      </button>
      <button className={`btn ${isTabActive('whatif') ? 'cy' : ''}`} onClick={() => onTab('whatif')}>
        <Wand2 size={15} /> What-If Scenarios
      </button>
      <NavLink
        to="/scenarios/historical"
        className={() => (view === 'historical' ? 'btn vi' : 'btn')}
        style={{ textDecoration: 'none' } as CSSProperties}
      >
        <Archive size={15} /> Historical Records
      </NavLink>
    </div>
  )
}
