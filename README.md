# Q-RESCUE — QuantumResQ

**Quantum-Assisted Emergency Resource Allocation**

> *"Where should limited resources go when every second matters?"*

**Track:** Quantum AI & Software

**A quantum-assisted optimization prototype using small-scale QAOA simulation.**

> **⚠ SIMULATION / DEMO DATA ONLY.** Every zone, population, demand, road and
> resource figure in this application is synthetic. No real emergency-service
> data is used or implied. **No quantum advantage is claimed.** This prototype
> demonstrates a genuine *classical → QUBO → QAOA → decode → comparison* workflow
> and reports the outcome honestly — including when the classical baseline wins.

---

## 1. Project overview

During floods, cyclones, earthquakes, wildfires and major accidents, an agency
must spread a **limited** pool of ambulances, rescue teams, medical kits, food,
shelter capacity and emergency vehicles across several affected zones at once.
Q-RESCUE frames that triage as a **binary combinatorial optimization problem**
and solves it two ways on the *identical* instance:

1. an **exact classical baseline** (brute-force enumeration), and
2. a **quantum-assisted QAOA** run on the **Qiskit Aer** simulator.

It then decodes the best bitstring into a concrete allocation, explains *why*
each zone did or did not receive resources, and lets you re-run everything after
the disaster changes (a road collapses, hospital capacity drops, ambulances are
pulled back).

---

## 2. Problem statement

Given:

- a set of affected **zones** (population, severity, vulnerable people, medical /
  food / rescue demand, hospital & shelter capacity, road accessibility),
- a finite pool of each **resource** type with per-unit deployment **costs** and a
  **budget**, and
- a **road network** from a central depot (some segments blockable),

decide **which resource bundles to deploy to which zones** so as to:

- **maximise** priority-weighted assistance, demand satisfaction and vulnerable-population coverage, and
- **minimise** travel cost, resource cost and unmet demand,

subject to resource availability, budget, hospital/shelter capacity, road accessibility and per-zone demand constraints.

---

## 3. Why quantum?

Emergency allocation is a **quadratic knapsack / assignment** problem — exactly the
family that maps naturally onto a **QUBO** and, in turn, onto **QAOA**. The point of
this prototype is *not* to beat classical on a 16-qubit instance (a small exact
solver trivially does). It is to show the **full, real pipeline**: turn a live,
changing disaster scenario into a QUBO, execute a parameterised quantum circuit on a
simulator, read out bitstrings, check feasibility, decode them, and compare against
a classical optimum head-to-head. On instances this large the honest result is that
classical ties or wins — and the UI says so.

---

## 4. Architecture

```text
quantum-resq/
├── backend/                      # FastAPI + Qiskit + MongoDB (Python)
│   ├── app/
│   │   ├── main.py               # app factory, CORS, router registration, /api/health
│   │   ├── config.py             # pydantic-settings, .env; secrets never hard-coded
│   │   ├── models/
│   │   │   ├── schemas.py        # Pydantic domain models (Zone, Resources, Road, Scenario…)
│   │   │   └── user_models.py    # Role enum (5 officials), User, Permissions, RBAC map
│   │   ├── api/
│   │   │   ├── auth.py           # register / login / me  (bcrypt + JWT)
│   │   │   ├── dependencies.py   # get_current_user + server-side RBAC guards
│   │   │   ├── scenarios.py      # scenario CRUD, presets, update, reoptimize (auth + RBAC)
│   │   │   ├── simulation.py     # road-block toggle (auth + rescue/officer guard)
│   │   │   └── optimize.py       # classical / qaoa / compare / results / circuit / analytics / resources
│   │   ├── optimization/         # classical side — ONE shared objective (UNCHANGED by the auth feature)
│   │   │   ├── objective.py      # OptimizationInstance, net[] weights, evaluate_bits()
│   │   │   ├── constraints.py    # feasibility rules
│   │   │   └── classical_optimizer.py  # exact brute-force (≤20 vars) + greedy fallback
│   │   ├── quantum/              # quantum side — kept separate from the API layer (UNCHANGED)
│   │   │   ├── qubo_builder.py   # instance → QUBO (+ slack encoding)
│   │   │   ├── circuit_builder.py# QUBO → Ising → QAOA circuit (native rz/cx)
│   │   │   ├── qaoa_optimizer.py # parameter optimisation + Aer execution
│   │   │   └── result_decoder.py # counts → best feasible bitstring → decode
│   │   ├── simulation/
│   │   │   ├── disaster_generator.py  # demo zones/resources/roads + What-If presets
│   │   │   └── road_simulator.py      # Dijkstra accessibility + travel costs
│   │   ├── services/             # orchestration + persistence
│   │   │   ├── optimization_service.py  # run_classical / run_qaoa / compare / reoptimize / analytics
│   │   │   ├── scenario_store.py         # MongoDB-backed scenario + result stores (in-memory fallback)
│   │   │   ├── user_store.py             # MongoDB-backed user store (bcrypt hash only)
│   │   │   ├── db.py                     # lazy pymongo connection (sync driver)
│   │   │   └── security.py               # bcrypt hashing + JWT encode/decode
│   │   └── utils/priority.py     # transparent 0–100 priority score
│   └── tests/                    # pytest suite (Phases 1–10) + auth/RBAC
│
└── frontend/                     # React + TypeScript + Vite
    └── src/
        ├── pages/                # Login, Register, Overview, DisasterMap, Optimization, QuantumEngine, Scenarios, Analytics
        ├── components/           # Layout, AllocationPanel, ComparisonCharts, ReoptPanel, ui
        ├── context/
        │   ├── AppContext.tsx    # dashboard + optimisation state (loads only when authenticated)
        │   └── AuthContext.tsx   # session, JWT, role permissions
        ├── hooks/useDemo.ts      # automated ~3-minute demo
        ├── services/api.ts       # typed fetch wrapper (injects Authorization bearer)
        ├── types/index.ts        # models mirrored from backend (incl. Role, Permissions)
        └── utils/                # format, explain
```

The **classical solver and QAOA consume the exact same `OptimizationInstance`,
objective and feasibility rules**, so the comparison is apples-to-apples.

---

## 5. Tech stack

| Layer     | Technology |
|-----------|------------|
| Frontend  | React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router v7, Lucide React, Recharts v3, React-Leaflet |
| Backend   | Python, FastAPI, Pydantic v2, NumPy, Pandas, SciPy |
| Quantum   | Qiskit 1.2, Qiskit Aer (`AerSimulator`) |
| Auth      | bcrypt password hashing, PyJWT bearer tokens, server-side RBAC |
| Persistence | MongoDB (pymongo) for users, scenarios and optimisation results — with automatic in-memory fallback |
| Simulate  | Dijkstra road network, synthetic disaster generator, What-If presets |

---

## 6. Decision variables & objective

For each resource `r` and included zone `z` a binary variable is used:

```text
x[r][z] = 1  →  deploy one standard *bundle* of resource r to zone z
```

A *bundle* is a fixed quantity (1 ambulance, a 100-kit medical pallet, a 150-spot
shelter block, …). Grouping into bundles keeps the variable count — and therefore the
qubit count — small. Objective (MAXIMISE), separable per variable:

```text
net[r][z] = W_GAIN·priority_norm[z]·demand_norm[r][z]
          − W_TRAVEL·travel_norm[z]
          − W_COST·cost_norm[r]

maximise  Σ  net[r][z] · x[r][z]
```

The displayed scenario may show all six zones, but the **quantum instance is kept
small on purpose**: by default the top-4 priority zones × 4 resources = **16
qubits**. You can change the zone/resource mix live on the Optimization page.

### Priority score (0–100)

A transparent weighted sum of normalised factors — shown per zone in the UI:

| Factor | Weight |
|--------|--------|
| Severity | 0.30 |
| Affected population | 0.20 |
| Vulnerable population (children + elderly + disabled) | 0.15 |
| Medical demand | 0.15 |
| Rescue demand | 0.10 |
| Access difficulty | 0.10 |

---

## 7. QUBO explanation

`qubo_builder.py` converts the maximise-net objective into a **minimise** QUBO
`min xᵀQx` with one binary column per decision variable (slack columns appended
last):

- **Objective (linear):** each eligible variable contributes `−net[r][z]` on the
  diagonal so minimising the QUBO maximises the net gain.
- **Eligibility gates (linear penalty):** hospital/shelter capacity, road
  accessibility and zero-demand gates forbid a variable; a forbidden variable is
  penalised with `penalty_forbid = 10·(Σ|net| + 1)` so no objective gain can
  outweigh taking a forbidden slot.
- **Resource availability (quadratic, slack-encoded):** assigning more bundles of
  `r` than are available is penalised with `penalty_avail·(Σx − cap)²`, expanded
  with slack bits to stay quadratic.
- **Budget / capacity / accessibility re-check at decode:** the heavy combinatorial
  capacity-and-budget coupling is re-verified exactly when a bitstring is decoded,
  so the reported solution is genuinely feasible (documented in the QUBO summary on
  the Quantum Engine page).

The QUBO → Ising map uses `x = (1 − z)/2`, producing a diagonal (ZZ) Hamiltonian.

---

## 8. QAOA explanation

`circuit_builder.py` + `qaoa_optimizer.py` build and run a real, parameterised QAOA
circuit:

1. Prepare `|+⟩ⁿ` with Hadamards.
2. **Cost layer:** the diagonal Ising Hamiltonian is applied with native gates —
   `Rz(2·γ·c)` for `Z` terms and `CX · Rz(2·γ·c) · CX` for `ZZ` terms (Aer cannot
   execute a high-level `PauliEvolutionGate`, so exact native decomposition is
   used).
3. **Mixer layer:** `Rx(2·β)` on every qubit.
4. Repeat for `p` layers (reps), then measure all qubits.
5. A classical optimizer (COBYLA / Powell / Nelder–Mead) tunes `γ, β` to minimise the
   shot-averaged QUBO cost; the circuit runs on **`AerSimulator`** with `shots` reads.
6. `result_decoder.py` scores every distinct measured bitstring against the shared
   objective + feasibility, and selects the **best feasible** one (ties broken by
   frequency). If *no* feasible bitstring appears, it honestly reports the
   least-violating sample rather than inventing one.

Everything shown — Qubit count, layers, shots, optimizer, seed, γ/β, the ASCII
circuit, the measurement histogram and the decoded allocation — comes from the
actual execution.

---

## 9. Classical baseline

`classical_optimizer.py` performs **exact brute-force enumeration** over the
`2ⁿ` assignments for small instances (≤ 20 variables), using a vectorised NumPy
feasibility mask, and falls back to a **greedy** heuristic if an instance is
enlarged beyond the brute-force cap. It uses the same objective and constraints as
QAOA, so a win for classical is meaningful, not rigged.

---

## 10. Authentication, roles & scenario persistence

This layer sits **on top of** the optimization engine. It does **not** touch the
QUBO, QAOA circuit, classical solver or comparison logic — those run identically for
every role.

### Login / register

- **Register** collects Full Name, Email, Password, Organization/Agency and Role, then
  `POST /api/auth/register`. The password is hashed with **bcrypt** (12 rounds) before
  storage — **plaintext passwords are never stored**. Unknown or mismatched
  `IBM_QUANTUM_TOKEN`-style secrets are irrelevant here; auth needs no credentials.
- **Login** (`POST /api/auth/login`) verifies the bcrypt hash and returns a signed
  **JWT** bearer token (HS256). The signing secret comes from `JWT_SECRET` in `.env`
  and is **never hard-coded**; if unset the backend generates an ephemeral one at
  startup (existing tokens then invalidate — fine for local dev).
- The frontend stores the token in `localStorage` (`qresue_token`), restores the
  session on reload via `GET /api/auth/me`, and attaches `Authorization: Bearer …` to
  every request.

### Protected routes & display

Dashboard and every operational page (`/`, `/map`, `/optimization`, `/quantum`,
`/scenarios`, `/analytics`) are wrapped in a `ProtectedRoute`. An unauthenticated
visitor is redirected to **Login**; after login they land on the existing **Overview**.
The header and sidebar show the signed-in official's **name, role label, organization
and email** (e.g. *Welcome, Arun — Disaster Management Officer — Chennai Emergency
Response Agency*), plus **Logout**.

### Server-side RBAC (the single source of truth)

Authorization is enforced **in the backend**, not just hidden in the UI. Every
scenario/simulation mutation route depends on `get_current_user` and a role guard; the
frontend mirrors the same permission object (returned by `/api/auth/me`) only to
disable controls. The role model — `permissions_for_role()` in `user_models.py`:

| Role | Scenario CRUD / reset / presets | Resource quantities | Budget | Zone fields they may edit | Road block/unblock |
|------|:--:|:--:|:--:|------|:--:|
| **Disaster Management Officer** | ✓ | all | ✓ | all | ✓ |
| **Resource Coordinator** | — | all | — | — | — |
| **Medical Coordinator** | — | — | — | `hospital_capacity`, `hospital_occupancy`, `medical_demand` | — |
| **Rescue Coordinator** | — | — | — | `rescue_demand`, `population`, `severity` | ✓ |
| **Shelter Coordinator** | — | — | — | `shelter_capacity`, `shelter_occupancy`, `food_demand` | — |

All roles can **view** every page and **run** optimization / re-optimization / the
demo. Editing a field or taking an action outside a role's scope returns **403**; an
unauthenticated call returns **401**. A full dashboard is shared — roles differ only
in *what they may change*, not in *what they can see*.

### Scenario management & persistence

- The built-in **"Regional Flood Response — Demo"** is seeded on first start and is
  protected from deletion.
- Officials with scenario-management rights can **Create / Edit / Load** scenarios
  covering name, disaster type (Flood, Earthquake, Cyclone, Wildfire, Industrial
  Accident), zones (population, severity, children/elderly/disabled, medical/rescue/
  food demand, road accessibility), resources, hospitals, shelters, budget and road
  status.
- **"Affected People" is computed**, not hardcoded: the Overview KPI sums
  `zone.population` live, so creating or editing zones updates it automatically.
- **Persistence:** users, scenarios and optimisation results are stored in MongoDB
  collections `users`, `scenarios`, `optimization_results`. Created scenarios remain
  after a backend restart. If MongoDB is unavailable, an in-memory store keeps the
  same interface so the app and its tests still run (state resets on restart).

---

## 11. Installation

### Prerequisites

- **Python 3.10+**
- **Node.js 20+** and npm
- **MongoDB** *(optional but recommended)* — a local MongoDB Server on
  `mongodb://127.0.0.1:27017` persists users, created scenarios and optimisation
  results across backend restarts. **If MongoDB is not running the app still works** —
  it transparently falls back to an in-memory store — but created scenarios and
  registered users will not survive a restart. The `GET /api/health` response reports
  which mode is active via its `persistence` field (`"mongodb"` or `"memory"`).
- (Windows note) The pinned `rustworkx==0.15.1` is used because newer builds ship an
  unsigned native extension that Windows Smart App Control blocks. The pin has
  cloud reputation and loads cleanly. Do not upgrade it blindly.

Start MongoDB (if using it) before the backend, e.g.:

```bash
# Windows service, or run manually:
mongod --dbpath C:/data/db --port 27017 --bind_ip 127.0.0.1
```

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # defaults work with the local Aer simulator (no credentials)

uvicorn app.main:app --reload --port 8000
# or:
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Run the tests:

```bash
python -m pytest -q
```

### Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api → :8000)
```

Production build / type-check:

```bash
npm run build                 # tsc -b && vite build
```

---

## 12. Running locally

1. *(Optional)* Start MongoDB on **:27017** (Section 11) for persistence across restarts.
2. Start the backend on **:8000** (Section 11).
3. Start the frontend dev server on **:5173**.
4. Open **http://localhost:5173**. Register or log in, then the app loads the demo
   scenario and runs a real classical + QAOA comparison.

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`, so no CORS
configuration is needed in development.

---

## 13. Pages

| Page | What it shows |
|------|---------------|
| **Login** | Email + password sign-in; link to register. Unauthenticated visitors are routed here. |
| **Register** | Full name, email, password, organization/agency and one of the five official roles. |
| **Overview** | Eight live KPI cards (affected people — computed from zone populations, active zones, resources available/allocated, demand covered, priority coverage, QAOA objective, unserved demand) + the classical-vs-QAOA verdict. |
| **Disaster Map** | Interactive Leaflet map: zones (severity-coloured, size = population), roads (open / blocked, primary vs cross-link), the supply depot. Click a zone for full details and its current allocation; toggle any road OPEN/BLOCKED. |
| **Optimization** | Configure the small instance (zones, resources, reps, shots, optimizer, max-iter, seed), run it, and inspect the verdict, comparison charts, and decoded allocations with "Why this allocation?" reasoning. A re-optimization panel shows before/after diffs. |
| **Quantum Engine** | QUBO summary, QAOA parameters, energy-convergence chart, the generated circuit (ASCII), the measurement histogram, and the best decoded solution. |
| **Scenarios** | What-If presets (Normal, Major Road Block, 30% Resource Shortage, Hospital Capacity Reduced, New Critical Zone), resource-shortage sliders, budget, and a zone-parameter editor. |
| **Analytics** | Demand-vs-allocation, resource utilisation, priority-vs-coverage, allocation-by-zone charts, and a shortage recommendation panel. |

---

## 14. Demo instructions

After logging in as a **Disaster Management Officer** or **Rescue Coordinator** (the
roles allowed to block roads, which the demo does), press **RUN 3-MINUTE DEMO** in the
header (or walk it manually):

1. Load the disaster scenario → **Overview** shows zones, priority scores and resources.
2. **Disaster Map** shows zones, roads and depot.
3. **Optimization** runs the classical baseline and QAOA on the same instance.
4. **Quantum Engine** displays the real circuit, parameters and measurement.
5. The comparison verdict appears — **honestly**, classical usually ties or wins.
6. The demo blocks a primary road and **RE-OPTIMIZE** runs again.
7. The before/after diff and a data-driven explanation show *why* the allocation moved
   (e.g. a zone became unreachable, so its ambulances were re-routed).

Every action performs a real backend operation. Errors surface in the error banner;
a QAOA failure is displayed as **"QAOA execution failed"** with the real message and
is **never** silently replaced by the classical answer.

---

## 15. API documentation

Base URL: `http://127.0.0.1:8000`. All bodies use Pydantic models; interactive docs
at `/docs`.

**Auth:** every `/api/scenarios*`, `/api/simulation/*`, `/api/optimize/*`,
`/api/results*`, `/api/quantum/*` and `/api/analytics/*` route now requires an
`Authorization: Bearer <token>` header (401 without it). Mutations additionally
enforce role permissions (403). `/api/health` and `/api/auth/*` are public.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness + SIMULATION notice + `persistence` mode (`mongodb`/`memory`). |
| `POST` | `/api/auth/register` | Create an official (name, email, password, organization, role). Returns user + permissions + token. |
| `POST` | `/api/auth/login` | Verify credentials; returns user + permissions + bearer token. |
| `GET` | `/api/auth/me` | Current user + their role permissions (from bearer token). |
| `GET` | `/api/scenarios` | List scenario summaries. |
| `POST` | `/api/scenarios` | Create a scenario (empty body → fresh simulated base). **DMO only.** |
| `GET` | `/api/scenarios/{id}` | Fetch a full scenario. |
| `POST` | `/api/scenarios/preset/{preset}` | Create a What-If preset scenario (`normal`, `major_road_block`, `resource_shortage`, `hospital_capacity_reduced`, `new_critical_zone`). **DMO only.** |
| `GET` | `/api/scenarios/{id}/travel-costs` | Current depot→zone travel costs (`null` if unreachable). |
| `POST` | `/api/scenarios/{id}/update` | Partial edit (resources, budget, per-zone overrides); recomputes priority + accessibility. **Each field is RBAC-gated by role** (403 if not permitted; budget/scenario-wide edits are DMO only). |
| `POST` | `/api/scenarios/{id}/reoptimize` | Re-run compare on the current scenario and diff vs the previous allocation (`before`/`after`/`changes`/`explanation`/`compare`). Any authenticated role. |
| `DELETE` | `/api/scenarios/{id}` | Delete a scenario (demo is protected). **DMO only.** |
| `POST` | `/api/simulation/road-block` | Toggle a road OPEN/BLOCKED; returns before/after accessibility + travel costs. **DMO / Rescue Coordinator.** |
| `POST` | `/api/optimize/classical` | Run the exact classical baseline. |
| `POST` | `/api/optimize/qaoa` | Run QAOA on Aer. Returns `status:"failed"` + real error on failure. |
| `POST` | `/api/optimize/compare` | Run both and produce the honest comparison. |
| `GET` | `/api/results` | List stored result ids. |
| `GET` | `/api/results/{id}` | Fetch a stored result. |
| `GET` | `/api/quantum/circuit/{id}` | Circuit + QUBO for a qaoa/compare result. |
| `GET` | `/api/analytics/{id}` | Chart-ready analytics + shortage recommendations for a compare result. |
| `GET` | `/api/resources` | Resource catalogue + optimizers (for extensibility). |

**Optimize request body** (`zones_count`, `resources`, `reps`, `shots`, `optimizer`,
`seed`, `maxiter` are all optional and validated):

```json
{
  "scenario_id": "scn_demo",
  "zones_count": 4,
  "resources": ["ambulances", "rescue_teams", "medical_kits", "shelter_capacity"],
  "reps": 1,
  "shots": 1024,
  "optimizer": "COBYLA",
  "maxiter": 60,
  "seed": 42
}
```

---

## 16. Configuration

All runtime config comes from `backend/.env` (see `.env.example`). Secrets — IBM
Quantum token, instance, backend name, JWT secret — are **never hard-coded**; leave
the quantum ones blank to use the local **Qiskit Aer** simulator, which needs no
credentials.

| Key | Default | Meaning |
|-----|---------|---------|
| `QUANTUM_BACKEND` | `aer` | `aer` (local) or `ibm` (optional real device). |
| `IBM_QUANTUM_TOKEN` | *(empty)* | Only needed for real-device runs. |
| `QAOA_TIMEOUT_SECONDS` | `60` | Guardrail so QAOA never hangs the API. |
| `MAX_QUBITS` | `16` | Upper bound on the quantum instance size. |
| `CORS_ORIGINS` | Vite dev origins | Allowed browser origins. |
| `MONGO_URI` | *(empty)* | e.g. `mongodb://127.0.0.1:27017`. Empty/unreachable → in-memory fallback. |
| `MONGO_DB_NAME` | `quantumresq` | Database name for users, scenarios, results. |
| `JWT_SECRET` | *(empty → ephemeral)* | **Required in production.** HS256 signing secret; never hard-coded. |
| `JWT_ALGORITHM` | `HS256` | Token signing algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | Bearer-token lifetime. |

---

## 17. Testing

- **Backend:** `python -m pytest -q` — covers the API, the classical solver, QUBO
  consistency (the QUBO ground state reproduces the classical optimum), a real Aer
  QAOA execution, the honest comparison, road-block / resource-shortage / hospital-
  capacity effects on the optimization, and a full create → optimize → compare →
  block → re-optimize → analytics end-to-end flow. The auth/RBAC suite verifies
  register/login, duplicate-email rejection, wrong-password login, `/api/auth/me`,
  401 on unauthenticated mutation, and 403 field/action gates per role. Tests run
  against an isolated `quantumresq_test` database and clear it on session start, so
  they never touch the demo data.
- **Frontend:** `npm run build` type-checks and bundles; Login, Register and all six
  operational pages were verified in a browser against the live backend, including
  role-gated edits and the demo run.

---

## 18. Limitations

- **No quantum advantage.** On these small, exact-solvable instances the classical
  baseline ties or beats QAOA, and the UI says so. This is a demonstration of the
  pipeline, not a performance claim.
- **Simulation only.** All data is synthetic; nothing here is fit for real dispatch.
- **Small instances.** QAOA is intentionally capped (~16 qubits) so the simulator
  stays responsive; larger scenarios are displayed but not put on the quantum device.
- **Persistence needs MongoDB for durability.** Users, scenarios and results are
  stored in MongoDB and survive restarts **only when a reachable database is
  configured**. If `MONGO_URI` is unset or the server is down, the app falls back to
  an in-memory store — everything still runs, but created scenarios and registered
  users reset on restart. The `/api/health` `persistence` field tells you which mode
  is live.
- **Aer simulator.** Results are noisy finite-shot samples; the same seed/params are
  reproducible, but different sampling can change which method "wins" run to run.
- **Capacity/budget decoded, not fully QUBO-encoded.** Availability is slack-encoded in
  the QUBO; the tight budget and capacity coupling is enforced exactly at decode time.
  This trade-off is deliberate to keep the qubit count small and is surfaced in the
  QUBO summary.

---

## 19. Future improvements

- Higher QAOA depth `p`, better ansatzes (e.g. `k`-body mixers) and alternative
  quantum heuristics (QAOA variants, annealing/`QAOA`-inspired samplers).
- Encode budget and capacity fully as QUBO penalties for a pure quantum formulation.
- Real multi-objective / Pareto formulation and richer constraint learning.
- Richer multi-scenario history and time-travel analytics on top of the existing
  MongoDB persistence.
- Token refresh / shorter-lived access tokens and per-agency data scoping.
- Streaming/progress for long QAOA runs, and optional IBM Quantum device execution.
- Larger, sparse road networks with traffic-dependent travel times.

---

## 20. Quantum advantage disclaimer

> This project is a **quantum-assisted optimization prototype using small-scale QAOA
> simulation**. It does **not** claim, and does **not** fabricate, any quantum
> advantage or performance benefit. Quantum execution runs on the **Qiskit Aer
> simulator**. Classical results are produced by an **exact solver**. Where the
> classical baseline matches or outperforms QAOA — which it typically does on these
> small instances — the application reports that plainly.

---

## 21. Open-source dependencies

FastAPI · Uvicorn · Pydantic · NumPy · Pandas · SciPy · **Qiskit** · **Qiskit Aer** ·
rustworkx · **pymongo** · **bcrypt** · **PyJWT** · React · TypeScript · Vite ·
Tailwind CSS · React Router · Lucide React · Recharts · Leaflet / React-Leaflet ·
pytest. See `backend/requirements.txt` and `frontend/package.json` for exact pins.

---

*Built as a hackathon prototype for the Quantum AI & Software track.*
