# Nexus Aura Portal

A unified ops console for the Nexgensis fleet: deploy & manage Docker Compose
apps, dump PostgreSQL databases, watch security-scan reports from Sonatype
Nexus, and view live frontend URLs for every container on every managed host.

Authentication is Microsoft Entra ID (SSO) with a fallback admin password
login for break-glass. All managed-server access goes over the Docker Engine
API on mTLS (port 2376) — no SSH.

---

## 1. Deploy the Nexus Aura Agent

> **First thing to do for every host you want to manage.** Without the agent,
> Running Apps will still show containers but URLs degrade to `IP:port`
> instead of resolving to the host's nginx-fronted domain. The Database Dump
> and Security Scan features are independent and work without the agent.

The agent is a single tiny `alpine:3` container that does one thing: lets the
backend `docker exec` `cat /etc/nginx/conf.d/*.conf` so it can map
`port → domain` for nicer frontend URLs.

Run this **once per managed host**:

```bash
docker run -d --name nexus-aura-agent --restart unless-stopped \
  --label nexus-aura.agent=true \
  -v /etc/nginx/conf.d:/etc/nginx/conf.d:ro \
  alpine:3 sleep infinity
```

That's the entire installation. Verify with:

```bash
docker ps --filter label=nexus-aura.agent=true
```

The Running Apps tab in the UI also shows the exact deploy command inline
whenever the agent isn't found on a server, so you can copy-paste it.

### How the agent is discovered

The backend tries two lookups in order (see
[`backend/services/nginx_resolver.go`](backend/services/nginx_resolver.go)):

1. Label `nexus-aura.agent=true` (preferred — survives renames)
2. Container name `nexus-aura-agent`

### Removing the agent

```bash
docker rm -f nexus-aura-agent
```

The Running Apps view will fall back to IP:port URLs and show a banner with
the deploy command again.

---

## 2. Bring up the portal

The portal itself runs in Docker Compose. The development stack is in
[`docker-compose.dev.yml`](docker-compose.dev.yml); production uses the same
shape with hardened settings.

### Prerequisites

- Docker Engine 20.10+ and Docker Compose v2
- An mTLS CA for issuing client certs to the portal (see Section 4)
- A Microsoft Entra ID app registration (client ID + secret + tenant ID)
- A Sonatype Nexus repo for scan reports (optional — only needed if you want
  the Security Scan tab)

### Start the dev stack

```bash
docker compose -f docker-compose.dev.yml up -d
```

This brings up the backend (Go), frontend (Vite), and PostgreSQL. The
frontend mounts the source as a volume with Vite HMR (polling-mode for
Docker), so edits hot-reload.

Open <http://localhost:3000>.

### Database migrations — automatic

On every backend boot, [`backend/main.go`](backend/main.go) runs:

1. **GORM `AutoMigrate`** for all models — creates new tables and additive
   columns. Idempotent.
2. **`migrations.CreateDefaultUsers`** — seeds the fallback admin if missing.
3. **`migrations.AddTimerEndsAtColumn`** — adds `timer_ends_at` to `apps`.
4. **`migrations.DropSSHColumns`** — drops legacy `ssh_user`, `ssh_port`,
   `ssh_key_encrypted` from `servers`. **Destructive — only matters on the
   first boot of v1.4.0+.**

Any failure here is `log.Fatalf`, so a misconfigured DB crash-loops the
container — watch `docker logs backend` after deploy.

---

## 3. Environment variables

Set these in your Compose environment / `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres DSN for the portal's own metadata DB |
| `JWT_SECRET` | yes | Signs auth tokens |
| `ENCRYPTION_KEY` | yes | AES key used to encrypt PostgreSQL credentials + mTLS client keys stored in the DB (32 bytes hex) |
| `SSO_ENABLED` | yes | `true` to enable Microsoft Entra SSO |
| `AZURE_TENANT_ID` | if SSO | Entra tenant ID |
| `AZURE_CLIENT_ID` | if SSO | App registration client ID |
| `AZURE_CLIENT_SECRET` | if SSO | App registration client secret |
| `AZURE_REDIRECT_URL` | if SSO | OAuth callback URL — must match the app registration |
| `NEXUS_URL` | optional | Sonatype Nexus base URL for scan-report fetches |
| `NEXUS_USER` | optional | Nexus username |
| `NEXUS_PASS` | optional | Nexus password |
| `VITE_API_URL` | frontend | Backend base URL (omitted in prod when same-origin) |

If SSO env is missing, only the admin password login works (good for
bootstrapping).

---

## 4. First-time setup

Walk-through after the stack is up and you've logged in as admin.

### a. Register your first server (Config → Infrastructure)

Each managed host needs:

- A **CA certificate** for the host's Docker daemon (`/etc/docker/ca.pem`)
- A **client certificate** signed by that CA
- A **client key** for the client certificate

These are pasted into the "Add Server" dialog as text. The portal encrypts
the client key at rest with `ENCRYPTION_KEY` before saving.

The host's Docker daemon must be listening on `tcp://0.0.0.0:2376` with mTLS
enabled. Typical `daemon.json`:

```json
{
  "tls": true,
  "tlsverify": true,
  "tlscacert": "/etc/docker/ca.pem",
  "tlscert": "/etc/docker/server-cert.pem",
  "tlskey": "/etc/docker/server-key.pem",
  "hosts": ["tcp://0.0.0.0:2376", "unix:///var/run/docker.sock"]
}
```

> ⚠️ **v1.4.0 migration note**: any server registered before v1.4.0 used SSH.
> Those rows lost their SSH connection columns when `DropSSHColumns` ran on
> the first v1.4.0 boot. **Re-register them with mTLS credentials** or
> they'll fail to connect.

### b. Deploy the Nexus Aura Agent on the host

See Section 1.

### c. (Optional) Add PostgreSQL credentials for hardened containers

If your Postgres images have removed the default `postgres` superuser, go to
**Database Dump → click the container → Credentials** and configure a
per-container user/db/password. Passwords are AES-encrypted with
`ENCRYPTION_KEY`. The sidebar shows a small key icon on containers with
custom creds set.

### d. (Optional) Register security-scan sources

**Config → Scan Sources → Add Source**. One row per (repo, branch, scanner).
The backend fetches the report on create/update and on the manual Refresh
button in the dashboard — there is no background polling.

---

## 5. Using the portal

### Database Dump

- Pick a server card → pick a container in the left sidebar → see all
  databases on the right
- Click **Download** to stream a `pg_dump` of one database; the button shows
  a live byte/percentage progress strip while the dump runs
- The **Credentials** button (top-right of the container view) lets you set
  per-container DB user/password — for images that removed the default
  `postgres` role

### Running Apps

- Pick a server → drill into projects → containers
- Containers with published ports show a **Globe** chip with the resolved
  domain (if the agent maps the port to nginx) or `IP:port` otherwise
- **Admins** can **pin** a root-group (e.g. "qms") so it sorts to the top of
  the cards for every viewer
- If the agent isn't deployed on a server, you'll see a yellow banner with
  the exact `docker run` command — copy, paste-and-run on the host

### Security Scan

- Pick a `(repo, branch)` env from the dropdown
- Click **Refresh** to fetch the parsed report — **no auto-polling**, the
  dashboard never calls the API until you ask
- The four severity cards (Critical / High / Medium / Low) reflect the
  aggregate across all scanners in the env
- Three panels:
  - **Container & Dependencies** — Trivy (CVE table + SBOM)
  - **Code Quality** — SonarQube (metrics + report excerpt)
  - **Live Runtime API** — OWASP ZAP (alert table)

### Config (admin only)

Four sub-tabs:

- **Infrastructure** — add / edit / delete servers and projects
- **Users** — manage user accounts, roles (admin / user), and SSO mappings
- **Scan Sources** — register / refresh / delete scan-report sources
- **Audit Logs** — review system activity (every privileged action is
  logged: app start/stop, project edits, server credential changes, scan
  source CRUD, pin/unpin, user role changes)

---

## 6. Operational notes

### Backups

Before deploying a new version that includes destructive migrations, back up
the portal's own Postgres database. Managed hosts' databases are dumped on
demand from the Database Dump tab — they aren't backed up by the portal.

### Logs

- Backend: `docker logs <backend-container>`
- Frontend dev server: `docker logs <frontend-container>` (Vite output)
- Agent: usually silent — `docker logs nexus-aura-agent` will be empty
  unless you ran something via `docker exec` and want to see stdout/stderr

### Updating

```bash
git pull --tags
docker compose -f docker-compose.dev.yml pull        # if using a registry
docker compose -f docker-compose.dev.yml up -d --build
```

Migrations run automatically on the new backend's first boot. Watch the logs
for the migration lines (`Failed to ...` is fatal).

### Updating the agent across hosts

Re-run the install command on each host whenever the agent image or settings
change:

```bash
docker rm -f nexus-aura-agent 2>/dev/null
docker run -d --name nexus-aura-agent --restart unless-stopped \
  --label nexus-aura.agent=true \
  -v /etc/nginx/conf.d:/etc/nginx/conf.d:ro \
  alpine:3 sleep infinity
```

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| "No server configuration" flashes briefly when switching tabs | Server hook fetches per-tab — fixed in v1.4.0+ by gating the empty state on `isLoading` |
| Running Apps shows IP:port instead of domains | Agent missing or label mismatch — re-run the deploy command from Section 1 |
| Server "checking" → "offline" with no apps | mTLS creds wrong, host daemon not on `:2376`, or firewall blocking |
| Security Scan stays at zeros | You haven't clicked Refresh yet — there is no auto-fetch |
| Login fails with "Failed to initialize Microsoft login" | One of the `AZURE_*` env vars is unset or `AZURE_REDIRECT_URL` doesn't match the app registration |
| Database Dump "role postgres does not exist" | Hardened image — open Credentials and configure a real DB user for that container |

---

## 7. Repository layout

```
backend/                  Go API server
  main.go                 Boot, auto-migrate, route registration
  controllers/            HTTP handlers (one file per feature)
  services/               Business logic (docker, postgres dump, nginx resolver, nexus)
  models/                 GORM model definitions
  migrations/             Explicit non-AutoMigrate migrations (numbered)
  router/                 Route table + middleware
frontend/                 React 18 + Vite + Tailwind v4
  src/components/         UI components (one folder per feature)
  src/hooks/              Data-fetching + utility hooks
  src/types/              Shared TS types
docker-compose.dev.yml    Local development stack
AGENTS.md                 Detailed living context doc (read this before deep edits)
.github/release_notes/    Per-version release notes
```

[`AGENTS.md`](AGENTS.md) is the deep-context source — read it before doing
non-trivial work on the codebase. This README is the operator's guide;
AGENTS.md is the engineer's.
