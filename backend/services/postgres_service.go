package services

import (
	"bufio"
	"bytes"
	"compress/bzip2"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"

	"backend/models"
	"backend/utils"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

// defaultAdminRole is the conventional PostgreSQL bootstrap superuser. Almost
// every image authenticates as this over the local Unix socket (peer auth).
const defaultAdminRole = "postgres"

// maintenanceDB is the always-present database to fall back to when the
// conventional "postgres" database is absent. initdb creates template1 in every
// cluster and it cannot be dropped.
const maintenanceDB = "template1"

// validRoleName guards the dynamically-discovered superuser name. The value
// comes from inspecting the container's process list, so we only accept a sane
// PostgreSQL/OS identifier (letters, digits, underscore, hyphen; ≤63 chars, the
// Postgres identifier limit) before ever passing it to psql/pg_dump.
var validRoleName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,62}$`)

// PostgresCreds are Admin-configured explicit credentials for a container. When
// provided (User != ""), the service authenticates with these via password auth
// — exec'ing as the OS "root" user and passing PGPASSWORD + `-U User -d DBName`
// — instead of running the peer/trust auto-detection chain. This is the path for
// hardened images that removed the default "postgres" role and run under a custom
// user/database (e.g. user "nexgensis", db "nexgendb").
type PostgresCreds struct {
	User     string // e.g. "nexgensis"
	Password string // decrypted by the controller from db_password_encrypted
	DBName   string // maintenance/default database to connect to, e.g. "nexgendb"
}

func (c *PostgresCreds) isSet() bool { return c != nil && c.User != "" }

// env returns the exec environment carrying the password for libpq.
func (c *PostgresCreds) env() []string { return []string{"PGPASSWORD=" + c.Password} }

// effective returns the (user, dbName, password) to authenticate with: the
// stored values when present, otherwise the conventional "postgres"/"postgres"
// default profile as a safe catch-all. A stored row with a blank maintenance DB
// also falls back to "postgres" for the -d target.
func (c *PostgresCreds) effective() (user, dbName, password string) {
	if c.isSet() {
		dbName = c.DBName
		if dbName == "" {
			dbName = defaultAdminRole
		}
		return c.User, dbName, c.Password
	}
	return defaultAdminRole, defaultAdminRole, ""
}

// PostgresService handles PostgreSQL operations over the remote Docker Engine
// API (mutual TLS). It runs psql / pg_dump inside the target container via the
// Docker Exec API — no SSH, no host-level `docker exec` shelling out.
type PostgresService struct{}

// NewPostgresService creates a new PostgreSQL service.
func NewPostgresService() *PostgresService {
	return &PostgresService{}
}

// GetDatabases retrieves the list of databases from a PostgreSQL container.
//
// It walks the credential chain (see credAttempts): per-container override →
// default "postgres" → server-level fallback → ps-discovery, running the list
// query under each until one succeeds. First success wins.
func (s *PostgresService) GetDatabases(ctx context.Context, server *models.Server, containerID string, creds *PostgresCreds) ([]models.PostgresDatabase, error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	const listQuery = `SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datistemplate = false ORDER BY datname;`

	listCmd := func(role, dbName string) []string {
		cmd := []string{"psql", "-U", role}
		if dbName != "" {
			cmd = append(cmd, "-d", dbName)
		}
		return append(cmd, "-t", "-A", "-F", "|", "-c", listQuery)
	}

	stdout, stderr, err := s.runAcrossCreds(ctx, cli, containerID, server, creds, listCmd)
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w (%s)", err, strings.TrimSpace(stderr))
	}
	return s.parseDatabaseList(stdout), nil
}

// parseDatabaseList parses the pipe-separated psql output into typed rows.
func (s *PostgresService) parseDatabaseList(output string) []models.PostgresDatabase {
	var databases []models.PostgresDatabase

	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Split(line, "|")
		if len(parts) < 3 {
			continue
		}

		db := models.PostgresDatabase{
			Name:     strings.TrimSpace(parts[0]),
			Owner:    strings.TrimSpace(parts[1]),
			Encoding: strings.TrimSpace(parts[2]),
		}
		if len(parts) >= 4 {
			db.Size = strings.TrimSpace(parts[3])
		}

		databases = append(databases, db)
	}

	return databases
}

// CreateDump runs `pg_dump | gzip -1` inside the container and returns a live,
// demultiplexed stdout stream of the gzip-compressed plain-SQL dump. Memory
// stays flat regardless of database size: the caller streams straight from the
// returned reader to the client (which serves it as Content-Encoding: gzip, so
// the browser saves a plain .sql file).
//
// The returned ReadCloser owns the Docker client and the hijacked connection;
// closing it tears both down. The caller MUST Close it.
func (s *PostgresService) CreateDump(ctx context.Context, server *models.Server, containerID, database string, creds *PostgresCreds) (io.ReadCloser, error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, err
	}

	// A stream can't be transparently retried, so probe the credential chain
	// (per-container → postgres → server-level → discovery) with a cheap
	// SELECT 1 and stream pg_dump as the first identity that connects.
	dumpRole, osUser, env := s.resolveDumpExec(ctx, cli, containerID, server, creds)

	// Plain-text SQL (default format) piped through `gzip -1`: gzip level 1 is
	// fast (far lighter on CPU than pg_dump's old -F c zlib level 6) yet still
	// shrinks the transfer ~5-10x. The controller serves it with
	// Content-Encoding: gzip, so the browser decompresses it and saves a plain
	// .sql file. The role and DB name are passed as positional args ("$1"/"$2")
	// rather than interpolated into the shell string, so neither can be used for
	// injection.
	execCfg := container.ExecOptions{
		User:         osUser,
		Env:          env,
		Cmd:          []string{"sh", "-c", `pg_dump -U "$1" "$2" | gzip -c -1`, "sh", dumpRole, database},
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false, // keep stdout/stderr multiplexed so the gzip stream stays intact
	}

	execResp, err := cli.ContainerExecCreate(ctx, containerID, execCfg)
	if err != nil {
		cli.Close()
		return nil, fmt.Errorf("failed to create exec: %w", err)
	}

	hijacked, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{Tty: false})
	if err != nil {
		cli.Close()
		return nil, fmt.Errorf("failed to attach to exec: %w", err)
	}

	// The exec stream is stdcopy-multiplexed. Demux on the fly into an io.Pipe:
	// stdout (the archive) flows to the reader the caller streams from, while
	// stderr is captured so we can surface pg_dump errors.
	pr, pw := io.Pipe()
	go func() {
		var stderrBuf bytes.Buffer
		_, copyErr := stdcopy.StdCopy(pw, &stderrBuf, hijacked.Reader)

		// Release the hijacked connection and the docker client now that the
		// stream is fully drained.
		hijacked.Close()
		cli.Close()

		if copyErr != nil {
			pw.CloseWithError(fmt.Errorf("dump stream failed: %w", copyErr))
			return
		}
		if stderrBuf.Len() > 0 {
			// pg_dump emits diagnostics on stderr; treat non-empty stderr as a
			// failure so a partial/empty archive isn't silently served.
			pw.CloseWithError(fmt.Errorf("pg_dump error: %s", strings.TrimSpace(stderrBuf.String())))
			return
		}
		pw.Close()
	}()

	return pr, nil
}

// TestConnection verifies psql can reach the database engine inside the
// container, walking the same credential chain as GetDatabases.
func (s *PostgresService) TestConnection(ctx context.Context, server *models.Server, containerID string, creds *PostgresCreds) error {
	cli, err := NewDockerClient(server)
	if err != nil {
		return err
	}
	defer cli.Close()

	select1 := func(role, dbName string) []string {
		cmd := []string{"psql", "-U", role}
		if dbName != "" {
			cmd = append(cmd, "-d", dbName)
		}
		return append(cmd, "-c", "SELECT 1;")
	}

	if _, stderr, err := s.runAcrossCreds(ctx, cli, containerID, server, creds, select1); err != nil {
		return fmt.Errorf("connection test failed: %w (%s)", err, strings.TrimSpace(stderr))
	}
	return nil
}

// credAttempt is one identity to try: exec as osUser (with optional PGPASSWORD
// env) and authenticate as DB role `role`, connecting to `dbName` (empty -> omit
// -d, letting libpq default to the username).
type credAttempt struct {
	osUser string
	env    []string
	role   string
	dbName string
}

// serverLevelCreds builds the server-wide fallback credentials from the Server
// row (decrypting the stored password). Returns nil when no PG user is set.
func serverLevelCreds(server *models.Server) *PostgresCreds {
	if server == nil || server.PGUser == "" {
		return nil
	}
	password := ""
	if server.PGPasswordEncrypted != "" {
		if dec, err := utils.Decrypt(server.PGPasswordEncrypted); err == nil {
			password = dec
		}
	}
	return &PostgresCreds{User: server.PGUser, Password: password, DBName: server.PGMaintenanceDB}
}

// credAttempts builds the ordered credential chain for a container:
//  1. per-container override (if set),
//  2. default "postgres"/"postgres",
//  3. server-level fallback (if configured).
//
// ps-discovery is handled separately as a final safety net by the callers.
func (s *PostgresService) credAttempts(server *models.Server, creds *PostgresCreds) []credAttempt {
	attempts := make([]credAttempt, 0, 3)
	if creds.isSet() {
		u, d, p := creds.effective()
		attempts = append(attempts, credAttempt{osUser: "root", env: []string{"PGPASSWORD=" + p}, role: u, dbName: d})
	}
	attempts = append(attempts, credAttempt{osUser: "root", env: []string{"PGPASSWORD="}, role: defaultAdminRole, dbName: defaultAdminRole})
	if sc := serverLevelCreds(server); sc.isSet() {
		u, d, p := sc.effective()
		attempts = append(attempts, credAttempt{osUser: "root", env: []string{"PGPASSWORD=" + p}, role: u, dbName: d})
	}

	// A cluster bootstrapped with POSTGRES_DB=<name> may have no "postgres"
	// database at all, so every attempt above dies on `database "postgres" does
	// not exist` even with valid credentials. template1 is created by initdb and
	// cannot be dropped, so retry each identity there — we only need a foothold
	// to query pg_database, not a specific database.
	for _, a := range attempts[:len(attempts):len(attempts)] {
		a.dbName = maintenanceDB
		attempts = append(attempts, a)
	}
	return attempts
}

// runAcrossCreds runs cmdFor(role, dbName) under each credential attempt until
// one succeeds; failing that, it tries the ps-discovered superuser (peer auth).
// Returns the winning stdout, or the last (stderr, error) if all attempts fail.
func (s *PostgresService) runAcrossCreds(ctx context.Context, cli *client.Client, containerID string, server *models.Server, creds *PostgresCreds, cmdFor func(role, dbName string) []string) (string, string, error) {
	var lastStderr string
	var lastErr error
	for _, a := range s.credAttempts(server, creds) {
		out, stderr, err := s.execCapture(ctx, cli, containerID, a.osUser, a.env, cmdFor(a.role, a.dbName))
		if err == nil {
			return out, "", nil
		}
		lastStderr, lastErr = stderr, err
	}

	// Safety net: the default "postgres" role is missing — discover the real
	// superuser from the postmaster process and retry over peer auth.
	if isMissingDefaultRole(lastStderr) {
		if role, derr := s.discoverSuperuser(ctx, cli, containerID); derr == nil && role != "" && role != defaultAdminRole {
			out, stderr, err := s.execCapture(ctx, cli, containerID, role, nil, cmdFor(role, ""))
			if err == nil {
				return out, "", nil
			}
			lastStderr, lastErr = stderr, err
		}
	}
	return "", lastStderr, lastErr
}

// resolveDumpExec probes the credential chain with a cheap SELECT 1 and returns
// the (role, osUser, env) of the first identity that connects — used by the
// streaming dump path, which can't be retried mid-flight. Falls back to the
// ps-discovered superuser, then to the conventional default.
func (s *PostgresService) resolveDumpExec(ctx context.Context, cli *client.Client, containerID string, server *models.Server, creds *PostgresCreds) (role, osUser string, env []string) {
	for _, a := range s.credAttempts(server, creds) {
		cmd := []string{"psql", "-U", a.role}
		if a.dbName != "" {
			cmd = append(cmd, "-d", a.dbName)
		}
		cmd = append(cmd, "-tAc", "SELECT 1")
		if _, _, err := s.execCapture(ctx, cli, containerID, a.osUser, a.env, cmd); err == nil {
			return a.role, a.osUser, a.env
		}
	}
	if discovered, derr := s.discoverSuperuser(ctx, cli, containerID); derr == nil && discovered != "" {
		return discovered, discovered, nil
	}
	// Give up gracefully; the dump will surface a precise error.
	return defaultAdminRole, "root", []string{"PGPASSWORD="}
}

// discoverSuperuser inspects the container's process list to find the OS user
// running the PostgreSQL postmaster, which (for images that drop/rename the
// "postgres" role) is the actual bootstrap superuser. It runs as the container's
// default user (typically root) so `ps` works even when the "postgres" OS user
// is absent.
//
// Mirrors: ps -ef | grep postgres | grep -v grep | awk '{print $1}' | head -n 1
func (s *PostgresService) discoverSuperuser(ctx context.Context, cli *client.Client, containerID string) (string, error) {
	const psPipeline = `ps -ef | grep postgres | grep -v grep | awk '{print $1}' | head -n 1`

	// Empty User → the image's configured default user, which can always run ps.
	stdout, stderr, err := s.execCapture(ctx, cli, containerID, "", nil, []string{"sh", "-c", psPipeline})
	if err != nil {
		return "", fmt.Errorf("failed to inspect postgres process owner: %w (%s)", err, strings.TrimSpace(stderr))
	}

	owner := strings.TrimSpace(stdout)
	if owner == "" || !validRoleName.MatchString(owner) {
		return "", fmt.Errorf("could not determine postgres superuser from process list (got %q)", owner)
	}
	return owner, nil
}

// isMissingDefaultRole reports whether psql failed specifically because the
// default "postgres" role is absent (FATAL: role "postgres" does not exist).
// We key on this precise message rather than the broad psql exit code 2 (which
// also covers ordinary connection errors) so the ps-based fallback only triggers
// for the custom-superuser edge case.
func isMissingDefaultRole(stderr string) bool {
	l := strings.ToLower(stderr)
	return strings.Contains(l, `role "postgres" does not exist`)
}

// execCapture runs a command in a container via the Docker Exec API as osUser
// (empty → the image's default user), with optional env (e.g. PGPASSWORD), and
// returns its demultiplexed stdout and stderr. Use only for small, bounded
// output (listing/health) — large payloads should stream via CreateDump instead.
func (s *PostgresService) execCapture(ctx context.Context, cli *client.Client, containerID, osUser string, env, cmd []string) (string, string, error) {
	execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		User:         osUser,
		Env:          env,
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed to create exec: %w", err)
	}

	hijacked, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{Tty: false})
	if err != nil {
		return "", "", fmt.Errorf("failed to attach to exec: %w", err)
	}
	defer hijacked.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	if _, err := stdcopy.StdCopy(&stdoutBuf, &stderrBuf, hijacked.Reader); err != nil {
		return stdoutBuf.String(), stderrBuf.String(), err
	}

	// Surface a non-zero exit as an error so callers don't parse error text.
	inspect, err := cli.ContainerExecInspect(ctx, execResp.ID)
	if err == nil && inspect.ExitCode != 0 {
		return stdoutBuf.String(), stderrBuf.String(), fmt.Errorf("command exited with code %d", inspect.ExitCode)
	}

	return stdoutBuf.String(), stderrBuf.String(), nil
}

// validDBName guards target database names supplied by the user before they're
// passed to createdb/psql. Same identifier rule as validRoleName (letters, digits,
// underscore, hyphen; ≤63 chars). Postgres identifier limit is 63 bytes.
var validDBName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,62}$`)

// isDatabaseAlreadyExistsErr reports whether createdb failed specifically because
// the target database already exists. PostgreSQL error message format from
// createdb is: `createdb: error: database creation failed: ERROR: database "X"
// already exists`. We key on the stable phrase so we can return a meaningful
// HTTP status (409 Conflict) instead of a generic 500.
func isDatabaseAlreadyExistsErr(stderr string) bool {
	return strings.Contains(strings.ToLower(stderr), "already exists")
}

// ErrTargetDatabaseExists is returned by RestoreDatabase when the user-supplied
// targetDB already exists on the container. The caller (controller) maps this to
// a 409 Conflict response with a clear message — the user is supposed to pick a
// different name (see README §5 "Restoring with rename").
var ErrTargetDatabaseExists = fmt.Errorf("target database already exists")

// RestoreReport is what auto-detection concluded about an uploaded dump: how it is
// wrapped, which pg_dump output format it is, and which server produced it.
// It decides the restore tool (psql vs pg_restore) and is reported back to the
// caller, along with any statements the server complained about, so a restore
// says what it was actually looking at and what it skipped.
type RestoreReport struct {
	Compression   string `json:"compression"`   // none | gzip | bzip2
	Format        string `json:"format"`        // plain | custom | tar
	SourceVersion string `json:"sourceVersion"` // e.g. "17.2", "" when the dump does not say
	TargetVersion string `json:"targetVersion"` // the receiving server, filled in at restore time
	// Distinct errors the server reported while replaying the dump, each with
	// an occurrence count. Non-empty means "restored, but read these".
	Warnings []string `json:"warnings,omitempty"`
}

// errorLineRe matches the error lines psql and pg_restore write to stderr.
var errorLineRe = regexp.MustCompile(`(?m)^(?:pg_restore: )?(?:ERROR|error):\s*(.+)$`)

// collectRestoreWarnings reduces a wall of stderr to the distinct complaints
// with occurrence counts. A dump with 48 tables owned by a role the target does
// not have produces 48 identical lines; the user needs to read one.
func collectRestoreWarnings(stderr string, limit int) []string {
	counts := map[string]int{}
	var order []string
	for _, m := range errorLineRe.FindAllStringSubmatch(stderr, -1) {
		msg := strings.TrimSpace(m[1])
		if msg == "" {
			continue
		}
		if counts[msg] == 0 {
			order = append(order, msg)
		}
		counts[msg]++
	}

	var out []string
	for _, msg := range order {
		if len(out) == limit {
			out = append(out, fmt.Sprintf("…and %d more distinct error(s) — see the container logs", len(order)-limit))
			break
		}
		if counts[msg] > 1 {
			msg = fmt.Sprintf("%s (x%d)", msg, counts[msg])
		}
		out = append(out, msg)
	}
	return out
}

// setLineRe matches a top-level GUC assignment exactly as pg_dump writes it,
// e.g. `SET transaction_timeout = 0;`. Capture group 1 is the parameter name.
var setLineRe = regexp.MustCompile(`^SET\s+([A-Za-z_][A-Za-z0-9_]*)\s*=`)

// copyStdinRe matches the line that opens a COPY data block in a plain-text
// dump. Everything until the terminating `\.` is raw table data and must be
// passed through byte-for-byte — a row whose first column happens to start
// with "SET x =" is data, not a statement.
var copyStdinRe = regexp.MustCompile(`^COPY\s.*\sFROM stdin;`)

// dbScopeRe matches the statements a `pg_dump -C` or pg_dumpall dump uses to
// create and enter its ORIGINAL database. Left in place they would defeat the
// whole rename-restore contract: psql would happily run `\connect job_portal`
// and pour the dump into the live database instead of the fresh target.
var dbScopeRe = regexp.MustCompile(`^(?i:(?:CREATE|DROP|ALTER)\s+DATABASE\b|\\connect\b|\\c\s)`)

// dumpVersionRe pulls the source server version out of the comment pg_dump
// writes near the top of a plain dump: `-- Dumped from database version 17.2`.
var dumpVersionRe = regexp.MustCompile(`--\s*Dumped from database version\s+([0-9]+(?:\.[0-9]+)*)`)

// detectDump inspects the head of an uploaded dump and works out how to restore
// it, so the user can hand us whatever they downloaded without picking a format.
// The returned reader replays every byte that detection consumed, so callers
// stream from it as though nothing had been read.
//
// Compression is keyed off magic bytes rather than the filename — our own
// CreateDump serves gzip under a .sql extension, so extensions lie routinely.
func detectDump(r io.Reader) (RestoreReport, io.Reader, error) {
	var kind RestoreReport
	br := bufio.NewReaderSize(r, 64<<10)

	kind.Compression = "none"
	var body io.Reader = br
	magic, _ := br.Peek(6)
	switch {
	case len(magic) >= 2 && magic[0] == 0x1f && magic[1] == 0x8b:
		gz, err := gzip.NewReader(br)
		if err != nil {
			return kind, nil, fmt.Errorf("file looks gzip-compressed but the stream is unreadable: %w", err)
		}
		kind.Compression, body = "gzip", gz
	case len(magic) >= 3 && string(magic[:3]) == "BZh":
		kind.Compression, body = "bzip2", bzip2.NewReader(br)
	case len(magic) >= 4 && string(magic[:4]) == "\x28\xb5\x2f\xfd":
		return kind, nil, fmt.Errorf("this is a zstd-compressed dump, which this portal cannot unwrap — decompress it first (`unzstd dump.sql.zst`) and upload the .sql")
	case len(magic) >= 6 && string(magic[:6]) == "\xfd7zXZ\x00":
		return kind, nil, fmt.Errorf("this is an xz-compressed dump, which this portal cannot unwrap — decompress it first (`unxz dump.sql.xz`) and upload the .sql")
	case len(magic) >= 4 && string(magic[:4]) == "PK\x03\x04":
		return kind, nil, fmt.Errorf("this is a zip archive, not a dump — unzip it and upload the .sql or .dump inside")
	}

	// Format is decided on the decompressed bytes. A custom-format archive is
	// already compressed internally, so in practice it arrives raw.
	head := bufio.NewReaderSize(body, 64<<10)
	peek, _ := head.Peek(512)
	switch {
	case len(peek) >= 5 && string(peek[:5]) == "PGDMP":
		kind.Format = "custom"
	case len(peek) >= 262 && string(peek[257:262]) == "ustar":
		kind.Format = "tar"
	default:
		kind.Format = "plain"
		// Only a plain dump carries a readable header comment. Peek deep enough
		// to clear pg_dump's preamble without buffering the whole file.
		if hdr, _ := head.Peek(8 << 10); len(hdr) > 0 {
			if m := dumpVersionRe.FindSubmatch(hdr); m != nil {
				kind.SourceVersion = string(m[1])
			}
		}
	}
	return kind, head, nil
}

// The statement shapes pg_dump uses to hand an object to a role. A dump taken
// on a stock image says `OWNER TO postgres`, but hardened images run under a
// custom superuser and have no `postgres` role at all — psql then dies with
// `role "postgres" does not exist` partway through the restore.
var (
	ownerToRe     = regexp.MustCompile(`(?i)^ALTER\s+.*\sOWNER\s+TO\s+([^;]+);`)
	grantRe       = regexp.MustCompile(`(?i)^(?:GRANT|REVOKE)\s+.*?\s(?:TO|FROM)\s+([^;]+);`)
	defaultPrivRe = regexp.MustCompile(`(?i)^ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+([^\s;]+)`)
	sessionAuthRe = regexp.MustCompile(`(?i)^SET\s+SESSION\s+AUTHORIZATION\s+([^;]+);`)
	schemaAuthRe  = regexp.MustCompile(`(?i)^CREATE\s+SCHEMA\s+\S+\s+AUTHORIZATION\s+([^;]+);`)
	grantSuffixRe = regexp.MustCompile(`(?i)\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY\s+.*)$`)
)

// pseudoRoles are always valid targets of a GRANT and are never listed in
// pg_roles, so they must not be mistaken for a missing role.
var pseudoRoles = map[string]bool{"public": true, "current_user": true, "session_user": true, "current_role": true}

// normalizeRole strips the quoting pg_dump applies to identifiers. Unquoted
// identifiers fold to lower case in PostgreSQL; quoted ones keep their case, so
// callers check both spellings against the role set.
func normalizeRole(r string) string {
	r = strings.TrimSpace(r)
	r = strings.Trim(r, `"'`)
	return strings.TrimSpace(r)
}

// missingRoleRef reports the role an ownership or privilege statement names when
// that role does not exist on the target server, or "" when the statement is
// fine (or is not one of these forms). An empty roles set disables the check.
//
// ponytail: recognizes the one-statement-per-line forms pg_dump emits; a
// hand-wrapped GRANT would slip through. Parse the SQL if that ever shows up.
func missingRoleRef(stmt string, roles map[string]bool) string {
	if len(roles) == 0 {
		return ""
	}
	var list string
	switch {
	case ownerToRe.MatchString(stmt):
		list = ownerToRe.FindStringSubmatch(stmt)[1]
	case defaultPrivRe.MatchString(stmt):
		list = defaultPrivRe.FindStringSubmatch(stmt)[1]
	case sessionAuthRe.MatchString(stmt):
		list = sessionAuthRe.FindStringSubmatch(stmt)[1]
	case schemaAuthRe.MatchString(stmt):
		list = schemaAuthRe.FindStringSubmatch(stmt)[1]
	case grantRe.MatchString(stmt):
		list = grantSuffixRe.ReplaceAllString(grantRe.FindStringSubmatch(stmt)[1], "")
	default:
		return ""
	}

	for _, raw := range strings.Split(list, ",") {
		name := normalizeRole(raw)
		if name == "" || pseudoRoles[strings.ToLower(name)] {
			continue
		}
		if !roles[name] && !roles[strings.ToLower(name)] {
			return name
		}
	}
	return ""
}

// knownRoles returns the role names on the target server. Returns nil if the
// probe fails — callers then leave ownership statements alone rather than
// stripping them on a guess.
func (s *PostgresService) knownRoles(ctx context.Context, cli *client.Client, containerID, osUser string, env []string, role, targetDB string) map[string]bool {
	out, _, err := s.execCapture(ctx, cli, containerID, osUser, env,
		[]string{"psql", "-U", role, "-d", targetDB, "-tAc", "SELECT rolname FROM pg_roles"})
	if err != nil {
		log.Printf("restore: could not read pg_roles from %s, leaving ownership statements as-is: %v", targetDB, err)
		return nil
	}
	names := make(map[string]bool)
	for _, n := range strings.Split(out, "\n") {
		if n = strings.TrimSpace(n); n != "" {
			names[n] = true
		}
	}
	return names
}

// knownGUCs returns the set of configuration parameter names the target server
// recognizes, lowercased. Returns nil if the probe fails — callers then restore
// the dump unfiltered rather than dropping statements on a guess.
func (s *PostgresService) knownGUCs(ctx context.Context, cli *client.Client, containerID, osUser string, env []string, role, targetDB string) map[string]bool {
	out, _, err := s.execCapture(ctx, cli, containerID, osUser, env,
		[]string{"psql", "-U", role, "-d", targetDB, "-tAc", "SELECT name FROM pg_settings"})
	if err != nil {
		log.Printf("restore: could not read pg_settings from %s, streaming dump unfiltered: %v", targetDB, err)
		return nil
	}
	names := make(map[string]bool)
	for _, n := range strings.Split(out, "\n") {
		if n = strings.TrimSpace(n); n != "" {
			names[strings.ToLower(n)] = true
		}
	}
	return names
}

// serverVersion reports the target's version string ("16.3"), or "" if the
// probe fails. Cosmetic — used to explain a cross-version restore.
func (s *PostgresService) serverVersion(ctx context.Context, cli *client.Client, containerID, osUser string, env []string, role, targetDB string) string {
	out, _, err := s.execCapture(ctx, cli, containerID, osUser, env,
		[]string{"psql", "-U", role, "-d", targetDB, "-tAc", "SHOW server_version"})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.SplitN(strings.TrimSpace(out), " ", 2)[0])
}

// copyPlainDump streams a plain-text dump into psql's stdin, rewriting the two
// classes of statement that would otherwise break a rename-restore:
//
//   - `SET <guc> = ...` naming a parameter absent from known. pg_dump writes the
//     GUCs of the server it dumped FROM, so a PostgreSQL 17 dump restored into a
//     16 container aborts on `SET transaction_timeout = 0;` — psql reports
//     "unrecognized configuration parameter" and ON_ERROR_STOP=1 kills the
//     restore before a single row lands. These are dump-local safety settings,
//     so skipping the ones the target lacks restores faithfully.
//   - `CREATE/DROP/ALTER DATABASE` and `\connect`, which a `pg_dump -C` or
//     pg_dumpall dump uses to re-enter its original database. Honouring those
//     would write into a live database instead of the fresh target.
//   - ownership and privilege statements naming a role absent from roles. A dump
//     from a stock image says `OWNER TO postgres`, but a hardened image runs
//     under a custom superuser with no `postgres` role, so psql dies with
//     `role "postgres" does not exist`. Dropping them leaves the objects owned by
//     the connecting role — exactly what pg_restore --no-owner --no-privileges
//     does on the custom-format path.
//
// COPY data blocks are passed through untouched so table data that happens to
// look like a statement is never rewritten. A nil known/roles set disables that
// filter (the probe failed); database-scope statements are always dropped.
//
// ponytail: line-oriented, so it only recognizes these statements in the
// one-per-line shape pg_dump emits. A hand-edited dump wrapping `CREATE
// DATABASE` across lines would slip through; parse the SQL if that ever shows up.
func copyPlainDump(dst io.Writer, src io.Reader, known, roles map[string]bool) error {
	br := bufio.NewReader(src)
	inCopy := false
	var droppedSets, droppedScope []string
	missingRoles := map[string]int{}
	for {
		line, readErr := br.ReadString('\n')
		if line != "" {
			trimmed := strings.TrimSpace(line)
			switch {
			case inCopy:
				if trimmed == `\.` {
					inCopy = false
				}
			case copyStdinRe.MatchString(trimmed):
				inCopy = true
			case dbScopeRe.MatchString(trimmed):
				droppedScope = append(droppedScope, trimmed)
				line = ""
			default:
				if m := setLineRe.FindStringSubmatch(trimmed); m != nil && len(known) > 0 && !known[strings.ToLower(m[1])] {
					droppedSets = append(droppedSets, m[1])
					line = ""
				} else if missing := missingRoleRef(trimmed, roles); missing != "" {
					missingRoles[missing]++
					line = ""
				}
			}
		}
		if line != "" {
			if _, err := io.WriteString(dst, line); err != nil {
				return err
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return readErr
		}
	}
	if len(droppedSets) > 0 {
		log.Printf("restore: dropped %d SET statement(s) for parameters this server does not have (dump is from a newer PostgreSQL): %s",
			len(droppedSets), strings.Join(droppedSets, ", "))
	}
	if len(droppedScope) > 0 {
		log.Printf("restore: dropped %d database-scope statement(s) so the dump lands in the target database: %s",
			len(droppedScope), strings.Join(droppedScope, " | "))
	}
	for name, n := range missingRoles {
		log.Printf("restore: dropped %d ownership/privilege statement(s) for role %q, which does not exist on this server — those objects stay owned by the restoring role", n, name)
	}
	return nil
}

// RestoreDatabase creates a fresh database named targetDB inside the container
// and streams the uploaded dump into it. Everything about the dump is detected
// from its own bytes (see detectDump) rather than its filename or a user choice:
// gzip/bzip2 wrapping is unwrapped, a plain dump goes through psql and a
// custom/tar archive through pg_restore, and the source server version is read
// from the header. The RestoreReport it returns records what it concluded.
//
// Refuses if targetDB already exists: createdb errors out with "already exists"
// and we return ErrTargetDatabaseExists so the controller can return 409. This
// is the explicit fail-safe behaviour requested by the user: never silently drop
// or overwrite a live database — they must pick a new name to restore alongside.
//
// On psql failure mid-stream we deliberately leave the partially-restored DB in
// place rather than dropping it; the user can inspect/drop manually. The error
// message surfaces psql's stderr so the cause (syntax error, missing extension,
// etc.) is visible.
func (s *PostgresService) RestoreDatabase(
	ctx context.Context,
	server *models.Server,
	containerID, targetDB string,
	sqlReader io.Reader,
	creds *PostgresCreds,
) (RestoreReport, error) {
	var kind RestoreReport
	if !validDBName.MatchString(targetDB) {
		return kind, fmt.Errorf("invalid database name %q (letters, digits, underscore, hyphen only; must start with a letter or underscore; max 63 chars)", targetDB)
	}

	// Detect before touching the server: an unreadable upload should not leave
	// an empty database behind for the user to clean up.
	kind, dumpInput, err := detectDump(sqlReader)
	if err != nil {
		return kind, err
	}

	cli, err := NewDockerClient(server)
	if err != nil {
		return kind, err
	}
	defer cli.Close()

	// Same credential resolution path as CreateDump: probe with SELECT 1 and
	// reuse the first identity that connects. createdb + psql both run under it.
	role, osUser, env := s.resolveDumpExec(ctx, cli, containerID, server, creds)

	// Step 1 — create the target database. Fails fast if it already exists,
	// surfacing the "already exists" stderr as ErrTargetDatabaseExists.
	createCmd := []string{"createdb", "-U", role, targetDB}
	if _, stderr, err := s.execCapture(ctx, cli, containerID, osUser, env, createCmd); err != nil {
		if isDatabaseAlreadyExistsErr(stderr) {
			return kind, ErrTargetDatabaseExists
		}
		return kind, fmt.Errorf("createdb failed: %w (%s)", err, strings.TrimSpace(stderr))
	}

	// Step 2 — read the target's version, GUC list and role list. The version
	// explains a cross-version restore in the report; the GUC list lets a dump
	// from a newer PostgreSQL through by skipping SETs this server cannot
	// honour; the role list does the same for objects owned by a role that only
	// exists on the machine the dump came from.
	kind.TargetVersion = s.serverVersion(ctx, cli, containerID, osUser, env, role, targetDB)
	var known, roles map[string]bool
	if kind.Format == "plain" {
		known = s.knownGUCs(ctx, cli, containerID, osUser, env, role, targetDB)
		roles = s.knownRoles(ctx, cli, containerID, osUser, env, role, targetDB)
	}
	log.Printf("restore into %s: %s dump, %s-compressed, from PostgreSQL %s into %s",
		targetDB, kind.Format, kind.Compression, orUnknown(kind.SourceVersion), orUnknown(kind.TargetVersion))

	// Step 3 — pick the restore tool from the detected format. pg_restore reads
	// a custom/tar archive; psql reads plain SQL.
	//
	// Deliberately NOT ON_ERROR_STOP / --exit-on-error. A statement error in a
	// dump is usually cosmetic — an ownership grant to a role this host doesn't
	// have, a comment on a missing extension — and aborting there threw away a
	// restore whose table data was perfectly fine, leaving a half-populated
	// database behind. The errors are collected into the report instead, so the
	// data lands and the user still sees exactly what was skipped.
	cmd := []string{"psql", "-U", role, "-d", targetDB}
	if kind.Format != "plain" {
		cmd = []string{"pg_restore", "-U", role, "-d", targetDB, "--no-owner", "--no-privileges"}
	}
	execCfg := container.ExecOptions{
		User:         osUser,
		Env:          env,
		Cmd:          cmd,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
	}
	execResp, err := cli.ContainerExecCreate(ctx, containerID, execCfg)
	if err != nil {
		return kind, fmt.Errorf("failed to create %s exec: %w", cmd[0], err)
	}
	hijacked, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{Tty: false})
	if err != nil {
		return kind, fmt.Errorf("failed to attach %s exec: %w", cmd[0], err)
	}
	defer hijacked.Close()

	// Pipe the SQL into psql's stdin in a goroutine; closing stdin (CloseWrite
	// on the underlying TCP conn) tells psql we're done so it can finish the
	// transaction and exit cleanly.
	writeErrCh := make(chan error, 1)
	go func() {
		// Only a plain dump is line-oriented; a custom/tar archive is binary and
		// goes to pg_restore byte-for-byte.
		var copyErr error
		if kind.Format == "plain" {
			copyErr = copyPlainDump(hijacked.Conn, dumpInput, known, roles)
		} else {
			_, copyErr = io.Copy(hijacked.Conn, dumpInput)
		}
		if cw, ok := hijacked.Conn.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
		writeErrCh <- copyErr
	}()

	// Drain stdout + stderr while psql consumes stdin.
	var stdoutBuf, stderrBuf bytes.Buffer
	_, readErr := stdcopy.StdCopy(&stdoutBuf, &stderrBuf, hijacked.Reader)
	writeErr := <-writeErrCh

	// Check the exit code BEFORE the stream errors. When the client dies mid-dump
	// it exits while we are still writing, so the copy fails with "connection
	// reset by peer" — a symptom of the real fault, not a transport problem.
	// Reporting the write error first buried the cause. Without ON_ERROR_STOP a
	// non-zero exit now means something fatal (couldn't connect, bad invocation),
	// not a statement the dump got wrong.
	if inspect, ierr := cli.ContainerExecInspect(ctx, execResp.ID); ierr == nil && inspect.ExitCode != 0 {
		msg := strings.TrimSpace(stderrBuf.String())
		if msg == "" {
			msg = strings.TrimSpace(stdoutBuf.String())
		}
		return kind, fmt.Errorf("%s exited with code %d restoring a %s dump from PostgreSQL %s into %s (partial DB %q left in place): %s",
			cmd[0], inspect.ExitCode, kind.Format, orUnknown(kind.SourceVersion), orUnknown(kind.TargetVersion), targetDB, msg)
	}

	if writeErr != nil && writeErr != io.EOF {
		return kind, fmt.Errorf("failed to stream dump into %s: %w (%s said: %s)", cmd[0], writeErr, cmd[0], strings.TrimSpace(stderrBuf.String()))
	}
	if readErr != nil {
		return kind, fmt.Errorf("%s output stream failed: %w (%s)", cmd[0], readErr, strings.TrimSpace(stderrBuf.String()))
	}

	// The restore ran to completion. Anything the server complained about along
	// the way is reported rather than raised — the data is in.
	kind.Warnings = collectRestoreWarnings(stderrBuf.String(), 8)
	if len(kind.Warnings) > 0 {
		log.Printf("restore into %s finished with %d distinct error(s): %s",
			targetDB, len(kind.Warnings), strings.Join(kind.Warnings, " | "))
	}
	return kind, nil
}

// orUnknown keeps log lines and error messages readable when a version probe
// came back empty.
func orUnknown(v string) string {
	if v == "" {
		return "an unknown version"
	}
	return v
}

// systemDatabases can never be dropped through the portal. Postgres refuses
// template0/template1 itself, but "postgres" it would happily delete — and that
// is the maintenance database the credential chain falls back to, so losing it
// would break listing and restores on the whole container.
var systemDatabases = map[string]bool{
	"postgres":  true,
	"template0": true,
	"template1": true,
}

// ErrSystemDatabase is returned when the caller tries to drop a database the
// portal refuses to touch. Maps to 400.
var ErrSystemDatabase = fmt.Errorf("system database cannot be dropped")

// ErrDatabaseInUse is returned when PostgreSQL refuses the drop because sessions
// are still connected. Maps to 409 so the UI can say "stop the app first"
// instead of showing a raw dropdb error.
var ErrDatabaseInUse = fmt.Errorf("database has open connections")

// isDatabaseInUseErr keys on dropdb's stable refusal message:
// `dropdb: error: database removal failed: ERROR: database "x" is being
// accessed by other users`.
func isDatabaseInUseErr(stderr string) bool {
	return strings.Contains(strings.ToLower(stderr), "is being accessed by other users")
}

// DropDatabase permanently deletes a database inside a PostgreSQL container.
//
// There is no undo and no backup taken — the caller is responsible for having
// dumped anything worth keeping. Two guards stand in front of the drop:
// systemDatabases is refused outright, and we deliberately do NOT pass
// --force, so Postgres' own "being accessed by other users" check stands. A
// database an app is still connected to cannot be dropped out from under it.
//
// dropdb connects to template1 rather than the default "postgres": you cannot
// drop a database you are connected to, and "postgres" may not exist at all on
// clusters bootstrapped with POSTGRES_DB (see maintenanceDB).
func (s *PostgresService) DropDatabase(ctx context.Context, server *models.Server, containerID, dbName string, creds *PostgresCreds) error {
	if !validDBName.MatchString(dbName) {
		return fmt.Errorf("invalid database name %q (letters, digits, underscore, hyphen only; must start with a letter or underscore; max 63 chars)", dbName)
	}
	if systemDatabases[strings.ToLower(dbName)] {
		return ErrSystemDatabase
	}

	cli, err := NewDockerClient(server)
	if err != nil {
		return err
	}
	defer cli.Close()

	role, osUser, env := s.resolveDumpExec(ctx, cli, containerID, server, creds)

	cmd := []string{"dropdb", "-U", role, "--maintenance-db=" + maintenanceDB, dbName}
	if _, stderr, err := s.execCapture(ctx, cli, containerID, osUser, env, cmd); err != nil {
		if isDatabaseInUseErr(stderr) {
			return ErrDatabaseInUse
		}
		return fmt.Errorf("dropdb failed: %w (%s)", err, strings.TrimSpace(stderr))
	}
	return nil
}
