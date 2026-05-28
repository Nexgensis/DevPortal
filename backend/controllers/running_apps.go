package controllers

import (
	"errors"
	"net/http"

	"backend/models"
	"backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetRunningApps returns docker-compose projects + running containers for one
// server, each container's published ports resolved to a domain URL (when the
// host's nginx fronts it via the Nexus Aura Agent) or to IP:port otherwise.
// Also returns the list of admin-pinned root-group names so the frontend can
// surface them at the top of the cards.
func GetRunningApps(db *gorm.DB) gin.HandlerFunc {
	svc := services.NewRunningAppsService()
	return func(c *gin.Context) {
		var server models.Server
		if err := db.First(&server, "id = ?", c.Param("id")).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		projects, pinned, agentMissing, err := svc.ListProjects(c.Request.Context(), db, &server)
		if err != nil {
			respondWithError(c, http.StatusBadGateway, err.Error())
			return
		}
		if pinned == nil {
			pinned = []string{}
		}
		c.JSON(http.StatusOK, gin.H{
			"projects":     projects,
			"pinned":       pinned,
			"agentMissing": agentMissing,
		})
	}
}

// PinProject pins a root-group (e.g. "qms") on a server so it sorts to the top
// for every viewer. Admin-only; idempotent (re-pinning the same group is a no-op).
func PinProject(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		group := c.Param("group")
		if group == "" {
			respondWithError(c, http.StatusBadRequest, "Group name is required")
			return
		}

		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		pin := models.PinnedProject{ServerID: serverID, GroupName: group}
		// FirstOrCreate keeps the existing row if already pinned (idempotent).
		if err := db.Where("server_id = ? AND group_name = ?", serverID, group).
			FirstOrCreate(&pin).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to pin project")
			return
		}

		_ = services.LogAction(db, c, "pin", "project_group", serverID, group, "Pinned "+group+" on "+server.Name)
		c.JSON(http.StatusOK, gin.H{"pinned": true, "groupName": group})
	}
}

// UnpinProject removes the pin for a root-group on a server. Admin-only;
// idempotent (unpinning a non-pinned group is a no-op).
func UnpinProject(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		group := c.Param("group")
		if group == "" {
			respondWithError(c, http.StatusBadRequest, "Group name is required")
			return
		}

		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		if err := db.Where("server_id = ? AND group_name = ?", serverID, group).
			Delete(&models.PinnedProject{}).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to unpin project")
			return
		}

		_ = services.LogAction(db, c, "unpin", "project_group", serverID, group, "Unpinned "+group+" on "+server.Name)
		c.JSON(http.StatusOK, gin.H{"pinned": false, "groupName": group})
	}
}
