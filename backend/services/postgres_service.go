package services

import (
	"bytes"
	"context"
	"fmt"
	"io"
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
