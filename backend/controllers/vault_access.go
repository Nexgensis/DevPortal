package controllers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

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

// ---- unlock with Microsoft ---------------------------------------------------------

// VaultStartMicrosoftUnlock returns the Microsoft sign-in URL for a step-up.
// prompt=login forces a real, fresh sign-in (MFA included) instead of silently
// reusing the browser's Microsoft session; auth_time is checked server-side.
// No max_age: with max_age=0 Entra issued ID tokens that expired the second
// they were issued, so every unlock was rejected as expired.
func VaultStartMicrosoftUnlock(svc *vault.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		st, err := svc.StartMicrosoftUnlock(middleware.VaultActor(c))
		if err != nil {
			vaultError(c, err)
			return
		}
		params := url.Values{}
		params.Set("client_id", os.Getenv("MICROSOFT_CLIENT_ID"))
		params.Set("response_type", "code")
		params.Set("redirect_uri", os.Getenv("MICROSOFT_REDIRECT_URI"))
		params.Set("response_mode", "query")
		params.Set("scope", "openid profile email")
		params.Set("state", st.State)
		params.Set("nonce", st.Nonce)
		params.Set("prompt", "login")
		params.Set("login_hint", st.LoginHint)
		// Ask for the Conditional Access authentication context (fresh
		// Authenticator approval every time), if configured.
		if cr := svc.EntraClaimsRequest(); cr != "" {
			params.Set("claims", cr)
		}
		authURL := fmt.Sprintf(microsoftAuthURL, os.Getenv("MICROSOFT_TENANT_ID")) + "?" + params.Encode()
		c.JSON(http.StatusOK, gin.H{"url": authURL})
	}
}

// VaultCodeExchange swaps an authorization code for an ID token. Exported as a
// variable only so tests can stand in for Microsoft.
var VaultCodeExchange = exchangeCodeForIDToken

// vaultStepUpCallback finishes an unlock with Microsoft. It shares the SSO
// redirect URI (so no extra Entra app registration change is needed);
// MicrosoftCallback hands over any state that starts with "vault.". The
// browser always lands back on the vault page with a short result code,
// never with a token or an error body.
func vaultStepUpCallback(c *gin.Context, svc *vault.Service) {
	back := func(q string) {
		front := os.Getenv("FRONTEND_URL")
		if front == "" {
			front = "http://localhost:5173"
		}
		c.Redirect(http.StatusFound, strings.TrimRight(front, "/")+"/vault?"+q)
	}
	state := c.Query("state")
	if svc == nil || !svc.MicrosoftUnlockAvailable() {
		back("unlock_error=unavailable")
		return
	}
	if !svc.StepUpPending(state) {
		back("unlock_error=expired")
		return
	}
	code := c.Query("code")
	var idToken string
	if code != "" {
		var err error
		if idToken, err = VaultCodeExchange(code); err != nil {
			log.Printf("vault: Microsoft code exchange failed: %v", err)
		}
	}
	// Even with no token (user cancelled, exchange failed) we complete the
	// attempt so it's consumed and the failure is in the audit trail.
	_, err := svc.CompleteMicrosoftUnlock(state, idToken, c.ClientIP(), c.GetHeader("User-Agent"))
	var se *vault.StepUpError
	switch {
	case err == nil:
		back("unlock=ok")
	case errors.As(err, &se):
		// The reason carries no secrets (claim names, the app id, booleans).
		log.Printf("vault: Microsoft unlock rejected: %s: %s", se.Code, se.Msg)
		if code == "" {
			back("unlock_error=cancelled")
			return
		}
		back("unlock_error=" + url.QueryEscape(se.Code))
	default:
		log.Printf("vault: Microsoft unlock failed: %v", err)
		back("unlock_error=server")
	}
}

func exchangeCodeForIDToken(code string) (string, error) {
	data := url.Values{}
	data.Set("client_id", os.Getenv("MICROSOFT_CLIENT_ID"))
	data.Set("client_secret", os.Getenv("MICROSOFT_CLIENT_SECRET"))
	data.Set("code", code)
	data.Set("redirect_uri", os.Getenv("MICROSOFT_REDIRECT_URI"))
	data.Set("grant_type", "authorization_code")
	data.Set("scope", "openid profile email")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.PostForm(fmt.Sprintf(microsoftTokenURL, os.Getenv("MICROSOFT_TENANT_ID")), data)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		// Log only Microsoft's error code, never the body (it can echo input).
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		return "", fmt.Errorf("token endpoint returned %d (%s)", resp.StatusCode, e.Error)
	}
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.IDToken == "" {
		return "", errors.New("no id_token in token response")
	}
	return tok.IDToken, nil
}
