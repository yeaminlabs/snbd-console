package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const jobTimeout = 45 * time.Minute

type jobs struct {
	mu   sync.Mutex
	runs map[string]context.CancelFunc
	send func(any) error
}

func newJobs(send func(any) error) *jobs { return &jobs{runs: map[string]context.CancelFunc{}, send: send} }

// start runs a script in its own process group and streams its output as job.log messages.
func (j *jobs) start(id, script string) {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	j.mu.Lock()
	if _, busy := j.runs[id]; busy {
		j.mu.Unlock()
		cancel()
		return
	}
	j.runs[id] = cancel
	j.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			j.mu.Lock()
			delete(j.runs, id)
			j.mu.Unlock()
		}()
		pr, pw, err := os.Pipe()
		if err != nil {
			_ = j.send(jobDone{Type: "job.done", JobID: id, Code: 127})
			return
		}
		cmd := exec.Command("/bin/bash", "-c", script)
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=a", "HOME="+homeOr("/root"))
		cmd.Stdout, cmd.Stderr = pw, pw
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if err := cmd.Start(); err != nil {
			pw.Close()
			pr.Close()
			_ = j.send(jobLog{Type: "job.log", JobID: id, Data: "failed to start: " + err.Error() + "\n"})
			_ = j.send(jobDone{Type: "job.done", JobID: id, Code: 127})
			return
		}
		pw.Close()

		// stop the whole group on cancel, disconnect or timeout: ask politely first so apt/dpkg can
		// release their locks, then force it if the group is still alive after a grace period
		exited := make(chan struct{})
		defer close(exited)
		go func() {
			select {
			case <-exited:
				return
			case <-ctx.Done():
			}
			if cmd.Process == nil {
				return
			}
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
			select {
			case <-exited:
			case <-time.After(10 * time.Second):
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
		}()

		buf := make([]byte, 4096)
		for {
			n, err := pr.Read(buf)
			if n > 0 {
				_ = j.send(jobLog{Type: "job.log", JobID: id, Data: strings.ToValidUTF8(string(buf[:n]), "?")})
			}
			if err != nil {
				break
			}
		}
		pr.Close()
		code := 0
		if err := cmd.Wait(); err != nil {
			code = 1
			if ee, ok := err.(*exec.ExitError); ok {
				code = ee.ExitCode()
			}
		}
		if ctx.Err() == context.DeadlineExceeded {
			_ = j.send(jobLog{Type: "job.log", JobID: id, Data: "\ntimed out after 45 minutes\n"})
		}
		_ = j.send(jobDone{Type: "job.done", JobID: id, Code: code})
	}()
}

func (j *jobs) cancel(id string) {
	j.mu.Lock()
	c := j.runs[id]
	j.mu.Unlock()
	if c != nil {
		c()
	}
}

func (j *jobs) killAll() {
	j.mu.Lock()
	for _, c := range j.runs {
		c()
	}
	j.mu.Unlock()
}

func homeOr(def string) string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return def
}
