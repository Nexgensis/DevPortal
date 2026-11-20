package router

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"backend/migrations"
	"backend/models"
	"backend/vault"
	vcrypto "backend/vault/crypto"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// End-to-end tests of the vault's HTTP surface: the middleware chain, status
// codes and headers the frontend relies on. Needs VAULT_TEST_DSN (see
// backend/vault/testutil_test.go).

const testJWTSecret = "router-test-secret"

type httpEnv struct {
	t  *testing.T
	db *gorm.DB
	r  *gin.Engine
}

func newHTTPEnv(t *testing.T) *httpEnv {
	t.Helper()
	dsn := os.Getenv("VAULT_TEST_DSN")
	if dsn == "" {
		t.Skip("VAULT_TEST_DSN not set; skipping PostgreSQL integration test")
	}
	t.Setenv("JWT_SECRET", testJWTSecret)
	gin.SetMode(gin.TestMode)

	b := make([]byte, 6)
	_, _ = rand.Read(b)
	schema := "rt_" + hex.EncodeToString(b)
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	admin.Exec("CREATE SCHEMA " + schema)
	t.Cleanup(func() {
		admin.Exec("DROP SCHEMA " + schema + " CASCADE")
		if s, err := admin.DB(); err == nil {
			s.Close()
		}
	})
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	db, err := gorm.Open(postgres.Open(dsn+sep+"search_path="+schema), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s, err := db.DB(); err == nil {
			s.Close()
		}
	})
	if err := db.AutoMigrate(&models.User{}, &models.AuditLog{}); err != nil {
		t.Fatal(err)
	}
	if err := migrations.CreatePasswordVault(db); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{7}, vcrypto.KeySize)
	ring, _ := vcrypto.NewKeyRing(map[int][]byte{1: key}, 1)
	return &httpEnv{t: t, db: db, r: SetupRouter(db, vault.NewService(db, ring))}
}

func (e *httpEnv) user(name, role string) models.User {
	u := models.User{Username: name, PasswordHash: "x", Role: role, Email: name + "@example.test", IsActive: true}
	if err := e.db.Create(&u).Error; err != nil {
		e.t.Fatal(err)
	}
	return u
}

func token(u models.User, sid string) string {
	claims := jwt.MapClaims{"user_id": u.ID, "username": u.Username, "role": u.Role, "exp": time.Now().Add(24 * time.Hour).Unix()}
	if sid != "" {
		claims["sid"] = sid
	}
	s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	return s
}

func (e *httpEnv) do(method, path, tok string, body any) (*httptest.ResponseRecorder, map[string]any) {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "198.51.100.10:1234"
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out
}

func code(t *testing.T, secret string, at time.Time) string {
	c, err := totp.GenerateCodeCustom(secret, at, totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestVaultHTTPFlow(t *testing.T) {
	e := newHTTPEnv(t)
	adminUser := e.user("alice", "admin")
	regular := e.user("bob", "user")
	tok := token(adminUser, "sess-1")

	// Regular users get nothing, not even status.
	for _, p := range []string{"/api/vault/status", "/api/vault/projects"} {
		if w, _ := e.do("GET", p, token(regular, "s"), nil); w.Code != http.StatusForbidden {
			t.Fatalf("regular user %s: %d", p, w.Code)
		}
	}
	// A forged "role: admin" claim for a non-admin is not enough: role is read from the DB.
	forged := regular
	forged.Role = "admin"
	if w, _ := e.do("GET", "/api/vault/status", token(forged, "s"), nil); w.Code != http.StatusForbidden {
		t.Fatalf("token role claim must not grant vault access: %d", w.Code)
	}
	if w, _ := e.do("GET", "/api/vault/status", "", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", w.Code)
	}

	// Admin, not yet unlocked: data routes say VAULT_LOCKED.
	w, body := e.do("GET", "/api/vault/projects", tok, nil)
	if w.Code != http.StatusForbidden || body["code"] != "VAULT_LOCKED" {
		t.Fatalf("locked: %d %v", w.Code, body)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("missing no-store: %q", cc)
	}

	// Old token without sid must re-login.
	if w, body := e.do("POST", "/api/vault/mfa/enroll", token(adminUser, ""), nil); body["code"] != "SESSION_UPGRADE_REQUIRED" {
		t.Fatalf("no sid: %d %v", w.Code, body)
	}

	// Enroll + confirm → unlocked.
	w, body = e.do("POST", "/api/vault/mfa/enroll", tok, nil)
	if w.Code != 200 {
		t.Fatalf("enroll: %d %v", w.Code, body)
	}
	secret := body["secret"].(string)
	w, body = e.do("POST", "/api/vault/mfa/enroll/confirm", tok, map[string]string{"code": code(t, secret, time.Now())})
	if w.Code != 200 || len(body["recoveryCodes"].([]any)) != vault.RecoveryCodeCount {
		t.Fatalf("confirm: %d %v", w.Code, body)
	}

	// Data routes now work for this session only.
	w, body = e.do("POST", "/api/vault/projects", tok, map[string]string{"name": "Alpha"})
	if w.Code != http.StatusCreated {
		t.Fatalf("create project: %d %v", w.Code, body)
	}
	pid := body["id"].(string)
	w, body = e.do("POST", "/api/vault/projects/"+pid+"/apps", tok, map[string]any{
		"name": "Prod DB", "loginUrl": "https://db.example.test"})
	if w.Code != http.StatusCreated {
		t.Fatalf("create app: %d %v", w.Code, body)
	}
	appID := body["id"].(string)
	w, body = e.do("POST", "/api/vault/apps/"+appID+"/credentials", tok, map[string]any{
		"label": "Superuser", "username": "postgres", "password": "pg-secret-1"})
	if w.Code != http.StatusCreated {
		t.Fatalf("create credential: %d %v", w.Code, body)
	}
	if strings.Contains(w.Body.String(), "pg-secret-1") {
		t.Fatal("create response must not echo the password")
	}
	cid := body["id"].(string)

	w, _ = e.do("GET", "/api/vault/projects/"+pid+"/apps", tok, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Superuser") || strings.Contains(w.Body.String(), "pg-secret-1") || strings.Contains(w.Body.String(), "password_ct") {
		t.Fatalf("list must not include secrets: %s", w.Body.String())
	}
	w, body = e.do("POST", "/api/vault/credentials/"+cid+"/reveal", tok, map[string]string{"field": "password", "purpose": "copy"})
	if w.Code != 200 || body["value"] != "pg-secret-1" {
		t.Fatalf("reveal: %d %v", w.Code, body)
	}

	// Other session of the same admin is still locked.
	if w, body := e.do("GET", "/api/vault/projects", token(adminUser, "sess-2"), nil); body["code"] != "VAULT_LOCKED" {
		t.Fatalf("other session: %d %v", w.Code, body)
	}

	// Demote alice: her still-valid token loses vault access immediately.
	e.db.Model(&models.User{}).Where("id = ?", adminUser.ID).Update("role", "user")
	if w, _ := e.do("GET", "/api/vault/projects", tok, nil); w.Code != http.StatusForbidden {
		t.Fatalf("demoted admin: %d", w.Code)
	}
	e.db.Model(&models.User{}).Where("id = ?", adminUser.ID).Update("role", "admin")

	// Logout locks the vault for that session.
	if w, _ := e.do("POST", "/api/auth/logout", tok, nil); w.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", w.Code)
	}
	if w, body := e.do("GET", "/api/vault/projects", tok, nil); body["code"] != "VAULT_LOCKED" {
		t.Fatalf("after logout: %d %v", w.Code, body)
	}
	// Logout is harmless for a regular user.
	if w, _ := e.do("POST", "/api/auth/logout", token(regular, "s"), nil); w.Code != http.StatusNoContent {
		t.Fatalf("regular logout: %d", w.Code)
	}

	// Audit visible to admins once unlocked; contains no secret.
	time.Sleep(0) // keep ordering explicit
	var events []models.VaultAuditEvent
	e.db.Order("id").Find(&events)
	seen := map[string]bool{}
	for _, ev := range events {
		seen[ev.Action] = true
		if strings.Contains(string(ev.Details), "pg-secret-1") {
			t.Fatal("secret in audit")
		}
		if ev.IP != "198.51.100.10" {
			t.Fatalf("audit IP should be the peer address, got %q", ev.IP)
		}
	}
	for _, a := range []string{vault.ActionMFAEnrolled, vault.ActionMFAVerified, vault.ActionCreateProject,
		vault.ActionCreateCredential, vault.ActionCopyPassword, vault.ActionVaultLocked} {
		if !seen[a] {
			t.Errorf("missing audit action %s", a)
		}
	}
}

func TestVaultUnlockRateLimitAndLockout(t *testing.T) {
	e := newHTTPEnv(t)
	u := e.user("alice", "admin")
	tok := token(u, "sess-1")
	_, body := e.do("POST", "/api/vault/mfa/enroll", tok, nil)
	secret := body["secret"].(string)
	e.do("POST", "/api/vault/mfa/enroll/confirm", tok, map[string]string{"code": code(t, secret, time.Now())})
	e.do("POST", "/api/vault/lock", tok, nil)

	statuses := []int{}
	for i := 0; i < 8; i++ {
		w, _ := e.do("POST", "/api/vault/unlock", tok, map[string]string{"code": "000000"})
		statuses = append(statuses, w.Code)
	}
	// 4 wrong codes → 401, 5th → lockout 429, then locked out (429) without checking.
	want := []int{401, 401, 401, 401, 429, 429, 429, 429}
	for i := range want {
		if statuses[i] != want[i] {
			t.Fatalf("statuses %v, want %v", statuses, want)
		}
	}
	// The per-IP limiter (10/min, enroll+unlock share the IP) kicks in for any account.
	other := e.user("carol", "admin")
	var last int
	for i := 0; i < 5; i++ {
		w, _ := e.do("POST", "/api/vault/unlock", token(other, "s"), map[string]string{"code": "000000"})
		last = w.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("per-IP limiter should trip, last status %d", last)
	}
	// Spoofed X-Forwarded-For from an untrusted peer must not reset the IP bucket.
	req := httptest.NewRequest("POST", "/api/vault/unlock", strings.NewReader(`{"code":"000000"}`))
	req.Header.Set("Authorization", "Bearer "+token(other, "s"))
	req.Header.Set("X-Forwarded-For", "203.0.113.99")
	req.RemoteAddr = "198.51.100.10:1"
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("XFF spoof bypassed limiter: %d", w.Code)
	}
}

func TestVaultDisabledWithoutKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", testJWTSecret)
	r := SetupRouter(nil, nil)
	req := httptest.NewRequest("GET", "/api/vault/status", nil)
	req.Header.Set("Authorization", "Bearer "+token(models.User{ID: "x", Username: "a", Role: "admin"}, "s"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without keys, got %d", w.Code)
	}
}
