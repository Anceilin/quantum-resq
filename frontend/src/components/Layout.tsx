import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { RefreshCw, LogOut, Settings as SettingsIcon, X, Info } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { disasterLabel } from '../utils/format'
import { Spinner } from './ui'
import { THEMES, applyTheme, storedTheme } from '../theme'
import type { Role } from '../types'

type NavItem = { to: string; label: string; color: string; end?: boolean }

// Nav groups per role — role-aware, returns appropriate items for each user type
function navGroupsForRole(role: Role | undefined): { title: string; items: NavItem[] }[] {
  if (role === 'medical_coordinator') {
    return [
      {
        title: 'Medical Operations',
        items: [
          { to: '/medical', label: 'Medical Overview', color: 'var(--rose)', end: true },
          { to: '/map', label: 'Disaster Map', color: 'var(--teal)' },
        ],
      },
    ]
  }
  if (role === 'resource_coordinator') {
    return [
      {
        title: 'Resource Operations',
        items: [
          { to: '/resources', label: 'Resource Stock', color: 'var(--teal)', end: true },
          { to: '/map', label: 'Disaster Map', color: 'var(--sky)' },
        ],
      },
    ]
  }
  if (role === 'rescue_coordinator') {
    return [
      {
        title: 'Rescue Operations',
        items: [
          { to: '/rescue', label: 'Mission Control', color: 'var(--amber)', end: true },
          { to: '/map', label: 'Disaster Map', color: 'var(--teal)' },
        ],
      },
    ]
  }
  if (role === 'shelter_coordinator') {
    return [
      {
        title: 'Shelter Operations',
        items: [
          { to: '/shelter', label: 'Shelter Dashboard', color: 'var(--sky)', end: true },
          { to: '/map', label: 'Disaster Map', color: 'var(--teal)' },
        ],
      },
    ]
  }
  // Default — disaster_management_officer or fallback: full nav
  return [
    {
      title: 'Command Center',
      items: [
        { to: '/overview', label: 'Overview', color: 'var(--sky)', end: true },
        { to: '/map', label: 'Disaster Map', color: 'var(--teal)' },
        { to: '/optimization', label: 'Optimization', color: 'var(--violet)' },
      ],
    },
    {
      title: 'Quantum',
      items: [{ to: '/quantum', label: 'Quantum Engine', color: 'var(--rose)' }],
    },
    {
      title: 'Analysis',
      items: [
        { to: '/scenarios', label: 'Scenarios', color: 'var(--amber)' },
        { to: '/analytics', label: 'Analytics', color: 'var(--ok)' },
      ],
    },
  ]
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

export default function Layout() {
  const { scenario, dirty, optimizing, reoptimize, demoRunning, demoStep } = useApp()
  const { user, permissions, logout } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useState(storedTheme())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [simOpen, setSimOpen] = useState(false)

  const role = permissions?.role
  const navGroups = navGroupsForRole(role)

  // Only DMO has re-optimize access in the header toolbar
  const isDMO = role === 'disaster_management_officer' || role === undefined

  const pickTheme = (n: string) => {
    applyTheme(n)
    setTheme(n)
  }

  const signOut = () => {
    logout()
    navigate('/welcome')
  }

  return (
    <div className="app">
      {/* ---------- Sidebar ---------- */}
      <aside className="side">
        <div className="side-top">
          <div className="brand">Q-RESCUE</div>
          <div className="sub">Quantum-Assisted Emergency Resource Allocation</div>
        </div>

        <nav className="nav">
          {navGroups.map((group) => (
            <div className="nav-grp" key={group.title}>
              <div className="nav-sec">{group.title}</div>
              {group.items.map(({ to, label, color, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  style={{ '--c': color } as CSSProperties}
                  className={({ isActive }) => (isActive ? 'active' : undefined)}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="foot">
          {user && (
            <div className="profile">
              <div className="avatar" aria-hidden>{initials(user.full_name)}</div>
              <div className="profile-meta">
                <div className="profile-name">{user.full_name}</div>
                <div className="profile-role">{permissions?.role_label}</div>
              </div>
              <div className="profile-actions">
                <button
                  className="iconbtn"
                  onClick={() => setSettingsOpen(true)}
                  title="Profile & settings"
                  aria-label="Profile and settings"
                >
                  <SettingsIcon size={16} />
                </button>
                <button className="iconbtn" onClick={signOut} title="Sign out" aria-label="Sign out">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Settings popover (theme + full profile) — presentation only, no routing change */}
      {settingsOpen && (
        <>
          <div className="pop-back" onClick={() => setSettingsOpen(false)} />
          <div className="pop pop-settings" role="dialog" aria-label="Profile and settings">
            <div className="pop-h">
              Profile &amp; settings
              <button className="pop-x" onClick={() => setSettingsOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            {user && (
              <div className="pop-body">
                <div className="pop-row"><span className="k">Name</span><span className="v">{user.full_name}</span></div>
                <div className="pop-row"><span className="k">Role</span><span className="v">{permissions?.role_label}</span></div>
                <div className="pop-row"><span className="k">Organization</span><span className="v">{user.organization}</span></div>
                <div className="pop-row"><span className="k">Email</span><span className="v">{user.email}</span></div>
                <div className="pop-lbl">Theme</div>
                <div className="themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.n}
                      className={theme === t.n ? 'sw on' : 'sw'}
                      style={{ background: t.accent }}
                      title={t.n}
                      onClick={() => pickTheme(t.n)}
                    />
                  ))}
                </div>
                <div className="sub" style={{ marginTop: 10 }}>
                  Active theme: <b style={{ color: 'var(--accent)' }}>{theme}</b>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- Main ---------- */}
      <main className="main">
        <header className="top">
          <div style={{ minWidth: 0 }}>
            <h1>{scenario ? scenario.name : 'Emergency Command Center'}</h1>
            <div className="sub">
              {scenario
                ? `${scenario.zones.length} zones · ${disasterLabel(scenario.disaster_type)} · budget $${scenario.budget.toLocaleString()}`
                : 'Loading scenario…'}
            </div>
          </div>
          <div className="btns">
            <span className="sim-wrap">
              <button
                className="sim-badge"
                onClick={() => setSimOpen((v) => !v)}
                title="Data source notice"
                aria-expanded={simOpen}
              >
                <Info size={13} /> DEMO DATA
              </button>
              {simOpen && (
                <>
                  <div className="pop-back" onClick={() => setSimOpen(false)} />
                  <div className="pop pop-sim" role="dialog" aria-label="Simulation notice">
                    <div className="pop-h">
                      Simulated data
                      <button className="pop-x" onClick={() => setSimOpen(false)} aria-label="Close">
                        <X size={14} />
                      </button>
                    </div>
                    <p style={{ margin: 0 }}>
                      {scenario
                        ? `The "${scenario.name}" scenario uses a simulated disaster event and simulated resource pools.`
                        : 'The current disaster scenario uses simulated data.'}{' '}
                      Allocation is solved by an exact classical baseline and a small-scale{' '}
                      <b style={{ color: 'var(--violet)' }}>QAOA simulation on Qiskit Aer</b>. No quantum advantage is
                      claimed.
                    </p>
                  </div>
                </>
              )}
            </span>
            {isDMO && optimizing && <Spinner label="Optimizing…" />}
            {isDMO && !optimizing && dirty && <span className="badge bad">Scenario changed</span>}
            {isDMO && (
              <button
                className={dirty ? 'btn cy' : 'btn'}
                onClick={async () => {
                  await reoptimize()
                  navigate('/optimization')
                }}
                disabled={optimizing || !scenario || demoRunning}
                title="Re-run optimization on the current scenario"
              >
                <RefreshCw size={15} className={optimizing ? 'animate-spin' : undefined} />
                RE-OPTIMIZE
              </button>
            )}
          </div>
        </header>

        <Outlet />
      </main>

      {demoRunning && demoStep && (
        <div className="toast" style={{ left: '50%', right: 'auto', transform: 'translateX(-50%)' }}>
          <div className="sub" style={{ color: 'var(--violet)', fontWeight: 600 }}>
            Demo in progress
          </div>
          {demoStep}
        </div>
      )}
    </div>
  )
}
