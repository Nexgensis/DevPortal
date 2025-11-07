package migrations

import (
	"gorm.io/gorm"
)

func AddTimerEndsAtColumn(db *gorm.DB) error {
	// Add timer_ends_at column to apps table if it doesn't exist
	return db.Exec(`
		ALTER TABLE apps 
		ADD COLUMN IF NOT EXISTS timer_ends_at BIGINT;
	`).Error
}