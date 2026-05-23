# WebManager — Project Context (for LLMs)

> **For any AI assistant reading this:** This file is the single source of truth for what this project is, how it's structured, and how to work on it. Read top-to-bottom once; come back to specific sections as needed.

---

## 1. Project overview

**WebManager** is a self-hosted DevOps dashboard. It manages remote servers, the Docker Compose applications running on those servers, and PostgreSQL databases inside those containers. One web UI, one API, one Postgres for its own state. SSHes out to the user's fleet to run `docker compose up/down` and `pg_dump`.

**Primary users:** the team that owns the fleet — they sign in, start/stop apps, take DB dumps, audit who did what.

**Scope (in / out):**
- ✅ Start / stop Docker Compose apps remotely
- ✅ Auto-stop apps after a per-app timer
- ✅ PostgreSQL container discovery + database dump download
- ✅ Multi-server, multi-project organization
- ✅ User management (admin / user roles), audit log
- ✅ Microsoft Entra ID (Azure AD) SSO
- ❌ Multi-tenancy (single org)
- ❌ Logs viewer / metrics dashboards
- ❌ Build pipelines / CI — assumes images are already built

---

## 2. Tech stack

| Layer | Tech | Version |
|---|---|---|
| Backend | Go + Gin + GORM | `go 1.24`, gin `v1.11`, GORM `v1.31` |
| Auth | JWT (`golang-jwt/jwt/v5`) + Microsoft OAuth | jwt `v5.3` |
| Database | PostgreSQL | `16-alpine` (dev) |
| Remote ops | SSH client (`golang.org/x/crypto/ssh`) | `crypto v0.43` |
| Frontend | React + Vite + TypeScript | React `18.3`, Vite `6.3.5` |
| Styling | Tailwind v4 + `@tailwindcss/vite` | tailwind `4.3` |
| UI primitives | Radix UI + shadcn-style wrappers | various `@radix-ui/*` ~1.1.x |
| Icons | lucide-react | `0.487` |
| Toasts | sonner | `2.0.3` |
| Animation | framer-motion (installed, **not used** — stripped during the warm-UI pass) | `12.38` |

Build tool: **Vite v6** with `@vitejs/plugin-react-swc` + `@tailwindcss/vite` plugin. Dev hot reload via Vite HMR for frontend and `air` for the Go backend.

---

## 3. Repository layout

```
WebManager/
├── AGENTS.md                       # this file
├── DOCKER_DEV.md                   # detailed dev-stack walkthrough
├── docker-compose.yml              # prod stack
├── docker-compose.dev.yml          # dev stack with hot reload
├── backups/                        # gitignored — DB dump files
│
├── backend/                        # Go API
│   ├── main.go                     # entrypoint; auto-migrates models, starts router
│   ├── go.mod / go.sum
│   ├── Dockerfile                  # prod multi-stage build
│   ├── Dockerfile.dev              # dev — `air` for hot reload
│   ├── .air.toml                   # air watch config
│   ├── .dockerignore
│   ├── controllers/                # HTTP handlers
│   │   ├── auth.go                 # /api/auth/login, /register, /verify
│   │   ├── sso.go                  # Microsoft OAuth flow
│   │   ├── server.go               # /api/servers/* CRUD + ssh refresh
│   │   ├── project.go              # /api/projects/* CRUD
│   │   ├── app.go                  # /api/apps/* CRUD + start/stop
│   │   ├── user.go                 # /api/users/* admin CRUD
│   │   ├── audit.go                # /api/audit-logs read
│   │   └── postgres.go             # /api/postgres/dump + container/database discovery
│   ├── services/                   # business logic + outbound side effects
│   │   ├── auth_service.go         # bcrypt, default admin seed
│   │   ├── postgres_service.go     # builds pg_dump cmd, SSHes out
│   │   ├── server_service.go       # SSH-based server health check
│   │   ├── timer_service.go        # background goroutine that auto-stops apps
│   │   └── audit_service.go        # writes audit log rows
│   ├── models/                     # GORM types
│   │   ├── app.go                  # App
│   │   ├── server.go               # Server (encrypted SSH key)
│   │   ├── project.go              # Project
│   │   ├── user.go                 # User
│   │   ├── audit_log.go            # AuditLog
│   │   └── postgres.go             # PostgresContainer / PostgresDatabase / PostgresDumpRequest (not persisted)
│   ├── middleware/                 # JWT auth, admin gate, audit log injection
│   ├── migrations/                 # called from main.go on boot
│   │   ├── 001_create_default_users.go   # seeds `sourav` admin if users table empty
│   │   └── 002_add_timer_ends_at.go      # backfills column
│   ├── router/router.go            # all routes registered here (read this for the API surface)
│   └── utils/                      # ssh + crypto helpers
│       ├── ssh.go                  # RunSSHCommand — 10s handshake timeout, blocking output
│       └── crypto.go               # AES-CFB Encrypt/Decrypt for SSH private keys
│
└── frontend/                       # Vite + React + TS
    ├── index.html
    ├── package.json
    ├── vite.config.ts              # Vite proxy to /api → http://api:8080 (Docker) or localhost:8080 (host)
    ├── nginx.conf                  # prod-only — serves the built SPA
    ├── Dockerfile / Dockerfile.dev
    ├── .dockerignore
    └── src/
        ├── main.tsx                # ReactDOM bootstrap — imports ./styles/globals.css
        ├── App.tsx                 # top-level layout: sidebar + main; view router (no React Router; just useState)
        ├── styles/globals.css      # design tokens + bento-card utility (read section 7)
        ├── components/             # feature components
        │   ├── Sidebar.tsx
        │   ├── LoginPage.tsx
        │   ├── AuthCallback.tsx
        │   ├── AppCard.tsx
        │   ├── AppManagementDialog.tsx
        │   ├── ServerManagementDialog.tsx
        │   ├── ProjectManagementDialog.tsx
        │   ├── UserManagement.tsx
        │   ├── Infrastructure.tsx
        │   ├── AuditLogs.tsx
        │   ├── PostgresManager.tsx
        │   ├── DatabaseDump.tsx    # *** UNUSED — PostgresManager replaced it ***
        │   ├── AdminPanel.tsx      # *** UNUSED ***
        │   ├── DashboardOverview.tsx  # *** UNUSED ***
        │   ├── SettingsDialog.tsx     # *** UNUSED ***
        │   └── ui/                 # shadcn-style Radix wrappers
        │       ├── accent-button.tsx       # primary button — variants: pink/ghost/destructive (lime/cyan aliased to pink)
        │       ├── status-badge.tsx        # online/offline/idle pill
        │       ├── glass-card.tsx          # legacy name — renders as a plain solid card now
        │       ├── glass-dialog.tsx        # legacy name — Radix Dialog reskin
        │       ├── glass-skeleton.tsx      # shimmering loading placeholder
        │       ├── dialog.tsx, alert-dialog.tsx, input.tsx, textarea.tsx, tabs.tsx, select.tsx, ...
        │       └── utils.ts        # `cn()` clsx + tailwind-merge
        ├── hooks/                  # state + API client per resource
        │   ├── useAuth.ts          # JWT in localStorage key 'devops-dashboard-auth'
        │   ├── useApps.ts
        │   ├── useServers.ts
        │   ├── useProjects.ts
        │   └── usePostgres.ts      # getContainers / getDatabases / createDump
        ├── lib/
        │   ├── api.ts              # fetch wrappers — base URL from VITE_API_URL or '/api'
        │   ├── motion.ts           # *** UNUSED *** (framer-motion variants stripped)
        │   └── view-transitions.ts # withViewTransition() — *** NOT CALLED ***, animation removed
        ├── types/app.ts            # frontend domain types (App, Server, Project, User, AuditLog)
        └── assets/                 # one figma asset
```

**Components currently UNUSED** (verified by grep — kept for potential reuse, do not edit assuming they're live): `DatabaseDump.tsx`, `AdminPanel.tsx`, `DashboardOverview.tsx`, `SettingsDialog.tsx`, `lib/motion.ts`, `lib/view-transitions.ts`. They still compile but nothing imports them.

---

## 4. Architecture & data flow

**Frontend** is a single-page React app. No React Router — view switching is a `useState<'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump'>` in `App.tsx` driven by sidebar clicks.

**Auth flow**:
- POST `/api/auth/login` (or Microsoft SSO) → backend issues JWT with `username` + `role` claims, 7-day expiry
- Frontend stores the entire user profile (incl. token) in `localStorage` under key `devops-dashboard-auth`
- Every API call goes through `lib/api.ts`, which reads the token and sets `Authorization: Bearer <jwt>`
- Backend `middleware.JWT()` validates; `middleware.Admin()` further gates write routes

**App-start/stop flow** (the core feature):
```
Browser → POST /api/apps/:id/start
        → controller looks up the App + Server
        → services.RunSSHCommand to server using decrypted SSH key
        → executes `cd <ComposePath> && docker compose up -d` on remote
        → updates apps.status = 'running', sets TimerEndsAt = now + AutoStopTimeout
        → writes audit_log row
Background goroutine (StartTimerService) wakes every 30s, finds running apps where TimerEndsAt < now, calls stop.
```

**Database dump flow** (PostgreSQL):
```
Browser → POST /api/postgres/dump { server_id, container_id, database }
        → controller loads Server row, decrypts SSH key
        → services.CreateDump: SSHes to server, runs `docker exec <container_id> pg_dump -U postgres <db>`
        → captures CombinedOutput (BUFFERED — see section 14)
        → returns as application/sql attachment
Browser receives Blob, calls URL.createObjectURL, triggers anchor click with timestamped filename.
```

---

## 5. Key features

| Sidebar item | What it does | Admin-only? |
|---|---|---|
| **Applications** | Lists Docker Compose apps grouped by project. Start/Stop buttons hit SSH on the host. Per-app runtime timer (e.g., auto-stop after 60 min). | No (users can start/stop) |
| **Database Dump** | Lists postgres containers on a server → lists databases in a container → downloads `pg_dump` output as `.sql`. | No |
| **Infrastructure** | CRUD for Servers (with SSH credentials) + Projects. | Yes |
| **Users** | CRUD for users (admin / user roles). | Yes |
| **Audit Logs** | Read-only feed of all actions with filters (action type, resource type, username) + pagination. | Yes |

Login page supports **Microsoft SSO** (primary) and a **password fallback** (the "Admin login" link reveals username/password fields).

---

## 6. Auth, default credentials, SSO

**Default seeded admin** (created by [backend/migrations/001_create_default_users.go](backend/migrations/001_create_default_users.go) on first boot if `users` table is empty):

| Field | Value |
|---|---|
| Username | `sourav` |
| Password | `sourav+1` |
| Role | `admin` |

**JWT**: secret comes from `JWT_SECRET` env var, expiry 7 days, claims `{ username, role, exp }`.

**Microsoft SSO config** (from `docker-compose.yml` — these are real Entra ID values for the prod app):
- `MICROSOFT_CLIENT_ID: dcf16509-91a6-43a0-b0b2-85fe33d7a43f`
- `MICROSOFT_TENANT_ID: e37bae5a-2850-45a2-9ed0-a198cb1388fd`
- `MICROSOFT_CLIENT_SECRET` — set in prod compose, redacted for safety
- `MICROSOFT_REDIRECT_URI: https://portal.nexgensis.com/api/auth/microsoft/callback`
- `SSO_AUTO_CREATE_USERS: "true"` — first-time SSO users get auto-created
- `SSO_DEFAULT_ROLE: user`
- `SSO_ADMIN_EMAILS: sourav.kumar@nexgensis.com` — pinned admin list
- Dev compose sets `SSO_ENABLED: "false"` so this path is disabled locally; login is password-only in dev.

**Frontend localStorage key**: `devops-dashboard-auth` — entire user profile JSON including the JWT.

---

## 7. Design system (current state)

The UI went through several iterations and landed on a **warm, plain, minimal** look. **No glass blur. No animation.** Static surfaces, soft warm tones, one pink accent, dark sidebar with a "merge tab" effect on the active item.

### Palette

```
--canvas         #FFFFFF      page background (white)
--card           #FFFFFF      default card surface
--card-warm      #FAF6F0      slightly warm card tint (used for some stat cards)
--ink            #1A1612      primary text (warm near-black)
--ink-muted      rgba(26,22,18,0.55)
--sidebar-bg     #241D18      sidebar background (warm dark brown)
--accent-pink    #F49EB5      single bright accent — active states, CTAs, focus rings
--accent-pink-soft  #FBD5DF
--accent-peach   #F4B89A      secondary warm tint
--accent-peach-soft #FBE2D3
--accent-green   #7FB069      status: online (muted)
--accent-destructive #D14242  destructive actions / status: offline
--border         rgba(26,22,18,0.08)   hairline
--ring           var(--accent-pink)    focus outline
--radius         1rem
```

**Legacy aliases** (kept so older code keeps compiling — they all map to pink now):
```
--accent-lime → --accent-pink
--accent-mint → --accent-peach
--accent-cyan → --accent-peach
```

### Layout shape

- **Root page bg**: warm dark (`--sidebar-bg`)
- **Sidebar** (`w-64`, full-height, flush to left edge): inherits the page bg, no own background, no rounded corners on its outer edge
- **Main content panel**: white `rounded-2xl` card with `my-4 mr-4` margin so the dark frame shows on top/right/bottom (no left margin — sidebar touches the panel)
- **Active sidebar item**: a white pill (`bg-[var(--canvas)]`) with `rounded-l-xl rounded-r-none`, extends to the sidebar's right edge → meets the main panel's left edge seamlessly. Two 12-px radial-gradient corner-curves (one above, one below) "carve" the dark sidebar to make the pill look like it's tucked in. Active icon turns pink.
- **Login page**: split-screen. Left = warm-peach/pink bloom on cream-soft (radial gradients, static). Right = white card with the welcome heading + Microsoft button + "Admin login" link that reveals username/password.

### Card utility

There is **one** card utility, defined three times under three names for back-compat:
```css
.bento-card, .glass-card, .glass-card-strong {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
}
```
Use `bento-card` for new code. The `glass-*` names are kept because old components still reference them.

### No animation

- `framer-motion` is installed but **not used anywhere**. Removed `motion.div`, `whileHover`, `whileTap`, `layoutId`, `AnimatePresence` calls during the warm-UI pass.
- `lib/view-transitions.ts` exists but `withViewTransition()` is **not called** — sidebar navigates instantly via direct `onNavigate(view)`.
- Only animations remaining are CSS transitions on hover (color/bg), focus rings, the skeleton shimmer keyframe, and a `.glass-skeleton::after` sweep.

---

## 8. Component conventions

- **`bento-card` utility** for any card surface — gives the standard border + radius.
- **`AccentButton`** ([components/ui/accent-button.tsx](frontend/src/components/ui/accent-button.tsx)) for primary CTAs. Variants: `'pink'` (default), `'ghost'`, `'destructive'`. Aliases `'lime'` and `'cyan'` map to pink so legacy callers keep working.
- **`StatusBadge`** ([components/ui/status-badge.tsx](frontend/src/components/ui/status-badge.tsx)) for online/offline/idle/running/stopped pills.
- **`StatCard`** (defined inline at the bottom of `App.tsx`) for the bento stat tiles. Tones: `cream`, `pink`, `peach`, `ink`.
- **`GlassCard`** is a div wrapper around `bento-card` (no actual glass) — exists because lots of code imports it. Don't reach for new usages; just use the `bento-card` class directly.
- **`Dialog` / `AlertDialog`** are the standard Radix wrappers in `components/ui/dialog.tsx` and `alert-dialog.tsx`. **Do not** use `window.confirm()` — `UserManagement.tsx` uses `AlertDialog` for delete confirmation; copy that pattern.

---

## 9. API surface (every route)

From [backend/router/router.go](backend/router/router.go):

**Public (no JWT)**
```
POST   /api/auth/login                  Login
POST   /api/auth/register               Register
GET    /api/auth/microsoft              SSO redirect URL
GET    /api/auth/microsoft/callback     SSO callback handler
```

**Authenticated (JWT required)**
```
GET    /api/auth/verify                 Validate current token
GET    /api/servers                     List servers (visible to all users)
POST   /api/servers/refresh             Refresh status of all servers (SSH check)
POST   /api/servers/:id/test            Test SSH connection
GET    /api/projects                    List projects
GET    /api/apps                        List apps
POST   /api/apps/:id/start              Start app (SSH + docker compose up)
POST   /api/apps/:id/stop               Stop app (SSH + docker compose down)
PUT    /api/apps/:id                    Update app settings (e.g., runtime)
GET    /api/audit-logs                  Read audit log (paginated)
GET    /api/servers/:id/postgres/containers
GET    /api/servers/:id/postgres/containers/:container_id/databases
POST   /api/servers/:id/postgres/containers/:container_id/test
POST   /api/postgres/dump               Download a database dump
```

**Admin-only (JWT + admin role)**
```
POST   /api/servers
PUT    /api/servers/:id
DELETE /api/servers/:id
POST   /api/projects
PUT    /api/projects/:id
DELETE /api/projects/:id
POST   /api/apps
DELETE /api/apps/:id
GET    /api/users
POST   /api/users
GET    /api/users/:id
PUT    /api/users/:id
DELETE /api/users/:id
```

---

## 10. Database schema

GORM auto-migrates these on boot (`db.AutoMigrate(...)` in `main.go`):

| Table | Key fields | Notes |
|---|---|---|
| **users** | `id` UUID PK, `username` (unique), `password_hash`, `role` (`admin`/`user`), `email`, `full_name`, `is_active`, `last_login_at` | bcrypt-hashed password; SSO-created users have a random password |
| **servers** | `id` UUID PK, `name`, `address`, `ssh_user`, `ssh_port` (default 22), `ssh_key_encrypted` (AES-CFB encrypted with `ENCRYPTION_KEY`), `status`, `last_checked` (epoch ms) | `RunningAppsCount` is `gorm:"-"` (computed, not stored) |
| **projects** | `id` UUID PK, `name` (unique), `description` | Just a label to group apps |
| **apps** | `id` UUID PK, `name`, `domain`, `compose_path` (column `cdPath` in JSON), `project_id` FK, `server_id` FK, `app_url`, `auto_stop_mins`, `status`, `started_at`, `timer_ends_at` | Timer service auto-stops on expiry |
| **audit_logs** | `id` UUID PK, `user_id`, `username`, `action` (`start_app`, `stop_app`, `create_*`, `update_*`, `delete_*`, `sso_login`, ...), `resource_type`, `resource_name`, `details`, `ip_address`, `user_agent` | Append-only |

All tables have GORM soft-delete via `deleted_at` (indexed).

---

## 11. Docker setup

Two compose files. Use **only one at a time** — they expose the same host ports (5432, 8080).

### Prod (`docker-compose.yml`)
- `postgres:16` on 5432 with named volume `pgdata`
- backend image built from `backend/Dockerfile` (multi-stage, alpine, ships a single binary)
- frontend image built from `frontend/Dockerfile` (Vite build → nginx serving `/usr/share/nginx/html`)
- Service depends_on with `service_healthy` gating
- Real Microsoft SSO env vars
- Container names: `webmanager-database`, `webmanager-backend`, `webmanager-frontend`
- Use for actual deployment.

### Dev (`docker-compose.dev.yml`)
- `postgres:16-alpine` on 5432 with named volume `pgdata-dev`
- backend image built from `backend/Dockerfile.dev` running `air -c .air.toml` → hot reload on `*.go` changes
- frontend image built from `frontend/Dockerfile.dev` running `npm run dev` (Vite HMR) on :3000
- **Source code bind-mounted** (`./backend:/app`, `./frontend:/app`) so edits flow in live
- **Anonymous volume** on `/app/node_modules` so the host's node_modules can't shadow the container's
- **Named volumes** for the Go module cache (`go-mod-cache`) and air's tmp dir (`api-tmp`)
- Container names: `webmanager-db-dev`, `webmanager-api-dev`, `webmanager-web-dev`
- SSO disabled (`SSO_ENABLED: "false"`)
- Vite proxy: `/api` → `http://api:8080` (docker service DNS) via `VITE_DEV_API_PROXY` env

Full dev-stack walkthrough in [DOCKER_DEV.md](DOCKER_DEV.md).

---

## 12. How to run

### First time
```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d
```
Open http://localhost:3000 → click **Admin login** → username `sourav`, password `sourav+1`.

### Day-to-day
```bash
docker compose -f docker-compose.dev.yml up -d      # start
docker compose -f docker-compose.dev.yml logs -f api  # tail backend
docker compose -f docker-compose.dev.yml logs -f web  # tail frontend
docker compose -f docker-compose.dev.yml down       # stop
docker compose -f docker-compose.dev.yml down -v    # stop + wipe dev DB
```

Editing `.go` files → `air` rebuilds the binary in ~1s. Editing `.tsx`/`.css` → Vite HMR updates the browser in <500ms.

If you change `go.mod` or `package.json`, you must rebuild: `docker compose -f docker-compose.dev.yml build` for the affected service.

---

## 13. Dev secrets & env vars (inline)

These are the values currently in `docker-compose.dev.yml` and the seeded admin user. **Local-dev only — replace before deploying.**

| Variable | Value | Used by |
|---|---|---|
| `POSTGRES_USER` | `postgres` | db service |
| `POSTGRES_PASSWORD` | `nexgensis` | db service + backend DSN |
| `POSTGRES_DB` | `webmanager` | db service |
| `DB_DSN` | `postgres://postgres:nexgensis@db:5432/webmanager?sslmode=disable` | backend |
| `JWT_SECRET` | `dev-only-secret-do-not-use-in-prod` | backend (token signing) |
| `ENCRYPTION_KEY` | `12345678901234567890123456789012` (32 chars, AES-256) | backend (encrypts SSH private keys in `servers.ssh_key_encrypted`) |
| `PORT` | `8080` | backend |
| `GIN_MODE` | `debug` | backend (verbose request logging) |
| `SSO_ENABLED` | `false` | backend (dev) |
| `VITE_DEV_API_PROXY` | `http://api:8080` | frontend (Vite proxy target) |
| `IN_DOCKER` | `1` | frontend (suppresses Vite auto-open) |
| `CHOKIDAR_USEPOLLING` | `true` | frontend (file watch polling for Docker volumes) |
| Default admin login | `sourav` / `sourav+1` | seeded by `001_create_default_users.go` |

The prod compose uses different (real) values for `JWT_SECRET`, the SSO secrets, etc. — see `docker-compose.yml`.

---

## 14. Known caveats & open items

These are **known issues** in the current code — don't be surprised by them, and consider fixing if you're touching the area.

1. **SSH command timeout is only the handshake** ([backend/utils/ssh.go:18](backend/utils/ssh.go#L18)). `ssh.ClientConfig.Timeout: 10 * time.Second` covers connection establishment but NOT the actual command. A long-running `pg_dump` on a multi-GB database can hang because `session.CombinedOutput(cmd)` has no per-command deadline. Frontend `fetch` will time out before the server gives up.

2. **DB dump is fully buffered in memory** ([backend/services/postgres_service.go:91](backend/services/postgres_service.go#L91)). Whole dump goes into a Go string before being sent — 2 GB dump = 2 GB RAM on the api container. Should be streamed via `session.StdoutPipe()` + `c.DataFromReader()`.

3. **`utils.Decrypt` silently passes through bad input** ([backend/utils/crypto.go](backend/utils/crypto.go)). If `ENCRYPTION_KEY` is empty / wrong / ciphertext is too short, it returns the input unchanged rather than erroring. Makes debugging "why does SSH fail" hard. The prod `ENCRYPTION_KEY` matches the dev compose value (`12345678...`), so restored prod data works in dev — but don't change `ENCRYPTION_KEY` without re-encrypting all `servers.ssh_key_encrypted` rows.

4. **`vite.config.ts` has versioned-aliased imports**. The file was originally a Figma Make export, so some `@radix-ui/...@1.1.2` style imports show up in components. Vite resolves these via a giant `resolve.alias` map. Don't be alarmed; they all point at the unversioned package.

5. **No CSRF protection**. Backend trusts `Authorization: Bearer` blindly. JWTs in localStorage means XSS is the attack surface. Mitigation: the frontend escapes everything (React default).

6. **`Content-Type: application/sql`** on dump response ([postgres.go:109](backend/controllers/postgres.go#L109)) is nonstandard — most browsers download it correctly but some may try to render. Should be `application/octet-stream`.

7. **Dev compose ports collide with prod compose** (5432, 8080). Run one stack at a time. If you `docker compose up` (prod) while dev is running, the second one will fail to bind.

8. **The `webmanager-backend-1` / `webmanager-postgres-1` containers from older runs may linger** if someone used compose v1 syntax. `docker ps -a | grep webmanager` to spot them, `docker rm -f` to clean up. The `webmanager_pgdata` named volume still holds the old prod data.

9. **Some components are imported but never rendered** (see the "UNUSED" callouts in section 3). Safe to delete if you want, but each one is a working component that could be re-wired.

10. **Backend logs SSH cookies on the OAuth state path** — `controllers/sso.go` has a `log.Printf` for `SSO_ENABLED` debug that the user wanted to remove. Not critical, just noisy.

---

## 15. Critical files (one-line tour)

| Path | What |
|---|---|
| [backend/main.go](backend/main.go) | Entry — connects DB with retry, auto-migrates models, starts timer service, starts router |
| [backend/router/router.go](backend/router/router.go) | Every API route in one file — read this to understand the surface |
| [backend/controllers/postgres.go](backend/controllers/postgres.go) | DB dump controller |
| [backend/services/postgres_service.go](backend/services/postgres_service.go) | Builds + runs the `pg_dump` SSH command |
| [backend/services/timer_service.go](backend/services/timer_service.go) | Background goroutine: every 30s, auto-stops apps whose `timer_ends_at` has passed |
| [backend/utils/ssh.go](backend/utils/ssh.go) | `RunSSHCommand` — the only SSH helper, used by all remote ops |
| [backend/utils/crypto.go](backend/utils/crypto.go) | AES-CFB encrypt/decrypt for SSH keys |
| [backend/migrations/001_create_default_users.go](backend/migrations/001_create_default_users.go) | Seeds `sourav` admin |
| [frontend/src/App.tsx](frontend/src/App.tsx) | Top-level layout + view router (state-based, not URL-based) + StatCard component |
| [frontend/src/components/Sidebar.tsx](frontend/src/components/Sidebar.tsx) | Dark sidebar with the merge-pill active state |
| [frontend/src/components/LoginPage.tsx](frontend/src/components/LoginPage.tsx) | Split-screen login with dynamic greeting + DevOps quote |
| [frontend/src/styles/globals.css](frontend/src/styles/globals.css) | All design tokens + utilities — change here, not in components |
| [frontend/src/hooks/useAuth.ts](frontend/src/hooks/useAuth.ts) | JWT/localStorage management — `AUTH_STORAGE_KEY = 'devops-dashboard-auth'` |
| [frontend/src/hooks/usePostgres.ts](frontend/src/hooks/usePostgres.ts) | `createDump()` POSTs to `/api/postgres/dump`, returns a Blob |
| [frontend/vite.config.ts](frontend/vite.config.ts) | Vite config with the `/api` proxy + the figma-export alias map |
| [docker-compose.dev.yml](docker-compose.dev.yml) | The dev stack you should be running |

---

## 16. Common workflows

### Take a DB snapshot from dev (file)
```bash
docker exec webmanager-db-dev pg_dump -U postgres -d webmanager \
  > backups/dev-$(date +%F-%H%M).sql
```

### Restore a snapshot into dev
```bash
cat backups/dev-2026-05-20.sql | \
  docker exec -i webmanager-db-dev psql -U postgres -d webmanager
```

### Open a psql shell in dev
```bash
docker exec -it webmanager-db-dev psql -U postgres -d webmanager
```

### Swap dev → prod (or back)
```bash
docker compose -f docker-compose.dev.yml down
docker compose up -d           # prod
# ... or the reverse
docker compose down
docker compose -f docker-compose.dev.yml up -d
```

### Install a backend dep
```bash
docker compose -f docker-compose.dev.yml exec api go get <pkg>
# air will rebuild on save
```

### Install a frontend dep
```bash
docker compose -f docker-compose.dev.yml exec web npm install <pkg>
docker compose -f docker-compose.dev.yml build web   # rebake image so deps are baked in
docker compose -f docker-compose.dev.yml up -d web
```

### Add a new sidebar nav item
1. Add the route in [backend/router/router.go](backend/router/router.go)
2. Add a controller in [backend/controllers/](backend/controllers/)
3. Add an item to the `menuItems` array in [frontend/src/components/Sidebar.tsx](frontend/src/components/Sidebar.tsx)
4. Extend the `ActiveView` union there + in [App.tsx](frontend/src/App.tsx)
5. Render the view conditionally in `App.tsx`

### Add a new model
1. New file in `backend/models/` with GORM tags
2. Append it to `db.AutoMigrate(...)` in [backend/main.go](backend/main.go) — GORM creates the table on next boot

### Rotate `ENCRYPTION_KEY` safely
1. Read each `servers.ssh_key_encrypted` with the **old** key (decrypt)
2. Re-encrypt with the **new** key
3. Update each row
4. Set new key in env, restart

There is no automated migration for this — you'd write a one-off Go script.

---

## 17. Conventions a future contributor / LLM should follow

- **Don't add framer-motion animations** unless explicitly asked. The user removed all of them and prefers static UI.
- **Don't add glass blur** (`backdrop-filter: blur(...)`). The user rejected it.
- **Don't restyle the sidebar's merge tab** without first understanding the corner-curve technique in `Sidebar.tsx` — it's deliberate.
- **Don't create new card surfaces** — use the existing `bento-card` utility.
- **Don't put text in pure black**; use `var(--ink)` (`#1A1612`, warm near-black).
- **Don't reference `Nexgensis`** in user-visible strings; brand on the login page is currently "Sourav". Domain examples in placeholders still use `pharma.qms.nexgensis.com` intentionally — leave them.
- **Don't put new files at the repo root.** Frontend goes in `frontend/`, backend in `backend/`. (There was an incident where `node_modules` ended up at the root from running `npm install` without `cd frontend/` first — don't repeat.)
- **Don't use `window.confirm()`** — use `AlertDialog` from [components/ui/alert-dialog.tsx](frontend/src/components/ui/alert-dialog.tsx).
- **Don't commit `.env` files or any of the secret values in section 13** beyond local dev. Prod values come from the deploy environment.
