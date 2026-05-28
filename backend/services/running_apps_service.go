package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"backend/models"

	"github.com/docker/docker/api/types/container"
	"gorm.io/gorm"
)

// ContainerURL is one published port of a container, resolved to either a domain
// URL (when the host nginx fronts it) or a plain IP:port URL.
type ContainerURL struct {
	PublicPort int    `json:"publicPort"`
	URL        string `json:"url"`
	Domain     string `json:"domain,omitempty"`
	ViaNginx   bool   `json:"viaNginx"`
}

// ContainerView is one running container in a compose project, slimmed for the UI.
type ContainerView struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Image  string         `json:"image"`
	Status string         `json:"status"`
	URLs   []ContainerURL `json:"urls"`
}

// ProjectGroup is one docker-compose project on the host and its running containers.
type ProjectGroup struct {
	Project    string          `json:"project"`
	WorkingDir string          `json:"workingDir"`
	Containers []ContainerView `json:"containers"`
}

// RunningAppsService discovers compose projects on a server (by Docker labels)
// and renders each container's frontend URL.
type RunningAppsService struct {
	nginx *NginxResolver
}

func NewRunningAppsService() *RunningAppsService {
	return &RunningAppsService{nginx: NewNginxResolver()}
}

// ListProjects returns the compose projects running on the server, grouped from
// container labels. agentMissing is true when the helper agent (which the nginx
// resolver depends on) isn't deployed yet — callers can surface a UI hint.
// pinnedGroups is the list of root-group names that an admin has pinned for this
// server (the frontend uses this to sort pinned root-groups to the top).
func (s *RunningAppsService) ListProjects(ctx context.Context, db *gorm.DB, server *models.Server) (projects []ProjectGroup, pinnedGroups []string, agentMissing bool, err error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, nil, false, err
	}
	defer cli.Close()

	containers, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, nil, false, fmt.Errorf("list containers: %w", err)
	}

	// Best-effort: load admin-pinned root-group names for this server. A DB hiccup
	// here shouldn't break the running-apps view — pins just won't show this load.
	if db != nil {
		var pins []models.PinnedProject
		if perr := db.Where("server_id = ?", server.ID).Find(&pins).Error; perr == nil {
			pinnedGroups = make([]string, 0, len(pins))
			for _, p := range pins {
				pinnedGroups = append(pinnedGroups, p.GroupName)
			}
		}
	}

	// Best-effort: resolve the nginx port→domain map. agentMissing isn't fatal —
	// the feature still works, just with IP:port URLs only.
	domainMap, derr := s.nginx.GetDomainMap(ctx, cli, server)
	if derr != nil && errors.Is(derr, errAgentMissing) {
		agentMissing = true
	}

	// Group running containers by docker-compose project label.
	groups := map[string]*ProjectGroup{}
	for _, c := range containers {
		project := c.Labels["com.docker.compose.project"]
		if project == "" {
			continue // not a compose-managed container; skip.
		}
		g, ok := groups[project]
		if !ok {
			g = &ProjectGroup{
				Project:    project,
				WorkingDir: c.Labels["com.docker.compose.project.working_dir"],
			}
			groups[project] = g
		}

		view := ContainerView{
			ID:     c.ID,
			Image:  c.Image,
			Status: c.Status,
		}
		if len(c.Names) > 0 {
			view.Name = strings.TrimPrefix(c.Names[0], "/")
		}

		// Collect published ports (dedup; same PublicPort may appear for IPv4+IPv6).
		seenPort := map[int]bool{}
		for _, p := range c.Ports {
			if p.PublicPort == 0 || seenPort[int(p.PublicPort)] {
				continue
			}
			seenPort[int(p.PublicPort)] = true
			port := int(p.PublicPort)
			cu := ContainerURL{PublicPort: port}
			if domain, ok := domainMap[port]; ok {
				cu.Domain = domain
				cu.URL = "https://" + domain
				cu.ViaNginx = true
			} else {
				cu.URL = fmt.Sprintf("http://%s:%d", server.Address, port)
			}
			view.URLs = append(view.URLs, cu)
		}
		sort.Slice(view.URLs, func(i, j int) bool { return view.URLs[i].PublicPort < view.URLs[j].PublicPort })
		g.Containers = append(g.Containers, view)
	}

	// Stable output: projects alphabetical, containers alphabetical.
	projects = make([]ProjectGroup, 0, len(groups))
	for _, g := range groups {
		sort.Slice(g.Containers, func(i, j int) bool { return g.Containers[i].Name < g.Containers[j].Name })
		projects = append(projects, *g)
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].Project < projects[j].Project })
	return projects, pinnedGroups, agentMissing, nil
}
