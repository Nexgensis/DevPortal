# Password Vault: Change Log

Branch: `feature/password-vault`
Commit: `78a77ab` ("feat(vault): add encrypted password vault with MFA unlock and client/app access grants")
Base: `main` @ `50efa05`
Size: 51 files (17 modified, 34 new), +8625 / −45 lines

## What the feature does

The vault adds a **Vault** tab to the Dev Portal. It stores shared logins in three levels:

**Client** → **App** (holds the login URL) → **Accounts** (label, username, encrypted password, encrypted notes)

- **Encryption:** passwords and notes are encrypted with AES-256-GCM. The keys are separate from the database: they come from the `VAULT_KEYS` env var.
- **Unlock:** you have to unlock the vault with MFA, once per login session, for at most 24h.
  - People who signed in with Microsoft unlock by doing a fresh Microsoft sign-in (the org's own MFA).
  - Everyone else (password logins, break-glass admins) uses an authenticator app (TOTP).
- **Access:** admins can see everything. Anyone else needs an admin to grant them access to a whole client or to one app, at either **View** or **Edit** level.
- **Audit:** every reveal, copy and change goes into an append-only audit log.

> **Not verified yet:** this machine has no Go, Node or Docker, so the code hasn't been compiled or tested here. Before merging, run `go build ./... && go vet ./... && go test ./...` in `backend/` and `npm ci && npm run build` in `frontend/`. The vault and router integration tests also need `VAULT_TEST_DSN` pointing at a scratch Postgres.

---

## 1. Changes to existing files (17)

### Backend

| File | What changed | Why |
|---|---|---|
| `backend/controllers/auth.go` | The password login no longer builds its own JWT. It calls the shared `issueToken(&user, AuthPassword)`. | Password login and SSO login used to build JWTs separately, and the two had already drifted apart (SSO had `user_id`, password login didn't). One shared function keeps them identical. |
| `backend/controllers/sso.go` | `generateJWT` now calls `issueToken(user, AuthSSO)`. `MicrosoftCallback` takes the vault service and sends callbacks whose state starts with `vault.` to the vault's step-up handler. | "Unlock with Microsoft" reuses the existing SSO redirect URI, so nothing has to change in the Entra app registration. The callback has to tell a normal login apart from a vault unlock. |
| `backend/middleware/jwt.go` | Copies the new `sid` claim (session id), `user_id`, `amr` (how the user signed in: `pwd` or `sso`) and the token expiry into the request context. | The vault unlock is tied to one login session (`sid`), must expire no later than the JWT, and uses `amr` to decide which unlock method to offer. |
| `backend/main.go` | Runs migration `005_password_vault`. Loads the vault keys from `VAULT_KEYS`. Sets up "Unlock with Microsoft" when SSO and a tenant GUID are configured. Passes the vault service to the router. | If `VAULT_KEYS` is unset, only the vault is disabled (it answers 503) and the rest of the portal runs normally. If the keys are set but malformed, the backend refuses to start, so a typo can't quietly make secrets unreadable later. An invalid `VAULT_SSO_AUTH_CONTEXT` also stops startup. |
| `backend/router/router.go` | `SetupRouter` takes the vault service. Adds `POST /api/auth/logout` and mounts the vault routes. Sets gin's trusted proxies (from `TRUSTED_PROXIES`, defaulting to loopback and private ranges). | Logout now has to end something on the server (the vault unlock). Trusted proxies matter because client IPs feed the audit log and the MFA rate limiter. Before this, any caller could fake their IP with `X-Forwarded-For`. |
| `backend/go.mod` / `go.sum` | Adds `github.com/pquerna/otp` (TOTP and QR codes) and `github.com/google/uuid`. Makes `jackc/pgx/v5` a direct dependency. Adds `boombuler/barcode`, which otp needs. | These are needed for MFA enrollment and unlock, and for the IDs and Postgres error handling. |
| `backend/Dockerfile` | Also builds `vaultctl` and copies it into the runtime image. | Operators need the CLI inside the container, for example `docker compose exec backend ./vaultctl rotate`. |

### Deployment / config

| File | What changed | Why |
|---|---|---|
| `docker-compose.yml` (prod) | Passes `VAULT_KEYS`, `VAULT_ACTIVE_KEY_VERSION`, `VAULT_SSO_REQUIRE_MFA_CLAIM`, `VAULT_SSO_AUTH_CONTEXT` and `TRUSTED_PROXIES` through from the environment. No values are hard-coded. | Prod secrets come from the deploy environment. If they're unset, the vault stays disabled. |
| `docker-compose.dev.yml` | Adds a fixed, dev-only `VAULT_KEYS` key and `VAULT_ACTIVE_KEY_VERSION=1`. | The vault works out of the box in local dev, the same way the dev `JWT_SECRET` already does. **Never reuse this key outside dev.** |
| `frontend/nginx.conf` | Both `/api` proxy blocks now overwrite `X-Real-IP` and `X-Forwarded-For` with `$remote_addr`. | Once the backend trusts this proxy's `X-Forwarded-For`, nginx must not pass on an address the client made up. Overwriting instead of appending blocks that. |
| `AGENTS.md` | Updates the JWT description (24h; new `sid` and `amr` claims). Adds the logout and vault endpoints, the vault tables, the new env vars, and a new **§18 Password vault** section (gates, grants, sessions, Microsoft unlock and Conditional Access setup, TOTP, encryption, key rotation, audit, tests). | The project docs are what developers and AI agents read first. They have to describe the new security model correctly. |

### Frontend

| File | What changed | Why |
|---|---|---|
| `frontend/src/App.tsx` | Adds the `vault` view and its header text. Non-admins get a check of `vaultApi.status()` to see whether anything was shared with them. Renders `<PasswordVault>`. Redirects away from `/vault` anyone who has no access. | The tab should only appear for admins and for people who were granted access. The server enforces access on every request anyway. |
| `frontend/src/components/FolderTabs.tsx` | Adds a **Vault** tab (KeyRound icon) and a `showVault` prop. | It shows the tab to admins, and to non-admins only when something was shared with them. Hiding the tab only affects the UI, not security. |
| `frontend/src/hooks/useAuth.ts` | `logout` now calls `POST /api/auth/logout` (best effort, 3s timeout) before clearing the token locally. | This locks the vault on the server at sign-out. If the network call fails, the user is still signed out locally. |
| `frontend/src/hooks/useRoute.ts` | Adds `'vault'` to the list of views. | This makes `/vault` a valid URL. It's also where the Microsoft unlock flow lands the browser. |
| `frontend/src/styles/globals.css` | Adds a `--tab-vault` colour (amber) for the light and dark themes. | The Vault tab gets its own colour, like the other tabs. |

---

## 2. New files (34)

### Backend: vault business logic (`backend/vault/`, no HTTP code)

| File | Purpose / why it exists |
|---|---|
| `service.go` | The `Service` type, its error types and the `Actor` (who is calling). This keeps the business rules separate from HTTP, so they can be tested directly. |
| `store.go` | Create, read, update, delete and search for clients, apps and accounts, plus reveal. Deleting doesn't cascade: you can't delete a client that still has apps, or an app that still has accounts. Every write re-encrypts both fields with the active key. The objects it returns never contain ciphertext. |
| `access.go` | The grant rules: admins can do everything. A grant covers a whole client or one app, at view or edit level, and can have an end date. Anything outside a user's grants answers **404**, so its existence isn't revealed. Revoking a grant takes effect on the next request. |
| `mfa.go` | Authenticator app (TOTP): enrollment, confirmation, 10 bcrypt-hashed recovery codes, unlock, lockout after 5 failures in 15 minutes (stored in the database, so a restart doesn't reset it), blocking reuse of a code, and admin MFA reset. |
| `unlock.go` | The unlock is stored on the server, keyed by `(user_id, sid)`. It lasts until the earlier of 24h and the JWT's expiry. The browser gets no extra token, so a stolen JWT alone still can't read secrets. |
| `entra.go` | "Unlock with Microsoft" step-up: a single-use state and nonce that expire after 10 minutes, `prompt=login&max_age=0`, and the server-side code exchange. The ID token must pass these checks: tenant, audience, nonce, a fresh `auth_time`, `amr` contains `mfa`, an optional Conditional Access context (`acrs`), and an email that matches the portal user. |
| `audit.go` | The append-only audit log. Each event is written in the same transaction as the change it records. A reveal returns plaintext only after its audit row has been committed. Audit details never contain secrets. |
| `rotate.go` | Re-encrypts all rows with the active key version, one row lock at a time, so it can run while the portal is live and can be re-run safely. |
| `crypto/keyring.go` | Parses `VAULT_KEYS` (`"<version>:<base64 32 bytes>,..."`) and tracks which key version is active. It's deliberately separate from the existing `utils/crypto.go`, which uses the shared `ENCRYPTION_KEY` and an older unauthenticated mode. |
| `crypto/cipher.go` | AES-256-GCM with a fresh 12-byte nonce for each field on each write. The AAD (`vault:v1\|credential\|<id>\|<field>`) means a ciphertext copied to another row or field won't decrypt. All failures return the same error, so callers can't learn why decryption failed. |
| `crypto/secret.go` | A `Secret` type that prints as `[REDACTED]` in logs and JSON, so plaintext can't leak by accident. |
| `crypto/crypto_test.go` | Unit tests for the cipher and key ring. These don't need a database. |
| `vault_test.go`, `access_test.go`, `entra_test.go`, `testutil_test.go` | Integration tests against a real Postgres (they need `VAULT_TEST_DSN`; each test creates and drops its own schema). They cover MFA, the grants matrix, Microsoft step-up validation, the audit trigger and rotation. |

### Backend: HTTP layer, schema and tooling

| File | Purpose / why it exists |
|---|---|
| `backend/controllers/token.go` | `issueToken`: the single place where the session JWT is built (`user_id`, `username`, `role`, `sid`, `amr`, `exp`, 24h). It adds the random `sid` that the server-side vault unlock is keyed on. |
| `backend/controllers/vault.go` | Thin HTTP handlers: parse the input, call the service, map errors to status codes. Reveals are POST with `Cache-Control: no-store`. These handlers never log request bodies or revealed values. |
| `backend/controllers/vault_access.go` | Handlers for grants (admin only), "Unlock with Microsoft" and the step-up callback, and `Logout`. |
| `backend/middleware/vault.go` | `VaultConfigured` answers 503 when there are no keys. `VaultMember` re-reads the user's role, active status and grants **from the database** on every request, because the existing `Admin()` middleware trusts the role in the token. `RequireVaultUnlock` checks the unlock. `VaultAdminOnly` guards admin routes. |
| `backend/middleware/ratelimit.go` | An in-memory per-IP rate limiter (10 requests per minute) on the MFA endpoints. It's a second layer on top of the per-user lockout in the database. |
| `backend/router/vault.go` | Mounts `/api/vault/*` with the middleware in order: JWT → configured → member → unlock → admin. |
| `backend/router/vault_test.go`, `vault_access_test.go` | End-to-end HTTP tests: the middleware chain, status codes and headers the frontend relies on, and the Microsoft redirect flow with Microsoft's token endpoint stubbed out. |
| `backend/migrations/005_password_vault.go` | Creates the `vault_*` tables in explicit SQL (`projects`, `apps`, `credentials`, `mfa`, `recovery_codes`, `unlocks`, `grants`, `stepups`, `audit_events`). It's not AutoMigrate because the tables need partial and functional unique indexes, CHECK constraints, and a trigger that rejects UPDATE, DELETE and TRUNCATE on the audit table. |
| `backend/models/vault.go` | GORM structs for those tables. They're never returned to clients directly. |
| `backend/cmd/vaultctl/main.go` | Operator command-line tool: `genkey`, `key-usage`, `rotate`, `reset-mfa <username>` (break-glass for a lost authenticator). |

### Frontend

| File | Purpose / why it exists |
|---|---|
| `frontend/src/components/vault/PasswordVault.tsx` | The main vault page: a client list on the left, then apps and accounts. It also has search, reveal and copy, an activity log (admins), and People & MFA (admins). A revealed password masks itself again after 20s. |
| `frontend/src/components/vault/VaultMfaGate.tsx` | Replaces the vault content while the vault is locked. Nothing behind it has been fetched yet, so there's nothing to peek at. It handles enrollment (QR code), unlock (TOTP, recovery code or Microsoft), and the one-time screen that shows the recovery codes. |
| `frontend/src/components/vault/VaultDialogs.tsx` | Create and edit dialogs for clients, apps and accounts. Includes a local strong-password generator (Web Crypto, without modulo bias). |
| `frontend/src/components/vault/VaultAccessDialog.tsx` | Admin dialog for granting and revoking access per client or app, at view or edit level, with an optional end date. |
| `frontend/src/lib/vaultApi.ts` | Typed API client. It recognises `VAULT_LOCKED`, so every open view can drop revealed values and show the MFA gate at once. |
| `frontend/src/lib/clipboard.ts` | Copies a secret, then wipes the clipboard after 30s, but only if the clipboard still holds that value. |
| `frontend/src/types/vault.ts` | TypeScript types that mirror the backend's response objects. |

---

## 3. Things to know before deploying

1. **Prod key:** generate one with `vaultctl genkey` and set `VAULT_KEYS="1:<key>"`. **Back the key up separately from the database backups.** If the key is lost, every stored secret is lost with it.
2. **Microsoft unlock:** `MICROSOFT_TENANT_ID` must be the tenant **GUID**, not `common` or `organizations`. For a fresh Authenticator approval on every unlock, follow the Conditional Access steps in AGENTS.md §18. Set `VAULT_SSO_AUTH_CONTEXT=c1` only after that policy is switched **On**.
3. **Existing sessions:** tokens minted before this change have no `sid`. For those, the vault answers `SESSION_UPGRADE_REQUIRED`, and signing in again fixes it.
4. **Rate limiter:** it's in memory, so it only works per backend instance. If the backend is ever scaled out, move it to Redis.
5. **Dev key:** the key in `docker-compose.dev.yml` is committed on purpose and is for local dev only.
