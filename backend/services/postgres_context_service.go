package services

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

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
		for _, key := range dbNameEnvKeys {
			if upper == key {
				if !seen[v] {
					dbs = append(dbs, v)
					seen[v] = true
				}
				srcKeys = append(srcKeys, k)
				break
			}
		}
		for _, key := range dbURLEnvKeys {
			if upper == key {
				name := parseDBURL(v)
				if name != "" && !seen[name] {
					dbs = append(dbs, name)
					seen[name] = true
					srcKeys = append(srcKeys, k)
				}
				break
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
				activeSet[d] = true
			}
		}
		out.Consumers = append(out.Consumers, cons)
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

	return out, nil
}
