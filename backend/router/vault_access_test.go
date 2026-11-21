package router

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"backend/controllers"
	"backend/models"
	"backend/vault"
	vcrypto "backend/vault/crypto"

	"github.com/golang-jwt/jwt/v5"
)

const rtTenant = "11111111-2222-3333-4444-555555555555"

func ssoToken(u models.User, sid string) string {
	s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": u.ID, "username": u.Username, "role": u.Role, "sid": sid, "amr": "sso",
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}).SignedString([]byte(testJWTSecret))
	return s
}

// unlockWithMicrosoft runs the real redirect flow with Microsoft's token
// endpoint stubbed out, and returns where the browser lands.
func (e *httpEnv) unlockWithMicrosoft(u models.User, tok string, mutate func(map[string]any)) string {
	e.t.Helper()
	w, body := e.do("POST", "/api/vault/unlock/microsoft", tok, nil)
	if w.Code != 200 {
		e.t.Fatalf("start: %d %v", w.Code, body)
	}
	authURL, _ := url.Parse(body["url"].(string))
	q := authURL.Query()
	if q.Get("prompt") != "login" || q.Get("max_age") != "300" || !strings.Contains(authURL.Path, rtTenant) ||
		q.Get("claims") != `{"id_token":{"acrs":{"essential":true,"value":"c1"}}}` {
		e.t.Fatalf("step-up must force a fresh sign-in in our tenant: %s", authURL)
	}
	claims := map[string]any{
		"iss": "https://login.microsoftonline.com/" + rtTenant + "/v2.0", "aud": "client-abc", "tid": rtTenant,
		"nonce": q.Get("nonce"), "exp": time.Now().Add(time.Hour).Unix(), "auth_time": time.Now().Unix(),
		"amr": []string{"pwd", "mfa"}, "acrs": []string{"c1"}, "preferred_username": u.Email,
	}
	if mutate != nil {
		mutate(claims)
	}
	payload, _ := json.Marshal(claims)
	controllers.VaultCodeExchange = func(code string) (string, error) {
		if code != "the-code" {
			e.t.Fatalf("unexpected code %q", code)
		}
		return "e30." + base64.RawURLEncoding.EncodeToString(payload) + ".sig", nil
	}
	req := httptest.NewRequest("GET", "/api/auth/microsoft/callback?code=the-code&state="+url.QueryEscape(q.Get("state")), nil)
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		e.t.Fatalf("callback: %d %s", rec.Code, rec.Body.String())
	}
	return rec.Header().Get("Location")
}

func TestVaultMicrosoftUnlockAndDevAccessHTTP(t *testing.T) {
	e := newHTTPEnv(t)
	t.Setenv("MICROSOFT_CLIENT_ID", "client-abc")
	t.Setenv("MICROSOFT_TENANT_ID", rtTenant)
	t.Setenv("MICROSOFT_REDIRECT_URI", "https://portal.example.test/api/auth/microsoft/callback")
	t.Setenv("FRONTEND_URL", "https://portal.example.test")
	orig := controllers.VaultCodeExchange
	t.Cleanup(func() { controllers.VaultCodeExchange = orig })
	ring, _ := vcrypto.NewKeyRing(map[int][]byte{1: bytes.Repeat([]byte{7}, vcrypto.KeySize)}, 1)
	e.r = SetupRouter(e.db, vault.NewService(e.db, ring).WithEntra(vault.EntraConfig{TenantID: rtTenant, ClientID: "client-abc", RequireMFAClaim: true, AuthContext: "c1"}))

	alice := e.user("alice", "admin")
	bob := e.user("bob", "user")
	aliceTok, bobTok := ssoToken(alice, "a-1"), ssoToken(bob, "b-1")

	// No grants yet: bob can't even see the vault exists for him.
	if w, _ := e.do("GET", "/api/vault/status", bobTok, nil); w.Code != http.StatusForbidden {
		t.Fatalf("bob without grants: %d", w.Code)
	}

	_, st := e.do("GET", "/api/vault/status", aliceTok, nil)
	if m := st["methods"].(map[string]any); m["microsoft"] != true || m["totp"] != false {
		t.Fatalf("SSO admin unlock methods: %v", st)
	}
	if w, b := e.do("POST", "/api/vault/mfa/enroll", aliceTok, nil); b["code"] != "USE_MICROSOFT" {
		t.Fatalf("SSO admin shouldn't enroll an app: %d %v", w.Code, b)
	}

	// Wrong person at Microsoft → bounced back with an error, still locked.
	if loc := e.unlockWithMicrosoft(alice, aliceTok, func(c map[string]any) { c["preferred_username"] = "bob@example.test" }); loc != "https://portal.example.test/vault?unlock_error=wrong_account" {
		t.Fatalf("wrong account landed on %s", loc)
	}
	if _, b := e.do("GET", "/api/vault/projects", aliceTok, nil); b["code"] != "VAULT_LOCKED" {
		t.Fatalf("still locked: %v", b)
	}
	if loc := e.unlockWithMicrosoft(alice, aliceTok, nil); loc != "https://portal.example.test/vault?unlock=ok" {
		t.Fatalf("landed on %s", loc)
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

	// Bob now has a vault, locked until he does his own Microsoft MFA.
	if w, b := e.do("GET", "/api/vault/status", bobTok, nil); w.Code != 200 || b["role"] != "member" {
		t.Fatalf("bob status: %d %v", w.Code, b)
	}
	if _, b := e.do("GET", "/api/vault/projects", bobTok, nil); b["code"] != "VAULT_LOCKED" {
		t.Fatalf("bob before MFA: %v", b)
	}
	if loc := e.unlockWithMicrosoft(bob, bobTok, nil); !strings.HasSuffix(loc, "unlock=ok") {
		t.Fatalf("bob step-up: %s", loc)
	}

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

	// A forged/unknown state never unlocks anything.
	req := httptest.NewRequest("GET", "/api/auth/microsoft/callback?code=x&state=vault.forged", nil)
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, req)
	if loc := rec.Header().Get("Location"); loc != "https://portal.example.test/vault?unlock_error=expired" {
		t.Fatalf("forged state: %d %s", rec.Code, loc)
	}
}
