package migrations

import (
	"backend/services"

	"gorm.io/gorm"
)

// CreateDefaultUsers seeds the break-glass admin on a fresh database.
// CreateDefaultAdmin is a no-op when any user already exists and does its own
// logging — including printing a generated password once, which is why nothing
// credential-related is logged here.
func CreateDefaultUsers(db *gorm.DB) error {
	return services.CreateDefaultAdmin(db)
}
