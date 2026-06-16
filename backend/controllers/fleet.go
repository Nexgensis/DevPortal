package controllers

import (
	"net/http"

	"backend/models"
	"backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetFleetResources returns live CPU/RAM insights aggregated across every
// server (top consumers, per-server load, fleet totals). The heavy Docker
// stats gather is cached + refreshed in the background by the service, so this
// handler is cheap and returns instantly (with Computing=true on a cold cache).
func GetFleetResources(db *gorm.DB) gin.HandlerFunc {
	svc := services.NewFleetStatsService()
	return func(c *gin.Context) {
		var servers []models.Server
		if err := db.Find(&servers).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch servers")
			return
		}
		ptrs := make([]*models.Server, len(servers))
		for i := range servers {
			ptrs[i] = &servers[i]
		}
		c.JSON(http.StatusOK, svc.GetResources(ptrs))
	}
}
