package migrations

import (
	"gorm.io/gorm"
)

// WidenAuditResourceID changes audit_logs.resource_id from uuid to text.
//
// The column was typed uuid, but the audit log records heterogeneous resources:
// LogAuthAction passes an empty string for login events, and the PostgreSQL
// credential handlers pass a container *name* ("pg1"). Postgres rejects both
// with `invalid input syntax for type uuid`, and every caller discards
// LogAction's error — so those events were silently never recorded at all.
//
// Rows already stored are valid uuids, so the USING cast is lossless.
func WidenAuditResourceID(db *gorm.DB) error {
	return db.Exec(`
		ALTER TABLE audit_logs
		ALTER COLUMN resource_id TYPE text USING resource_id::text;
	`).Error
}
