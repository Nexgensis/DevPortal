package vault

import (
	"bytes"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/models"
	vcrypto "backend/vault/crypto"

	"github.com/pquerna/otp/totp"
)

func codeAt(t *testing.T, secret string, at time.Time) string {
	t.Helper()
	c, err := totp.GenerateCodeCustom(secret, at, totpOpts)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// enroll runs the full enrollment and returns the TOTP secret and recovery codes.
func enroll(t *testing.T, e *env, a Actor) (string, []string) {
	t.Helper()
	en, err := e.svc.StartEnrollment(a)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(en.QRCodePNG, "data:image/png;base64,") || !strings.HasPrefix(en.OtpauthURL, "otpauth://totp/") {
		t.Fatalf("bad enrollment payload: %+v", en.OtpauthURL)
	}
	res, err := e.svc.ConfirmEnrollment(a, codeAt(t, en.Secret, e.clock.Now()))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.RecoveryCodes) != RecoveryCodeCount {
		t.Fatalf("want %d recovery codes, got %d", RecoveryCodeCount, len(res.RecoveryCodes))
	}
	return en.Secret, res.RecoveryCodes
}

func mustBeLocked(t *testing.T, e *env, a Actor) {
	t.Helper()
	if _, ok, err := e.svc.UnlockExpiry(a.UserID, a.SessionID); err != nil || ok {
		t.Fatalf("expected vault locked, got unlocked=%v err=%v", ok, err)
	}
}

func mustBeUnlocked(t *testing.T, e *env, a Actor) time.Time {
	t.Helper()
	exp, ok, err := e.svc.UnlockExpiry(a.UserID, a.SessionID)
	if err != nil || !ok {
		t.Fatalf("expected vault unlocked, got unlocked=%v err=%v", ok, err)
	}
	return exp
}

func TestEnrollmentStoresSecretEncryptedAndUnlocks(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")

	st, _ := e.svc.Status(a)
	if st.Enrolled || st.Unlocked {
		t.Fatalf("fresh admin status wrong: %+v", st)
	}
	secret, codes := enroll(t, e, a)

	var m models.VaultMFA
	e.db.Where("user_id = ?", a.UserID).Take(&m)
	if m.Status != models.VaultMFAActive || bytes.Contains(m.SecretCT, []byte(secret)) {
		t.Fatal("MFA secret must be active and stored encrypted")
	}
	var hashes []string
	e.db.Model(&models.VaultRecoveryCode{}).Pluck("code_hash", &hashes)
	for _, h := range hashes {
		for _, c := range codes {
			if strings.Contains(h, c) {
				t.Fatal("recovery code stored in plaintext")
			}
		}
	}
	mustBeUnlocked(t, e, a)

	st, _ = e.svc.Status(a)
	if !st.Enrolled || !st.Unlocked || st.RecoveryCodesRemaining != RecoveryCodeCount {
		t.Fatalf("status after enroll: %+v", st)
	}
	if _, err := e.svc.StartEnrollment(a); !errors.Is(err, ErrMFAAlreadyEnrolled) {
		t.Fatalf("re-enroll over active MFA must be refused, got %v", err)
	}
}

func TestPendingEnrollmentExpires(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	en, _ := e.svc.StartEnrollment(a)
	e.clock.Advance(PendingEnrollmentTT + time.Minute)
	if _, err := e.svc.ConfirmEnrollment(a, codeAt(t, en.Secret, e.clock.Now())); !errors.Is(err, ErrNoPendingEnrollment) {
		t.Fatalf("expired enrollment: got %v", err)
	}
}

func TestUnlockRequiresSessionID(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	a.SessionID = ""
	if _, err := e.svc.StartEnrollment(a); !errors.Is(err, ErrSessionUpgradeRequired) {
		t.Fatalf("got %v", err)
	}
	if _, err := e.svc.Unlock(a, "123456", ""); !errors.Is(err, ErrSessionUpgradeRequired) {
		t.Fatalf("got %v", err)
	}
}

func TestUnlockFlowExpiryAndReplay(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	secret, _ := enroll(t, e, a)
	if err := e.svc.Lock(a); err != nil {
		t.Fatal(err)
	}
	mustBeLocked(t, e, a)

	// The code used at enrollment is in the same 30s step: replay → rejected.
	if _, err := e.svc.Unlock(a, codeAt(t, secret, e.clock.Now()), ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("replayed step must be rejected, got %v", err)
	}

	e.clock.Advance(30 * time.Second)
	code := codeAt(t, secret, e.clock.Now())
	res, err := e.svc.Unlock(a, code, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.UnlockExpiresAt.Equal(e.clock.Now().Add(UnlockTTL).Truncate(time.Microsecond)) &&
		!res.UnlockExpiresAt.Equal(a.TokenExpiry.Truncate(time.Microsecond)) {
		t.Fatalf("unexpected expiry %v", res.UnlockExpiresAt)
	}
	// Same code again (another tab, a shoulder-surfer) is a replay.
	if _, err := e.svc.Unlock(a, code, ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("same code twice must fail, got %v", err)
	}

	// Unlock is per login session.
	other := a
	other.SessionID = "another-session"
	mustBeLocked(t, e, other)

	e.clock.Advance(UnlockTTL + time.Second)
	mustBeLocked(t, e, a)
}

func TestUnlockNeverOutlivesSession(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	a.TokenExpiry = e.clock.Now().Add(2 * time.Hour)
	enroll(t, e, a)
	exp := mustBeUnlocked(t, e, a)
	if !exp.Equal(a.TokenExpiry.UTC().Truncate(time.Microsecond)) {
		t.Fatalf("unlock should end with the JWT (%v), got %v", a.TokenExpiry, exp)
	}
}

func TestSkewWindow(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	secret, _ := enroll(t, e, a)
	e.clock.Advance(5 * time.Minute)

	if _, err := e.svc.Unlock(a, codeAt(t, secret, e.clock.Now().Add(-30*time.Second)), ""); err != nil {
		t.Fatalf("previous step should be accepted: %v", err)
	}
	e.clock.Advance(5 * time.Minute)
	if _, err := e.svc.Unlock(a, codeAt(t, secret, e.clock.Now().Add(-90*time.Second)), ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("3 steps old should be rejected: %v", err)
	}
}

func TestLockoutAfterFailures(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	secret, _ := enroll(t, e, a)
	e.svc.Lock(a)
	e.clock.Advance(time.Minute)

	for i := 1; i < MaxFailedAttempts; i++ {
		if _, err := e.svc.Unlock(a, "000000", ""); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	_, err := e.svc.Unlock(a, "000000", "")
	var lo *LockedOutError
	if !errors.As(err, &lo) {
		t.Fatalf("expected lockout on attempt %d, got %v", MaxFailedAttempts, err)
	}
	// Even the right code is refused while locked out.
	e.clock.Advance(30 * time.Second)
	if _, err := e.svc.Unlock(a, codeAt(t, secret, e.clock.Now()), ""); !errors.As(err, &lo) {
		t.Fatalf("correct code during lockout must be refused, got %v", err)
	}
	st, _ := e.svc.Status(a)
	if st.LockedOutUntil == nil {
		t.Fatal("status should report lockout")
	}
	e.clock.Advance(LockoutDuration)
	if _, err := e.svc.Unlock(a, codeAt(t, secret, e.clock.Now()), ""); err != nil {
		t.Fatalf("after lockout expires the right code works: %v", err)
	}
	actions := strings.Join(e.auditActions(t), ",")
	if strings.Count(actions, ActionMFAFailed) != MaxFailedAttempts || !strings.Contains(actions, ActionMFALockedOut) {
		t.Fatalf("failures/lockout not audited: %s", actions)
	}
}

func TestFailureWindowResets(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	enroll(t, e, a)
	for i := 0; i < MaxFailedAttempts-1; i++ {
		e.svc.Unlock(a, "000000", "")
	}
	e.clock.Advance(FailureWindow + time.Second)
	if _, err := e.svc.Unlock(a, "000000", ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("old failures should have aged out, got %v", err)
	}
}

func TestConcurrentGuessesCannotExceedLimit(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	enroll(t, e, a)
	var wg sync.WaitGroup
	var mu sync.Mutex
	invalidCount := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.svc.Unlock(a, "000000", "")
			if errors.Is(err, ErrInvalidCode) {
				mu.Lock()
				invalidCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	// Row lock serializes attempts: exactly MaxFailedAttempts-1 plain
	// failures, then one lockout, then everything else is refused unchecked.
	if invalidCount != MaxFailedAttempts-1 {
		t.Fatalf("expected %d checked guesses, got %d", MaxFailedAttempts-1, invalidCount)
	}
}

func TestRecoveryCodesAreSingleUse(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	_, codes := enroll(t, e, a)
	e.svc.Lock(a)

	res, err := e.svc.Unlock(a, "", strings.ToUpper(codes[3])) // case/dash-insensitive
	if err != nil {
		t.Fatal(err)
	}
	if res.RecoveryCodesRemaining == nil || *res.RecoveryCodesRemaining != RecoveryCodeCount-1 {
		t.Fatalf("remaining: %v", res.RecoveryCodesRemaining)
	}
	e.svc.Lock(a)
	if _, err := e.svc.Unlock(a, "", codes[3]); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("used recovery code must fail, got %v", err)
	}
	if _, err := e.svc.Unlock(a, "", "short"); err == nil {
		t.Fatal("malformed recovery code should be a validation error")
	}
	if !strings.Contains(strings.Join(e.auditActions(t), ","), ActionRecoveryCodeUsed) {
		t.Fatal("recovery code use not audited")
	}
}

func TestLogoutRevokesUnlock(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	enroll(t, e, a)
	mustBeUnlocked(t, e, a)
	if err := e.svc.RevokeSession(a, "logout"); err != nil {
		t.Fatal(err)
	}
	mustBeLocked(t, e, a)
	// Idempotent and silent for sessions with nothing open (non-admins too).
	if err := e.svc.RevokeSession(a, "logout"); err != nil {
		t.Fatal(err)
	}
	u := e.user(t, "bob", "user")
	if err := e.svc.RevokeSession(u, "logout"); err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(strings.Join(e.auditActions(t), ","), ActionVaultLocked); n != 1 {
		t.Fatalf("expected exactly one VAULT_LOCKED event, got %d", n)
	}
}

func TestResetMFA(t *testing.T) {
	e := newEnv(t)
	alice := e.user(t, "alice", "admin")
	bob := e.user(t, "bob", "admin")
	enroll(t, e, alice)
	enroll(t, e, bob)

	if err := e.svc.ResetMFA(alice, alice.UserID); !errors.Is(err, ErrCannotResetSelf) {
		t.Fatalf("self reset: %v", err)
	}
	if err := e.svc.ResetMFA(alice, bob.UserID); err != nil {
		t.Fatal(err)
	}
	mustBeLocked(t, e, bob)
	st, _ := e.svc.Status(bob)
	if st.Enrolled {
		t.Fatal("bob should need to re-enroll")
	}
	admins, err := e.svc.ListMembers(alice)
	if err != nil || len(admins) != 2 {
		t.Fatalf("list admins: %v %v", admins, err)
	}
	if err := e.svc.ResetMFAByUsername(Actor{Username: "cli:root"}, "alice"); err != nil {
		t.Fatalf("break-glass reset: %v", err)
	}
}

func mkApp(t *testing.T, e *env, a Actor, projectID, name string) string {
	t.Helper()
	app, err := e.svc.CreateApp(a, projectID, AppInput{Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return app.ID
}

func TestHierarchyLifecycle(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")

	p, err := e.svc.CreateProject(a, ProjectInput{Name: "  Client Alpha ", Description: "client"})
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Client Alpha" {
		t.Fatalf("name not trimmed: %q", p.Name)
	}
	var ce *ConflictError
	if _, err := e.svc.CreateProject(a, ProjectInput{Name: "client alpha"}); !errors.As(err, &ce) {
		t.Fatalf("case-insensitive duplicate project must conflict, got %v", err)
	}

	app, err := e.svc.CreateApp(a, p.ID, AppInput{Name: "AWS Console", LoginURL: "https://console.aws.amazon.com"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CreateApp(a, p.ID, AppInput{Name: "aws console"}); !errors.As(err, &ce) {
		t.Fatalf("duplicate app name in a project must conflict, got %v", err)
	}
	// Same app name in another client is fine.
	p2, _ := e.svc.CreateProject(a, ProjectInput{Name: "Client Beta"})
	if _, err := e.svc.CreateApp(a, p2.ID, AppInput{Name: "AWS Console"}); err != nil {
		t.Fatalf("same app name in another project: %v", err)
	}

	// One app, several accounts.
	notes := vcrypto.Secret("root MFA is on the yubikey")
	root, err := e.svc.CreateCredential(a, app.ID, CredentialInput{Label: "Root", Username: "root@client.test", Password: "S3cr3t!root", Notes: &notes})
	if err != nil {
		t.Fatal(err)
	}
	ro, err := e.svc.CreateCredential(a, app.ID, CredentialInput{Label: "Read-only", Username: "auditor", Password: "ro-pass"})
	if err != nil {
		t.Fatal(err)
	}
	if !root.HasNotes || ro.HasNotes {
		t.Fatal("hasNotes wrong")
	}

	// Stored row: no plaintext anywhere, separate nonces per field.
	var row models.VaultCredential
	e.db.Where("id = ?", root.ID).Take(&row)
	if bytes.Contains(row.PasswordCT, []byte("S3cr3t")) || bytes.Contains(row.NotesCT, []byte("yubikey")) {
		t.Fatal("plaintext stored")
	}
	if bytes.Equal(row.PasswordNonce, row.NotesNonce) {
		t.Fatal("password and notes must not share a nonce")
	}

	apps, err := e.svc.ListApps(a, p.ID)
	if err != nil || len(apps) != 1 || len(apps[0].Accounts) != 2 || apps[0].LoginURL != "https://console.aws.amazon.com" {
		t.Fatalf("list apps: %+v %v", apps, err)
	}
	if apps[0].Accounts[0].Label != "Read-only" || apps[0].Accounts[1].Label != "Root" {
		t.Fatalf("accounts should sort by label: %+v", apps[0].Accounts)
	}
	ps, _ := e.svc.ListProjects(a, "")
	for _, pp := range ps {
		if pp.ID == p.ID && (pp.AppCount != 1 || pp.CredentialCount != 2) {
			t.Fatalf("counts: %+v", pp)
		}
	}
	// Search finds a client by an app name and by an account username.
	if got, _ := e.svc.ListProjects(a, "auditor"); len(got) != 1 || got[0].ID != p.ID {
		t.Fatalf("search by username: %+v", got)
	}
	if got, _ := e.svc.ListProjects(a, "aws"); len(got) != 2 {
		t.Fatalf("search by app name should match both clients: %+v", got)
	}

	pw, err := e.svc.Reveal(a, root.ID, "password", PurposeView)
	if err != nil || pw != "S3cr3t!root" {
		t.Fatalf("reveal: %q %v", pw, err)
	}
	if pw, _ := e.svc.Reveal(a, ro.ID, "password", PurposeCopy); pw != "ro-pass" {
		t.Fatalf("second account: %q", pw)
	}
	n, err := e.svc.Reveal(a, root.ID, "notes", PurposeView)
	if err != nil || n != string(notes) {
		t.Fatalf("notes: %q %v", n, err)
	}
	if _, err := e.svc.Reveal(a, root.ID, "username", PurposeView); err == nil {
		t.Fatal("unknown field must be rejected")
	}

	// Update without a password keeps it; notes "" clears them.
	empty := vcrypto.Secret("")
	upd, err := e.svc.UpdateCredential(a, root.ID, CredentialUpdate{Label: "Root (billing)", Username: "root@client.test", Notes: &empty})
	if err != nil || upd.HasNotes || upd.Label != "Root (billing)" {
		t.Fatalf("update: %+v %v", upd, err)
	}
	if pw, _ := e.svc.Reveal(a, root.ID, "password", PurposeView); pw != "S3cr3t!root" {
		t.Fatalf("password should be unchanged, got %q", pw)
	}
	newPw := vcrypto.Secret("n3w-pass")
	if _, err := e.svc.UpdateCredential(a, root.ID, CredentialUpdate{Label: "Root (billing)", Password: &newPw}); err != nil {
		t.Fatal(err)
	}
	if pw, _ := e.svc.Reveal(a, root.ID, "password", PurposeView); pw != "n3w-pass" {
		t.Fatalf("password should change, got %q", pw)
	}
	if _, err := e.svc.UpdateApp(a, app.ID, AppInput{Name: "AWS Console (prod)", LoginURL: "https://signin.aws.amazon.com"}); err != nil {
		t.Fatal(err)
	}

	// Deletes cascade only by hand: project → apps → accounts.
	if err := e.svc.DeleteProject(a, p.ID); !errors.As(err, &ce) {
		t.Fatalf("deleting a project with apps must conflict, got %v", err)
	}
	if err := e.svc.DeleteApp(a, app.ID); !errors.As(err, &ce) {
		t.Fatalf("deleting an app with accounts must conflict, got %v", err)
	}
	for _, id := range []string{root.ID, ro.ID} {
		if err := e.svc.DeleteCredential(a, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.svc.Reveal(a, root.ID, "password", PurposeView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted credential: %v", err)
	}
	if err := e.svc.DeleteApp(a, app.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteProject(a, p.ID); err != nil {
		t.Fatal(err)
	}

	got := strings.Join(e.auditActions(t), ",")
	want := strings.Join([]string{ActionCreateProject, ActionCreateApp, ActionCreateProject, ActionCreateApp,
		ActionCreateCredential, ActionCreateCredential, ActionViewPassword, ActionCopyPassword, ActionViewNotes,
		ActionUpdateCredential, ActionViewPassword, ActionUpdateCredential, ActionViewPassword, ActionUpdateApp,
		ActionDeleteCredential, ActionDeleteCredential, ActionDeleteApp, ActionDeleteProject}, ",")
	if got != want {
		t.Fatalf("audit trail\n got: %s\nwant: %s", got, want)
	}

	// Reveal events carry project + app ids so history can be filtered.
	events, _, _ := e.svc.ListAudit(AuditQuery{AppID: app.ID, Action: ActionViewPassword})
	if len(events) != 3 || events[0].ProjectID == nil || *events[0].ProjectID != p.ID {
		t.Fatalf("reveal audit should be filterable by app: %+v", events)
	}

	// Nothing secret in any audit row.
	var details []string
	e.db.Model(&models.VaultAuditEvent{}).Pluck("details::text", &details)
	for _, d := range details {
		for _, sec := range []string{"S3cr3t", "n3w-pass", "yubikey", "ro-pass"} {
			if strings.Contains(d, sec) {
				t.Fatalf("secret leaked into audit: %s", d)
			}
		}
	}
}

func TestValidation(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	p, _ := e.svc.CreateProject(a, ProjectInput{Name: "P"})
	var ve *ValidationError
	for name, in := range map[string]AppInput{
		"no app name":    {Name: " "},
		"javascript url": {Name: "A", LoginURL: "javascript:alert(1)"},
		"relative url":   {Name: "A", LoginURL: "/login"},
	} {
		if _, err := e.svc.CreateApp(a, p.ID, in); !errors.As(err, &ve) {
			t.Errorf("%s: want ValidationError, got %v", name, err)
		}
	}
	appID := mkApp(t, e, a, p.ID, "A")
	for name, in := range map[string]CredentialInput{
		"no password":   {Username: "u"},
		"huge password": {Password: vcrypto.Secret(strings.Repeat("x", maxPasswordLen+1))},
		"long label":    {Label: strings.Repeat("l", maxLabel+1), Password: "x"},
	} {
		if _, err := e.svc.CreateCredential(a, appID, in); !errors.As(err, &ve) {
			t.Errorf("%s: want ValidationError, got %v", name, err)
		}
	}
	if _, err := e.svc.CreateCredential(a, "not-a-uuid", CredentialInput{Password: "x"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("bad app id: %v", err)
	}
	if _, err := e.svc.CreateCredential(a, "00000000-0000-0000-0000-000000000000", CredentialInput{Password: "x"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing app: %v", err)
	}
	if _, err := e.svc.CreateApp(a, "00000000-0000-0000-0000-000000000000", AppInput{Name: "x"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing project: %v", err)
	}
	if _, err := e.svc.CreateProject(a, ProjectInput{Name: ""}); !errors.As(err, &ve) {
		t.Errorf("empty project name: %v", err)
	}
}

func TestCiphertextSwapBetweenRowsFails(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	p, _ := e.svc.CreateProject(a, ProjectInput{Name: "P"})
	c1, _ := e.svc.CreateCredential(a, mkApp(t, e, a, p.ID, "one"), CredentialInput{Password: "pw-one"})
	c2, _ := e.svc.CreateCredential(a, mkApp(t, e, a, p.ID, "two"), CredentialInput{Password: "pw-two"})

	// A DB-level attacker copies row 1's ciphertext into row 2.
	var r1 models.VaultCredential
	e.db.Where("id = ?", c1.ID).Take(&r1)
	e.db.Model(&models.VaultCredential{}).Where("id = ?", c2.ID).UpdateColumns(map[string]any{
		"password_ct": r1.PasswordCT, "password_nonce": r1.PasswordNonce})
	if _, err := e.svc.Reveal(a, c2.ID, "password", PurposeView); !errors.Is(err, vcrypto.ErrDecrypt) {
		t.Fatalf("swapped ciphertext must fail authentication, got %v", err)
	}
	// And a failed reveal leaves no VIEW_PASSWORD event claiming it happened.
	for _, act := range e.auditActions(t) {
		if act == ActionViewPassword {
			t.Fatal("failed reveal was audited as a view")
		}
	}
}

func TestAuditIsAppendOnly(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	e.svc.CreateProject(a, ProjectInput{Name: "P"})
	if err := e.db.Exec("UPDATE vault_audit_events SET action = 'X'").Error; err == nil {
		t.Fatal("UPDATE on audit must fail")
	}
	if err := e.db.Exec("DELETE FROM vault_audit_events").Error; err == nil {
		t.Fatal("DELETE on audit must fail")
	}
	if err := e.db.Exec("TRUNCATE vault_audit_events").Error; err == nil {
		t.Fatal("TRUNCATE on audit must fail")
	}
	events, total, err := e.svc.ListAudit(AuditQuery{})
	if err != nil || total != 1 || events[0].Action != ActionCreateProject {
		t.Fatalf("list audit: %+v %d %v", events, total, err)
	}
}

func TestRevealFailsClosedWhenAuditFails(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	p, _ := e.svc.CreateProject(a, ProjectInput{Name: "P"})
	c, _ := e.svc.CreateCredential(a, mkApp(t, e, a, p.ID, "A"), CredentialInput{Password: "pw"})

	// Simulate the audit table being unavailable.
	if err := e.db.Exec("ALTER TABLE vault_audit_events RENAME TO vault_audit_events_gone").Error; err != nil {
		t.Fatal(err)
	}
	pw, err := e.svc.Reveal(a, c.ID, "password", PurposeView)
	if err == nil || pw != "" {
		t.Fatalf("reveal without audit must fail with no plaintext, got %q %v", pw, err)
	}
}

func TestKeyRotation(t *testing.T) {
	e := newEnv(t)
	a := e.user(t, "alice", "admin")
	secret, _ := enroll(t, e, a)
	p, _ := e.svc.CreateProject(a, ProjectInput{Name: "P"})
	notes := vcrypto.Secret("n")
	c, _ := e.svc.CreateCredential(a, mkApp(t, e, a, p.ID, "A"), CredentialInput{Password: "pw", Notes: &notes})

	// Deploy key v2 alongside v1.
	both := testKeyRing(t, 2, 1, 2)
	svc2 := NewService(e.db, both).WithClock(e.clock.Now)
	if pw, err := svc2.Reveal(a, c.ID, "password", PurposeView); err != nil || pw != "pw" {
		t.Fatalf("v1 rows readable with v2 active: %v", err)
	}
	rep, err := svc2.RotateKeys(Actor{Username: "cli:test"})
	if err != nil || rep.Credentials != 1 || rep.MFASecrets != 1 {
		t.Fatalf("rotate: %+v %v", rep, err)
	}
	usage, _ := svc2.KeyVersionUsage()
	if usage[1] != 0 || usage[2] != 2 {
		t.Fatalf("usage after rotation: %v", usage)
	}
	if rep, _ := svc2.RotateKeys(Actor{Username: "cli:test"}); rep.Credentials+rep.MFASecrets != 0 {
		t.Fatal("second rotation should be a no-op")
	}

	// Remove v1 entirely: everything still works.
	only2 := NewService(e.db, testKeyRing(t, 2, 2)).WithClock(e.clock.Now)
	if pw, err := only2.Reveal(a, c.ID, "notes", PurposeView); err != nil || pw != "n" {
		t.Fatalf("after dropping v1: %q %v", pw, err)
	}
	only2.Lock(a)
	e.clock.Advance(time.Minute)
	if _, err := only2.Unlock(a, codeAt(t, secret, e.clock.Now()), ""); err != nil {
		t.Fatalf("MFA after rotation: %v", err)
	}
}
