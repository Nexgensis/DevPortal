// Package vault is the admin password vault's business logic: MFA enrollment
// and unlock, project/credential storage with field-level AES-256-GCM, secret
// reveal, key rotation, and the append-only audit trail.
//
// It knows nothing about HTTP. Controllers translate requests into an Actor
// plus inputs, and map the errors below onto status codes.
package vault

import (
	"errors"
	"fmt"
	"time"

	vcrypto "backend/vault/crypto"

	"gorm.io/gorm"
)

// Policy knobs. Constants rather than env vars on purpose: these are security
// properties the business asked for, not deployment tuning.
const (
	UnlockTTL           = 24 * time.Hour
	MaxFailedAttempts   = 5
	FailureWindow       = 15 * time.Minute
	LockoutDuration     = 15 * time.Minute
	RecoveryCodeCount   = 10
	TOTPIssuer          = "Nexus Aura Vault"
	TOTPPeriodSeconds   = 30
	TOTPSkewSteps       = 1
	PendingEnrollmentTT = 15 * time.Minute
)

// Actor is the authenticated person performing an operation, as established
// by the JWT + VaultMember middleware (role and grants read from the DB).
type Actor struct {
	UserID      string
	Username    string
	IsAdmin     bool   // role "admin" per the database, not the token
	AuthMethod  string // how this login session signed in: "pwd" or "sso"
	SessionID   string    // JWT "sid" claim; "" for pre-vault tokens
	TokenExpiry time.Time // JWT "exp"; an unlock never outlives the session
	IP          string
	UserAgent   string
}

// Service is safe for concurrent use.
type Service struct {
	db     *gorm.DB
	cipher *vcrypto.Cipher
	now    func() time.Time
	entra  EntraConfig
}

func NewService(db *gorm.DB, keys vcrypto.KeyProvider) *Service {
	return &Service{db: db, cipher: vcrypto.NewCipher(keys), now: time.Now}
}

// WithClock is for tests.
func (s *Service) WithClock(now func() time.Time) *Service {
	cp := *s
	cp.now = now
	return &cp
}

// ---- errors -----------------------------------------------------------------

var (
	ErrNotFound               = errors.New("not found")
	ErrMFANotEnrolled         = errors.New("MFA is not set up for this account")
	ErrMFAAlreadyEnrolled     = errors.New("MFA is already set up for this account")
	ErrNoPendingEnrollment    = errors.New("no MFA enrollment in progress; start again")
	ErrInvalidCode            = errors.New("invalid verification code")
	ErrSessionUpgradeRequired = errors.New("please sign out and sign in again to use the vault")
	ErrVaultLocked            = errors.New("vault is locked")
	ErrCannotResetSelf        = errors.New("use a recovery code to recover your own MFA")
)

// ValidationError is a 400 with a user-safe message (never echoes secrets).
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, a ...any) error { return &ValidationError{Msg: fmt.Sprintf(format, a...)} }

// ConflictError is a 409.
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

// LockedOutError means too many failed MFA attempts.
type LockedOutError struct{ Until time.Time }

func (e *LockedOutError) Error() string {
	return "too many failed attempts; try again after " + e.Until.UTC().Format(time.RFC3339)
}
