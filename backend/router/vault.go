package router

import (
	"time"

	"backend/controllers"
	"backend/middleware"
	"backend/vault"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// registerVaultRoutes mounts the password vault under /api/vault.
//
// Layers, outermost first:
//
//	JWT()                – valid session (from the parent group)
//	NoStore()            – nothing here may be cached
//	VaultConfigured()    – 503 until VAULT_KEYS is set
//	VaultMember()        – active admin, or active user with an unexpired grant,
//	                       per the DATABASE, not the token claim
//	RequireVaultUnlock() – MFA verified for this login session within 24h
//	VaultAdminOnly()     – on the admin-only group below
//
// Per-item access (which clients/apps a member sees) is enforced by the vault
// service itself, not here.
//
// Only status / enrollment / unlock / lock sit outside the unlock gate. Even
// project and app names are behind it: they tell an attacker what to target.
func registerVaultRoutes(api *gin.RouterGroup, db *gorm.DB, svc *vault.Service) {
	v := api.Group("/vault")
	v.Use(middleware.NoStore(), middleware.VaultConfigured(svc), middleware.VaultMember(db, svc))

	// 10 MFA attempts per IP per minute, on top of the per-user DB lockout
	// (5 failures / 15 min).
	mfaLimit := middleware.NewIPRateLimiter(10, time.Minute).Middleware()

	v.GET("/status", controllers.VaultStatus(svc))
	v.POST("/mfa/enroll", mfaLimit, controllers.VaultStartEnrollment(svc))
	v.POST("/mfa/enroll/confirm", mfaLimit, controllers.VaultConfirmEnrollment(svc))
	v.POST("/unlock", mfaLimit, controllers.VaultUnlock(svc))
	v.POST("/lock", controllers.VaultLock(svc))

	u := v.Group("")
	u.Use(middleware.RequireVaultUnlock(svc))

	// Members see and change only what their grants cover; the service checks
	// each item and answers 404 for anything outside them.
	u.GET("/projects", controllers.VaultListProjects(svc))
	u.GET("/projects/:id/apps", controllers.VaultListApps(svc)) // apps with accounts nested, no secrets
	u.POST("/projects/:id/apps", controllers.VaultCreateApp(svc))
	u.PUT("/apps/:id", controllers.VaultUpdateApp(svc))
	u.DELETE("/apps/:id", controllers.VaultDeleteApp(svc))
	u.POST("/apps/:id/credentials", controllers.VaultCreateCredential(svc))
	u.PUT("/credentials/:id", controllers.VaultUpdateCredential(svc))
	u.DELETE("/credentials/:id", controllers.VaultDeleteCredential(svc))
	u.POST("/credentials/:id/reveal", controllers.VaultReveal(svc))

	// Admin only: clients, who has access, the activity log, MFA resets.
	adm := u.Group("")
	adm.Use(middleware.VaultAdminOnly())
	adm.POST("/projects", controllers.VaultCreateProject(svc))
	adm.PUT("/projects/:id", controllers.VaultUpdateProject(svc))
	adm.DELETE("/projects/:id", controllers.VaultDeleteProject(svc))
	adm.GET("/projects/:id/grants", controllers.VaultListGrants(svc))
	adm.POST("/projects/:id/grants", controllers.VaultSetGrant(svc))
	adm.DELETE("/grants/:id", controllers.VaultRevokeGrant(svc))
	adm.GET("/audit", controllers.VaultListAudit(svc))
	adm.GET("/members", controllers.VaultListMembers(svc))
	adm.POST("/members/:id/mfa/reset", controllers.VaultResetMFA(svc))
}
