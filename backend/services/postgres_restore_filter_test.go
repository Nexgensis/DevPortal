package services

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"strings"
	"testing"
)

// A PG17 plain dump restored into a PG16 container. It names a GUC the target
// lacks, was taken with -C (so it re-enters its own database), and its COPY
// data contains a row that looks like a SET statement.
func TestCopyPlainDump(t *testing.T) {
	dump := strings.Join([]string{
		`SET statement_timeout = 0;`,
		`SET transaction_timeout = 0;`,
		`SELECT pg_catalog.set_config('search_path', '', false);`,
		`CREATE DATABASE job_portal WITH TEMPLATE = template0;`,
		`\connect job_portal`,
		``,
		`CREATE TABLE public.notes (body text);`,
		`COPY public.notes (body) FROM stdin;`,
		`SET transaction_timeout = 0;`,
		`\connect not_a_command`,
		`\.`,
		`SET default_tablespace = '';`,
		`CREATE INDEX ON public.notes (body);`,
	}, "\n") + "\n"

	known := map[string]bool{"statement_timeout": true, "default_tablespace": true}

	var out bytes.Buffer
	if err := copyPlainDump(&out, strings.NewReader(dump), known, nil); err != nil {
		t.Fatalf("filter failed: %v", err)
	}
	got := out.String()

	// Both the unknown GUC and the database-scope statements survive exactly
	// once each — as COPY data, never as statements.
	for _, once := range []string{"SET transaction_timeout", `\connect`} {
		if n := strings.Count(got, once); n != 1 {
			t.Errorf("want %q kept only inside COPY data (1 occurrence), got %d:\n%s", once, n, got)
		}
	}
	if strings.Contains(got, "CREATE DATABASE") {
		t.Errorf("CREATE DATABASE must not reach psql:\n%s", got)
	}
	for _, keep := range []string{"SET statement_timeout = 0;", "SET default_tablespace = '';", "set_config", "CREATE TABLE", "CREATE INDEX", `\.`} {
		if !strings.Contains(got, keep) {
			t.Errorf("filter dropped %q:\n%s", keep, got)
		}
	}

	// No GUC list (the pg_settings probe failed) keeps every SET, but the
	// database-scope statements are still unsafe and must go.
	out.Reset()
	if err := copyPlainDump(&out, strings.NewReader(dump), nil, nil); err != nil {
		t.Fatalf("passthrough failed: %v", err)
	}
	if !strings.Contains(out.String(), "SET transaction_timeout = 0;\n") {
		t.Error("nil known set must keep every SET statement")
	}
	if strings.Contains(out.String(), "CREATE DATABASE") {
		t.Error("database-scope statements must be dropped even without a GUC list")
	}
}

func TestDetectDump(t *testing.T) {
	plain := "--\n-- Dumped from database version 17.2\n--\nSET statement_timeout = 0;\n"

	var gzBuf bytes.Buffer
	zw := gzip.NewWriter(&gzBuf)
	zw.Write([]byte(plain))
	zw.Close()

	// A custom-format archive: pg_dump's magic, then arbitrary binary.
	custom := append([]byte("PGDMP"), 0x01, 0x0e, 0x00, 0x00, 0xff, 0xfe)

	cases := []struct {
		name                     string
		in                       []byte
		compression, format, ver string
	}{
		{"plain", []byte(plain), "none", "plain", "17.2"},
		{"gzipped plain", gzBuf.Bytes(), "gzip", "plain", "17.2"},
		{"custom archive", custom, "none", "custom", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind, r, err := detectDump(bytes.NewReader(tc.in))
			if err != nil {
				t.Fatalf("detect failed: %v", err)
			}
			if kind.Compression != tc.compression || kind.Format != tc.format || kind.SourceVersion != tc.ver {
				t.Errorf("got %+v, want %s/%s/%q", kind, tc.compression, tc.format, tc.ver)
			}
			// Detection must not eat the bytes it peeked at.
			body, err := io.ReadAll(r)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			want := tc.in
			if tc.compression == "gzip" {
				want = []byte(plain)
			}
			if !bytes.Equal(body, want) {
				t.Errorf("detection consumed bytes: got %q, want %q", body, want)
			}
		})
	}

	// Compression we cannot unwrap must say so instead of feeding binary to psql.
	if _, _, err := detectDump(bytes.NewReader([]byte("\x28\xb5\x2f\xfd\x00\x00"))); err == nil {
		t.Error("zstd dump should be rejected with a clear message")
	}
}

// A dump taken on a stock image (owner "postgres") restored into a hardened
// image whose superuser is "app_admin" and which has no "postgres" role.
func TestCopyPlainDumpMissingRole(t *testing.T) {
	dump := strings.Join([]string{
		`CREATE TABLE public.notes (body text);`,
		`ALTER TABLE public.notes OWNER TO postgres;`,
		`ALTER TABLE public.kept OWNER TO app_admin;`,
		`GRANT ALL ON TABLE public.notes TO postgres;`,
		`GRANT SELECT ON TABLE public.notes TO app_admin, reporting;`,
		`REVOKE ALL ON SCHEMA public FROM PUBLIC;`,
		`GRANT USAGE ON SCHEMA public TO PUBLIC;`,
		`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO reporting;`,
		`SET SESSION AUTHORIZATION 'postgres';`,
		`CREATE SCHEMA audit AUTHORIZATION postgres;`,
		`COPY public.notes (body) FROM stdin;`,
		`ALTER TABLE public.data OWNER TO postgres;`,
		`\.`,
	}, "\n") + "\n"

	roles := map[string]bool{"app_admin": true, "reporting": true}

	var out bytes.Buffer
	if err := copyPlainDump(&out, strings.NewReader(dump), nil, roles); err != nil {
		t.Fatalf("filter failed: %v", err)
	}
	got := out.String()

	// Everything naming the absent "postgres" role goes, except the COPY-data row.
	if n := strings.Count(got, "postgres"); n != 1 {
		t.Errorf("want only the COPY-data mention of postgres to survive, got %d:\n%s", n, got)
	}
	// Statements naming roles that DO exist keep their ownership and grants.
	for _, keep := range []string{
		`ALTER TABLE public.kept OWNER TO app_admin;`,
		`GRANT SELECT ON TABLE public.notes TO app_admin, reporting;`,
		`REVOKE ALL ON SCHEMA public FROM PUBLIC;`, // PUBLIC is a pseudo-role, never in pg_roles
		`GRANT USAGE ON SCHEMA public TO PUBLIC;`,
		`CREATE TABLE public.notes (body text);`,
	} {
		if !strings.Contains(got, keep) {
			t.Errorf("filter dropped %q:\n%s", keep, got)
		}
	}

	// No role list (the pg_roles probe failed) must leave the dump alone.
	out.Reset()
	if err := copyPlainDump(&out, strings.NewReader(dump), nil, nil); err != nil {
		t.Fatalf("passthrough failed: %v", err)
	}
	if out.String() != dump {
		t.Error("nil role set must pass ownership statements through unchanged")
	}
}

// Real psql output from a 17.10 dump replayed into a 16.15 container whose
// superuser is "nexgensis": the errors repeat once per table but the data
// lands, so they must come back as warnings rather than abort the restore.
func TestCollectRestoreWarnings(t *testing.T) {
	stderr := strings.Repeat("ERROR:  role \"postgres\" does not exist\n", 48) +
		"ERROR:  unrecognized configuration parameter \"transaction_timeout\"\n"

	got := collectRestoreWarnings(stderr, 8)
	want := []string{
		`role "postgres" does not exist (x48)`,
		`unrecognized configuration parameter "transaction_timeout"`,
	}
	if len(got) != len(want) {
		t.Fatalf("got %d warnings %q, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("warning %d: got %q, want %q", i, got[i], want[i])
		}
	}

	// pg_restore prefixes its own errors; a clean run reports nothing.
	if got := collectRestoreWarnings("pg_restore: error: could not execute query\n", 8); len(got) != 1 {
		t.Errorf("pg_restore errors should be collected, got %q", got)
	}
	if got := collectRestoreWarnings("SET\nCREATE TABLE\nCOPY 214\n", 8); len(got) != 0 {
		t.Errorf("clean output must produce no warnings, got %q", got)
	}

	// Past the cap the rest is summarized, never silently dropped.
	var many strings.Builder
	for i := 0; i < 12; i++ {
		fmt.Fprintf(&many, "ERROR:  distinct problem %d\n", i)
	}
	got = collectRestoreWarnings(many.String(), 8)
	if len(got) != 9 || !strings.Contains(got[8], "4 more distinct") {
		t.Errorf("want 8 warnings plus a summary of the remaining 4, got %q", got)
	}
}
