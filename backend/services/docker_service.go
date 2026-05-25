package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"backend/models"

	"github.com/docker/docker/api/types/container"
)

// DockerService handles Docker operations over the remote Docker Engine API (mTLS).
type DockerService struct{}

// NewDockerService creates a new Docker service.
func NewDockerService() *DockerService {
	return &DockerService{}
}

// GetPostgresContainers lists PostgreSQL containers running on a server.
func (s *DockerService) GetPostgresContainers(ctx context.Context, server *models.Server) ([]models.PostgresContainer, error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	list, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var containers []models.PostgresContainer
	for _, c := range list {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		if !s.isPostgresContainer(c.Image, name) {
			continue
		}

		ports := make([]string, 0, len(c.Ports))
		for _, p := range c.Ports {
			if p.PublicPort != 0 {
				ports = append(ports, fmt.Sprintf("%s:%d->%d/%s", p.IP, p.PublicPort, p.PrivatePort, p.Type))
			} else {
				ports = append(ports, fmt.Sprintf("%d/%s", p.PrivatePort, p.Type))
			}
		}

		containers = append(containers, models.PostgresContainer{
			ID:       c.ID,
			Name:     name,
			Image:    c.Image,
			Status:   c.Status,
			Ports:    ports,
			Labels:   c.Labels,
			Created:  time.Unix(c.Created, 0),
			ServerID: server.ID,
		})
	}

	return containers, nil
}

// isPostgresContainer checks if a container is PostgreSQL based on image or name patterns.
func (s *DockerService) isPostgresContainer(image, name string) bool {
	imageLower := strings.ToLower(image)
	nameLower := strings.ToLower(name)

	if strings.Contains(imageLower, "postgres") || strings.Contains(imageLower, "postgresql") {
		return true
	}

	patterns := []string{
		"-database", "-db", "_database", "_db",
		"database-", "database_", "db-", "db_",
		"postgres", "postgresql",
	}
	for _, pattern := range patterns {
		if strings.Contains(nameLower, pattern) {
			return true
		}
	}

	return false
}

// GetContainerDetails returns the raw inspect JSON for a specific container.
func (s *DockerService) GetContainerDetails(ctx context.Context, server *models.Server, containerID string) (map[string]interface{}, error) {
	cli, err := NewDockerClient(server)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	inspect, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %w", err)
	}

	raw, err := json.Marshal(inspect)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal inspect output: %w", err)
	}

	return map[string]interface{}{"raw": string(raw)}, nil
}
