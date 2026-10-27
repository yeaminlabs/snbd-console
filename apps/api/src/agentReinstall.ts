// Reinstalling the operating system on a server that has no provider-side rebuild.
// The panel agent runs as root inside the VPS, so it can drive bin456789/reinstall:
//   1. download reinstall.sh and trans.sh, and patch trans.sh so the freshly installed
//      system gets a one-shot service that enrolls with this panel on first boot;
//   2. start the reinstaller detached (it wipes the disk and reboots by itself).
import { randomBytes } from 'node:crypto';
import { rpc } from './agentRpc.js';
import { RpcError } from './agentRpc.js';

const SOURCE = 'https://raw.githubusercontent.com/bin456789/reinstall/main';
const WORK_DIR = '/var/lib/snbd/reinstall';
const LOG_FILE = '/var/log/snbd-reinstall.log';

/** hex only, so it is safe inside single quotes on a shell command line */
export function generateRootPassword(): string {
  return randomBytes(16).toString('hex');
}

function validArgs(args: string): boolean {
  return /^[a-z0-9][a-z0-9 ._-]{0,80}$/i.test(args);
}

/**
 * Appended to trans.sh: writes an enrollment hook into the target root filesystem (`$1`).
 * trans.sh runs in the installer live system with the new OS mounted, so we only copy files.
 */
function enrollHook(enrollUrl: string): string {
  return String.raw`snbd_install_enroll() {
    (
    set +e
    snbd_os_dir="$1"
    [ -n "$snbd_os_dir" ] || exit 0
    [ -d "$snbd_os_dir/etc" ] || exit 0
    [ -f "$snbd_os_dir/usr/local/sbin/snbd-enroll" ] && exit 0
    mkdir -p "$snbd_os_dir/usr/local/sbin"
    cat >"$snbd_os_dir/usr/local/sbin/snbd-enroll" <<'SNBD_ENROLL'
#!/bin/sh
URL="${enrollUrl}"
i=0
while [ "$i" -lt 120 ]; do
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 2 "$URL" -o /tmp/snbd-enroll.sh 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O /tmp/snbd-enroll.sh "$URL" 2>/dev/null || true
    fi
    if [ -s /tmp/snbd-enroll.sh ] && sh /tmp/snbd-enroll.sh; then
        rm -f /tmp/snbd-enroll.sh
        exit 0
    fi
    i=$((i + 1))
    sleep 10
done
exit 1
SNBD_ENROLL
    chmod 0755 "$snbd_os_dir/usr/local/sbin/snbd-enroll"

    if [ -d "$snbd_os_dir/etc/systemd/system" ]; then
        cat >"$snbd_os_dir/etc/systemd/system/snbd-enroll.service" <<'SNBD_UNIT'
[Unit]
Description=SNBD panel agent enrollment
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/snbd-enroll
ExecStartPost=/bin/sh -c 'systemctl disable snbd-enroll.service >/dev/null 2>&1 || true'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SNBD_UNIT
        mkdir -p "$snbd_os_dir/etc/systemd/system/multi-user.target.wants"
        ln -sf /etc/systemd/system/snbd-enroll.service "$snbd_os_dir/etc/systemd/system/multi-user.target.wants/snbd-enroll.service"
    fi

    if [ ! -d "$snbd_os_dir/etc/systemd/system" ] && [ -d "$snbd_os_dir/etc/init.d" ]; then
        cat >"$snbd_os_dir/etc/init.d/snbd-enroll" <<'SNBD_INITD'
#!/sbin/openrc-run
description="SNBD panel agent enrollment"
depend() {
    need net
    after firewall
}
start() {
    ebegin "Enrolling with the SNBD panel"
    /usr/local/sbin/snbd-enroll
    rc=$?
    eend $rc
    return $rc
}
SNBD_INITD
        chmod 0755 "$snbd_os_dir/etc/init.d/snbd-enroll"
        mkdir -p "$snbd_os_dir/etc/runlevels/default"
        ln -sf /etc/init.d/snbd-enroll "$snbd_os_dir/etc/runlevels/default/snbd-enroll"
    fi
    )
    return 0
}`;
}

/** Downloads both scripts and patches them. Runs in the old OS, before anything is erased. */
export function prepareScript(enrollUrl: string): string {
  return `set -eu
command -v curl >/dev/null 2>&1 || { echo "curl is required on this server"; exit 1; }
command -v bash >/dev/null 2>&1 || { echo "bash is required on this server"; exit 1; }
D=${WORK_DIR}
rm -rf "$D"
mkdir -p "$D"
cd "$D"
echo "downloading reinstall.sh and trans.sh"
curl -fsSL --retry 3 --max-time 40 -o reinstall.sh ${SOURCE}/reinstall.sh
curl -fsSL --retry 3 --max-time 40 -o trans.sh.orig ${SOURCE}/trans.sh
cat > hook.sh <<'SNBD_HOOK_EOF'
${enrollHook(enrollUrl)}
SNBD_HOOK_EOF
echo "patching trans.sh"
awk 'BEGIN { done = 0 } /^# 脚本入口$/ && !done { while ((getline line < "'"$D"'/hook.sh") > 0) print line; done = 1 } { print }' trans.sh.orig > trans.sh
sed -i 's|^    basic_init \\$os_dir$|    basic_init $os_dir\\n    snbd_install_enroll "$os_dir"|' trans.sh
sed -i 's|^    basic_init /os$|    basic_init /os\\n    snbd_install_enroll /os|' trans.sh
sed -i '/^install_alpine() {/,/^}/ s|^}$|    snbd_install_enroll /os\\n}|' trans.sh
calls=$(grep -c 'snbd_install_enroll' trans.sh || true)
[ "$calls" -ge 4 ] || { echo "enrollment hook injection failed (found $calls)"; exit 1; }
sh -n hook.sh || { echo "enrollment hook has a syntax error"; exit 1; }
# use our patched trans.sh instead of the one reinstall.sh downloads
cat > patch-line.txt <<'SNBD_PATCH_EOF'
cp -f /var/lib/snbd/reinstall/trans.sh $initrd_dir/trans.sh
SNBD_PATCH_EOF
sed -i '/curl -Lo \\$initrd_dir\\/trans\\.sh \\$confhome\\/trans\\.sh/r patch-line.txt' reinstall.sh
grep -q "cp -f /var/lib/snbd/reinstall/trans.sh" reinstall.sh || { echo "reinstall.sh patch failed"; exit 1; }
echo "SNBD-REINSTALL-PREPARED"`;
}

/** Starts the reinstaller in its own session and reports whether it survived the first seconds. */
function launchScript(args: string, password: string): string {
  return `set -eu
cd ${WORK_DIR}
rm -f run.pid ${LOG_FILE}
cat > run.sh <<'SNBD_RUN_EOF'
#!/bin/bash
echo $$ > run.pid
exec bash ${WORK_DIR}/reinstall.sh ${args} --password '${password}'
SNBD_RUN_EOF
chmod 0700 run.sh
setsid nohup bash run.sh > ${LOG_FILE} 2>&1 </dev/null &
sleep 5
[ -s run.pid ] || { echo "the reinstaller did not start"; tail -n 30 ${LOG_FILE} 2>/dev/null; exit 1; }
pid=$(cat run.pid)
kill -0 "$pid" 2>/dev/null || { echo "the reinstaller stopped immediately"; tail -n 30 ${LOG_FILE} 2>/dev/null; exit 1; }
echo "SNBD-REINSTALL-STARTED pid=$pid"`;
}

/** Returns the generated root password once the installer is running. */
export async function startAgentReinstall(serverId: string, args: string, enrollUrl: string): Promise<string> {
  if (!validArgs(args)) throw new RpcError(400, 'Unsupported operating system arguments');
  const password = generateRootPassword();

  const prepared = await rpc<{ code: number; out: string }>(serverId, 'exec', { script: prepareScript(enrollUrl), timeoutMs: 55_000 }, 60_000);
  if (prepared.code !== 0 || !prepared.out.includes('SNBD-REINSTALL-PREPARED')) {
    throw new RpcError(502, prepared.out.trim().slice(-400) || 'Could not prepare the reinstaller on the server');
  }

  const started = await rpc<{ code: number; out: string }>(serverId, 'exec', { script: launchScript(args, password), timeoutMs: 30_000 }, 40_000);
  if (started.code !== 0 || !started.out.includes('SNBD-REINSTALL-STARTED')) {
    throw new RpcError(502, started.out.trim().slice(-400) || 'The reinstaller did not start on the server');
  }
  return password;
}
