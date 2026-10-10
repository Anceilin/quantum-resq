import type { CSSProperties, ReactNode } from 'react'

/* ---------------- Icon (ported SVG glyph set from the reference UI) -------- */
const PATHS: Record<string, ReactNode> = {
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .6 3.2 2.3 3.5 5.2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  atom: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="3.8" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="1.3" />
    </>
  ),
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22 }: { name: IconName | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] ?? PATHS.box}
    </svg>
  )
}

/* tone name -> CSS design variable */
export function toneColor(tone?: string): string {
  switch (tone) {
    case 'teal':
      return 'var(--teal)'
    case 'violet':
    case 'quantum':
      return 'var(--violet)'
    case 'rose':
      return 'var(--rose)'
    case 'amber':
    case 'warn':
      return 'var(--amber)'
    case 'ok':
      return 'var(--ok)'
    case 'crit':
      return 'var(--warn)'
    case 'accent':
      return 'var(--accent)'
    default:
      return 'var(--sky)'
  }
}

/* ---------------- Spinner ---------------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--muted)' }}>
      <span
        className="inline-block animate-spin"
        style={{
          width: 14,
          height: 14,
          border: '2px solid var(--line)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
        }}
      />
      {label}
    </span>
  )
}

/* ---------------- ErrorBanner (shows the REAL backend/QAOA error) --------- */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      className="card"
      role="alert"
      style={{ borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)' }}
    >
      <div className="head" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ color: 'var(--warn)', fontWeight: 600 }}>Execution failed</span>
          <span style={{ color: 'var(--muted2)' }} className="break-words">
            {message}
          </span>
        </div>
        {onDismiss && (
          <button className="chip static" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- KpiCard (reference .card.kpi) ---------------- */
export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'sky',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: string
}) {
  return (
    <div className="card kpi animate-in" style={{ '--c': toneColor(tone) } as CSSProperties}>
      {icon && <div className="ico">{icon}</div>}
      <div style={{ minWidth: 0 }}>
        <div className="lbl">{label}</div>
        <div className="num">{value}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  )
}

/* ---------------- Bar ---------------- */
export function Bar({ v, color = 'var(--accent)' }: { v: number; color?: string }) {
  return (
    <div className="track">
      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
    </div>
  )
}

/* ---------------- Ring ---------------- */
export function Ring({ pct, color, label }: { pct: number; color: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="ringbox">
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${label} ${clamped.toFixed(1)}%`}>
        <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(301.6 * clamped) / 100} 301.6`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="66" textAnchor="middle" fontSize="18" fontWeight="600" fill="var(--ink)">
          {clamped.toFixed(1)}%
        </text>
      </svg>
      <div className="sub">{label}</div>
    </div>
  )
}

/* ---------------- StatusBadge ---------------- */
export function StatusBadge({
  status,
}: {
  status: 'ok' | 'failed' | 'warn' | 'idle' | 'running'
}) {
  const map: { cls: string; label: string } = {
    ok: { cls: 'badge', label: 'Feasible' },
    failed: { cls: 'badge bad', label: 'Failed' },
    warn: { cls: 'badge bad', label: 'Infeasible' },
    idle: { cls: 'badge info', label: 'Idle' },
    running: { cls: 'badge info', label: 'Running' },
  }[status]
  return <span className={map.cls}>{map.label}</span>
}

/* ---------------- SectionTitle (reference .head) ---------------- */
export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

/* ---------------- Pill (reference .badge) ---------------- */
export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: string }) {
  const cls =
    tone === 'accent' || tone === 'quantum'
      ? 'badge info'
      : tone === 'ok'
        ? 'badge'
        : tone === 'warn' || tone === 'crit'
          ? 'badge bad'
          : 'badge info'
  return <span className={cls}>{children}</span>
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
      {message}
    </div>
  )
}
