<?php
/**
 * SNBD Panel: WHMCS provisioning module.
 *
 * Install: copy this folder to <whmcs>/modules/servers/snbdpanel/
 * Setup:   Configuration > System Settings > Servers > Add New Server
 *            Hostname    = your panel address without scheme, e.g. panel.example.com
 *            Secure      = tick (https)
 *            Access Hash = the WHMCS_WEBHOOK_SECRET value from the panel's .env
 *          then create a product with Module = "SNBD Panel" and fill in the plan options.
 *
 * Every call is signed: HMAC-SHA256 over "<unix time>.<json body>" with the access hash.
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
        'provider' => ['FriendlyName' => 'Provider', 'Type' => 'dropdown', 'Options' => ['bdix' => 'BDIX', 'hetzner' => 'Hetzner'], 'Default' => 'bdix'],
        'vcpu'     => ['FriendlyName' => 'vCPU', 'Type' => 'text', 'Size' => '5', 'Default' => '2'],
        'ramGb'    => ['FriendlyName' => 'RAM (GB)', 'Type' => 'text', 'Size' => '5', 'Default' => '4'],
        'diskGb'   => ['FriendlyName' => 'Disk (GB)', 'Type' => 'text', 'Size' => '5', 'Default' => '50'],
        'region'   => ['FriendlyName' => 'Region / location', 'Type' => 'text', 'Size' => '25', 'Description' => 'e.g. Dhaka, hel1'],
        'os'       => ['FriendlyName' => 'Default OS image', 'Type' => 'text', 'Size' => '25', 'Default' => 'ubuntu-24.04', 'Description' => 'A configurable option named "os" overrides this'],
        'serverType' => ['FriendlyName' => 'Hetzner server type', 'Type' => 'text', 'Size' => '15', 'Description' => 'Hetzner only, e.g. cx22. List: GET /v1/server_types'],
    ];
}

/** Build the plan block from product options, letting a configurable option "os" win. */
function snbdpanel_plan(array $params)
{
    $os = $params['configoptions']['os'] ?? $params['configoption6'];
    return array_filter([
        'provider' => $params['configoption1'],
        'vcpu' => (int) $params['configoption2'] ?: null,
        'ramGb' => (float) $params['configoption3'] ?: null,
        'diskGb' => (float) $params['configoption4'] ?: null,
        'region' => $params['configoption5'] ?: null,
        'os' => $os ?: null,
        'serverType' => $params['configoption7'] ?: null,
        'name' => $params['configoption2'] . ' vCPU / ' . $params['configoption3'] . ' GB',
    ], fn ($v) => $v !== null && $v !== '');
}

/**
 * Sends one signed request. $retryKey separates intentional repeats (a new suspend after an unsuspend)
 * from network retries of the same action, which must reuse the key so the panel can deduplicate.
 * Returns [httpStatus, decodedBody|null, curlError|null].
 */
function snbdpanel_call(array $params, string $action, array $extra = [], string $retryKey = '')
{
    $secret = $params['serveraccesshash'];
    $scheme = $params['serversecure'] ? 'https' : 'http';
    $url = $scheme . '://' . $params['serverhostname'] . '/webhooks/whmcs';

    $body = json_encode(array_merge([
        'action' => $action,
        'serviceId' => (int) $params['serviceid'],
        'client' => [
            'id' => (int) $params['clientsdetails']['userid'],
            'email' => $params['clientsdetails']['email'],
            'name' => trim($params['clientsdetails']['firstname'] . ' ' . $params['clientsdetails']['lastname']) ?: $params['clientsdetails']['email'],
        ],
        'hostname' => $params['domain'] ?: null,
    ], $extra), JSON_UNESCAPED_SLASHES);

    $ts = (string) time();
    $signature = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret);
    $key = 'whmcs-' . $params['serviceid'] . '-' . $action . ($retryKey !== '' ? '-' . $retryKey : '');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-SNBD-Timestamp: ' . $ts,
            'X-SNBD-Signature: ' . $signature,
            'X-SNBD-Idempotency-Key: ' . $key,
        ],
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = $raw === false ? curl_error($ch) : null;
    curl_close($ch);

    logModuleCall('snbdpanel', $action, $body, $raw === false ? $err : $raw, null, [$secret]);
    return [$status, $raw ? json_decode($raw, true) : null, $err];
}

function snbdpanel_result(array $res)
{
    [$status, $data, $err] = $res;
    if ($err) {
        return 'Could not reach the panel: ' . $err;
    }
    if ($status >= 200 && $status < 300) {
        return 'success';
    }
    return 'Panel error (' . $status . '): ' . ($data['error'] ?? 'no details');
}

function snbdpanel_CreateAccount(array $params)
{
    return snbdpanel_result(snbdpanel_call($params, 'create', ['plan' => snbdpanel_plan($params)]));
}

function snbdpanel_SuspendAccount(array $params)
{
    // suspend/unsuspend can repeat over a service's life, so the key carries the current minute bucket
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
    return snbdpanel_result(snbdpanel_call($params, 'changepackage', ['plan' => snbdpanel_plan($params)], (string) floor(time() / 60)));
}

/** Client area: a "Manage in panel" button that signs the client in through a one-time link. */
function snbdpanel_ClientArea(array $params)
{
    return ['templatefile' => 'clientarea'];
}

/** Lets the template's form call snbdpanel_sso without WHMCS also drawing its own button. */
function snbdpanel_ClientAreaAllowedFunctions()
{
    return ['sso'];
}

/** Custom button handler: asks the panel for a 60-second sign-in link and redirects to it. */
function snbdpanel_sso(array $params)
{
    [$status, $data, $err] = snbdpanel_call($params, 'sso', [], bin2hex(random_bytes(6)));
    if ($status === 200 && !empty($data['url'])) {
        header('Location: ' . $data['url']);
        exit;
    }
    return 'Could not open the panel' . ($err ? ': ' . $err : '.');
}
