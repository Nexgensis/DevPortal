package services

import (
	"backend/models"
	"backend/utils"
	"context"
	"fmt"
	"strings"
)

// PostgresService handles PostgreSQL operations
type PostgresService struct {
	dockerService *DockerService
}

// NewPostgresService creates a new PostgreSQL service
func NewPostgresService() *PostgresService {
	return &PostgresService{
		dockerService: NewDockerService(),
	}
}

// GetDatabases retrieves list of databases from a PostgreSQL container
func (s *PostgresService) GetDatabases(ctx context.Context, server *models.Server, containerID string) ([]models.PostgresDatabase, error) {
	// Execute psql command to list databases
	cmd := fmt.Sprintf(
		`docker exec %s psql -U postgres -t -A -c "SELECT datname, pg_catalog.pg_get_userbyid(datdba) as owner, pg_encoding_to_char(encoding) as encoding, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database WHERE datistemplate = false ORDER BY datname;"`,
		containerID,
	)
	
	// Decrypt SSH key
	privKey, err := utils.Decrypt(server.SSHPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt SSH key: %w", err)
	}
	
	output, err := utils.RunSSHCommand(server.SSHUser, server.Address, server.SSHPort, privKey, cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}
	
	return s.parseDatabaseList(output), nil
}

// parseDatabaseList parses the output of database listing
func (s *PostgresService) parseDatabaseList(output string) []models.PostgresDatabase {
	var databases []models.PostgresDatabase
	
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
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

// CreateDump creates a PostgreSQL database dump
func (s *PostgresService) CreateDump(ctx context.Context, server *models.Server, req *models.PostgresDumpRequest) (string, error) {
	// Build pg_dump command
	pgDumpCmd := s.buildPgDumpCommand(req)
	
	// Execute dump command
	cmd := fmt.Sprintf(`docker exec %s %s`, req.ContainerID, pgDumpCmd)
	
	// Decrypt SSH key
	privKey, err := utils.Decrypt(server.SSHPrivateKey)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt SSH key: %w", err)
	}
	
	output, err := utils.RunSSHCommand(server.SSHUser, server.Address, server.SSHPort, privKey, cmd)
	if err != nil {
		return "", fmt.Errorf("failed to create dump: %w", err)
	}
	
	return output, nil
}

// buildPgDumpCommand builds the pg_dump command based on request options
func (s *PostgresService) buildPgDumpCommand(req *models.PostgresDumpRequest) string {
	parts := []string{"pg_dump", "-U", "postgres"}
	
	// Add options
	if req.DataOnly {
		parts = append(parts, "--data-only")
	}
	
	if req.SchemaOnly {
		parts = append(parts, "--schema-only")
	}
	
	// Add specific tables if requested
	for _, table := range req.Tables {
		parts = append(parts, "-t", table)
	}
	
	// Add database name
	parts = append(parts, req.Database)
	
	return strings.Join(parts, " ")
}

// TestConnection tests the connection to a PostgreSQL container
func (s *PostgresService) TestConnection(ctx context.Context, server *models.Server, containerID string) error {
	cmd := fmt.Sprintf(`docker exec %s psql -U postgres -c "SELECT 1;"`, containerID)
	
	// Decrypt SSH key
	privKey, err := utils.Decrypt(server.SSHPrivateKey)
	if err != nil {
		return fmt.Errorf("failed to decrypt SSH key: %w", err)
	}
	
	_, err = utils.RunSSHCommand(server.SSHUser, server.Address, server.SSHPort, privKey, cmd)
	if err != nil {
		return fmt.Errorf("connection test failed: %w", err)
	}
	
	return nil
}
