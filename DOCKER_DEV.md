# Docker Dev Environment

Local development stack for WebManager with **hot reload** on both backend (Go) and frontend (Vite). One command boots Postgres + API + Web. Code edits are picked up live — no `docker compose build` in your inner loop.

---

## Quick start

```bash
# First time (or after Dockerfile / package.json changes):
docker compose -f docker-compose.dev.yml build

# Boot the whole stack:
docker compose -f docker-compose.dev.yml up

# In another terminal — tail one service:
docker compose -f docker-compose.dev.yml logs -f api

# Stop:
docker compose -f docker-compose.dev.yml down

# Nuke the DB too (start fresh):
docker compose -f docker-compose.dev.yml down -v
```

Then open **http://localhost:3000** and click **Admin login**.

The admin account is seeded only when the `users` table is empty. Set
`ADMIN_USERNAME` / `ADMIN_PASSWORD` in a local `.env`, or leave them unset and
the backend generates a password and prints it once on first boot:

```bash
docker compose -f docker-compose.dev.yml logs api | grep -A2 "initial admin"
```

The frontend dev server proxies `/api/*` to the `api` service, so there's no CORS dance.

---

## What gets hot-reloaded

| Change | Reloads | How |
|---|---|---|
| `backend/**/*.go` | API restarts in ~1s | `air` watches files, rebuilds the binary, restarts |
| `frontend/**/*.{ts,tsx,css}` | Browser updates in <500ms | Vite HMR over WebSocket |
| `backend/go.mod` | rebuild needed | `docker compose -f docker-compose.dev.yml build api` |
| `frontend/package.json` | rebuild needed | `docker compose -f docker-compose.dev.yml build web` |
| `Dockerfile.dev` | rebuild needed | `docker compose -f docker-compose.dev.yml build` |

---

## Files in this setup

```
WebManager/
├── docker-compose.dev.yml      # dev stack (this file)
├── docker-compose.yml          # prod stack (separate, untouched)
├── backend/
│   ├── Dockerfile              # prod — multi-stage, tiny alpine binary
│   ├── Dockerfile.dev          # dev — Go + air, source mounted in
│   ├── .air.toml               # air config: what to watch, where to write
│   └── .dockerignore
└── frontend/
    ├── Dockerfile              # prod — Vite build → nginx
    ├── Dockerfile.dev          # dev — Vite dev server on :3000
    └── .dockerignore
```

---

## Common tasks

```bash
# Run a one-off command in the api container (e.g., go mod tidy):
docker compose -f docker-compose.dev.yml exec api go mod tidy

# Install a new npm package:
docker compose -f docker-compose.dev.yml exec web npm install <pkg>
# (Then rebuild the web image so the package is baked into the next cold start.)
docker compose -f docker-compose.dev.yml build web

# Open a psql shell:
docker compose -f docker-compose.dev.yml exec db psql -U postgres -d webmanager

# See what's running:
docker compose -f docker-compose.dev.yml ps
```

---

## Best practices encoded in this setup

These aren't arbitrary — each one solves a real problem the maintainers of large dev environments have hit. Worth knowing the **why** behind each.

### 1. Separate `Dockerfile.dev` from `Dockerfile`
Don't try to do dev + prod in one Dockerfile. Dev images need `air` / `npm`, source watching, and dev deps. Prod images need to be minimal (alpine + a single binary, or nginx serving static files). Mixing concerns ends in 1GB prod images and slow CI.

### 2. Bind-mount source, NOT the build artifacts
- ✅ `./backend:/app` — your edits flow into the container
- ❌ Bind-mounting `node_modules` from host — host binaries are often the wrong arch (mac arm vs linux x86). Use an **anonymous volume** (`/app/node_modules`) so the container keeps its own.
- ❌ Bind-mounting `tmp/` — air writes the rebuilt binary there; you don't want it bouncing back to the host on every save.

### 3. Named volumes for caches
`go-mod-cache:/go/pkg/mod` persists Go modules between runs. Cold start without it = 30s of `go mod download` every time. Same idea for npm cache if your image isn't pre-installing.

### 4. Pin tool versions
`air@v1.61.5`, `node:20-alpine`, `golang:1.24-alpine`, `postgres:16-alpine`. Floating tags (`latest`, `alpine`) cause "works on my machine" problems when CI pulls a newer base image at a different time.

### 5. `.dockerignore` is critical
Without one, `COPY . .` ships the entire `node_modules`, `.git`, build artifacts into the image and into the daemon's build context. Slow, bloated, leaks secrets. The provided ignores are conservative — extend them if you have local data files.

### 6. `depends_on: condition: service_healthy`
The API waits for the DB to be **actually accepting connections**, not just "container started". Saves you from the classic "API crashed on boot because Postgres wasn't ready yet" race.

### 7. Set `CHOKIDAR_USEPOLLING=true` in containers
On Docker Desktop (macOS/Windows) and WSL2, inotify events from the host don't always make it into the container. Polling is a slight CPU hit but the only reliable way to get HMR / air to notice your edits. Linux native-host setups can skip this if you want.

### 8. `--host 0.0.0.0` / `host: true` on the Vite server
Inside a container, `127.0.0.1` is the container, not the host. Without binding to all interfaces, your host browser can't reach the dev server.

### 9. Proxy API requests, don't hardcode CORS
The Vite dev server proxies `/api` → `api:8080`. Browser sees same-origin requests → no preflight, no CORS config drift between dev and prod.

### 10. `stop_grace_period: 5s`
Lets Ctrl+C kill the stack quickly. Without it, Compose waits 10s per container hoping for graceful shutdown, which feels broken.

### 11. **Never** put real secrets in the compose file
The `JWT_SECRET` and DB password here are placeholders for local dev. In prod, use `env_file`, Docker secrets, or your platform's secret store. CI should run with a separate `.env.dev` and a `.env.prod` it never logs.

### 12. Keep dev and prod compose files separate
- `docker-compose.yml` → what gets deployed (small images, no source mounts, restart: always, no exposed DB port)
- `docker-compose.dev.yml` → your local toolbox (mounts, exposed ports, hot reload)

Don't `extends:` or `merge:` between them unless you've done it before and like cleaning up surprises. Plain duplication is more honest.

---

## How other teams structure this

A few patterns you'll see in the wild, ranked from "common" to "fancy":

1. **Two compose files** (what we do here). Easy to reason about. Works for 95% of teams.
2. **Override file** — `docker-compose.yml` + `docker-compose.override.yml`. Compose auto-merges the override when you run `docker compose up`. Great if dev is "prod + a few mounts," but it pulls a lot of magic.
3. **Profiles** — one file, `profiles: [dev]` / `profiles: [prod]` on services. Single source of truth, picky to read.
4. **Devcontainers** — VS Code's `.devcontainer/` spec. Same idea, IDE-aware. Good for onboarding contributors who don't have Go / Node installed locally.
5. **Tilt / Skaffold / Garden** — full dev orchestrators that watch files and rebuild/redeploy to a real or local Kubernetes cluster. Worth it once your stack is 8+ services.
6. **Bazel / Nx / Turborepo with remote caches** — language-agnostic build graphs. Overkill for a single-service repo, transformative for monorepos.

### Things to look up later (when you outgrow this setup)

- **Multi-stage build cache mounts** (`RUN --mount=type=cache,...`) — significantly faster Go/Node builds
- **BuildKit** (`DOCKER_BUILDKIT=1`) — already default in modern Docker; enables the cache mounts above
- **`docker compose watch`** — newer compose feature, syncs files without bind mounts (more reliable on Windows/macOS)
- **`COMPOSE_BAKE=true`** — parallelizes multi-service builds
- **Docker Compose `develop:` blocks** — declares file-watch behavior per service inline
- **Health endpoints in your services** — `/healthz` on the API lets `depends_on: service_healthy` actually validate readiness rather than just port-open

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Vite HMR not picking up edits | Inotify not bubbling into container | Already set `CHOKIDAR_USEPOLLING=true` — confirm with `docker compose -f docker-compose.dev.yml exec web env \| grep CHOKIDAR` |
| `air` rebuilds in a loop | Air watching its own output | `.air.toml` excludes `tmp/` — make sure it's there |
| `npm install` works on host but not in container | Host wrote musl-incompatible binaries to `node_modules` | `docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml build web` |
| API can't connect to DB | DB not yet healthy at boot | Check `depends_on: condition: service_healthy` is set — it is by default here |
| Frontend says "Failed to fetch /api/..." | Vite proxy not reaching backend | Inside the `web` container `localhost ≠ api`. We set `VITE_DEV_API_PROXY=http://api:8080` — confirm |
| Port 5432 / 8080 / 3000 already in use | Something else holding the port | `lsof -i :<port>` to find it; or change the host port in `docker-compose.dev.yml` |
| Builds are slow on every change | No build cache / inflated context | Check `.dockerignore` doesn't have a typo; run `docker system df` to see cache sizes |
