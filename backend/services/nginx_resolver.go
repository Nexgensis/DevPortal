package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

// errAgentMissing means the per-server helper container isn't deployed. Callers
// degrade gracefully (URLs fall back to IP:port) and the UI surfaces a hint.
var errAgentMissing = errors.New("webmanager-agent container not found on server")

// nginxCacheTTL bounds how stale the port→domain map can be. nginx changes are
// infrequent and re-reading hits a cheap exec, so a short TTL is fine.
const nginxCacheTTL = 60 * time.Second

// agentContainerName is the documented name in the deploy command; the label
// `webmanager.agent=true` is the preferred lookup (survives renames).
const agentContainerName = "webmanager-agent"
const agentLabel = "webmanager.agent"

// NginxResolver caches per-server port→domain maps derived from the host's nginx
// configs (read via `docker exec` into the helper agent container).
type NginxResolver struct {
	mu    sync.Mutex
	cache map[string]nginxCacheEntry // keyed by Server.ID
}

type nginxCacheEntry struct {
	portToDomain map[int]string
	fetchedAt    time.Time
}

func NewNginxResolver() *NginxResolver {
	return &NginxResolver{cache: map[string]nginxCacheEntry{}}
}

// GetDomainMap returns the port→domain map for a server, refreshing from the
// helper agent when the cache is empty or expired.
func (r *NginxResolver) GetDomainMap(ctx context.Context, cli *client.Client, server *models.Server) (map[int]string, error) {
	r.mu.Lock()
	entry, ok := r.cache[server.ID]
	r.mu.Unlock()
	if ok && time.Since(entry.fetchedAt) < nginxCacheTTL {
		return entry.portToDomain, nil
	}

	m, err := r.fetchMap(ctx, cli)
	if err != nil {
		// Cache empty maps too (e.g. agent missing) — short-circuits repeated
		// listing for the duration of the TTL.
		r.mu.Lock()
		r.cache[server.ID] = nginxCacheEntry{portToDomain: map[int]string{}, fetchedAt: time.Now()}
		r.mu.Unlock()
		return map[int]string{}, err
	}

	r.mu.Lock()
	r.cache[server.ID] = nginxCacheEntry{portToDomain: m, fetchedAt: time.Now()}
	r.mu.Unlock()
	return m, nil
}

// findAgentContainer prefers the label `webmanager.agent=true` and falls back
// to the documented container name.
func findAgentContainer(ctx context.Context, cli *client.Client) (string, error) {
	containers, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return "", err
	}
	// Pass 1: label.
	for _, c := range containers {
		if c.Labels[agentLabel] == "true" {
			return c.ID, nil
		}
	}
	// Pass 2: by name.
	for _, c := range containers {
		for _, n := range c.Names {
			if strings.TrimPrefix(n, "/") == agentContainerName {
				return c.ID, nil
			}
		}
	}
	return "", errAgentMissing
}

// fetchMap finds the agent, execs `cat /etc/nginx/conf.d/*.conf`, and parses.
func (r *NginxResolver) fetchMap(ctx context.Context, cli *client.Client) (map[int]string, error) {
	agentID, err := findAgentContainer(ctx, cli)
	if err != nil {
		return nil, err
	}

	stdout, stderr, err := execCaptureSimple(ctx, cli, agentID,
		[]string{"sh", "-c", "cat /etc/nginx/conf.d/*.conf 2>/dev/null || true"})
	if err != nil {
		return nil, fmt.Errorf("read nginx configs via agent: %w (%s)", err, strings.TrimSpace(stderr))
	}
	return parseNginxConfs(stdout), nil
}

// execCaptureSimple runs a command in a container and returns its demultiplexed
// stdout/stderr. Mirrors the pattern in postgres_service.go's execCapture but
// without the OS-user / env knobs (we always exec as the agent's default user).
func execCaptureSimple(ctx context.Context, cli *client.Client, containerID string, cmd []string) (string, string, error) {
	exec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
	})
	if err != nil {
		return "", "", err
	}
	hijack, err := cli.ContainerExecAttach(ctx, exec.ID, container.ExecAttachOptions{Tty: false})
	if err != nil {
		return "", "", err
	}
	defer hijack.Close()

	var outBuf, errBuf bytes.Buffer
	if _, err := stdcopy.StdCopy(&outBuf, &errBuf, hijack.Reader); err != nil {
		return outBuf.String(), errBuf.String(), err
	}
	return outBuf.String(), errBuf.String(), nil
}

// --- Parser ---
//
// V1 is deliberately simple: walk `server { ... }` blocks, take the first
// `server_name <name>;` (skip wildcards / regex names), and the first explicit
// `proxy_pass http(s)?://host:<port>...` whose port is an integer literal. Build
// port→domain. `proxy_pass http://<upstream>` (named upstream blocks) is V2.

var (
	reServerName = regexp.MustCompile(`(?m)^\s*server_name\s+([^;]+);`)
	reProxyPass  = regexp.MustCompile(`(?m)proxy_pass\s+https?://[^:\s/]+:(\d+)(?:/[^\s;]*)?\s*;`)
	reBadName    = regexp.MustCompile(`[*~]`) // wildcard / regex server_name → skip
)

// extractServerBlocks returns the contents of each top-level `server { ... }`
// block from an nginx-config text. Brace matching only — comments inside strings
// aren't a concern in practice for nginx configs.
func extractServerBlocks(s string) []string {
	var out []string
	for {
		idx := strings.Index(s, "server")
		if idx == -1 {
			return out
		}
		// Skip if not a standalone keyword (e.g. `server_name`, `upstream`).
		after := idx + len("server")
		if after >= len(s) {
			return out
		}
		nextNonSpace := after
		for nextNonSpace < len(s) && (s[nextNonSpace] == ' ' || s[nextNonSpace] == '\t' || s[nextNonSpace] == '\n' || s[nextNonSpace] == '\r') {
			nextNonSpace++
		}
		if nextNonSpace >= len(s) || s[nextNonSpace] != '{' {
			s = s[after:]
			continue
		}
		// Walk until the matching closing brace, tracking depth.
		depth := 0
		end := -1
		for i := nextNonSpace; i < len(s); i++ {
			switch s[i] {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					end = i
				}
			}
			if end != -1 {
				break
			}
		}
		if end == -1 {
			return out
		}
		out = append(out, s[nextNonSpace+1:end])
		s = s[end+1:]
	}
}

func parseNginxConfs(text string) map[int]string {
	result := map[int]string{}
	for _, block := range extractServerBlocks(text) {
		// First server_name (skip wildcards/regex names).
		nameMatch := reServerName.FindStringSubmatch(block)
		if nameMatch == nil {
			continue
		}
		domain := strings.Fields(nameMatch[1])
		if len(domain) == 0 {
			continue
		}
		name := strings.TrimSpace(domain[0])
		if name == "" || name == "_" || reBadName.MatchString(name) {
			continue
		}
		// First explicit proxy_pass with a numeric port.
		portMatch := reProxyPass.FindStringSubmatch(block)
		if portMatch == nil {
			continue
		}
		port, err := strconv.Atoi(portMatch[1])
		if err != nil || port <= 0 {
			continue
		}
		// First server_name wins per port (don't overwrite if multiple vhosts
		// proxy to the same backend port — unusual but possible).
		if _, exists := result[port]; !exists {
			result[port] = name
		}
	}
	return result
}
