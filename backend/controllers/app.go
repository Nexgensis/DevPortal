package controllers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"backend/models"
	"backend/services"
)

func ListApps(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var apps []models.App
		db.Find(&apps)
		c.JSON(http.StatusOK, apps)
	}
}

func CreateApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input models.App
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		db.Create(&input)
		c.JSON(http.StatusCreated, input)
	}
}

func GetApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}
		c.JSON(http.StatusOK, app)
	}
}

func UpdateApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}

		var input models.App
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		db.Model(&app).Updates(input)
		c.JSON(http.StatusOK, app)
	}
}

func DeleteApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}

		db.Delete(&app)
		c.JSON(http.StatusOK, gin.H{"message": "App deleted successfully"})
	}
}

func StartApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}

		var input struct {
			TimeoutMinutes int `json:"timeout_minutes"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return		}

		server, err := services.GetServerByID(db, app.ServerID)
		if err != nil {
			respondWithError(c, http.StatusNotFound, "Server not found for app")
			return
		}

		out, err := services.StartComposeApp(server, app.ComposePath)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to start app: %v", err))
			return
		}

		app.Status = "running"
		now := time.Now()
		app.StartedAt = &now
		if input.TimeoutMinutes > 0 {
			app.AutoStopTimeout = input.TimeoutMinutes
			// Set timer end time in milliseconds for frontend compatibility
			timerEnd := now.Add(time.Duration(input.TimeoutMinutes) * time.Minute).UnixMilli()
			app.TimerEndsAt = &timerEnd
		} else {
			app.AutoStopTimeout = 0 // Manual stop
			app.TimerEndsAt = nil
		}

		db.Save(&app)

		// Log the action
		duration := time.Duration(app.AutoStopTimeout) * time.Minute
		services.LogAppAction(db, c, "start_app", app, &duration)

		timerEndsAt := int64(0)
		if app.TimerEndsAt != nil {
			timerEndsAt = *app.TimerEndsAt
		}

		c.JSON(http.StatusOK, gin.H{
			"message":       "App started",
			"output":        out,
			"timer_ends_at": timerEndsAt,
			"app_url":       app.AppURL,
		})
	}
}

func StopApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}

		server, err := services.GetServerByID(db, app.ServerID)
		if err != nil {
			respondWithError(c, http.StatusNotFound, "Server not found for app")
			return
		}

		out, err := services.StopComposeApp(server, app.ComposePath)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to stop app: %v", err))
			return
		}

		// Calculate duration if app was running
		var duration *time.Duration
		if app.StartedAt != nil {
			d := time.Since(*app.StartedAt)
			duration = &d
		}

		app.Status = "stopped"
		app.StartedAt = nil
		app.TimerEndsAt = nil
		db.Save(&app)

		// Log the action
		services.LogAppAction(db, c, "stop_app", app, duration)

		c.JSON(http.StatusOK, gin.H{
			"message": "App stopped",
			"output":  out,
		})
	}
}