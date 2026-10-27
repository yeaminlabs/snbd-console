# SNBD Panel — WHMCS provisioning module

A WHMCS server module that turns a paid order into a working VPS **and** a working panel account:

1. WHMCS activates the order and calls `CreateAccount`.
2. The module signs a request to the panel's `/webhooks/whmcs` endpoint.
3. The panel creates the VPS through the provider adapter (Hetzner Cloud) and inserts it into its own database.
4. The panel creates a client login (email + generated password) for the WHMCS client.
5. The password comes back once, and the module saves it on the WHMCS service as **Service Username / Service Password**.
6. The client can now sign in to the panel directly, or press **Open panel** for a one-click, 60-second SSO link.

The Hetzner API token lives only in the panel's `.env`. WHMCS never sees it; it only holds the webhook signing secret.

## What the client sees

On **Services → My Services → (the VPS)** the client area shows:

- a live status pill (Online / Booting / Provisioning / Stopped / Suspended / Agent offline),
- IP address, OS, region and provider,
- the panel **email and password**, masked with Show / Copy buttons,
- **Open panel →** which mints a single-use SSO link and signs them in without typing anything,
- **Reset panel password**, which generates a new password, revokes the old sessions and stores the new one on the service.

Admins get **Log in to SNBD Panel as this client** on the service page (`LoginLink`) and a plain **Open SNBD Panel** link on the server settings page (`AdminLink`).

## Requirements

- WHMCS 8.x (PHP 7.4+; PHP 8.x recommended) with the `curl` extension.
- A panel deployment reachable over HTTPS from the WHMCS server.
- `WHMCS_WEBHOOK_SECRET` set in the panel's `.env` (at least 32 characters). Generate one with:
  `openssl rand -hex 32`
- `HETZNER_API_TOKEN` set in the panel's `.env`. The panel refuses to provision Hetzner servers in production without it — it will not silently create a "stub" server.
- `PUBLIC_PANEL_URL` set to the public panel address (used in first-boot cloud-init).

## Install

1. Copy the module folder:

   ```bash
   cp -R whmcs-module/snbdpanel /path/to/whmcs/modules/servers/snbdpanel
   ```

   The result must be `modules/servers/snbdpanel/snbdpanel.php` and
   `modules/servers/snbdpanel/templates/clientarea.tpl`.

2. In WHMCS: **Configuration → System Settings → Servers → Add New Server**

   | Field | Value |
   | --- | --- |
   | Module | SNBD Panel |
   | Name | anything, e.g. `SNBD Panel` |
   | Hostname | `panel.example.com` (or `https://panel.example.com`) |
   | Secure | ticked for HTTPS |
   | Access Hash | the panel's `WHMCS_WEBHOOK_SECRET` |

   Press **Test Connection**. It sends a signed `ping` and should report success. A failure here
   almost always means the URL is wrong or the Access Hash does not match.

3. **Configuration → System Settings → Products/Services → Create a New Product**
   - Product Type: **VPS** (or any type)
   - Module: **SNBD Panel**
   - Server group: the group containing the server from step 2
   - In **Module Settings**, fill in the plan:

   | Setting | Example | Notes |
   | --- | --- | --- |
   | Provider | Hetzner Cloud | `BDIX` only records the order (placeholder adapter) |
   | vCPU / RAM / Disk | `2` / `4` / `40` | display + resize values |
   | Region / location | `nbg1` | Hetzner: `nbg1`, `fsn1`, `hel1`, `ash`, `hil`; empty = provider default |
   | OS image | `ubuntu-24.04` | any Hetzner image name/id |
   | Hetzner server type | `cx22` | **required** for Hetzner, e.g. `cx22`, `cpx11`, `cax11` |

4. **Optional — let the client pick the OS at checkout.** Create a configurable option named
   exactly `os` (Configuration → System Settings → Configurable Options) with the images you
   support as dropdown values, and assign it to the product. It overrides the OS image setting.

5. **Welcome email.** The credentials are saved on the service, so the default product welcome
   email can include them. Add to the email template:

   ```smarty
   Panel:    {$service_domain}
   Email:    {$service_username}
   Password: {$service_password}
   ```

   New accounts get the credentials in the welcome email; existing clients keep their old password.

## How provisioning behaves

- **Idempotent.** Every request carries `X-SNBD-Idempotency-Key`. A retried `create` returns the
  existing server instead of billing a second VM. The panel also labels Hetzner servers with
  `snbd_server_id`, so even a concurrent retry cannot create two.
- **Long boots are fine.** The panel stores the server as `provisioning` and the agent enrolls on
  first boot using cloud-init. The client area flips to **Online** once the agent connects.
- **The panel owns the provider token.** WHMCS only signs webhook calls.
- **One panel login per WHMCS client.** The panel links accounts by WHMCS client ID, then by email,
  so a client buying a second VPS does not get a second login.
- **Passwords are write-once from the panel's side.** The panel stores a hash; WHMCS stores the
  plaintext so it can show it and put it in email. If the client changes it inside the panel,
  **Reset panel password** brings WHMCS and the panel back in sync.

## Actions

| WHMCS event | Module function | Panel action | Effect |
| --- | --- | --- | --- |
| Order accepted | `CreateAccount` | `create` | VPS + panel client; returns password once |
| Suspend | `SuspendAccount` | `suspend` | provider power-off, terminals closed |
| Unsuspend | `UnsuspendAccount` | `unsuspend` | provider power-on |
| Terminate | `TerminateAccount` | `terminate` | provider delete, agent key + enroll tokens revoked |
| Upgrade/downgrade | `ChangePackage` | `changepackage` | provider resize |
| Client area | `ClientArea` | `info` | live status, IP, OS, email |
| Open panel | `sso` | `sso` | 60-second single-use login URL |
| Reset password | `resetpassword` | `resetpassword` | new password, all panel sessions revoked |
| Test Connection | `TestConnection` | `ping` | verifies reachability + signature |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Could not reach the panel: Could not resolve host` | Wrong Hostname in the server settings, or the WHMCS server has no outbound HTTPS. |
| `Panel error (401): bad signature` | Access Hash ≠ `WHMCS_WEBHOOK_SECRET`, or the server clock is more than 5 minutes off. |
| `Panel error (503): webhook not configured` | `WHMCS_WEBHOOK_SECRET` is missing or shorter than 32 characters in the panel `.env`. |
| `Hetzner needs a server type` | Fill in **Hetzner server type** in the product's Module Settings. |
| `provider failed to create the server: HETZNER_API_TOKEN is not set` | Add the token to `/opt/snbd/.env` and restart `snbd-api`. |
| `provider failed to create the server: ...unauthorized` | Hetzner token is wrong or revoked. |
| `provider failed to create the server: ...quota` | Hetzner project limit reached. |
| `request in progress` (409) | A duplicate call is still running; retry in a moment. |
| Login link expired | SSO links are valid for 60 seconds and single-use. Reload the page and click again. |
| Client area says "Not stored for this service" | The service was created before this module version, or the first create failed after provisioning. Use **Reset panel password**. |

Every call is written to **Utilities → Logs → Module Log** under `snbdpanel`, with the Access Hash
masked, so failed requests can be inspected without exposing the secret.

## Security notes

- Requests are HMAC-SHA256 signed over `<unix timestamp>.<raw body>`; the panel rejects timestamps
  older than 5 minutes and replays are deduplicated by idempotency key.
- SSO tokens are stored hashed, are single-use and expire after 60 seconds.
- The generated panel password is 24 hex characters (96 bits) and is stored hashed inside the panel.
- Terminating a service deletes the agent key and any unused enrollment token, so the VM cannot
  reconnect even if it is restored from a snapshot.
