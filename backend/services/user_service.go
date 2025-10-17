package services

import (
	"backend/models"
	"backend/utils"
	"gorm.io/gorm"
)

// CreateDefaultAdmin creates default users if no users exist
func CreateDefaultAdmin(db *gorm.DB) error {
	var count int64
	db.Model(&models.User{}).Count(&count)
	
	// If there are already users, don't create default users
	if count > 0 {
		return nil
	}

	// Hash the password
	hashedPassword, err := utils.HashPassword("sourav+1")
	if err != nil {
		return err
	}

	// Create admin user
	user := models.User{
		Username:     "sourav",
		Email:        "sourav@example.com",
		PasswordHash: hashedPassword,
		Role:         "admin",
	}

	if err := db.Create(&user).Error; err != nil {
		return err
	}

	return nil
}