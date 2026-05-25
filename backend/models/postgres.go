package models

import "time"

// PostgresContainer represents a PostgreSQL container
type PostgresContainer struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Image     string            `json:"image"`
	Status    string            `json:"status"`
	Ports     []string          `json:"ports"`
	Labels    map[string]string `json:"labels,omitempty"`
	Created   time.Time         `json:"created"`
	ServerID  string            `json:"server_id"`
}

// PostgresDatabase represents a PostgreSQL database
type PostgresDatabase struct {
	Name     string `json:"name"`
	Owner    string `json:"owner"`
	Encoding string `json:"encoding"`
	Size     string `json:"size,omitempty"`
}

// PostgresDumpRequest represents a database dump request. Dumps always use the
// custom binary archive format (pg_dump -F c), so no per-request format flags
// are needed.
type PostgresDumpRequest struct {
	ServerID    string `json:"server_id" binding:"required"`
	ContainerID string `json:"container_id" binding:"required"`
	Database    string `json:"database" binding:"required"`
	// ContainerName resolves stored credentials (keyed by name). Optional —
	// empty falls back to superuser auto-detection.
	ContainerName string `json:"container_name"`
}
