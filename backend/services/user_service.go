package services

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"os"
	"strings"

	"backend/models"
	"backend/utils"

	"gorm.io/gorm"
)

// randomPassword returns a URL-safe random string with ~144 bits of entropy.
func randomPassword() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// CreateDefaultAdmin seeds the break-glass admin, but only when the users table
// is empty — an existing deployment is never touched.
//
// The credential comes from ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL. If
// ADMIN_PASSWORD is unset we generate a random one and print it exactly once, on
// this first boot. That combination is deliberate: the previous hardcoded
// credential was readable by anyone with repo access and identical on every
// install, while failing to seed at all would lock an operator out of a fresh
// deployment before SSO is configured.
//
// A password supplied via ADMIN_PASSWORD is never logged.
func CreateDefaultAdmin(db *gorm.DB) error {
	var count int64
	db.Model(&models.User{}).Count(&count)
	if count > 0 {
		return nil
	}

	username := strings.TrimSpace(os.Getenv("ADMIN_USERNAME"))
	if username == "" {
		username = "admin"
	}
	email := strings.TrimSpace(os.Getenv("ADMIN_EMAIL"))
	if email == "" {
		email = username + "@localhost"
	}

	password := os.Getenv("ADMIN_PASSWORD")
	generated := password == ""
	if generated {
		var err error
		if password, err = randomPassword(); err != nil {
			return err
		}
	}

	hashedPassword, err := utils.HashPassword(password)
	if err != nil {
		return err
	}

	user := models.User{
		Username:     username,
		Email:        email,
		PasswordHash: hashedPassword,
		Role:         "admin",
		IsActive:     true,
	}
	if err := db.Create(&user).Error; err != nil {
		return err
	}

	if generated {
		// Printed once, on the boot that created the account. Set ADMIN_PASSWORD
		// (or change it in the UI) and this never appears again.
		log.Printf("=================================================================")
		log.Printf(" Created initial admin %q with a generated password:", username)
		log.Printf("   %s", password)
		log.Printf(" Save it now — it is not stored anywhere and won't be shown again.")
		log.Printf("=================================================================")
	} else {
		log.Printf("Created initial admin %q from ADMIN_PASSWORD", username)
	}

	return nil
}
