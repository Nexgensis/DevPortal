package crypto

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func key(b byte) []byte { return bytes.Repeat([]byte{b}, KeySize) }

func ring(t *testing.T, active int, versions ...int) *KeyRing {
	t.Helper()
	m := map[int][]byte{}
	for _, v := range versions {
		m[v] = key(byte(v))
	}
	r, err := NewKeyRing(m, active)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSealOpenRoundTrip(t *testing.T) {
	c := NewCipher(ring(t, 1, 1))
	aad := AAD("credential", "abc", "password")
	s, err := c.Seal([]byte("hunter2"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if s.KeyVersion != 1 || len(s.Nonce) != NonceSize {
		t.Fatalf("unexpected sealed metadata: %+v", s)
	}
	if bytes.Contains(s.Ciphertext, []byte("hunter2")) {
		t.Fatal("ciphertext contains plaintext")
	}
	pt, err := c.Open(s, aad)
	if err != nil || string(pt) != "hunter2" {
		t.Fatalf("round trip failed: %q %v", pt, err)
	}
}

func TestEmptyPlaintext(t *testing.T) {
	c := NewCipher(ring(t, 1, 1))
	aad := AAD("credential", "x", "notes")
	s, err := c.Seal(nil, aad)
	if err != nil {
		t.Fatal(err)
	}
	pt, err := c.Open(s, aad)
	if err != nil || len(pt) != 0 {
		t.Fatalf("empty round trip: %q %v", pt, err)
	}
}

func TestNoncesAreUnique(t *testing.T) {
	c := NewCipher(ring(t, 1, 1))
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		s, err := c.Seal([]byte("same"), AAD("credential", "id", "password"))
		if err != nil {
			t.Fatal(err)
		}
		if seen[string(s.Nonce)] {
			t.Fatal("nonce reused")
		}
		seen[string(s.Nonce)] = true
	}
}

func TestTamperingFails(t *testing.T) {
	c := NewCipher(ring(t, 1, 1))
	aad := AAD("credential", "id", "password")
	s, _ := c.Seal([]byte("secret"), aad)

	ct := append([]byte(nil), s.Ciphertext...)
	ct[0] ^= 1
	if _, err := c.Open(Sealed{ct, s.Nonce, 1}, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered ciphertext: got %v", err)
	}
	tag := append([]byte(nil), s.Ciphertext...)
	tag[len(tag)-1] ^= 1
	if _, err := c.Open(Sealed{tag, s.Nonce, 1}, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered tag: got %v", err)
	}
	n := append([]byte(nil), s.Nonce...)
	n[0] ^= 1
	if _, err := c.Open(Sealed{s.Ciphertext, n, 1}, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered nonce: got %v", err)
	}
	if _, err := c.Open(Sealed{s.Ciphertext, s.Nonce[:8], 1}, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("short nonce: got %v", err)
	}
}

func TestAADBindsRowAndField(t *testing.T) {
	c := NewCipher(ring(t, 1, 1))
	s, _ := c.Seal([]byte("secret"), AAD("credential", "row-1", "password"))
	for name, aad := range map[string][]byte{
		"other row":   AAD("credential", "row-2", "password"),
		"other field": AAD("credential", "row-1", "notes"),
		"other kind":  AAD("mfa", "row-1", "password"),
	} {
		if _, err := c.Open(s, aad); !errors.Is(err, ErrDecrypt) {
			t.Errorf("%s: expected ErrDecrypt, got %v", name, err)
		}
	}
}

func TestWrongKeyFails(t *testing.T) {
	aad := AAD("credential", "id", "password")
	s, _ := NewCipher(ring(t, 1, 1)).Seal([]byte("secret"), aad)
	other, _ := NewKeyRing(map[int][]byte{1: key(9)}, 1)
	if _, err := NewCipher(other).Open(s, aad); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("wrong key: got %v", err)
	}
}

func TestRotationReadsOldWritesNew(t *testing.T) {
	aad := AAD("credential", "id", "password")
	old, _ := NewCipher(ring(t, 1, 1)).Seal([]byte("secret"), aad)

	c := NewCipher(ring(t, 2, 1, 2))
	pt, err := c.Open(old, aad)
	if err != nil || string(pt) != "secret" {
		t.Fatalf("old version unreadable after rotation: %v", err)
	}
	s, _ := c.Seal(pt, aad)
	if s.KeyVersion != 2 {
		t.Fatalf("new writes should use v2, got %d", s.KeyVersion)
	}

	// Once v1 is removed, v1 ciphertexts fail loudly rather than trying v2.
	onlyNew := NewCipher(ring(t, 2, 2))
	if _, err := onlyNew.Open(old, aad); !errors.Is(err, ErrUnknownKeyVersion) {
		t.Fatalf("expected ErrUnknownKeyVersion, got %v", err)
	}
}

func TestParseKeyRing(t *testing.T) {
	k1 := base64.StdEncoding.EncodeToString(key(1))
	k2 := base64.StdEncoding.EncodeToString(key(2))

	r, err := ParseKeyRing(fmt.Sprintf("1:%s, 2:%s", k1, k2), "")
	if err != nil || r.ActiveVersion() != 2 {
		t.Fatalf("default active should be highest: %v %v", r, err)
	}
	r, err = ParseKeyRing(fmt.Sprintf("1:%s,2:%s", k1, k2), "1")
	if err != nil || r.ActiveVersion() != 1 {
		t.Fatalf("explicit active: %v", err)
	}

	short := base64.StdEncoding.EncodeToString([]byte("too-short"))
	cases := map[string][2]string{
		"empty":          {"", ""},
		"no colon":       {k1, ""},
		"bad version":    {"x:" + k1, ""},
		"bad base64":     {"1:%%%", ""},
		"short key":      {"1:" + short, ""},
		"duplicate":      {"1:" + k1 + ",1:" + k2, ""},
		"missing active": {"1:" + k1, "3"},
		"zero version":   {"0:" + k1, ""},
	}
	for name, in := range cases {
		if _, err := ParseKeyRing(in[0], in[1]); err == nil {
			t.Errorf("%s: expected error", name)
		} else if strings.Contains(err.Error(), k1) {
			t.Errorf("%s: error leaks key material", name)
		}
	}
	if _, err := ParseKeyRing("", ""); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("empty should be ErrNotConfigured, got %v", err)
	}
}

func TestGenerateKey(t *testing.T) {
	a, _ := GenerateKey()
	b, _ := GenerateKey()
	if a == b {
		t.Fatal("keys should differ")
	}
	if _, err := ParseKeyRing("1:"+a, ""); err != nil {
		t.Fatalf("generated key should parse: %v", err)
	}
}

func TestSecretNeverPrints(t *testing.T) {
	s := Secret("hunter2")
	type wrapper struct {
		Password Secret `json:"password"`
	}
	outs := []string{
		fmt.Sprint(s), fmt.Sprintf("%v %+v %#v %s", s, s, s, s),
		fmt.Sprintf("%v", wrapper{s}), fmt.Sprintf("%+v", wrapper{s}),
	}
	j, _ := json.Marshal(wrapper{s})
	outs = append(outs, string(j))
	for _, o := range outs {
		if strings.Contains(o, "hunter2") {
			t.Fatalf("secret leaked: %s", o)
		}
	}
	var w wrapper
	if err := json.Unmarshal([]byte(`{"password":"hunter2"}`), &w); err != nil || w.Password.Reveal() != "hunter2" {
		t.Fatalf("unmarshal: %v", err)
	}
}
