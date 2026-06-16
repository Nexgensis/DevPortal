package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

// Fleet-wide live resource insights — top CPU / RAM consumers and per-server
// load across every online server. CPU% can't be read from a single Docker
// stats sample (you need a delta), so we stream two frames per container; at
// fleet scale that's slow, hence the cache + background refresh below.
const (
	fleetCacheTTL        = 60 * time.Second
	fleetTopN            = 5
	fleetStatConcurrency = 16
	fleetGatherTimeout   = 120 * time.Second
	fleetPerStatTimeout  = 8 * time.Second
)

// ContainerResource is one container's live usage, tagged with its server.
type ContainerResource struct {
	Name     string  `json:"name"`
	Server   string  `json:"server"`
	CPUPct   float64 `json:"cpuPct"`
	MemBytes uint64  `json:"memBytes"`
	MemLimit uint64  `json:"memLimit"`
}

// ServerLoad is the aggregate load contributed by a single server.
type ServerLoad struct {
	Server     string  `json:"server"`
	Online     bool    `json:"online"`
	Containers int     `json:"containers"`
	CPUPct     float64 `json:"cpuPct"`
	MemBytes   uint64  `json:"memBytes"`
}

// FleetResources is the payload the dashboard renders. Computing=true means the
// first gather is still running and the client should poll until it clears.
type FleetResources struct {
	Computing   bool                `json:"computing"`
	GeneratedAt string              `json:"generatedAt"`
	Containers  int                 `json:"containers"`
	TotalCPU    float64             `json:"totalCpu"`
	TotalMem    uint64              `json:"totalMem"`
	TopCPU      []ContainerResource `json:"topCpu"`
	TopMem      []ContainerResource `json:"topMem"`
	Servers     []ServerLoad        `json:"servers"`
}

// FleetStatsService holds the shared cache. It MUST be a singleton so the cache
// survives across requests (controllers otherwise build a fresh service each
// call) — NewFleetStatsService returns the package-level instance.
type FleetStatsService struct {
	mu         sync.Mutex
	cached     *FleetResources
	fetchedAt  time.Time
	refreshing bool
}

var fleetStatsSingleton = &FleetStatsService{}

func NewFleetStatsService() *FleetStatsService { return fleetStatsSingleton }

// GetResources returns the cached fleet snapshot immediately and refreshes in
// the background when stale, so a request never blocks on the ~15-30s gather.
// The first ever call (cold cache) returns Computing=true; the client polls.
func (s *FleetStatsService) GetResources(servers []*models.Server) FleetResources {
	s.mu.Lock()
	defer s.mu.Unlock()

	stale := s.cached == nil || time.Since(s.fetchedAt) >= fleetCacheTTL
	if stale && !s.refreshing {
		s.refreshing = true
		go s.refresh(servers)
	}

	if s.cached != nil {
		return *s.cached // serve cached (possibly stale) — a refresh is already queued
	}
	// Cold: nothing yet. Tell the client we're computing so it polls.
	return FleetResources{
		Computing: true,
		TopCPU:    []ContainerResource{},
		TopMem:    []ContainerResource{},
		Servers:   []ServerLoad{},
	}
}

// refresh runs the heavy gather on a detached context (the triggering request
// may be long gone) and swaps the result into the cache.
func (s *FleetStatsService) refresh(servers []*models.Server) {
	defer func() {
		s.mu.Lock()
		s.refreshing = false
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), fleetGatherTimeout)
	defer cancel()

	res := gatherFleet(ctx, servers)

	s.mu.Lock()
	s.cached = res
	s.fetchedAt = time.Now()
	s.mu.Unlock()
	log.Printf("[fleet] refreshed: %d containers across %d servers (%.0f%% CPU, %s RAM)",
		res.Containers, len(res.Servers), res.TotalCPU, humanBytes(res.TotalMem))
}

// gatherFleet collects live stats from every online server.
func gatherFleet(ctx context.Context, servers []*models.Server) *FleetResources {
	out := &FleetResources{
		TopCPU:  []ContainerResource{},
		TopMem:  []ContainerResource{},
		Servers: []ServerLoad{},
	}
	var all []ContainerResource

	for _, srv := range servers {
		load := ServerLoad{Server: srv.Name, Online: srv.Status == "online"}
		if srv.Status != "online" {
			out.Servers = append(out.Servers, load)
			continue
		}
		cli, err := NewDockerClient(srv)
		if err != nil {
			out.Servers = append(out.Servers, load)
			continue
		}
		list, err := cli.ContainerList(ctx, container.ListOptions{})
		if err != nil {
			cli.Close()
			out.Servers = append(out.Servers, load)
			continue
		}

		// Sample every running container concurrently (bounded), so a server
		// with 100 containers takes ~ceil(100/16) sampling windows, not 100.
		sem := make(chan struct{}, fleetStatConcurrency)
		var wg sync.WaitGroup
		var mu sync.Mutex
		resources := make([]ContainerResource, 0, len(list))
		for i := range list {
			id := list[i].ID
			name := "?"
			if len(list[i].Names) > 0 {
				name = strings.TrimPrefix(list[i].Names[0], "/")
			}
			wg.Add(1)
			go func(id, name string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				cpu, mem, lim, ok := containerStat(ctx, cli, id)
				if !ok {
					return
				}
				mu.Lock()
				resources = append(resources, ContainerResource{
					Name: name, Server: srv.Name, CPUPct: cpu, MemBytes: mem, MemLimit: lim,
				})
				mu.Unlock()
			}(id, name)
		}
		wg.Wait()
		cli.Close()

		for _, r := range resources {
			load.Containers++
			load.CPUPct += r.CPUPct
			load.MemBytes += r.MemBytes
			all = append(all, r)
		}
		out.Servers = append(out.Servers, load)
	}

	for _, r := range all {
		out.Containers++
		out.TotalCPU += r.CPUPct
		out.TotalMem += r.MemBytes
	}

	// Top RAM, then top CPU. Clone the slice headers so the two top-lists don't
	// alias the same backing array after the second sort.
	sort.Slice(all, func(i, j int) bool { return all[i].MemBytes > all[j].MemBytes })
	out.TopMem = cloneTop(all, fleetTopN)
	sort.Slice(all, func(i, j int) bool { return all[i].CPUPct > all[j].CPUPct })
	out.TopCPU = cloneTop(all, fleetTopN)

	out.GeneratedAt = time.Now().Format(time.RFC3339)
	return out
}

// containerStat streams two stats frames for one container and returns its CPU%
// and working-set memory. Two frames are required because CPU% is a delta of
// consecutive samples (the first frame's PreCPUStats is zero). Bounded by a
// per-container timeout so one stuck container can't stall the gather.
func containerStat(ctx context.Context, cli *client.Client, id string) (cpuPct float64, mem uint64, limit uint64, ok bool) {
	cctx, cancel := context.WithTimeout(ctx, fleetPerStatTimeout)
	defer cancel()

	resp, err := cli.ContainerStats(cctx, id, true) // stream=true → second frame has a valid delta
	if err != nil {
		return
	}
	defer resp.Body.Close()

	dec := json.NewDecoder(resp.Body)
	var v container.StatsResponse
	frames := 0
	for frames < 2 {
		if derr := dec.Decode(&v); derr != nil {
			break
		}
		frames++
	}
	if frames == 0 {
		return
	}

	// CPU% — Docker's own formula: cpu delta / system delta * online CPUs.
	cpuDelta := float64(v.CPUStats.CPUUsage.TotalUsage) - float64(v.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(v.CPUStats.SystemUsage) - float64(v.PreCPUStats.SystemUsage)
	cpus := float64(v.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(v.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpus == 0 {
		cpus = 1
	}
	if sysDelta > 0 && cpuDelta > 0 {
		cpuPct = (cpuDelta / sysDelta) * cpus * 100
	}

	// Working-set memory ≈ usage − inactive file cache (matches `docker stats`).
	mem = v.MemoryStats.Usage
	if inactive, has := v.MemoryStats.Stats["inactive_file"]; has && inactive <= mem {
		mem -= inactive
	} else if inactive, has := v.MemoryStats.Stats["total_inactive_file"]; has && inactive <= mem {
		mem -= inactive
	}
	limit = v.MemoryStats.Limit
	ok = true
	return
}

func cloneTop(rs []ContainerResource, n int) []ContainerResource {
	if n > len(rs) {
		n = len(rs)
	}
	out := make([]ContainerResource, n)
	copy(out, rs[:n])
	return out
}

// humanBytes — short label for log output only.
func humanBytes(n uint64) string {
	f := float64(n)
	units := []string{"B", "KB", "MB", "GB", "TB"}
	i := 0
	for f >= 1024 && i < len(units)-1 {
		f /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %s", f, units[i])
}
