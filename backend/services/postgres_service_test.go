package services

import (
	"testing"

	"backend/models"
)

// A cluster with POSTGRES_DB=qms has no "postgres" database, so every identity
// must also be retried against template1 — otherwise listing databases fails
// with `database "postgres" does not exist` despite valid credentials.
func TestCredAttemptsRetriesOnTemplate1(t *testing.T) {
	s := NewPostgresService()
	attempts := s.credAttempts(&models.Server{}, &PostgresCreds{User: "admin", Password: "pw", DBName: "qms"})

	got := make([][2]string, len(attempts))
	for i, a := range attempts {
		got[i] = [2]string{a.role, a.dbName}
	}

	want := [][2]string{
		{"admin", "qms"},
		{"postgres", "postgres"},
		{"admin", maintenanceDB},
		{"postgres", maintenanceDB},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d attempts %v, want %d %v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("attempt %d = %v, want %v", i, got[i], want[i])
		}
	}
}
