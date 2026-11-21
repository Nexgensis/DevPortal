package vault

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"backend/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Unlock with Microsoft (Entra ID step-up).
//
// The org signs in with Microsoft and Microsoft already enforces MFA, so SSO
// users unlock the vault by signing in to Microsoft again instead of
// enrolling a second authenticator. The flow:
//
//  1. StartMicrosoftUnlock (authenticated portal session) stores a one-time
//     row: hash(state) → this user + this login session + a nonce.
//  2. The browser goes to Microsoft with prompt=login&max_age=0, so the user
//     must actually sign in again (no silent SSO), MFA included.
//  3. Microsoft redirects back without our JWT. The controller exchanges the
//     code for an ID token server-to-server, then CompleteMicrosoftUnlock
//     checks it against the stored row and opens the vault for *that* login
//     session only.
//
// The ID token arrives directly from Microsoft's token endpoint over TLS in
// exchange for our client secret, which OIDC Core §3.1.3.7(6) accepts in
// place of verifying its signature. What we check:
//
//   - iss/tid = our tenant (a token from any other tenant is rejected, even
//     if its username matches), aud = our client id, not expired
//   - nonce = the one stored for this attempt (no replaying another login)
//   - auth_time is after the attempt started (a fresh sign-in, not a reused
//     session)
//   - amr contains "mfa" (unless RequireMFAClaim is off — see EntraConfig)
//   - acrs contains AuthContext, when one is configured: a Conditional
//     Access authentication context whose policy demands MFA with sign-in
//     frequency "every time", so Microsoft must get a fresh Authenticator
//     approval for every unlock instead of reusing an earlier one
//   - the signed-in Microsoft account is this portal user (email match)

const (
	StepUpTTL       = 10 * time.Minute
	stepUpStatePref = "vault." // lets the shared SSO callback route tell the flows apart
	authTimeSkew    = 2 * time.Minute
)

// EntraConfig comes from the existing SSO settings (MICROSOFT_TENANT_ID,
// MICROSOFT_CLIENT_ID) plus VAULT_SSO_REQUIRE_MFA_CLAIM.
type EntraConfig struct {
	TenantID string
	ClientID string
	// RequireMFAClaim (default true) insists the ID token's amr claim lists
	// "mfa". If your tenant's tokens don't carry amr, turning this off falls
	// back to trusting the tenant's Conditional Access policy plus the fresh
	// sign-in check. Leave it on unless the first unlock attempt says the
	// claim is missing.
	RequireMFAClaim bool
	// AuthContext is a Conditional Access authentication context id
	// ("c1".."c99"), optional. When set, the sign-in URL asks Microsoft for
	// it and the ID token must list it in "acrs". Pair it with a CA policy
	// for that context: require MFA (Authenticator), sign-in frequency
	// "Every time". That is what guarantees a new approval on each unlock;
	// prompt=login alone re-asks for the password but Microsoft may skip MFA
	// it considers recent.
	AuthContext string
}

var authContextRe = regexp.MustCompile(`^c([1-9]|[1-9][0-9])$`)

// ValidAuthContext reports whether v looks like an Entra authentication
// context id. Checked at startup so a typo fails loudly.
func ValidAuthContext(v string) bool { return authContextRe.MatchString(v) }

// ClaimsRequest is the OIDC "claims" parameter that asks Microsoft to
// enforce the authentication context; "" when none is configured.
func (c EntraConfig) ClaimsRequest() string {
	if c.AuthContext == "" {
		return ""
	}
	return `{"id_token":{"acrs":{"essential":true,"value":"` + c.AuthContext + `"}}}`
}

// Enabled requires a real tenant GUID: with "common" or "organizations" any
// Microsoft account could sign in, and we bind identity by tenant + email.
func (c EntraConfig) Enabled() bool { return isUUID(c.TenantID) && c.ClientID != "" }

// WithEntra turns on "unlock with Microsoft".
func (s *Service) WithEntra(cfg EntraConfig) *Service {
	cp := *s
	cp.entra = cfg
	return &cp
}

func (s *Service) MicrosoftUnlockAvailable() bool { return s.entra.Enabled() }

// EntraClaimsRequest is the "claims" parameter for the sign-in URL.
func (s *Service) EntraClaimsRequest() string { return s.entra.ClaimsRequest() }

// StepUpError carries a short machine code for the redirect back to the UI.
type StepUpError struct {
	Code string // expired | wrong_account | no_mfa | not_fresh | invalid
	Msg  string
}

func (e *StepUpError) Error() string { return e.Msg }

var (
	ErrMicrosoftUnlockUnavailable = errors.New("unlock with Microsoft isn't set up on this server")
	ErrUseMicrosoft               = errors.New("your account signs in with Microsoft, so unlock the vault with Microsoft instead")
)

func hashState(state string) []byte { h := sha256.Sum256([]byte(state)); return h[:] }

func randToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// StepUp is what the controller needs to send the browser to Microsoft.
type StepUp struct {
	State     string
	Nonce     string
	LoginHint string
}

func (s *Service) StartMicrosoftUnlock(a Actor) (StepUp, error) {
	if !s.entra.Enabled() {
		return StepUp{}, ErrMicrosoftUnlockUnavailable
	}
	if a.SessionID == "" {
		return StepUp{}, ErrSessionUpgradeRequired
	}
	var email string
	if err := s.db.Model(&models.User{}).Where("id = ?", a.UserID).Pluck("email", &email).Error; err != nil {
		return StepUp{}, err
	}
	if strings.TrimSpace(email) == "" {
		return StepUp{}, invalid("your portal account has no email, so it can't be matched to a Microsoft account")
	}
	r, err := randToken(32)
	if err != nil {
		return StepUp{}, err
	}
	nonce, err := randToken(24)
	if err != nil {
		return StepUp{}, err
	}
	state := stepUpStatePref + r
	now := s.now().UTC().Truncate(time.Microsecond)
	row := models.VaultStepUp{StateHash: hashState(state), UserID: a.UserID, SessionID: a.SessionID, Nonce: nonce,
		IP: a.IP, UserAgent: truncate(a.UserAgent, 512), CreatedAt: now, ExpiresAt: now.Add(StepUpTTL)}
	if !a.TokenExpiry.IsZero() {
		te := a.TokenExpiry.UTC()
		row.TokenExpiry = &te
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// Housekeeping: attempts older than a day are useless.
		if err := tx.Where("expires_at < ?", now.Add(-24*time.Hour)).Delete(&models.VaultStepUp{}).Error; err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return StepUp{}, err
	}
	return StepUp{State: state, Nonce: nonce, LoginHint: email}, nil
}

// IsVaultStepUpState lets the shared OAuth callback route recognise ours.
func IsVaultStepUpState(state string) bool { return strings.HasPrefix(state, stepUpStatePref) }

// StepUpPending reports whether state names a live, unused attempt. The
// controller checks it before spending a call on the code exchange.
func (s *Service) StepUpPending(state string) bool {
	var n int64
	s.db.Model(&models.VaultStepUp{}).
		Where("state_hash = ? AND used_at IS NULL AND expires_at > ?", hashState(state), s.now()).Count(&n)
	return n > 0
}

type entraClaims struct {
	Iss               string   `json:"iss"`
	Aud               string   `json:"aud"`
	Tid               string   `json:"tid"`
	Oid               string   `json:"oid"`
	Nonce             string   `json:"nonce"`
	Exp               int64    `json:"exp"`
	AuthTime          int64    `json:"auth_time"`
	Amr               []string `json:"amr"`
	Acrs              []string `json:"acrs"`
	PreferredUsername string   `json:"preferred_username"`
	Email             string   `json:"email"`
	UPN               string   `json:"upn"`
}

func parseIDToken(raw string) (entraClaims, error) {
	var c entraClaims
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return c, errors.New("malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return c, errors.New("malformed id_token payload")
	}
	if err := json.Unmarshal(payload, &c); err != nil {
		return c, errors.New("malformed id_token claims")
	}
	return c, nil
}

// CompleteMicrosoftUnlock validates the ID token for the attempt named by
// state and, if everything matches, opens the vault for the login session
// that started it. The attempt is consumed whether or not it succeeds.
func (s *Service) CompleteMicrosoftUnlock(state, rawIDToken, ip, userAgent string) (time.Time, error) {
	if !s.entra.Enabled() {
		return time.Time{}, ErrMicrosoftUnlockUnavailable
	}
	var exp time.Time
	var failure *StepUpError
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row models.VaultStepUp
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("state_hash = ? AND used_at IS NULL", hashState(state)).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			failure = &StepUpError{Code: "expired", Msg: "this unlock link was already used or is unknown; start again"}
			return nil
		}
		if err != nil {
			return err
		}
		now := s.now()
		if err := tx.Model(&models.VaultStepUp{}).Where("state_hash = ?", row.StateHash).UpdateColumn("used_at", now).Error; err != nil {
			return err
		}
		var user models.User
		if err := tx.Select("id, username, email, is_active").Where("id = ?", row.UserID).Take(&user).Error; err != nil {
			return notFoundOr(err)
		}
		a := Actor{UserID: user.ID, Username: user.Username, SessionID: row.SessionID, IP: ip, UserAgent: userAgent, AuthMethod: "sso"}
		if row.TokenExpiry != nil {
			a.TokenExpiry = *row.TokenExpiry
		}
		if !row.ExpiresAt.After(now) {
			failure = &StepUpError{Code: "expired", Msg: "the unlock took longer than 10 minutes; start again"}
		} else {
			failure = s.checkIDToken(rawIDToken, row, user, now)
		}
		if failure != nil {
			// Commit the failure record and the consumed attempt.
			return s.audit(tx, a, auditEntry{action: ActionMFAFailed, details: map[string]any{"method": "microsoft", "reason": failure.Code}})
		}
		if !user.IsActive {
			failure = &StepUpError{Code: "wrong_account", Msg: "your portal account is deactivated"}
			return nil
		}
		if exp, err = s.createUnlock(tx, a); err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionMFAVerified, details: map[string]any{"method": "microsoft"}})
	})
	if err != nil {
		return time.Time{}, err
	}
	if failure != nil {
		return time.Time{}, failure
	}
	return exp, nil
}

func (s *Service) checkIDToken(raw string, row models.VaultStepUp, user models.User, now time.Time) *StepUpError {
	bad := func(code, msg string) *StepUpError { return &StepUpError{Code: code, Msg: msg} }
	c, err := parseIDToken(raw)
	if err != nil {
		return bad("invalid", "Microsoft returned an unreadable sign-in token")
	}
	tenant := strings.ToLower(s.entra.TenantID)
	if !strings.EqualFold(c.Tid, tenant) || !strings.EqualFold(c.Iss, "https://login.microsoftonline.com/"+tenant+"/v2.0") {
		return bad("wrong_account", "that Microsoft account isn't from your organisation")
	}
	if c.Aud != s.entra.ClientID {
		return bad("invalid", "the sign-in token was issued for a different app")
	}
	if c.Exp == 0 || time.Unix(c.Exp, 0).Before(now) {
		return bad("invalid", "the sign-in token has expired")
	}
	if c.Nonce == "" || subtle.ConstantTimeCompare([]byte(c.Nonce), []byte(row.Nonce)) != 1 {
		return bad("invalid", "the sign-in token doesn't belong to this unlock attempt")
	}
	if c.AuthTime == 0 || time.Unix(c.AuthTime, 0).Before(row.CreatedAt.Add(-authTimeSkew)) {
		return bad("not_fresh", "Microsoft reused an earlier sign-in; you need to sign in again")
	}
	if s.entra.RequireMFAClaim {
		mfa := false
		for _, m := range c.Amr {
			if m == "mfa" {
				mfa = true
			}
		}
		if !mfa {
			return bad("no_mfa", "Microsoft didn't confirm MFA for this sign-in")
		}
	}
	if ctx := s.entra.AuthContext; ctx != "" {
		ok := false
		for _, v := range c.Acrs {
			if v == ctx {
				ok = true
			}
		}
		if !ok {
			return bad("no_approval", "Microsoft didn't require a fresh Authenticator approval for this sign-in")
		}
	}
	want := strings.TrimSpace(user.Email)
	for _, got := range []string{c.Email, c.PreferredUsername, c.UPN} {
		if want != "" && strings.EqualFold(strings.TrimSpace(got), want) {
			return nil
		}
	}
	return bad("wrong_account", "you signed in to Microsoft as a different person than your portal account")
}
