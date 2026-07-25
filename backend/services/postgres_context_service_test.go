package services

import "testing"

func TestParseActivityRows(t *testing.T) {
	// psql -t -A -F '|' output: no header, no padding, one row per line.
	const out = `fmcg|12|84213
audit|0|91
staging|0|0
`
	rows := parseActivityRows(out)
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3: %+v", len(rows), rows)
	}
	if rows[0].Name != "fmcg" || rows[0].Backends != 12 || rows[0].Txns != 84213 {
		t.Fatalf("first row parsed wrong: %+v", rows[0])
	}
	if rows[2].Name != "staging" || rows[2].Backends != 0 || rows[2].Txns != 0 {
		t.Fatalf("last row parsed wrong: %+v", rows[2])
	}
}

func TestParseActivityRowsIgnoresJunk(t *testing.T) {
	// Blank lines and psql notices must not become phantom databases.
	const out = "\nfmcg|3|10\n\nNOTICE: something\n|0|0\n"
	rows := parseActivityRows(out)
	if len(rows) != 1 || rows[0].Name != "fmcg" {
		t.Fatalf("expected only fmcg, got %+v", rows)
	}
}

// A live connection is the answer, regardless of transaction history.
func TestPickActivePrefersConnectedDatabases(t *testing.T) {
	got := pickActive([]DatabaseActivity{
		{Name: "fmcg", Backends: 12, Txns: 5},
		{Name: "archive", Backends: 0, Txns: 999999},
	})
	if len(got) != 1 || got[0] != "fmcg" {
		t.Fatalf("got %v, want [fmcg]", got)
	}
}

func TestPickActiveReturnsAllConnected(t *testing.T) {
	got := pickActive([]DatabaseActivity{
		{Name: "a", Backends: 2},
		{Name: "b", Backends: 1},
		{Name: "c", Backends: 0},
	})
	if len(got) != 2 {
		t.Fatalf("got %v, want a and b", got)
	}
}

// Whole stack stopped: nothing is connected, so fall back to the single
// most-transacted database rather than listing every database ever touched.
func TestPickActiveFallsBackToBusiestWhenIdle(t *testing.T) {
	got := pickActive([]DatabaseActivity{
		{Name: "fmcg", Backends: 0, Txns: 84213},
		{Name: "audit", Backends: 0, Txns: 91},
	})
	if len(got) != 1 || got[0] != "fmcg" {
		t.Fatalf("got %v, want [fmcg]", got)
	}
}

// A freshly created container has stats but no history — claiming a live
// database here would be a guess, so claim nothing.
func TestPickActiveEmptyWhenNothingUsed(t *testing.T) {
	if got := pickActive([]DatabaseActivity{{Name: "fresh"}}); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
	if got := pickActive(nil); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}
