import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useApp } from '../context/AppContext'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Orchestrates the automated ~3-minute walkthrough (spec section 24). Every
 * step performs a real operation against the backend — nothing is faked.
 */
export function useDemo() {
  const nav = useNavigate()
  const { demoRunning, setDemo, resetDemo, runCompare, blockRoad, reoptimize } = useApp()

  const run = useCallback(async () => {
    if (demoRunning) return
    try {
      setDemo(true, 'Loading simulated disaster scenario…')
      await resetDemo()
      nav('/')
      await wait(2400)

      setDemo(true, 'Affected zones, priority scores & available resources')
      await wait(2800)

      nav('/map')
      setDemo(true, 'Disaster map — zones, road network and supply depot')
      await wait(3200)

      nav('/optimization')
      setDemo(true, 'Running classical baseline + QAOA on the same instance…')
      await runCompare()
      await wait(2600)

      nav('/quantum')
      setDemo(true, 'QUBO → QAOA circuit → measurement → decoded allocation')
      await wait(4200)

      nav('/optimization')
      setDemo(true, 'Classical vs Quantum-Assisted QAOA comparison')
      await wait(3200)

      const scen = await api.getScenario('scn_demo')
      const top = [...scen.zones].sort((a, b) => b.priority_score - a.priority_score)[0]
      // Isolate the top-priority zone by blocking EVERY road that touches it.
      const incident = scen.roads.filter(
        (r) => !r.blocked && (r.target === top?.id || r.source === top?.id),
      )

      nav('/map')
      setDemo(true, `Simulating a road blockage around ${top?.name ?? 'the top zone'}…`)
      for (const road of incident) {
        await blockRoad(road.id, true)
      }
      if (incident.length === 0 && top) {
        // Already isolated (e.g. replayed demo): reopen then re-block one road for a live change.
        const anyRoad = scen.roads.find((r) => r.target === top.id || r.source === top.id)
        if (anyRoad) {
          await blockRoad(anyRoad.id, false)
          await blockRoad(anyRoad.id, true)
        }
      }
      await wait(2800)

      nav('/optimization')
      setDemo(true, 'Re-optimizing with the changed road state…')
      await reoptimize()
      await wait(4200)

      setDemo(true, 'Allocation changed — see the before/after diff and explanation')
      await wait(3600)
    } catch {
      /* errors are surfaced through the app error banner */
    } finally {
      setDemo(false, null)
    }
  }, [demoRunning, setDemo, resetDemo, runCompare, blockRoad, reoptimize, nav])

  return { run, demoRunning }
}
