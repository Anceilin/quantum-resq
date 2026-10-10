import { useState, type FormEvent } from 'react'
import { Navigate, Link, useParams } from 'react-router-dom'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui'
import RoleShell from '../components/RoleShell'
import { isRole, ROLE_META } from '../roles'
import { ROLE_LABELS } from '../types'
import type { Role } from '../types'

const DEMO_NOTICE =
  'SIMULATION / DEMO DATA — passwords are hashed with bcrypt and never stored in plaintext.'

function strengthScore(pw: string): number {
  let score = 0
  if (pw.length >= 6) score++
  if (pw.length >= 10) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) score++
  return score
}

export default function Register() {
  const { role: roleParam } = useParams<{ role: string }>()

  if (!isRole(roleParam)) {
    return <Navigate to="/welcome" replace />
  }

  const role = roleParam as Role

  return <RegisterForm role={role} />
}

function RegisterForm({ role }: { role: Role }) {
  const { register } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [organization, setOrganization] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const meta = ROLE_META[role]
  const label = ROLE_LABELS[role]
  const score = strengthScore(password)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await register({ full_name: fullName, email, password, organization, role })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <RoleShell role={role} sub="Registering for this role" title="Official registration" demo={DEMO_NOTICE}>
      {error && <div className="gw-err">{error}</div>}
      <form onSubmit={onSubmit} className="gw-form">
        <div className="field-group">
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

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
              autoComplete="new-password"
              minLength={6}
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
          {/* 4-segment strength meter */}
          <div className="gw-meter" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`gw-meter-seg${score > i ? ' on' : ''}`} />
            ))}
          </div>
        </div>

        <div className="field-group">
          <label htmlFor="organization">Organization / agency</label>
          <input
            id="organization"
            type="text"
            placeholder="State Disaster Response Force"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            required
          />
        </div>

        <div className="field-group">
          <label>Role</label>
          <div className="gw-lock">
            <Lock size={14} />
            <span>{label}</span>
          </div>
          <div className="gw-hint">{meta.focus}</div>
        </div>

        <button type="submit" className="gw-cta" disabled={busy}>
          {busy ? <Spinner /> : 'Create account'}
        </button>
      </form>

      <p className="gw-alt">
        Already registered?{' '}
        <Link to={`/login/${role}`}>Sign in</Link>
      </p>
    </RoleShell>
  )
}
