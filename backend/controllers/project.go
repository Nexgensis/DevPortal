package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"backend/models"
)

func ListProjects(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var projects []models.Project
		db.Find(&projects)
		c.JSON(http.StatusOK, projects)
	}
}

func CreateProject(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input models.Project
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		db.Create(&input)
		c.JSON(http.StatusCreated, input)
	}
}

func UpdateProject(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var project models.Project
		if result := db.First(&project, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "Project not found")
			return
		}

		var input models.Project
		if err := c.ShouldBindJSON(&input); err != nil {
			respondWithError(c, http.StatusBadRequest, err.Error())
			return
		}

		db.Model(&project).Updates(input)
		c.JSON(http.StatusOK, project)
	}
}

func DeleteProject(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var project models.Project
		if result := db.First(&project, "id = ?", id); result.Error != nil {
			respondWithError(c, http.StatusNotFound, "Project not found")
			return
		}

		db.Delete(&project)
		c.JSON(http.StatusOK, gin.H{"message": "Project deleted successfully"})
	}
}
