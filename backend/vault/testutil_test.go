package vault

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/migrations"
	"backend/models"
	vcrypto "backend/vault/crypto"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Integration tests run against a real PostgreSQL (the audit trigger, unique
// indexes and row locks are part of what's being tested). Set
// VAULT_TEST_DSN, e.g.
//
//	VAULT_TEST_DSN="postgres://postgres@localhost:5432/vaulttest?sslmode=disable" go test ./vault/...
//
// Each test gets its own schema, dropped afterwards. Without the env var the
// DB tests are skipped and only the pure unit tests run.

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type env struct {
	db    *gorm.DB
	svc   *Service
	clock *fakeClock
	keys  *vcrypto.KeyRing
}

func testKeyRing(t *testing.T, active int, versions ...int) *vcrypto.KeyRing {
	t.Helper()
	m := map[int][]byte{}
	for _, v := range versions {
		k := make([]byte, vcrypto.KeySize)
		for i := range k {
			k[i] = byte(v*31 + i)
		}
		m[v] = k
	}
	r, err := vcrypto.NewKeyRing(m, active)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func newEnv(t *testing.T) *env {
	t.Helper()
	dsn := os.Getenv("VAULT_TEST_DSN")
	if dsn == "" {
		t.Skip("VAULT_TEST_DSN not set; skipping PostgreSQL integration test")
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	schema := "vt_" + hex.EncodeToString(b)

	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		admin.Exec("DROP SCHEMA " + schema + " CASCADE")
		if sqlDB, err := admin.DB(); err == nil {
			sqlDB.Close()
		}
	})

	clock := &fakeClock{t: time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC)}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	db, err := gorm.Open(postgres.Open(dsn+sep+"search_path="+schema), &gorm.Config{
		Logger:  logger.Discard,
		NowFunc: clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	if err := migrations.CreatePasswordVault(db); err != nil {
		t.Fatal(err)
	}
	// Running it twice must be harmless (it runs on every boot).
	if err := migrations.CreatePasswordVault(db); err != nil {
		t.Fatalf("migration not idempotent: %v", err)
	}
	keys := testKeyRing(t, 1, 1)
	svc := NewService(db, keys).WithClock(clock.Now)
	return &env{db: db, svc: svc, clock: clock, keys: keys}
}

func (e *env) user(t *testing.T, username, role string) Actor {
	t.Helper()
	u := models.User{Username: username, PasswordHash: "x", Role: role, Email: username + "@example.test", IsActive: true}
	if err := e.db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	return Actor{
		UserID: u.ID, Username: username, SessionID: "sid-" + username, IsAdmin: role == "admin", AuthMethod: "pwd",
		TokenExpiry: e.clock.Now().Add(24 * time.Hour), IP: "203.0.113.7", UserAgent: "test",
	}
}

func (e *env) auditActions(t *testing.T) []string {
	t.Helper()
	var actions []string
	if err := e.db.Model(&models.VaultAuditEvent{}).Order("id").Pluck("action", &actions).Error; err != nil {
		t.Fatal(err)
	}
	return actions
}
