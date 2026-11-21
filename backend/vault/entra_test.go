package vault

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	testTenant = "11111111-2222-3333-4444-555555555555"
	testClient = "client-abc"
)

func idToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	b, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"RS256"}`)) + "." + enc(b) + ".sig"
}

func entraEnv(t *testing.T, requireMFA bool) *env {
	e := newEnv(t)
	e.svc = e.svc.WithEntra(EntraConfig{TenantID: testTenant, ClientID: testClient, RequireMFAClaim: requireMFA})
	return e
}

// goodClaims is what Microsoft returns for a fresh MFA sign-in by `user`.
func goodClaims(e *env, user, nonce string) map[string]any {
	now := e.clock.Now()
	return map[string]any{
		"iss": "https://login.microsoftonline.com/" + testTenant + "/v2.0", "aud": testClient, "tid": testTenant,
		"nonce": nonce, "exp": now.Add(time.Hour).Unix(), "auth_time": now.Add(30 * time.Second).Unix(),
		"amr": []string{"pwd", "mfa"}, "preferred_username": strings.ToUpper(user) + "@EXAMPLE.TEST",
	}
}

func ssoActor(e *env, t *testing.T, name, role string) Actor {
	a := e.user(t, name, role)
	a.AuthMethod = "sso"
	return a
}

func TestMicrosoftUnlockHappyPath(t *testing.T) {
	e := entraEnv(t, true)
	bob := ssoActor(e, t, "bob", "admin")

	st, _ := e.svc.Status(bob)
	if !st.Methods.Microsoft || st.Methods.TOTP {
		t.Fatalf("SSO session should unlock with Microsoft only: %+v", st.Methods)
	}
	if _, err := e.svc.StartEnrollment(bob); !errors.Is(err, ErrUseMicrosoft) {
		t.Fatalf("SSO user must not need the authenticator app: %v", err)
	}

	su, err := e.svc.StartMicrosoftUnlock(bob)
	if err != nil {
		t.Fatal(err)
	}
	if !IsVaultStepUpState(su.State) || !e.svc.StepUpPending(su.State) || su.LoginHint != "bob@example.test" {
		t.Fatalf("start: %+v", su)
	}
	e.clock.Advance(time.Minute)
	exp, err := e.svc.CompleteMicrosoftUnlock(su.State, idToken(t, goodClaims(e, "bob", su.Nonce)), "203.0.113.9", "ua")
	if err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := e.svc.UnlockExpiry(bob.UserID, bob.SessionID); !ok || !got.Equal(exp) {
		t.Fatal("bob's session should be unlocked")
	}
	if _, ok, _ := e.svc.UnlockExpiry(bob.UserID, "another-session"); ok {
		t.Fatal("only the session that started the step-up unlocks")
	}
	// Single use.
	if e.svc.StepUpPending(su.State) {
		t.Fatal("state still pending after use")
	}
	var se *StepUpError
	if _, err := e.svc.CompleteMicrosoftUnlock(su.State, idToken(t, goodClaims(e, "bob", su.Nonce)), "", ""); !errors.As(err, &se) || se.Code != "expired" {
		t.Fatalf("replay: %v", err)
	}
	if got := strings.Join(e.auditActions(t), ","); !strings.Contains(got, ActionMFAVerified) {
		t.Fatalf("audit: %s", got)
	}

	// A local (password) admin still gets the app code.
	local := e.user(t, "root", "admin")
	if st, _ := e.svc.Status(local); !st.Methods.TOTP {
		t.Fatal("password sessions keep the authenticator app")
	}
}

func TestMicrosoftUnlockRejects(t *testing.T) {
	e := entraEnv(t, true)
	bob := ssoActor(e, t, "bob", "admin")

	cases := map[string]struct {
		mutate func(c map[string]any)
		code   string
	}{
		"other tenant":  {func(c map[string]any) { c["tid"] = "99999999-2222-3333-4444-555555555555" }, "wrong_account"},
		"other issuer":  {func(c map[string]any) { c["iss"] = "https://evil.example/v2.0" }, "wrong_account"},
		"other app":     {func(c map[string]any) { c["aud"] = "someone-else" }, "invalid"},
		"wrong nonce":   {func(c map[string]any) { c["nonce"] = "replayed" }, "invalid"},
		"expired token": {func(c map[string]any) { c["exp"] = e.clock.Now().Add(-time.Minute).Unix() }, "invalid"}, // test clock, not the wall clock
		"no mfa":        {func(c map[string]any) { c["amr"] = []string{"pwd"} }, "no_mfa"},
		"stale sign-in": {func(c map[string]any) { c["auth_time"] = c["auth_time"].(int64) - 3600 }, "not_fresh"},
		"other person":  {func(c map[string]any) { c["preferred_username"] = "mallory@example.test" }, "wrong_account"},
		"garbage":       {nil, "invalid"},
	}
	for name, tc := range cases {
		su, err := e.svc.StartMicrosoftUnlock(bob)
		if err != nil {
			t.Fatal(err)
		}
		tok := "not-a-jwt"
		if tc.mutate != nil {
			c := goodClaims(e, "bob", su.Nonce)
			tc.mutate(c)
			tok = idToken(t, c)
		}
		var se *StepUpError
		if _, err := e.svc.CompleteMicrosoftUnlock(su.State, tok, "", ""); !errors.As(err, &se) || se.Code != tc.code {
			t.Errorf("%s: want %s, got %v", name, tc.code, err)
		}
		if e.svc.StepUpPending(su.State) {
			t.Errorf("%s: failed attempt must be consumed", name)
		}
		if _, ok, _ := e.svc.UnlockExpiry(bob.UserID, bob.SessionID); ok {
			t.Fatalf("%s: vault unlocked on a rejected token", name)
		}
	}
	if n := strings.Count(strings.Join(e.auditActions(t), ","), ActionMFAFailed); n != len(cases) {
		t.Fatalf("want %d MFA_FAILED events, got %d", len(cases), n)
	}

	// Attempts expire after 10 minutes.
	su, _ := e.svc.StartMicrosoftUnlock(bob)
	e.clock.Advance(StepUpTTL + time.Second)
	var se *StepUpError
	if _, err := e.svc.CompleteMicrosoftUnlock(su.State, idToken(t, goodClaims(e, "bob", su.Nonce)), "", ""); !errors.As(err, &se) || se.Code != "expired" {
		t.Fatalf("expired attempt: %v", err)
	}
}

func TestMicrosoftUnlockWithoutAmrWhenTrustingTenant(t *testing.T) {
	e := entraEnv(t, false)
	bob := ssoActor(e, t, "bob", "admin")
	su, _ := e.svc.StartMicrosoftUnlock(bob)
	c := goodClaims(e, "bob", su.Nonce)
	delete(c, "amr")
	if _, err := e.svc.CompleteMicrosoftUnlock(su.State, idToken(t, c), "", ""); err != nil {
		t.Fatalf("amr optional mode: %v", err)
	}
}

func TestMicrosoftUnlockNeedsRealTenant(t *testing.T) {
	e := newEnv(t)
	e.svc = e.svc.WithEntra(EntraConfig{TenantID: "organizations", ClientID: testClient, RequireMFAClaim: true})
	bob := ssoActor(e, t, "bob", "admin")
	if _, err := e.svc.StartMicrosoftUnlock(bob); !errors.Is(err, ErrMicrosoftUnlockUnavailable) {
		t.Fatalf("multi-tenant authority must disable step-up: %v", err)
	}
	// And then SSO users fall back to the authenticator app.
	if st, _ := e.svc.Status(bob); st.Methods.Microsoft || !st.Methods.TOTP {
		t.Fatalf("fallback: %+v", st.Methods)
	}
}

func TestMicrosoftUnlockRequiresAuthContextWhenConfigured(t *testing.T) {
	e := newEnv(t)
	cfg := EntraConfig{TenantID: testTenant, ClientID: testClient, RequireMFAClaim: true, AuthContext: "c1"}
	e.svc = e.svc.WithEntra(cfg)
	bob := ssoActor(e, t, "bob", "admin")

	// The sign-in URL must ask Microsoft to enforce the context.
	var req map[string]map[string]map[string]any
	if err := json.Unmarshal([]byte(e.svc.EntraClaimsRequest()), &req); err != nil {
		t.Fatalf("claims request is not JSON: %v", err)
	}
	if acrs := req["id_token"]["acrs"]; acrs["essential"] != true || acrs["value"] != "c1" {
		t.Fatalf("claims request: %v", req)
	}

	for name, tc := range map[string]struct {
		acrs []string
		ok   bool
	}{
		"no acrs (Microsoft reused an old approval)": {nil, false},
		"other context":         {[]string{"c2"}, false},
		"fresh approval for c1": {[]string{"c1"}, true},
	} {
		su, err := e.svc.StartMicrosoftUnlock(bob)
		if err != nil {
			t.Fatal(err)
		}
		c := goodClaims(e, "bob", su.Nonce)
		if tc.acrs != nil {
			c["acrs"] = tc.acrs
		}
		_, err = e.svc.CompleteMicrosoftUnlock(su.State, idToken(t, c), "", "")
		var se *StepUpError
		switch {
		case tc.ok && err != nil:
			t.Errorf("%s: %v", name, err)
		case !tc.ok && (!errors.As(err, &se) || se.Code != "no_approval"):
			t.Errorf("%s: want no_approval, got %v", name, err)
		}
	}
}

func TestValidAuthContext(t *testing.T) {
	for v, want := range map[string]bool{"c1": true, "c25": true, "c99": true, "c0": false, "c100": false, "C1": false, "c1;drop": false, "": false} {
		if ValidAuthContext(v) != want {
			t.Errorf("%q: want %v", v, want)
		}
	}
	if (EntraConfig{}).ClaimsRequest() != "" {
		t.Error("no context → no claims parameter")
	}
}
