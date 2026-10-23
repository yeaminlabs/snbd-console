package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// containerLs lists files inside a running container at path using docker exec ls.
// Returns the same shape as fsList for consistency.
func containerLs(container, path string) (any, error) {
	if err := validateContainer(container); err != nil {
		return nil, err
	}
	if path == "" {
		path = "/"
	}
	var out bytes.Buffer
	cmd := exec.Command("docker", "exec", container, "ls", "-la", "--time-style=+%s", path)
	cmd.Stdout = &limitedWriter{buf: &out, max: 256 << 10}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ls failed: %s", strings.TrimSpace(out.String()))
	}
	entries := parseLsOutput(out.String(), path)
	return map[string]any{"path": path, "entries": entries}, nil
}

// parseLsOutput parses `ls -la --time-style=+%s` output into FileEntry objects.
func parseLsOutput(output, dir string) []map[string]any {
	var entries []map[string]any
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		mode := fields[0]
		size := parseInt64(fields[4])
		mtime := parseInt64(fields[5])
		name := strings.Join(fields[6:], " ")
		if name == "." || name == ".." {
			continue
		}
		entryType := "file"
		if strings.HasPrefix(mode, "d") {
			entryType = "dir"
		} else if strings.HasPrefix(mode, "l") {
			entryType = "other"
		}
		entries = append(entries, map[string]any{
			"name":  name,
			"type":  entryType,
			"size":  size,
			"mode":  mode,
			"mtime": mtime,
		})
	}
	return entries
}

func parseInt64(s string) int64 {
	var v int64
	fmt.Sscanf(s, "%d", &v)
	return v
}

// containerRead reads a file inside a running container and returns base64-encoded content.
func containerRead(container, path string) (any, error) {
	if err := validateContainer(container); err != nil {
		return nil, err
	}
	var out bytes.Buffer
	const maxRead = 2 * 1024 * 1024 // 2 MB
	cmd := exec.Command("docker", "exec", container, "cat", path)
	cmd.Stdout = &limitedWriter{buf: &out, max: maxRead}
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("read failed: %v", err)
	}
	return map[string]any{
		"path":    path,
		"size":    out.Len(),
		"content": out.String(),
	}, nil
}

// containerWrite writes base64-encoded content to a file inside a running container using docker cp.
func containerWrite(container, path, data string) (any, error) {
	if err := validateContainer(container); err != nil {
		return nil, err
	}
	content, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, errors.New("invalid base64 data")
	}
	// Write to a temp file on the host then docker cp it in — avoids shell injection
	tmp, err := os.CreateTemp("", "snbd-cw-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(content); err != nil {
		return nil, err
	}
	tmp.Close()

	out, err := exec.Command("docker", "cp", tmp.Name(), container+":"+path).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("write failed: %s", strings.TrimSpace(string(out)))
	}
	return map[string]any{"ok": true}, nil
}

// validateContainer ensures the container name is safe to pass to docker exec.
func validateContainer(name string) error {
	if name == "" {
		return errors.New("container name is required")
	}
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
			return errors.New("invalid container name")
		}
	}
	return nil
}
