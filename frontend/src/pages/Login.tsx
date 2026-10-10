import { useState, type FormEvent } from 'react'
import { Navigate, Link, useParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui'
import RoleShell from '../components/RoleShell'
import { isRole, ROLE_META } from '../roles'
import { ROLE_LABELS } from '../types'
import type { Role } from '../types'

const DEMO_NOTICE =
  'SIMULATION / DEMO DATA — a quantum-assisted optimization prototype using small-scale QAOA simulation.'

export default function Login() {
  const { role: roleParam } = useParams<{ role: string }>()

  if (!isRole(roleParam)) {
    return <Navigate to="/welcome" replace />
  }

  const role = roleParam as Role

  return <LoginForm role={role} />
}

function LoginForm({ role }: { role: Role }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const meta = ROLE_META[role]
  const label = ROLE_LABELS[role]

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password, role)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <RoleShell role={role} sub={meta.blurb} title="Sign in" demo={DEMO_NOTICE}>
      {error && <div className="gw-err">{error}</div>}
      <form onSubmit={onSubmit} className="gw-form">
        <div className="field-group">
          <label htmlFor="email">Official email</label>
          <input
            id="email"
            type="email"
            placeholder="name@agency.gov.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field-group">
          <label htmlFor="password">Password</label>
          <div className="gw-pw">
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="gw-pw-eye"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button type="submit" className="gw-cta" disabled={busy}>
          {busy ? <Spinner /> : `Sign in as ${label.toLowerCase()}`}
        </button>
      </form>

      <p className="gw-alt">
        No account?{' '}
        <Link to={`/register/${role}`}>Register as {label.toLowerCase()}</Link>
      </p>
    </RoleShell>
  )
}
