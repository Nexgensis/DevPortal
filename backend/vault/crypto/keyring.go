// Package crypto holds the password vault's encryption primitives.
//
// It is deliberately separate from backend/utils/crypto.go: that helper uses
// the shared ENCRYPTION_KEY (an ASCII string that is the same in dev and prod)
// and has a legacy unauthenticated CFB read path. Vault secrets get their own
// versioned, random 256-bit keys and nothing but AES-256-GCM.
package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// KeySize is the only accepted key length: AES-256.
const KeySize = 32

// Env var names. VAULT_KEYS is a comma-separated list of "<version>:<base64>"
// entries; VAULT_ACTIVE_KEY_VERSION selects which one new writes use.
const (
	EnvKeys          = "VAULT_KEYS"
	EnvActiveVersion = "VAULT_ACTIVE_KEY_VERSION"
)

// ErrNotConfigured means VAULT_KEYS is unset. The rest of the app keeps
// working; vault endpoints answer 503 until keys are provided.
var ErrNotConfigured = errors.New("vault encryption keys are not configured (VAULT_KEYS)")

// ErrUnknownKeyVersion means a row was written with a key that is no longer
// (or not yet) loaded. Never fall back to another key.
var ErrUnknownKeyVersion = errors.New("vault: ciphertext key version is not loaded")

// KeyProvider is the seam for moving keys into a KMS later: an implementation
// backed by AWS KMS / HashiCorp Vault only has to hand out these two answers.
type KeyProvider interface {
	// ActiveVersion is the key version used for new encryptions.
	ActiveVersion() int
	// Key returns the raw key for a version, or ErrUnknownKeyVersion.
	Key(version int) ([]byte, error)
}

// KeyRing is the environment-backed KeyProvider.
type KeyRing struct {
	keys   map[int][]byte
	active int
}

// NewKeyRing builds a ring from explicit keys. Every key must be exactly
// KeySize bytes and the active version must be present.
func NewKeyRing(keys map[int][]byte, active int) (*KeyRing, error) {
	if len(keys) == 0 {
		return nil, ErrNotConfigured
	}
	cp := make(map[int][]byte, len(keys))
	for v, k := range keys {
		if v < 1 || v > 32767 {
			return nil, fmt.Errorf("vault key version %d out of range 1..32767", v)
		}
		if len(k) != KeySize {
			return nil, fmt.Errorf("vault key version %d must be %d bytes, got %d", v, KeySize, len(k))
		}
		cp[v] = append([]byte(nil), k...)
	}
	if _, ok := cp[active]; !ok {
		return nil, fmt.Errorf("active vault key version %d is not in %s", active, EnvKeys)
	}
	return &KeyRing{keys: cp, active: active}, nil
}

// ParseKeyRing parses the VAULT_KEYS / VAULT_ACTIVE_KEY_VERSION format.
// An empty activeStr means "the highest version present".
func ParseKeyRing(keysStr, activeStr string) (*KeyRing, error) {
	keysStr = strings.TrimSpace(keysStr)
	if keysStr == "" {
		return nil, ErrNotConfigured
	}
	keys := map[int][]byte{}
	for _, entry := range strings.Split(keysStr, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		vStr, b64, ok := strings.Cut(entry, ":")
		if !ok {
			return nil, fmt.Errorf("%s entry must be <version>:<base64 key>", EnvKeys)
		}
		v, err := strconv.Atoi(strings.TrimSpace(vStr))
		if err != nil {
			return nil, fmt.Errorf("%s: bad key version %q", EnvKeys, vStr)
		}
		if _, dup := keys[v]; dup {
			return nil, fmt.Errorf("%s: key version %d listed twice", EnvKeys, v)
		}
		// Never echo the key material in errors.
		k, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
		if err != nil {
			return nil, fmt.Errorf("%s: key version %d is not valid base64", EnvKeys, v)
		}
		keys[v] = k
	}
	if len(keys) == 0 {
		return nil, ErrNotConfigured
	}
	active := 0
	if s := strings.TrimSpace(activeStr); s != "" {
		v, err := strconv.Atoi(s)
		if err != nil {
			return nil, fmt.Errorf("%s must be an integer", EnvActiveVersion)
		}
		active = v
	} else {
		for v := range keys {
			if v > active {
				active = v
			}
		}
	}
	return NewKeyRing(keys, active)
}

// KeyRingFromEnv reads VAULT_KEYS / VAULT_ACTIVE_KEY_VERSION.
func KeyRingFromEnv() (*KeyRing, error) {
	return ParseKeyRing(os.Getenv(EnvKeys), os.Getenv(EnvActiveVersion))
}

func (r *KeyRing) ActiveVersion() int { return r.active }

func (r *KeyRing) Key(version int) ([]byte, error) {
	k, ok := r.keys[version]
	if !ok {
		return nil, ErrUnknownKeyVersion
	}
	return k, nil
}

// Versions lists loaded versions in ascending order (for diagnostics).
func (r *KeyRing) Versions() []int {
	out := make([]int, 0, len(r.keys))
	for v := range r.keys {
		out = append(out, v)
	}
	sort.Ints(out)
	return out
}

// GenerateKey returns a fresh random key, base64-encoded for VAULT_KEYS.
func GenerateKey() (string, error) {
	k := make([]byte, KeySize)
	if _, err := rand.Read(k); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(k), nil
}
