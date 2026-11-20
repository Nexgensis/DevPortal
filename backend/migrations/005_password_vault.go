package migrations

import (
	"gorm.io/gorm"
)

// CreatePasswordVault creates the admin password vault tables.
//
// Written as explicit SQL rather than AutoMigrate because the important parts
// are things GORM tags can't express: partial/functional unique indexes, CHECK
// constraints, and the trigger that makes vault_audit_events append-only.
// Every statement is idempotent so it is safe on every boot, like 002-004.
//
// Hierarchy: vault_projects (a client) → vault_apps (an application/service,
// holds the login URL) → vault_credentials (any number of accounts per app).
//
// Table names are prefixed vault_ because `projects` already exists (it groups
// apps). Secrets are stored as bytea: ciphertext||GCM tag plus a per-field
// 12-byte nonce. Password and notes each have their own nonce — sharing one
// nonce across two fields under the same key would be GCM nonce reuse.
func CreatePasswordVault(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS vault_projects (
				id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
				description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
				created_by  uuid NOT NULL REFERENCES users(id),
				updated_by  uuid NOT NULL REFERENCES users(id),
				created_at  timestamptz NOT NULL DEFAULT now(),
				updated_at  timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS vault_projects_name_uq ON vault_projects (lower(name))`,

			`CREATE TABLE IF NOT EXISTS vault_apps (
				id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				project_id  uuid NOT NULL REFERENCES vault_projects(id) ON DELETE RESTRICT,
				name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
				login_url   text NOT NULL DEFAULT '' CHECK (length(login_url) <= 2048),
				description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
				created_by  uuid NOT NULL REFERENCES users(id),
				updated_by  uuid NOT NULL REFERENCES users(id),
				created_at  timestamptz NOT NULL DEFAULT now(),
				updated_at  timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS vault_apps_project_name_uq ON vault_apps (project_id, lower(name))`,

			`CREATE TABLE IF NOT EXISTS vault_credentials (
				id             uuid PRIMARY KEY,
				app_id         uuid NOT NULL REFERENCES vault_apps(id) ON DELETE RESTRICT,
				label          text NOT NULL DEFAULT '' CHECK (length(label) <= 120),
				username       text NOT NULL DEFAULT '' CHECK (length(username) <= 512),
				password_ct    bytea NOT NULL,
				password_nonce bytea NOT NULL CHECK (length(password_nonce) = 12),
				notes_ct       bytea,
				notes_nonce    bytea CHECK (notes_nonce IS NULL OR length(notes_nonce) = 12),
				key_version    smallint NOT NULL CHECK (key_version > 0),
				created_by     uuid NOT NULL REFERENCES users(id),
				updated_by     uuid NOT NULL REFERENCES users(id),
				created_at     timestamptz NOT NULL DEFAULT now(),
				updated_at     timestamptz NOT NULL DEFAULT now(),
				CHECK ((notes_ct IS NULL) = (notes_nonce IS NULL))
			)`,
			`CREATE INDEX IF NOT EXISTS vault_credentials_app_idx ON vault_credentials (app_id)`,
			`CREATE INDEX IF NOT EXISTS vault_credentials_key_version_idx ON vault_credentials (key_version)`,

			`CREATE TABLE IF NOT EXISTS vault_mfa (
				user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				secret_ct        bytea NOT NULL,
				secret_nonce     bytea NOT NULL CHECK (length(secret_nonce) = 12),
				key_version      smallint NOT NULL CHECK (key_version > 0),
				status           text NOT NULL CHECK (status IN ('pending', 'active')),
				last_used_step   bigint NOT NULL DEFAULT 0,
				failed_attempts  int NOT NULL DEFAULT 0,
				first_failed_at  timestamptz,
				locked_until     timestamptz,
				enrolled_at      timestamptz,
				created_at       timestamptz NOT NULL DEFAULT now(),
				updated_at       timestamptz NOT NULL DEFAULT now()
			)`,

			`CREATE TABLE IF NOT EXISTS vault_recovery_codes (
				id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				code_hash  text NOT NULL,
				used_at    timestamptz,
				created_at timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS vault_recovery_codes_user_idx ON vault_recovery_codes (user_id) WHERE used_at IS NULL`,

			`CREATE TABLE IF NOT EXISTS vault_unlocks (
				id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				session_id text NOT NULL,
				expires_at timestamptz NOT NULL,
				revoked_at timestamptz,
				ip         text NOT NULL DEFAULT '',
				created_at timestamptz NOT NULL DEFAULT now(),
				UNIQUE (user_id, session_id)
			)`,

			// Non-admin access: a grant on a whole client (app_id NULL) or one
			// app. One row per (person, scope); expires_at NULL = until revoked.
			`CREATE TABLE IF NOT EXISTS vault_grants (
				id         uuid PRIMARY KEY,
				user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				project_id uuid NOT NULL REFERENCES vault_projects(id) ON DELETE CASCADE,
				app_id     uuid REFERENCES vault_apps(id) ON DELETE CASCADE,
				level      text NOT NULL CHECK (level IN ('view', 'edit')),
				expires_at timestamptz,
				created_by uuid NOT NULL REFERENCES users(id),
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS vault_grants_scope_uq
				ON vault_grants (user_id, project_id, COALESCE(app_id, '00000000-0000-0000-0000-000000000000'::uuid))`,
			`CREATE INDEX IF NOT EXISTS vault_grants_project_idx ON vault_grants (project_id)`,

			// In-flight "unlock with Microsoft" attempts (10 min, single use).
			`CREATE TABLE IF NOT EXISTS vault_stepups (
				state_hash   bytea PRIMARY KEY,
				user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				session_id   text NOT NULL,
				token_expiry timestamptz,
				nonce        text NOT NULL,
				ip           text NOT NULL DEFAULT '',
				user_agent   text NOT NULL DEFAULT '',
				created_at   timestamptz NOT NULL,
				expires_at   timestamptz NOT NULL,
				used_at      timestamptz
			)`,

			// Audit: no FKs on purpose. Events must outlive the credential,
			// project, or even user they describe.
			`CREATE TABLE IF NOT EXISTS vault_audit_events (
				id             bigserial PRIMARY KEY,
				occurred_at    timestamptz NOT NULL DEFAULT now(),
				actor_user_id  uuid,
				actor_username text NOT NULL,
				action         text NOT NULL,
				project_id     uuid,
				app_id         uuid,
				credential_id  uuid,
				target_user_id uuid,
				ip             text NOT NULL DEFAULT '',
				user_agent     text NOT NULL DEFAULT '',
				session_id     text NOT NULL DEFAULT '',
				details        jsonb NOT NULL DEFAULT '{}'::jsonb
			)`,
			`CREATE INDEX IF NOT EXISTS vault_audit_events_time_idx ON vault_audit_events (occurred_at DESC)`,
			`CREATE INDEX IF NOT EXISTS vault_audit_events_credential_idx ON vault_audit_events (credential_id, occurred_at DESC) WHERE credential_id IS NOT NULL`,
			`CREATE INDEX IF NOT EXISTS vault_audit_events_actor_idx ON vault_audit_events (actor_user_id, occurred_at DESC)`,

			// Append-only, enforced by the database so it holds for every code
			// path, psql sessions included (short of a superuser disabling the
			// trigger, which is itself visible in the DB logs).
			`CREATE OR REPLACE FUNCTION vault_audit_events_immutable() RETURNS trigger AS $$
			BEGIN
				RAISE EXCEPTION 'vault_audit_events is append-only (% blocked)', TG_OP;
			END;
			$$ LANGUAGE plpgsql`,
			`DROP TRIGGER IF EXISTS vault_audit_events_no_update ON vault_audit_events`,
			`CREATE TRIGGER vault_audit_events_no_update
				BEFORE UPDATE OR DELETE ON vault_audit_events
				FOR EACH ROW EXECUTE FUNCTION vault_audit_events_immutable()`,
			`DROP TRIGGER IF EXISTS vault_audit_events_no_truncate ON vault_audit_events`,
			`CREATE TRIGGER vault_audit_events_no_truncate
				BEFORE TRUNCATE ON vault_audit_events
				FOR EACH STATEMENT EXECUTE FUNCTION vault_audit_events_immutable()`,
		}
		for _, s := range stmts {
			if err := tx.Exec(s).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
