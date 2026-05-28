package models

import "time"

// PinnedProject pins a Running-Apps project group (e.g. "ebmr", "qms") so it
// sorts to the top of the cards for every user viewing this server. Pinning is
// an admin-only action but the visible result is global.
//
// Keyed by (ServerID, GroupName) — same name on different servers is treated
// as separate pins.
type PinnedProject struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ServerID  string    `gorm:"type:uuid;not null;uniqueIndex:idx_pin_server_group" json:"serverId"`
	GroupName string    `gorm:"not null;uniqueIndex:idx_pin_server_group" json:"groupName"`
	CreatedAt time.Time `json:"createdAt"`
}
