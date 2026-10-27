package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const ed1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP7EkEbXJElVRF1uwtHLYhDq6kZRGiMnBGDQNmiOAcEO me@laptop"
const ed2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGshPEHGZHYBnrIQ6Sn3svduUvJTPxC0xU9bGlsZXAb+ work@laptop"

func newFakeTarget(t *testing.T) (*sshTarget, string) {
	t.Helper()
	home := t.TempDir()
	return &sshTarget{home: home, name: "deployer", uid: os.Getuid(), gid: os.Getgid()}, filepath.Join(home, ".ssh", "authorized_keys")
}

func TestKeyIdentity(t *testing.T) {
	if _, err := keyIdentity(ed1); err != nil {
		t.Fatalf("valid ed25519 rejected: %v", err)
	}
	for _, bad := range []string{
		"",
		"not a key",
		"ssh-rsa AAAAB3NzaC1yc2E fake-comment\n",
		"ssh-ed25519 notbase64!! comment",
		"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP7EkEbXJElVRF1uwtHLYhDq6kZRGiMnBGDQNmiOAcE two\nlines",
		"BEGIN CERTIFICATE-----",
		"ssh-rsa AAAAC3NzaC1lz2", // truncated: shorter than 20 bytes after split? keep
	} {
		if _, err := keyIdentity(bad); err == nil {
			t.Errorf("junk key %q accepted", bad)
		}
	}
}

func TestAddCreatesFileWithRightModes(t *testing.T) {
	tgt, path := newFakeTarget(t)
	out, err := sshAddKeyTo(tgt, mustID(t, ed1), ed1)
	if err != nil {
		t.Fatal(err)
	}
	if got := out.(map[string]any)["added"]; got != true {
		t.Fatalf("first add: %v", out)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Errorf("authorized_keys mode = %v, want 0600", st.Mode().Perm())
	}
	d, _ := os.Stat(filepath.Dir(path))
	if d.Mode().Perm() != 0o700 {
		t.Errorf(".ssh mode = %v, want 0700", d.Mode().Perm())
	}
	data, _ := os.ReadFile(path)
	if !strings.HasSuffix(string(data), ed1+"\n") {
		t.Errorf("file = %q, want trailing key", data)
	}
}

func TestAddIsIdempotentAndIgnoresCommentChanges(t *testing.T) {
	tgt, _ := newFakeTarget(t)
	if _, err := sshAddKeyTo(tgt, mustID(t, ed1), ed1); err != nil {
		t.Fatal(err)
	}
	out, err := sshAddKeyTo(tgt, mustID(t, ed1), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP7EkEbXJElVRF1uwtHLYhDq6kZRGiMnBGDQNmiOAcEO other@device")
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["added"] != false {
		t.Fatalf("same material should not re-add: %v", out)
	}
}

func TestAddThenRemoveKeepsOtherLines(t *testing.T) {
	tgt, path := newFakeTarget(t)
	if _, err := sshAddKeyTo(tgt, mustID(t, ed1), ed1); err != nil {
		t.Fatal(err)
	}
	// seed a second key plus a comment the way ops would after manual edits
	seed := "@comment line\n" + ed2 + " work@laptop\n" + ed1 + " mine\n"
	if err := os.WriteFile(path, []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := sshRemoveKeyTo(tgt, mustID(t, ed1))
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["removed"] != true {
		t.Fatalf("remove: %v", out)
	}
	after, _ := os.ReadFile(path)
	text := string(after)
	if strings.Contains(text, "AAAAIP7EkEbXJElVRF1uwtHLYhDq6kZRGiMnBGDQNmiOAcEO") {
		t.Errorf("target key still present: %q", text)
	}
	for _, want := range []string{"@comment line", "work@laptop", "IGshPEHGZHYBnrIQ6Sn3svduUvJTPxC0xU9bGlsZXAb+"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in %q", want, text)
		}
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != 0o600 {
		t.Errorf("mode after rewrite = %v", st.Mode().Perm())
	}
}

func TestRemoveMissingKeyIsNotAnError(t *testing.T) {
	tgt, path := newFakeTarget(t)
	if _, err := sshAddKeyTo(tgt, mustID(t, ed1), ed1); err != nil {
		t.Fatal(err)
	}
	if _, err := sshRemoveKeyTo(tgt, mustID(t, ed1)); err != nil {
		t.Fatal(err)
	}
	// gone (file left with a single newline is fine); removing again is a clean no-op
	out, err := sshRemoveKeyTo(tgt, mustID(t, ed1))
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["removed"] != false {
		t.Fatalf("second remove should be a no-op: %v", out)
	}
	if _, err := sshRemoveKeyTo(tgt, mustID(t, ed2)); err != nil {
		t.Fatalf("removing a key that was never there must not error: %v", err)
	}
	_ = path
}

func TestTempFileCleanedUpOnRename(t *testing.T) {
	tgt, _ := newFakeTarget(t)
	if _, err := sshAddKeyTo(tgt, mustID(t, ed1), ed1); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(filepath.Join(tgt.home, ".ssh"))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".snbd-ak-") {
			t.Errorf("temp file %s left behind", e.Name())
		}
	}
}

func mustID(t *testing.T, key string) string {
	t.Helper()
	id, err := keyIdentity(key)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
