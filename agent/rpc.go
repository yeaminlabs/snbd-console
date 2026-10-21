package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var userRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

type rpcArgs struct {
	Path      string `json:"path"`
	From      string `json:"from"`
	To        string `json:"to"`
	Offset    int64  `json:"offset"`
	Length    int    `json:"length"`
	Data      string `json:"data"`
	Last      bool   `json:"last"`
	Script    string `json:"script"`
	TimeoutMs int    `json:"timeoutMs"`
	User      string `json:"user"`
	Password  string `json:"password"`
}

// handleRPC runs one panel request and always answers, success or failure.
func handleRPC(m inbound, send func(any) error) {
	var a rpcArgs
	if len(m.Args) > 0 {
		if err := json.Unmarshal(m.Args, &a); err != nil {
			_ = send(rpcResult{Type: "rpc.result", ID: m.ID, Error: "bad arguments"})
			return
		}
	}
	var data any
	var err error
	switch m.Op {
	case "fs.list":
		data, err = fsList(a.Path)
	case "fs.stat":
		data, err = fsStat(a.Path)
	case "fs.read":
		data, err = fsRead(a.Path, a.Offset, a.Length)
	case "fs.writefile":
		data, err = fsWriteFile(a.Path, a.Data)
	case "fs.upload":
		data, err = fsUpload(a.Path, a.Offset, a.Data, a.Last)
	case "fs.mkdir":
		data, err = fsMkdir(a.Path)
	case "fs.rename":
		data, err = fsRename(a.From, a.To)
	case "fs.delete":
		data, err = fsDelete(a.Path)
	case "exec":
		data, err = runExec(a.Script, a.TimeoutMs)
	case "setpassword":
		data, err = setPassword(a.User, a.Password)
	default:
		err = errors.New("unknown operation")
	}
	res := rpcResult{Type: "rpc.result", ID: m.ID, OK: err == nil, Data: data}
	if err != nil {
		res.Error = cleanErr(err)
	}
	_ = send(res)
}

// cleanErr keeps the useful part of an OS error and drops absolute-path noise from the wrapper
func cleanErr(err error) string {
	s := err.Error()
	if i := strings.LastIndex(s, ": "); i >= 0 && strings.Contains(s, "/") {
		return s[i+2:]
	}
	return s
}

func runExec(script string, timeoutMs int) (any, error) {
	if timeoutMs <= 0 || timeoutMs > 60000 {
		timeoutMs = 20000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	var out bytes.Buffer
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", script)
	cmd.Stdout = &limitedWriter{buf: &out, max: 64 << 10}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	code := 0
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			return nil, err
		}
	}
	return map[string]any{"code": code, "out": strings.ToValidUTF8(out.String(), "?")}, nil
}

type limitedWriter struct {
	buf *bytes.Buffer
	max int
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	if room := w.max - w.buf.Len(); room > 0 {
		if len(p) > room {
			w.buf.Write(p[:room])
		} else {
			w.buf.Write(p)
		}
	}
	return len(p), nil
}

// setPassword feeds chpasswd on stdin so the password never shows up in a process list.
func setPassword(user, password string) (any, error) {
	if !userRe.MatchString(user) {
		return nil, errors.New("invalid user name")
	}
	if len(password) < 12 || len(password) > 128 || strings.ContainsAny(password, "\r\n\x00") {
		return nil, errors.New("invalid password")
	}
	cmd := exec.Command("chpasswd")
	cmd.Stdin = strings.NewReader(user + ":" + password + "\n")
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, errors.New("chpasswd failed: " + strings.TrimSpace(string(out)))
	}
	return nil, nil
}
