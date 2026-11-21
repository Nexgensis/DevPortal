package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// IPRateLimiter is a small in-memory fixed-window limiter keyed by client IP.
//
// It is the second line of defence for the vault's MFA endpoints; the first
// is the per-user lockout stored in the database (vault_mfa.failed_attempts),
// which survives restarts and works across replicas. This one exists to blunt
// one IP spraying many accounts. It is per-process: if the backend is ever
// scaled horizontally, move it to Redis.
type IPRateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*bucket
	now     func() time.Time
	lastGC  time.Time
}

type bucket struct {
	start time.Time
	count int
}

func NewIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	return &IPRateLimiter{limit: limit, window: window, buckets: map[string]*bucket{}, now: time.Now}
}

// Allow records one hit for key and reports whether it is within the limit,
// plus how long until the window resets.
func (l *IPRateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.lastGC) > l.window {
		for k, b := range l.buckets {
			if now.Sub(b.start) >= l.window {
				delete(l.buckets, k)
			}
		}
		l.lastGC = now
	}
	b, ok := l.buckets[key]
	if !ok || now.Sub(b.start) >= l.window {
		b = &bucket{start: now}
		l.buckets[key] = b
	}
	b.count++
	return b.count <= l.limit, b.start.Add(l.window).Sub(now)
}

// Middleware rejects over-limit requests with 429 and a Retry-After header.
func (l *IPRateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, retry := l.Allow(c.ClientIP())
		if !ok {
			secs := int(retry.Seconds()) + 1
			c.Header("Retry-After", strconv.Itoa(secs))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many attempts. Wait a minute and try again.",
				"code":  "RATE_LIMITED",
			})
			return
		}
		c.Next()
	}
}
