package models

import (
	"encoding/json"
	"time"
)

// Password vault models. The tables are created by migration 005 (explicit
// SQL with constraints and the append-only audit trigger), not AutoMigrate —
// do not add these to db.AutoMigrate in main.go.
//
// None of these structs are returned to clients directly: the vault service
// maps them to DTOs so ciphertext columns can never leak into a response.

type VaultProject struct {
	ID          string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	Name        string    `gorm:"not null"`
	Description string    `gorm:"not null;default:''"`
	CreatedBy   string    `gorm:"type:uuid;not null"`
	UpdatedBy   string    `gorm:"type:uuid;not null"`
	CreatedAt   time.Time `gorm:"not null"`
	UpdatedAt   time.Time `gorm:"not null"`
}

func (VaultProject) TableName() string { return "vault_projects" }

// VaultApp is one application/service inside a project (client), e.g.
// "AWS Console". It holds the login URL; its accounts are VaultCredentials.
type VaultApp struct {
	ID          string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	ProjectID   string    `gorm:"type:uuid;not null"`
	Name        string    `gorm:"not null"`
	LoginURL    string    `gorm:"column:login_url;not null;default:''"`
	Description string    `gorm:"not null;default:''"`
	CreatedBy   string    `gorm:"type:uuid;not null"`
	UpdatedBy   string    `gorm:"type:uuid;not null"`
	CreatedAt   time.Time `gorm:"not null"`
	UpdatedAt   time.Time `gorm:"not null"`
}

func (VaultApp) TableName() string { return "vault_apps" }

// VaultCredential is one account on an app (an app can have many: root,
// read-only, per-person logins...).
type VaultCredential struct {
	ID            string `gorm:"type:uuid;primaryKey"`
	AppID         string `gorm:"type:uuid;not null"`
	Label         string `gorm:"not null;default:''"`
	Username      string `gorm:"not null;default:''"`
	PasswordCT    []byte `gorm:"column:password_ct;not null"`
	PasswordNonce []byte `gorm:"column:password_nonce;not null"`
	NotesCT       []byte `gorm:"column:notes_ct"`
	NotesNonce    []byte `gorm:"column:notes_nonce"`
	KeyVersion    int    `gorm:"not null"`
	CreatedBy     string `gorm:"type:uuid;not null"`
	UpdatedBy     string `gorm:"type:uuid;not null"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (VaultCredential) TableName() string { return "vault_credentials" }

const (
	VaultMFAPending = "pending"
	VaultMFAActive  = "active"
)

type VaultMFA struct {
	UserID         string `gorm:"type:uuid;primaryKey"`
	SecretCT       []byte `gorm:"column:secret_ct;not null"`
	SecretNonce    []byte `gorm:"column:secret_nonce;not null"`
	KeyVersion     int    `gorm:"not null"`
	Status         string `gorm:"not null"`
	LastUsedStep   int64  `gorm:"not null;default:0"`
	FailedAttempts int    `gorm:"not null;default:0"`
	FirstFailedAt  *time.Time
	LockedUntil    *time.Time
	EnrolledAt     *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (VaultMFA) TableName() string { return "vault_mfa" }

type VaultRecoveryCode struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID    string `gorm:"type:uuid;not null"`
	CodeHash  string `gorm:"not null"`
	UsedAt    *time.Time
	CreatedAt time.Time
}

func (VaultRecoveryCode) TableName() string { return "vault_recovery_codes" }

type VaultUnlock struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID    string    `gorm:"type:uuid;not null"`
	SessionID string    `gorm:"not null"`
	ExpiresAt time.Time `gorm:"not null"`
	RevokedAt *time.Time
	IP        string `gorm:"column:ip;not null;default:''"`
	CreatedAt time.Time
}

func (VaultUnlock) TableName() string { return "vault_unlocks" }

type VaultAuditEvent struct {
	ID            int64           `gorm:"primaryKey;autoIncrement" json:"id"`
	OccurredAt    time.Time       `gorm:"not null;default:now()" json:"occurredAt"`
	ActorUserID   *string         `gorm:"type:uuid" json:"actorUserId"`
	ActorUsername string          `gorm:"not null" json:"actorUsername"`
	Action        string          `gorm:"not null" json:"action"`
	ProjectID     *string         `gorm:"type:uuid" json:"projectId"`
	AppID         *string         `gorm:"type:uuid" json:"appId"`
	CredentialID  *string         `gorm:"type:uuid" json:"credentialId"`
	TargetUserID  *string         `gorm:"type:uuid" json:"targetUserId"`
	IP            string          `gorm:"column:ip;not null;default:''" json:"ip"`
	UserAgent     string          `gorm:"not null;default:''" json:"userAgent"`
	SessionID     string          `gorm:"not null;default:''" json:"-"`
	Details       json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"details"`
}

func (VaultAuditEvent) TableName() string { return "vault_audit_events" }

// VaultGrant gives a non-admin access to a whole client (AppID nil) or to
// one app in it. Level is "view" or "edit". ExpiresAt nil = until revoked.
type VaultGrant struct {
	ID        string  `gorm:"type:uuid;primaryKey"`
	UserID    string  `gorm:"type:uuid;not null"`
	ProjectID string  `gorm:"type:uuid;not null"`
	AppID     *string `gorm:"type:uuid"`
	Level     string  `gorm:"not null"`
	ExpiresAt *time.Time
	CreatedBy string    `gorm:"type:uuid;not null"` // last admin to set it
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (VaultGrant) TableName() string { return "vault_grants" }

// VaultStepUp is one in-flight "unlock with Microsoft" attempt. The browser
// leaves for Microsoft and comes back without our JWT, so this row is what
// ties the callback to the portal login session that started it. Only a
// hash of the state is stored; each row can be used once.
type VaultStepUp struct {
	StateHash   []byte `gorm:"primaryKey"`
	UserID      string `gorm:"type:uuid;not null"`
	SessionID   string `gorm:"not null"`
	TokenExpiry *time.Time
	Nonce       string    `gorm:"not null"`
	IP          string    `gorm:"not null;default:''"`
	UserAgent   string    `gorm:"not null;default:''"`
	CreatedAt   time.Time `gorm:"not null"`
	ExpiresAt   time.Time `gorm:"not null"`
	UsedAt      *time.Time
}

func (VaultStepUp) TableName() string { return "vault_stepups" }
