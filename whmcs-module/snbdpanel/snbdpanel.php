<?php
/**
 * SNBD Panel — WHMCS server module.
 *
 * What it does
 *   CreateAccount  provisions the VPS with the panel's provider adapter (Hetzner by default) and
 *                  creates a real panel login for the WHMCS client. The generated password is
 *                  stored on the WHMCS service (Service Username / Service Password) and shown in
 *                  the client area, so the client can sign in with email + password or use SSO.
 *   Suspend        powers the VPS off through the provider.
 *   Unsuspend      powers it back on.
 *   Terminate      deletes the VPS and revokes the agent's access.
 *   ChangePackage  resizes the VPS (Hetzner only; the panel answers 501 elsewhere).
 *   ClientArea     status, IP, OS, credentials, "Open panel" (one-click SSO), "Reset password".
 *   LoginLink      admin-side one-click sign-in as the client.
 *   TestConnection "Test Connection" button on the server settings page.
 *
 * Install
 *   1. Copy the `snbdpanel` folder to <whmcs>/modules/servers/snbdpanel/
 *   2. Configuration > System Settings > Servers > Add New Server
 *        Hostname    panel.example.com          (or https://panel.example.com)
 *        Secure      ticked when the panel is HTTPS
 *        Access Hash the WHMCS_WEBHOOK_SECRET value from the panel's .env
 *      Press "Test Connection" — it should say successful.
 *   3. Create a product, set Module = "SNBD Panel", and fill in the Module Settings.
 *
 * Every request is signed: HMAC-SHA256 over "<unix time>.<raw json body>" with the Access Hash,
 * sent as X-SNBD-Signature: sha256=<hex>, plus X-SNBD-Timestamp and X-SNBD-Idempotency-Key.
 * The token for the provider lives in the panel's .env; it is never stored in WHMCS.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

function snbdpanel_MetaData()
{
    return [
        'DisplayName' => 'SNBD Panel',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
    ];
}

function snbdpanel_ConfigOptions()
{
    return [
        // 1
        'provider' => [
            'FriendlyName' => 'Provider',
            'Type' => 'dropdown',
            'Options' => ['hetzner' => 'Hetzner Cloud', 'bdix' => 'BDIX (local)'],
            'Default' => 'hetzner',
            'Description' => 'Where the VPS is created.',
        ],
        // 2
        'vcpu' => [
            'FriendlyName' => 'vCPU',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '2',
            'Description' => 'Shown in the panel and used when resizing.',
        ],
        // 3
        'ramGb' => [
            'FriendlyName' => 'RAM (GB)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '4',
        ],
        // 4
        'diskGb' => [
            'FriendlyName' => 'Disk (GB)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '40',
        ],
        // 5
        'region' => [
            'FriendlyName' => 'Region / location',
            'Type' => 'text',
            'Size' => '20',
            'Description' => 'Hetzner location, e.g. nbg1, fsn1, hel1, ash, hil. Empty = provider default.',
        ],
        // 6
        'os' => [
            'FriendlyName' => 'OS image',
            'Type' => 'text',
            'Size' => '25',
            'Default' => 'ubuntu-24.04',
            'Description' => 'Hetzner image name or id. A configurable option named "os" overrides this.',
        ],
        // 7
        'serverType' => [
            'FriendlyName' => 'Hetzner server type',
            'Type' => 'text',
            'Size' => '15',
            'Description' => 'Required for Hetzner, e.g. cx22, cpx11, cax11. List: GET /v1/server_types',
        ],
    ];
}

/** Panel base URL from the server settings, tolerating a pasted scheme and trailing slash. */
function snbdpanel_base_url(array $params)
{
    $host = trim((string) ($params['serverhostname'] ?? ''));
    if ($host === '') {
        return '';
    }
    if (!preg_match('#^https?://#i', $host)) {
        $host = (!empty($params['serversecure']) ? 'https://' : 'http://') . $host;
    }
    return rtrim($host, '/');
}

/** Build the plan block from the product's module settings, letting a configurable option "os" win. */
function snbdpanel_plan(array $params)
{
    $provider = strtolower(trim((string) ($params['configoption1'] ?? '')));
    if (!in_array($provider, ['bdix', 'hetzner'], true)) {
        $provider = 'hetzner';
    }

    $os = $params['configoptions']['os'] ?? ($params['configoption6'] ?? '');

    return array_filter([
        'provider' => $provider,
        'vcpu' => (int) ($params['configoption2'] ?? 0) ?: null,
        'ramGb' => (float) ($params['configoption3'] ?? 0) ?: null,
        'diskGb' => (float) ($params['configoption4'] ?? 0) ?: null,
        'region' => trim((string) ($params['configoption5'] ?? '')) ?: null,
        'os' => trim((string) $os) ?: null,
        'serverType' => trim((string) ($params['configoption7'] ?? '')) ?: null,
        'name' => trim((string) ($params['configoption2'] ?? '') . ' vCPU / ' . (string) ($params['configoption3'] ?? '') . ' GB', ' /'),
    ], static function ($value) {
        return $value !== null && $value !== '';
    });
}

/**
 * One signed request to the panel.
 *
 * $retryKey separates intentional repeats (a second suspend after an unsuspend) from network
 * retries of the same action. Pass a stable, empty-ish value when the action is idempotent
 * (create, terminate) and a time bucket or random value for actions that must run again.
 *
 * Returns [httpStatus, decodedBody|null, curlError|null].
 */
function snbdpanel_call(array $params, $action, array $extra = [], $retryKey = '', $timeout = 60)
{
    $secret = trim((string) ($params['serveraccesshash'] ?? ''));
    if (strlen($secret) < 32) {
        return [0, null, 'The server Access Hash is missing or too short. Paste the panel\'s WHMCS_WEBHOOK_SECRET into Setup > Servers.'];
    }
    $base = snbdpanel_base_url($params);
    if ($base === '') {
        return [0, null, 'The server Hostname is empty. Put the panel address, e.g. panel.example.com, in Setup > Servers.'];
    }

    $body = ['action' => $action];
    if (!empty($params['serviceid'])) {
        $body['serviceId'] = (int) $params['serviceid'];
    }
    if (!empty($params['clientsdetails']['userid'])) {
        $body['client'] = [
            'id' => (int) $params['clientsdetails']['userid'],
            'email' => (string) $params['clientsdetails']['email'],
            'name' => trim(
                (string) ($params['clientsdetails']['firstname'] ?? '') . ' ' .
                (string) ($params['clientsdetails']['lastname'] ?? '')
            ) ?: (string) $params['clientsdetails']['email'],
        ];
    }
    if (!empty($params['domain'])) {
        $body['hostname'] = (string) $params['domain'];
    }
    $body = array_merge($body, $extra);
    $payload = json_encode($body, JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return [0, null, 'Could not encode the request.'];
    }

    $ts = (string) time();
    $signature = 'sha256=' . hash_hmac('sha256', $ts . '.' . $payload, $secret);
    $serviceId = (int) ($params['serviceid'] ?? 0);
    $key = 'whmcs-' . $serviceId . '-' . $action . ($retryKey !== '' ? '-' . $retryKey : '');
    // a key must be 8-120 chars of [\w:.-]; a bare "whmcs-0-ping" is 13, fine
    if (strlen($key) > 120) {
        $key = substr($key, 0, 120);
    }

    $ch = curl_init($base . '/webhooks/whmcs');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'SNBD-WHMCS/2.0',
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-SNBD-Timestamp: ' . $ts,
            'X-SNBD-Signature: ' . $signature,
            'X-SNBD-Idempotency-Key: ' . $key,
        ],
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = $raw === false ? curl_error($ch) : null;
    if (PHP_VERSION_ID < 80500) {
        curl_close($ch);
    }

    $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;

    // never leave a generated password in the module log; the Access Hash is masked too
    $mask = [$secret];
    if (is_array($data)) {
        if (!empty($data['client']['password'])) {
            $mask[] = (string) $data['client']['password'];
        }
        if (!empty($data['password'])) {
            $mask[] = (string) $data['password'];
        }
    }

    logModuleCall('snbdpanel', $action, $payload, $raw === false ? $err : $raw, null, $mask);
    return [$status, $data, $err];
}

/** Turn a snbdpanel_call() result into the "success" / error string WHMCS expects. */
function snbdpanel_result(array $res)
{
    list($status, $data, $err) = $res;
    if ($err !== null) {
        return $status === 0 ? $err : 'Could not reach the panel: ' . $err;
    }
    if ($status >= 200 && $status < 300) {
        return 'success';
    }

    $message = is_array($data) && !empty($data['error']) ? $data['error'] : 'no details';
    if (is_array($data) && !empty($data['detail']) && is_array($data['detail'])) {
        $message .= ' (' . implode('; ', $data['detail']) . ')';
    }
    if ($status === 401) {
        $message .= ' — check that the server Access Hash matches WHMCS_WEBHOOK_SECRET.';
    } elseif ($status === 503) {
        $message .= ' — WHMCS_WEBHOOK_SECRET is not configured on the panel.';
    } elseif ($status === 409) {
        $message .= ' — the panel is still working on it; retry in a moment.';
    }
    return 'Panel error (' . $status . '): ' . $message;
}

/**
 * Save the panel login on the WHMCS service so it survives, shows in the admin area, and can be
 * printed in the product welcome email as {$service_username} / {$service_password}.
 */
function snbdpanel_store_credentials(array $params, array $client)
{
    $serviceId = (int) ($params['serviceid'] ?? 0);
    if (!$serviceId) {
        return;
    }
    $email = trim((string) ($client['email'] ?? ''));
    $password = (string) ($client['password'] ?? '');
    if ($email === '' && $password === '') {
        return;
    }

    $update = ['serviceid' => $serviceId];
    if ($email !== '') {
        $update['serviceusername'] = $email;
    }
    if ($password !== '') {
        $update['servicepassword'] = $password;
    }

    try {
        $result = localAPI('UpdateClientProduct', $update);
        if (($result['result'] ?? '') !== 'success') {
            logModuleCall('snbdpanel', 'save credentials', $update, $result, null, [$password]);
        }
    } catch (\Throwable $e) {
        logModuleCall('snbdpanel', 'save credentials failed', $update, $e->getMessage(), null, [$password]);
    }
}

/** Live view of the service from the panel. Returns ['ok' => bool, 'data' => array|null, 'error' => string]. */
function snbdpanel_snapshot(array $params, $timeout = 8)
{
    if (empty($params['serviceid'])) {
        return ['ok' => false, 'data' => null, 'error' => 'This service has no id yet.'];
    }
    // the panel answers reads fresh; the key only satisfies the idempotency header
    list($status, $data, $err) = snbdpanel_call($params, 'info', [], 'probe-' . bin2hex(random_bytes(4)), $timeout);
    if ($err !== null) {
        return ['ok' => false, 'data' => null, 'error' => $err];
    }
    if ($status !== 200 || !is_array($data) || !isset($data['server'])) {
        return [
            'ok' => false,
            'data' => null,
            'error' => 'Panel error (' . $status . '): '
                . (is_array($data) && !empty($data['error']) ? $data['error'] : 'no details'),
        ];
    }
    return ['ok' => true, 'data' => $data, 'error' => ''];
}

/* ------------------------------------------------------------------ provisioning */

function snbdpanel_CreateAccount(array $params)
{
    $plan = snbdpanel_plan($params);
    if ($plan['provider'] === 'hetzner' && empty($plan['serverType'])) {
        return 'Hetzner needs a server type. Set "Hetzner server type" in the product\'s Module Settings '
            . '(for example cx22 or cpx11 — list them with GET /v1/server_types).';
    }

    list($status, $data, $err) = snbdpanel_call($params, 'create', ['plan' => $plan], '', 90);
    $result = snbdpanel_result([$status, $data, $err]);
    if ($result !== 'success') {
        return $result;
    }

    if (!empty($data['client'])) {
        snbdpanel_store_credentials($params, [
            'email' => $data['client']['email'] ?? '',
            'password' => $data['client']['password'] ?? '',
        ]);
    }

    if (!empty($data['existing'])) {
        // a retried create: the panel already had the server, so no new password exists to save
        logModuleCall('snbdpanel', 'create (already provisioned)', [], $data);
    }
    return 'success';
}

function snbdpanel_SuspendAccount(array $params)
{
    // suspend/unsuspend repeat over a service's life, so the key carries the current minute
    return snbdpanel_result(snbdpanel_call($params, 'suspend', [], (string) floor(time() / 60)));
}

function snbdpanel_UnsuspendAccount(array $params)
{
    return snbdpanel_result(snbdpanel_call($params, 'unsuspend', [], (string) floor(time() / 60)));
}

function snbdpanel_TerminateAccount(array $params)
{
    return snbdpanel_result(snbdpanel_call($params, 'terminate'));
}

function snbdpanel_ChangePackage(array $params)
{
    $plan = snbdpanel_plan($params);
    // a different target size within the same minute must be a new request, not a replay
    $fingerprint = substr(md5(json_encode($plan)), 0, 8);
    return snbdpanel_result(snbdpanel_call($params, 'changepackage', ['plan' => $plan], $fingerprint));
}

/* ------------------------------------------------------------------ admin helpers */

function snbdpanel_TestConnection(array $params)
{
    list($status, $data, $err) = snbdpanel_call($params, 'ping', [], 'probe-' . bin2hex(random_bytes(4)), 8);
    if ($err !== null) {
        return ['success' => false, 'error' => 'Could not reach the panel: ' . $err];
    }
    if ($status === 200 && !empty($data['ok'])) {
        return ['success' => true, 'error' => ''];
    }
    return ['success' => false, 'error' => snbdpanel_result([$status, $data, $err])];
}

/** The plain panel link shown on the server settings page. */
function snbdpanel_AdminLink(array $params)
{
    $url = snbdpanel_base_url($params);
    if ($url === '') {
        return '';
    }
    return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" target="_blank" rel="noopener">'
        . 'Open SNBD Panel</a>';
}

/**
 * "Login as Client" in the admin area. A one-time link is minted when the page renders and is
 * valid for 60 seconds, so it must be clicked straight away (reload the page for a fresh one).
 */
function snbdpanel_LoginLink(array $params)
{
    list($status, $data, $err) = snbdpanel_call($params, 'sso', [], bin2hex(random_bytes(6)), 8);
    if ($status === 200 && !empty($data['url'])) {
        return '<a href="' . htmlspecialchars($data['url'], ENT_QUOTES, 'UTF-8') . '" target="_blank" rel="noopener">'
            . 'Log in to SNBD Panel as this client</a>';
    }
    return '<span class="text-muted">SNBD Panel login unavailable: '
        . htmlspecialchars($err !== null ? $err : snbdpanel_result([$status, $data, $err]), ENT_QUOTES, 'UTF-8')
        . '</span>';
}

/* ------------------------------------------------------------------ client area */

function snbdpanel_ClientArea(array $params)
{
    $snapshot = snbdpanel_snapshot($params);
    $data = $snapshot['ok'] ? $snapshot['data'] : [];
    $server = $data['server'] ?? [];

    $status = (string) ($server['status'] ?? 'provisioning');
    $suspended = !empty($server['suspended']);
    $online = !empty($server['agentConnected']);

    if ($suspended) {
        $label = 'Suspended';
        $tone = 'danger';
    } elseif ($status === 'running') {
        $label = $online ? 'Online' : 'Booting';
        $tone = $online ? 'ok' : 'warn';
    } elseif ($status === 'provisioning') {
        $label = 'Provisioning';
        $tone = 'info';
    } elseif ($status === 'stopped') {
        $label = 'Stopped';
        $tone = 'muted';
    } elseif ($status === 'agent_offline') {
        $label = 'Agent offline';
        $tone = 'warn';
    } else {
        $label = ucfirst(str_replace('_', ' ', $status));
        $tone = 'muted';
    }

    $email = trim((string) ($data['client']['email'] ?? ($params['username'] ?? '')));
    // WHMCS keeps the password we stored at create time or after the last reset
    $password = (string) ($params['password'] ?? '');

    $os = trim((string) ($server['os'] ?? ''));
    $osLabel = $os !== '' ? ucwords(str_replace(['-', '_'], ' ', $os)) : '—';
    $region = trim((string) ($server['region'] ?? ''));
    $provider = (string) ($server['provider'] ?? ($params['configoption1'] ?? ''));
    $providerLabel = $provider === 'hetzner' ? 'Hetzner Cloud' : ($provider === 'bdix' ? 'BDIX' : ucfirst($provider));

    $notice = '';
    $error = '';
    $flash = isset($_GET['snbd']) ? (string) $_GET['snbd'] : '';
    if ($flash === 'reset') {
        $notice = 'A new panel password was generated and saved on this service.';
    } elseif ($flash === 'reseterror') {
        $error = 'The panel password could not be reset. Please try again, or contact support.';
    }

    $panelError = '';
    if (!$snapshot['ok']) {
        $panelError = $snapshot['error'];
    }

    return [
        'templatefile' => 'clientarea',
        'vars' => [
            'serviceid' => (int) ($params['serviceid'] ?? 0),
            'notice' => $notice,
            'error' => $error,
            'panel_error' => $panelError,
            'status_label' => $label,
            'status_tone' => $tone,
            'is_provisioning' => $status === 'provisioning',
            'server_name' => (string) ($server['name'] ?? ($params['domain'] ?? '')),
            'ip' => (string) ($server['ip'] ?? ''),
            'os_label' => $osLabel,
            'region_label' => $region !== '' ? $region : 'Provider default',
            'provider_label' => $providerLabel,
            'email' => $email,
            'password' => $password,
            'has_password' => $password !== '',
            'panel_url' => (string) ($data['panelUrl'] ?? snbdpanel_base_url($params)),
        ],
    ];
}

/** Custom buttons the template may post to (modop=custom&a=...). */
function snbdpanel_ClientAreaAllowedFunctions()
{
    return ['sso', 'resetpassword'];
}

/** One-click sign-in: mint a 60-second link and hand the browser over to the panel. */
function snbdpanel_sso(array $params)
{
    list($status, $data, $err) = snbdpanel_call($params, 'sso', [], bin2hex(random_bytes(6)), 8);
    if ($status === 200 && !empty($data['url'])) {
        header('Location: ' . $data['url']);
        exit;
    }
    logModuleCall('snbdpanel', 'sso failed', [], $err !== null ? $err : $data);
    return 'Could not open the panel' . ($err !== null ? ': ' . $err : '. Please try again.');
}

/**
 * Generates a new panel password, revokes the old sessions, saves the new password on the service
 * and reloads the page so the credentials card shows it.
 */
function snbdpanel_resetpassword(array $params)
{
    $back = 'clientarea.php?action=productdetails&id=' . (int) ($params['serviceid'] ?? 0);
    list($status, $data, $err) = snbdpanel_call($params, 'resetpassword', [], bin2hex(random_bytes(6)), 15);
    if ($status === 200 && !empty($data['password'])) {
        snbdpanel_store_credentials($params, [
            'email' => $data['email'] ?? '',
            'password' => $data['password'],
        ]);
        header('Location: ' . $back . '&snbd=reset');
        exit;
    }
    logModuleCall('snbdpanel', 'reset password failed', [], $err !== null ? $err : $data);
    header('Location: ' . $back . '&snbd=reseterror');
    exit;
}
