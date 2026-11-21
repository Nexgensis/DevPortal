package vault

import (
	"encoding/json"
	"time"

	"backend/models"

	"gorm.io/gorm"
)

// Audit actions. Stable strings: reports and alerts key on them.
const (
	ActionMFAEnrollStarted = "MFA_ENROLL_STARTED"
	ActionMFAEnrolled      = "MFA_ENROLLED"
	ActionMFAVerified      = "MFA_VERIFIED"
	ActionMFAFailed        = "MFA_FAILED"
	ActionMFALockedOut     = "MFA_LOCKED_OUT"
	ActionRecoveryCodeUsed = "RECOVERY_CODE_USED"
	ActionMFAReset         = "MFA_RESET"
	ActionVaultLocked      = "VAULT_LOCKED"
	ActionViewPassword     = "VIEW_PASSWORD"
	ActionCopyPassword     = "COPY_PASSWORD"
	ActionViewNotes        = "VIEW_NOTES"
	ActionCreateCredential = "CREATE_CREDENTIAL"
	ActionUpdateCredential = "UPDATE_CREDENTIAL"
	ActionDeleteCredential = "DELETE_CREDENTIAL"
	ActionCreateProject    = "CREATE_PROJECT"
	ActionUpdateProject    = "UPDATE_PROJECT"
	ActionDeleteProject    = "DELETE_PROJECT"
	ActionCreateApp        = "CREATE_APP"
	ActionUpdateApp        = "UPDATE_APP"
	ActionDeleteApp        = "DELETE_APP"
	ActionKeyRotated       = "KEYS_ROTATED"
	ActionGrantAccess      = "GRANT_ACCESS"
	ActionUpdateGrant      = "UPDATE_ACCESS"
	ActionRevokeAccess     = "REVOKE_ACCESS"
)

type auditEntry struct {
	action       string
	projectID    string
	appID        string
	credentialID string
	targetUserID string
	details      map[string]any
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// audit appends one event inside tx. Callers run it in the same transaction
// as the change it describes, so the change and its record commit together —
// and a failed audit write aborts the operation (fail closed). Details must
// never contain secrets; only names, ids, field names and counts.
func (s *Service) audit(tx *gorm.DB, a Actor, e auditEntry) error {
	details := []byte("{}")
	if len(e.details) > 0 {
		b, err := json.Marshal(e.details)
		if err != nil {
			return err
		}
		details = b
	}
	ev := models.VaultAuditEvent{
		OccurredAt:    s.now().UTC(),
		ActorUserID:   strPtr(a.UserID),
		ActorUsername: a.Username,
		Action:        e.action,
		ProjectID:     strPtr(e.projectID),
		AppID:         strPtr(e.appID),
		CredentialID:  strPtr(e.credentialID),
		TargetUserID:  strPtr(e.targetUserID),
		IP:            a.IP,
		UserAgent:     truncate(a.UserAgent, 512),
		SessionID:     a.SessionID,
		Details:       details,
	}
	return tx.Create(&ev).Error
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// AuditQuery filters ListAudit.
type AuditQuery struct {
	CredentialID string
	ProjectID    string
	AppID        string
	ActorUserID  string
	Action       string
	Limit        int
	Offset       int
}

// AuditEventDTO is an audit row as returned to admins.
type AuditEventDTO struct {
	ID            int64           `json:"id"`
	OccurredAt    time.Time       `json:"occurredAt"`
	ActorUserID   *string         `json:"actorUserId"`
	ActorUsername string          `json:"actorUsername"`
	Action        string          `json:"action"`
	ProjectID     *string         `json:"projectId"`
	AppID         *string         `json:"appId"`
	CredentialID  *string         `json:"credentialId"`
	TargetUserID  *string         `json:"targetUserId"`
	IP            string          `json:"ip"`
	UserAgent     string          `json:"userAgent"`
	Details       json.RawMessage `json:"details"`
}

// ListAudit returns events newest first.
func (s *Service) ListAudit(q AuditQuery) ([]AuditEventDTO, int64, error) {
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 50
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	for _, id := range []string{q.CredentialID, q.ProjectID, q.AppID, q.ActorUserID} {
		if id != "" && !isUUID(id) {
			return nil, 0, invalid("filter ids must be UUIDs")
		}
	}
	db := s.db.Model(&models.VaultAuditEvent{})
	if q.CredentialID != "" {
		db = db.Where("credential_id = ?", q.CredentialID)
	}
	if q.ProjectID != "" {
		db = db.Where("project_id = ?", q.ProjectID)
	}
	if q.AppID != "" {
		db = db.Where("app_id = ?", q.AppID)
	}
	if q.ActorUserID != "" {
		db = db.Where("actor_user_id = ?", q.ActorUserID)
	}
	if q.Action != "" {
		db = db.Where("action = ?", q.Action)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []models.VaultAuditEvent
	if err := db.Order("occurred_at DESC, id DESC").Limit(q.Limit).Offset(q.Offset).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]AuditEventDTO, len(rows))
	for i, r := range rows {
		out[i] = AuditEventDTO{
			ID: r.ID, OccurredAt: r.OccurredAt, ActorUserID: r.ActorUserID, ActorUsername: r.ActorUsername,
			Action: r.Action, ProjectID: r.ProjectID, AppID: r.AppID, CredentialID: r.CredentialID, TargetUserID: r.TargetUserID,
			IP: r.IP, UserAgent: r.UserAgent, Details: r.Details,
		}
	}
	return out, total, nil
}
