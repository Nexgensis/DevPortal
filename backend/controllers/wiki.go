package controllers

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend/models"
	"backend/services"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

// claimRole pulls the role string from the JWT claims the middleware stored
// under the `user` context key. Returns "" if no claims / role is missing.
func claimRole(c *gin.Context) string {
	v, ok := c.Get("user")
	if !ok {
		return ""
	}
	claims, ok := v.(jwt.MapClaims)
	if !ok {
		return ""
	}
	role, _ := claims["role"].(string)
	return role
}

// claimUsername pulls the username string from the JWT context the middleware
// set directly. Convenience over c.Get("username") + type assertion at each site.
func claimUsername(c *gin.Context) string {
	v, ok := c.Get("username")
	if !ok {
		return ""
	}
	u, _ := v.(string)
	return u
}

// slugify turns a title into a stable URL-friendly slug. Lower-cases ASCII,
// drops non-alphanumerics, collapses runs of dashes, trims to 96 chars.
var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

// uuidRe guards lookups against uuid-typed columns. Postgres errors out on a
// non-uuid literal rather than simply not matching, so the caller must check
// the shape first.
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 96 {
		s = s[:96]
		s = strings.TrimRight(s, "-")
	}
	if s == "" {
		s = "post"
	}
	return s
}

// uniqueSlug ensures the slug doesn't collide with an existing post by appending
// `-2`, `-3`, ... if needed. `excludeID` lets updates keep their own slug.
func uniqueSlug(db *gorm.DB, base, excludeID string) string {
	candidate := base
	for i := 2; i < 100; i++ {
		var existing models.WikiPost
		q := db.Where("slug = ?", candidate)
		if excludeID != "" {
			q = q.Where("id <> ?", excludeID)
		}
		if err := q.First(&existing).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return candidate
		}
		candidate = base + "-" + strconv.Itoa(i)
	}
	return base + "-" + strconv.Itoa(int(time.Now().UnixNano()%10_000))
}

// excerptFromContent strips the leading markdown noise (headings, code fences)
// and returns the first ~180 chars as a teaser. Best-effort, not perfect.
func excerptFromContent(content string) string {
	lines := strings.Split(content, "\n")
	var picked []string
	inCode := false
	for _, ln := range lines {
		trimmed := strings.TrimSpace(ln)
		if strings.HasPrefix(trimmed, "```") {
			inCode = !inCode
			continue
		}
		if inCode || trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ">") {
			continue
		}
		picked = append(picked, trimmed)
		if len(strings.Join(picked, " ")) > 200 {
			break
		}
	}
	out := strings.Join(picked, " ")
	if len(out) > 180 {
		// Cut at the next word boundary.
		out = out[:180]
		if sp := strings.LastIndexByte(out, ' '); sp > 100 {
			out = out[:sp]
		}
		out += "…"
	}
	return out
}

// ListWikiPosts returns all visible posts (published OR authored by the caller
// OR caller is admin), without the bulky Content field. Sorted newest first.
func ListWikiPosts(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		username := claimUsername(c)
		isAdmin := claimRole(c) == "admin"

		q := db.Model(&models.WikiPost{}).Omit("content")
		if !isAdmin {
			// Non-admins see every published post + their own drafts.
			q = q.Where("published = ? OR author_name = ?", true, username)
		}
		// Optional category filter.
		if cat := strings.TrimSpace(c.Query("category")); cat != "" {
			q = q.Where("category = ?", cat)
		}
		// Optional tag filter — comma-separated substring match (cheap, OK for V1).
		if tag := strings.TrimSpace(c.Query("tag")); tag != "" {
			q = q.Where("tags LIKE ?", "%"+tag+"%")
		}

		var posts []models.WikiPost
		if err := q.Order("COALESCE(published_at, created_at) DESC").Find(&posts).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch posts")
			return
		}
		c.JSON(http.StatusOK, gin.H{"posts": posts, "count": len(posts)})
	}
}

// GetWikiPost returns a single post by slug (or UUID, for the editor) including
// its full content. Bumps the view counter on successful published reads.
func GetWikiPost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		username := claimUsername(c)
		isAdmin := claimRole(c) == "admin"

		key := c.Param("key") // slug or id
		var post models.WikiPost
		// Try by slug first, then by id — but only attempt the id lookup when the
		// key actually looks like a uuid. `WHERE id = 'no-such-post'` against a
		// uuid column is a Postgres type error, not a miss, so every unknown slug
		// used to fall through to a 500 instead of a 404.
		err := db.Where("slug = ?", key).First(&post).Error
		if errors.Is(err, gorm.ErrRecordNotFound) && uuidRe.MatchString(key) {
			err = db.Where("id = ?", key).First(&post).Error
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respondWithError(c, http.StatusNotFound, "Post not found")
			return
		}
		if err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to fetch post")
			return
		}

		// Authorize drafts: only author or admin sees them.
		if !post.Published && !isAdmin && post.AuthorName != username {
			respondWithError(c, http.StatusNotFound, "Post not found")
			return
		}

		// Best-effort view bump; failure is non-fatal (we still return the post).
		if post.Published {
			_ = db.Model(&models.WikiPost{}).Where("id = ?", post.ID).
				UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
			post.ViewCount++
		}
		c.JSON(http.StatusOK, post)
	}
}

type wikiPostRequest struct {
	Title      string `json:"title" binding:"required"`
	Slug       string `json:"slug"`
	Excerpt    string `json:"excerpt"`
	Content    string `json:"content" binding:"required"`
	CoverImage string `json:"coverImage"`
	Tags       string `json:"tags"`
	Category   string `json:"category"`
	Published  *bool  `json:"published"`
}

// CreateWikiPost — admins (and authenticated users) can author posts. The
// caller's username + ID are recorded as the author.
func CreateWikiPost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req wikiPostRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}

		uname := claimUsername(c)
		var authorID string
		var user models.User
		if err := db.Where("username = ?", uname).First(&user).Error; err == nil {
			authorID = user.ID
		}

		slug := strings.TrimSpace(req.Slug)
		if slug == "" {
			slug = slugify(req.Title)
		} else {
			slug = slugify(slug)
		}
		slug = uniqueSlug(db, slug, "")

		published := true
		if req.Published != nil {
			published = *req.Published
		}
		var publishedAt *time.Time
		if published {
			now := time.Now()
			publishedAt = &now
		}

		excerpt := strings.TrimSpace(req.Excerpt)
		if excerpt == "" {
			excerpt = excerptFromContent(req.Content)
		}

		post := models.WikiPost{
			Slug:        slug,
			Title:       strings.TrimSpace(req.Title),
			Excerpt:     excerpt,
			Content:     req.Content,
			CoverImage:  strings.TrimSpace(req.CoverImage),
			Tags:        strings.TrimSpace(req.Tags),
			Category:    strings.TrimSpace(req.Category),
			AuthorID:    authorID,
			AuthorName:  uname,
			Published:   published,
			PublishedAt: publishedAt,
		}
		if err := db.Create(&post).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to create post: "+err.Error())
			return
		}

		services.LogAction(db, c, "wiki_create", "wiki_post", post.ID, post.Title,
			"Created wiki post "+post.Slug)
		c.JSON(http.StatusCreated, post)
	}
}

// UpdateWikiPost — admins can update any post, authors can update their own.
func UpdateWikiPost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req wikiPostRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			respondWithError(c, http.StatusBadRequest, "Invalid request: "+err.Error())
			return
		}

		var post models.WikiPost
		if err := db.First(&post, "id = ?", c.Param("id")).Error; err != nil {
			respondWithError(c, http.StatusNotFound, "Post not found")
			return
		}

		username := claimUsername(c)
		if claimRole(c) != "admin" && post.AuthorName != username {
			respondWithError(c, http.StatusForbidden, "Only the author or an admin can edit this post")
			return
		}

		// Slug regeneration: only if the title changed AND the caller didn't pin
		// a custom slug. Keep the existing slug otherwise — bookmarked URLs survive.
		newSlug := post.Slug
		if strings.TrimSpace(req.Slug) != "" && slugify(req.Slug) != post.Slug {
			newSlug = uniqueSlug(db, slugify(req.Slug), post.ID)
		}

		excerpt := strings.TrimSpace(req.Excerpt)
		if excerpt == "" {
			excerpt = excerptFromContent(req.Content)
		}

		// If transitioning from draft → published, stamp the publish time.
		published := post.Published
		publishedAt := post.PublishedAt
		if req.Published != nil {
			published = *req.Published
			if published && publishedAt == nil {
				now := time.Now()
				publishedAt = &now
			}
		}

		updates := map[string]interface{}{
			"slug":         newSlug,
			"title":        strings.TrimSpace(req.Title),
			"excerpt":      excerpt,
			"content":      req.Content,
			"cover_image":  strings.TrimSpace(req.CoverImage),
			"tags":         strings.TrimSpace(req.Tags),
			"category":     strings.TrimSpace(req.Category),
			"published":    published,
			"published_at": publishedAt,
		}
		if err := db.Model(&post).Updates(updates).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to update post")
			return
		}
		// Re-read so the response matches the persisted state (timestamps etc.).
		db.First(&post, "id = ?", post.ID)
		services.LogAction(db, c, "wiki_update", "wiki_post", post.ID, post.Title,
			"Updated wiki post "+post.Slug)
		c.JSON(http.StatusOK, post)
	}
}

// DeleteWikiPost — admins or the author. Soft-delete (gorm DeletedAt).
func DeleteWikiPost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var post models.WikiPost
		if err := db.First(&post, "id = ?", c.Param("id")).Error; err != nil {
			respondWithError(c, http.StatusNotFound, "Post not found")
			return
		}
		username := claimUsername(c)
		if claimRole(c) != "admin" && post.AuthorName != username {
			respondWithError(c, http.StatusForbidden, "Only the author or an admin can delete this post")
			return
		}
		if err := db.Delete(&post).Error; err != nil {
			respondWithError(c, http.StatusInternalServerError, "Failed to delete post")
			return
		}
		services.LogAction(db, c, "wiki_delete", "wiki_post", post.ID, post.Title,
			"Deleted wiki post "+post.Slug)
		c.JSON(http.StatusOK, gin.H{"message": "Post deleted"})
	}
}
