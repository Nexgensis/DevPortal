package services

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"backend/models"

	"gorm.io/gorm"
)

// Security-scan reports are produced by CI/CD pipelines (SonarQube, Trivy, OWASP
// ZAP) and uploaded as JSON to a Sonatype Nexus raw repo. This service polls Nexus
// over its REST API and keeps each registered ScanReport's JSON fresh.
//
// Connection settings come from env (matches JWT_SECRET / ENCRYPTION_KEY):
//   NEXUS_URL   e.g. https://nexus.nexgensis.com
//   NEXUS_USER  basic-auth username
//   NEXUS_PASS  basic-auth password

const scanPollInterval = 5 * time.Minute

func nexusConfig() (baseURL, user, pass string, ok bool) {
	baseURL = strings.TrimRight(os.Getenv("NEXUS_URL"), "/")
	return baseURL, os.Getenv("NEXUS_USER"), os.Getenv("NEXUS_PASS"), baseURL != ""
}

func nexusHTTPClient() *http.Client { return &http.Client{Timeout: 30 * time.Second} }

type nexusAsset struct {
	DownloadURL  string     `json:"downloadUrl"`
	Path         string     `json:"path"`
	LastModified *time.Time `json:"lastModified"`
}

type nexusAssetsResp struct {
	Items             []nexusAsset `json:"items"`
	ContinuationToken string       `json:"continuationToken"`
}

// nexusListAssets returns every asset in a Nexus repository (paginated).
func nexusListAssets(httpc *http.Client, baseURL, user, pass, repo string) ([]nexusAsset, error) {
	var all []nexusAsset
	token := ""
	for {
		u := fmt.Sprintf("%s/service/rest/v1/assets?repository=%s", baseURL, url.QueryEscape(repo))
		if token != "" {
			u += "&continuationToken=" + url.QueryEscape(token)
		}
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		if user != "" {
			req.SetBasicAuth(user, pass)
		}
		resp, err := httpc.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("nexus assets list returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		}
		var r nexusAssetsResp
		if err := json.Unmarshal(body, &r); err != nil {
			return nil, fmt.Errorf("decode nexus assets: %w", err)
		}
		all = append(all, r.Items...)
		if r.ContinuationToken == "" {
			break
		}
		token = r.ContinuationToken
	}
	return all, nil
}

func filenameHasLatest(path string) bool {
	slash := strings.LastIndex(path, "/")
	return strings.Contains(strings.ToLower(path[slash+1:]), "latest")
}

// pickLatestAsset selects, among assets whose path starts with prefix, the one
// whose filename contains "latest"; ties (or none) fall back to newest lastModified.
// Nexus returns asset paths with a leading slash (e.g. "/Nexgensis/repo/x.json"),
// so both sides are normalized (leading slash trimmed) before matching.
func pickLatestAsset(assets []nexusAsset, prefix string) *nexusAsset {
	prefix = strings.TrimPrefix(prefix, "/")
	var best *nexusAsset
	for i := range assets {
		a := &assets[i]
		if !strings.HasPrefix(strings.TrimPrefix(a.Path, "/"), prefix) {
			continue
		}
		if best == nil {
			best = a
			continue
		}
		bl, al := filenameHasLatest(best.Path), filenameHasLatest(a.Path)
		if al != bl {
			if al {
				best = a
			}
			continue
		}
		if newerThan(a.LastModified, best.LastModified) {
			best = a
		}
	}
	return best
}

func newerThan(a, b *time.Time) bool {
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	return a.After(*b)
}

func nexusDownload(httpc *http.Client, downloadURL, user, pass string) ([]byte, error) {
	req, _ := http.NewRequest(http.MethodGet, downloadURL, nil)
	if user != "" {
		req.SetBasicAuth(user, pass)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// RefreshScanReport fetches the latest JSON for a single source and persists it.
// Used by the manual refresh endpoint; the poller uses the batched path below.
func RefreshScanReport(db *gorm.DB, s *models.ScanReport) error {
	baseURL, user, pass, ok := nexusConfig()
	if !ok {
		return fmt.Errorf("NEXUS_URL is not configured")
	}
	httpc := nexusHTTPClient()
	assets, err := nexusListAssets(httpc, baseURL, user, pass, s.NexusRepo)
	if err != nil {
		markScanError(db, s, err)
		return err
	}
	return applyLatest(db, httpc, user, pass, s, assets)
}

// applyLatest picks the best asset for a source from a pre-fetched asset list,
// downloads it if changed, and saves the row.
func applyLatest(db *gorm.DB, httpc *http.Client, user, pass string, s *models.ScanReport, assets []nexusAsset) error {
	best := pickLatestAsset(assets, s.ReportPath)
	if best == nil {
		err := fmt.Errorf("no asset under path %q in repo %q", s.ReportPath, s.NexusRepo)
		markScanError(db, s, err)
		return err
	}
	// Skip the download when nothing changed since the last successful fetch.
	if s.Status == "ok" && s.AssetPath == best.Path &&
		s.LastModified != nil && best.LastModified != nil && s.LastModified.Equal(*best.LastModified) {
		return nil
	}
	body, err := nexusDownload(httpc, best.DownloadURL, user, pass)
	if err != nil {
		markScanError(db, s, err)
		return err
	}
	now := time.Now()
	s.ReportJSON = string(body)
	s.AssetPath = best.Path
	s.LastModified = best.LastModified
	s.FetchedAt = &now
	s.Status = "ok"
	s.ErrorMsg = ""
	return db.Save(s).Error
}

func markScanError(db *gorm.DB, s *models.ScanReport, err error) {
	s.Status = "error"
	s.ErrorMsg = err.Error()
	db.Save(s)
}

// StartScanReportService launches the background poller (no-op if NEXUS_URL unset).
func StartScanReportService(db *gorm.DB) {
	baseURL, user, pass, ok := nexusConfig()
	if !ok {
		log.Println("Scan report service idle: NEXUS_URL not set")
		return
	}
	httpc := nexusHTTPClient()
	go func() {
		pollScanReports(db, httpc, baseURL, user, pass)
		ticker := time.NewTicker(scanPollInterval)
		for range ticker.C {
			pollScanReports(db, httpc, baseURL, user, pass)
		}
	}()
	log.Println("Scan report service started")
}

func pollScanReports(db *gorm.DB, httpc *http.Client, baseURL, user, pass string) {
	var sources []models.ScanReport
	if err := db.Find(&sources).Error; err != nil || len(sources) == 0 {
		return
	}
	// Group by Nexus repo so each repo is listed once per tick.
	byRepo := map[string][]int{}
	for i := range sources {
		byRepo[sources[i].NexusRepo] = append(byRepo[sources[i].NexusRepo], i)
	}
	for repo, idxs := range byRepo {
		assets, err := nexusListAssets(httpc, baseURL, user, pass, repo)
		if err != nil {
			for _, i := range idxs {
				markScanError(db, &sources[i], err)
			}
			continue
		}
		for _, i := range idxs {
			_ = applyLatest(db, httpc, user, pass, &sources[i], assets)
		}
	}
}
