# BDIX / Proxmox integration

The panel's `bdix` provider runs on a real Proxmox VE host (`pve.deltadns.xyz`, node `pve`), reached
through a scoped Proxmox API token — never a password, never an interactive login. This document is
the full picture: what actually works today, what's deliberately not built yet, how the host is laid
out, and how to bring an existing customer onto the panel without touching their live VM.

## Status at a glance

| Capability | Hetzner | BDIX (Proxmox) |
|---|---|---|
| Suspend / Unsuspend | ✅ | ✅ |
| Terminate | ✅ | ✅ |
| Resize (Change Package) | ✅ | ✅ (grows cores/memory/disk live; Proxmox cannot shrink a live disk, so a smaller request is silently kept at its current size) |
| Power (start/stop/reboot) | ✅ | ✅ |
| **Create a brand-new order** | ✅ | ❌ not built — see [What isn't built](#what-isnt-built) |
| Reinstall OS | ✅ (provider rebuild) | falls back to the agent-driven reinstall path, not a true Proxmox rebuild |

Suspend/unsuspend/terminate/resize/power were built and verified against a disposable cloned test VM
(never a real customer) before anything touched live infrastructure — see [Verifying changes](#verifying-changes-safely)
for the pattern, which is worth reusing for any future change here.

## Architecture

```
WHMCS service (Module = snbdpanel, Provider = bdix)
  │  HMAC-signed POST /webhooks/whmcs  (apps/api/src/whmcs.ts)
  ▼
getAdapter('bdix')  →  ProxmoxAdapter  (apps/api/src/providers/proxmox.ts)
  │  calls proxmoxClient.ts primitives
  ▼
Proxmox API  (https://pve.deltadns.xyz:8006/api2/json, token auth)
```

`ProxmoxAdapter` implements the same `ProviderAdapter` interface Hetzner does
([providers/index.ts](../apps/api/src/providers/index.ts)), so `whmcs.ts` and the rest of the panel
never know or care which backend a server lives on. `getAdapter('bdix')` returns the real adapter
whenever `PROXMOX_URL` / `PROXMOX_TOKEN_ID` / `PROXMOX_TOKEN_SECRET` are set, and falls back to an
inert dev stub otherwise — refusing outright in production if they're missing, the same pattern
Hetzner uses, so a misconfigured panel can never silently pretend to manage a server that isn't real.

**Important:** most existing BDIX customers in WHMCS are on a *different*, already-installed
third-party module (`puqProxmoxKVM`, "Proxmox VE for WHMCS") that manages 14+ accounts with its own
create/suspend/clone/reinstall and live stats. `snbdpanel` does not touch or replace that module's
customers automatically — a service only comes under `snbdpanel`'s control when its WHMCS product is
explicitly set to Module = SNBD Panel (see [Migrating an existing customer](#migrating-an-existing-customer)).

## The Proxmox environment

- **Node:** single host, name `pve` (not a cluster).
- **Auth:** a privilege-separated API token (`root@pam!amazingpanel`), granted the `PVEAdmin` role on
  path `/` — full VM/storage/network control, but not user/permission administration. Config:
  `PROXMOX_URL`, `PROXMOX_NODE`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET` in `/etc/snbd-console.env`.
- **Templates** (cloud-init ready, for future `create()` work): 9000 Ubuntu 20.04, 9001 Ubuntu 22.04,
  9011 Debian 11, 9012 Debian 12, 9013 "Deboan-13" (name as-is, verify before relying on it), 9021
  CentOS 7, 9022 CentOS 9. No Ubuntu 24.04 template exists yet.
- **Storage:** VM disks live on `local-lvm` (lvmthin). **At last check this was ~88% used** (103 GB
  free of 853 GB) — worth expanding before any bulk BDIX onboarding or new-order automation goes live.
  `local` (dir) holds ISOs/templates/backups; `backup` is a separate Proxmox Backup Server target.
- **Networking — routed `/32` IPs, not a bridged LAN.** Confirmed by reading a live VM's own routing
  table (not guessable from Proxmox's VM config, which has no concept of VM→IP ownership at all):
  ```
  VM 108: 103.112.62.112/32
    default via 103.112.62.1 dev ens18 (on-link static route)
  ```
  Pattern: gateway is the `.1` address of the IP's own `/24` (`103.112.62.X` → gateway `103.112.62.1`).
  Confirmed directly for the `.62` range; the same pattern is assumed (not yet independently confirmed)
  for other ranges like `.63`. A future `create()` would configure this via cloud-init's
  `ipconfig0=ip=<ip>/32,gw=<ip's .1>`, which renders the same on-link-route-plus-default-route pair.
- **IP pool:** not built. New-order provisioning needs a real IP source (see
  [What isn't built](#what-isnt-built)) — Proxmox itself has no notion of which IPs are free.

## Linking an already-existing VM (`attach`)

For a VM someone created by hand on Proxmox before it existed in the panel. Not part of normal
ordering — a migration tool. Lives in [whmcs.ts](../apps/api/src/whmcs.ts) (`action: 'attach'`) and
[proxmoxClient.ts](../apps/api/src/providers/proxmoxClient.ts) (`getVmInfo`, `pushEnrollScript`).

**In WHMCS**, on a service whose product uses `snbdpanel`: set **Dedicated IP** to the VM's real
routed IP, then the service's admin page shows a **"Proxmox VMID (attach existing VPS)"** field under
Module Information — type the VMID, Save. The panel:

1. Looks the VMID up on Proxmox itself (a wrong/fake VMID fails loudly, never creates a phantom
   server) and pulls its real cores/RAM/disk — never trusts the form.
2. Links the service to a client and server record (reusing the same `upsertClient` logic `create`
   uses, so one client never gets two panel logins).
3. Best-effort pushes the enroll script over Proxmox's guest-agent `exec` channel (hypervisor-granted,
   no guest login needed) — same signed, checksum-verified installer every other path uses
   (`curl -fsSL <panel>/enroll/<token> | sh`, `scripts/install.sh`). If the guest agent isn't running
   inside that particular VM, the response includes a one-line manual command instead of failing.

Once linked, the field is replaced with a live "Linked — status: running, agent connected" line.
Re-attaching to a different VMID needs the existing server row cleared first.

**Scripting it directly** (what was used to onboard customers in bulk, bypassing WHMCS entirely) is
just the same signed webhook call — see any of the `attach`/`create` replay patterns in this repo's
history, or ask for the pattern again; it's a dozen lines of Node using `crypto.createHmac`.

## Migrating an existing customer

Only matters for a customer currently on the *other* module (`puqProxmoxKVM`). WHMCS has a built-in,
non-disruptive way to do this:

1. Create a new WHMCS product, Module = **SNBD Panel**, Provider = **BDIX (local)**, matching the
   old product's pricing/specs (Products/Services admin UI — do this by hand or via WHMCS's own
   `AddProduct` API; never by hand-editing `tblproducts`/`tblpricing` directly, those are
   multi-table, easy to corrupt, and this repo has no need to risk that for a one-time admin task).
2. On the customer's service page, **Change Product** to the new one, with **module execution
   unchecked** — this swaps bookkeeping only. The live VM is never touched, no downtime, invoice
   history stays intact.
3. The service now shows standard WHMCS Suspend/Unsuspend/Terminate/Change Package buttons wired to
   `snbdpanel`. Use [`attach`](#linking-an-already-existing-vm-attach) to link it to its real VMID.
4. From then on, WHMCS lifecycle actions for that customer go through the real Proxmox adapter.

**Do this one customer at a time**, confirm each before moving to the next. There is no bulk-migrate
tool, deliberately — a billing-lifecycle mistake across many customers at once is a much worse outcome
than doing it slowly.

## Verifying changes safely

Never exercise suspend/unsuspend/terminate/resize against a real customer's VM to test a code change.
The pattern used to validate the fixes in this file's history, reusable for anything future:

1. Clone a disposable VM from an existing template directly via the Proxmox API
   (`POST /nodes/pve/qemu/<template>/clone`, a fresh `newid` from `GET /cluster/nextid`).
2. Insert a throwaway `clients`/`servers` row pointing at it, with an obviously-fake
   `whmcs_service_id` (e.g. `999999`) that can never collide with a real WHMCS service.
3. Drive it through the real signed `/webhooks/whmcs` calls — the exact code path a real customer
   action takes — checking actual Proxmox state (not just the HTTP response) after each one.
4. Delete the throwaway `clients`/`servers` rows afterward. `terminate` already deletes the VM itself.

This caught a real bug before it ever reached a customer: `stopVmGracefully`'s wait (35s) was shorter
than Proxmox's own ACPI shutdown timeout (~60s+), so a fallback hard-stop fired while the original
shutdown task still held the VM's config lock — a collision that cascaded into every next action on
that VM failing with `can't lock file ... got timeout`. Fixed by waiting out the graceful shutdown
properly (90s), checking real status before ever issuing a competing action, and retrying the hard
stop once if a trailing lock-release delay still gets in the way. Also fixed: `suspend` /
`unsuspend` / `changepackage` / `terminate` weren't catching `ProviderError` the way `create` already
did, so a real Proxmox failure surfaced to WHMCS as a bare "internal error" instead of the actual
reason — they now go through a shared `providerCall()` wrapper that converts it to a proper message.

## Agent resource footprint

The panel agent on a quiet, connected VM idles at roughly **13–16 MB RSS**. It grows under active use
(open terminal sessions, file transfers, exec calls) — not a concern on any VPS size in this fleet.

## What isn't built

- **New BDIX orders don't provision anything.** `ProxmoxAdapter.create()` and `.rebuild()` both
  refuse outright (`"not available for BDIX yet"`) rather than pretending. The real work: clone from
  a template, claim an IP from a pool, configure it via cloud-init (`ipconfig0` + a `cicustom`
  snippet carrying the same enroll script `attach` already proves works), start it.
- **IP pool.** Needs a literal list of free IPs from the host owner (Proxmox has no concept of IP
  ownership to discover this from) — individual addresses and/or CIDR blocks, loaded into a table with
  `free`/`assigned` status. Reclaim policy: only a **terminated** VPS releases its IP automatically; a
  **suspended** one keeps it (it still exists, just powered off — releasing it risks two customers'
  VMs fighting over the same address the moment the first is reactivated).
- **Snippets storage.** Proxmox's `local` storage doesn't currently have the `snippets` content type
  enabled — needed before `create()` can inject a cloud-init script into a fresh clone. A one-time,
  non-destructive Datacenter → Storage setting.

## Known data-integrity oddities on this host (not this panel's doing, worth your attention)

- **VM 100** (`62.51-bdix.deltadns.xyz`) is WHMCS's own legacy "BDIX Server" gateway record, not a
  customer — never attach or touch it as one.
- **VM 141** (`chr-mikrotik`) is a MikroTik router appliance, not a Linux VPS — the panel agent is
  Linux-only, don't attempt to install it there.
- **VM 130 and VM 149** share the exact name `vps-2644-1916` — looks like a leftover duplicate; 149 is
  the one with a matching active WHMCS service (1916), 130 looks orphaned.
- **VM 147** (WHMCS service 1903, marked Suspended) was found actually *running* on Proxmox — a
  suspend that was never applied on the hypervisor side.
- Several WHMCS services marked **Terminated** still have their VM sitting stopped-but-not-deleted on
  Proxmox — reclaimable disk space, relevant given the storage-capacity note above.
