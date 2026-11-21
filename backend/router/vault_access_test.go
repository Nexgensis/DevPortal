package router

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"backend/models"

	"github.com/golang-jwt/jwt/v5"
)

func ssoToken(u models.User, sid string) string {
	s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": u.ID, "username": u.Username, "role": u.Role, "sid": sid, "amr": "sso",
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}).SignedString([]byte(testJWTSecret))
	return s
}

// enrollAndUnlock sets up the authenticator app for tok's user and opens the
// vault for that login session (confirming enrollment unlocks it).
func (e *httpEnv) enrollAndUnlock(tok string) {
	e.t.Helper()
	w, body := e.do("POST", "/api/vault/mfa/enroll", tok, nil)
	if w.Code != 200 {
		e.t.Fatalf("enroll: %d %v", w.Code, body)
	}
	secret := body["secret"].(string)
	if w, b := e.do("POST", "/api/vault/mfa/enroll/confirm", tok, map[string]string{"code": code(e.t, secret, time.Now())}); w.Code != 200 {
		e.t.Fatalf("confirm: %d %v", w.Code, b)
	}
}

// Microsoft-SSO users unlock with the vault's own authenticator code, the
// same as password logins. "Unlock with Microsoft" was removed in v1.5.15:
// without Entra P1 it was only a second SSO sign-in.
func TestVaultSSOUserAppCodeAndDevAccessHTTP(t *testing.T) {
	e := newHTTPEnv(t)

	alice := e.user("alice", "admin")
	bob := e.user("bob", "user")
	aliceTok, bobTok := ssoToken(alice, "a-1"), ssoToken(bob, "b-1")

	// The Microsoft unlock route is gone.
	if w, _ := e.do("POST", "/api/vault/unlock/microsoft", aliceTok, nil); w.Code != http.StatusNotFound {
		t.Fatalf("unlock/microsoft should be gone: %d", w.Code)
	}

	// No grants yet: bob can't even see the vault exists for him.
	if w, _ := e.do("GET", "/api/vault/status", bobTok, nil); w.Code != http.StatusForbidden {
		t.Fatalf("bob without grants: %d", w.Code)
	}

	// An SSO admin starts locked and not enrolled, then sets up the app.
	if _, st := e.do("GET", "/api/vault/status", aliceTok, nil); st["enrolled"] != false || st["unlocked"] != false {
		t.Fatalf("SSO admin initial status: %v", st)
	}
	if _, b := e.do("GET", "/api/vault/projects", aliceTok, nil); b["code"] != "VAULT_LOCKED" {
		t.Fatalf("locked before MFA: %v", b)
	}
	e.enrollAndUnlock(aliceTok)
	if _, st := e.do("GET", "/api/vault/status", aliceTok, nil); st["enrolled"] != true || st["unlocked"] != true {
		t.Fatalf("SSO admin after enrolling: %v", st)
	}

	// Alice sets up a client with two apps and shares one app with bob.
	_, p := e.do("POST", "/api/vault/projects", aliceTok, map[string]any{"name": "Client A"})
	pid := p["id"].(string)
	_, aws := e.do("POST", "/api/vault/projects/"+pid+"/apps", aliceTok, map[string]any{"name": "AWS"})
	_, dbApp := e.do("POST", "/api/vault/projects/"+pid+"/apps", aliceTok, map[string]any{"name": "DB"})
	_, awsAcct := e.do("POST", "/api/vault/apps/"+aws["id"].(string)+"/credentials", aliceTok, map[string]any{"label": "root", "password": "aws-pw"})
	_, dbAcct := e.do("POST", "/api/vault/apps/"+dbApp["id"].(string)+"/credentials", aliceTok, map[string]any{"label": "pg", "password": "db-pw"})
	w, g := e.do("POST", "/api/vault/projects/"+pid+"/grants", aliceTok, map[string]any{"userId": bob.ID, "appId": aws["id"], "level": "view"})
	if w.Code != 200 {
		t.Fatalf("grant: %d %v", w.Code, g)
	}

	// Bob now has a vault, locked until he sets up his own authenticator code.
	if w, b := e.do("GET", "/api/vault/status", bobTok, nil); w.Code != 200 || b["role"] != "member" {
		t.Fatalf("bob status: %d %v", w.Code, b)
	}
	if _, b := e.do("GET", "/api/vault/projects", bobTok, nil); b["code"] != "VAULT_LOCKED" {
		t.Fatalf("bob before MFA: %v", b)
	}
	e.enrollAndUnlock(bobTok)

	w, _ = e.do("GET", "/api/vault/projects/"+pid+"/apps", bobTok, nil)
	if !strings.Contains(w.Body.String(), `"AWS"`) || strings.Contains(w.Body.String(), `"DB"`) {
		t.Fatalf("bob should see only AWS: %s", w.Body.String())
	}
	if _, b := e.do("POST", "/api/vault/credentials/"+awsAcct["id"].(string)+"/reveal", bobTok, map[string]string{"field": "password", "purpose": "view"}); b["value"] != "aws-pw" {
		t.Fatalf("bob reveal: %v", b)
	}
	for _, c := range []struct {
		method, path string
		body         any
		want         int
	}{
		{"POST", "/api/vault/credentials/" + dbAcct["id"].(string) + "/reveal", map[string]string{"field": "password", "purpose": "view"}, 404},
		{"POST", "/api/vault/apps/" + aws["id"].(string) + "/credentials", map[string]any{"password": "x"}, 403},
		{"POST", "/api/vault/projects", map[string]any{"name": "Mine"}, 403},
		{"GET", "/api/vault/projects/" + pid + "/grants", nil, 403},
		{"POST", "/api/vault/projects/" + pid + "/grants", map[string]any{"userId": bob.ID, "level": "edit"}, 403},
		{"GET", "/api/vault/audit", nil, 403},
		{"GET", "/api/vault/members", nil, 403},
	} {
		if w, b := e.do(c.method, c.path, bobTok, c.body); w.Code != c.want {
			t.Errorf("bob %s %s: want %d, got %d %v", c.method, c.path, c.want, w.Code, b)
		}
	}

	// Revoking takes effect on bob's very next request, unlock or not.
	e.do("DELETE", "/api/vault/grants/"+g["id"].(string), aliceTok, nil)
	if w, _ := e.do("GET", "/api/vault/projects", bobTok, nil); w.Code != http.StatusForbidden {
		t.Fatalf("after revoke: %d", w.Code)
	}
}
