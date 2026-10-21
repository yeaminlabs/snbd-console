package main

import (
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

func collect() heartbeat {
	hb := heartbeat{Type: "heartbeat"}
	if p, err := cpu.Percent(0, false); err == nil && len(p) > 0 {
		hb.CPU = p[0]
	}
	if m, err := mem.VirtualMemory(); err == nil {
		hb.MemUsed, hb.MemTotal = m.Used, m.Total
	}
	if d, err := disk.Usage("/"); err == nil {
		hb.DiskUsed, hb.DiskTotal = d.Used, d.Total
	}
	if up, err := host.Uptime(); err == nil {
		hb.Uptime = up
	}
	return hb
}
