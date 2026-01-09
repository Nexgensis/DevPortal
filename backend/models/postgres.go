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

// PostgresDumpRequest represents a database dump request
type PostgresDumpRequest struct {
	ServerID    string   `json:"server_id" binding:"required"`
	ContainerID string   `json:"container_id" binding:"required"`
	Database    string   `json:"database" binding:"required"`
	DataOnly    bool     `json:"data_only"`
	SchemaOnly  bool     `json:"schema_only"`
	Tables      []string `json:"tables,omitempty"`
}
