{* SNBD Panel — client area for one service. All values come from snbdpanel_ClientArea(). *}
<style>
  #snbd-service { --snbd-line: rgba(128, 128, 128, .28); --snbd-muted: #6b7280; }
  #snbd-service .snbd-card { border: 1px solid var(--snbd-line); border-radius: 12px; overflow: hidden; }
  #snbd-service .snbd-head { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--snbd-line); }
  #snbd-service .snbd-title { margin: 0; font-size: 1.1rem; font-weight: 600; line-height: 1.3; }
  #snbd-service .snbd-sub { margin: .15rem 0 0; font-size: .8rem; color: var(--snbd-muted); }
  #snbd-service .snbd-body { padding: 1.25rem; }
  #snbd-service .snbd-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .28rem .7rem; border-radius: 999px; font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  #snbd-service .snbd-pill::before { content: ""; width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
  #snbd-service .snbd-pill--ok { background: #e7f7ee; color: #11663a; }
  #snbd-service .snbd-pill--warn { background: #fdf3dc; color: #8a5a00; }
  #snbd-service .snbd-pill--info { background: #e6f0fe; color: #1d4ed8; }
  #snbd-service .snbd-pill--muted { background: #eef0f3; color: #4b5563; }
  #snbd-service .snbd-pill--danger { background: #fdeaea; color: #a12020; }
  #snbd-service .snbd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 0 0 1.25rem; }
  @media (min-width: 720px) { #snbd-service .snbd-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  #snbd-service .snbd-label { display: block; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--snbd-muted); margin-bottom: .2rem; }
  #snbd-service .snbd-value { font-size: .95rem; font-weight: 600; word-break: break-word; }
  #snbd-service .snbd-value code { font-weight: 600; }
  #snbd-service .snbd-creds { border: 1px dashed var(--snbd-line); border-radius: 10px; padding: 1rem; }
  #snbd-service .snbd-creds h4 { margin: 0 0 .65rem; font-size: .95rem; font-weight: 600; }
  #snbd-service .snbd-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: .5rem; }
  #snbd-service .snbd-row:last-child { margin-bottom: 0; }
  #snbd-service .snbd-row .snbd-label { width: 5.5rem; margin: 0; flex: 0 0 auto; }
  #snbd-service .snbd-btn { appearance: none; cursor: pointer; padding: .42rem .75rem; font-size: .8rem; font-weight: 600; line-height: 1.2; color: inherit; background: transparent; border: 1px solid var(--snbd-line); border-radius: 7px; white-space: nowrap; }
  #snbd-service .snbd-btn:hover { border-color: var(--snbd-muted); }
  #snbd-service .snbd-btn:disabled { opacity: .6; cursor: default; }
  #snbd-service .snbd-input { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88rem; padding: .45rem .6rem; border: 1px solid var(--snbd-line); border-radius: 7px; background: transparent; color: inherit; }
  #snbd-service .snbd-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
  #snbd-service .snbd-note { font-size: .78rem; color: var(--snbd-muted); margin: .75rem 0 0; line-height: 1.5; }
  #snbd-service .snbd-alert { padding: .7rem .9rem; border-radius: 8px; font-size: .86rem; margin-bottom: 1rem; }
  #snbd-service .snbd-alert--ok { background: #e7f7ee; color: #11663a; }
  #snbd-service .snbd-alert--err { background: #fdeaea; color: #a12020; }
  #snbd-service .snbd-divider { height: 1px; background: var(--snbd-line); margin: 1.25rem 0; }
  #snbd-service .snbd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>

<div id="snbd-service">
  <div class="snbd-card">

    <div class="snbd-head">
      <div>
        <h3 class="snbd-title">{$server_name|escape}</h3>
        <p class="snbd-sub">{$provider_label|escape} &middot; managed by SNBD Panel</p>
      </div>
      <div class="snbd-actions">
        <span class="snbd-pill snbd-pill--{$status_tone|escape}">{$status_label|escape}</span>
        <form method="post" action="clientarea.php?action=productdetails" style="margin:0">
          <input type="hidden" name="id" value="{$serviceid}">
          <input type="hidden" name="modop" value="custom">
          <input type="hidden" name="a" value="sso">
          <button type="submit" class="btn btn-primary">
            Open panel &rarr;
          </button>
        </form>
      </div>
    </div>

    <div class="snbd-body">

      {if $notice}<div class="snbd-alert snbd-alert--ok">{$notice|escape}</div>{/if}
      {if $error}<div class="snbd-alert snbd-alert--err">{$error|escape}</div>{/if}
      {if $panel_error}
        <div class="snbd-alert snbd-alert--err">
          The panel could not be reached for live status right now ({$panel_error|escape}).
          The details below may be a little out of date.
        </div>
      {/if}

      {if $is_provisioning}
        <div class="snbd-alert snbd-alert--ok">
          Your server is being created. This usually takes under a minute; refresh this page to see it come online.
        </div>
      {/if}

      <div class="snbd-grid">
        <div>
          <span class="snbd-label">IP address</span>
          <span class="snbd-value">{$ip|escape|default:'Pending'}</span>
        </div>
        <div>
          <span class="snbd-label">Operating system</span>
          <span class="snbd-value">{$os_label|escape}</span>
        </div>
        <div>
          <span class="snbd-label">Region</span>
          <span class="snbd-value">{$region_label|escape}</span>
        </div>
        <div>
          <span class="snbd-label">Provider</span>
          <span class="snbd-value">{$provider_label|escape}</span>
        </div>
      </div>

      <div class="snbd-creds">
        <h4>Panel login</h4>

        <div class="snbd-row">
          <span class="snbd-label">Email</span>
          <input class="snbd-input" id="snbd-username" type="text" value="{$email|escape}" readonly
                 aria-label="Panel email">
          <button type="button" class="snbd-btn" data-snbd-copy="snbd-username">Copy</button>
        </div>

        {if $has_password}
          <div class="snbd-row">
            <span class="snbd-label">Password</span>
            <input class="snbd-input" id="snbd-password" type="password" value="{$password|escape}" readonly
                   autocomplete="off" aria-label="Panel password">
            <button type="button" class="snbd-btn" data-snbd-reveal="snbd-password">Show</button>
            <button type="button" class="snbd-btn" data-snbd-copy="snbd-password">Copy</button>
          </div>
        {else}
          <div class="snbd-row">
            <span class="snbd-label">Password</span>
            <input class="snbd-input" type="text" value="Not stored for this service" readonly aria-label="Panel password">
          </div>
        {/if}

        <p class="snbd-note">
          Use this email and password to sign in at
          <span class="snbd-mono">{$panel_url|escape}</span>, or press <strong>Open panel</strong> to sign in
          automatically. If you change your password inside the panel, this page will show the old one until you
          reset it here.
        </p>

        <div class="snbd-divider"></div>

        <div class="snbd-actions">
          <form method="post" action="clientarea.php?action=productdetails" style="margin:0"
                onsubmit="return confirm('Generate a new panel password? The current one will stop working and all panel sessions will be signed out.');">
            <input type="hidden" name="id" value="{$serviceid}">
            <input type="hidden" name="modop" value="custom">
            <input type="hidden" name="a" value="resetpassword">
            <button type="submit" class="snbd-btn">Reset panel password</button>
          </form>
        </div>
      </div>

      <p class="snbd-note" style="margin-top:1rem">
        Inside the panel you get a browser console, file manager, app installer, snapshots and one-click OS
        reinstall. Power on/off and rebuild actions from here are reflected in the panel immediately.
      </p>

    </div>
  </div>
</div>

{literal}
<script>
  (function () {
    var root = document.getElementById('snbd-service');
    if (!root) return;

    function copy(text, button) {
      var done = function () {
        var old = button.textContent;
        button.textContent = 'Copied';
        button.disabled = true;
        setTimeout(function () { button.textContent = old; button.disabled = false; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    }

    function fallback(text, done) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* nothing else to try */ }
      document.body.removeChild(area);
    }

    root.addEventListener('click', function (event) {
      var reveal = event.target.closest('[data-snbd-reveal]');
      if (reveal) {
        var field = document.getElementById(reveal.getAttribute('data-snbd-reveal'));
        if (field) {
          var show = field.type === 'password';
          field.type = show ? 'text' : 'password';
          reveal.textContent = show ? 'Hide' : 'Show';
        }
        return;
      }

      var button = event.target.closest('[data-snbd-copy]');
      if (button) {
        var source = document.getElementById(button.getAttribute('data-snbd-copy'));
        if (source && source.value) copy(source.value, button);
      }
    });
  })();
</script>
{/literal}
