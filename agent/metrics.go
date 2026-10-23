package main

import (
	"fmt"
	"runtime"

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

// collectSysinfo reads mostly-static facts about the machine: distro, architecture, vCPU count,
// and total RAM/disk. Sent once per connection so an imported server (no provider plan on record)
// still shows real specs instead of "—".
func collectSysinfo() sysinfo {
	si := sysinfo{Type: "sysinfo", Arch: runtime.GOARCH}
	if info, err := host.Info(); err == nil && info.Platform != "" {
		if info.PlatformVersion != "" {
			si.OS = fmt.Sprintf("%s %s", titleCase(info.Platform), info.PlatformVersion)
		} else {
			si.OS = titleCase(info.Platform)
		}
	}
	if n, err := cpu.Counts(true); err == nil && n > 0 {
		si.VCPU = n
	}
	if m, err := mem.VirtualMemory(); err == nil {
		si.RAMTotal = m.Total
	}
	if d, err := disk.Usage("/"); err == nil {
		si.DiskTotal = d.Total
	}
	return si
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	if r[0] >= 'a' && r[0] <= 'z' {
		r[0] -= 32
	}
	return string(r)
}
