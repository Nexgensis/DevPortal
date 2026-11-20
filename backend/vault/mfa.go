package vault

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"image/png"
	"strings"
	"time"

	"backend/models"
	vcrypto "backend/vault/crypto"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var totpOpts = totp.ValidateOpts{
	Period:    TOTPPeriodSeconds,
	Digits:    otp.DigitsSix,
	Algorithm: otp.AlgorithmSHA1, // what every authenticator app supports
}

func mfaAAD(userID string) []byte { return vcrypto.AAD("mfa", userID, "totp_secret") }

// ---- status -----------------------------------------------------------------

type StatusDTO struct {
	Enrolled               bool       `json:"enrolled"`
	PendingEnrollment      bool       `json:"pendingEnrollment"`
	Unlocked               bool       `json:"unlocked"`
	UnlockExpiresAt        *time.Time `json:"unlockExpiresAt"`
	LockedOutUntil         *time.Time `json:"lockedOutUntil"`
	RecoveryCodesRemaining int        `json:"recoveryCodesRemaining"`
	SessionUpgradeRequired bool       `json:"sessionUpgradeRequired"`
	// Role is "admin" (everything) or "member" (only what was shared).
	Role string `json:"role"`
	// LoginMethod is how this session signed in to the portal: "pwd" | "sso".
	LoginMethod string `json:"loginMethod"`
	// Methods lists the ways this session may unlock. SSO sessions unlock
	// with Microsoft and never need the authenticator app; password (local,
	// break-glass) sessions use the app code.
	Methods UnlockMethods `json:"methods"`
}

type UnlockMethods struct {
	Microsoft bool `json:"microsoft"`
	TOTP      bool `json:"totp"`
}

func (s *Service) Status(a Actor) (StatusDTO, error) {
	out := StatusDTO{SessionUpgradeRequired: a.SessionID == "", Role: "member", LoginMethod: a.AuthMethod}
	if a.IsAdmin {
		out.Role = "admin"
	}
	var m models.VaultMFA
	err := s.db.Where("user_id = ?", a.UserID).Take(&m).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
	case err != nil:
		return out, err
	default:
		out.Enrolled = m.Status == models.VaultMFAActive
		out.PendingEnrollment = m.Status == models.VaultMFAPending
		if m.LockedUntil != nil && m.LockedUntil.After(s.now()) {
			out.LockedOutUntil = m.LockedUntil
		}
	}
	if out.Enrolled {
		var n int64
		if err := s.db.Model(&models.VaultRecoveryCode{}).
			Where("user_id = ? AND used_at IS NULL", a.UserID).Count(&n).Error; err != nil {
			return out, err
		}
		out.RecoveryCodesRemaining = int(n)
	}
	out.Methods.Microsoft = s.entra.Enabled()
	out.Methods.TOTP = !s.ssoOnly(a) || out.Enrolled || out.PendingEnrollment
	if exp, ok, err := s.UnlockExpiry(a.UserID, a.SessionID); err != nil {
		return out, err
	} else if ok {
		out.Unlocked = true
		out.UnlockExpiresAt = &exp
	}
	return out, nil
}

// ---- enrollment -------------------------------------------------------------

// EnrollmentDTO is shown once, during setup. The secret is returned only so
// the admin can type it into an authenticator that can't scan QR codes.
type EnrollmentDTO struct {
	Secret     string    `json:"secret"`
	OtpauthURL string    `json:"otpauthUrl"`
	QRCodePNG  string    `json:"qrCodePng"` // data: URL
	ExpiresAt  time.Time `json:"expiresAt"`
}

// StartEnrollment generates a new TOTP secret, stores it encrypted as
// "pending", and returns what the authenticator app needs. Refused once MFA
// is active: replacing an active factor goes through ResetMFA (another admin)
// or a recovery code, never a silent re-enroll from a possibly stolen session.
func (s *Service) StartEnrollment(a Actor) (EnrollmentDTO, error) {
	if a.SessionID == "" {
		return EnrollmentDTO{}, ErrSessionUpgradeRequired
	}
	if s.ssoOnly(a) {
		return EnrollmentDTO{}, ErrUseMicrosoft
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      TOTPIssuer,
		AccountName: a.Username,
		Period:      TOTPPeriodSeconds,
		SecretSize:  20, // 160 bits, RFC 4226 recommendation
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return EnrollmentDTO{}, err
	}
	img, err := key.Image(240, 240)
	if err != nil {
		return EnrollmentDTO{}, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return EnrollmentDTO{}, err
	}
	sealed, err := s.cipher.Seal([]byte(key.Secret()), mfaAAD(a.UserID))
	if err != nil {
		return EnrollmentDTO{}, err
	}

	now := s.now()
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var existing models.VaultMFA
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", a.UserID).Take(&existing).Error
		if err == nil && existing.Status == models.VaultMFAActive {
			return ErrMFAAlreadyEnrolled
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		row := models.VaultMFA{
			UserID: a.UserID, SecretCT: sealed.Ciphertext, SecretNonce: sealed.Nonce,
			KeyVersion: sealed.KeyVersion, Status: models.VaultMFAPending,
			CreatedAt: now, UpdatedAt: now,
		}
		// Keep any lockout state from a previous pending attempt: restarting
		// enrollment must not be a way to reset the failure counter.
		if err == nil {
			row.FailedAttempts, row.FirstFailedAt, row.LockedUntil = existing.FailedAttempts, existing.FirstFailedAt, existing.LockedUntil
			row.CreatedAt = existing.CreatedAt
		}
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionMFAEnrollStarted})
	})
	if err != nil {
		return EnrollmentDTO{}, err
	}
	return EnrollmentDTO{
		Secret:     key.Secret(),
		OtpauthURL: key.URL(),
		QRCodePNG:  "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
		ExpiresAt:  now.Add(PendingEnrollmentTT),
	}, nil
}

// ConfirmResult is returned once: the recovery codes are never retrievable again.
type ConfirmResult struct {
	RecoveryCodes   []string  `json:"recoveryCodes"`
	UnlockExpiresAt time.Time `json:"unlockExpiresAt"`
}

// ConfirmEnrollment activates a pending secret once the admin proves their
// authenticator produces valid codes, issues recovery codes, and unlocks the
// vault for this session (a valid code is an MFA verification).
func (s *Service) ConfirmEnrollment(a Actor, code string) (ConfirmResult, error) {
	if a.SessionID == "" {
		return ConfirmResult{}, ErrSessionUpgradeRequired
	}
	code, err := normalizeTOTP(code)
	if err != nil {
		return ConfirmResult{}, err
	}
	var res ConfirmResult
	var outcome error
	err = s.db.Transaction(func(tx *gorm.DB) error {
		m, err := s.lockMFARow(tx, a.UserID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			outcome = ErrNoPendingEnrollment
			return nil
		}
		if err != nil {
			return err
		}
		if m.Status == models.VaultMFAActive {
			outcome = ErrMFAAlreadyEnrolled
			return nil
		}
		if s.now().Sub(m.UpdatedAt) > PendingEnrollmentTT {
			outcome = ErrNoPendingEnrollment
			return nil
		}
		if err := s.checkLockout(m); err != nil {
			outcome = err
			return nil
		}
		step, ok, err := s.matchTOTP(m, code)
		if err != nil {
			return err
		}
		if !ok {
			outcome, err = s.recordFailure(tx, a, m, "totp_enroll")
			return err
		}

		now := s.now()
		if err := tx.Model(&models.VaultMFA{}).Where("user_id = ?", a.UserID).UpdateColumns(map[string]any{
			"status": models.VaultMFAActive, "last_used_step": step, "enrolled_at": now,
			"failed_attempts": 0, "first_failed_at": nil, "locked_until": nil, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		codes, err := s.replaceRecoveryCodes(tx, a.UserID)
		if err != nil {
			return err
		}
		exp, err := s.createUnlock(tx, a)
		if err != nil {
			return err
		}
		if err := s.audit(tx, a, auditEntry{action: ActionMFAEnrolled}); err != nil {
			return err
		}
		if err := s.audit(tx, a, auditEntry{action: ActionMFAVerified, details: map[string]any{"method": "totp", "expiresAt": exp}}); err != nil {
			return err
		}
		res = ConfirmResult{RecoveryCodes: codes, UnlockExpiresAt: exp}
		return nil
	})
	if err != nil {
		return ConfirmResult{}, err
	}
	return res, outcome
}

// ---- unlock -----------------------------------------------------------------

type UnlockResult struct {
	UnlockExpiresAt        time.Time `json:"unlockExpiresAt"`
	RecoveryCodesRemaining *int      `json:"recoveryCodesRemaining,omitempty"`
}

// Unlock verifies a TOTP code (or, if code is empty, a recovery code) and
// opens the vault for this login session until min(24h, session expiry).
//
// The MFA row is locked FOR UPDATE for the whole check, so concurrent guesses
// are serialized: the failure counter can't be raced, and one TOTP step can
// only ever be accepted once (replay protection via last_used_step).
func (s *Service) Unlock(a Actor, code, recoveryCode string) (UnlockResult, error) {
	if a.SessionID == "" {
		return UnlockResult{}, ErrSessionUpgradeRequired
	}
	useRecovery := strings.TrimSpace(code) == ""
	var normalized string
	var err error
	if useRecovery {
		normalized = normalizeRecovery(recoveryCode)
		if len(normalized) != recoveryCodeLen {
			return UnlockResult{}, invalid("enter the 6-digit code from your authenticator app or a recovery code")
		}
	} else if normalized, err = normalizeTOTP(code); err != nil {
		return UnlockResult{}, err
	}

	var res UnlockResult
	var outcome error
	err = s.db.Transaction(func(tx *gorm.DB) error {
		m, err := s.lockMFARow(tx, a.UserID)
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && m.Status != models.VaultMFAActive) {
			outcome = ErrMFANotEnrolled
			return nil
		}
		if err != nil {
			return err
		}
		if err := s.checkLockout(m); err != nil {
			outcome = err
			return nil
		}

		method := "totp"
		var ok bool
		var remaining int
		if useRecovery {
			method = "recovery_code"
			ok, remaining, err = s.consumeRecoveryCode(tx, a.UserID, normalized)
		} else {
			var step int64
			step, ok, err = s.matchTOTP(m, normalized)
			if err == nil && ok {
				err = tx.Model(&models.VaultMFA{}).Where("user_id = ?", a.UserID).UpdateColumn("last_used_step", step).Error
			}
		}
		if err != nil {
			return err
		}
		if !ok {
			outcome, err = s.recordFailure(tx, a, m, method)
			return err
		}

		if err := tx.Model(&models.VaultMFA{}).Where("user_id = ?", a.UserID).UpdateColumns(map[string]any{
			"failed_attempts": 0, "first_failed_at": nil, "locked_until": nil, "updated_at": s.now(),
		}).Error; err != nil {
			return err
		}
		exp, err := s.createUnlock(tx, a)
		if err != nil {
			return err
		}
		if useRecovery {
			if err := s.audit(tx, a, auditEntry{action: ActionRecoveryCodeUsed, details: map[string]any{"remaining": remaining}}); err != nil {
				return err
			}
			res.RecoveryCodesRemaining = &remaining
		}
		if err := s.audit(tx, a, auditEntry{action: ActionMFAVerified, details: map[string]any{"method": method, "expiresAt": exp}}); err != nil {
			return err
		}
		res.UnlockExpiresAt = exp
		return nil
	})
	if err != nil {
		return UnlockResult{}, err
	}
	return res, outcome
}

// ---- helpers ----------------------------------------------------------------

func (s *Service) lockMFARow(tx *gorm.DB, userID string) (models.VaultMFA, error) {
	var m models.VaultMFA
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).Take(&m).Error
	return m, err
}

func (s *Service) checkLockout(m models.VaultMFA) error {
	if m.LockedUntil != nil && m.LockedUntil.After(s.now()) {
		return &LockedOutError{Until: *m.LockedUntil}
	}
	return nil
}

// recordFailure counts a failed attempt inside the caller's transaction (so
// it commits even though the request fails) and returns the error to report.
func (s *Service) recordFailure(tx *gorm.DB, a Actor, m models.VaultMFA, method string) (error, error) {
	now := s.now()
	failed := m.FailedAttempts + 1
	first := now
	if m.FirstFailedAt != nil && now.Sub(*m.FirstFailedAt) <= FailureWindow {
		first = *m.FirstFailedAt
	} else {
		failed = 1
	}
	updates := map[string]any{"failed_attempts": failed, "first_failed_at": first, "updated_at": now}
	if m.Status == models.VaultMFAPending {
		// Don't let a failed confirm extend the pending enrollment's lifetime.
		delete(updates, "updated_at")
	}
	var outcome error = ErrInvalidCode
	if failed >= MaxFailedAttempts {
		until := now.Add(LockoutDuration)
		updates["failed_attempts"], updates["first_failed_at"], updates["locked_until"] = 0, nil, until
		outcome = &LockedOutError{Until: until}
	}
	if err := tx.Model(&models.VaultMFA{}).Where("user_id = ?", m.UserID).UpdateColumns(updates).Error; err != nil {
		return nil, err
	}
	remaining := MaxFailedAttempts - failed
	if remaining < 0 {
		remaining = 0
	}
	if err := s.audit(tx, a, auditEntry{action: ActionMFAFailed, details: map[string]any{"method": method, "attemptsRemaining": remaining}}); err != nil {
		return nil, err
	}
	if lo, ok := outcome.(*LockedOutError); ok {
		if err := s.audit(tx, a, auditEntry{action: ActionMFALockedOut, details: map[string]any{"until": lo.Until}}); err != nil {
			return nil, err
		}
	}
	return outcome, nil
}

// matchTOTP checks code against the current step ±TOTPSkewSteps and returns
// the matching step. A step at or before last_used_step is a replay and is
// rejected even if the digits are right.
func (s *Service) matchTOTP(m models.VaultMFA, code string) (int64, bool, error) {
	secret, err := s.cipher.Open(vcrypto.Sealed{Ciphertext: m.SecretCT, Nonce: m.SecretNonce, KeyVersion: m.KeyVersion}, mfaAAD(m.UserID))
	if err != nil {
		return 0, false, err
	}
	defer vcrypto.Zero(secret)
	current := s.now().Unix() / TOTPPeriodSeconds
	matched := int64(-1)
	// Check every candidate (no early exit) so timing doesn't reveal which
	// step matched.
	for d := -TOTPSkewSteps; d <= TOTPSkewSteps; d++ {
		step := current + int64(d)
		want, err := totp.GenerateCodeCustom(string(secret), time.Unix(step*TOTPPeriodSeconds, 0).UTC(), totpOpts)
		if err != nil {
			return 0, false, err
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 && step > matched {
			matched = step
		}
	}
	if matched < 0 || matched <= m.LastUsedStep {
		return 0, false, nil
	}
	return matched, true, nil
}

func normalizeTOTP(code string) (string, error) {
	c := strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(c) != 6 {
		return "", invalid("enter the 6-digit code from your authenticator app")
	}
	for _, r := range c {
		if r < '0' || r > '9' {
			return "", invalid("enter the 6-digit code from your authenticator app")
		}
	}
	return c, nil
}

// Recovery codes: 10 random base32 chars (50 bits), shown as xxxxx-xxxxx.
// bcrypt-hashed, single use. Each guess also counts toward the lockout.
const recoveryCodeLen = 10

var recoveryEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

func normalizeRecovery(code string) string {
	c := strings.ToLower(strings.TrimSpace(code))
	c = strings.NewReplacer("-", "", " ", "").Replace(c)
	return c
}

func newRecoveryCode() (string, error) {
	b := make([]byte, 7)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return recoveryEncoding.EncodeToString(b)[:recoveryCodeLen], nil
}

func (s *Service) replaceRecoveryCodes(tx *gorm.DB, userID string) ([]string, error) {
	if err := tx.Where("user_id = ?", userID).Delete(&models.VaultRecoveryCode{}).Error; err != nil {
		return nil, err
	}
	codes := make([]string, 0, RecoveryCodeCount)
	rows := make([]models.VaultRecoveryCode, 0, RecoveryCodeCount)
	for i := 0; i < RecoveryCodeCount; i++ {
		c, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		h, err := bcrypt.GenerateFromPassword([]byte(c), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		codes = append(codes, c[:5]+"-"+c[5:])
		rows = append(rows, models.VaultRecoveryCode{UserID: userID, CodeHash: string(h), CreatedAt: s.now()})
	}
	if err := tx.Create(&rows).Error; err != nil {
		return nil, err
	}
	return codes, nil
}

func (s *Service) consumeRecoveryCode(tx *gorm.DB, userID, code string) (bool, int, error) {
	var rows []models.VaultRecoveryCode
	if err := tx.Where("user_id = ? AND used_at IS NULL", userID).Find(&rows).Error; err != nil {
		return false, 0, err
	}
	for _, r := range rows {
		if bcrypt.CompareHashAndPassword([]byte(r.CodeHash), []byte(code)) == nil {
			if err := tx.Model(&models.VaultRecoveryCode{}).Where("id = ? AND used_at IS NULL", r.ID).
				UpdateColumn("used_at", s.now()).Error; err != nil {
				return false, 0, err
			}
			return true, len(rows) - 1, nil
		}
	}
	return false, len(rows), nil
}

// ssoOnly: a Microsoft-SSO session on a server where Microsoft unlock works
// never sets up the authenticator app — Microsoft already did MFA.
func (s *Service) ssoOnly(a Actor) bool { return a.AuthMethod == "sso" && s.entra.Enabled() }
