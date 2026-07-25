package controllers

import (
	"backend/models"
	"backend/services"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DumpAuditDetail is the structured payload stored in audit_logs.details for
// every `postgres_dump` action. Parsed by the dump-stats endpoint to compute
// size totals, largest dumps, and failure rates. Kept JSON-encoded so we can
// add fields without a schema migration.
type DumpAuditDetail struct {
	ServerID      string `json:"server_id"`
	ContainerID   string `json:"container_id"`
	ContainerName string `json:"container_name,omitempty"`
	Database      string `json:"database"`
	SizeBytes     int64  `json:"size_bytes"`           // gzip-compressed bytes streamed; 0 on early failure
	Status        string `json:"status"`               // "ok" | "error"
	Error         string `json:"error,omitempty"`      // populated when Status == "error"
	DurationMS    int64  `json:"duration_ms"`
}

// countingReader wraps an io.Reader and tallies bytes seen so far so we can
// record the dump size in the audit log after the stream completes.
type countingReader struct {
	r io.Reader
	n int64
}

func (cr *countingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	cr.n += int64(n)
	return n, err
}

// logDumpResult marshals the detail payload as JSON and writes one audit row.
// Errors from the audit write are intentionally swallowed — the dump itself
// is the user-facing operation and shouldn't fail because of telemetry.
func logDumpResult(db *gorm.DB, c *gin.Context, d DumpAuditDetail) {
	payload, err := json.Marshal(d)
	details := d.Database
	if err == nil {
		details = string(payload)
	}
	_ = services.LogAction(db, c, "postgres_dump", "database", d.ServerID, d.Database, details)
}

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

		// Seed the audit detail up-front; we mutate Status/SizeBytes/Error as the
		// flow progresses and always emit one row before returning.
		started := time.Now()
		detail := DumpAuditDetail{
			ServerID:      req.ServerID,
			ContainerID:   req.ContainerID,
			ContainerName: req.ContainerName,
			Database:      req.Database,
		}
		finish := func(status, errMsg string, size int64) {
			detail.Status = status
			detail.Error = errMsg
			detail.SizeBytes = size
			detail.DurationMS = time.Since(started).Milliseconds()
			logDumpResult(db, c, detail)
		}

		// Get server from database
		var server models.Server
		if err := db.First(&server, "id = ?", req.ServerID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				finish("error", "Server not found", 0)
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			finish("error", err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		// Resolve stored credentials (by container name) for explicit-user dumps.
		creds, err := resolvePostgresCreds(db, req.ServerID, req.ContainerName)
		if err != nil {
			finish("error", "Failed to resolve credentials: "+err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		// Open a live stream of the custom-format archive from the container.
		pgService := services.NewPostgresService()
		stream, err := pgService.CreateDump(c.Request.Context(), &server, req.ContainerID, req.Database, creds)
		if err != nil {
			finish("error", err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		// Closing the stream tears down the docker client + hijacked connection.
		defer stream.Close()

		// Stream straight to the client — memory stays flat regardless of size.
		// The service produces a gzip-compressed plain-SQL stream; Content-Encoding:
		// gzip tells the browser to transparently decompress it, so the saved file
		// is plain .sql (and the transfer over the wire stays small).
		filename := fmt.Sprintf("%s-%s.sql", req.Database, time.Now().Format("20060102-150405"))
		c.Header("Content-Disposition", "attachment; filename="+filename)
		c.Header("Content-Type", "application/sql")
		c.Header("Content-Encoding", "gzip")
		c.Header("Transfer-Encoding", "chunked")

		counter := &countingReader{r: stream}
		var streamErr error
		buf := make([]byte, 32*1024)
		c.Stream(func(w io.Writer) bool {
			n, readErr := counter.Read(buf)
			if n > 0 {
				if _, writeErr := w.Write(buf[:n]); writeErr != nil {
					streamErr = writeErr
					return false // client disconnected
				}
			}
			// io.EOF (clean end) or any read error stops the stream. A mid-stream
			// pg_dump failure surfaces here as a read error; headers are already
			// sent, so the client receives a truncated file.
			if readErr != nil && readErr != io.EOF {
				streamErr = readErr
			}
			return readErr == nil
		})

		if streamErr != nil {
			finish("error", streamErr.Error(), counter.n)
		} else {
			finish("ok", "", counter.n)
		}
	}
}

// RestoreAuditDetail mirrors DumpAuditDetail for the postgres_restore action.
// Records source filename, target database name, restored byte count, and the
// outcome so the dump-stats endpoint can later surface restore metrics if we
// want them.
type RestoreAuditDetail struct {
	ServerID      string `json:"server_id"`
	ContainerID   string `json:"container_id"`
	ContainerName string `json:"container_name,omitempty"`
	TargetDB      string `json:"target_database"`
	SourceFile    string `json:"source_file,omitempty"`
	SizeBytes     int64  `json:"size_bytes"`       // uploaded bytes; 0 on early failure
	Status        string `json:"status"`           // "ok" | "error"
	Error         string `json:"error,omitempty"`
	DurationMS    int64  `json:"duration_ms"`
}

func logRestoreResult(db *gorm.DB, c *gin.Context, d RestoreAuditDetail) {
	payload, err := json.Marshal(d)
	details := d.TargetDB
	if err == nil {
		details = string(payload)
	}
	_ = services.LogAction(db, c, "postgres_restore", "database", d.ServerID, d.TargetDB, details)
}

// RestorePostgresDump restores a dump file into a freshly-created database
// inside a PostgreSQL container.
//
// Accepts multipart/form-data with these fields:
//   - server_id        (required)
//   - container_id     (required)
//   - container_name   (optional; used to look up stored credentials)
//   - target_database  (required; must NOT already exist on the container)
//   - dump_file        (required; plain SQL or gzip-compressed — auto-detected)
//
// Refuses with 409 Conflict when target_database already exists so the user's
// existing data is never silently overwritten. The user is expected to pick a
// different name (the "rename on restore" flow). A 400 on validation failures,
// 500 on container/exec errors.
func RestorePostgresDump(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()

		serverID := c.PostForm("server_id")
		containerID := c.PostForm("container_id")
		containerName := c.PostForm("container_name")
		targetDB := c.PostForm("target_database")

		detail := RestoreAuditDetail{
			ServerID:      serverID,
			ContainerID:   containerID,
			ContainerName: containerName,
			TargetDB:      targetDB,
		}
		finish := func(status, errMsg string, size int64) {
			detail.Status = status
			detail.Error = errMsg
			detail.SizeBytes = size
			detail.DurationMS = time.Since(started).Milliseconds()
			logRestoreResult(db, c, detail)
		}

		if serverID == "" || containerID == "" || targetDB == "" {
			finish("error", "missing required field", 0)
			respondWithError(c, http.StatusBadRequest, "server_id, container_id, and target_database are required")
			return
		}

		fileHeader, err := c.FormFile("dump_file")
		if err != nil {
			finish("error", "missing dump_file: "+err.Error(), 0)
			respondWithError(c, http.StatusBadRequest, "dump_file (the uploaded .sql or .sql.gz) is required")
			return
		}
		detail.SourceFile = fileHeader.Filename

		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				finish("error", "server not found", 0)
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			finish("error", err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		creds, err := resolvePostgresCreds(db, serverID, containerName)
		if err != nil {
			finish("error", "failed to resolve credentials: "+err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		// Open the uploaded file. Gin spills large multipart parts to a temp
		// file on disk past MaxMultipartMemory (32MB by default), so memory
		// stays bounded even for multi-GB dumps.
		file, err := fileHeader.Open()
		if err != nil {
			finish("error", "failed to open upload: "+err.Error(), 0)
			respondWithError(c, http.StatusInternalServerError, "Failed to read uploaded file")
			return
		}
		defer file.Close()

		// Wrap so we can record the byte count in the audit row regardless of
		// whether the restore succeeded.
		counter := &countingReader{r: file}

		pgService := services.NewPostgresService()
		if err := pgService.RestoreDatabase(c.Request.Context(), &server, containerID, targetDB, counter, creds); err != nil {
			if err == services.ErrTargetDatabaseExists {
				finish("error", "target database already exists", counter.n)
				respondWithError(c, http.StatusConflict, fmt.Sprintf("Database %q already exists on this container — pick a different target name (rename the restore).", targetDB))
				return
			}
			finish("error", err.Error(), counter.n)
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}

		finish("ok", "", counter.n)
		c.JSON(http.StatusOK, gin.H{
			"status":          "success",
			"target_database": targetDB,
			"bytes_restored":  counter.n,
		})
	}
}

// GetPostgresContainerContext returns project + consumer + active-DB info for
// one postgres container — answers "what is this container used by, and which
// of its databases is the live one?" for the UI.
func GetPostgresContainerContext(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		containerID := c.Param("container_id")

		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		// Same credential chain as the other postgres endpoints — the context
		// service now queries pg_stat_database inside the container, so it needs
		// to authenticate the same way.
		creds, err := resolvePostgresCreds(db, serverID, c.Query("container_name"))
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to resolve credentials")
			return
		}

		svc := services.NewPostgresContextService()
		ctxOut, err := svc.GetContainerContext(c.Request.Context(), &server, containerID, creds)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.JSON(http.StatusOK, ctxOut)
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
