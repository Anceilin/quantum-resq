import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { ROLE_META, ROLE_ORDER, isRole } from '../roles'
import { ROLE_LABELS } from '../types'
import type { Role } from '../types'

const DEMO_NOTICE =
  'SIMULATION / DEMO DATA — a quantum-assisted optimization prototype using small-scale QAOA simulation.'

export default function RoleGateway() {
  const navigate = useNavigate()

  return (
    <div className="gw-wrap">
      {/* Header */}
      <div className="gw-head">
        <div className="gw-logo">
          <Activity size={24} />
        </div>
        <div>
          <div className="gw-brand">Q-RESCUE</div>
          <div className="gw-sub">Quantum-Assisted Emergency Resource Allocation</div>
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 className="gw-title">Who is signing in today?</h1>
        <p className="gw-lead">
          Choose your role. You will see only what your team needs during a disaster.
        </p>
      </div>

      {/* Role grid */}
      <div id="role-grid" className="gw-grid">
        {(ROLE_ORDER as Role[]).filter(isRole).map((role) => {
          const meta = ROLE_META[role]
          const Icon = meta.icon
          return (
            <button
              key={role}
              type="button"
              className="gw-card"
              style={{ '--rc': meta.color } as CSSProperties}
              onClick={() => navigate(`/login/${role}`)}
            >
              <Icon size={22} />
              <b>{ROLE_LABELS[role]}</b>
              <span>{meta.blurb}</span>
            </button>
          )
        })}

        {/* Dashed note card */}
        <div className="gw-card gw-note" style={{ '--rc': 'var(--line)' } as CSSProperties}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            Tap a role above, then choose <strong>Register</strong>.
          </span>
        </div>
      </div>

      {/* Footer */}
      <p className="gw-foot">
        New official? Pick your role above, then{' '}
        <a
          href="#role-grid"
          className="gw-back"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('role-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
        >
          Register
        </a>
        .
      </p>

      {/* Amber demo notice */}
      <div className="gw-demo">{DEMO_NOTICE}</div>
    </div>
  )
}
