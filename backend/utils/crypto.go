package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// Secrets at rest (Docker client TLS keys, PostgreSQL passwords) are encrypted
// with AES-GCM, which authenticates the ciphertext: decrypting with the wrong
// ENCRYPTION_KEY fails loudly instead of returning plausible garbage.
//
// Values written before this change used AES-CFB, which is unauthenticated and
// indistinguishable from noise on a wrong key. To avoid a data migration,
// ciphertexts written from now on carry a "v2:" prefix and are GCM; anything
// without the prefix is decrypted with the legacy CFB path. Re-saving a server
// or credential upgrades that row in place.
//
// ponytail: legacy CFB read path stays until every stored secret has been
// re-saved once — drop decryptLegacyCFB and the prefix check after that.
const gcmPrefix = "v2:"

// ErrDecryptFailed means the stored value could not be decrypted — wrong
// ENCRYPTION_KEY, or the ciphertext was truncated or tampered with. Callers
// must treat this as fatal for the operation rather than using the raw value.
var ErrDecryptFailed = errors.New("decryption failed: wrong ENCRYPTION_KEY or corrupted ciphertext")

func encryptionKey() ([]byte, error) {
	key := []byte(os.Getenv("ENCRYPTION_KEY"))
	switch len(key) {
	case 16, 24, 32:
		return key, nil
	case 0:
		return nil, errors.New("ENCRYPTION_KEY is not set")
	default:
		return nil, fmt.Errorf("ENCRYPTION_KEY must be 16, 24 or 32 bytes, got %d", len(key))
	}
}

// Encrypt seals plaintext with AES-GCM and returns "v2:<base64(nonce||sealed)>".
func Encrypt(text string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(text), nil)
	return gcmPrefix + base64.URLEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. It fails closed: on any error the caller gets an
// error, never the input echoed back. The previous implementation returned the
// ciphertext as if it were plaintext whenever the key was missing or the value
// did not base64-decode, so a misconfigured ENCRYPTION_KEY silently fed garbage
// into tls.X509KeyPair and PGPASSWORD instead of reporting a problem.
func Decrypt(cryptoText string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}

	if strings.HasPrefix(cryptoText, gcmPrefix) {
		return decryptGCM(key, strings.TrimPrefix(cryptoText, gcmPrefix))
	}
	return decryptLegacyCFB(key, cryptoText)
}

func decryptGCM(key []byte, b64 string) (string, error) {
	raw, err := base64.URLEncoding.DecodeString(b64)
	if err != nil {
		return "", ErrDecryptFailed
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", ErrDecryptFailed
	}
	nonce, sealed := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		// GCM's auth tag caught it — wrong key or tampered ciphertext.
		return "", ErrDecryptFailed
	}
	return string(plain), nil
}

// decryptLegacyCFB reads values written before the GCM switch.
//
// A value that is not valid base64 is treated as plaintext from before
// encryption existed at all and returned as-is — that data was never secret, so
// passing it through loses nothing. Structurally-valid-but-undecryptable input
// is an error.
//
// CFB is unauthenticated, so a wrong key yields garbage here with no way to
// detect it. That is precisely why new writes use GCM.
func decryptLegacyCFB(key []byte, cryptoText string) (string, error) {
	ciphertext, err := base64.URLEncoding.DecodeString(cryptoText)
	if err != nil {
		return cryptoText, nil // pre-encryption plaintext
	}
	if len(ciphertext) < aes.BlockSize {
		return "", ErrDecryptFailed
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	iv, data := ciphertext[:aes.BlockSize], ciphertext[aes.BlockSize:]
	out := make([]byte, len(data))
	cipher.NewCFBDecrypter(block, iv).XORKeyStream(out, data)
	return string(out), nil
}
