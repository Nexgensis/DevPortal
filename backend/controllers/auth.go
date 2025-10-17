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

type RegisterInput struct {
	Username        string `json:"username" binding:"required"`
	Email           string `json:"email" binding:"required,email"`
	Password        string `json:"password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
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

		log.Printf("Found user: %s, checking password", user.Username)
		if !utils.CheckPasswordHash(input.Password, user.PasswordHash) {
			log.Printf("Password check failed for user: %s", user.Username)
			respondWithError(c, http.StatusUnauthorized, "Invalid credentials")
			return
		}
		log.Printf("Login successful for user: %s", user.Username)

		expiresAt := time.Now().Add(time.Hour * 24).Unix()
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"username": user.Username,
			"role":     user.Role,
			"exp":      expiresAt,
		})

		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			secret = "YOUR_SECRET_KEY" // Fallback for development
		}
		tokenString, err := token.SignedString([]byte(secret))
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

func Logout(c *gin.Context) {
	// In a real application, you would typically invalidate the JWT token on the client-side
	// or implement a token blacklist on the server-side if necessary.
	// For this example, we'll just return a success message.
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func Register(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input RegisterInput
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return		}

		if input.Password != input.ConfirmPassword {
			respondWithError(c, http.StatusBadRequest, "Passwords do not match")
			return		}

		hashedPassword, err := utils.HashPassword(input.Password)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not hash password")
			return		}

		user := models.User{
			Username:     input.Username, 
			Email:        input.Email, 
			PasswordHash: hashedPassword,
			Role:         "user", // Default role
		}
		if result := db.Create(&user); result.Error != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not create user")
			return		}

		c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully"})
	}
}