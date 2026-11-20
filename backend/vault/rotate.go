package vault

import (
	"backend/models"
	vcrypto "backend/vault/crypto"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RotationReport says how many rows were re-encrypted.
type RotationReport struct {
	ActiveVersion int `json:"activeVersion"`
	Credentials   int `json:"credentials"`
	MFASecrets    int `json:"mfaSecrets"`
}

const rotateBatch = 100

// RotateKeys re-encrypts every credential and MFA secret not yet on the
// active key version. Each row is handled in its own short transaction with a
// row lock, so it runs safely while the portal is live and can be re-run
// after an interruption. Old keys must stay in VAULT_KEYS until it reports
// zero rows remaining.
func (s *Service) RotateKeys(operator Actor) (RotationReport, error) {
	active := s.cipher.ActiveVersion()
	rep := RotationReport{ActiveVersion: active}

	for {
		var ids []string
		if err := s.db.Model(&models.VaultCredential{}).Where("key_version <> ?", active).
			Limit(rotateBatch).Pluck("id", &ids).Error; err != nil {
			return rep, err
		}
		if len(ids) == 0 {
			break
		}
		for _, id := range ids {
			if err := s.db.Transaction(func(tx *gorm.DB) error {
				var c models.VaultCredential
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND key_version <> ?", id, active).Take(&c).Error; err != nil {
					if err == gorm.ErrRecordNotFound {
						return nil // re-saved concurrently by an edit
					}
					return err
				}
				pw, err := s.open(c, fieldPassword)
				if err != nil {
					return err
				}
				defer vcrypto.Zero(pw)
				hasNotes := c.NotesCT != nil
				var notes []byte
				if hasNotes {
					if notes, err = s.open(c, fieldNotes); err != nil {
						return err
					}
					defer vcrypto.Zero(notes)
				}
				if err := s.sealSecrets(&c, pw, notes, hasNotes); err != nil {
					return err
				}
				rep.Credentials++
				return tx.Model(&models.VaultCredential{}).Where("id = ?", id).UpdateColumns(map[string]any{
					"password_ct": c.PasswordCT, "password_nonce": c.PasswordNonce,
					"notes_ct": c.NotesCT, "notes_nonce": c.NotesNonce, "key_version": c.KeyVersion,
				}).Error
			}); err != nil {
				return rep, err
			}
		}
	}

	var mfaIDs []string
	if err := s.db.Model(&models.VaultMFA{}).Where("key_version <> ?", active).Pluck("user_id", &mfaIDs).Error; err != nil {
		return rep, err
	}
	for _, uid := range mfaIDs {
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			m, err := s.lockMFARow(tx, uid)
			if err != nil {
				if err == gorm.ErrRecordNotFound {
					return nil
				}
				return err
			}
			if m.KeyVersion == active {
				return nil
			}
			secret, err := s.cipher.Open(vcrypto.Sealed{Ciphertext: m.SecretCT, Nonce: m.SecretNonce, KeyVersion: m.KeyVersion}, mfaAAD(uid))
			if err != nil {
				return err
			}
			defer vcrypto.Zero(secret)
			sealed, err := s.cipher.Seal(secret, mfaAAD(uid))
			if err != nil {
				return err
			}
			rep.MFASecrets++
			return tx.Model(&models.VaultMFA{}).Where("user_id = ?", uid).UpdateColumns(map[string]any{
				"secret_ct": sealed.Ciphertext, "secret_nonce": sealed.Nonce, "key_version": sealed.KeyVersion,
			}).Error
		}); err != nil {
			return rep, err
		}
	}

	if rep.Credentials+rep.MFASecrets > 0 {
		err := s.db.Transaction(func(tx *gorm.DB) error {
			return s.audit(tx, operator, auditEntry{action: ActionKeyRotated, details: map[string]any{
				"activeVersion": active, "credentials": rep.Credentials, "mfaSecrets": rep.MFASecrets}})
		})
		return rep, err
	}
	return rep, nil
}

// KeyVersionUsage counts rows per key version so operators know when an old
// key can be removed.
func (s *Service) KeyVersionUsage() (map[int]int64, error) {
	out := map[int]int64{}
	for _, table := range []string{"vault_credentials", "vault_mfa"} {
		var rows []struct {
			KeyVersion int
			N          int64
		}
		if err := s.db.Table(table).Select("key_version, count(*) AS n").Group("key_version").Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			out[r.KeyVersion] += r.N
		}
	}
	return out, nil
}
