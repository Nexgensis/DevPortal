package controllers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"backend/middleware"
	"backend/models"
	"backend/vault"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Vault HTTP handlers. Thin on purpose: parse input, call vault.Service,
// map errors. Business rules live in backend/vault.
//
// Never log request bodies or revealed values here. Errors are logged by
// type/message only; vault errors never contain secrets.

func vaultError(c *gin.Context, err error) {
	var ve *vault.ValidationError
	var ce *vault.ConflictError
	var lo *vault.LockedOutError
	switch {
	case errors.As(err, &ve):
		c.JSON(http.StatusBadRequest, gin.H{"error": ve.Msg, "code": "VALIDATION"})
	case errors.As(err, &ce):
		c.JSON(http.StatusConflict, gin.H{"error": ce.Msg, "code": "CONFLICT"})
	case errors.As(err, &lo):
		c.Header("Retry-After", strconv.Itoa(int(time.Until(lo.Until).Seconds())+1))
		c.JSON(http.StatusTooManyRequests, gin.H{"error": lo.Error(), "code": "MFA_LOCKED_OUT", "lockedOutUntil": lo.Until})
	case errors.Is(err, vault.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to do that.", "code": "FORBIDDEN"})
	case errors.Is(err, vault.ErrUseMicrosoft):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "USE_MICROSOFT"})
	case errors.Is(err, vault.ErrMicrosoftUnlockUnavailable):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "MICROSOFT_UNAVAILABLE"})
	case errors.Is(err, vault.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found", "code": "NOT_FOUND"})
	case errors.Is(err, vault.ErrInvalidCode):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "That code didn't work. Check your authenticator app and try again.", "code": "MFA_INVALID"})
	case errors.Is(err, vault.ErrSessionUpgradeRequired):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "SESSION_UPGRADE_REQUIRED"})
	case errors.Is(err, vault.ErrMFANotEnrolled):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "MFA_NOT_ENROLLED"})
	case errors.Is(err, vault.ErrMFAAlreadyEnrolled):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "MFA_ALREADY_ENROLLED"})
	case errors.Is(err, vault.ErrNoPendingEnrollment):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "MFA_NO_PENDING_ENROLLMENT"})
	case errors.Is(err, vault.ErrCannotResetSelf):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "VALIDATION"})
	default:
		log.Printf("vault: %s %s failed: %v", c.Request.Method, c.FullPath(), err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
	}
}

func bindJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		// Don't echo err: for a malformed body it can quote the input.
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "code": "VALIDATION"})
		return false
	}
	return true
}

// ---- MFA / unlock -------------------------------------------------------------

func VaultStatus(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		st, err := svc.Status(middleware.VaultActor(c))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, st)
	}
}

func VaultStartEnrollment(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		res, err := svc.StartEnrollment(middleware.VaultActor(c))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	}
}

type mfaCodeInput struct {
	Code         string `json:"code"`
	RecoveryCode string `json:"recoveryCode"`
}

func VaultConfirmEnrollment(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in mfaCodeInput
		if !bindJSON(c, &in) {
			return
		}
		res, err := svc.ConfirmEnrollment(middleware.VaultActor(c), in.Code)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	}
}

func VaultUnlock(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in mfaCodeInput
		if !bindJSON(c, &in) {
			return
		}
		res, err := svc.Unlock(middleware.VaultActor(c), in.Code, in.RecoveryCode)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	}
}

func VaultLock(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.Lock(middleware.VaultActor(c)); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// Logout ends the server-side parts of a login session (today: the vault
// unlock). The client still drops its token; the JWT itself remains valid
// until expiry for the rest of the app, as before.
func Logout(db *gorm.DB, svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		sid := c.GetString("sid")
		if svc == nil || sid == "" {
			c.Status(http.StatusNoContent)
			return
		}
		uid := c.GetString("user_id")
		username := c.GetString("username")
		if uid == "" {
			var u models.User
			if err := db.Select("id").Where("username = ?", username).Take(&u).Error; err == nil {
				uid = u.ID
			}
		}
		a := vault.Actor{UserID: uid, Username: username, SessionID: sid, IP: c.ClientIP(), UserAgent: c.GetHeader("User-Agent")}
		if err := svc.RevokeSession(a, "logout"); err != nil {
			log.Printf("logout: revoking vault unlock for %s: %v", username, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ---- projects ------------------------------------------------------------------

func VaultListProjects(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		ps, err := svc.ListProjects(middleware.VaultActor(c), c.Query("q"))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, ps)
	}
}

func VaultCreateProject(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.ProjectInput
		if !bindJSON(c, &in) {
			return
		}
		p, err := svc.CreateProject(middleware.VaultActor(c), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusCreated, p)
	}
}

func VaultUpdateProject(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.ProjectInput
		if !bindJSON(c, &in) {
			return
		}
		p, err := svc.UpdateProject(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, p)
	}
}

func VaultDeleteProject(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.DeleteProject(middleware.VaultActor(c), c.Param("id")); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ---- credentials ----------------------------------------------------------------

// ---- apps -----------------------------------------------------------------------

// VaultListApps returns a project's apps with their accounts nested
// (metadata only, never secrets).
func VaultListApps(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		apps, err := svc.ListApps(middleware.VaultActor(c), c.Param("id"))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, apps)
	}
}

func VaultCreateApp(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.AppInput
		if !bindJSON(c, &in) {
			return
		}
		app, err := svc.CreateApp(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusCreated, app)
	}
}

func VaultUpdateApp(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.AppInput
		if !bindJSON(c, &in) {
			return
		}
		app, err := svc.UpdateApp(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, app)
	}
}

func VaultDeleteApp(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.DeleteApp(middleware.VaultActor(c), c.Param("id")); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ---- credentials (accounts) ------------------------------------------------------

func VaultCreateCredential(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.CredentialInput
		if !bindJSON(c, &in) {
			return
		}
		cr, err := svc.CreateCredential(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusCreated, cr)
	}
}

func VaultUpdateCredential(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.CredentialUpdate
		if !bindJSON(c, &in) {
			return
		}
		cr, err := svc.UpdateCredential(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, cr)
	}
}

func VaultDeleteCredential(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.DeleteCredential(middleware.VaultActor(c), c.Param("id")); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

type revealInput struct {
	Field   string `json:"field"`   // "password" | "notes"
	Purpose string `json:"purpose"` // "view" | "copy"
}

// VaultReveal is POST (not GET) so the credential id + intent never sit in a
// URL that proxies or browser history might keep, and the response is
// no-store. The service has already committed the audit event by the time
// the value is written here.
func VaultReveal(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in revealInput
		if !bindJSON(c, &in) {
			return
		}
		value, err := svc.Reveal(middleware.VaultActor(c), c.Param("id"), in.Field, in.Purpose)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"field": in.Field, "value": value})
	}
}

// ---- audit + admin MFA ----------------------------------------------------------

func VaultListAudit(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		events, total, err := svc.ListAudit(vault.AuditQuery{
			CredentialID: c.Query("credentialId"),
			AppID:        c.Query("appId"),
			ProjectID:    c.Query("projectId"),
			ActorUserID:  c.Query("actorUserId"),
			Action:       c.Query("action"),
			Limit:        limit,
			Offset:       offset,
		})
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"events": events, "total": total})
	}
}

func VaultListMembers(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		admins, err := svc.ListMembers(middleware.VaultActor(c))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, admins)
	}
}

func VaultResetMFA(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.ResetMFA(middleware.VaultActor(c), c.Param("id")); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}
