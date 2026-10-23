package main

import "encoding/json"

// Wire messages. Mirrors packages/proto/src/index.ts; keep the two in sync.

type inbound struct {
	Type      string          `json:"type"`
	ServerID  string          `json:"serverId,omitempty"`
	Key       string          `json:"key,omitempty"`
	Message   string          `json:"message,omitempty"`
	Sid       string          `json:"sid,omitempty"`
	Data      string          `json:"data,omitempty"`
	Cols      int             `json:"cols,omitempty"`
	Rows      int             `json:"rows,omitempty"`
	ID        string          `json:"id,omitempty"`
	Op        string          `json:"op,omitempty"`
	Args      json.RawMessage `json:"args,omitempty"`
	JobID     string          `json:"jobId,omitempty"`
	Script    string          `json:"script,omitempty"`
	Container string          `json:"container,omitempty"` // for term.open: exec into this container
}

type hello struct {
	Type     string `json:"type"`
	Token    string `json:"token"`
	Version  string `json:"version"`
	Hostname string `json:"hostname,omitempty"`
}

type auth struct {
	Type     string `json:"type"`
	ServerID string `json:"serverId"`
	Key      string `json:"key"`
	Version  string `json:"version"`
}

type heartbeat struct {
	Type      string  `json:"type"`
	CPU       float64 `json:"cpu"`
	MemUsed   uint64  `json:"memUsed"`
	MemTotal  uint64  `json:"memTotal"`
	DiskUsed  uint64  `json:"diskUsed"`
	DiskTotal uint64  `json:"diskTotal"`
	Uptime    uint64  `json:"uptime"`
	Load1     float64 `json:"load1"`
	Load5     float64 `json:"load5"`
	Load15    float64 `json:"load15"`
	SwapUsed  uint64  `json:"swapUsed"`
	SwapTotal uint64  `json:"swapTotal"`
	NetIn     uint64  `json:"netIn"`  // cumulative bytes received across all interfaces
	NetOut    uint64  `json:"netOut"` // cumulative bytes sent across all interfaces
}

type termOut struct {
	Type string `json:"type"`
	Sid  string `json:"sid"`
	Data string `json:"data"`
}

type termExit struct {
	Type string `json:"type"`
	Sid  string `json:"sid"`
}

type rpcResult struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

type jobLog struct {
	Type  string `json:"type"`
	JobID string `json:"jobId"`
	Data  string `json:"data"`
}

type jobDone struct {
	Type  string `json:"type"`
	JobID string `json:"jobId"`
	Code  int    `json:"code"`
}
