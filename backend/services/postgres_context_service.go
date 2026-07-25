package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"backend/models"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

// PostgresConsumer is a non-postgres sibling container in the same compose
// project as the postgres container — i.e. the app server / frontend that
// most likely connects to it. Databases is the set of DB names we could infer
// from the consumer's env vars; EnvSource lists which env keys matched (for
// surface-level transparency about how the guess was made).
type PostgresConsumer struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Image     string   `json:"image"`
	Kind      string   `json:"kind"`              // "frontend" | "backend" | "service"
	Ports     []int    `json:"ports"`
	Domain    string   `json:"domain,omitempty"`
	Databases []string `json:"databases"`         // candidate DB names from env vars
	EnvSource string   `json:"envSource,omitempty"` // comma-separated env keys that matched
}

// PostgresContainerContext bundles everything the UI needs to explain "what is
// this postgres container used by?". HasProject=false when the container isn't
// compose-managed (Consumers/ActiveDatabases will be empty).
type PostgresContainerContext struct {
	HasProject      bool               `json:"hasProject"`
	Project         string             `json:"project,omitempty"`
	WorkingDir      string             `json:"workingDir,omitempty"`
	Consumers       []PostgresConsumer `json:"consumers"`
	ActiveDatabases []string           `json:"activeDatabases"` // databases actually in use
	AgentMissing    bool               `json:"agentMissing"`    // mirrors RunningApps — hides the domain column
	// ActiveSource records how ActiveDatabases was determined: "pg_stat" (the
	// server's own connection stats), "compose" or "env" (configured values,
	// used only when the server reports nothing), or "" when nothing resolved.
	ActiveSource string `json:"activeSource,omitempty"`
	// Activity is the per-database connection/transaction breakdown behind the
	// "pg_stat" answer. Empty when the stats query could not run.
	Activity []DatabaseActivity `json:"activity,omitempty"`
}

// PostgresContextService is the long-lived discovery helper. Reuses the same
// NginxResolver cache as RunningApps so callers share the port→domain lookup,
// and the PostgresService exec/credential chain to query the server itself.
type PostgresContextService struct {
	nginx *NginxResolver
	pg    *PostgresService
}

func NewPostgresContextService() *PostgresContextService {
	return &PostgresContextService{nginx: NewNginxResolver(), pg: NewPostgresService()}
}

// DatabaseActivity is one database's live usage, straight from the server's own
// statistics views.
type DatabaseActivity struct {
	Name     string `json:"name"`
	Backends int    `json:"backends"` // connections open right now
	Txns     int64  `json:"txns"`     // commits + rollbacks since the last stats reset
}

// activeDBQuery asks PostgreSQL which of its databases are actually in use.
//
// This replaced an inference chain that read POSTGRES_DB / DATABASE_URL out of
// container environments and, when the fleet moved its connection strings into
// Infisical, an Infisical API client on top of that. All of it broke the moment
// credentials moved again — to file-based Docker secrets, which never appear in
// `docker inspect` at all.
//
// pg_stat_database is ground truth and needs no credentials beyond the exec we
// already have: numbackends counts connections open right now, and the
// transaction counters identify the database that has been used even while the
// stack is idle. Template and maintenance databases are excluded because they
// are never the answer.
const activeDBQuery = `SELECT datname, numbackends, xact_commit + xact_rollback ` +
	`FROM pg_stat_database ` +
	`WHERE datname IS NOT NULL AND datname NOT IN ('postgres','template0','template1') ` +
	`ORDER BY numbackends DESC, 3 DESC;`

// parseActivityRows reads the pipe-separated psql output of activeDBQuery.
func parseActivityRows(out string) []DatabaseActivity {
	var rows []DatabaseActivity
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Split(strings.TrimSpace(line), "|")
		if len(parts) < 3 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "" {
			continue
		}
		backends, _ := strconv.Atoi(strings.TrimSpace(parts[1]))
		txns, _ := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
		rows = append(rows, DatabaseActivity{Name: name, Backends: backends, Txns: txns})
	}
	return rows
}

// pickActive turns the raw stats into the set to mark live.
//
// Any database with an open connection is in use — with pgbouncer in front the
// pool holds those open, so this stays populated while the app is quiet. If
// nothing is connected at all (whole stack stopped), fall back to the single
// most-transacted database rather than listing every database ever touched.
func pickActive(rows []DatabaseActivity) []string {
	var connected []string
	for _, r := range rows {
		if r.Backends > 0 {
			connected = append(connected, r.Name)
		}
	}
	if len(connected) > 0 {
		return connected
	}
	best := ""
	var bestTxns int64
	for _, r := range rows {
		if r.Txns > bestTxns {
			best, bestTxns = r.Name, r.Txns
		}
	}
	if best != "" {
		return []string{best}
	}
	return nil
}

// queryActivity runs activeDBQuery inside the container over the existing
// credential chain. Best-effort: any failure returns nil and the caller falls
// back to the configured-value sources.
func (s *PostgresContextService) queryActivity(ctx context.Context, cli *client.Client, containerID string, server *models.Server, creds *PostgresCreds) []DatabaseActivity {
	cmdFor := func(role, dbName string) []string {
		cmd := []string{"psql", "-U", role}
		if dbName != "" {
			cmd = append(cmd, "-d", dbName)
		}
		return append(cmd, "-t", "-A", "-F", "|", "-c", activeDBQuery)
	}
	out, stderr, err := s.pg.runAcrossCreds(ctx, cli, containerID, server, creds, cmdFor)
	if err != nil {
		log.Printf("[pg-context] pg_stat_database query failed: %v (%s)", err, strings.TrimSpace(stderr))
		return nil
	}
	return parseActivityRows(out)
}

// Heuristic env-var keys for the active-DB inference. Standard set only — apps
// in this fleet consistently use one of these; widen the set only if real
// containers start slipping through with no match.
var (
	dbNameEnvKeys = []string{"POSTGRES_DB", "POSTGRES_DATABASE", "DB_NAME", "DATABASE_NAME", "PGDATABASE"}
	dbURLEnvKeys  = []string{"DATABASE_URL", "DB_DSN", "DB_URL", "POSTGRES_URL", "PG_URL", "POSTGRES_DSN"}
)

// classifyKind maps a container's name suffix to a coarse role. The fleet's
// naming convention is `<project>-<role>` (e.g. `bmr-frontend`, `bmr-backend`)
// so suffix matching is reliable enough for V1.
func classifyKind(name string) string {
	n := strings.ToLower(name)
	frontendSuffixes := []string{"-frontend", "-web", "-ui", "-client", "-webapp", "-fe"}
	backendSuffixes := []string{"-backend", "-api", "-server", "-service", "-svc", "-be", "-app"}
	for _, s := range frontendSuffixes {
		if strings.HasSuffix(n, s) {
			return "frontend"
		}
	}
	for _, s := range backendSuffixes {
		if strings.HasSuffix(n, s) {
			return "backend"
		}
	}
	return "service"
}

// isPostgresImage skips sibling postgres containers when computing consumers.
// Coarse on purpose — a custom-named postgres image will slip through and show
// up as a consumer with no DB info, which is acceptable for V1.
func isPostgresImage(image string) bool {
	s := strings.ToLower(image)
	return strings.Contains(s, "postgres") || strings.Contains(s, "timescaledb") || strings.Contains(s, "pgvector")
}

// parseDBURL extracts the DB name from a connection URL like
// "postgres://user:pass@host:5432/dbname?sslmode=disable". Returns "" if the
// URL doesn't parse or has no path segment.
func parseDBURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	path := strings.TrimPrefix(u.Path, "/")
	if i := strings.IndexByte(path, '/'); i >= 0 {
		path = path[:i]
	}
	return strings.TrimSpace(path)
}

// extractDatabases scans `KEY=VALUE` env slices for the standard postgres-DB
// signals and returns the unique candidate set (preserving discovery order)
// plus the comma-joined env keys that produced them.
func extractDatabases(env []string) (dbs []string, src string) {
	seen := map[string]bool{}
	srcKeys := []string{}
	for _, e := range env {
		eq := strings.IndexByte(e, '=')
		if eq <= 0 {
			continue
		}
		k, v := e[:eq], strings.TrimSpace(e[eq+1:])
		if v == "" {
			continue
		}
		upper := strings.ToUpper(k)

		// 1) Explicit DB-name keys (exact match) — the value IS the DB name.
		matched := false
		for _, key := range dbNameEnvKeys {
			if upper == key {
				if !seen[v] {
					dbs = append(dbs, v)
					seen[v] = true
				}
				srcKeys = append(srcKeys, k)
				matched = true
				break
			}
		}
		if matched {
			continue
		}

		// 2) Explicit URL keys OR any value that looks like a postgres
		// connection URL. The value-based check is key-agnostic, so custom
		// names (SQLALCHEMY_DATABASE_URI, <APP>_DATABASE_URL, …) still resolve.
		isURLKey := false
		for _, key := range dbURLEnvKeys {
			if upper == key {
				isURLKey = true
				break
			}
		}
		low := strings.ToLower(v)
		looksLikeURL := strings.HasPrefix(low, "postgres://") || strings.HasPrefix(low, "postgresql://")
		if isURLKey || looksLikeURL {
			if name := parseDBURL(v); name != "" && !seen[name] {
				dbs = append(dbs, name)
				seen[name] = true
				srcKeys = append(srcKeys, k)
			}
		}
	}
	// Dedup the source keys while preserving order so the UI can show
	// "DATABASE_URL, POSTGRES_DB" without repeats.
	if len(srcKeys) > 0 {
		usk := map[string]bool{}
		ordered := []string{}
		for _, k := range srcKeys {
			if !usk[k] {
				usk[k] = true
				ordered = append(ordered, k)
			}
		}
		src = strings.Join(ordered, ",")
	}
	return dbs, src
}

// GetContainerContext returns project + consumer + active-DB info for one
// postgres container. Best-effort throughout: a missing nginx agent or a per-
// container inspect failure degrades gracefully rather than failing the call.
func (s *PostgresContextService) GetContainerContext(ctx context.Context, server *models.Server, containerID string, creds *PostgresCreds) (*PostgresContainerContext, error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	pg, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("inspect container: %w", err)
	}
	project := ""
	workingDir := ""
	if pg.Config != nil && pg.Config.Labels != nil {
		project = pg.Config.Labels["com.docker.compose.project"]
		workingDir = pg.Config.Labels["com.docker.compose.project.working_dir"]
	}

	out := &PostgresContainerContext{
		HasProject:      project != "",
		Project:         project,
		WorkingDir:      workingDir,
		Consumers:       []PostgresConsumer{},
		ActiveDatabases: []string{},
	}
	if project == "" {
		// Container isn't compose-managed (manual `docker run`, ad-hoc, etc.) —
		// nothing to correlate. UI hides the strip entirely on this empty shape.
		return out, nil
	}

	listed, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	// Best-effort domain resolution — same path as RunningApps so the cache
	// is shared. errAgentMissing is non-fatal; we just won't have domains.
	var domainMap map[int]string
	if m, derr := s.nginx.GetDomainMap(ctx, cli, server); derr == nil {
		domainMap = m
	} else if errors.Is(derr, errAgentMissing) {
		out.AgentMissing = true
	}

	activeSet := map[string]bool{}

	// Active-DB detection, in priority order:
	//   1. PRIMARY — pg_stat_database, i.e. ask the server what is connected.
	//      Works regardless of where credentials live (env, file secrets,
	//      Infisical, Vault) because it needs none of them.
	//   2. The postgres container's own POSTGRES_DB / DATABASE_URL, and the app
	//      containers' env. These describe what was *configured*, which can be
	//      stale, so they are only a fallback — and a useful cross-check when
	//      they disagree with what is actually connected.
	composeSet := map[string]bool{}
	if pg.Config != nil {
		if selfDBs, _ := extractDatabases(pg.Config.Env); len(selfDBs) > 0 {
			for _, d := range selfDBs {
				composeSet[d] = true
			}
		}
	}

	envSet := map[string]bool{}

	for _, c := range listed {
		if c.ID == containerID {
			continue
		}
		if c.Labels["com.docker.compose.project"] != project {
			continue
		}
		if isPostgresImage(c.Image) {
			continue
		}
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		cons := PostgresConsumer{
			ID:        c.ID,
			Name:      name,
			Image:     c.Image,
			Kind:      classifyKind(name),
			Databases: []string{},
		}
		seenPort := map[int]bool{}
		for _, p := range c.Ports {
			if p.PublicPort == 0 || seenPort[int(p.PublicPort)] {
				continue
			}
			seenPort[int(p.PublicPort)] = true
			cons.Ports = append(cons.Ports, int(p.PublicPort))
		}
		sort.Ints(cons.Ports)
		// First published port that has a domain match wins — fronted apps
		// usually have exactly one published port that nginx fronts.
		for _, port := range cons.Ports {
			if d, ok := domainMap[port]; ok {
				cons.Domain = d
				break
			}
		}
		// Env scan via a per-container inspect (the list response doesn't
		// include env). Failures are silent — domain/port info is still
		// useful even without the DB hint.
		if details, ierr := cli.ContainerInspect(ctx, c.ID); ierr == nil && details.Config != nil {
			dbs, src := extractDatabases(details.Config.Env)
			cons.Databases = dbs
			cons.EnvSource = src
			for _, d := range dbs {
				envSet[d] = true
			}
		}
		out.Consumers = append(out.Consumers, cons)
	}

	// PRIMARY source: ask the server itself which databases have connections.
	// No app-side credential is involved, so this is unaffected by connection
	// strings moving between env vars, file secrets and Infisical.
	activity := s.queryActivity(ctx, cli, containerID, server, creds)
	out.Activity = activity
	statDBs := pickActive(activity)

	switch {
	case len(statDBs) > 0:
		out.ActiveSource = "pg_stat"
		for _, d := range statDBs {
			activeSet[d] = true
		}
	case len(composeSet) > 0:
		out.ActiveSource = "compose"
		for d := range composeSet {
			activeSet[d] = true
		}
	default:
		if len(envSet) > 0 {
			out.ActiveSource = "env"
		}
		for d := range envSet {
			activeSet[d] = true
		}
	}

	// Backend first (most likely to expose DB info), then frontend, then other.
	kindOrder := map[string]int{"backend": 0, "frontend": 1, "service": 2}
	sort.SliceStable(out.Consumers, func(i, j int) bool {
		if kindOrder[out.Consumers[i].Kind] != kindOrder[out.Consumers[j].Kind] {
			return kindOrder[out.Consumers[i].Kind] < kindOrder[out.Consumers[j].Kind]
		}
		return out.Consumers[i].Name < out.Consumers[j].Name
	})
	for d := range activeSet {
		out.ActiveDatabases = append(out.ActiveDatabases, d)
	}
	sort.Strings(out.ActiveDatabases)

	// One line that tells us, per request, exactly which source won and what got
	// marked Live — the quickest way to debug a container that won't light up.
	log.Printf("[pg-context] project=%q resolved ActiveDatabases=%v via %q (stat_rows=%d compose=%d env=%d consumers=%d)",
		project, out.ActiveDatabases, out.ActiveSource, len(activity), len(composeSet), len(envSet), len(out.Consumers))

	return out, nil
}
