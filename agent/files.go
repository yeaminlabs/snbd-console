package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxReadChunk  = 1 << 20 // 1 MiB per read call
	maxWriteFile  = 4 << 20 // editor saves
	maxUploadPart = 2 << 20
	maxListing    = 5000
)

// directories whose removal would brick the machine; the panel user is root already, this is a seatbelt
var protectedPaths = map[string]bool{
	"/": true, "/bin": true, "/boot": true, "/dev": true, "/etc": true, "/home": true, "/lib": true, "/lib64": true,
	"/proc": true, "/root": true, "/run": true, "/sbin": true, "/sys": true, "/usr": true, "/var": true, "/opt": true,
}

func cleanPath(p string) (string, error) {
	if !strings.HasPrefix(p, "/") || strings.ContainsRune(p, 0) {
		return "", errors.New("path must be absolute")
	}
	return filepath.Clean(p), nil
}

type entry struct {
	Name  string `json:"name"`
	Type  string `json:"type"` // dir | file | other
	Link  bool   `json:"link,omitempty"`
	Size  int64  `json:"size"`
	Mode  string `json:"mode"`
	MTime int64  `json:"mtime"`
}

func fsList(path string) (any, error) {
	dir, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	des, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]entry, 0, len(des))
	for _, de := range des {
		if len(out) >= maxListing {
			break
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		e := entry{Name: de.Name(), Size: info.Size(), Mode: info.Mode().String(), MTime: info.ModTime().Unix(), Type: "file"}
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			e.Link = true
			if st, err := os.Stat(filepath.Join(dir, de.Name())); err == nil && st.IsDir() {
				e.Type = "dir"
			}
		case info.IsDir():
			e.Type = "dir"
		case !info.Mode().IsRegular():
			e.Type = "other"
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Type == "dir") != (out[j].Type == "dir") {
			return out[i].Type == "dir"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return map[string]any{"path": dir, "entries": out}, nil
}

func fsStat(path string) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	return map[string]any{"size": st.Size(), "dir": st.IsDir(), "mtime": st.ModTime().Unix()}, nil
}

func fsRead(path string, offset int64, length int) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	if length <= 0 || length > maxReadChunk {
		length = maxReadChunk
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, errors.New("is a directory")
	}
	buf := make([]byte, length)
	n, err := f.ReadAt(buf, offset)
	if err != nil && err != io.EOF {
		return nil, err
	}
	return map[string]any{"data": base64.StdEncoding.EncodeToString(buf[:n]), "size": st.Size(), "eof": offset+int64(n) >= st.Size()}, nil
}

// fsWriteFile replaces a file atomically (temp file + rename) keeping its permissions.
func fsWriteFile(path, b64 string) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	if len(data) > maxWriteFile {
		return nil, errors.New("file too large to save here; use upload")
	}
	mode := os.FileMode(0o644)
	if st, err := os.Stat(p); err == nil {
		if st.IsDir() {
			return nil, errors.New("is a directory")
		}
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".snbd-save-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	return map[string]any{"size": len(data)}, os.Rename(tmp.Name(), p)
}

// fsUpload appends one part to <path>.snbd-upload and moves it into place after the last part.
// The offset must match what is already on disk, so a lost or repeated part cannot corrupt the file.
func fsUpload(path string, offset int64, b64 string, last bool) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	if len(data) > maxUploadPart {
		return nil, errors.New("part too large")
	}
	part := p + ".snbd-upload"
	flags := os.O_WRONLY | os.O_CREATE
	if offset == 0 {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if st.Size() != offset {
		f.Close()
		return nil, fmt.Errorf("upload out of order: have %d bytes, got offset %d", st.Size(), offset)
	}
	if _, err := f.WriteAt(data, offset); err != nil {
		f.Close()
		os.Remove(part)
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	if last {
		if old, err := os.Stat(p); err == nil && old.IsDir() {
			os.Remove(part)
			return nil, errors.New("a directory with that name exists")
		} else if err == nil {
			_ = os.Chmod(part, old.Mode().Perm())
		}
		if err := os.Rename(part, p); err != nil {
			return nil, err
		}
	}
	return map[string]any{"size": offset + int64(len(data))}, nil
}

func fsMkdir(path string) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	return nil, os.Mkdir(p, 0o755)
}

func fsRename(from, to string) (any, error) {
	a, err := cleanPath(from)
	if err != nil {
		return nil, err
	}
	b, err := cleanPath(to)
	if err != nil {
		return nil, err
	}
	if protectedPaths[a] {
		return nil, errors.New("refusing to move a protected system path")
	}
	if _, err := os.Lstat(b); err == nil {
		return nil, errors.New("destination already exists")
	}
	return nil, os.Rename(a, b)
}

func fsDelete(path string) (any, error) {
	p, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	if protectedPaths[p] {
		return nil, errors.New("refusing to delete a protected system path")
	}
	return nil, os.RemoveAll(p)
}
