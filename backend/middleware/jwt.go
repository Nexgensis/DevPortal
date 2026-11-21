package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"strings"
	"os"
)

func JWT() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid token"})
			c.Abort()
			return
		}
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		// No fallback: JWT_SECRET is validated at startup in main(). Pinning the
		// signing method rejects alg-substitution attempts outright rather than
		// relying on the key type to make them fail.
		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("JWT_SECRET")), nil
		}, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid JWT claims"})
			c.Abort()
			return
		}
		c.Set("user", claims)
		c.Set("username", claims["username"])
		// Session id and expiry: the password vault binds its MFA unlock to
		// them. Tokens minted before "sid" existed simply have none.
		if sid, ok := claims["sid"].(string); ok {
			c.Set("sid", sid)
		}
		if uid, ok := claims["user_id"].(string); ok {
			c.Set("user_id", uid)
		}
		// How this session signed in ("pwd" or "sso"); the vault picks the
		// unlock method from it.
		if amr, ok := claims["amr"].(string); ok {
			c.Set("auth_method", amr)
		}
		if exp, err := claims.GetExpirationTime(); err == nil && exp != nil {
			c.Set("token_exp", exp.Time)
		}
		c.Next()
	}
}

// Only allow admins
func Admin() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, exists := c.Get("user")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "No user context"})
			c.Abort()
			return
		}
		if claims.(jwt.MapClaims)["role"] != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: admin only"})
			c.Abort()
			return
		}
		c.Next()
	}
}
