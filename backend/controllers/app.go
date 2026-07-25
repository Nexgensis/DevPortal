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

// updateAppRequest is the accepted shape for PUT /apps/:id. Binding this
// instead of models.App is deliberate. models.App also carries Status,
// StartedAt and TimerEndsAt, which are owned by StartApp/StopApp and the timer
// service — binding the model let a caller flip Status to "running" with no
// container actually started. It also let any authenticated user (this route
// sits in the auth group, not admin) repoint ComposePath/ServerID at someone
// else's compose project and then drive it via start/stop.
//
// Pointers distinguish "field absent" from "field set to zero", so
// autoStopTimeout: 0 (run until stopped by hand) isn't read as "omitted".
type updateAppRequest struct {
	// Admin-only — where the app lives and what it points at.
	Name        *string `json:"name"`
	Domain      *string `json:"domain"`
	ComposePath *string `json:"cdPath"`
	ProjectID   *string `json:"projectId"`
	ServerID    *string `json:"serverId"`
	// Any authenticated user — the runtime control on the app card.
	AutoStopTimeout *int `json:"autoStopTimeout"`
}

func UpdateApp(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var app models.App
		if result := db.First(&app, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "App not found")
			return
		}

		var input updateAppRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		updates := map[string]interface{}{}

		// A non-admin's placement fields are ignored rather than rejected: the
		// app card sends only autoStopTimeout, so a 403 here would break the
		// legitimate path if the client ever posts the whole object back.
		if claimRole(c) == "admin" {
			if input.Name != nil {
				updates["name"] = *input.Name
			}
			if input.Domain != nil {
				updates["domain"] = *input.Domain
			}
			if input.ComposePath != nil {
				updates["compose_path"] = *input.ComposePath
			}
			if input.ProjectID != nil {
				updates["project_id"] = *input.ProjectID
			}
			if input.ServerID != nil {
				updates["server_id"] = *input.ServerID
			}
		}

		if input.AutoStopTimeout != nil && *input.AutoStopTimeout != app.AutoStopTimeout {
			updates["auto_stop_mins"] = *input.AutoStopTimeout
			// Re-arm a running app's auto-stop clock from now, not from its
			// original start time. 0 means run until stopped by hand.
			if app.Status == "running" && app.StartedAt != nil {
				if *input.AutoStopTimeout > 0 {
					updates["timer_ends_at"] = time.Now().Add(time.Duration(*input.AutoStopTimeout) * time.Minute).UnixMilli()
				} else {
					updates["timer_ends_at"] = gorm.Expr("NULL")
				}
			}
		}

		if len(updates) > 0 {
			if err := db.Model(&app).Updates(updates).Error; err != nil {
				respondWithError(c, http.StatusInternalServerError, "Failed to update app")
				return
			}
		}

		// Reload the app to get all updated values
		db.First(&app, "id = ?", id)
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