package controllers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"backend/models"
	"backend/services"
	"backend/utils"
)

type CreateUserInput struct {
	Username string `json:"username" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	FullName string `json:"fullName"`
	Password string `json:"password" binding:"required,min=6"`
	Role     string `json:"role" binding:"required"`
}

type UpdateUserInput struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	FullName string `json:"fullName"`
	Role     string `json:"role"`
	IsActive *bool  `json:"isActive"`
}

func ListUsers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var users []models.User
		db.Find(&users)
		c.JSON(http.StatusOK, users)
	}
}

func CreateUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input CreateUserInput
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		// Check if username already exists. Unscoped so soft-deleted rows count:
		// DeleteUser only sets deleted_at, but the unique index on username still
		// covers those rows, so a scoped check would pass and the INSERT below
		// would then fail with an opaque 500.
		var existingUser models.User
		if err := db.Unscoped().Where("username = ?", input.Username).First(&existingUser).Error; err == nil {
			// A soft-deleted match looks identical to the admin (the name is not
			// in the user list), so spell that out in the log, not the response.
			if existingUser.DeletedAt.Valid {
				log.Printf("create user %q: username already exists on deleted user %s", input.Username, existingUser.ID)
			} else {
				log.Printf("create user %q: username already exists", input.Username)
			}
			respondWithError(c, http.StatusBadRequest, "Username already exists")
			return
		}

		// Hash password
		hashedPassword, err := utils.HashPassword(input.Password)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not hash password")
			return
		}

		user := models.User{
			Username:     input.Username,
			Email:        input.Email,
			FullName:     input.FullName,
			PasswordHash: hashedPassword,
			Role:         input.Role,
			IsActive:     true,
		}

		if err := db.Create(&user).Error; err != nil {
			log.Printf("create user %q: %v", input.Username, err)
			respondWithError(c, http.StatusInternalServerError, "Could not create user")
			return
		}

		// Log the action
		services.LogAction(db, c, "create_user", "user", user.ID, user.Username, "User created by admin")

		c.JSON(http.StatusCreated, user)
	}
}

func GetUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var user models.User
		if result := db.First(&user, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "User not found")
			return
		}
		c.JSON(http.StatusOK, user)
	}
}

func UpdateUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var user models.User
		if result := db.First(&user, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "User not found")
			return
		}

		var input UpdateUserInput
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		// Update fields
		if input.Username != "" {
			user.Username = input.Username
		}
		if input.Email != "" {
			user.Email = input.Email
		}
		if input.FullName != "" {
			user.FullName = input.FullName
		}
		if input.Role != "" {
			user.Role = input.Role
		}
		if input.IsActive != nil {
			user.IsActive = *input.IsActive
		}

		if err := db.Save(&user).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not update user")
			return
		}

		// Log the action
		services.LogAction(db, c, "update_user", "user", user.ID, user.Username, "User updated by admin")

		c.JSON(http.StatusOK, user)
	}
}

func DeleteUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var user models.User
		if result := db.First(&user, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "User not found")
			return
		}

		if err := db.Delete(&user).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not delete user")
			return
		}

		// Log the action
		services.LogAction(db, c, "delete_user", "user", user.ID, user.Username, "User deleted by admin")

		c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
	}
}

func GetAuditLogs(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Parse query parameters
		limitStr := c.DefaultQuery("limit", "50")
		offsetStr := c.DefaultQuery("offset", "0")
		userID := c.Query("userId")
		action := c.Query("action")
		resourceType := c.Query("resourceType")

		limit, _ := strconv.Atoi(limitStr)
		offset, _ := strconv.Atoi(offsetStr)

		logs, total, err := services.GetAuditLogs(db, limit, offset, userID, action, resourceType)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Could not fetch audit logs")
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"logs":   logs,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		})
	}
}