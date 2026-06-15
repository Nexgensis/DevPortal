package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
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
	ActiveDatabases []string           `json:"activeDatabases"` // union of every consumer's discovered DBs
	AgentMissing    bool               `json:"agentMissing"`    // mirrors RunningApps — hides the domain column
}

// PostgresContextService is the long-lived discovery helper. Reuses the same
// NginxResolver cache as RunningApps so callers share the port→domain lookup.
type PostgresContextService struct {
	nginx *NginxResolver
}

func NewPostgresContextService() *PostgresContextService {
	return &PostgresContextService{nginx: NewNginxResolver()}
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
func (s *PostgresContextService) GetContainerContext(ctx context.Context, server *models.Server, containerID string) (*PostgresContainerContext, error) {
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

	// Active-DB detection sources, in priority order (a lower source is only used
	// when the higher ones yield nothing, so a stale value never wins):
	//   1. Infisical (PRIMARY) — the fleet stores the real DATABASE_URL in
	//      Infisical, so the app containers expose only INFISICAL_* bootstrap
	//      vars. We read those, call the Infisical API, and parse the DB from the
	//      secret. Resolved below, after we've scanned the consumers.
	//   2. The postgres container's own POSTGRES_DB / DATABASE_URL (compose
	//      plaintext) — reliable when set fresh, but can be a stale init value.
	//   3. The app containers' own env (legacy / non-Infisical projects).
	composeSet := map[string]bool{}
	if pg.Config != nil {
		if selfDBs, _ := extractDatabases(pg.Config.Env); len(selfDBs) > 0 {
			for _, d := range selfDBs {
				composeSet[d] = true
			}
		}
	}

	envSet := map[string]bool{}
	var infisicalCfg *infisicalConfig // captured from the first app container that has it

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
			// Capture the Infisical bootstrap config (first match wins) so we can
			// resolve the real connection string from the secret store below.
			if infisicalCfg == nil {
				if cfg := parseInfisicalConfig(details.Config.Env); cfg != nil {
					cfg.consumerIdx = len(out.Consumers) // index this cons will land at
					infisicalCfg = cfg
				}
			}
		}
		out.Consumers = append(out.Consumers, cons)
	}

	// PRIMARY source: resolve the active DB from Infisical when the app containers
	// are wired to it. Best-effort — any failure (unreachable, auth, parse) just
	// falls through to the compose/env sources below.
	var infisicalDBs []string
	if infisicalCfg != nil {
		secrets, ferr := fetchInfisicalSecrets(ctx, infisicalCfg)
		if ferr == nil {
			infisicalDBs, _ = extractDatabases(secrets)
			log.Printf("[pg-context] project=%q infisical: fetched %d secrets, resolved DBs=%v (env=%q)",
				project, len(secrets), infisicalDBs, infisicalCfg.env)
		} else {
			log.Printf("[pg-context] project=%q infisical fetch FAILED: %v (env=%q api=%q projectId_present=%t)",
				project, ferr, infisicalCfg.env, infisicalCfg.apiURL, infisicalCfg.projectID != "")
		}
	} else {
		log.Printf("[pg-context] project=%q: no INFISICAL_* bootstrap vars found on any app container", project)
	}

	switch {
	case len(infisicalDBs) > 0:
		for _, d := range infisicalDBs {
			activeSet[d] = true
		}
		// Attribute the resolved DB to the app container that owns the Infisical
		// config, so its "Used by" row shows it (its own Docker env had nothing).
		if infisicalCfg.consumerIdx >= 0 && infisicalCfg.consumerIdx < len(out.Consumers) {
			out.Consumers[infisicalCfg.consumerIdx].Databases = infisicalDBs
			out.Consumers[infisicalCfg.consumerIdx].EnvSource = "infisical"
		}
	case len(composeSet) > 0:
		for d := range composeSet {
			activeSet[d] = true
		}
	default:
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
	log.Printf("[pg-context] project=%q resolved ActiveDatabases=%v (compose=%d env=%d infisical=%d consumers=%d)",
		project, out.ActiveDatabases, len(composeSet), len(envSet), len(infisicalDBs), len(out.Consumers))

	return out, nil
}

// infisicalConfig is the bootstrap info an app container carries so it can pull
// its secrets from Infisical at runtime. Compose interpolates these from the
// host .env at deploy time, so they ARE present in `docker inspect`'s env (only
// the resolved secrets themselves live in Infisical, not these).
type infisicalConfig struct {
	apiURL      string
	token       string
	projectID   string
	env         string
	consumerIdx int // index of the consumer we read this from (for attribution)
}

// parseInfisicalConfig pulls the INFISICAL_* bootstrap vars out of a container's
// env slice. Returns nil unless at least a token + project id are present (the
// minimum needed to call the API).
func parseInfisicalConfig(env []string) *infisicalConfig {
	m := map[string]string{}
	for _, e := range env {
		if eq := strings.IndexByte(e, '='); eq > 0 {
			m[e[:eq]] = strings.TrimSpace(e[eq+1:])
		}
	}
	token, project := m["INFISICAL_TOKEN"], m["INFISICAL_PROJECT_ID"]
	if token == "" || project == "" {
		return nil
	}
	return &infisicalConfig{
		apiURL:      m["INFISICAL_API_URL"],
		token:       token,
		projectID:   project,
		env:         m["INFISICAL_ENV"],
		consumerIdx: -1,
	}
}

// fetchInfisicalSecrets calls the Infisical API and returns its secrets as a
// `KEY=VALUE` slice — the same shape extractDatabases() already consumes, so the
// DB name is parsed from DATABASE_URL/POSTGRES_DB exactly like a container env.
// Best-effort with a short timeout: the frontend waits on the context call, so
// an unreachable Infisical must fail fast and fall through to other sources.
func fetchInfisicalSecrets(ctx context.Context, cfg *infisicalConfig) ([]string, error) {
	base := strings.TrimRight(cfg.apiURL, "/")
	if base == "" {
		base = "https://app.infisical.com"
	}
	environment := cfg.env
	if environment == "" {
		environment = "prod"
	}
	// recursive=true sweeps subfolders; include_imports=true returns secrets that
	// the environment imports from other folders/environments (Infisical returns
	// those in a separate `imports[]` array, not the top-level `secrets[]`). The
	// `infisical run` the apps use injects all of these, so we must too — fetching
	// only root-level `secrets` is exactly how we ended up with 0.
	endpoint := fmt.Sprintf("%s/api/v3/secrets/raw?workspaceId=%s&environment=%s&secretPath=%s&recursive=true&include_imports=true",
		base, url.QueryEscape(cfg.projectID), url.QueryEscape(environment), url.QueryEscape("/"))

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.token)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("infisical: unexpected status %d", resp.StatusCode)
	}

	type kv struct {
		SecretKey   string `json:"secretKey"`
		SecretValue string `json:"secretValue"`
	}
	var body struct {
		Secrets []kv `json:"secrets"`
		Imports []struct {
			Secrets []kv `json:"secrets"`
		} `json:"imports"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(body.Secrets))
	for _, s := range body.Secrets {
		out = append(out, s.SecretKey+"="+s.SecretValue)
	}
	for _, imp := range body.Imports {
		for _, s := range imp.Secrets {
			out = append(out, s.SecretKey+"="+s.SecretValue)
		}
	}
	return out, nil
}
