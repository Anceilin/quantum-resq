// Presentational theme switcher. Only swaps CSS design-token variables on the
// document root — it never touches scenario, optimization, QUBO or QAOA data.

export const THEME_KEYS = [
  'bg',
  'card',
  'card2',
  'line',
  'ink',
  'muted',
  'muted2',
  'side',
  'mapbg',
  'sky',
  'teal',
  'violet',
  'rose',
  'amber',
  'ok',
  'warn',
  'accent',
] as const

export type Theme = {
  n: string
  mode: 'light' | 'dark'
} & Record<(typeof THEME_KEYS)[number], string>

// Shared dark-theme ink tokens
const DARK_INK = {
  ink: '#EEF2FA',
  muted: '#93A0BA',
  muted2: '#BAC4D8',
} as const

export const THEMES: Theme[] = [
  // -------- Light (default) --------
  {
    n: 'Light',
    mode: 'light',
    ink: '#14181F',
    muted: '#5B6578',
    muted2: '#3A4354',
    bg: '#F4F6FA',
    card: '#FFFFFF',
    card2: '#EEF1F6',
    line: '#DDE2EA',
    side: '#FFFFFF',
    mapbg: '#E9EEF5',
    sky: '#2F6FEB',
    teal: '#0F8F83',
    violet: '#6D55D6',
    rose: '#C2456B',
    amber: '#A8700A',
    ok: '#1E8E4A',
    warn: '#C93C3C',
    accent: '#2F6FEB',
  },
  // -------- Dark themes --------
  {
    n: 'Graphite',
    mode: 'dark',
    ...DARK_INK,
    bg: '#0E0F12',
    card: '#16181D',
    card2: '#1D2027',
    line: '#2A2E37',
    side: '#121418',
    mapbg: '#13161B',
    sky: '#8AB4F8',
    teal: '#7FD1C7',
    violet: '#B4A7E5',
    rose: '#E5A0B5',
    amber: '#E8C27A',
    ok: '#93D3A2',
    warn: '#F2A3A3',
    accent: '#8AB4F8',
  },
  {
    n: 'Midnight',
    mode: 'dark',
    ...DARK_INK,
    bg: '#0A0F1E',
    card: '#111830',
    card2: '#17203A',
    line: '#243050',
    side: '#0D1428',
    mapbg: '#0B1226',
    sky: '#7DD3FC',
    teal: '#5EEAD4',
    violet: '#B7A4F8',
    rose: '#F9A8C4',
    amber: '#FCD38A',
    ok: '#86EFAC',
    warn: '#FCA5A5',
    accent: '#5EEAD4',
  },
  {
    n: 'Ocean',
    mode: 'dark',
    ...DARK_INK,
    bg: '#07161C',
    card: '#0D242C',
    card2: '#12303A',
    line: '#1C4350',
    side: '#0A1D24',
    mapbg: '#0A1E26',
    sky: '#6CC8F2',
    teal: '#4FD1C5',
    violet: '#9BB1F5',
    rose: '#F2A1B8',
    amber: '#F1CB7C',
    ok: '#7ED9A0',
    warn: '#F5A3A3',
    accent: '#4FD1C5',
  },
  {
    n: 'Plum',
    mode: 'dark',
    ...DARK_INK,
    bg: '#130E1F',
    card: '#1C1530',
    card2: '#251C3F',
    line: '#36295A',
    side: '#170F29',
    mapbg: '#1A1230',
    sky: '#8FB8F5',
    teal: '#7ADBD0',
    violet: '#C3A6FA',
    rose: '#F5A3C7',
    amber: '#F5CD85',
    ok: '#8FDDA5',
    warn: '#F7A8A8',
    accent: '#C3A6FA',
  },
  {
    n: 'Forest',
    mode: 'dark',
    ...DARK_INK,
    bg: '#0A1410',
    card: '#101E18',
    card2: '#16291F',
    line: '#22392D',
    side: '#0C1913',
    mapbg: '#0E1D16',
    sky: '#7CC4E8',
    teal: '#6FD6B5',
    violet: '#AEB4F0',
    rose: '#EDA4AE',
    amber: '#E9CB78',
    ok: '#9ADE86',
    warn: '#F2A5A5',
    accent: '#6FD6B5',
  },
]

const STORAGE_KEY = 'qr-theme-v2'

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

export function applyTheme(name: string): void {
  const t = THEMES.find((x) => x.n === name) ?? THEMES[0]
  const root = document.documentElement
  for (const k of THEME_KEYS) root.style.setProperty(`--${k}`, t[k])
  root.style.setProperty('--accent-soft', `rgba(${hexToRgb(t.accent)}, .14)`)
  root.dataset.theme = t.mode
  root.style.colorScheme = t.mode
  try {
    localStorage.setItem(STORAGE_KEY, t.n)
  } catch {
    /* storage unavailable — presentation only, ignore */
  }
}

export function storedTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? THEMES[0].n
  } catch {
    return THEMES[0].n
  }
}
