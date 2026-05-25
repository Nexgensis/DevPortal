package migrations

import (
	"gorm.io/gorm"
)

// DropSSHColumns removes the legacy SSH columns from the servers table. The
// connection model migrated to the Docker Engine API over mTLS (tls_ca,
// tls_cert, tls_key_encrypted), so these columns are obsolete. They were also
// NOT NULL with no default, which would otherwise break inserts now that the
// Server struct no longer carries them.
func DropSSHColumns(db *gorm.DB) error {
	return db.Exec(`
		ALTER TABLE servers DROP COLUMN IF EXISTS ssh_user;
		ALTER TABLE servers DROP COLUMN IF EXISTS ssh_port;
		ALTER TABLE servers DROP COLUMN IF EXISTS ssh_key_encrypted;
	`).Error
}
