package controllers

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"time"

	"backend/models"

	"github.com/golang-jwt/jwt/v5"
)

// SessionTTL is how long a login lasts (password and SSO alike).
const SessionTTL = 24 * time.Hour

// Login methods, carried in the JWT "amr" claim.
const (
	AuthPassword = "pwd"
	AuthSSO      = "sso"
)

// issueToken signs the session JWT for both password and SSO logins, so the
// two paths can't drift apart again.
//
// "sid" is a random per-login session id. The JWT stays stateless for the
// rest of the app, but server-side state that must end at logout — the
// password vault unlock — is keyed by it, which is what lets
// POST /api/auth/logout actually close something on the server.
//
// "amr" records how the session signed in: AuthPassword or AuthSSO.
func issueToken(user *models.User, method string) (string, error) {
	sid, err := newSessionID()
	if err != nil {
		return "", err
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"role":     user.Role,
		"sid":      sid,
		"amr":      method,
		"exp":      time.Now().Add(SessionTTL).Unix(),
	})
	// No fallback: JWT_SECRET is validated at startup in main().
	return token.SignedString([]byte(os.Getenv("JWT_SECRET")))
}

func newSessionID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
