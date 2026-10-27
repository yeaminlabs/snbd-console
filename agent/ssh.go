package main

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Personal SSH keys are appended to a managed server's authorized_keys. The panel sends the
// full public key line; the agent keeps the key material ("type base64") as the identity for
// duplicate/deactivate matching, so renaming the comment never breaks removal. These helpers
// take an explicit home dir so tests can run without touching a real user.

const maxKeyLine = 8192

var pubKeyRe = regexp.MustCompile(`^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,2})(?: [^\t\r\n]+)?$`)

// keyIdentity validates a public key line and returns "type base64" (comment stripped).
func keyIdentity(key string) (string, error) {
	key = strings.TrimSpace(key)
	if len(key) > maxKeyLine || strings.ContainsAny(key, "\r\n\x00") {
		return "", errors.New("invalid SSH key")
	}
	m := pubKeyRe.FindStringSubmatch(key)
	if m == nil {
		return "", errors.New("not an OpenSSH public key (expect 'type base64 [comment]')")
	}
	blob, err := base64.StdEncoding.DecodeString(m[2])
	if err != nil || len(blob) < 20 || len(blob) > 65536 {
		return "", errors.New("corrupt SSH key payload")
	}
	if err := checkKeyBlob(m[1], blob); err != nil {
		return "", err
	}
	return m[1] + " " + m[2], nil
}

// checkKeyBlob walks the SSH wire strings inside the base64 part so a truncated or hand-tampered
// key is refused here rather than silently sitting in authorized_keys.
func checkKeyBlob(keyType string, blob []byte) error {
	str := func(b []byte) (string, []byte, error) {
		if len(b) < 4 {
			return "", nil, errors.New("corrupt SSH key payload")
		}
		n := int(binary.BigEndian.Uint32(b[:4]))
		if n > len(b)-4 {
			return "", nil, errors.New("corrupt SSH key payload")
		}
		return string(b[4 : 4+n]), b[4+n:], nil
	}
	s, rest, err := str(blob)
	if err != nil || s != keyType {
		return errors.New("corrupt SSH key payload")
	}
	switch keyType {
	case "ssh-ed25519", "sk-ssh-ed25519@openssh.com":
		if len(rest) != 4+32 {
			return errors.New("corrupt ed25519 key")
		}
	case "ssh-rsa":
		var e, n []byte
		var big uint32
		if len(rest) < 4 {
			return errors.New("corrupt rsa key")
		}
		big = binary.BigEndian.Uint32(rest[:4])
		if int(big) > len(rest)-4 {
			return errors.New("corrupt rsa key")
		}
		e = rest[4 : 4+big]
		rest = rest[4+big:]
		if len(rest) < 4 || int(binary.BigEndian.Uint32(rest[:4])) > len(rest)-4-4 {
			return errors.New("corrupt rsa key")
		}
		nlen := int(binary.BigEndian.Uint32(rest[:4]))
		n = rest[4 : 4+nlen]
		if len(e) < 3 || len(n) < 128 {
			return errors.New("rsa key is too short to be real")
		}
	case "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
		"sk-ecdsa-sha2-nistp256@openssh.com":
		curve, rest2, _ := str(rest) // already bounds-checked by the same invariants
		if !strings.HasSuffix(keyType, curve) {
			return errors.New("curve does not match key type")
		}
		if len(rest2) < 4 || int(binary.BigEndian.Uint32(rest2[:4])) > len(rest2)-4 {
			return errors.New("corrupt ecdsa key")
		}
	}
	return nil
}

type sshTarget struct {
	home string
	name string
	uid  int
	gid  int
}

func resolveUser(name string) (*sshTarget, error) {
	if !userRe.MatchString(name) {
		return nil, errors.New("invalid system user")
	}
	u, err := user.Lookup(name)
	if err != nil {
		return nil, fmt.Errorf("no such system user: %s", name)
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return nil, errors.New("user has no numeric uid")
	}
	gid, _ := strconv.Atoi(u.Gid)
	return &sshTarget{home: u.HomeDir, name: name, uid: uid, gid: gid}, nil
}

// sshAddKey appends the key to <home>/.ssh/authorized_keys, creating the .ssh dir and file with
// the right ownership and modes. Adding the same key material twice is a no-op, not an error.
func sshAddKey(userName, key string) (any, error) {
	id, err := keyIdentity(key)
	if err != nil {
		return nil, err
	}
	t, err := resolveUser(userName)
	if err != nil {
		return nil, err
	}
	return sshAddKeyTo(t, id, key)
}

func sshAddKeyTo(t *sshTarget, id, key string) (any, error) {
	dir := filepath.Join(t.home, ".ssh")
	authPath := filepath.Join(dir, "authorized_keys")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chown(dir, t.uid, t.gid); err != nil {
		return nil, err
	}
	existing, _ := os.ReadFile(authPath)
	content := strings.TrimRight(string(existing), "\n")
	if hasKeyId(content, id) {
		return map[string]any{"user": t.name, "added": false, "already": true}, nil
	}
	if content == "" {
		content = key
	} else {
		content += "\n" + key
	}
	if err := writeAuthorizedKeys(authPath, dir, content, t); err != nil {
		return nil, err
	}
	return map[string]any{"user": t.name, "added": true}, nil
}

// sshRemoveKey removes every authorized_keys line with the same key material. A key that is
// already gone reports removed:false so the panel can treat removal as idempotent.
func sshRemoveKey(userName, key string) (any, error) {
	id, err := keyIdentity(key)
	if err != nil {
		return nil, err
	}
	t, err := resolveUser(userName)
	if err != nil {
		return nil, err
	}
	return sshRemoveKeyTo(t, id)
}

func sshRemoveKeyTo(t *sshTarget, id string) (any, error) {
	authPath := filepath.Join(t.home, ".ssh", "authorized_keys")
	existing, err := os.ReadFile(authPath)
	if err != nil {
		return map[string]any{"user": t.name, "removed": false}, nil
	}
	content := strings.TrimRight(string(existing), "\n")
	if !hasKeyId(content, id) {
		return map[string]any{"user": t.name, "removed": false}, nil
	}
	var kept []string
	for _, line := range strings.Split(content, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0]+" "+f[1] == id {
			continue
		}
		if strings.TrimSpace(line) != "" || len(kept) > 0 {
			kept = append(kept, line)
		}
	}
	final := strings.Join(kept, "\n")
	if err := writeAuthorizedKeys(authPath, filepath.Join(t.home, ".ssh"), final, t); err != nil {
		return nil, err
	}
	return map[string]any{"user": t.name, "removed": true}, nil
}

// hasKeyId looks for the key material anywhere in the file, ignoring the comment.
func hasKeyId(content, id string) bool {
	for _, line := range strings.Split(content, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0]+" "+f[1] == id {
			return true
		}
	}
	return false
}

// writeAuthorizedKeys replaces the file atomically (tmp + rename) with 0600 ownership, the
// same style fsWriteFile uses, so a crash mid-write cannot leave a truncated file.
func writeAuthorizedKeys(path string, dir string, content string, t *sshTarget) error {
	tmp, err := os.CreateTemp(dir, ".snbd-ak-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(content + "\n"); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	if err := os.Chown(tmp.Name(), t.uid, t.gid); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
