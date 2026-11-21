package vault

import (
	"errors"
	"time"

	"backend/models"

	"gorm.io/gorm"
)

// The unlock is server-side state keyed by (user, login session). The browser
// receives no extra token, so there is nothing new in localStorage for an XSS
// payload to steal: a stolen JWT alone still can't read secrets without a
// fresh TOTP code.

// createUnlock opens (or re-opens) the vault for the actor's session until
// min(now + UnlockTTL, JWT expiry).
func (s *Service) createUnlock(tx *gorm.DB, a Actor) (time.Time, error) {
	now := s.now()
	exp := now.Add(UnlockTTL)
	if !a.TokenExpiry.IsZero() && a.TokenExpiry.Before(exp) {
		exp = a.TokenExpiry
	}
	exp = exp.UTC().Truncate(time.Microsecond) // Postgres timestamptz precision
	err := tx.Exec(`
		INSERT INTO vault_unlocks (user_id, session_id, expires_at, ip, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, session_id)
		DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked_at = NULL,
		              ip = EXCLUDED.ip, created_at = EXCLUDED.created_at`,
		a.UserID, a.SessionID, exp, a.IP, now).Error
	return exp, err
}

// UnlockExpiry reports whether (userID, sessionID) currently has an open
// vault, and until when. This is the check behind every gated endpoint.
func (s *Service) UnlockExpiry(userID, sessionID string) (time.Time, bool, error) {
	if sessionID == "" {
		return time.Time{}, false, nil
	}
	var u models.VaultUnlock
	err := s.db.Where("user_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ?",
		userID, sessionID, s.now()).Take(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	return u.ExpiresAt, true, nil
}

// Lock closes the vault for the actor's current session ("Lock now").
func (s *Service) Lock(a Actor) error {
	return s.revoke(a, a.UserID, a.SessionID, "manual")
}

// RevokeSession closes the vault for a session at logout. Safe to call for
// non-admins and for sessions that never unlocked (it does nothing).
func (s *Service) RevokeSession(a Actor, reason string) error {
	return s.revoke(a, a.UserID, a.SessionID, reason)
}

func (s *Service) revoke(a Actor, userID, sessionID, reason string) error {
	if sessionID == "" || userID == "" {
		return nil
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.VaultUnlock{}).
			Where("user_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, sessionID, s.now()).
			UpdateColumn("revoked_at", s.now())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return nil
		}
		return s.audit(tx, a, auditEntry{action: ActionVaultLocked, details: map[string]any{"reason": reason}})
	})
}

// ---- admin MFA management ----------------------------------------------------

type AdminMFADTO struct {
	UserID     string     `json:"userId"`
	Username   string     `json:"username"`
	FullName   string     `json:"fullName"`
	IsActive   bool       `json:"isActive"`
	MFAStatus  string     `json:"mfaStatus"` // "none" | "pending" | "active"
	EnrolledAt *time.Time `json:"enrolledAt"`
	Role       string     `json:"role"` // "admin" | "member"
}

// ListMembers shows everyone who can open the vault (admins, plus anyone
// with an active grant) and their authenticator-app MFA state, for the
// "reset MFA" screen. Admin only.
func (s *Service) ListMembers(a Actor) ([]AdminMFADTO, error) {
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	var rows []struct {
		ID         string
		Username   string
		FullName   string
		IsActive   bool
		Role       string
		Status     *string
		EnrolledAt *time.Time
	}
	err := s.db.Table("users").
		Select("users.id, users.username, users.full_name, users.is_active, users.role, vault_mfa.status, vault_mfa.enrolled_at").
		Joins("LEFT JOIN vault_mfa ON vault_mfa.user_id = users.id").
		Where(`users.deleted_at IS NULL AND (users.role = 'admin' OR EXISTS (SELECT 1 FROM vault_grants g
			WHERE g.user_id = users.id AND (g.expires_at IS NULL OR g.expires_at > ?)))`, s.now()).
		Order("users.role, users.username").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]AdminMFADTO, len(rows))
	for i, r := range rows {
		st := "none"
		if r.Status != nil {
			st = *r.Status
		}
		role := "member"
		if r.Role == "admin" {
			role = "admin"
		}
		out[i] = AdminMFADTO{UserID: r.ID, Username: r.Username, FullName: r.FullName, IsActive: r.IsActive, MFAStatus: st, EnrolledAt: r.EnrolledAt, Role: role}
	}
	return out, nil
}

// ResetMFA lets one admin clear another admin's MFA (lost phone). The target
// must enroll again, their recovery codes are destroyed, and every open vault
// session of theirs is closed. You cannot reset your own: that is what
// recovery codes are for, and it stops a hijacked session from swapping in
// the attacker's authenticator.
func (s *Service) ResetMFA(a Actor, targetUserID string) error {
	if a.UserID != "" { // "" = the vaultctl operator on the server
		if err := requireAdmin(a); err != nil {
			return err
		}
	}
	if !isUUID(targetUserID) {
		return ErrNotFound
	}
	if targetUserID == a.UserID {
		return ErrCannotResetSelf
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var target models.User
		if err := tx.Where("id = ?", targetUserID).Take(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if err := tx.Where("user_id = ?", targetUserID).Delete(&models.VaultMFA{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", targetUserID).Delete(&models.VaultRecoveryCode{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.VaultUnlock{}).
			Where("user_id = ? AND revoked_at IS NULL", targetUserID).
			UpdateColumn("revoked_at", s.now()).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionMFAReset, targetUserID: targetUserID,
			details: map[string]any{"targetUsername": target.Username}})
	})
}

// ResetMFAByUsername is the break-glass path used by `vaultctl reset-mfa`
// when no other admin can do it from the UI.
func (s *Service) ResetMFAByUsername(operator Actor, username string) error {
	var u models.User
	if err := s.db.Where("username = ?", username).Take(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	operator.UserID = "" // CLI operator is not a portal user
	return s.ResetMFA(operator, u.ID)
}
