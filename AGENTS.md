# WebManager — Project Context (for LLMs)

> **For any AI assistant reading this:** This file is the single source of truth for what this project is, how it's structured, and how to work on it. Read top-to-bottom once; come back to specific sections as needed.

---

## 1. Project overview

**WebManager** is a self-hosted DevOps dashboard. It manages remote servers, the Docker Compose applications running on those servers, and PostgreSQL databases inside those containers. One web UI, one API, one Postgres for its own state. Talks to the user's fleet over each host's **Docker Engine API on port 2376, secured with mutual TLS (mTLS)** — no SSH. App start/stop is done by starting/stopping the project's containers (by compose label); DB dumps run `pg_dump` via the Docker Exec API.

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
| Backend | Go + Gin + GORM | `go 1.25`, gin `v1.11`, GORM `v1.31` |
| Auth | JWT (`golang-jwt/jwt/v5`) + Microsoft OAuth | jwt `v5.3` |
| Database | PostgreSQL | `16-alpine` (dev) |
| Remote ops | **Docker Engine API SDK over mTLS** (`github.com/docker/docker` client) | docker `v27.5.1+incompatible`, go-connections pinned `v0.5.0` |
| Crypto | `golang.org/x/crypto/bcrypt` (passwords) + AES-CFB (`utils/crypto.go`, TLS key at rest) | crypto `v0.49` |
| Frontend | React + Vite + TypeScript | React `18.3`, Vite `6.3.5` |
| Styling | Tailwind v4 + `@tailwindcss/vite` | tailwind `4.3` |
| UI primitives | Radix UI + shadcn-style wrappers | various `@radix-ui/*` ~1.1.x |
| Icons | lucide-react | `0.487` |
| Toasts | sonner | `2.0.3` |
| Animation | framer-motion (installed, **not used** — stripped during the warm-UI pass) | `12.38` |

Build tool: **Vite v6** with `@vitejs/plugin-react-swc` + `@tailwindcss/vite` plugin. Dev hot reload via Vite HMR for frontend and `air` for the Go backend.

> **Dependency gotcha (Docker SDK):** The Docker client must be the **monolithic** module `github.com/docker/docker v27.5.1+incompatible` (subpackages `client`, `api/types/container`, `api/types/filters`, `pkg/stdcopy`). Do **not** let `go mod tidy` drift to the split `github.com/docker/docker/{client,api}` v28 modules — they declare a `github.com/moby/moby/api` path and break the classic import paths. `github.com/docker/go-connections` is pinned to **v0.5.0** (v0.7.0 removed `sockets.DialPipe`, which docker v27.5.1 references). The Docker SDK's otel telemetry deps require **Go ≥ 1.25**, which is why the backend images are `golang:1.25-alpine`.
>
> **Frontend has no type-checker:** `typescript` isn't a dependency and `npm run build` is just `vite build` (esbuild strips types, never type-checks). Verify frontend changes with `npm run build`, not `tsc`.

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
│   │   ├── server.go               # /api/servers/* CRUD (TLS payload binding + key encryption) + status refresh
│   │   ├── project.go              # /api/projects/* CRUD
│   │   ├── app.go                  # /api/apps/* CRUD + start/stop
│   │   ├── user.go                 # /api/users/* admin CRUD
│   │   ├── audit.go                # /api/audit-logs read
│   │   └── postgres.go             # /api/postgres/dump + container/database discovery
│   ├── services/                   # business logic + outbound side effects
│   │   ├── docker_client.go        # *** NewDockerClient — builds mTLS *client.Client from a server's TLS material; defer cli.Close() ***
│   │   ├── docker_service.go       # container discovery via Docker SDK (ContainerList/Inspect)
│   │   ├── postgres_service.go     # psql/pg_dump via Docker Exec API; CreateDump returns a streaming io.ReadCloser
│   │   ├── app_services.go         # compose start/stop = start/stop containers by compose-project label
│   │   ├── server_service.go       # server health check via Docker API Ping + running-container count
│   │   ├── timer_service.go        # background goroutine that auto-stops apps
│   │   └── audit_service.go        # writes audit log rows
│   ├── models/                     # GORM types
│   │   ├── app.go                  # App
│   │   ├── server.go               # Server (mTLS: tls_ca/tls_cert plain, tls_key_encrypted AES; docker_api_port)
│   │   ├── project.go              # Project
│   │   ├── user.go                 # User
│   │   ├── audit_log.go            # AuditLog
│   │   └── postgres.go             # PostgresContainer / PostgresDatabase / PostgresDumpRequest (not persisted)
│   ├── middleware/                 # JWT auth, admin gate, audit log injection
│   ├── migrations/                 # called from main.go on boot
│   │   ├── 001_create_default_users.go   # seeds `sourav` admin if users table empty
│   │   ├── 002_add_timer_ends_at.go      # backfills column
│   │   └── 003_drop_ssh_columns.go       # drops legacy ssh_user/ssh_port/ssh_key_encrypted (were NOT NULL → would break inserts)
│   ├── router/router.go            # all routes registered here (read this for the API surface)
│   └── utils/                      # crypto helpers (ssh.go was removed in the mTLS migration)
│       ├── password.go             # bcrypt hash/verify
│       └── crypto.go               # AES-CFB Encrypt/Decrypt for the client TLS private key
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
        │   ├── FolderTabs.tsx      # folder-tab navigation (replaced the sidebar)
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
        │   ├── NexusAuraMark.tsx
        │   └── ui/                 # only the Radix wrappers actually used (16 files)
        │       ├── accent-button.tsx       # primary button — variants: pink/ghost/destructive (lime/cyan aliased to pink)
        │       ├── status-badge.tsx        # online/offline/idle pill
        │       ├── glass-card.tsx          # legacy name — renders as a plain solid card now
        │       ├── glass-skeleton.tsx      # shimmering loading placeholder
        │       ├── dialog.tsx, alert-dialog.tsx, input.tsx, textarea.tsx, tabs.tsx, select.tsx, label.tsx, badge.tsx, dropdown-menu.tsx, scroll-area.tsx, sonner.tsx
        │       └── utils.ts        # `cn()` clsx + tailwind-merge
        ├── hooks/                  # state + API client per resource
        │   ├── useAuth.ts          # JWT in localStorage key 'devops-dashboard-auth'
        │   ├── useApps.ts
        │   ├── useServers.ts
        │   ├── useProjects.ts
        │   └── usePostgres.ts      # getContainers / getDatabases / createDump / credentials
        ├── lib/
        │   └── api.ts              # fetch wrappers — base URL from VITE_API_URL or '/api'
        ├── types/                  # app.ts (App, Server, Project, User, AuditLog) + postgres.ts
        └── assets/                 # one figma asset
```

> **Dead code was pruned** (audit): removed unreached components (Sidebar, DatabaseDump, AdminPanel, DashboardOverview, ServerOverview, SettingsDialog, PostgresDumpDialog, figma/ImageWithFallback), `useSettings`, 7 unused `lib/` files (motion, view-transitions, mockApi, mockData, encryption, serverApi, webhook), 37 unused `ui/` primitives, and 4 unrouted backend handlers (`GetApp`/`GetProject`/`GetServer`/`Logout`). Reachability from `main.tsx` is now 100%.

---

## 4. Architecture & data flow

**Frontend** is a single-page React app. No React Router — view switching is a `useState<'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump'>` in `App.tsx` driven by sidebar clicks.

**Auth flow**:
- POST `/api/auth/login` (or Microsoft SSO) → backend issues JWT with `username` + `role` claims, 7-day expiry
- Frontend stores the entire user profile (incl. token) in `localStorage` under key `devops-dashboard-auth`
- Every API call goes through `lib/api.ts`, which reads the token and sets `Authorization: Bearer <jwt>`
- Backend `middleware.JWT()` validates; `middleware.Admin()` further gates write routes

All remote ops go through `services.NewDockerClient(server)`, which decrypts the server's TLS key and returns a Docker `*client.Client` targeting `https://<address>:<docker_api_port>`. Always `defer cli.Close()`.

**App-start/stop flow** (the core feature):
```
Browser → POST /api/apps/:id/start
        → controller looks up the App + Server
        → services.StartComposeApp(server, ComposePath):
            • NewDockerClient(server) over mTLS
            • derive compose project name = sanitized basename of ComposePath
            • ContainerList filtered by label com.docker.compose.project=<name>
            • ContainerStart (start) / ContainerStop (stop) each matched container
        → updates apps.status = 'running', sets TimerEndsAt = now + AutoStopTimeout
        → writes audit_log row
Background goroutine (StartTimerService) wakes every 30s, finds running apps where TimerEndsAt < now, calls stop.
```
> **Semantic change from the SSH era:** this starts/stops *existing* containers by compose label rather than running `docker compose up/down` from the compose file. The project's containers must have been deployed on the host at least once. There is no native "compose up" in the Docker Engine API — this is the pure-API equivalent.

**Database dump flow** (PostgreSQL, fully streamed):
```
Browser → POST /api/postgres/dump { server_id, container_id, database }
        → controller loads Server row
        → services.CreateDump: NewDockerClient → ContainerExecCreate(User:"postgres",
          Cmd: sh -c 'pg_dump -U postgres "$1" | gzip -c -1' sh <db>) → ContainerExecAttach
        → stdcopy.StdCopy demultiplexes the exec stream into an io.Pipe; returns the
          read end as an io.ReadCloser (memory stays flat — nothing buffered)
        → controller streams it via c.Stream(...) with Content-Encoding: gzip,
          Content-Type application/sql, filename "<db>-<timestamp>.sql"
Browser/fetch transparently gunzips (Content-Encoding) → saves a plain .sql file.
```
- `User: "postgres"` makes pg_dump authenticate over the container's local Unix socket (peer auth) — no DB username/password needed.
- **Plain SQL, gzip-compressed on the remote, served with `Content-Encoding: gzip`.** The browser decompresses transparently, so the user gets a plain `.sql` (restore with `psql -f`). `gzip -1` is fast (much lighter than the old `-F c` zlib level 6) and keeps the wire transfer small. The DB name is passed as the positional arg `"$1"` (not interpolated into the shell string) to avoid injection.

**Superuser resolution (in [postgres_service.go](backend/services/postgres_service.go))** — `credAttempts()` builds an ordered credential chain; `GetDatabases`/`TestConnection` run each via `runAcrossCreds` until one succeeds (first wins), and `CreateDump` probes the chain with `resolveDumpExec` (cheap `SELECT 1`) then streams as the winner. Order:
1. **Per-container credentials** (override): a [PostgresCredential](backend/models/postgres_credential.go) row for the container → run as OS `root` + `PGPASSWORD` + `psql/pg_dump -U <dbUser> -d <dbName>`. For exceptions on a host.
2. **Default** `postgres`/`postgres`: same `root` + `PGPASSWORD` exec block (no hardcoded `-U postgres`) — fast path for standard images.
3. **Server-level credentials** (shared fallback): from the `Server` row (`pg_user`/`pg_password_encrypted`/`pg_maintenance_db`, decrypted via `serverLevelCreds()`), used when the default fails. Configure once per host in the Infrastructure server dialog — the usual case for a fleet of hardened containers sharing one superuser (e.g. `nexgensis`/`nexgendb`).
4. **Discovered superuser** (safety net): if `postgres` is genuinely missing (`role "postgres" does not exist`), discover the postmaster's OS owner via `ps -ef | grep postgres | … | head -n1` and retry over peer auth.

**PostgresCredential** (table `postgres_credentials`, AutoMigrated): keyed by **(server_id, container_name)** — name is stable across container recreation. `db_password_encrypted` is AES-encrypted via `utils.Encrypt`/`Decrypt` (`ENCRYPTION_KEY`), never serialized back (only a `hasPassword` flag). Routes: `GET /servers/:id/postgres/credentials` (auth), `PUT` + `DELETE /servers/:id/postgres/credentials[/:container_name]` (admin). The controller decrypts and passes a `services.PostgresCreds` to the service; the discovery/test calls carry the container name via `?container_name=`, the dump via `container_name` in the POST body. UI: a "Credentials" button per container in [PostgresManager.tsx](frontend/src/components/PostgresManager.tsx) opens a **Radix dialog** (shared `ui/dialog.tsx`, flat `bento-card`) with Database User / Password (show-hide) / Maintenance DB (defaults `postgres`); saving closes it and reloads via the new creds.

### Security Scan Report
A **"Security Scan"** tab shows the latest CI/CD security-scan report (SonarQube/Trivy/OWASP-ZAP JSON) per repo+branch, pulled from a Sonatype Nexus raw repo.
- **Model** `ScanReport` (table `scan_reports`, AutoMigrated): config `RepoName`/`Branch`/`Scanner`/`NexusRepo`/`ReportPath` (admin-set, unique on repo+branch+scanner) + poller-filled `ReportJSON` (**text**, not jsonb — empty string isn't valid jsonb), `AssetPath`, `LastModified`, `FetchedAt`, `Status` (pending/ok/error), `ErrorMsg`. [models/scan_report.go](backend/models/scan_report.go).
- **Poller** `StartScanReportService` ([services/nexus_service.go](backend/services/nexus_service.go)) — ticker (5 min, mirrors `StartTimerService`), started in [main.go](backend/main.go). Idle if `NEXUS_URL` unset. Per tick: group sources by Nexus repo, list assets via REST (`/service/rest/v1/assets?repository=`, paginated, Basic auth), `pickLatestAsset` (path-prefix match; filename containing `latest` wins, else newest `lastModified`), download changed ones, store JSON.
- **Routes**: `GET /scan-reports` + `GET /scan-reports/:id` (auth); `POST /scan-reports`, `POST /scan-reports/:id/refresh`, `DELETE /scan-reports/:id` (admin). [controllers/scan_report.go](backend/controllers/scan_report.go).
- **UI** [components/SecurityScanReport.tsx](frontend/src/components/SecurityScanReport.tsx) + [hooks/useScanReports.ts](frontend/src/hooks/useScanReports.ts): flat table (Repo/Branch/Scanner/Status/Updated/Actions); "View" opens a dialog with the pretty-printed JSON (V1 = raw JSON, no severity parsing yet). The component takes a **`manage`** prop: the standalone **Security Scan** tab renders it read-only (`<SecurityScanReport />`, View only — visible to all users), while **Config → Scan Sources** renders `<SecurityScanReport manage />` with the "Add Source" dialog + per-row Refresh/Delete (admin-only, since Config is admin-only). All source management lives in Config.

### Running Apps
A **"Running Apps"** tab gives a live drill-down per server: **Server → Compose project → Container → frontend URL**. URLs are resolved automatically — if the host's nginx fronts the container's published port, the chip links to `https://<domain>`; otherwise it falls back to `http://<server.address>:<port>`. No DB persistence — everything is live from the Docker API.
- **Project discovery** ([services/running_apps_service.go](backend/services/running_apps_service.go)): list running containers via the existing mTLS Docker SDK; group by labels `com.docker.compose.project` + `…working_dir` (mirrors what `docker compose ls` shows). Containers without the compose label are skipped.
- **Domain resolution via helper agent** ([services/nginx_resolver.go](backend/services/nginx_resolver.go)): each managed host runs one tiny container the admin deploys once — preferred lookup by label `webmanager.agent=true` (fallback name `webmanager-agent`). Backend `docker exec`s `cat /etc/nginx/conf.d/*.conf` into it, parses `server { server_name X; proxy_pass http://…:<port>; }` blocks into a `port → domain` map, caches per server for 60s. **Deploy command** (paste-and-run on the host; shown inline in the UI when the agent is missing):
  ```bash
  docker run -d --name webmanager-agent --restart unless-stopped \
    --label webmanager.agent=true \
    -v /etc/nginx/conf.d:/etc/nginx/conf.d:ro \
    alpine:3 sleep infinity
  ```
  If the agent isn't deployed, the backend returns `agentMissing: true` and URLs fall back to IP:port — the UI shows a flat banner with the copyable command. **V2:** `proxy_pass http://<upstream>` referencing `upstream{}` blocks (current parser handles direct `host:port` only).
- **Route**: `GET /servers/:id/running-apps` (auth) → `{ projects: [...], pinned: string[], agentMissing: bool }`. [controllers/running_apps.go](backend/controllers/running_apps.go).
- **Pinning (admin-only, globally visible)**: admins can pin a root-group (e.g. "qms", "ebmr") on a server so it sorts to the top of the cards for **every** viewer. Backed by [models/pinned_project.go](backend/models/pinned_project.go) — table `pinned_projects` keyed by unique `(server_id, group_name)`. Toggle endpoints `admin.PUT/DELETE /api/servers/:id/running-apps/:group/pin` (audit-logged as `pin`/`unpin`). The service reads pins inside `ListProjects` and returns them as `pinned: []string` alongside `projects`; a DB hiccup on the pin query is non-fatal. Frontend hook adds `setPinned(serverId, group, pinned)`; the card shows a Pin chip on the colored top — admin-clickable toggle, non-admin sees it only when pinned.
- **UI** [components/RunningApps.tsx](frontend/src/components/RunningApps.tsx) + [hooks/useRunningApps.ts](frontend/src/hooks/useRunningApps.ts): server picker → split view. The grid view shows **folder-shape cards** (4 per row at xl breakpoint, square aspect, SVG `clipPath` cuts the inverse-curve tab) plus a left stats sidebar (Applications / Containers / Compose Files). **Theme-aware palette** via [hooks/useTheme.ts](frontend/src/hooks/useTheme.ts) (watches `.dark` class on `<html>` with a MutationObserver):
  - **Light**: blue `#1aa3ff` outer / cream `#f0f7fc` body for unpinned; orange `#e85d2f` outer / cream `#fdf0e8` body for **pinned** — the warm color reads as "promoted" at a glance. Sidebar uses three colorful tinted cards with icons (`Layers`, `Container`, `FileCode2`).
  - **Dark**: vibrant gradient top (blue `#3b82f6 → #1d4ed8` unpinned, red `#ef4444 → #b91c1c` pinned) with a `#111` border, dark `#222` folder body, glossy white sheen overlay on the top 40%, white title + count, gray subtitle/label. Sidebar uses three matching dark `#222 / #111` cards — no icons, big white number.
  - Drill-in (Frontends/Services split) and the agent-missing banner are unchanged by the redesign.

---

## 5. Key features

| Sidebar item | What it does | Admin-only? |
|---|---|---|
| **Applications** | Lists Docker Compose apps grouped by project. Start/Stop buttons start/stop the project's containers via the host's Docker API (mTLS). Per-app runtime timer (e.g., auto-stop after 60 min). | No (users can start/stop) |
| **Database Dump** | Lists postgres containers on a server → lists databases in a container → downloads `pg_dump` output as `.sql`. | No |
| **Infrastructure** | CRUD for Servers (with mTLS Docker API credentials) + Projects. | Yes |
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

**Completely flat** (no box/drop shadows anywhere), **minimalist**, with a **dual Light/Dark theme** and vibrant accents. The folder-tab navigation stays; the active tab is the **same color as the content card** so its flared base melts in seamlessly.

### Theming (Light + Dark)

- Toggle: a Sun/Moon button in the top bar ([App.tsx](frontend/src/App.tsx)) toggles the **`.dark` class on `<html>`**, persisted to `localStorage['devops-theme']` (default light). All tokens swap via `:root` (light) vs `.dark` in [globals.css](frontend/src/styles/globals.css).
- **Light:** page `--canvas` `#FDFBF7` (grid-paper) · card/active-tab `--card` `#FFFFFF` · text `--ink` `#1A1A1E` · accents **vibrant** (electric blue `#2563EB`, emerald `#10B981`, coral `#FF5A5F`).
- **Dark:** page `--canvas` `#1A1A1E` · card/active-tab `--card` `#252529` · text `--ink` `#F5F5F7` · accents **neon** (cyan `#22D3EE`, lime `#A3FF12`, cyberpunk pink `#FF2D78`).
- `--on-accent` = text color on accent fills (white in light, near-black `#0A0A0C` in dark). `--folder-cream` aliases to `--card`; `--folder-bg` to `--canvas`. Per-tab colors are themed vars: `--tab-apps/-db/-infra/-users/-audit` (vibrant in light, neon in dark).

> **Token names are misnomers:** `--accent-pink` is the **PRIMARY** accent (blue in light, cyan in dark); `--accent-peach` is secondary. Legacy aliases `--accent-lime/--accent-mint/--accent-cyan` map to them. To recolor a theme, edit the `:root` / `.dark` token values.

> **Text colors:** components use `text-[var(--ink)]` / `text-[var(--ink-muted)]` (NOT `text-slate-*`) so they adapt to the theme. A past attempt to remap `text-slate-*` via a `.dark` CSS override **did not win** against Tailwind v4's layers — so text was swept to themed utilities across `src/components`. Use themed vars for any new text.

### Layout shape — **folder-tab navigation** (no sidebar)

The sidebar was replaced by a **folder/tab** metaphor (Long Black inspired); the old `Sidebar.tsx` was deleted. Nav now lives in [components/FolderTabs.tsx](frontend/src/components/FolderTabs.tsx) and the [App.tsx](frontend/src/App.tsx) shell.

Skeuomorphic **manila-folder** look (cream folder on a muted background).

- **Brand**: **Nexus Aura** (product identity). The hexagon-N mark + halo live in [components/NexusAuraMark.tsx](frontend/src/components/NexusAuraMark.tsx) (`NexusMark` = the SVG hexagon N; `NexusAuraLogo` = mark + spinning pastel `.aura-halo`). Top bar shows `NexusMark` + "Nexus Aura"; the big aura logo is on the login brand panel.
- **Typography** (Nexus Aura): `--font-serif` = **Newsreader** (editorial serif) on all `h1`/`h2` + `.font-display`; `--font-sans` = **Inter** on body/UI (loaded via `<link>` in [index.html](frontend/index.html)). `letter-spacing` slightly tightened on headings, loosened on body.
- **Root page bg**: **clean dot-matrix** — `.dot-matrix` class on the root container: a single `radial-gradient(var(--dot) …)` tiled on an 18px grid over `--folder-bg` (`#FDFBF7`). `--dot` is charcoal `rgba(26,26,30,0.14)` in light, near-white `rgba(245,245,247,0.10)` in dark. No image asset, crisp at any zoom. (Replaced the animated `.aura-bg` mesh blobs, now removed; the login-logo `.aura-halo` is unrelated and still used.) The card sits on it flat (no border, no shadow).
- **Top bar**: brand = `NexusMark` (hexagon N) + "Nexus Aura" on the left; theme toggle + user chip + Sign-Out on the right.
- **Page header** (in [App.tsx](frontend/src/App.tsx)): two layers. (1) The **top-left brand block** stacked vertically — Row 1 `NexusMark` + "Nexus Aura" wordmark, Row 2 a **constant** serif `h1` "Nexus Aura Portal", Row 3 a fixed muted sub-description. (2) A **per-view editorial header** at the top of the folder paper — big serif `h1` (`font-display text-4xl`) + muted subtitle, driven by the `VIEW_META` map keyed on `activeView` (e.g. "Database Dump" / "Dump and download PostgreSQL databases from containers"). Edit `VIEW_META` to change a tab's title/subtitle.
- **Folder tabs** ([FolderTabs.tsx](frontend/src/components/FolderTabs.tsx)): **asymmetric manila-folder tabs** via `.folder-tab` — an **SVG alpha-mask** (`viewBox 0 0 200 72`, `preserveAspectRatio=none`) shapes each: straight-ish left, flat top, **long sweeping right tail**. **5 top-level tabs**: Database Dump (default `activeView`), Applications, **Running Apps**, Security Scan, and **Config** (`adminOnly`). Config groups the admin sections as **sub-tabs** (Radix `Tabs` in [App.tsx](frontend/src/App.tsx), `configTab` state): Infrastructure, Users, **Scan Sources**, Audit Logs — each with its own header via the `CONFIG_TABS` map. Per-tab colour via `--tab-color` — db `#4285F4`, apps `#EA4335`, running `#FF6B35` (orange-coral), scan `#0F9D9D` (teal), config `var(--tab-users)` purple (themed vars, same in light/dark). Large/spacious: `w-72`, `text-lg`, left-aligned labels, `-30px` overlap. **Typography split**: active tab = heavy serif (`font-display font-bold`, `h-6 w-6` icon); inactive = bold sans (`font-sans font-semibold`, white on the vivid colour).
- **Cascade + overlap**: tab row `z-20` over panel `z-10`; `margin-right: -22px`; left-to-right z-cascade `z = 10 - i`; active tab `z-50`.
- **Active tab**: `--tab-color` = **`var(--card)`** so it melts into the card and masks the card's top border; pops taller (`pt-5` + `h-5` icon vs inactive `pt-3` + `h-4`). The card's top-left is squared (`rounded-tr-[28px] rounded-b-[28px]`) so the first tab's straight left edge continues the card edge.
- **Folder body (main card)**: flat `bg-[var(--folder-cream)]` (= `--card`) with a **subtle grey border** (`border border-[var(--border)]`), **no shadow, no texture**, scrollable. (The earlier colored/`--active-tab-color` border was removed — the frame is a neutral grey hairline.)
- **Utilities** (in [globals.css](frontend/src/styles/globals.css)): `.grid-paper` (themed page grid + pastel glows), `.folder-paper` (flat `--folder-cream` fill), `.folder-tab` (asymmetric manila shape via SVG mask; uses `--tab-color`).
- **Login page**: split-screen — left brand panel with blue bloom on `--canvas-soft`, right white card. The centered `NexusAuraLogo` is followed by the serif `h1` "Nexus Aura Portal" + sub-text "Database, apps, and users".

### Card utility

There is **one** card utility, defined three times under three names for back-compat. **Flat — no shadow**, just a themed fill + hairline border:
```css
.bento-card, .glass-card, .glass-card-strong {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
}
```
Use `bento-card` for new code. The `glass-*` names are kept because old components still reference them. Form primitives (`input`/`select`/`textarea`) and `AccentButton` are themed via the same tokens (`--card`, `--border`, `--ink`, `--accent-pink`, `--on-accent`).

**Dialogs** ([ui/dialog.tsx](frontend/src/components/ui/dialog.tsx), Radix): flat — `DialogContent` uses `glass-card-strong` (= flat card) and the overlay is a plain dim (`bg-black/50`, **no `backdrop-blur`**, per the no-glassmorphism rule). Shared by all app dialogs (apps, servers, projects, users, postgres credentials).

### No animation

- `framer-motion` is installed but **not used anywhere**. Removed `motion.div`, `whileHover`, `whileTap`, `layoutId`, `AnimatePresence` calls during the warm-UI pass.
- Navigation is instant via direct `onNavigate(view)` — no view-transition animation (the unused `lib/view-transitions.ts` helper was removed).
- Only animations remaining are CSS transitions on hover (color/bg), focus rings, the skeleton shimmer keyframe, and a `.glass-skeleton::after` sweep.

---

## 8. Component conventions

- **`bento-card` utility** for any card surface — gives the standard border + radius.
- **`AccentButton`** ([components/ui/accent-button.tsx](frontend/src/components/ui/accent-button.tsx)) for primary CTAs. Variants: `'pink'` (default), `'ghost'`, `'destructive'`. Aliases `'lime'` and `'cyan'` map to pink so legacy callers keep working.
- **`PillTag`** ([components/ui/pill-tag.tsx](frontend/src/components/ui/pill-tag.tsx)) is the project-wide tag/label primitive — rounded pill, 2px accent border, soft tinted bg, optional icon (or dot) in a tinted circle. **8 tones**: `blue`, `green`, `purple`, `orange`, `slate`, `cyan`, `red`, `amber`. **2 sizes**: `sm` / `md`. Reach for it for any status/role/category chip: `<PillTag tone="purple" icon={Shield}>admin</PillTag>`.
- **`StatusBadge`** ([components/ui/status-badge.tsx](frontend/src/components/ui/status-badge.tsx)) for online/offline/idle/running/stopped — thin wrapper over `PillTag` (online → green/`Activity`, offline → red/`CircleOff`, idle → slate/`Clock`), so refreshing `PillTag`'s palette refreshes every status pill in one shot. Used in AppCard, Infrastructure, PostgresManager, SecurityScanReport, UserManagement, RunningApps.
- **`useTheme`** ([hooks/useTheme.ts](frontend/src/hooks/useTheme.ts)) returns `'light' | 'dark'` by watching the `.dark` class on `<html>` via MutationObserver. Use it when inline-styled components (hex colors, gradients) need to swap palettes per theme — Tailwind's `dark:` modifier doesn't reach inline styles. Example: RunningApps card cluster.
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
POST   /api/servers/refresh             Refresh status of all servers (Docker API ping)
POST   /api/servers/:id/test            Test Docker API connection (mTLS ping)
GET    /api/projects                    List projects
GET    /api/apps                        List apps
POST   /api/apps/:id/start              Start app (Docker API: start compose-project containers)
POST   /api/apps/:id/stop               Stop app (Docker API: stop compose-project containers)
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
| **servers** | `id` UUID PK, `name`, `address`, `docker_api_port` (default 2376), `tls_ca` (plain PEM), `tls_cert` (plain PEM), `tls_key_encrypted` (client key, AES-CFB encrypted with `ENCRYPTION_KEY`), `status`, `last_checked` (epoch ms); optional server-level PG fallback creds `pg_user`, `pg_password_encrypted` (AES), `pg_maintenance_db` | `RunningAppsCount` is `gorm:"-"` (computed). `TLSKey` and `PGPasswordEncrypted` are `json:"-"` (never returned); `PGHasPassword` is a computed `gorm:"-"` flag. Edited in the ServerManagementDialog "PostgreSQL Credentials (optional)" section. |
| **projects** | `id` UUID PK, `name` (unique), `description` | Just a label to group apps |
| **apps** | `id` UUID PK, `name`, `domain`, `compose_path` (column `cdPath` in JSON), `project_id` FK, `server_id` FK, `app_url`, `auto_stop_mins`, `status`, `started_at`, `timer_ends_at` | Timer service auto-stops on expiry |
| **audit_logs** | `id` UUID PK, `user_id`, `username`, `action` (`start_app`, `stop_app`, `create_*`, `update_*`, `delete_*`, `sso_login`, ...), `resource_type`, `resource_name`, `details`, `ip_address`, `user_agent` | Append-only |

All tables have GORM soft-delete via `deleted_at` (indexed) — **except server deletion**, which is a **hard delete**: `DeleteServer` ([backend/controllers/server.go](backend/controllers/server.go)) uses `Unscoped().Delete()` and, in the same transaction, hard-deletes the server's apps first (the `fk_apps_server` foreign key would otherwise block it). So deleting a server physically removes it and its apps from the DB.

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

> **Vite HMR in Docker:** the bind-mount on Linux doesn't propagate inotify events into the container, so HMR silently stops detecting edits. [vite.config.ts](frontend/vite.config.ts) sets `server.watch.usePolling: true` to fix this. If edits ever stop hot-reloading, confirm that option is present and restart the `web` container. Note `npm run build` writes to `/build` and is **not** what the dev server serves — the dev server (`npm run dev`) transforms source live, so a fresh page load always reflects on-disk code even if an open tab is stale.

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
| `ENCRYPTION_KEY` | `12345678901234567890123456789012` (32 chars, AES-256) | backend (encrypts the client TLS private key in `servers.tls_key_encrypted`) |
| `NEXUS_URL` / `NEXUS_USER` / `NEXUS_PASS` | empty in dev (poller idle) | backend Security Scan Report poller — Sonatype Nexus base URL + Basic-auth creds. Empty `NEXUS_URL` ⇒ poller does nothing. |
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

1. ~~SSH command timeout is only the handshake~~ **(RESOLVED in the mTLS migration.)** SSH is gone. Per-operation deadlines now come from the `context` passed to each Docker SDK call; the dump stream intentionally has no overall HTTP-client timeout so large dumps can run.

2. ~~DB dump is fully buffered in memory~~ **(RESOLVED.)** `CreateDump` now returns a streaming `io.ReadCloser` (Docker exec → `stdcopy.StdCopy` → `io.Pipe`) and the controller pipes it with `c.Stream(...)`. Memory stays flat regardless of dump size.

3. **`utils.Decrypt` silently passes through bad input** ([backend/utils/crypto.go](backend/utils/crypto.go)). If `ENCRYPTION_KEY` is empty / wrong / ciphertext is too short, it returns the input unchanged rather than erroring. Makes debugging "why does the mTLS handshake fail" hard. The prod `ENCRYPTION_KEY` matches the dev compose value (`12345678...`), so restored prod data works in dev — but don't change `ENCRYPTION_KEY` without re-encrypting all `servers.tls_key_encrypted` rows.

4. **`vite.config.ts` has versioned-aliased imports**. The file was originally a Figma Make export, so some `@radix-ui/...@1.1.2` style imports show up in components. Vite resolves these via a giant `resolve.alias` map. Don't be alarmed; they all point at the unversioned package.

5. **No CSRF protection**. Backend trusts `Authorization: Bearer` blindly. JWTs in localStorage means XSS is the attack surface. Mitigation: the frontend escapes everything (React default).

6. ~~`Content-Type: application/sql` on dump response~~ **(RESOLVED.)** Now `application/octet-stream` with a `.dump` filename.

7. **Dev compose ports collide with prod compose** (5432, 8080). Run one stack at a time. If you `docker compose up` (prod) while dev is running, the second one will fail to bind.

8. **The `webmanager-backend-1` / `webmanager-postgres-1` containers from older runs may linger** if someone used compose v1 syntax. `docker ps -a | grep webmanager` to spot them, `docker rm -f` to clean up. The `webmanager_pgdata` named volume still holds the old prod data.

9. **Dead code has been pruned** — a reachability audit removed all unreached components/hooks/lib files, 37 unused `ui/` primitives, and 4 unrouted backend handlers. Reachability from `main.tsx` is 100%; keep it that way (don't add files nothing imports).

10. **Backend logs SSH cookies on the OAuth state path** — `controllers/sso.go` has a `log.Printf` for `SSO_ENABLED` debug that the user wanted to remove. Not critical, just noisy.

11. **Remote hosts must expose the Docker Engine API on `:2376` with mTLS.** Each server row needs a CA cert, client cert, and client key that the daemon trusts. If the daemon isn't listening on the configured `docker_api_port`, or the certs don't match, the health check shows `offline` and every remote op fails at `NewDockerClient`/`Ping`. The mTLS verifies the cert against the connection host (`address`), so the daemon cert must include that IP/hostname as a SAN.

12. **Compose start/stop is label-based, not `compose up/down`** (see section 4). An app whose containers were never created on the host (or were `down`-removed) has nothing to start — `StartComposeApp` returns "no containers found for compose project". The compose project name is derived from the basename of `ComposePath`; if the host used a non-default `-p` project name, the label won't match.

---

## 15. Critical files (one-line tour)

| Path | What |
|---|---|
| [backend/main.go](backend/main.go) | Entry — connects DB with retry, auto-migrates models, starts timer service, starts router |
| [backend/router/router.go](backend/router/router.go) | Every API route in one file — read this to understand the surface |
| [backend/controllers/postgres.go](backend/controllers/postgres.go) | DB dump controller — streams gzipped plain SQL via `c.Stream(...)` with `Content-Encoding: gzip` → browser saves `.sql` |
| [backend/services/docker_client.go](backend/services/docker_client.go) | `NewDockerClient` — builds the mTLS Docker `*client.Client`; every remote op starts here |
| [backend/services/postgres_service.go](backend/services/postgres_service.go) | psql/pg_dump over the Docker Exec API; `CreateDump` returns a streaming `io.ReadCloser` |
| [backend/services/app_services.go](backend/services/app_services.go) | compose start/stop via container start/stop by compose-project label |
| [backend/services/timer_service.go](backend/services/timer_service.go) | Background goroutine: every 30s, auto-stops apps whose `timer_ends_at` has passed |
| [backend/utils/crypto.go](backend/utils/crypto.go) | AES-CFB encrypt/decrypt for the client TLS private key |
| [backend/migrations/001_create_default_users.go](backend/migrations/001_create_default_users.go) | Seeds `sourav` admin |
| [frontend/src/App.tsx](frontend/src/App.tsx) | Top-level layout + view router (state-based, not URL-based) + StatCard component |
| [frontend/src/components/FolderTabs.tsx](frontend/src/components/FolderTabs.tsx) | Folder-tab navigation (multi-color tabs, active = near-black raised folder). Replaced the sidebar. |
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

### Add a new nav item (folder tab)
1. Add the route in [backend/router/router.go](backend/router/router.go)
2. Add a controller in [backend/controllers/](backend/controllers/)
3. Add an entry to the `FOLDERS` array in [frontend/src/components/FolderTabs.tsx](frontend/src/components/FolderTabs.tsx) (id, label, icon, vivid `color`, `adminOnly?`) and extend the `FolderView` union there
4. Extend the `activeView` union in [App.tsx](frontend/src/App.tsx)
5. Render the view conditionally inside the white content sheet in `App.tsx`

### Add a new model
1. New file in `backend/models/` with GORM tags
2. Append it to `db.AutoMigrate(...)` in [backend/main.go](backend/main.go) — GORM creates the table on next boot

### Rotate `ENCRYPTION_KEY` safely
1. Read each `servers.tls_key_encrypted` with the **old** key (decrypt)
2. Re-encrypt with the **new** key
3. Update each row
4. Set new key in env, restart

There is no automated migration for this — you'd write a one-off Go script.

---

## 17. Conventions a future contributor / LLM should follow

- **Don't add framer-motion animations** unless explicitly asked. The user removed all of them and prefers static UI.
- **Don't add glass blur** (`backdrop-filter: blur(...)`). The user rejected it.
- **Navigation is folder-tabs, not a sidebar.** [FolderTabs.tsx](frontend/src/components/FolderTabs.tsx) renders multi-color folder tabs on a near-black folder body holding a white content sheet (see §7). The old `Sidebar.tsx` was deleted. Content cards still use the blue accent (`--accent-pink`, which holds blue); crisp green for online only. To recolor, change the `--accent-*` token values in [globals.css](frontend/src/styles/globals.css) (names are misnomers — they hold blue); folder-tab colors live in `FolderTabs.tsx`.
- **Don't create new card surfaces** — use the existing `bento-card` utility.
- **Don't put text in pure black**; use `var(--ink)` (`#1A1612`, warm near-black).
- **Brand is "Nexus Aura"** (hexagon-N mark in [NexusAuraMark.tsx](frontend/src/components/NexusAuraMark.tsx)). Don't reference `Nexgensis` in user-visible strings. Domain examples in placeholders still use `pharma.qms.nexgensis.com` intentionally — leave them.
- **Don't put new files at the repo root.** Frontend goes in `frontend/`, backend in `backend/`. (There was an incident where `node_modules` ended up at the root from running `npm install` without `cd frontend/` first — don't repeat.)
- **Don't use `window.confirm()`** — use `AlertDialog` from [components/ui/alert-dialog.tsx](frontend/src/components/ui/alert-dialog.tsx).
- **Don't commit `.env` files or any of the secret values in section 13** beyond local dev. Prod values come from the deploy environment.
