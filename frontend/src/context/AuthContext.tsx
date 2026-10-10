import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, setToken } from '../services/api'
import type { AuthOut, Permissions, RegisterRequest, Role, UserPublic } from '../types'
import { ROLE_LABELS } from '../types'

type Status = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthState {
  status: Status
  user: UserPublic | null
  permissions: Permissions | null
}

interface AuthActions {
  login: (email: string, password: string, expectedRole?: Role) => Promise<AuthOut>
  register: (body: RegisterRequest) => Promise<void>
  logout: () => void
}

type Ctx = AuthState & AuthActions

const AuthContext = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserPublic | null>(null)
  const [permissions, setPermissions] = useState<Permissions | null>(null)

  const apply = useCallback((data: AuthOut) => {
    if (data.token) setToken(data.token)
    setUser(data.user)
    setPermissions(data.permissions)
    setStatus('authenticated')
  }, [])

  // On mount, restore the session from a stored token.
  useEffect(() => {
    let alive = true
    if (!getToken()) {
      setStatus('unauthenticated')
      return
    }
    api
      .me()
      .then((data) => {
        if (!alive) return
        setUser(data.user)
        setPermissions(data.permissions)
        setStatus('authenticated')
      })
      .catch(() => {
        if (!alive) return
        setToken(null)
        setStatus('unauthenticated')
      })
    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(
    async (email: string, password: string, expectedRole?: Role): Promise<AuthOut> => {
      const data = await api.login(email, password)
      if (expectedRole !== undefined && data.user.role !== expectedRole) {
        throw new Error(
          `This account is registered as ${ROLE_LABELS[data.user.role]}. Go back and choose that role.`,
        )
      }
      apply(data)
      return data
    },
    [apply],
  )

  const register = useCallback(
    async (body: RegisterRequest) => {
      apply(await api.register(body))
    },
    [apply],
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setPermissions(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<Ctx>(
    () => ({ status, user, permissions, login, register, logout }),
    [status, user, permissions, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
