package models

import (
    "time"

    "gorm.io/gorm"
)

type Server struct {
    ID               string         `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    Name             string         `gorm:"not null" json:"name"`
    Address          string         `gorm:"not null" json:"address"`
    DockerAPIPort    int            `gorm:"column:docker_api_port;not null;default:2376" json:"dockerApiPort"`
    // mTLS assets for the remote Docker Engine API. The CA and client cert are
    // public material and stored as plain text; the client private key is
    // AES-encrypted at rest via utils.Encrypt (column tls_key_encrypted).
    TLSCA            string         `gorm:"column:tls_ca;type:text" json:"tlsCa"`
    TLSCert          string         `gorm:"column:tls_cert;type:text" json:"tlsCert"`
    // Never serialized back to clients — the encrypted key stays server-side.
    TLSKey           string         `gorm:"column:tls_key_encrypted;type:text" json:"-"`
    // Server-level PostgreSQL superuser, used as a fallback for ALL containers on
    // this host when the default "postgres" role fails (hardened images with a
    // custom superuser). Password is AES-encrypted at rest and never serialized.
    PGUser              string      `gorm:"column:pg_user" json:"pgUser"`
    PGPasswordEncrypted string      `gorm:"column:pg_password_encrypted;type:text" json:"-"`
    PGMaintenanceDB     string      `gorm:"column:pg_maintenance_db" json:"pgMaintenanceDb"`
    PGHasPassword       bool        `gorm:"-" json:"pgHasPassword"` // computed for clients
    Status           string         `gorm:"not null;default:'offline'" json:"status"`
    RunningAppsCount int            `gorm:"-" json:"runningAppsCount"` // Computed field
    LastChecked      *int64         `json:"lastChecked"`
    CreatedAt        time.Time      `json:"createdAt"`
    UpdatedAt        time.Time      `json:"updatedAt"`
    DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}
