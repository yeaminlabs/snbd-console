package main

import (
	"encoding/base64"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

type termSession struct {
	ptmx *os.File
	cmd  *exec.Cmd
}

type terminals struct {
	mu   sync.Mutex
	sess map[string]*termSession
}

func newTerminals() *terminals { return &terminals{sess: map[string]*termSession{}} }

func shellPath() string {
	if s := os.Getenv("SNBD_SHELL"); s != "" {
		return s
	}
	for _, p := range []string{"/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return "sh"
}

// open starts a login shell on a new PTY and streams its output to send().
func (t *terminals) open(sid string, cols, rows int, send func(any) error) error {
	cmd := exec.Command(shellPath(), "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return err
	}
	t.mu.Lock()
	t.sess[sid] = &termSession{ptmx: ptmx, cmd: cmd}
	t.mu.Unlock()

	go func() {
		buf := make([]byte, 16*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if send(termOut{Type: "term.out", Sid: sid, Data: base64.StdEncoding.EncodeToString(buf[:n])}) != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		if t.remove(sid) {
			_ = send(termExit{Type: "term.exit", Sid: sid})
		}
	}()
	return nil
}

func (t *terminals) remove(sid string) bool {
	t.mu.Lock()
	s, ok := t.sess[sid]
	delete(t.sess, sid)
	t.mu.Unlock()
	if !ok {
		return false
	}
	_ = s.ptmx.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Signal(syscall.SIGHUP)
	}
	go s.cmd.Wait()
	return true
}

func (t *terminals) write(sid, data string) {
	t.mu.Lock()
	s := t.sess[sid]
	t.mu.Unlock()
	if s != nil {
		_, _ = s.ptmx.WriteString(data)
	}
}

func (t *terminals) resize(sid string, cols, rows int) {
	t.mu.Lock()
	s := t.sess[sid]
	t.mu.Unlock()
	if s != nil {
		_ = pty.Setsize(s.ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	}
}

func (t *terminals) closeAll() {
	t.mu.Lock()
	ids := make([]string, 0, len(t.sess))
	for id := range t.sess {
		ids = append(ids, id)
	}
	t.mu.Unlock()
	for _, id := range ids {
		t.remove(id)
	}
}
