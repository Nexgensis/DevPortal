package controllers

import (
	"backend/models"
	"backend/services"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetPostgresContainers retrieves PostgreSQL containers from a server
func GetPostgresContainers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		
		// Get server from database
		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}
		
		// Get PostgreSQL containers
		dockerService := services.NewDockerService()
		containers, err := dockerService.GetPostgresContainers(c.Request.Context(), &server)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"containers": containers,
			"count":      len(containers),
		})
	}
}

// GetPostgresDatabases retrieves databases from a PostgreSQL container
func GetPostgresDatabases(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		containerID := c.Param("container_id")
		
		// Get server from database
		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}
		
		// Get databases
		pgService := services.NewPostgresService()
		databases, err := pgService.GetDatabases(c.Request.Context(), &server, containerID)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"databases": databases,
			"count":     len(databases),
		})
	}
}

// CreatePostgresDump creates a database dump
func CreatePostgresDump(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.PostgresDumpRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}
		
		// Get server from database
		var server models.Server
		if err := db.First(&server, "id = ?", req.ServerID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}
		
		// Create dump
		pgService := services.NewPostgresService()
		dumpData, err := pgService.CreateDump(c.Request.Context(), &server, &req)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		
		// Log the action
		services.LogAction(db, c, "postgres_dump", "database", req.Database, req.Database, 
			"Created dump of database "+req.Database+" from container "+req.ContainerID)
		
		// Return dump as downloadable file
		c.Header("Content-Disposition", "attachment; filename="+req.Database+".sql")
		c.Header("Content-Type", "application/sql")
		c.String(http.StatusOK, dumpData)
	}
}

// TestPostgresConnection tests connection to a PostgreSQL container
func TestPostgresConnection(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		containerID := c.Param("container_id")
		
		// Get server from database
		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}
		
		// Test connection
		pgService := services.NewPostgresService()
		if err := pgService.TestConnection(c.Request.Context(), &server, containerID); err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Connection successful",
		})
	}
}
