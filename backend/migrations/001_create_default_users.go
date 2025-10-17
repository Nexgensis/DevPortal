package migrations

import (
	"log"

	"backend/models"
	"backend/services"

	"gorm.io/gorm"
)

func CreateDefaultUsers(db *gorm.DB) error {
	var count int64
	db.Model(&models.User{}).Count(&count)

	// If there are already users, don't create default users
	if count > 0 {
		log.Println("Users already exist, skipping default user creation.")
		return nil
	}

	// Create default users
	if err := services.CreateDefaultAdmin(db); err != nil {
		return err
	} else {
		log.Println("Default admin user created:")
		log.Println("  Admin: username=sourav, password=sourav+1")
	}

	return nil
}