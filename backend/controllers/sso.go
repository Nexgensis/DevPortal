package controllers

import (
	"backend/models"
	"backend/services"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

// Microsoft OAuth endpoints
const (
	microsoftAuthURL  = "https://login.microsoftonline.com/%s/oauth2/v2.0/authorize"
	microsoftTokenURL = "https://login.microsoftonline.com/%s/oauth2/v2.0/token"
	microsoftUserURL  = "https://graph.microsoft.com/v1.0/me"
)

// MicrosoftUserInfo represents the user info from Microsoft Graph API
type MicrosoftUserInfo struct {
	ID                string `json:"id"`
	DisplayName       string `json:"displayName"`
	GivenName         string `json:"givenName"`
	Surname           string `json:"surname"`
	UserPrincipalName string `json:"userPrincipalName"`
	Mail              string `json:"mail"`
}

// Generate random state for OAuth
func generateState() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

// MicrosoftLogin initiates the Microsoft OAuth flow
func MicrosoftLogin(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check if SSO is enabled
		if os.Getenv("SSO_ENABLED") != "true" {
			respondWithError(c, http.StatusForbidden, "SSO is not enabled")
			return
		}

		tenantID := os.Getenv("MICROSOFT_TENANT_ID")
		clientID := os.Getenv("MICROSOFT_CLIENT_ID")
		redirectURI := os.Getenv("MICROSOFT_REDIRECT_URI")

		if tenantID == "" || clientID == "" || redirectURI == "" {
			respondWithError(c, http.StatusInternalServerError, "SSO configuration is incomplete")
			return
		}

		// Generate and store state
		state := generateState()
		c.SetCookie("oauth_state", state, 600, "/", "", false, true)

		// Build authorization URL
		authURL := fmt.Sprintf(microsoftAuthURL, tenantID)
		params := url.Values{}
		params.Add("client_id", clientID)
		params.Add("response_type", "code")
		params.Add("redirect_uri", redirectURI)
		params.Add("response_mode", "query")
		params.Add("scope", "openid profile email User.Read")
		params.Add("state", state)

		redirectURL := authURL + "?" + params.Encode()
		c.JSON(http.StatusOK, gin.H{
			"url": redirectURL,
		})
	}
}

// MicrosoftCallback handles the OAuth callback
func MicrosoftCallback(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Verify state
		state := c.Query("state")
		storedState, err := c.Cookie("oauth_state")
		if err != nil || state != storedState {
			respondWithError(c, http.StatusBadRequest, "Invalid state parameter")
			return
		}

		// Clear state cookie
		c.SetCookie("oauth_state", "", -1, "/", "", false, true)

		// Get authorization code
		code := c.Query("code")
		if code == "" {
			errorDesc := c.Query("error_description")
			if errorDesc == "" {
				errorDesc = "Authorization code not provided"
			}
			respondWithError(c, http.StatusBadRequest, errorDesc)
			return
		}

		// Exchange code for token
		token, err := exchangeCodeForToken(code)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to exchange code: %v", err))
			return
		}

		// Get user info from Microsoft Graph
		userInfo, err := getMicrosoftUserInfo(token)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to get user info: %v", err))
			return
		}

		// Find or create user
		user, err := findOrCreateUser(db, userInfo)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to create user: %v", err))
			return
		}

		// Generate JWT token
		jwtToken, err := generateJWT(user)
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to generate token")
			return
		}

		// Log the action
		services.LogAuthAction(db, c, "sso_login", user.Username)

		// Redirect to frontend with token
		frontendURL := os.Getenv("FRONTEND_URL")
		if frontendURL == "" {
			frontendURL = "http://localhost:5173"
		}
		c.Redirect(http.StatusFound, fmt.Sprintf("%s/auth/callback?token=%s", frontendURL, jwtToken))
	}
}

// Exchange authorization code for access token
func exchangeCodeForToken(code string) (string, error) {
	tenantID := os.Getenv("MICROSOFT_TENANT_ID")
	clientID := os.Getenv("MICROSOFT_CLIENT_ID")
	clientSecret := os.Getenv("MICROSOFT_CLIENT_SECRET")
	redirectURI := os.Getenv("MICROSOFT_REDIRECT_URI")

	tokenURL := fmt.Sprintf(microsoftTokenURL, tenantID)

	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	resp, err := http.PostForm(tokenURL, data)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange failed: %s", string(body))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("access token not found in response")
	}

	return accessToken, nil
}

// Get user info from Microsoft Graph API
func getMicrosoftUserInfo(accessToken string) (*MicrosoftUserInfo, error) {
	req, err := http.NewRequest("GET", microsoftUserURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get user info: %s", string(body))
	}

	var userInfo MicrosoftUserInfo
	if err := json.Unmarshal(body, &userInfo); err != nil {
		return nil, err
	}

	return &userInfo, nil
}

// Find or create user in database
func findOrCreateUser(db *gorm.DB, userInfo *MicrosoftUserInfo) (*models.User, error) {
	// Use email from mail field or userPrincipalName
	email := userInfo.Mail
	if email == "" {
		email = userInfo.UserPrincipalName
	}

	// Check if auto-create is enabled
	autoCreate := os.Getenv("SSO_AUTO_CREATE_USERS") == "true"

	var user models.User
	result := db.Where("email = ?", email).First(&user)

	if result.Error == gorm.ErrRecordNotFound {
		if !autoCreate {
			return nil, fmt.Errorf("user not found and auto-create is disabled")
		}

		// Create new user
		username := strings.Split(email, "@")[0]
		
		// Determine role
		role := os.Getenv("SSO_DEFAULT_ROLE")
		if role == "" {
			role = "user"
		}

		// Check if user should be admin
		adminEmails := os.Getenv("SSO_ADMIN_EMAILS")
		if adminEmails != "" {
			for _, adminEmail := range strings.Split(adminEmails, ",") {
				if strings.TrimSpace(adminEmail) == email {
					role = "admin"
					break
				}
			}
		}

		user = models.User{
			Username: username,
			Email:    email,
			FullName: userInfo.DisplayName,
			Role:     role,
			IsActive: true,
		}

		if err := db.Create(&user).Error; err != nil {
			return nil, err
		}
	} else if result.Error != nil {
		return nil, result.Error
	}

	// Update last login
	db.Model(&user).Update("last_login", time.Now().Unix())

	return &user, nil
}

// Generate JWT token for user
func generateJWT(user *models.User) (string, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "your-secret-key"
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"role":     user.Role,
		"exp":      time.Now().Add(time.Hour * 24 * 7).Unix(), // 7 days
	})

	return token.SignedString([]byte(secret))
}
