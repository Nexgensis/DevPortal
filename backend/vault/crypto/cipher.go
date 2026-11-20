package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

// NonceSize is the standard 96-bit GCM nonce.
const NonceSize = 12

// ErrDecrypt covers every authentication failure: wrong key, tampered
// ciphertext or nonce, or a ciphertext moved to a different row/field (AAD
// mismatch). Deliberately one opaque error so callers can't leak which.
var ErrDecrypt = errors.New("vault: decryption failed")

// Sealed is one encrypted field as stored: ciphertext with the 16-byte GCM
// tag appended (Go's standard layout), its own random nonce, and the key
// version that sealed it.
type Sealed struct {
	Ciphertext []byte
	Nonce      []byte
	KeyVersion int
}

// AAD builds the associated data that binds a ciphertext to exactly one
// place. Copying a ciphertext into another row, another field, or another
// kind of record makes it fail authentication instead of decrypting.
func AAD(kind, id, field string) []byte {
	return []byte("vault:v1|" + kind + "|" + id + "|" + field)
}

// Cipher seals and opens vault fields.
type Cipher struct {
	keys KeyProvider
}

func NewCipher(keys KeyProvider) *Cipher { return &Cipher{keys: keys} }

// ActiveVersion is the key version new seals use.
func (c *Cipher) ActiveVersion() int { return c.keys.ActiveVersion() }

func gcmFor(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal encrypts plaintext with the active key and a fresh random nonce.
// A random 96-bit nonce per call is safe far beyond this vault's write volume
// (the NIST bound is 2^32 messages per key).
func (c *Cipher) Seal(plaintext, aad []byte) (Sealed, error) {
	v := c.keys.ActiveVersion()
	key, err := c.keys.Key(v)
	if err != nil {
		return Sealed{}, err
	}
	aead, err := gcmFor(key)
	if err != nil {
		return Sealed{}, err
	}
	nonce := make([]byte, NonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return Sealed{}, fmt.Errorf("vault: reading random nonce: %w", err)
	}
	ct := aead.Seal(nil, nonce, plaintext, aad)
	return Sealed{Ciphertext: ct, Nonce: nonce, KeyVersion: v}, nil
}

// Open decrypts a sealed field with the key version it was written under.
func (c *Cipher) Open(s Sealed, aad []byte) ([]byte, error) {
	key, err := c.keys.Key(s.KeyVersion)
	if err != nil {
		return nil, err
	}
	if len(s.Nonce) != NonceSize {
		return nil, ErrDecrypt
	}
	aead, err := gcmFor(key)
	if err != nil {
		return nil, err
	}
	pt, err := aead.Open(nil, s.Nonce, s.Ciphertext, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// Zero overwrites a byte slice. Best effort only: Go's GC may already have
// copied it, and strings can't be wiped at all. It shortens the window, it
// doesn't close it.
func Zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
