package vault

import (
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"backend/models"
	vcrypto "backend/vault/crypto"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Hierarchy: Project (a client) → App (a service, holds the login URL) →
// Credentials (any number of accounts per app). Three fixed levels on
// purpose: arbitrary nesting would complicate search, moves and any future
// per-project permissions without serving a real need.

const (
	fieldPassword = "password"
	fieldNotes    = "notes"

	maxProjectName = 120
	maxDescription = 2000
	maxAppName     = 200
	maxURL         = 2048
	maxLabel       = 120
	maxUsername    = 512
	maxPasswordLen = 4096
	maxNotesLen    = 20000
)

func credAAD(id, field string) []byte { return vcrypto.AAD("credential", id, field) }

// ---- DTOs (never carry ciphertext) -------------------------------------------

type ProjectDTO struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	AppCount        int64  `json:"appCount"`
	CredentialCount int64  `json:"credentialCount"`
	// Access is the caller's level on the client as a whole: "admin", "edit",
	// "view", or "limited" (only some of its apps were shared with them).
	Access    string    `json:"access"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AppDTO struct {
	ID          string          `json:"id"`
	ProjectID   string          `json:"projectId"`
	Name        string          `json:"name"`
	LoginURL    string          `json:"loginUrl"`
	Description string          `json:"description"`
	UpdatedBy   string          `json:"updatedBy"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	Access      string          `json:"access"` // "admin" | "edit" | "view"
	Accounts    []CredentialDTO `json:"accounts"`
}

type CredentialDTO struct {
	ID        string    `json:"id"`
	AppID     string    `json:"appId"`
	Label     string    `json:"label"`
	Username  string    `json:"username"`
	HasNotes  bool      `json:"hasNotes"`
	UpdatedBy string    `json:"updatedBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ---- inputs -----------------------------------------------------------------

type ProjectInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type AppInput struct {
	Name        string `json:"name"`
	LoginURL    string `json:"loginUrl"`
	Description string `json:"description"`
}

type CredentialInput struct {
	Label    string          `json:"label"`
	Username string          `json:"username"`
	Password vcrypto.Secret  `json:"password"`
	Notes    *vcrypto.Secret `json:"notes"`
}

// CredentialUpdate: Password empty/absent keeps the stored password; Notes
// absent keeps the stored notes, "" clears them.
type CredentialUpdate struct {
	Label    string          `json:"label"`
	Username string          `json:"username"`
	Password *vcrypto.Secret `json:"password"`
	Notes    *vcrypto.Secret `json:"notes"`
}

// ---- validation -------------------------------------------------------------

func validText(name, v string, max int, required bool) (string, error) {
	v = strings.TrimSpace(v)
	if required && v == "" {
		return "", invalid("%s is required", name)
	}
	if !utf8.ValidString(v) {
		return "", invalid("%s must be valid text", name)
	}
	if utf8.RuneCountInString(v) > max {
		return "", invalid("%s must be at most %d characters", name, max)
	}
	return v, nil
}

// validURL allows only absolute http(s) URLs. The UI renders login URLs as
// links, so a javascript: or data: URL here would be stored XSS.
func validURL(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", nil
	}
	if len(v) > maxURL {
		return "", invalid("login URL must be at most %d characters", maxURL)
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", invalid("login URL must start with http:// or https://")
	}
	return v, nil
}

func validSecret(name string, s vcrypto.Secret, max int) error {
	if !utf8.ValidString(s.Reveal()) {
		return invalid("%s must be valid text", name)
	}
	if len(s.Reveal()) > max {
		return invalid("%s must be at most %d bytes", name, max)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func isUUID(s string) bool { _, err := uuid.Parse(s); return err == nil }

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func notFoundOr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}

// ---- projects -----------------------------------------------------------------

// visibleApp is the SQL condition "the caller may see app a". Admins see
// everything; others need an active grant on its client or on the app.
func (s *Service) visibleApp(a Actor, alias string) (string, []any) {
	if a.IsAdmin {
		return "TRUE", nil
	}
	return `EXISTS (SELECT 1 FROM vault_grants g WHERE g.user_id = ? AND g.project_id = ` + alias + `.project_id
		AND (g.app_id IS NULL OR g.app_id = ` + alias + `.id) AND (g.expires_at IS NULL OR g.expires_at > ?))`,
		[]any{a.UserID, s.now()}
}

// ListProjects lists the clients the caller can see. Counts and search only
// consider apps the caller can see, so neither leaks what's hidden.
func (s *Service) ListProjects(a Actor, search string) ([]ProjectDTO, error) {
	appVis, appArgs := s.visibleApp(a, "a")
	args := []any{}
	sql := `SELECT p.*, COALESCE(u.username, '') AS created_by_name,
		(SELECT count(*) FROM vault_apps a WHERE a.project_id = p.id AND ` + appVis + `) AS app_count,
		(SELECT count(*) FROM vault_credentials c JOIN vault_apps a ON a.id = c.app_id WHERE a.project_id = p.id AND ` + appVis + `) AS credential_count,
		(SELECT CASE WHEN bool_or(g.level = 'edit') THEN 'edit' WHEN count(*) > 0 THEN 'view' END
			FROM vault_grants g WHERE g.user_id = ? AND g.project_id = p.id AND g.app_id IS NULL
			AND (g.expires_at IS NULL OR g.expires_at > ?)) AS client_level
		FROM vault_projects p LEFT JOIN users u ON u.id = p.created_by WHERE TRUE`
	args = append(args, appArgs...)
	args = append(args, appArgs...)
	args = append(args, a.UserID, s.now())
	if !a.IsAdmin {
		sql += ` AND EXISTS (SELECT 1 FROM vault_grants g WHERE g.user_id = ? AND g.project_id = p.id
			AND (g.expires_at IS NULL OR g.expires_at > ?))`
		args = append(args, a.UserID, s.now())
	}
	if search = strings.TrimSpace(search); search != "" {
		like := "%" + escapeLike(strings.ToLower(search)) + "%"
		// Also match what's inside: searching "aws" finds the client holding
		// the AWS Console app, "deploy-bot" finds the client with that account.
		sql += ` AND (lower(p.name) LIKE ? OR lower(p.description) LIKE ?
			OR EXISTS (SELECT 1 FROM vault_apps a WHERE a.project_id = p.id AND ` + appVis + ` AND lower(a.name) LIKE ?)
			OR EXISTS (SELECT 1 FROM vault_credentials c JOIN vault_apps a ON a.id = c.app_id
			           WHERE a.project_id = p.id AND ` + appVis + ` AND (lower(c.label) LIKE ? OR lower(c.username) LIKE ?)))`
		args = append(args, like, like)
		args = append(args, appArgs...)
		args = append(args, like)
		args = append(args, appArgs...)
		args = append(args, like, like)
	}
	sql += ` ORDER BY lower(p.name)`
	var rows []struct {
		models.VaultProject
		AppCount        int64
		CredentialCount int64
		CreatedByName   string
		ClientLevel     *string
	}
	if err := s.db.Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ProjectDTO, len(rows))
	for i, r := range rows {
		access := "limited"
		switch {
		case a.IsAdmin:
			access = AccessAdmin.String()
		case r.ClientLevel != nil:
			access = *r.ClientLevel
		}
		out[i] = ProjectDTO{ID: r.ID, Name: r.Name, Description: r.Description, AppCount: r.AppCount,
			CredentialCount: r.CredentialCount, Access: access, CreatedBy: r.CreatedByName, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	}
	return out, nil
}

func validateProject(in ProjectInput) (ProjectInput, error) {
	var err error
	if in.Name, err = validText("project name", in.Name, maxProjectName, true); err != nil {
		return in, err
	}
	if in.Description, err = validText("description", in.Description, maxDescription, false); err != nil {
		return in, err
	}
	return in, nil
}

func (s *Service) CreateProject(a Actor, in ProjectInput) (ProjectDTO, error) {
	if err := requireAdmin(a); err != nil {
		return ProjectDTO{}, err
	}
	in, err := validateProject(in)
	if err != nil {
		return ProjectDTO{}, err
	}
	now := s.now()
	p := models.VaultProject{ID: uuid.NewString(), Name: in.Name, Description: in.Description,
		CreatedBy: a.UserID, UpdatedBy: a.UserID, CreatedAt: now, UpdatedAt: now}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&p).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionCreateProject, projectID: p.ID, details: map[string]any{"name": p.Name}})
	})
	if isUniqueViolation(err) {
		return ProjectDTO{}, &ConflictError{Msg: "a project with this name already exists"}
	}
	if err != nil {
		return ProjectDTO{}, err
	}
	return ProjectDTO{ID: p.ID, Name: p.Name, Description: p.Description, Access: AccessAdmin.String(), CreatedBy: a.Username, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}, nil
}

func (s *Service) UpdateProject(a Actor, id string, in ProjectInput) (ProjectDTO, error) {
	if err := requireAdmin(a); err != nil {
		return ProjectDTO{}, err
	}
	if !isUUID(id) {
		return ProjectDTO{}, ErrNotFound
	}
	in, err := validateProject(in)
	if err != nil {
		return ProjectDTO{}, err
	}
	var p models.VaultProject
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&p).Error; err != nil {
			return err
		}
		changes := map[string]any{}
		if p.Name != in.Name {
			changes["name"] = map[string]string{"from": p.Name, "to": in.Name}
		}
		if p.Description != in.Description {
			changes["description"] = true
		}
		p.Name, p.Description, p.UpdatedBy, p.UpdatedAt = in.Name, in.Description, a.UserID, s.now()
		if err := tx.Model(&models.VaultProject{}).Where("id = ?", id).UpdateColumns(map[string]any{
			"name": p.Name, "description": p.Description, "updated_by": p.UpdatedBy, "updated_at": p.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionUpdateProject, projectID: id, details: map[string]any{"name": p.Name, "changes": changes}})
	})
	switch {
	case isUniqueViolation(err):
		return ProjectDTO{}, &ConflictError{Msg: "a project with this name already exists"}
	case err != nil:
		return ProjectDTO{}, notFoundOr(err)
	}
	return ProjectDTO{ID: p.ID, Name: p.Name, Description: p.Description, Access: AccessAdmin.String(), CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}, nil
}

// DeleteProject refuses while the project still has apps, so a single
// misclick can't destroy a client's worth of secrets.
func (s *Service) DeleteProject(a Actor, id string) error {
	if err := requireAdmin(a); err != nil {
		return err
	}
	if !isUUID(id) {
		return ErrNotFound
	}
	return notFoundOr(s.db.Transaction(func(tx *gorm.DB) error {
		var p models.VaultProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&p).Error; err != nil {
			return err
		}
		var n int64
		if err := tx.Model(&models.VaultApp{}).Where("project_id = ?", id).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return &ConflictError{Msg: "delete this project's apps first"}
		}
		if err := tx.Where("id = ?", id).Delete(&models.VaultProject{}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionDeleteProject, projectID: id, details: map[string]any{"name": p.Name}})
	}))
}

// ---- apps -----------------------------------------------------------------------

// ListApps returns the client's apps the caller can see, each with its
// accounts (metadata only — the ciphertext columns are never selected) and
// the caller's access level on it.
func (s *Service) ListApps(a Actor, projectID string) ([]AppDTO, error) {
	if !isUUID(projectID) {
		return nil, ErrNotFound
	}
	var n int64
	if err := s.db.Model(&models.VaultProject{}).Where("id = ?", projectID).Count(&n).Error; err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}
	var grants []models.VaultGrant
	if !a.IsAdmin {
		var err error
		if grants, err = s.grantsOn(s.db, a, projectID); err != nil {
			return nil, err
		}
		if len(grants) == 0 {
			return nil, ErrNotFound
		}
	}
	appVis, appArgs := s.visibleApp(a, "a")

	var apps []struct {
		models.VaultApp
		UpdatedByName string
	}
	if err := s.db.Table("vault_apps a").
		Select("a.*, COALESCE(u.username, '') AS updated_by_name").
		Joins("LEFT JOIN users u ON u.id = a.updated_by").
		Where("a.project_id = ?", projectID).
		Where(appVis, appArgs...).
		Order("lower(a.name)").Scan(&apps).Error; err != nil {
		return nil, err
	}

	var creds []struct {
		ID, AppID, Label, Username string
		HasNotes                   bool
		UpdatedByName              string
		CreatedAt, UpdatedAt       time.Time
	}
	if err := s.db.Table("vault_credentials c").
		Select(`c.id, c.app_id, c.label, c.username, (c.notes_ct IS NOT NULL) AS has_notes,
			COALESCE(u.username, '') AS updated_by_name, c.created_at, c.updated_at`).
		Joins("JOIN vault_apps a ON a.id = c.app_id").
		Joins("LEFT JOIN users u ON u.id = c.updated_by").
		Where("a.project_id = ?", projectID).
		Where(appVis, appArgs...).
		Order("lower(c.label), lower(c.username), c.created_at").Scan(&creds).Error; err != nil {
		return nil, err
	}
	byApp := map[string][]CredentialDTO{}
	for _, c := range creds {
		byApp[c.AppID] = append(byApp[c.AppID], CredentialDTO{ID: c.ID, AppID: c.AppID, Label: c.Label, Username: c.Username,
			HasNotes: c.HasNotes, UpdatedBy: c.UpdatedByName, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt})
	}

	out := make([]AppDTO, len(apps))
	for i, app := range apps {
		accts := byApp[app.ID]
		if accts == nil {
			accts = []CredentialDTO{}
		}
		access := AccessAdmin
		if !a.IsAdmin {
			access = effective(grants, app.ID)
		}
		out[i] = AppDTO{ID: app.ID, ProjectID: app.ProjectID, Name: app.Name, LoginURL: app.LoginURL, Description: app.Description,
			UpdatedBy: app.UpdatedByName, CreatedAt: app.CreatedAt, UpdatedAt: app.UpdatedAt, Access: access.String(), Accounts: accts}
	}
	return out, nil
}

func validateApp(in AppInput) (AppInput, error) {
	var err error
	if in.Name, err = validText("app name", in.Name, maxAppName, true); err != nil {
		return in, err
	}
	if in.LoginURL, err = validURL(in.LoginURL); err != nil {
		return in, err
	}
	if in.Description, err = validText("description", in.Description, maxDescription, false); err != nil {
		return in, err
	}
	return in, nil
}

var errAppNameTaken = &ConflictError{Msg: "this project already has an app with that name"}

func (s *Service) CreateApp(a Actor, projectID string, in AppInput) (AppDTO, error) {
	if !isUUID(projectID) {
		return AppDTO{}, ErrNotFound
	}
	in, err := validateApp(in)
	if err != nil {
		return AppDTO{}, err
	}
	now := s.now()
	app := models.VaultApp{ID: uuid.NewString(), ProjectID: projectID, Name: in.Name, LoginURL: in.LoginURL,
		Description: in.Description, CreatedBy: a.UserID, UpdatedBy: a.UserID, CreatedAt: now, UpdatedAt: now}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var n int64
		if err := tx.Model(&models.VaultProject{}).Where("id = ?", projectID).Count(&n).Error; err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		if err := s.require(tx, a, projectID, "", AccessEdit); err != nil {
			return err
		}
		if err := tx.Create(&app).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionCreateApp, projectID: projectID, appID: app.ID,
			details: map[string]any{"appName": app.Name}})
	})
	if isUniqueViolation(err) {
		return AppDTO{}, errAppNameTaken
	}
	if err != nil {
		return AppDTO{}, err
	}
	return AppDTO{ID: app.ID, ProjectID: projectID, Name: app.Name, LoginURL: app.LoginURL, Description: app.Description,
		UpdatedBy: a.Username, CreatedAt: now, UpdatedAt: now, Access: AccessEdit.String(), Accounts: []CredentialDTO{}}, nil
}

func (s *Service) UpdateApp(a Actor, id string, in AppInput) (AppDTO, error) {
	if !isUUID(id) {
		return AppDTO{}, ErrNotFound
	}
	in, err := validateApp(in)
	if err != nil {
		return AppDTO{}, err
	}
	var app models.VaultApp
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&app).Error; err != nil {
			return err
		}
		if err := s.require(tx, a, app.ProjectID, app.ID, AccessEdit); err != nil {
			return err
		}
		changed := []string{}
		if app.Name != in.Name {
			changed = append(changed, "name")
		}
		if app.LoginURL != in.LoginURL {
			changed = append(changed, "loginUrl")
		}
		if app.Description != in.Description {
			changed = append(changed, "description")
		}
		app.Name, app.LoginURL, app.Description, app.UpdatedBy, app.UpdatedAt = in.Name, in.LoginURL, in.Description, a.UserID, s.now()
		if err := tx.Model(&models.VaultApp{}).Where("id = ?", id).UpdateColumns(map[string]any{
			"name": app.Name, "login_url": app.LoginURL, "description": app.Description,
			"updated_by": app.UpdatedBy, "updated_at": app.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionUpdateApp, projectID: app.ProjectID, appID: id,
			details: map[string]any{"appName": app.Name, "changed": changed}})
	})
	if isUniqueViolation(err) {
		return AppDTO{}, errAppNameTaken
	}
	if err != nil {
		return AppDTO{}, notFoundOr(err)
	}
	return AppDTO{ID: app.ID, ProjectID: app.ProjectID, Name: app.Name, LoginURL: app.LoginURL, Description: app.Description,
		UpdatedBy: a.Username, CreatedAt: app.CreatedAt, UpdatedAt: app.UpdatedAt}, nil
}

// DeleteApp refuses while the app still has accounts.
func (s *Service) DeleteApp(a Actor, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	return notFoundOr(s.db.Transaction(func(tx *gorm.DB) error {
		var app models.VaultApp
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&app).Error; err != nil {
			return err
		}
		// Deleting an app needs edit on the whole client; an app-level grant
		// lets you manage its accounts, not remove the app.
		if err := s.require(tx, a, app.ProjectID, "", AccessEdit); err != nil {
			if s.require(tx, a, app.ProjectID, app.ID, AccessView) == nil {
				return ErrForbidden
			}
			return ErrNotFound
		}
		var n int64
		if err := tx.Model(&models.VaultCredential{}).Where("app_id = ?", id).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			return &ConflictError{Msg: "delete this app's accounts first"}
		}
		if err := tx.Where("id = ?", id).Delete(&models.VaultApp{}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionDeleteApp, projectID: app.ProjectID, appID: id,
			details: map[string]any{"appName": app.Name}})
	}))
}

// ---- credentials (accounts) ------------------------------------------------------

// sealSecrets encrypts password (+ optional notes) for credential id with the
// active key. Each field gets its own nonce and its own AAD.
func (s *Service) sealSecrets(c *models.VaultCredential, password []byte, notes []byte, hasNotes bool) error {
	ps, err := s.cipher.Seal(password, credAAD(c.ID, fieldPassword))
	if err != nil {
		return err
	}
	c.PasswordCT, c.PasswordNonce, c.KeyVersion = ps.Ciphertext, ps.Nonce, ps.KeyVersion
	c.NotesCT, c.NotesNonce = nil, nil
	if hasNotes {
		ns, err := s.cipher.Seal(notes, credAAD(c.ID, fieldNotes))
		if err != nil {
			return err
		}
		c.NotesCT, c.NotesNonce = ns.Ciphertext, ns.Nonce
	}
	return nil
}

func (s *Service) loadApp(tx *gorm.DB, appID string) (models.VaultApp, error) {
	var app models.VaultApp
	err := tx.Select("id, project_id, name").Where("id = ?", appID).Take(&app).Error
	return app, err
}

func (s *Service) CreateCredential(a Actor, appID string, in CredentialInput) (CredentialDTO, error) {
	if !isUUID(appID) {
		return CredentialDTO{}, ErrNotFound
	}
	label, err := validText("label", in.Label, maxLabel, false)
	if err != nil {
		return CredentialDTO{}, err
	}
	username, err := validText("username", in.Username, maxUsername, false)
	if err != nil {
		return CredentialDTO{}, err
	}
	if in.Password.IsEmpty() {
		return CredentialDTO{}, invalid("password is required")
	}
	if err := validSecret("password", in.Password, maxPasswordLen); err != nil {
		return CredentialDTO{}, err
	}
	hasNotes := in.Notes != nil && !in.Notes.IsEmpty()
	if hasNotes {
		if err := validSecret("notes", *in.Notes, maxNotesLen); err != nil {
			return CredentialDTO{}, err
		}
	}

	now := s.now()
	// The id is generated here, not by the database, because it is part of
	// the AAD and must exist before encryption.
	c := models.VaultCredential{ID: uuid.NewString(), AppID: appID, Label: label, Username: username,
		CreatedBy: a.UserID, UpdatedBy: a.UserID, CreatedAt: now, UpdatedAt: now}
	var notes []byte
	if hasNotes {
		notes = []byte(in.Notes.Reveal())
	}
	if err := s.sealSecrets(&c, []byte(in.Password.Reveal()), notes, hasNotes); err != nil {
		return CredentialDTO{}, err
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		app, err := s.loadApp(tx, appID)
		if err != nil {
			return err
		}
		if err := s.require(tx, a, app.ProjectID, app.ID, AccessEdit); err != nil {
			return err
		}
		if err := tx.Create(&c).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionCreateCredential, projectID: app.ProjectID, appID: appID, credentialID: c.ID,
			details: map[string]any{"appName": app.Name, "label": label, "hasNotes": hasNotes}})
	})
	if err != nil {
		return CredentialDTO{}, notFoundOr(err)
	}
	return CredentialDTO{ID: c.ID, AppID: appID, Label: label, Username: username, HasNotes: hasNotes,
		UpdatedBy: a.Username, CreatedAt: now, UpdatedAt: now}, nil
}

// UpdateCredential always re-seals both secret fields with the active key —
// decrypting whichever one isn't being replaced — so a row never mixes key
// versions and every edit doubles as an opportunistic rotation.
func (s *Service) UpdateCredential(a Actor, id string, in CredentialUpdate) (CredentialDTO, error) {
	if !isUUID(id) {
		return CredentialDTO{}, ErrNotFound
	}
	label, err := validText("label", in.Label, maxLabel, false)
	if err != nil {
		return CredentialDTO{}, err
	}
	username, err := validText("username", in.Username, maxUsername, false)
	if err != nil {
		return CredentialDTO{}, err
	}
	newPassword := in.Password != nil && !in.Password.IsEmpty()
	if newPassword {
		if err := validSecret("password", *in.Password, maxPasswordLen); err != nil {
			return CredentialDTO{}, err
		}
	}
	if in.Notes != nil {
		if err := validSecret("notes", *in.Notes, maxNotesLen); err != nil {
			return CredentialDTO{}, err
		}
	}

	var c models.VaultCredential
	var hasNotes bool
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&c).Error; err != nil {
			return err
		}
		app, err := s.loadApp(tx, c.AppID)
		if err != nil {
			return err
		}
		if err := s.require(tx, a, app.ProjectID, app.ID, AccessEdit); err != nil {
			return err
		}
		changed := []string{}
		if c.Label != label {
			changed = append(changed, "label")
		}
		if c.Username != username {
			changed = append(changed, "username")
		}

		var password []byte
		if newPassword {
			password = []byte(in.Password.Reveal())
			changed = append(changed, "password")
		} else {
			if password, err = s.open(c, fieldPassword); err != nil {
				return err
			}
			defer vcrypto.Zero(password)
		}
		var notes []byte
		hadNotes := c.NotesCT != nil
		if in.Notes != nil {
			notes = []byte(in.Notes.Reveal())
			hasNotes = len(notes) > 0
			if hasNotes || hadNotes {
				changed = append(changed, "notes")
			}
		} else if hadNotes {
			if notes, err = s.open(c, fieldNotes); err != nil {
				return err
			}
			defer vcrypto.Zero(notes)
			hasNotes = true
		}

		c.Label, c.Username, c.UpdatedBy, c.UpdatedAt = label, username, a.UserID, s.now()
		if err := s.sealSecrets(&c, password, notes, hasNotes); err != nil {
			return err
		}
		if err := tx.Model(&models.VaultCredential{}).Where("id = ?", id).UpdateColumns(map[string]any{
			"label": c.Label, "username": c.Username,
			"password_ct": c.PasswordCT, "password_nonce": c.PasswordNonce,
			"notes_ct": c.NotesCT, "notes_nonce": c.NotesNonce, "key_version": c.KeyVersion,
			"updated_by": c.UpdatedBy, "updated_at": c.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionUpdateCredential, projectID: app.ProjectID, appID: app.ID, credentialID: id,
			details: map[string]any{"appName": app.Name, "label": c.Label, "changed": changed}})
	})
	if err != nil {
		return CredentialDTO{}, notFoundOr(err)
	}
	return CredentialDTO{ID: c.ID, AppID: c.AppID, Label: c.Label, Username: c.Username, HasNotes: hasNotes,
		UpdatedBy: a.Username, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt}, nil
}

// DeleteCredential hard-deletes: a deleted secret should be gone, not kept
// encrypted forever. The audit trail keeps ids and names (never the secret).
func (s *Service) DeleteCredential(a Actor, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	return notFoundOr(s.db.Transaction(func(tx *gorm.DB) error {
		var c models.VaultCredential
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id, app_id, label, username").Where("id = ?", id).Take(&c).Error; err != nil {
			return err
		}
		app, err := s.loadApp(tx, c.AppID)
		if err != nil {
			return err
		}
		if err := s.require(tx, a, app.ProjectID, app.ID, AccessEdit); err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&models.VaultCredential{}).Error; err != nil {
			return err
		}
		return s.audit(tx, a, auditEntry{action: ActionDeleteCredential, projectID: app.ProjectID, appID: app.ID, credentialID: id,
			details: map[string]any{"appName": app.Name, "label": c.Label, "username": c.Username}})
	}))
}

func (s *Service) open(c models.VaultCredential, field string) ([]byte, error) {
	sealed := vcrypto.Sealed{Ciphertext: c.PasswordCT, Nonce: c.PasswordNonce, KeyVersion: c.KeyVersion}
	if field == fieldNotes {
		if c.NotesCT == nil {
			return []byte{}, nil
		}
		sealed = vcrypto.Sealed{Ciphertext: c.NotesCT, Nonce: c.NotesNonce, KeyVersion: c.KeyVersion}
	}
	return s.cipher.Open(sealed, credAAD(c.ID, field))
}

// Reveal purposes, recorded distinctly in the audit trail.
const (
	PurposeView = "view"
	PurposeCopy = "copy"
)

// Reveal decrypts one field. The audit event is written in a transaction that
// must commit before the plaintext is returned: if the audit write fails, the
// caller gets an error and no secret (fail closed).
func (s *Service) Reveal(a Actor, id, field, purpose string) (string, error) {
	if !isUUID(id) {
		return "", ErrNotFound
	}
	var action string
	switch {
	case field == fieldPassword && purpose == PurposeView:
		action = ActionViewPassword
	case field == fieldPassword && purpose == PurposeCopy:
		action = ActionCopyPassword
	case field == fieldNotes && (purpose == PurposeView || purpose == PurposeCopy):
		action = ActionViewNotes
	default:
		return "", invalid("field must be password or notes, purpose must be view or copy")
	}

	var plain []byte
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var c models.VaultCredential
		if err := tx.Where("id = ?", id).Take(&c).Error; err != nil {
			return err
		}
		app, err := s.loadApp(tx, c.AppID)
		if err != nil {
			return err
		}
		if err := s.require(tx, a, app.ProjectID, app.ID, AccessView); err != nil {
			return err
		}
		pt, err := s.open(c, field)
		if err != nil {
			return err
		}
		plain = pt
		return s.audit(tx, a, auditEntry{action: action, projectID: app.ProjectID, appID: app.ID, credentialID: c.ID,
			details: map[string]any{"appName": app.Name, "label": c.Label, "username": c.Username, "purpose": purpose}})
	})
	if err != nil {
		vcrypto.Zero(plain)
		return "", notFoundOr(err)
	}
	out := string(plain)
	vcrypto.Zero(plain)
	return out, nil
}
