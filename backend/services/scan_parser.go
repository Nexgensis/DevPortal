package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Parser layer for security scan reports. The nexus_service poller stores the
// raw scanner output verbatim on ScanReport.ReportJSON; this file turns that
// raw blob into a structured DTO that the frontend can render directly without
// having to know each scanner's format. Three scanners are supported with
// dedicated parsers (Trivy, OWASP ZAP, SonarQube); when the scanner label is
// empty or unrecognized, ParseReport falls back to format auto-detection.
//
// Parsers are intentionally lenient — they extract what they can and skip what
// they don't recognize rather than 500-ing on a slightly-unusual upload. The
// caller surfaces an empty/partial result if a parser couldn't find anything
// usable; it never crashes the request.

// Severity tier labels (normalized — Trivy uses uppercase, ZAP uses
// "High (Medium)" descriptors, Sonar uses lowercase).
const (
	SevCritical = "CRITICAL"
	SevHigh     = "HIGH"
	SevMedium   = "MEDIUM"
	SevLow      = "LOW"
	SevInfo     = "INFO"
	SevUnknown  = "UNKNOWN"
)

// SeverityCounts is the badge-matrix payload at the top of the dashboard.
type SeverityCounts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Info     int `json:"info"`
	Unknown  int `json:"unknown"`
}

// ParsedReport is the unified DTO returned by GET /scan-reports/:id/parsed.
// Exactly one of Trivy / Zap / Sonar will be populated (matching the source
// scanner); the others stay nil. Severity is always present (zero counts if
// no vulnerabilities found) so the frontend can render a stable badge row.
type ParsedReport struct {
	Scanner  string         `json:"scanner"`            // detected scanner family: "trivy" | "zap" | "sonar" | ""
	Status   string         `json:"status"`             // "ok" | "empty" | "unsupported"
	ErrorMsg string         `json:"errorMsg,omitempty"` // populated when status != "ok"
	Severity SeverityCounts `json:"severity"`
	Trivy    *TrivyParsed   `json:"trivy,omitempty"`
	Zap      *ZapParsed     `json:"zap,omitempty"`
	Sonar    *SonarParsed   `json:"sonar,omitempty"`
}

type TrivyParsed struct {
	ArtifactName    string          `json:"artifactName,omitempty"`
	ArtifactType    string          `json:"artifactType,omitempty"`
	Vulnerabilities []TrivyVuln     `json:"vulnerabilities"`
	SBOM            []SBOMComponent `json:"sbom"`
}

type TrivyVuln struct {
	ID           string `json:"id"`
	Severity     string `json:"severity"`
	Package      string `json:"package"`
	Version      string `json:"version"`
	FixedVersion string `json:"fixedVersion,omitempty"`
	Title        string `json:"title,omitempty"`
	Target       string `json:"target,omitempty"`
}

type SBOMComponent struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Type    string `json:"type,omitempty"`
}

type ZapParsed struct {
	Site   string     `json:"site,omitempty"`
	Alerts []ZapAlert `json:"alerts"`
}

type ZapAlert struct {
	Name       string `json:"name"`
	Risk       string `json:"risk"`        // High / Medium / Low / Informational
	Confidence string `json:"confidence"`  // High / Medium / Low
	Count      int    `json:"count"`       // # of instances
	Sample     string `json:"sample,omitempty"`
}

type SonarParsed struct {
	Metrics  []SonarMetric `json:"metrics"`
	Hotspots int           `json:"hotspots,omitempty"`
	Issues   int           `json:"issues,omitempty"`
	Lines    []string      `json:"lines,omitempty"` // raw lines we couldn't parse but should still display
}

type SonarMetric struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ParseReport dispatches to the right parser based on the scanner label, with
// auto-detection as a fallback. Returns a `status:"unsupported"` ParsedReport
// rather than an error when the format is unknown — the frontend will surface
// that gracefully.
func ParseReport(scanner string, raw string) *ParsedReport {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return &ParsedReport{Status: "empty", ErrorMsg: "report is empty"}
	}

	kind := normalizeScanner(scanner)
	if kind == "" {
		kind = detectScanner(raw)
	}

	switch kind {
	case "trivy":
		return parseTrivy(raw)
	case "zap":
		return parseZap(raw)
	case "sonar":
		return parseSonar(raw)
	default:
		return &ParsedReport{Scanner: "", Status: "unsupported", ErrorMsg: "could not detect scanner format from report content"}
	}
}

func normalizeScanner(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch {
	case strings.Contains(s, "trivy"):
		return "trivy"
	case strings.Contains(s, "zap") || strings.Contains(s, "owasp"):
		return "zap"
	case strings.Contains(s, "sonar"):
		return "sonar"
	}
	return ""
}

// detectScanner peeks at the raw report and returns "trivy" / "zap" / "sonar"
// based on shape: Trivy JSON has top-level "Results" or "ArtifactName"; ZAP
// JSON has "site" with "alerts" arrays; everything else falls back to Sonar
// (which uses text/key=value).
func detectScanner(raw string) string {
	if looksLikeJSON(raw) {
		// Heuristic on JSON content — cheaper than full parse.
		switch {
		case strings.Contains(raw, "\"VulnerabilityID\"") || strings.Contains(raw, "\"ArtifactName\"") || strings.Contains(raw, "\"SchemaVersion\""):
			return "trivy"
		case strings.Contains(raw, "\"site\"") && strings.Contains(raw, "\"alerts\""):
			return "zap"
		case strings.Contains(raw, "\"components\"") && strings.Contains(raw, "\"bomFormat\""):
			return "trivy" // CycloneDX SBOM — treat as Trivy SBOM-only
		}
	}
	// Fallback: text-style — Sonar reports are line-based.
	return "sonar"
}

func looksLikeJSON(raw string) bool {
	if raw == "" {
		return false
	}
	c := raw[0]
	return c == '{' || c == '['
}

// ────────────────────── Trivy ──────────────────────

// trivyDoc captures the fields we care about from a `trivy image -f json` or
// `trivy fs -f json` run. Extra fields are ignored; missing fields default.
type trivyDoc struct {
	ArtifactName string         `json:"ArtifactName"`
	ArtifactType string         `json:"ArtifactType"`
	Results      []trivyResult  `json:"Results"`
	// CycloneDX SBOM shape (when the upload is a pure SBOM, not a vuln scan):
	BomFormat  string         `json:"bomFormat"`
	Components []trivySBOMRaw `json:"components"`
}

type trivyResult struct {
	Target          string       `json:"Target"`
	Class           string       `json:"Class"`
	Type            string       `json:"Type"`
	Vulnerabilities []trivyVuln  `json:"Vulnerabilities"`
	Packages        []trivySBOMRaw `json:"Packages"`
}

type trivyVuln struct {
	VulnerabilityID  string `json:"VulnerabilityID"`
	PkgName          string `json:"PkgName"`
	InstalledVersion string `json:"InstalledVersion"`
	FixedVersion     string `json:"FixedVersion"`
	Severity         string `json:"Severity"`
	Title            string `json:"Title"`
}

type trivySBOMRaw struct {
	Name    string `json:"name"`    // CycloneDX uses lowercase
	Version string `json:"version"`
	Type    string `json:"type"`
	// Trivy's Packages[] uses CamelCase:
	NameCC    string `json:"Name"`
	VersionCC string `json:"Version"`
}

func parseTrivy(raw string) *ParsedReport {
	var doc trivyDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return &ParsedReport{Scanner: "trivy", Status: "unsupported", ErrorMsg: "trivy json malformed: " + err.Error()}
	}

	t := &TrivyParsed{
		ArtifactName: doc.ArtifactName,
		ArtifactType: doc.ArtifactType,
		Vulnerabilities: []TrivyVuln{},
		SBOM:            []SBOMComponent{},
	}
	sev := SeverityCounts{}

	// Vulnerabilities + Packages from a vuln-scan result file.
	for _, r := range doc.Results {
		for _, v := range r.Vulnerabilities {
			normSev := normalizeTrivySev(v.Severity)
			bumpSeverity(&sev, normSev)
			t.Vulnerabilities = append(t.Vulnerabilities, TrivyVuln{
				ID:           v.VulnerabilityID,
				Severity:     normSev,
				Package:      v.PkgName,
				Version:      v.InstalledVersion,
				FixedVersion: v.FixedVersion,
				Title:        v.Title,
				Target:       r.Target,
			})
		}
		for _, p := range r.Packages {
			name := p.NameCC
			if name == "" {
				name = p.Name
			}
			version := p.VersionCC
			if version == "" {
				version = p.Version
			}
			if name == "" {
				continue
			}
			t.SBOM = append(t.SBOM, SBOMComponent{Name: name, Version: version, Type: p.Type})
		}
	}

	// CycloneDX SBOM (when the upload is purely an SBOM document).
	for _, c := range doc.Components {
		name := c.Name
		if name == "" {
			name = c.NameCC
		}
		version := c.Version
		if version == "" {
			version = c.VersionCC
		}
		if name == "" {
			continue
		}
		t.SBOM = append(t.SBOM, SBOMComponent{Name: name, Version: version, Type: c.Type})
	}

	// Order vulns by severity (most severe first) then by package name.
	sort.SliceStable(t.Vulnerabilities, func(i, j int) bool {
		si, sj := severityRank(t.Vulnerabilities[i].Severity), severityRank(t.Vulnerabilities[j].Severity)
		if si != sj {
			return si < sj
		}
		return t.Vulnerabilities[i].Package < t.Vulnerabilities[j].Package
	})
	// Deduplicate SBOM by (name,version).
	t.SBOM = dedupeSBOM(t.SBOM)

	status := "ok"
	if len(t.Vulnerabilities) == 0 && len(t.SBOM) == 0 {
		status = "empty"
	}
	return &ParsedReport{Scanner: "trivy", Status: status, Severity: sev, Trivy: t}
}

func normalizeTrivySev(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	switch s {
	case "CRITICAL":
		return SevCritical
	case "HIGH":
		return SevHigh
	case "MEDIUM":
		return SevMedium
	case "LOW":
		return SevLow
	case "NEGLIGIBLE", "INFO", "INFORMATIONAL":
		return SevInfo
	}
	return SevUnknown
}

func severityRank(s string) int {
	switch s {
	case SevCritical:
		return 0
	case SevHigh:
		return 1
	case SevMedium:
		return 2
	case SevLow:
		return 3
	case SevInfo:
		return 4
	}
	return 5
}

func bumpSeverity(s *SeverityCounts, sev string) {
	switch sev {
	case SevCritical:
		s.Critical++
	case SevHigh:
		s.High++
	case SevMedium:
		s.Medium++
	case SevLow:
		s.Low++
	case SevInfo:
		s.Info++
	default:
		s.Unknown++
	}
}

func dedupeSBOM(in []SBOMComponent) []SBOMComponent {
	seen := map[string]bool{}
	out := make([]SBOMComponent, 0, len(in))
	for _, c := range in {
		key := c.Name + "@" + c.Version
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// ────────────────────── ZAP ──────────────────────

// zapDoc captures only the fields we render from an OWASP ZAP JSON report.
type zapDoc struct {
	Site []zapSite `json:"site"`
}

type zapSite struct {
	Name   string     `json:"@name"`
	Alerts []zapAlert `json:"alerts"`
}

type zapAlert struct {
	Name       string        `json:"name"`
	Alert      string        `json:"alert"`
	RiskDesc   string        `json:"riskdesc"`
	Confidence string        `json:"confidence"`
	Count      string        `json:"count"`
	Instances  []zapInstance `json:"instances"`
}

type zapInstance struct {
	URI    string `json:"uri"`
	Method string `json:"method"`
}

func parseZap(raw string) *ParsedReport {
	var doc zapDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return &ParsedReport{Scanner: "zap", Status: "unsupported", ErrorMsg: "zap json malformed: " + err.Error()}
	}

	z := &ZapParsed{Alerts: []ZapAlert{}}
	sev := SeverityCounts{}
	if len(doc.Site) > 0 {
		z.Site = doc.Site[0].Name
	}

	for _, site := range doc.Site {
		for _, a := range site.Alerts {
			risk := extractZapRisk(a.RiskDesc)
			normSev := zapRiskToSeverity(risk)
			bumpSeverity(&sev, normSev)

			name := a.Name
			if name == "" {
				name = a.Alert
			}
			count := 0
			fmt.Sscanf(a.Count, "%d", &count)
			if count == 0 && len(a.Instances) > 0 {
				count = len(a.Instances)
			}

			sample := ""
			if len(a.Instances) > 0 {
				sample = a.Instances[0].URI
			}
			z.Alerts = append(z.Alerts, ZapAlert{
				Name:       name,
				Risk:       risk,
				Confidence: a.Confidence,
				Count:      count,
				Sample:     sample,
			})
		}
	}

	sort.SliceStable(z.Alerts, func(i, j int) bool {
		si, sj := severityRank(zapRiskToSeverity(z.Alerts[i].Risk)), severityRank(zapRiskToSeverity(z.Alerts[j].Risk))
		if si != sj {
			return si < sj
		}
		return z.Alerts[i].Name < z.Alerts[j].Name
	})

	status := "ok"
	if len(z.Alerts) == 0 {
		status = "empty"
	}
	return &ParsedReport{Scanner: "zap", Status: status, Severity: sev, Zap: z}
}

// extractZapRisk pulls the leading risk label out of strings like
// "High (Medium)" → "High". Returns "Informational" for unknown values.
func extractZapRisk(riskDesc string) string {
	r := strings.TrimSpace(riskDesc)
	if p := strings.Index(r, "("); p > 0 {
		r = strings.TrimSpace(r[:p])
	}
	switch strings.ToLower(r) {
	case "high":
		return "High"
	case "medium":
		return "Medium"
	case "low":
		return "Low"
	case "informational", "info":
		return "Informational"
	}
	return "Informational"
}

func zapRiskToSeverity(risk string) string {
	switch strings.ToLower(risk) {
	case "high":
		return SevHigh
	case "medium":
		return SevMedium
	case "low":
		return SevLow
	case "informational", "info":
		return SevInfo
	}
	return SevUnknown
}

// ────────────────────── SonarQube ──────────────────────

// parseSonar handles the SonarQube text formats we've seen — typically
// key=value or "key: value" lines, sometimes a summary at the top. We also
// recognize common metric keys (bugs, vulnerabilities, security_hotspots,
// code_smells) and feed those into the Severity counts so the badge row still
// reads meaningfully on Sonar reports.
func parseSonar(raw string) *ParsedReport {
	s := &SonarParsed{Metrics: []SonarMetric{}, Lines: []string{}}
	sev := SeverityCounts{}

	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r ")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		k, v, ok := splitSonarKV(trimmed)
		if !ok {
			s.Lines = append(s.Lines, trimmed)
			continue
		}
		s.Metrics = append(s.Metrics, SonarMetric{Key: k, Value: v})
		switch strings.ToLower(k) {
		case "vulnerabilities", "critical_violations":
			n := 0
			fmt.Sscanf(v, "%d", &n)
			sev.Critical += n
		case "bugs", "blocker_violations", "major_violations":
			n := 0
			fmt.Sscanf(v, "%d", &n)
			sev.High += n
		case "code_smells", "minor_violations":
			n := 0
			fmt.Sscanf(v, "%d", &n)
			sev.Medium += n
		case "security_hotspots", "hotspots":
			n := 0
			fmt.Sscanf(v, "%d", &n)
			s.Hotspots += n
		case "issues":
			n := 0
			fmt.Sscanf(v, "%d", &n)
			s.Issues += n
		}
	}

	status := "ok"
	if len(s.Metrics) == 0 && len(s.Lines) == 0 {
		status = "empty"
	}
	return &ParsedReport{Scanner: "sonar", Status: status, Severity: sev, Sonar: s}
}

// splitSonarKV accepts "key=value", "key: value" or "key : value".
func splitSonarKV(line string) (string, string, bool) {
	for _, sep := range []string{"=", ":"} {
		if p := strings.Index(line, sep); p > 0 {
			k := strings.TrimSpace(line[:p])
			v := strings.TrimSpace(line[p+1:])
			if k != "" {
				return k, v, true
			}
		}
	}
	return "", "", false
}
