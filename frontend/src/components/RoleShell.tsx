import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_META } from '../roles'
import { ROLE_LABELS } from '../types'
import type { Role } from '../types'

interface RoleShellProps {
  role: Role
  sub: string
  title: string
  demo: string
  children: ReactNode
}

const DEMO_NOTICE =
  'SIMULATION / DEMO DATA — a quantum-assisted optimization prototype using small-scale QAOA simulation.'

export default function RoleShell({ role, sub, title, demo, children }: RoleShellProps) {
  const meta = ROLE_META[role]
  const Icon = meta.icon

  return (
    <div
      className="gw-wrap"
      style={{ '--rc': meta.color } as CSSProperties}
    >
      {/* Back link */}
      <div style={{ width: '100%', maxWidth: 400 }}>
        <Link to="/welcome" className="gw-back">
          ← All roles
        </Link>
      </div>

      <div className="gw-panel">
        {/* Role banner */}
        <div className="gw-role">
          <Icon size={20} />
          <div>
            <div className="gw-role-label">{ROLE_LABELS[role]}</div>
            <div className="gw-role-sub">{sub}</div>
          </div>
          <Link to="/welcome" className="gw-change">
            Change
          </Link>
        </div>

        {/* Title */}
        <h2 className="gw-h2">{title}</h2>

        {/* Form / content */}
        {children}

        {/* Demo notice */}
        <div className="gw-demo">{demo || DEMO_NOTICE}</div>
      </div>
    </div>
  )
}

