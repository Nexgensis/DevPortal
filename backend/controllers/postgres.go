package controllers

import (
	"backend/models"
	"backend/services"
	"fmt"
	"io"
	"net/http"
	"time"

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
		
		// Look up the Admin-configured credentials for this container (keyed by
		// name) and decrypt the password. nil → no row stored yet, in which case
		// the service applies the default postgres/postgres profile as a safe
		// catch-all (with superuser auto-detection as a final fallback).
		creds, err := resolvePostgresCreds(db, serverID, c.Query("container_name"))
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		// Get databases
		pgService := services.NewPostgresService()
		databases, err := pgService.GetDatabases(c.Request.Context(), &server, containerID, creds)
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
		
		// Resolve stored credentials (by container name) for explicit-user dumps.
		creds, err := resolvePostgresCreds(db, req.ServerID, req.ContainerName)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		// Open a live stream of the custom-format archive from the container.
		pgService := services.NewPostgresService()
		stream, err := pgService.CreateDump(c.Request.Context(), &server, req.ContainerID, req.Database, creds)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		// Closing the stream tears down the docker client + hijacked connection.
		defer stream.Close()

		// Log the action
		services.LogAction(db, c, "postgres_dump", "database", req.Database, req.Database,
			"Created dump of database "+req.Database+" from container "+req.ContainerID)

		// Stream straight to the client — memory stays flat regardless of size.
		// The service produces a gzip-compressed plain-SQL stream; Content-Encoding:
		// gzip tells the browser to transparently decompress it, so the saved file
		// is plain .sql (and the transfer over the wire stays small).
		filename := fmt.Sprintf("%s-%s.sql", req.Database, time.Now().Format("20060102-150405"))
		c.Header("Content-Disposition", "attachment; filename="+filename)
		c.Header("Content-Type", "application/sql")
		c.Header("Content-Encoding", "gzip")
		c.Header("Transfer-Encoding", "chunked")

		buf := make([]byte, 32*1024)
		c.Stream(func(w io.Writer) bool {
			n, readErr := stream.Read(buf)
			if n > 0 {
				if _, writeErr := w.Write(buf[:n]); writeErr != nil {
					return false // client disconnected
				}
			}
			// io.EOF (clean end) or any read error stops the stream. A mid-stream
			// pg_dump failure surfaces here as a read error; headers are already
			// sent, so the client receives a truncated file.
			return readErr == nil
		})
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
		
		// Resolve stored credentials (by container name) when present.
		creds, err := resolvePostgresCreds(db, serverID, c.Query("container_name"))
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		// Test connection
		pgService := services.NewPostgresService()
		if err := pgService.TestConnection(c.Request.Context(), &server, containerID, creds); err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Connection successful",
		})
	}
}
