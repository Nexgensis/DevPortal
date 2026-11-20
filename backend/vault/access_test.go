package vault

import (
	"errors"
	"strings"
	"testing"
	"time"

	vcrypto "backend/vault/crypto"
)

// world: client A {AWS: root, DB: pg}, client B {Mail: ops}; alice admin, bob dev.
type world struct {
	alice, bob             Actor
	a, b                   ProjectDTO
	aws, db, mail          AppDTO
	awsRoot, dbPg, mailOps CredentialDTO
}

func newWorld(t *testing.T, e *env) world {
	t.Helper()
	var w world
	w.alice = e.user(t, "alice", "admin")
	w.bob = e.user(t, "bob", "user")
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	var err error
	w.a, err = e.svc.CreateProject(w.alice, ProjectInput{Name: "Client A"})
	must(err)
	w.b, err = e.svc.CreateProject(w.alice, ProjectInput{Name: "Client B"})
	must(err)
	w.aws, err = e.svc.CreateApp(w.alice, w.a.ID, AppInput{Name: "AWS Console"})
	must(err)
	w.db, err = e.svc.CreateApp(w.alice, w.a.ID, AppInput{Name: "Prod DB"})
	must(err)
	w.mail, err = e.svc.CreateApp(w.alice, w.b.ID, AppInput{Name: "Mail"})
	must(err)
	w.awsRoot, err = e.svc.CreateCredential(w.alice, w.aws.ID, CredentialInput{Label: "Root", Username: "root", Password: "aws-pw"})
	must(err)
	w.dbPg, err = e.svc.CreateCredential(w.alice, w.db.ID, CredentialInput{Label: "Superuser", Username: "pg-super", Password: "db-pw"})
	must(err)
	w.mailOps, err = e.svc.CreateCredential(w.alice, w.mail.ID, CredentialInput{Username: "ops", Password: "mail-pw"})
	must(err)
	return w
}

func TestMemberWithoutGrantsSeesNothing(t *testing.T) {
	e := newEnv(t)
	w := newWorld(t, e)
	if ok, _ := e.svc.HasAnyGrant(w.bob.UserID); ok {
		t.Fatal("bob has no grants yet")
	}
	if ps, _ := e.svc.ListProjects(w.bob, ""); len(ps) != 0 {
		t.Fatalf("bob sees %d clients", len(ps))
	}
	if _, err := e.svc.Reveal(w.bob, w.awsRoot.ID, "password", PurposeView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reveal without grant: %v", err)
	}
	if _, err := e.svc.CreateProject(w.bob, ProjectInput{Name: "Mine"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("create client: %v", err)
	}
}

func TestAppLevelViewGrant(t *testing.T) {
	e := newEnv(t)
	w := newWorld(t, e)
	if _, err := e.svc.SetGrant(w.alice, w.a.ID, GrantInput{UserID: w.bob.UserID, AppID: w.aws.ID, Level: LevelView}); err != nil {
		t.Fatal(err)
	}
	if ok, _ := e.svc.HasAnyGrant(w.bob.UserID); !ok {
		t.Fatal("bob should be a member now")
	}

	ps, err := e.svc.ListProjects(w.bob, "")
	if err != nil || len(ps) != 1 || ps[0].ID != w.a.ID {
		t.Fatalf("bob should see only client A: %+v %v", ps, err)
	}
	if ps[0].Access != "limited" || ps[0].AppCount != 1 || ps[0].CredentialCount != 1 {
		t.Fatalf("counts must only include what bob can see: %+v", ps[0])
	}
	// Search must not reveal what's in apps bob can't see.
	if got, _ := e.svc.ListProjects(w.bob, "pg-super"); len(got) != 0 {
		t.Fatal("search leaked a hidden account")
	}
	if got, _ := e.svc.ListProjects(w.bob, "root"); len(got) != 1 {
		t.Fatal("search should find a visible account")
	}

	apps, err := e.svc.ListApps(w.bob, w.a.ID)
	if err != nil || len(apps) != 1 || apps[0].ID != w.aws.ID || apps[0].Access != "view" || len(apps[0].Accounts) != 1 {
		t.Fatalf("bob's apps: %+v %v", apps, err)
	}
	if _, err := e.svc.ListApps(w.bob, w.b.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other client must be invisible: %v", err)
	}

	if pw, err := e.svc.Reveal(w.bob, w.awsRoot.ID, "password", PurposeCopy); err != nil || pw != "aws-pw" {
		t.Fatalf("view grant should reveal: %q %v", pw, err)
	}
	for name, err := range map[string]error{
		"reveal sibling app":  func() error { _, err := e.svc.Reveal(w.bob, w.dbPg.ID, "password", PurposeView); return err }(),
		"reveal other client": func() error { _, err := e.svc.Reveal(w.bob, w.mailOps.ID, "password", PurposeView); return err }(),
		"delete sibling app":  e.svc.DeleteApp(w.bob, w.db.ID),
	} {
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: want not found, got %v", name, err)
		}
	}
	for name, err := range map[string]error{
		"add account": func() error {
			_, err := e.svc.CreateCredential(w.bob, w.aws.ID, CredentialInput{Password: "x"})
			return err
		}(),
		"edit account": func() error {
			_, err := e.svc.UpdateCredential(w.bob, w.awsRoot.ID, CredentialUpdate{Label: "x"})
			return err
		}(),
		"delete account": e.svc.DeleteCredential(w.bob, w.awsRoot.ID),
		"rename app": func() error {
			_, err := e.svc.UpdateApp(w.bob, w.aws.ID, AppInput{Name: "x"})
			return err
		}(),
		"add app": func() error {
			_, err := e.svc.CreateApp(w.bob, w.a.ID, AppInput{Name: "x"})
			return err
		}(),
		"rename client": func() error {
			_, err := e.svc.UpdateProject(w.bob, w.a.ID, ProjectInput{Name: "x"})
			return err
		}(),
		"list grants": func() error { _, err := e.svc.ListGrants(w.bob, w.a.ID); return err }(),
		"grant self": func() error {
			_, err := e.svc.SetGrant(w.bob, w.a.ID, GrantInput{UserID: w.bob.UserID, Level: LevelEdit})
			return err
		}(),
		"list members": func() error { _, err := e.svc.ListMembers(w.bob); return err }(),
		"reset mfa":    e.svc.ResetMFA(w.bob, w.alice.UserID),
	} {
		if !errors.Is(err, ErrForbidden) {
			t.Errorf("%s: want forbidden, got %v", name, err)
		}
	}
}

func TestClientEditGrantExpiryAndRevoke(t *testing.T) {
	e := newEnv(t)
	w := newWorld(t, e)
	end := e.clock.Now().Add(time.Hour)
	g, err := e.svc.SetGrant(w.alice, w.a.ID, GrantInput{UserID: w.bob.UserID, Level: LevelView, ExpiresAt: &end})
	if err != nil {
		t.Fatal(err)
	}
	// Setting again at the same scope updates the one grant.
	g2, err := e.svc.SetGrant(w.alice, w.a.ID, GrantInput{UserID: w.bob.UserID, Level: LevelEdit, ExpiresAt: &end})
	if err != nil || g2.ID != g.ID || g2.Level != LevelEdit {
		t.Fatalf("upsert: %+v %v", g2, err)
	}
	ps, _ := e.svc.ListProjects(w.bob, "")
	if len(ps) != 1 || ps[0].Access != "edit" || ps[0].AppCount != 2 {
		t.Fatalf("client-wide grant: %+v", ps)
	}
	// Edit on the whole client: manage apps and accounts, not the client.
	app, err := e.svc.CreateApp(w.bob, w.a.ID, AppInput{Name: "Jenkins"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := e.svc.CreateCredential(w.bob, app.ID, CredentialInput{Label: "deploy", Password: "j-pw"})
	if err != nil {
		t.Fatal(err)
	}
	newPw := vcrypto.Secret("db-pw-2")
	if _, err := e.svc.UpdateCredential(w.bob, w.dbPg.ID, CredentialUpdate{Label: "Superuser", Password: &newPw}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteCredential(w.bob, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteApp(w.bob, app.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteProject(w.bob, w.a.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delete client: %v", err)
	}
	members, _ := e.svc.ListMembers(w.alice)
	if len(members) != 2 || members[1].Username != "bob" || members[1].Role != "member" {
		t.Fatalf("members: %+v", members)
	}

	// After the end date: no access at all, immediately.
	e.clock.Advance(61 * time.Minute)
	if ok, _ := e.svc.HasAnyGrant(w.bob.UserID); ok {
		t.Fatal("expired grant still counts")
	}
	if _, err := e.svc.Reveal(w.bob, w.awsRoot.ID, "password", PurposeView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired grant reveal: %v", err)
	}
	gs, _ := e.svc.ListGrants(w.alice, w.a.ID)
	if len(gs) != 1 || !gs[0].Expired {
		t.Fatalf("admin should still see the lapsed grant: %+v", gs)
	}

	// Renew, then revoke.
	if _, err := e.svc.SetGrant(w.alice, w.a.ID, GrantInput{UserID: w.bob.UserID, Level: LevelView}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Reveal(w.bob, w.awsRoot.ID, "password", PurposeView); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RevokeGrant(w.alice, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Reveal(w.bob, w.awsRoot.ID, "password", PurposeView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked grant reveal: %v", err)
	}

	got := strings.Join(e.auditActions(t), ",")
	for _, want := range []string{ActionGrantAccess, ActionUpdateGrant, ActionRevokeAccess} {
		if !strings.Contains(got, want) {
			t.Errorf("audit missing %s: %s", want, got)
		}
	}
}

func TestGrantValidation(t *testing.T) {
	e := newEnv(t)
	w := newWorld(t, e)
	carol := e.user(t, "carol", "admin")
	past := e.clock.Now().Add(-time.Minute)
	var ve *ValidationError
	for name, in := range map[string]GrantInput{
		"to an admin":         {UserID: carol.UserID, Level: LevelView},
		"bad level":           {UserID: w.bob.UserID, Level: "owner"},
		"end date in past":    {UserID: w.bob.UserID, Level: LevelView, ExpiresAt: &past},
		"app of other client": {UserID: w.bob.UserID, Level: LevelView, AppID: w.mail.ID},
		"no such person":      {UserID: "00000000-0000-0000-0000-000000000001", Level: LevelView},
	} {
		if _, err := e.svc.SetGrant(w.alice, w.a.ID, in); !errors.As(err, &ve) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}
