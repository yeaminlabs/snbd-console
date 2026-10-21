// First-boot user-data sent to the VM at creation. cloud-init writes the enroll settings, then
// runs the panel's installer, which reads the token from /etc/snbd/agent.env (see scripts/install.sh).
export function buildUserData(panelUrl: string, enrollToken: string): string {
  const base = panelUrl.replace(/\/$/, '');
  const wsUrl = base.replace(/^http/, 'ws') + '/agent';
  return `#cloud-config
write_files:
  - path: /etc/snbd/agent.env
    permissions: '0600'
    content: |
      PANEL_URL=${wsUrl}
      ENROLL_TOKEN=${enrollToken}
runcmd:
  - [ sh, -c, "curl -fsSL ${base}/install.sh | sh" ]
`;
}
