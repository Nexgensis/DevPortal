package models

import "time"

// PostgresCredential stores Admin-configured PostgreSQL credentials for a
// specific container on a specific server. It exists because hardened/enterprise
// images remove the default "postgres" role (running instead under a custom user
// + maintenance database), so we let the Admin record the correct values rather
// than relying on brittle auto-detection.
//
// Keyed by (ServerID, ContainerName) — the name is stable across container
// recreation (the Docker ID is not). The password is AES-encrypted at rest via
// utils.Encrypt (column db_password_encrypted) and never serialized to clients.
type PostgresCredential struct {
	ID                  string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ServerID            string    `gorm:"type:uuid;not null;uniqueIndex:idx_pgcred_server_container" json:"serverId"`
	ContainerName       string    `gorm:"not null;uniqueIndex:idx_pgcred_server_container" json:"containerName"`
	DBUser              string    `gorm:"column:db_user" json:"dbUser"`
	DBPasswordEncrypted string    `gorm:"column:db_password_encrypted;type:text" json:"-"`
	DBName              string    `gorm:"column:db_name" json:"dbName"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}
