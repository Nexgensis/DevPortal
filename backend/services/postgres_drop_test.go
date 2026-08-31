package services

import (
	"strings"
	"testing"
)

// The drop guards are the only thing standing between a mis-click and a gone
// database, so pin them down.
func TestDropGuards(t *testing.T) {
	for _, name := range []string{"postgres", "template0", "template1", "TEMPLATE1"} {
		if !systemDatabases[strings.ToLower(name)] {
			t.Errorf("%q should be refused as a system database", name)
		}
	}
	if systemDatabases["qms"] {
		t.Error("qms should not be treated as a system database")
	}

	// dropdb's refusal message must still map to ErrDatabaseInUse, otherwise the
	// UI shows a raw exec error instead of "stop the app first".
	if !isDatabaseInUseErr(`dropdb: error: database removal failed: ERROR:  database "qms" is being accessed by other users`) {
		t.Error("in-use stderr not recognised")
	}
	if isDatabaseInUseErr(`dropdb: error: database "nope" does not exist`) {
		t.Error("unrelated stderr misread as in-use")
	}

	for _, bad := range []string{"", "1abc", "drop me", "a;b", `a"b`} {
		if validDBName.MatchString(bad) {
			t.Errorf("%q should be rejected as a database name", bad)
		}
	}
}
