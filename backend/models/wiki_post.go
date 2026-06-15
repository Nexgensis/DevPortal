package models

import (
	"time"

	"gorm.io/gorm"
)

// WikiPost is one developer-onboarding article in the Wiki tab. Hashnode-style:
// markdown body, a short excerpt for the card list, an optional cover image URL,
// comma-separated tags, and stable URL-friendly slug.
//
// Published posts are visible to every authenticated user; drafts are visible
// only to their author and to admins. The Slug is unique and auto-derived from
// the title on create if the request doesn't supply one.
type WikiPost struct {
	ID    string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Slug  string `gorm:"uniqueIndex;not null" json:"slug"`
	Title string `gorm:"not null" json:"title"`

	// Excerpt is a short teaser shown on the list cards. Optional — auto-derived
	// from the first ~180 chars of Content on save when blank.
	Excerpt string `gorm:"type:text" json:"excerpt"`

	// Content is the post body in CommonMark Markdown. Stored verbatim; the
	// frontend renderer turns it into HTML. Plain text fenced code blocks and
	// images via standard markdown syntax are supported.
	Content string `gorm:"type:text;not null" json:"content"`

	// CoverImage is an optional URL (https://) used as the top hero on the
	// detail view + thumbnail on the list card.
	CoverImage string `gorm:"type:text" json:"coverImage"`

	// Tags is a comma-separated list (e.g. "git,deployment,onboarding").
	// Stored flat to keep the schema simple — no separate tags table for V1.
	Tags string `json:"tags"`

	// Category groups posts into broad sections in the sidebar (e.g.
	// "onboarding", "git", "deployment", "architecture"). Free-form string.
	Category string `json:"category"`

	// AuthorID/AuthorName denormalize the user info at create time so a deleted
	// user doesn't blank out historic posts. AuthorName is the display name.
	AuthorID   string `gorm:"type:uuid" json:"authorId"`
	AuthorName string `json:"authorName"`

	// Published controls list visibility. Drafts are author-only + admin.
	Published   bool       `gorm:"default:true" json:"published"`
	PublishedAt *time.Time `json:"publishedAt"`

	// ViewCount is bumped on every successful read of the detail endpoint.
	// Cheap counter; not strictly accurate (no per-user dedup) — fine for a
	// "popular posts" sidebar.
	ViewCount int64 `gorm:"default:0" json:"viewCount"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
