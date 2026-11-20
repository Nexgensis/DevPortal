package vault

import (
	"errors"
	"strings"
	"time"

	"backend/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Access control.
//
// Admins see and change everything. Anyone else needs a grant:
//
//	grant on a client (app_id NULL) → every app and account in that client
//	grant on one app                → that app's accounts only
//
// Two levels: view (see, reveal, copy) and edit (also add/change/delete
// accounts; on a whole client also add/rename/delete apps). A grant can carry
// an end date, after which it simply stops matching. Everything else —
// creating clients, managing grants, the activity log, MFA resets — is
// admin-only.
//
// The checks live here, in the service, rather than in HTTP middleware,
// because only the service knows which client/app a credential id belongs to.
// Every list query is filtered by the same rule, and anything outside the
// caller's grants answers ErrNotFound so its existence isn't revealed.

type Access int

const (
	AccessNone Access = iota
	AccessView
	AccessEdit
	AccessAdmin
)

func (l Access) String() string {
	switch l {
	case AccessView:
		return "view"
	case AccessEdit:
		return "edit"
	case AccessAdmin:
		return "admin"
	}
	return "none"
}

// Grant levels as stored.
const (
	LevelView = "view"
	LevelEdit = "edit"
)

func levelAccess(l string) Access {
	switch l {
	case LevelEdit:
		return AccessEdit
	case LevelView:
		return AccessView
	}
	return AccessNone
}

var ErrForbidden = errors.New("you don't have permission to do that")

func requireAdmin(a Actor) error {
	if !a.IsAdmin {
		return ErrForbidden
	}
	return nil
}

// grantsOn returns the caller's active grants in one client.
func (s *Service) grantsOn(tx *gorm.DB, a Actor, projectID string) ([]models.VaultGrant, error) {
	var gs []models.VaultGrant
	err := tx.Where("user_id = ? AND project_id = ? AND (expires_at IS NULL OR expires_at > ?)",
		a.UserID, projectID, s.now()).Find(&gs).Error
	return gs, err
}

// effective folds grants into the access level for (client, app). appID ""
// asks about the client as a whole, where only client-wide grants count.
func effective(gs []models.VaultGrant, appID string) Access {
	best := AccessNone
	for _, g := range gs {
		if g.AppID != nil && (appID == "" || *g.AppID != appID) {
			continue
		}
		if l := levelAccess(g.Level); l > best {
			best = l
		}
	}
	return best
}

// require checks the caller has at least `need` on (projectID, appID).
// Callers resolve projectID/appID from the row being touched, inside the same
// transaction, so a crafted id can't point the check at something else.
func (s *Service) require(tx *gorm.DB, a Actor, projectID, appID string, need Access) error {
	if a.IsAdmin {
		return nil
	}
	gs, err := s.grantsOn(tx, a, projectID)
	if err != nil {
		return err
	}
	if effective(gs, appID) >= need {
		return nil
	}
	// Can they see the thing at all? Then it's a 403; otherwise pretend it
	// doesn't exist. An app-level grant on a sibling app doesn't reveal
	// this app.
	switch {
	case appID == "" && len(gs) > 0:
		return ErrForbidden
	case appID != "" && effective(gs, appID) > AccessNone:
		return ErrForbidden
	}
	return ErrNotFound
}

// HasAnyGrant reports whether a non-admin may enter the vault at all.
func (s *Service) HasAnyGrant(userID string) (bool, error) {
	var n int64
	err := s.db.Model(&models.VaultGrant{}).
		Where("user_id = ? AND (expires_at IS NULL OR expires_at > ?)", userID, s.now()).
		Limit(1).Count(&n).Error
	return n > 0, err
}

// ---- grant management (admin only) -------------------------------------------

type GrantInput struct {
	UserID    string     `json:"userId"`
	AppID     string     `json:"appId"` // "" = the whole client
	Level     string     `json:"level"` // view | edit
	ExpiresAt *time.Time `json:"expiresAt"`
}

type GrantDTO struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	Username  string     `json:"username"`
	FullName  string     `json:"fullName"`
	ProjectID string     `json:"projectId"`
	AppID     *string    `json:"appId"`
	AppName   string     `json:"appName"`
	Level     string     `json:"level"`
	ExpiresAt *time.Time `json:"expiresAt"`
	Expired   bool       `json:"expired"`
	GrantedBy string     `json:"grantedBy"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// ListGrants shows everyone with access to a client, including expired
// grants (flagged) so an admin can see what lapsed.
func (s *Service) ListGrants(a Actor, projectID string) ([]GrantDTO, error) {
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	if !isUUID(projectID) {
		return nil, ErrNotFound
	}
	var rows []struct {
		models.VaultGrant
		Username, FullName, AppName, GrantedBy string
	}
	err := s.db.Table("vault_grants g").
		Select(`g.*, u.username, u.full_name, COALESCE(a.name, '') AS app_name, COALESCE(gb.username, '') AS granted_by`).
		Joins("JOIN users u ON u.id = g.user_id").
		Joins("LEFT JOIN vault_apps a ON a.id = g.app_id").
		Joins("LEFT JOIN users gb ON gb.id = g.created_by").
		Where("g.project_id = ? AND u.deleted_at IS NULL", projectID).
		Order("lower(u.username), a.name NULLS FIRST").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := make([]GrantDTO, len(rows))
	for i, r := range rows {
		out[i] = GrantDTO{ID: r.ID, UserID: r.UserID, Username: r.Username, FullName: r.FullName, ProjectID: r.ProjectID,
			AppID: r.AppID, AppName: r.AppName, Level: r.Level, ExpiresAt: r.ExpiresAt,
			Expired: r.ExpiresAt != nil && !r.ExpiresAt.After(now), GrantedBy: r.GrantedBy, UpdatedAt: r.UpdatedAt}
	}
	return out, nil
}

// SetGrant gives a user access to a client or one of its apps, or changes
// the level/end date of the access they already have at that scope.
func (s *Service) SetGrant(a Actor, projectID string, in GrantInput) (GrantDTO, error) {
	if err := requireAdmin(a); err != nil {
		return GrantDTO{}, err
	}
	if !isUUID(projectID) {
		return GrantDTO{}, ErrNotFound
	}
	if levelAccess(in.Level) == AccessNone {
		return GrantDTO{}, invalid("level must be view or edit")
	}
	if !isUUID(in.UserID) {
		return GrantDTO{}, invalid("choose a person")
	}
	in.AppID = strings.TrimSpace(in.AppID)
	if in.AppID != "" && !isUUID(in.AppID) {
		return GrantDTO{}, invalid("unknown app")
	}
	now := s.now()
	if in.ExpiresAt != nil {
		if !in.ExpiresAt.After(now) {
			return GrantDTO{}, invalid("the end date must be in the future")
		}
		t := in.ExpiresAt.UTC().Truncate(time.Microsecond)
		in.ExpiresAt = &t
	}

	var g models.VaultGrant
	var target models.User
	var appName string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var p models.VaultProject
		if err := tx.Select("id, name").Where("id = ?", projectID).Take(&p).Error; err != nil {
			return err
		}
		if err := tx.Select("id, username, full_name, role, is_active").Where("id = ?", in.UserID).Take(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return invalid("that person doesn't exist")
			}
			return err
		}
		if target.Role == "admin" {
			return invalid("%s is an admin and already has access to everything", target.Username)
		}
		if !target.IsActive {
			return invalid("%s's account is deactivated", target.Username)
		}
		var appID *string
		if in.AppID != "" {
			var app models.VaultApp
			if err := tx.Select("id, project_id, name").Where("id = ? AND project_id = ?", in.AppID, projectID).Take(&app).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return invalid("that app isn't in this client")
				}
				return err
			}
			appID, appName = &app.ID, app.Name
		}

		q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND project_id = ?", in.UserID, projectID)
		if appID == nil {
			q = q.Where("app_id IS NULL")
		} else {
			q = q.Where("app_id = ?", *appID)
		}
		err := q.Take(&g).Error
		action := ActionUpdateGrant
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			action = ActionGrantAccess
			g = models.VaultGrant{ID: uuid.NewString(), UserID: in.UserID, ProjectID: projectID, AppID: appID,
				Level: in.Level, ExpiresAt: in.ExpiresAt, CreatedBy: a.UserID, CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&g).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			g.Level, g.ExpiresAt, g.CreatedBy, g.UpdatedAt = in.Level, in.ExpiresAt, a.UserID, now
			if err := tx.Model(&models.VaultGrant{}).Where("id = ?", g.ID).UpdateColumns(map[string]any{
				"level": g.Level, "expires_at": g.ExpiresAt, "created_by": g.CreatedBy, "updated_at": g.UpdatedAt,
			}).Error; err != nil {
				return err
			}
		}
		scope := "client " + p.Name
		if appID != nil {
			scope = "app " + appName
		}
		return s.audit(tx, a, auditEntry{action: action, projectID: projectID, appID: in.AppID, targetUserID: target.ID,
			details: map[string]any{"targetUsername": target.Username, "level": g.Level, "scope": scope, "expiresAt": g.ExpiresAt}})
	})
	if isUniqueViolation(err) {
		return GrantDTO{}, &ConflictError{Msg: "someone else just changed this person's access; reload and try again"}
	}
	if err != nil {
		return GrantDTO{}, notFoundOr(err)
	}
	return GrantDTO{ID: g.ID, UserID: target.ID, Username: target.Username, FullName: target.FullName, ProjectID: projectID,
		AppID: g.AppID, AppName: appName, Level: g.Level, ExpiresAt: g.ExpiresAt, GrantedBy: a.Username, UpdatedAt: g.UpdatedAt}, nil
}

// RevokeGrant removes access immediately: the next request by that person is
// checked against the grants table and fails.
func (s *Service) RevokeGrant(a Actor, grantID string) error {
	if err := requireAdmin(a); err != nil {
		return err
	}
	if !isUUID(grantID) {
		return ErrNotFound
	}
	return notFoundOr(s.db.Transaction(func(tx *gorm.DB) error {
		var g models.VaultGrant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", grantID).Take(&g).Error; err != nil {
			return err
		}
		var username string
		tx.Model(&models.User{}).Unscoped().Where("id = ?", g.UserID).Pluck("username", &username)
		if err := tx.Where("id = ?", grantID).Delete(&models.VaultGrant{}).Error; err != nil {
			return err
		}
		appID := ""
		if g.AppID != nil {
			appID = *g.AppID
		}
		return s.audit(tx, a, auditEntry{action: ActionRevokeAccess, projectID: g.ProjectID, appID: appID, targetUserID: g.UserID,
			details: map[string]any{"targetUsername": username, "level": g.Level}})
	}))
}
