import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { ErrorBanner, Spinner } from './components/ui'
import Overview from './pages/Overview'
import DisasterMap from './pages/DisasterMap'
import Optimization from './pages/Optimization'
import QuantumEngine from './pages/QuantumEngine'
import Scenarios from './pages/Scenarios'
import HistoricalRecords from './pages/HistoricalRecords'
import Analytics from './pages/Analytics'
import Login from './pages/Login'
import Register from './pages/Register'
import RoleGateway from './pages/RoleGateway'
import MedicalDashboard from './pages/MedicalDashboard'
import ResourceDashboard from './pages/ResourceDashboard'
import RescueDashboard from './pages/RescueDashboard'
import ShelterDashboard from './pages/ShelterDashboard'

function GlobalErrorBanner() {
  const { error, setError } = useApp()
  if (!error) return null
  return (
    <div className="fixed bottom-4 right-4 z-[1200] max-w-sm">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </div>
  )
}

/** After login, redirect each role to their home page. */
function roleHome(role: string | undefined): string {
  switch (role) {
    case 'medical_coordinator':
      return '/medical'
    case 'resource_coordinator':
      return '/resources'
    case 'rescue_coordinator':
      return '/rescue'
    case 'shelter_coordinator':
      return '/shelter'
    default:
      return '/overview'
  }
}

function ProtectedRoute() {
  const { status, permissions } = useAuth()
  if (status === 'loading') {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <Spinner label="Restoring session…" />
      </div>
    )
  }
  if (status === 'unauthenticated') return <Navigate to="/welcome" replace />
  return (
    <>
      <GlobalErrorBanner />
      <Outlet context={{ role: permissions?.role }} />
    </>
  )
}

/** Redirect '/' to role-specific home after login. */
function RoleRedirect() {
  const { permissions } = useAuth()
  return <Navigate to={roleHome(permissions?.role)} replace />
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status, permissions } = useAuth()
  if (status === 'authenticated') return <Navigate to={roleHome(permissions?.role)} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <Routes>
            {/* Role gateway */}
            <Route
              path="/welcome"
              element={
                <PublicOnly>
                  <RoleGateway />
                </PublicOnly>
              }
            />

            {/* Role-aware login / register */}
            <Route
              path="/login/:role"
              element={
                <PublicOnly>
                  <Login />
                </PublicOnly>
              }
            />
            <Route
              path="/register/:role"
              element={
                <PublicOnly>
                  <Register />
                </PublicOnly>
              }
            />

            {/* Legacy /login and /register redirect to /welcome */}
            <Route path="/login" element={<Navigate to="/welcome" replace />} />
            <Route path="/register" element={<Navigate to="/welcome" replace />} />

            {/* Protected app routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                {/* DMO root — redirect coordinator roles to their home */}
                <Route index element={<RoleRedirect />} />

                {/* DMO pages */}
                <Route path="overview" element={<Overview />} />
                <Route path="map" element={<DisasterMap />} />
                <Route path="optimization" element={<Optimization />} />
                <Route path="quantum" element={<QuantumEngine />} />
                <Route path="scenarios" element={<Scenarios />} />
                <Route path="scenarios/historical" element={<HistoricalRecords />} />
                <Route path="analytics" element={<Analytics />} />

                {/* Role-specific coordinator pages */}
                <Route path="medical" element={<MedicalDashboard />} />
                <Route path="resources" element={<ResourceDashboard />} />
                <Route path="rescue" element={<RescueDashboard />} />
                <Route path="shelter" element={<ShelterDashboard />} />

                {/* Fallback: redirect unknown paths to role home */}
                <Route path="*" element={<RoleRedirect />} />
              </Route>
            </Route>
          </Routes>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
