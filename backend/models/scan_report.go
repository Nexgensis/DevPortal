package models

import "time"

// ScanReport is one admin-registered security-scan source plus its latest fetched
// result. The CI/CD pipelines (SonarQube, Trivy, OWASP ZAP) upload scan JSON to a
// Sonatype Nexus raw repo under paths like <repo>/<branch>/<scanner>/...latest....json;
// the admin registers which (repo, branch, scanner, path) to watch and a background
// poller keeps ReportJSON fresh.
//
// Keyed uniquely by (RepoName, Branch, Scanner) so the same repo can have separate
// main / UAT (and per-scanner) reports.
type ScanReport struct {
	ID string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`

	// --- Config (admin-set) ---
	RepoName  string `gorm:"not null;uniqueIndex:idx_scan_repo_branch_scanner" json:"repoName"`
	Branch    string `gorm:"not null;uniqueIndex:idx_scan_repo_branch_scanner" json:"branch"`
	Scanner   string `gorm:"uniqueIndex:idx_scan_repo_branch_scanner" json:"scanner"` // e.g. trivy/zap/sonar (optional label)
	NexusRepo string `gorm:"not null" json:"nexusRepo"`                              // Nexus repository name (e.g. "sbom")
	ReportPath string `gorm:"not null" json:"reportPath"`                            // exact asset path or folder prefix to the "latest" json

	// --- Poller-filled (latest fetched result) ---
	ReportJSON   string     `gorm:"type:text" json:"reportJson,omitempty"` // raw scan JSON; omitted from list responses (large)
	AssetPath    string     `json:"assetPath"`                              // the actual asset path that was fetched
	LastModified *time.Time `json:"lastModified"`                           // asset's lastModified in Nexus
	FetchedAt    *time.Time `json:"fetchedAt"`                              // when we last successfully fetched
	Status       string     `gorm:"not null;default:'pending'" json:"status"` // pending | ok | error
	ErrorMsg     string     `json:"errorMsg,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
