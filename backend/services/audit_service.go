package services

import (
	"backend/models"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// LogAction creates an audit log entry
func LogAction(db *gorm.DB, c *gin.Context, action, resourceType, resourceID, resourceName, details string) error {
	// Get user info from context
	username := "unknown"
	if user, exists := c.Get("username"); exists {
		username = user.(string)
	}

	// Get user ID
	var userID string
	var dbUser models.User
	if err := db.Where("username = ?", username).First(&dbUser).Error; err == nil {
		userID = dbUser.ID
	}

	auditLog := models.AuditLog{
		UserID:       userID,
		Username:     username,
		Action:       action,
		ResourceID:   resourceID,
		ResourceType: resourceType,
		ResourceName: resourceName,
		Details:      details,
		IPAddress:    c.ClientIP(),
		UserAgent:    c.GetHeader("User-Agent"),
	}

	return db.Create(&auditLog).Error
}

// GetAuditLogs retrieves audit logs with pagination and filtering
func GetAuditLogs(db *gorm.DB, limit, offset int, userID, action, resourceType string) ([]models.AuditLog, int64, error) {
	var logs []models.AuditLog
	var total int64

	query := db.Model(&models.AuditLog{})

	// Apply filters
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if resourceType != "" {
		query = query.Where("resource_type = ?", resourceType)
	}

	// Get total count
	query.Count(&total)

	// Get paginated results
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&logs).Error

	return logs, total, err
}

// LogAppAction logs app-specific actions with duration
func LogAppAction(db *gorm.DB, c *gin.Context, action string, app models.App, duration *time.Duration) error {
	details := fmt.Sprintf("App: %s on server %s", app.Name, app.ServerID)
	if duration != nil {
		details += fmt.Sprintf(", Duration: %s", duration.String())
	}

	return LogAction(db, c, action, "app", app.ID, app.Name, details)
}

// LogAuthAction logs authentication-related actions
func LogAuthAction(db *gorm.DB, c *gin.Context, action, username string) error {
	details := fmt.Sprintf("User: %s", username)
	return LogAction(db, c, action, "auth", "", username, details)
}