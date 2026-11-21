package controllers

import (
	"net/http"

	"backend/middleware"
	"backend/vault"

	"github.com/gin-gonic/gin"
)

// ---- access grants (admin only) -------------------------------------------------

func VaultListGrants(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		gs, err := svc.ListGrants(middleware.VaultActor(c), c.Param("id"))
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, gs)
	}
}

func VaultSetGrant(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in vault.GrantInput
		if !bindJSON(c, &in) {
			return
		}
		g, err := svc.SetGrant(middleware.VaultActor(c), c.Param("id"), in)
		if err != nil {
			vaultError(c, err)
			return
		}
		c.JSON(http.StatusOK, g)
	}
}

func VaultRevokeGrant(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := svc.RevokeGrant(middleware.VaultActor(c), c.Param("id")); err != nil {
			vaultError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}
