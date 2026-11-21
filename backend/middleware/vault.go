package middleware

import (
	"log"
	"net/http"
	"time"

	"backend/models"
	"backend/vault"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const vaultActorKey = "vault_actor"

// VaultConfigured answers 503 on every vault route when VAULT_KEYS isn't set,
// instead of taking the whole portal down for a feature not yet configured.
func VaultConfigured(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if svc == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "The password vault is not configured on this server (VAULT_KEYS).",
				"code":  "VAULT_NOT_CONFIGURED",
			})
			return
		}
		c.Next()
	}
}

// VaultMember lets in an active admin, or an active user holding at least one
// unexpired grant — both according to the *database*, not the JWT. The
// existing Admin() middleware trusts the token's role claim, so a demoted or
// deactivated admin keeps access until the token expires (up to 24h). For
// the vault that window is unacceptable, so role and grants are re-read on
// every request. What a member may see inside is decided per item by the
// vault service.
func VaultMember(db *gorm.DB, svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var user models.User
		q := db.Select("id, username, role, is_active")
		var err error
		if uid := c.GetString("user_id"); uid != "" {
			err = q.Where("id = ?", uid).Take(&user).Error
		} else {
			err = q.Where("username = ?", c.GetString("username")).Take(&user).Error
		}
		allowed := err == nil && user.IsActive && user.Role == "admin"
		if err == nil && user.IsActive && !allowed {
			ok, gerr := svc.HasAnyGrant(user.ID)
			if gerr != nil {
				log.Printf("vault: grant check failed for %s: %v", user.Username, gerr)
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
				return
			}
			allowed = ok
		}
		if !allowed {
			// Same answer for "no such user", "no access" and "deactivated":
			// nothing here should help an attacker enumerate accounts.
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "You don't have access to the vault", "code": "FORBIDDEN"})
			return
		}
		var exp time.Time
		if v, ok := c.Get("token_exp"); ok {
			exp, _ = v.(time.Time)
		}
		c.Set(vaultActorKey, vault.Actor{
			UserID:      user.ID,
			Username:    user.Username,
			IsAdmin:     user.Role == "admin",
			AuthMethod:  c.GetString("auth_method"),
			SessionID:   c.GetString("sid"),
			TokenExpiry: exp,
			IP:          c.ClientIP(),
			UserAgent:   c.GetHeader("User-Agent"),
		})
		c.Next()
	}
}

// VaultAdminOnly guards routes no grant can open: clients, grants, the full
// activity log and MFA resets. Runs after VaultMember.
func VaultAdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !VaultActor(c).IsAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admins only", "code": "FORBIDDEN"})
			return
		}
		c.Next()
	}
}

// VaultActor returns the actor set by VaultMember.
func VaultActor(c *gin.Context) vault.Actor {
	v, _ := c.Get(vaultActorKey)
	a, _ := v.(vault.Actor)
	return a
}

// RequireVaultUnlock gates everything that reads or changes vault data on a
// valid, unexpired, unrevoked MFA unlock for this exact login session. The
// UI reacts to code VAULT_LOCKED by opening the MFA prompt.
func RequireVaultUnlock(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		a := VaultActor(c)
		if a.SessionID == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": vault.ErrSessionUpgradeRequired.Error(), "code": "SESSION_UPGRADE_REQUIRED"})
			return
		}
		exp, ok, err := svc.UnlockExpiry(a.UserID, a.SessionID)
		if err != nil {
			log.Printf("vault: unlock check failed for %s: %v", a.Username, err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Vault is locked. Verify MFA to continue.", "code": "VAULT_LOCKED"})
			return
		}
		c.Header("X-Vault-Unlock-Expires", exp.UTC().Format(time.RFC3339))
		c.Next()
	}
}

// NoStore stops browsers and intermediaries from caching vault responses.
func NoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store, max-age=0")
		c.Header("Pragma", "no-cache")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	}
}
