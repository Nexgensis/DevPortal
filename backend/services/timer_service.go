package services

import (
	"log"
	"time"

	"backend/models"
	"gorm.io/gorm"
)

// StartTimerService starts a background service to check for expired apps
func StartTimerService(db *gorm.DB) {
	ticker := time.NewTicker(30 * time.Second) // Check every 30 seconds
	go func() {
		for range ticker.C {
			checkExpiredApps(db)
		}
	}()
	log.Println("Timer service started")
}

func checkExpiredApps(db *gorm.DB) {
	var apps []models.App
	now := time.Now().UnixMilli()
	
	// Find running apps with expired timers
	db.Where("status = ? AND timer_ends_at IS NOT NULL AND timer_ends_at <= ?", "running", now).Find(&apps)
	
	for _, app := range apps {
		log.Printf("Auto-stopping expired app: %s (ID: %s)", app.Name, app.ID)
		
		// Get server for this app
		server, err := GetServerByID(db, app.ServerID)
		if err != nil {
			log.Printf("Failed to get server for app %s: %v", app.ID, err)
			continue
		}
		
		// Stop the app
		_, err = StopComposeApp(server, app.ComposePath)
		if err != nil {
			log.Printf("Failed to auto-stop app %s: %v", app.ID, err)
			continue
		}
		
		// Update app status
		app.Status = "stopped"
		app.StartedAt = nil
		app.TimerEndsAt = nil
		db.Save(&app)
		
		log.Printf("Successfully auto-stopped app: %s", app.Name)
	}
}