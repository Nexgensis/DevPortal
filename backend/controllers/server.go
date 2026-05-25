package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"backend/models"
	"backend/services"
	"backend/utils"
)

// serverRequest is the inbound payload for creating/updating a server. The mTLS
// material arrives as raw PEM text; the client private key is encrypted before
// it ever touches the database.
type serverRequest struct {
	Name          string `json:"name"`
	Address       string `json:"address"`
	DockerAPIPort int    `json:"dockerApiPort"`
	TLSCA         string `json:"tlsCa"`
	TLSCert       string `json:"tlsCert"`
	TLSKey        string `json:"tlsKey"`
	// Optional server-level PostgreSQL superuser (fallback for hardened
	// containers). PGPassword is plain text on the wire, encrypted at rest.
	PGUser          string `json:"pgUser"`
	PGPassword      string `json:"pgPassword"`
	PGMaintenanceDB string `json:"pgMaintenanceDb"`
}

// markPGHasPassword sets the computed PGHasPassword flag (the encrypted secret
// itself is never serialized) so clients know whether a password is stored.
func markPGHasPassword(servers ...*models.Server) {
	for _, s := range servers {
		s.PGHasPassword = s.PGPasswordEncrypted != ""
	}
}

func ListServers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var servers []models.Server
		db.Find(&servers)
		for i := range servers {
			markPGHasPassword(&servers[i])
		}
		c.JSON(http.StatusOK, servers)
	}
}

func CreateServer(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input serverRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		if input.Name == "" || input.Address == "" {
			respondWithError(c, http.StatusBadRequest, "name and address are required")
			return
		}
		if input.TLSCA == "" || input.TLSCert == "" || input.TLSKey == "" {
			respondWithError(c, http.StatusBadRequest, "CA certificate, client certificate, and client private key are all required")
			return
		}

		// Encrypt the client private key at rest; CA and client cert stay plain.
		encKey, err := utils.Encrypt(input.TLSKey)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to encrypt client key")
			return
		}

		server := models.Server{
			Name:            input.Name,
			Address:         input.Address,
			DockerAPIPort:   input.DockerAPIPort,
			TLSCA:           input.TLSCA,
			TLSCert:         input.TLSCert,
			TLSKey:          encKey,
			PGUser:          input.PGUser,
			PGMaintenanceDB: input.PGMaintenanceDB,
		}
		if server.DockerAPIPort == 0 {
			server.DockerAPIPort = 2376
		}

		// Encrypt the optional server-level PG password at rest (when supplied).
		if input.PGPassword != "" {
			encPG, err := utils.Encrypt(input.PGPassword)
			if err != nil {
				respondWithError(c, http.StatusInternalServerError, "Failed to encrypt PostgreSQL password")
				return
			}
			server.PGPasswordEncrypted = encPG
		}

		// Probe connectivity before persisting.
		services.UpdateServerStatus(&server)

		if err := db.Create(&server).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to create server")
			return
		}

		markPGHasPassword(&server)
		c.JSON(http.StatusCreated, server)
	}
}

func UpdateServer(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var server models.Server
		if result := db.First(&server, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "Server not found")
			return
		}

		var input serverRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		if input.Name != "" {
			server.Name = input.Name
		}
		if input.Address != "" {
			server.Address = input.Address
		}
		if input.DockerAPIPort != 0 {
			server.DockerAPIPort = input.DockerAPIPort
		}
		if input.TLSCA != "" {
			server.TLSCA = input.TLSCA
		}
		if input.TLSCert != "" {
			server.TLSCert = input.TLSCert
		}
		// Only re-encrypt/replace the private key when a new one is supplied;
		// an empty field means "keep the existing key".
		if input.TLSKey != "" {
			encKey, err := utils.Encrypt(input.TLSKey)
			if err != nil {
				respondWithError(c, http.StatusInternalServerError, "Failed to encrypt client key")
				return
			}
			server.TLSKey = encKey
		}

		// Server-level PostgreSQL fallback creds (all optional, update-if-provided).
		if input.PGUser != "" {
			server.PGUser = input.PGUser
		}
		if input.PGMaintenanceDB != "" {
			server.PGMaintenanceDB = input.PGMaintenanceDB
		}
		// Only re-encrypt the PG password when a new one is supplied; empty = keep.
		if input.PGPassword != "" {
			encPG, err := utils.Encrypt(input.PGPassword)
			if err != nil {
				respondWithError(c, http.StatusInternalServerError, "Failed to encrypt PostgreSQL password")
				return
			}
			server.PGPasswordEncrypted = encPG
		}

		if err := db.Save(&server).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to update server")
			return
		}
		markPGHasPassword(&server)
		c.JSON(http.StatusOK, server)
	}
}

func DeleteServer(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var server models.Server
		if result := db.First(&server, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "Server not found")
			return
		}

		// Hard delete: physically remove the row (not GORM's default soft delete,
		// which only sets deleted_at). The apps.server_id foreign key would block
		// the delete, so remove the server's apps in the same transaction.
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Unscoped().Where("server_id = ?", id).Delete(&models.App{}).Error; err != nil {
				return err
			}
			return tx.Unscoped().Delete(&server).Error
		})
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to delete server")
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Server deleted successfully"})
	}
}

func TestServerConnection(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var server models.Server
		if result := db.First(&server, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "Server not found")
			return
		}

		services.UpdateServerStatus(&server)
		db.Save(&server)

		c.JSON(http.StatusOK, gin.H{
			"status":           server.Status,
			"runningAppsCount": server.RunningAppsCount,
			"lastChecked":      server.LastChecked,
		})
	}
}

func RefreshAllServers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var servers []models.Server
		db.Find(&servers)

		for i := range servers {
			services.UpdateServerStatus(&servers[i])
			db.Save(&servers[i])
			markPGHasPassword(&servers[i])
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "All servers refreshed",
			"servers": servers,
		})
	}
}
