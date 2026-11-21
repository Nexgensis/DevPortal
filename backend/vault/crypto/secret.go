package crypto

import "encoding/json"

// Secret is a plaintext value on its way in (request body) that must never
// end up in a log line or a JSON response by accident. fmt and encoding/json
// both print [REDACTED]; use Reveal() at the one place the value is needed.
type Secret string

const redacted = "[REDACTED]"

func (Secret) String() string               { return redacted }
func (Secret) GoString() string             { return redacted }
func (Secret) MarshalJSON() ([]byte, error) { return json.Marshal(redacted) }
func (Secret) MarshalText() ([]byte, error) { return []byte(redacted), nil }
func (s *Secret) UnmarshalJSON(b []byte) error {
	var v string
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = Secret(v)
	return nil
}

// Reveal returns the underlying plaintext.
func (s Secret) Reveal() string { return string(s) }

// IsEmpty reports whether the secret is "".
func (s Secret) IsEmpty() bool { return s == "" }
