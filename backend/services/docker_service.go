package services

import (
	"backend/models"
	"backend/utils"
	"context"
	"fmt"
	"strings"
	"time"
)

// DockerService handles Docker operations
type DockerService struct{}

// NewDockerService creates a new Docker service
func NewDockerService() *DockerService {
	return &DockerService{}
}

// GetPostgresContainers retrieves PostgreSQL containers from a server
func (s *DockerService) GetPostgresContainers(ctx context.Context, server *models.Server) ([]models.PostgresContainer, error) {
	// Build docker ps command with custom format
	cmd := `docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`
	
	// Decrypt SSH key
	privKey, err := utils.Decrypt(server.SSHPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt SSH key: %w", err)
	}
	
	output, err := utils.RunSSHCommand(server.SSHUser, server.Address, server.SSHPort, privKey, cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to execute docker ps: %w", err)
	}

	return s.parseDockerOutput(output, server.ID), nil
}

// parseDockerOutput parses docker ps output and filters PostgreSQL containers
func (s *DockerService) parseDockerOutput(output, serverID string) []models.PostgresContainer {
	var containers []models.PostgresContainer
	
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		
		parts := strings.Split(line, "\t")
		if len(parts) < 4 {
			continue
		}
		
		containerID := parts[0]
		name := strings.TrimPrefix(parts[1], "/")
		image := parts[2]
		status := parts[3]
		ports := []string{}
		
		if len(parts) >= 5 && parts[4] != "" {
			ports = s.parsePorts(parts[4])
		}
		
		// Check if this is a PostgreSQL container using improved detection
		if !s.isPostgresContainer(image, name) {
			continue
		}
		
		container := models.PostgresContainer{
			ID:       containerID,
			Name:     name,
			Image:    image,
			Status:   status,
			Ports:    ports,
			Created:  time.Now(),
			ServerID: serverID,
		}
		
		containers = append(containers, container)
	}
	
	return containers
}

// isPostgresContainer checks if a container is PostgreSQL based on image or name patterns
func (s *DockerService) isPostgresContainer(image, name string) bool {
	imageLower := strings.ToLower(image)
	nameLower := strings.ToLower(name)
	
	// Check image name for postgres
	if strings.Contains(imageLower, "postgres") || strings.Contains(imageLower, "postgresql") {
		return true
	}
	
	// Check container name patterns
	// Patterns: *-database, *-db, *_database, *_db, database-*, db-*
	patterns := []string{
		"-database",
		"-db",
		"_database",
		"_db",
		"database-",
		"database_",
		"db-",
		"db_",
		"postgres",
		"postgresql",
	}
	
	for _, pattern := range patterns {
		if strings.Contains(nameLower, pattern) {
			return true
		}
	}
	
	return false
}

// parsePorts parses port information from docker ps output
func (s *DockerService) parsePorts(portString string) []string {
	if portString == "" {
		return []string{}
	}
	
	ports := strings.Split(portString, ",")
	var result []string
	for _, port := range ports {
		result = append(result, strings.TrimSpace(port))
	}
	return result
}

// GetContainerDetails gets detailed information about a specific container
func (s *DockerService) GetContainerDetails(ctx context.Context, server *models.Server, containerID string) (map[string]interface{}, error) {
	cmd := fmt.Sprintf("docker inspect %s", containerID)
	
	// Decrypt SSH key
	privKey, err := utils.Decrypt(server.SSHPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt SSH key: %w", err)
	}
	
	output, err := utils.RunSSHCommand(server.SSHUser, server.Address, server.SSHPort, privKey, cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %w", err)
	}
	
	// Return raw JSON output
	return map[string]interface{}{
		"raw": output,
	}, nil
}
