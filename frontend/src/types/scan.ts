// A registered security-scan source + its latest fetched report. The list
// endpoint omits `reportJson` (fetched via the detail endpoint when viewing).
export interface ScanReport {
  id: string;
  repoName: string;
  branch: string;
  scanner: string;
  nexusRepo: string;
  reportPath: string;
  reportJson?: string;
  assetPath?: string;
  lastModified?: string | null;
  fetchedAt?: string | null;
  status: 'pending' | 'ok' | 'error';
  errorMsg?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Payload to register a new monitored source.
export interface ScanSourceInput {
  repoName: string;
  branch: string;
  scanner?: string;
  nexusRepo: string;
  reportPath: string;
}

// ─── Parsed report DTO (matches backend services/scan_parser.go) ──────────

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unknown: number;
}

export interface TrivyVuln {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' | 'UNKNOWN';
  package: string;
  version: string;
  fixedVersion?: string;
  title?: string;
  target?: string;
}

export interface SBOMComponent {
  name: string;
  version: string;
  type?: string;
}

export interface TrivyParsed {
  artifactName?: string;
  artifactType?: string;
  vulnerabilities: TrivyVuln[];
  sbom: SBOMComponent[];
}

export interface ZapAlert {
  name: string;
  risk: string;       // "High" | "Medium" | "Low" | "Informational"
  confidence: string;
  count: number;
  sample?: string;
}

export interface ZapParsed {
  site?: string;
  alerts: ZapAlert[];
}

export interface SonarMetric {
  key: string;
  value: string;
}

export interface SonarParsed {
  metrics: SonarMetric[];
  hotspots?: number;
  issues?: number;
  lines?: string[];
}

// The unified DTO returned by GET /scan-reports/:id/parsed.
export interface ParsedReport {
  scanner: 'trivy' | 'zap' | 'sonar' | '';
  status: 'ok' | 'empty' | 'unsupported';
  errorMsg?: string;
  severity: SeverityCounts;
  trivy?: TrivyParsed;
  zap?: ZapParsed;
  sonar?: SonarParsed;
}

// Wrapper response from the endpoint — carries metadata about the source
// alongside the parsed payload.
export interface ParsedReportResponse {
  sourceId: string;
  repoName: string;
  branch: string;
  scanner: string;
  sourceStatus: 'pending' | 'ok' | 'error';
  errorMsg?: string;
  fetchedAt?: string | null;
  assetPath?: string;
  parsed: ParsedReport | null; // null when sourceStatus != 'ok'
}
