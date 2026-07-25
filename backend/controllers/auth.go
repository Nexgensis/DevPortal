package controllers

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"backend/models"
	"backend/utils"
)

// Separate input structs for JSON binding, not models.User!
type LoginInput struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func Login(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input LoginInput
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		var user models.User
		if result := db.Where("username = ?", input.Username).First(&user); result.Error != nil {
			if result.Error == gorm.ErrRecordNotFound {
				log.Printf("User not found: %s", input.Username)
				respondWithError(c, http.StatusUnauthorized, "Invalid credentials")
			} else {
				log.Printf("Database error: %v", result.Error)
				respondWithError(c, http.StatusInternalServerError, "Database error")
			}
			return
		}

		if !utils.CheckPasswordHash(input.Password, user.PasswordHash) {
			log.Printf("Password check failed for user: %s", user.Username)
			respondWithError(c, http.StatusUnauthorized, "Invalid credentials")
			return
		}

		// A deactivated account must not be able to log in — otherwise the admin
		// UI's "active" toggle is decorative. Same generic message as a bad
		// password so the endpoint doesn't confirm which usernames exist.
		if !user.IsActive {
			log.Printf("Login refused for deactivated user: %s", user.Username)
			respondWithError(c, http.StatusUnauthorized, "Invalid credentials")
			return
		}

		// Record the successful login (column is last_login_at; see models.User).
		now := time.Now()
		db.Model(&user).UpdateColumn("last_login_at", now)
		log.Printf("Login successful for user: %s", user.Username)

		expiresAt := time.Now().Add(time.Hour * 24).Unix()
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"username": user.Username,
			"role":     user.Role,
			"exp":      expiresAt,
		})

		// No fallback: JWT_SECRET is validated at startup in main().
		tokenString, err := token.SignedString([]byte(os.Getenv("JWT_SECRET")))
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not generate token")
			return
		}

		c.JSON(http.StatusOK, gin.H{"token": tokenString})
	}
}

func Verify(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		username, exists := c.Get("username")
		if !exists {
			respondWithError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		// Get user details from database to get the role
		var user models.User
		if result := db.Where("username = ?", username).First(&user); result.Error != nil {
			respondWithError(c, http.StatusUnauthorized, "User not found")
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"username": user.Username,
				"role":     user.Role,
			},
		})
	}
}
