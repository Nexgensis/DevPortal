package controllers

import (
	"errors"
	"net/http"
	"strings"

	"backend/models"
	"backend/services"
	"backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// postgresCredentialView is the client-facing shape of a stored credential —
// the encrypted password is never sent back, only a flag indicating one is set.
type postgresCredentialView struct {
	ContainerName string `json:"containerName"`
	DBUser        string `json:"dbUser"`
	DBName        string `json:"dbName"`
	HasPassword   bool   `json:"hasPassword"`
}

func toCredentialView(c models.PostgresCredential) postgresCredentialView {
	return postgresCredentialView{
		ContainerName: c.ContainerName,
		DBUser:        c.DBUser,
		DBName:        c.DBName,
		HasPassword:   c.DBPasswordEncrypted != "",
	}
}

// resolvePostgresCreds loads the Admin-configured credentials for a container
// (by name) and decrypts the password. Returns (nil, nil) when none are stored,
// so callers fall back to superuser auto-detection. containerName empty → nil.
func resolvePostgresCreds(db *gorm.DB, serverID, containerName string) (*services.PostgresCreds, error) {
	if strings.TrimSpace(containerName) == "" {
		return nil, nil
	}

	var cred models.PostgresCredential
	err := db.Where("server_id = ? AND container_name = ?", serverID, containerName).First(&cred).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	password := ""
	if cred.DBPasswordEncrypted != "" {
		decrypted, derr := utils.Decrypt(cred.DBPasswordEncrypted)
		if derr != nil {
			return nil, derr
		}
		password = decrypted
	}

	return &services.PostgresCreds{User: cred.DBUser, Password: password, DBName: cred.DBName}, nil
}

// ListPostgresCredentials returns all stored credentials for a server (without
// passwords). The frontend matches them to containers by name.
func ListPostgresCredentials(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")

		var creds []models.PostgresCredential
		if err := db.Where("server_id = ?", serverID).Find(&creds).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch credentials")
			return
		}

		views := make([]postgresCredentialView, 0, len(creds))
		for _, cred := range creds {
			views = append(views, toCredentialView(cred))
		}
		c.JSON(http.StatusOK, gin.H{"credentials": views})
	}
}

// upsertPostgresCredentialRequest is the body for creating/updating a credential.
// DBPassword is optional on update: when blank, the existing encrypted password
// is preserved (so editing user/db doesn't require re-entering the secret).
type upsertPostgresCredentialRequest struct {
	ContainerName string `json:"containerName" binding:"required"`
	DBUser        string `json:"dbUser" binding:"required"`
	DBName        string `json:"dbName" binding:"required"`
	DBPassword    string `json:"dbPassword"`
}

// UpsertPostgresCredential creates or updates the credential for (server, container).
func UpsertPostgresCredential(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")

		var req upsertPostgresCredentialRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}

		// Ensure the server exists.
		var server models.Server
		if err := db.First(&server, "id = ?", serverID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Server not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch server")
			return
		}

		// Find existing or start a new row.
		var cred models.PostgresCredential
		err := db.Where("server_id = ? AND container_name = ?", serverID, req.ContainerName).First(&cred).Error
		isNew := errors.Is(err, gorm.ErrRecordNotFound)
		if err != nil && !isNew {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch credential")
			return
		}

		cred.ServerID = serverID
		cred.ContainerName = req.ContainerName
		cred.DBUser = req.DBUser
		cred.DBName = req.DBName

		// Only (re)encrypt the password when a new one is supplied. On create with
		// no password, store an empty secret (trust/peer auth still works).
		if req.DBPassword != "" {
			encrypted, encErr := utils.Encrypt(req.DBPassword)
			if encErr != nil {
				respondWithError(c, http.StatusInternalServerError, "Failed to encrypt password")
				return
			}
			cred.DBPasswordEncrypted = encrypted
		}

		if err := db.Save(&cred).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to save credential")
			return
		}

		action := "postgres_credential_update"
		if isNew {
			action = "postgres_credential_create"
		}
		services.LogAction(db, c, action, "postgres_credential", req.ContainerName, req.ContainerName,
			"Saved PostgreSQL credentials for container "+req.ContainerName+" on server "+server.Name)

		c.JSON(http.StatusOK, gin.H{"credential": toCredentialView(cred)})
	}
}

// DeletePostgresCredential removes the stored credential for a container, so it
// reverts to superuser auto-detection.
func DeletePostgresCredential(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		serverID := c.Param("id")
		containerName := c.Param("container_name")

		res := db.Where("server_id = ? AND container_name = ?", serverID, containerName).
			Delete(&models.PostgresCredential{})
		if res.Error != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to delete credential")
			return
		}

		services.LogAction(db, c, "postgres_credential_delete", "postgres_credential", containerName, containerName,
			"Deleted PostgreSQL credentials for container "+containerName)

		c.JSON(http.StatusOK, gin.H{"status": "success", "deleted": res.RowsAffected})
	}
}
