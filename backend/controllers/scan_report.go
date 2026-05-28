package controllers

import (
	"errors"
	"net/http"

	"backend/models"
	"backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListScanReports returns all registered scan-report sources WITHOUT the (large)
// ReportJSON body — the table only needs metadata.
func ListScanReports(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var reports []models.ScanReport
		if err := db.Order("repo_name, branch, scanner").Omit("report_json").Find(&reports).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch scan reports")
			return
		}
		c.JSON(http.StatusOK, gin.H{"reports": reports, "count": len(reports)})
	}
}

// GetScanReport returns a single source including its ReportJSON.
func GetScanReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var report models.ScanReport
		if err := db.First(&report, "id = ?", c.Param("id")).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Scan report not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch scan report")
			return
		}
		c.JSON(http.StatusOK, report)
	}
}

type scanSourceRequest struct {
	RepoName   string `json:"repoName" binding:"required"`
	Branch     string `json:"branch" binding:"required"`
	Scanner    string `json:"scanner"`
	NexusRepo  string `json:"nexusRepo" binding:"required"`
	ReportPath string `json:"reportPath" binding:"required"`
}

// CreateScanReport registers a new monitored source, then kicks off an immediate
// fetch so the row is populated without waiting for the next poll tick.
func CreateScanReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req scanSourceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}

		report := models.ScanReport{
			RepoName:   req.RepoName,
			Branch:     req.Branch,
			Scanner:    req.Scanner,
			NexusRepo:  req.NexusRepo,
			ReportPath: req.ReportPath,
			Status:     "pending",
		}
		if err := db.Create(&report).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to create scan report source (duplicate repo/branch/scanner?)")
			return
		}

		// Best-effort immediate fetch; errors are recorded on the row (Status=error).
		_ = services.RefreshScanReport(db, &report)

		services.LogAction(db, c, "scan_report_create", "scan_report", report.ID, report.RepoName,
			"Registered scan report source "+report.RepoName+"/"+report.Branch)

		c.JSON(http.StatusCreated, report)
	}
}

// RefreshScanReportHandler fetches the latest JSON for one source on demand.
func RefreshScanReportHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var report models.ScanReport
		if err := db.First(&report, "id = ?", c.Param("id")).Error; err != nil {
			respondWithError(c, http.StatusNotFound, "Scan report not found")
			return
		}
		if err := services.RefreshScanReport(db, &report); err != nil {
			respondWithError(c, http.StatusBadGateway, err.Error())
			return
		}
		c.JSON(http.StatusOK, report)
	}
}

// UpdateScanReport edits an existing source's config (any of repo/branch/scanner/
// nexusRepo/reportPath). When the config actually changes, the row is moved back
// to "pending" status and an immediate fetch is kicked off so the user doesn't
// have to wait for the next 5-min poll tick to see whether the new path works.
// Returns a 409 when the (repo,branch,scanner) triple would collide with another
// existing source.
func UpdateScanReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var existing models.ScanReport
		if err := db.First(&existing, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Scan report not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch scan report")
			return
		}

		var req scanSourceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}

		// Detect a config change so we know whether to reset status + re-fetch.
		configChanged := existing.RepoName != req.RepoName ||
			existing.Branch != req.Branch ||
			existing.Scanner != req.Scanner ||
			existing.NexusRepo != req.NexusRepo ||
			existing.ReportPath != req.ReportPath

		existing.RepoName = req.RepoName
		existing.Branch = req.Branch
		existing.Scanner = req.Scanner
		existing.NexusRepo = req.NexusRepo
		existing.ReportPath = req.ReportPath
		if configChanged {
			existing.Status = "pending"
			existing.ErrorMsg = ""
		}

		if err := db.Save(&existing).Error; err != nil {
			// The unique (repo,branch,scanner) index is the most common conflict.
			respondWithError(c, http.StatusConflict, "Failed to update (duplicate repo/branch/scanner?)")
			return
		}

		// Best-effort immediate refresh when anything changed.
		if configChanged {
			_ = services.RefreshScanReport(db, &existing)
		}

		services.LogAction(db, c, "scan_report_update", "scan_report", existing.ID, existing.RepoName,
			"Updated scan report source "+existing.RepoName+"/"+existing.Branch)

		c.JSON(http.StatusOK, existing)
	}
}

// GetParsedScanReport returns the structured DTO for a single source — Trivy
// severity counts + SBOM, ZAP alerts, or Sonar metrics — derived from the
// stored ReportJSON. Defensive by design: a malformed report yields a
// "unsupported" status in the response body, never a 500.
func GetParsedScanReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var report models.ScanReport
		if err := db.First(&report, "id = ?", c.Param("id")).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondWithError(c, http.StatusNotFound, "Scan report not found")
				return
			}
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch scan report")
			return
		}
		// If the poller never succeeded, surface that status without trying to
		// parse — there's nothing useful to parse.
		if report.Status != "ok" || report.ReportJSON == "" {
			c.JSON(http.StatusOK, gin.H{
				"sourceId":   report.ID,
				"repoName":   report.RepoName,
				"branch":     report.Branch,
				"scanner":    report.Scanner,
				"sourceStatus": report.Status,
				"errorMsg":   report.ErrorMsg,
				"parsed":     nil,
			})
			return
		}
		parsed := services.ParseReport(report.Scanner, report.ReportJSON)
		c.JSON(http.StatusOK, gin.H{
			"sourceId":     report.ID,
			"repoName":     report.RepoName,
			"branch":       report.Branch,
			"scanner":      report.Scanner,
			"sourceStatus": report.Status,
			"fetchedAt":    report.FetchedAt,
			"assetPath":    report.AssetPath,
			"parsed":       parsed,
		})
	}
}

// DeleteScanReport removes a monitored source.
func DeleteScanReport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		res := db.Where("id = ?", id).Delete(&models.ScanReport{})
		if res.Error != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to delete scan report")
			return
		}
		services.LogAction(db, c, "scan_report_delete", "scan_report", id, id, "Deleted scan report source "+id)
		c.JSON(http.StatusOK, gin.H{"status": "success", "deleted": res.RowsAffected})
	}
}
