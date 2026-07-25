package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"io"
	"testing"
)

const testKey = "12345678901234567890123456789012" // 32 bytes → AES-256

// encryptLegacyCFB reproduces how secrets were written before the GCM switch,
// so we can prove those rows still decrypt.
func encryptLegacyCFB(t *testing.T, key, text string) string {
	t.Helper()
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	out := make([]byte, aes.BlockSize+len(text))
	iv := out[:aes.BlockSize]
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		t.Fatal(err)
	}
	cipher.NewCFBEncrypter(block, iv).XORKeyStream(out[aes.BlockSize:], []byte(text))
	return base64.URLEncoding.EncodeToString(out)
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", testKey)

	const secret = "-----BEGIN PRIVATE KEY-----\nsuper secret\n-----END PRIVATE KEY-----"
	sealed, err := Encrypt(secret)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if sealed == secret {
		t.Fatal("ciphertext equals plaintext — nothing was encrypted")
	}
	got, err := Decrypt(sealed)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != secret {
		t.Fatalf("round trip mismatch: got %q want %q", got, secret)
	}
}

// The whole point of GCM: a wrong key must error, not return garbage that gets
// handed to tls.X509KeyPair or used as a Postgres password.
func TestDecryptWithWrongKeyFailsClosed(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", testKey)
	sealed, err := Encrypt("hunter2")
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv("ENCRYPTION_KEY", "abcdefghijklmnopqrstuvwxyz123456") // different 32 bytes
	got, err := Decrypt(sealed)
	if err == nil {
		t.Fatalf("expected an error, got plaintext %q", got)
	}
	if got != "" {
		t.Fatalf("must not return data on failure, got %q", got)
	}
}

// Regression: Decrypt used to echo its input back when the key was missing or
// the value did not decode, so callers silently used ciphertext as a secret.
func TestDecryptNeverEchoesCiphertext(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", testKey)
	sealed, err := Encrypt("hunter2")
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv("ENCRYPTION_KEY", "")
	got, err := Decrypt(sealed)
	if err == nil {
		t.Fatal("expected an error when ENCRYPTION_KEY is unset")
	}
	if got == sealed {
		t.Fatal("Decrypt echoed the ciphertext back as plaintext")
	}
}

// Rows written before the GCM switch must still be readable.
func TestDecryptLegacyCFBCiphertext(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", testKey)

	const secret = "legacy-password"
	got, err := Decrypt(encryptLegacyCFB(t, testKey, secret))
	if err != nil {
		t.Fatalf("legacy decrypt: %v", err)
	}
	if got != secret {
		t.Fatalf("legacy round trip mismatch: got %q want %q", got, secret)
	}
}

// Values stored before encryption existed are not base64 and pass through.
func TestDecryptPreEncryptionPlaintext(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", testKey)

	const plain = "not base64 at all !!!"
	got, err := Decrypt(plain)
	if err != nil {
		t.Fatalf("plaintext passthrough: %v", err)
	}
	if got != plain {
		t.Fatalf("got %q want %q", got, plain)
	}
}

func TestEncryptRejectsBadKeyLength(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "too-short")
	if _, err := Encrypt("x"); err == nil {
		t.Fatal("expected an error for a 9-byte key")
	}
}
