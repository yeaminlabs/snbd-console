package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// state is what the agent keeps after a successful enroll. The one-time token is not stored.
type state struct {
	ServerID string `json:"serverId"`
	Key      string `json:"key"`
}

func statePath(dir string) string { return filepath.Join(dir, "agent.json") }

func loadState(dir string) (*state, error) {
	b, err := os.ReadFile(statePath(dir))
	if err != nil {
		return nil, err
	}
	var s state
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func saveState(dir string, s *state) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(s)
	tmp := statePath(dir) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, statePath(dir))
}

// dropTokenFromEnvFile removes the spent ENROLL_TOKEN line so the file holds no leftover secret.
func dropTokenFromEnvFile(path string) {
	if path == "" {
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var kept []string
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "ENROLL_TOKEN=") {
			kept = append(kept, line)
		}
	}
	_ = os.WriteFile(path, []byte(strings.Join(kept, "\n")), 0o600)
}
