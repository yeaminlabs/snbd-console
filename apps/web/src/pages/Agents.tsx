import { useEffect, useState, type FormEvent } from 'react';
import { api, type McpConnection, type McpInfo, type Server, type TokenInfo } from '../api';
import { Badge } from '../components/Badge';
import { IconActivity, IconBot, IconFile, IconRestart, IconServers, IconTerminal } from '../components/Icons';
import { ago } from '../format';
import opencodeLogo from '../assets/opencode.svg';
import cursorLogo from '../assets/cursor.svg';
import clineLogo from '../assets/cline.png';
import roocodeLogo from '../assets/roocode.png';
import hermesLogo from '../assets/hermes.png';
import openclawLogo from '../assets/openclaw.svg';
import windsurfLogo from '../assets/windsurf.svg';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* the text stays selectable */ } }}>
      {done ? '✓ Copied' : label}
    </button>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <div className="mcp-steps">{children}</div>;
}

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="mcp-snippet">
      <pre className="codebox mono" tabIndex={0}>{code}</pre>
      <Copy text={code} label={label} />
    </div>
  );
}

const Ticker = ({ on }: { on: boolean }) => <span className={`mcp-dot ${on ? 'on' : ''}`} aria-hidden="true" />;

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function ConnectionCard({ c, onDisconnect }: { c: McpConnection; onDisconnect: (c: McpConnection) => void }) {
  const machine = [c.os, c.ip].filter(Boolean).join(' · ');
  const logo = logoForConnection(c);
  return (
    <article className="mcp-conn" data-kind={c.clientKind}>
      <div className="mcp-conn-top">
        {logo ? (
          <span className="mcp-avatar has-logo" aria-hidden="true">
            <img src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <span className="mcp-avatar-fallback">{(c.name || '?').slice(0, 1).toUpperCase()}</span>
          </span>
        ) : (
          <span className="mcp-avatar" aria-hidden="true">{(c.name || '?').slice(0, 1).toUpperCase()}</span>
        )}
        <div className="mcp-conn-id">
          <div className="mcp-conn-name">
            {c.name}
            {c.version && <span className="muted" style={{ fontWeight: 400 }}> v{c.version}</span>}
            <Badge cls={c.connected ? 'ok' : 'off'}>{c.connected ? '● Connected' : c.lastSeenAt ? '○ Idle' : '○ Not used yet'}</Badge>
          </div>
          <div className="muted mcp-conn-machine">
            {c.lastSeenAt
              ? <>{machine || 'Machine unknown'}<span aria-hidden="true"> · </span>last used {ago(c.lastSeenAt)}</>
              : 'No request yet — machine and address appear after the first connection.'}
          </div>
        </div>
        <button className="link-btn danger" onClick={() => onDisconnect(c)} aria-label={`Disconnect ${c.name}`}>Disconnect</button>
      </div>
      <div className="mcp-conn-meta">
        {c.scope === 'deploy' ? <span className="mcp-chip mcp-chip-full">⚡ Full access</span> : <span className="mcp-chip">👁️ Read-only</span>}
        <span className="mcp-chip">{c.servers ? (c.servers.length === 1 ? c.servers[0] : `${c.servers.length} servers`) : '🌐 All servers'}</span>
        {c.kind === 'connector' && <span className="mcp-chip muted">✓ Approved app</span>}
        {c.expiresAt && <span className="mcp-chip muted">⏱ Access ends {when(c.expiresAt)}</span>}
      </div>
    </article>
  );
}

const CLAUDE_LOGO = 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/anthropic.svg';
const OPENAI_LOGO = 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/openai.svg';
const OPENCODE_LOGO = opencodeLogo;
const HERMES_LOGO = hermesLogo;
const OPENCLAW_LOGO = openclawLogo;

const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', icon: CLAUDE_LOGO, color: '#d97757', desc: 'Anthropic CLI - Best for coding tasks', command: true, useImage: true },
  { id: 'claude-desktop', name: 'Claude Desktop', icon: CLAUDE_LOGO, color: '#d97757', desc: 'Anthropic desktop app', settings: true, useImage: true },
  { id: 'codex', name: 'OpenAI Codex CLI', icon: OPENAI_LOGO, color: '#10a37f', desc: 'OpenAI coding agent in terminal', command: true, useImage: true },
  { id: 'opencode', name: 'OpenCode', icon: OPENCODE_LOGO, color: '#6366f1', desc: 'Open source AI coding agent', config: true, useImage: true },
  { id: 'cursor', name: 'Cursor', icon: cursorLogo, color: '#0066ff', desc: 'AI-powered code editor', settings: true, useImage: true },
  { id: 'cline', name: 'Cline', icon: clineLogo, color: '#f59e0b', desc: 'VSCode extension AI agent', settings: true, useImage: true },
  { id: 'roo-code', name: 'RooCode', icon: roocodeLogo, color: '#8b5cf6', desc: 'Fork of Cline with extra features', settings: true, useImage: true },
  { id: 'hermes', name: 'Hermes', icon: HERMES_LOGO, color: '#f97316', desc: 'Nous Hermes models', settings: true, useImage: true },
  { id: 'openclaw', name: 'OpenClaw', icon: OPENCLAW_LOGO, color: '#06b6d4', desc: 'Open source coding agent', settings: true, useImage: true },
  { id: 'windsurf', name: 'Windsurf', icon: windsurfLogo, color: '#06b6d4', desc: 'Codeium AI IDE', settings: true, useImage: true },
];

/** Logo shown in every active connection card, keyed by backend clientKind. */
const CLIENT_LOGOS: Record<string, string> = {
  'claude-code': CLAUDE_LOGO,
  'claude-desktop': CLAUDE_LOGO,
  'claude': CLAUDE_LOGO,
  'codex': OPENAI_LOGO,
  'opencode': OPENCODE_LOGO,
  'cursor': cursorLogo,
  'cline': clineLogo,
  'roo-code': roocodeLogo,
  'roocode': roocodeLogo,
  'hermes': HERMES_LOGO,
  'openclaw': OPENCLAW_LOGO,
  'windsurf': windsurfLogo,
};

/** Resolve a connector logo from clientKind, falling back to fuzzy name match so "Claude"/"OpenCode" still show a logo when kind is "other". */
function logoForConnection(c: Pick<McpConnection, 'clientKind' | 'name'>): string | null {
  const kind = (c.clientKind || '').toLowerCase().trim();
  if (CLIENT_LOGOS[kind]) return CLIENT_LOGOS[kind];
  const n = (c.name || '').toLowerCase();
  if (n.includes('claude')) return CLAUDE_LOGO;
  if (n.includes('opencode')) return OPENCODE_LOGO;
  if (n.includes('codex') || n.includes('openai')) return OPENAI_LOGO;
  if (n.includes('cursor')) return cursorLogo;
  if (n.includes('cline')) return clineLogo;
  if (n.includes('roo')) return roocodeLogo;
  if (n.includes('hermes')) return HERMES_LOGO;
  if (n.includes('claw')) return OPENCLAW_LOGO;
  if (n.includes('windsurf')) return windsurfLogo;
  return null;
}

const MASTER_PROMPT = `# SNBD MCP Auto-Connect Prompt

Copy and paste this entire prompt to your AI agent. It will automatically detect your environment and connect to the SNBD MCP server.

\`\`\`
You are an expert at setting up Model Context Protocol (MCP) connections. 

Your task is to connect this environment to the SNBD panel's MCP server. 

## MCP Server Details
Endpoint: {MCP_URL}
Panel: {PANEL_URL}

## Instructions
1. Detect which AI coding assistant/client you're running in (Claude Code, Codex CLI, OpenCode, Cursor, Cline, RooCode, Continue, Aider, or others)
2. Automatically configure the MCP server for that client using the appropriate method
3. If using OAuth flow is available, guide through browser auth. Otherwise use token-based auth
4. Test the connection by calling list_servers to verify
5. Report success with connected servers

## Client-Specific Configs

### Claude Code
\`claude mcp add --transport http snbd {MCP_URL}\` then run \`/mcp\` to authenticate

### OpenAI Codex CLI  
Add to ~/.codex/config.toml:
\`\`\`toml
[mcp_servers.snbd]
type = "http"
url = "{MCP_URL}"
\`\`\`

### OpenCode
Add to opencode.json:
\`\`\`json
{
  "mcp": {
    "snbd": {
      "type": "remote",
      "url": "{MCP_URL}"
    }
  }
}
\`\`\`

### Cursor, Cline, RooCode, Continue.dev
Add to MCP settings:
\`\`\`json
{
  "mcpServers": {
    "snbd": {
      "type": "http",
      "url": "{MCP_URL}"
    }
  }
}
\`\`\`

### VS Code with Continue/Cline
Same as above in settings.json under mcp.servers

## After Connection
Once connected, you have full access to manage servers via natural language. Try: "List all my servers and show their status"

Start now. Do not ask for confirmation - just detect, configure, and connect.
\`\`\`
`;

const tools = [
  { icon: <IconServers />, name: 'list_servers', desc: 'View all servers with status, plan, IP & agent health', type: 'read' },
  { icon: <IconActivity />, name: 'server_status', desc: 'Get real-time CPU, RAM, disk & uptime metrics', type: 'read' },
  { icon: <IconTerminal />, name: 'run_command', desc: 'Execute shell commands with full stdout/stderr/exit code', type: 'write' },
  { icon: <IconFile />, name: 'read_file', desc: 'Read configuration files and logs up to 128KB', type: 'read' },
  { icon: <IconFile />, name: 'write_file', desc: 'Create or update files directly on your servers', type: 'write' },
  { icon: <IconRestart />, name: 'restart_service', desc: 'Start, stop, or restart any systemd service', type: 'write' },
  { icon: <IconActivity />, name: 'view_logs', desc: 'Access system journals, logs & Docker container output', type: 'read' },
  { icon: <IconServers />, name: 'get_public_ip', desc: 'Quickly retrieve server public IP addresses', type: 'read' },
];

const examples = [
  { prompt: '"Show me the status of all my servers"', result: 'Gets live status, uptime, and health for every server' },
  { prompt: '"Check nginx logs on web-01 for errors in the last hour"', result: 'Reads logs and summarizes any issues found' },
  { prompt: '"Restart Redis on db-02 and verify it\'s running"', result: 'Restarts service and confirms it\'s healthy' },
  { prompt: '"Update the config file at /etc/app/config.json"', result: 'Reads, edits, and writes the file safely' },
  { prompt: '"Install git and curl on staging-01"', result: 'Runs apt/yum commands and reports results' },
];

export function Agents() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [only, setOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<string>('90');
  const [access, setAccess] = useState<'read' | 'deploy'>('read');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showMasterPrompt, setShowMasterPrompt] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const load = () => {
    api.mcpConnections().then(setInfo).catch((e) => setError(e.message));
    api.tokens().then(setTokens).catch(() => {});
  };
  useEffect(() => {
    load();
    api.servers().then(setServers).catch(() => {});
    const t = setInterval(() => api.mcpConnections().then(setInfo).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.createToken(name.trim(), only ? picked : null, days === 'never' ? null : Number(days), access);
      setFresh({ name: name.trim(), token: r.token });
      setName(''); setOnly(false); setPicked([]); setAccess('read');
      load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function revoke(t: TokenInfo) {
    if (!confirm(t.kind === 'connector' ? `Disconnect "${t.name}"? It loses access immediately and must be approved again to reconnect.` : `Revoke "${t.name}"? Any AI client using it stops working immediately.`)) return;
    try { await api.revokeToken(t.id); if (fresh?.name === t.name) setFresh(null); load(); } catch (err) { setError((err as Error).message); }
  }
  const disconnect = (c: McpConnection) => revoke({ kind: c.kind, id: c.id, name: c.name, prefix: '', scope: c.scope, serverIds: c.servers, serverNames: c.serverNames, expiresAt: c.expiresAt, lastUsedAt: c.lastSeenAt, createdAt: c.createdAt });

  const url = info?.url ?? `${location.origin}/mcp`;
  const panelUrl = location.origin;
  const connections = info?.connections ?? [];
  const connected = connections.filter((c) => c.connected);
  const claudeCmd = `claude mcp add --transport http snbd ${url}`;
  const opencodeCfg = JSON.stringify({ mcp: { snbd: { type: 'remote', url } } }, null, 2);
  const genericCfg = JSON.stringify({ mcpServers: { snbd: { type: 'http', url } } }, null, 2);
  const freshCmd = fresh ? `claude mcp add --transport http snbd ${url} --header "Authorization: Bearer ${fresh.token}"` : '';
  
  const filledMasterPrompt = MASTER_PROMPT.replace(/{MCP_URL}/g, url).replace(/{PANEL_URL}/g, panelUrl);
  
  const copyMasterPrompt = async () => {
    try {
      await navigator.clipboard.writeText(filledMasterPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {}
  };

  return (
    <>
      <div className="head-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--red) 0%, #991b1b 100%)', color: '#fff' }}>
              <IconBot />
            </span>
            MCP Server
          </h1>
          <div className="muted" style={{ marginTop: 6, maxWidth: 700, fontSize: '14.5px' }}>
            Control your entire infrastructure through natural conversation with AI. Monitor, debug, and fix issues in plain English.
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="mcp-hero" aria-labelledby="mcp-hero-h" style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(239,68,68,0.3) 0%, transparent 70%)', pointerEvents: 'none' }}></div>
        <div style={{ position: 'absolute', bottom: '-30%', left: '20%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(220,38,38,0.2) 0%, transparent 70%)', pointerEvents: 'none' }}></div>
        <div className="mcp-hero-copy" style={{ position: 'relative', zIndex: 1 }}>
          <span className="mcp-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(239,68,68,0.15)', borderRadius: '999px', border: '1px solid rgba(239,68,68,0.4)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fca5a5', boxShadow: '0 0 10px #fca5a5' }}></span>
            MODEL CONTEXT PROTOCOL
          </span>
          <h2 id="mcp-hero-h" style={{ fontSize: 'clamp(28px, 4vw, 38px)', marginTop: '16px' }}>Your Servers. Your AI. Fully Connected.</h2>
          <p style={{ fontSize: '15px', maxWidth: '65ch' }}>
            Give Claude, Cursor, OpenCode, or any MCP-compatible assistant direct access to your infrastructure. 
            Ask it to investigate issues, restart services, read logs, or make changes—all with your explicit approval and full audit trail.
          </p>
          <div className="mcp-url" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' }}>
            <code className="mono" style={{ fontSize: '13px' }}>{url}</code>
            <Copy text={url} label="Copy Endpoint" />
          </div>
        </div>
        <div className="mcp-hero-side" style={{ position: 'relative', zIndex: 1, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <div className="mcp-live">
            <Ticker on={connected.length > 0} />
            <span style={{ fontSize: '14px' }}>{connected.length ? `${connected.length} Active Connection${connected.length === 1 ? '' : 's'}` : 'Awaiting First Connection'}</span>
          </div>
          {connected.length > 0 ? (
            <ul className="mcp-live-list">
              {connected.map((c) => {
                const logo = logoForConnection(c);
                return (
                <li key={c.id}>
                  {logo && <img src={logo} alt="" loading="lazy" className="mcp-live-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  <b>{c.name}</b>
                  <span className="muted">{c.os ?? 'machine unknown'}</span>
                </li>
                );
              })}
            </ul>
          ) : (
            <div className="mcp-live-empty">
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🤖</div>
              <p style={{ textAlign: 'center' }}>Connect your AI agent below to get started</p>
              <button className="btn p" style={{ width: '100%', background: 'linear-gradient(135deg, var(--red) 0%, #dc2626 100%)', border: 'none' }} onClick={() => jump('quick-connect')}>Quick Connect →</button>
            </div>
          )}
          {connections.length > 0 && (
            <div className="mcp-live-foot muted">
              {connections.length} approved connection{connections.length === 1 ? '' : 's'} ·{' '}
              <button className="link-btn mcp-link" onClick={() => jump('connections')}>View All</button>
            </div>
          )}
        </div>
      </section>

      <section id="quick-connect" className="card pad-lg" style={{ marginTop: '32px', background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)', border: '2px solid transparent', backgroundClip: 'padding-box', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: '-2px', background: 'linear-gradient(135deg, var(--red) 0%, #dc2626 50%, #991b1b 100%)', borderRadius: '12px', zIndex: -1 }}></div>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'linear-gradient(135deg, var(--red-tint) 0%, #fee2e2 100%)', borderRadius: '999px', border: '1px solid #fecaca', marginBottom: '16px' }}>
            <span style={{ fontSize: '18px' }}>🎮</span>
            <span style={{ fontWeight: '700', color: 'var(--red-dark)', fontSize: '13px', letterSpacing: '0.05em' }}>QUICK CONNECT</span>
          </div>
          <h2 style={{ fontSize: '32px', margin: '0 0 12px', fontWeight: '700' }}>Choose Your AI Agent</h2>
          <p className="muted" style={{ fontSize: '16px', maxWidth: '600px', margin: '0 auto' }}>
            Select your preferred AI assistant and get instant setup instructions, or use our auto-connect master prompt for any agent
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id === selectedAgent ? null : agent.id)}
              style={{
                padding: '16px',
                borderRadius: '12px',
                border: selectedAgent === agent.id ? `2px solid ${agent.color}` : '2px solid var(--line)',
                background: selectedAgent === agent.id ? `linear-gradient(135deg, ${agent.color}10 0%, ${agent.color}05 100%)` : '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: selectedAgent === agent.id ? `0 4px 20px ${agent.color}25` : '0 1px 3px rgba(0,0,0,0.02)'
              }}
              onMouseEnter={(e) => {
                if (selectedAgent !== agent.id) {
                  e.currentTarget.style.borderColor = agent.color + '60';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = `0 4px 16px ${agent.color}15`;
                }
              }}
              onMouseLeave={(e) => {
                if (selectedAgent !== agent.id) {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.02)';
                }
              }}
            >
              {(agent as any).useImage ? (
                <img src={agent.icon as string} alt={agent.name} style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '6px', flex: '0 0 32px' }} />
              ) : (
                <span style={{ fontSize: '28px', flex: '0 0 28px', lineHeight: 1 }}>{agent.icon}</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: '700', fontSize: '15px', color: selectedAgent === agent.id ? agent.color : 'var(--ink)', marginBottom: '2px' }}>{agent.name}</div>
                <div className="muted" style={{ fontSize: '12px' }}>{agent.desc}</div>
              </div>
              <span style={{ fontSize: '18px', color: selectedAgent === agent.id ? agent.color : '#d4d4d8' }}>{selectedAgent === agent.id ? '▼' : '▶'}</span>
            </button>
          ))}
        </div>

        {selectedAgent && (
          <div style={{ padding: '24px', background: '#fff', borderRadius: '12px', border: '1px solid var(--line)', animation: 'fadeIn 0.3s ease' }}>
            {selectedAgent === 'claude-code' && (
              <div>
                <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px' }}>
                  <img src={CLAUDE_LOGO} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain', borderRadius: '4px' }} /> Claude Code Setup
                </h3>
                <p className="muted" style={{ margin: '0 0 16px' }}>Run this single command in your terminal, then authenticate with <span className="mono">/mcp</span></p>
                <Snippet code={claudeCmd} label="Copy Command" />
                <div style={{ marginTop: '12px', padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>💡 Pro tip:</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--ink-2)' }}>OAuth will open your browser to approve access. Choose which servers to grant access to.</div>
                </div>
              </div>
            )}
            {selectedAgent === 'codex' && (
              <div>
                <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px' }}>
                  <span>⚡</span> OpenAI Codex CLI Setup
                </h3>
                <p className="muted" style={{ margin: '0 0 16px' }}>Add this to your <span className="mono">~/.codex/config.toml</span> file</p>
                <Snippet code={`[mcp_servers.snbd]\ntype = "http"\nurl = "${url}"`} label="Copy Config" />
              </div>
            )}
            {selectedAgent === 'opencode' && (
              <div>
                <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px' }}>
                  <img src={OPENCODE_LOGO} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain', borderRadius: '4px' }} /> OpenCode Setup
                </h3>
                <p className="muted" style={{ margin: '0 0 16px' }}>Add this to your <span className="mono">opencode.json</span> file in your project or config directory</p>
                <Snippet code={opencodeCfg} label="Copy Config" />
              </div>
            )}
            {(selectedAgent === 'cursor' || selectedAgent === 'claude-desktop' || selectedAgent === 'cline' || selectedAgent === 'roo-code' || selectedAgent === 'windsurf' || selectedAgent === 'hermes' || selectedAgent === 'openclaw') && (
              <div>
                <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px' }}>
                  {(AGENTS.find(a => a.id === selectedAgent) as any)?.useImage ? (
                    <img src={(AGENTS.find(a => a.id === selectedAgent)?.icon) as string} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain', borderRadius: '4px' }} />
                  ) : (
                    <span>{AGENTS.find(a => a.id === selectedAgent)?.icon}</span>
                  )} {AGENTS.find(a => a.id === selectedAgent)?.name} Setup
                </h3>
                <p className="muted" style={{ margin: '0 0 16px' }}>Add to your MCP settings/configuration</p>
                <Snippet code={genericCfg} label="Copy Config" />
                <div style={{ marginTop: '12px', padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '6px' }}>Where to add:</div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', display: 'grid', gap: '3px' }}>
                    <li><strong>Cursor:</strong> Settings → Features → MCP → Add new server</li>
                    <li><strong>Claude Desktop:</strong> Settings → Developer → Edit Config</li>
                    <li><strong>Cline/RooCode:</strong> MCP Servers tab → Remote Servers</li>
                    <li><strong>Windsurf:</strong> Settings → MCP Servers</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '32px', padding: '24px', background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', borderRadius: '12px', border: '1px solid #7dd3fc' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '40px', flex: '0 0 40px' }}>✨</div>
            <div style={{ flex: 1, minWidth: '280px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '22px', color: '#075985', display: 'flex', alignItems: 'center', gap: '10px' }}>
                Magic Master Prompt
                <span style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(14,165,233,0.2)', borderRadius: '999px', color: '#0369a1', fontWeight: '700' }}>WORKS WITH ANY AGENT</span>
              </h3>
              <p style={{ margin: '0 0 16px', color: '#075985', fontSize: '14.5px', lineHeight: '1.6' }}>
                Don't see your agent? Paste this master prompt to <strong>any AI coding agent</strong> and it will automatically detect its environment, configure MCP for SNBD, and connect it for you!
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button 
                  className="btn p" 
                  style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', border: 'none' }}
                  onClick={() => setShowMasterPrompt(!showMasterPrompt)}
                >
                  {showMasterPrompt ? 'Hide Prompt' : 'View & Copy Master Prompt'} {showMasterPrompt ? '▲' : '▼'}
                </button>
                <button className="btn" onClick={copyMasterPrompt}>
                  {promptCopied ? '✓ Copied!' : 'Copy to Clipboard'}
                </button>
              </div>
            </div>
          </div>
          
          {showMasterPrompt && (
            <div style={{ marginTop: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ position: 'relative' }}>
                <pre style={{ 
                  background: '#0f172a', 
                  color: '#e2e8f0', 
                  padding: '20px', 
                  borderRadius: '10px', 
                  overflow: 'auto', 
                  maxHeight: '400px',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  margin: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
{filledMasterPrompt}
                </pre>
                <button 
                  onClick={copyMasterPrompt}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    padding: '8px 14px',
                    background: 'rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  {promptCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(14,165,233,0.1)', borderRadius: '8px', border: '1px solid rgba(14,165,233,0.3)' }}>
                <div style={{ fontWeight: '600', fontSize: '13px', color: '#075985', marginBottom: '4px' }}>📋 How to use:</div>
                <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#075985', display: 'grid', gap: '3px' }}>
                  <li>Copy the entire prompt above</li>
                  <li>Open your AI coding agent (Claude Code, Cursor, Continue, Aider, RooCode, etc.)</li>
                  <li>Paste it as a new message/task</li>
                  <li>Watch it auto-configure and connect to SNBD MCP in seconds!</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card pad-lg" style={{ marginTop: '32px' }} aria-labelledby="connections-h" id="connections">
        <div className="mcp-section-head">
          <div>
            <h2 id="connections-h" className="card-title" style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🔗</span> Active Connections
            </h2>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: '14.5px' }}>Monitor and manage all connected AI assistants</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span className="mcp-chip" style={{ background: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)', color: '#166534', border: '1px solid #86efac' }}>🟢 {connected.length} Live</span>
            <span className="mcp-chip" style={{ background: '#f9fafb', border: '1px solid var(--line)' }}>{connections.length} Total Approved</span>
          </div>
        </div>
        {connections.length === 0 && (
          <div className="mcp-empty" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #f9fafb 100%)', border: '2px dashed #d1d5db' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔌</div>
            <b style={{ fontSize: '16px' }}>No connections yet</b>
            <p className="muted" style={{ maxWidth: '52ch' }}>Connect your AI assistant using the quick connect above. Once connected and approved, you'll see it appear here with full details.</p>
            <button className="btn p" style={{ marginTop: '16px' }} onClick={() => jump('quick-connect')}>Get Started →</button>
          </div>
        )}
        <div className="mcp-conns">
          {connections.map((c) => <ConnectionCard key={c.id} c={c} onDisconnect={disconnect} />)}
        </div>
      </section>

      {fresh && (
        <section className="card pad-lg" style={{ marginTop: '32px', boxShadow: '0 0 0 2px var(--red), 0 8px 32px rgba(213,12,45,0.2)', background: 'linear-gradient(135deg, #fff 0%, #fef2f2 100%)' }} aria-labelledby="new-h">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{ fontSize: '32px' }}>🎉</span>
            <div>
              <h2 id="new-h" className="card-title" style={{ fontSize: '24px' }}>Token Created Successfully</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Name: <strong style={{ color: 'var(--ink)' }}>{fresh.name}</strong></p>
            </div>
          </div>
          <div style={{ padding: '16px', background: '#fef2f2', border: '2px solid #fecaca', borderRadius: '10px', marginBottom: '16px' }}>
            <p style={{ margin: '0 0 12px', fontWeight: '600', color: 'var(--red-dark)' }}>⚠️ Copy this token now - it will only be shown once!</p>
            <div className="codebox mono" style={{ background: '#18181b', padding: '14px', fontSize: '13px', wordBreak: 'break-all' }}>{fresh.token}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}><Copy text={fresh.token} label="Copy Token" /></div>
          </div>
          <h3 style={{ fontSize: '16px', margin: '20px 0 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>⚡ Quick Claude Code Setup</h3>
          <div className="codebox mono" style={{ background: '#18181b', padding: '14px', fontSize: '12.5px' }}>{freshCmd}</div>
          <div style={{ marginTop: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}><Copy text={freshCmd} label="Copy Command" /><button className="btn p" onClick={() => setFresh(null)}>I've Saved It ✓</button></div>
        </section>
      )}

      <details className="card pad-lg mcp-advanced" style={{ marginTop: '32px' }}>
        <summary>
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>🔧</span>
            <span><b style={{ fontSize: '16px' }}>Advanced: Manual Token Management</b> <span className="muted">— For custom clients or fallback auth</span></span>
          </span>
          <span className="mcp-chip">{tokens?.length ?? 0} tokens</span>
        </summary>
        <div className="cols" style={{ marginTop: '24px' }}>
          <section className="grow-lg" aria-labelledby="tok-h">
            <h2 id="tok-h" className="card-title" style={{ fontSize: '18px' }}>Your Tokens</h2>
            {tokens?.length === 0 && <p className="muted" style={{ margin: '12px 0 0' }}>No tokens created yet.</p>}
            {tokens?.map((t) => (
              <div key={t.id} style={{ padding: '16px 0', borderTop: '1px solid var(--line-2)', marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <b style={{ fontSize: '14px' }}>{t.name}</b>
                    <span className={`badge ${t.kind === 'connector' ? 'ok' : 'info'}`}>{t.kind === 'connector' ? '✓ Approved App' : '🔑 Token'}</span>
                    {t.scope === 'deploy' ? (
                      <span className="badge" style={{ background: 'var(--red-tint)', color: 'var(--red-dark)' }}>⚡ Full Access</span>
                    ) : (
                      <span className="badge">👁️ Read-only</span>
                    )}
                  </div>
                  <button className="link-btn danger" onClick={() => revoke(t)} aria-label={`${t.kind === 'connector' ? 'Disconnect' : 'Revoke'} ${t.name}`}>{t.kind === 'connector' ? 'Disconnect' : 'Revoke'}</button>
                </div>
                <div className="muted" style={{ fontSize: '12.5px', marginTop: '6px', lineHeight: '1.5' }}>
                  {t.serverIds ? `🎯 Servers: ${t.serverNames.join(', ') || 'selected servers'}` : '🌐 All your servers'} · Last used {when(t.lastUsedAt)} · {t.expiresAt ? `${t.kind === 'connector' ? '🔄 Needs re-approval' : '⏰ Expires'} ${when(t.expiresAt)}` : '♾️ No expiry'}
                  {t.kind === 'connector' && t.scope === 'read' && <> · Read-only: approve again and tick “Allow changes too” for full access</>}
                </div>
              </div>
            ))}
          </section>

          <section className="side-col" aria-labelledby="new-tok-h" style={{ alignSelf: 'flex-start' }}>
            <h2 id="new-tok-h" className="card-title" style={{ fontSize: '18px' }}>Create a Token</h2>
            <form onSubmit={create} style={{ marginTop: '12px' }}>
              <div className="field"><label htmlFor="tk-name">Token Name</label><input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custom Client" maxLength={60} required /></div>
              <fieldset className="fieldset">
                <legend>Access Level</legend>
                <label className="check"><input type="radio" name="access" checked={access === 'read'} onChange={() => setAccess('read')} />Read-only — status, logs, files</label>
                <label className="check"><input type="radio" name="access" checked={access === 'deploy'} onChange={() => setAccess('deploy')} />Full access — also run commands, write files, restart services</label>
              </fieldset>
              <fieldset className="fieldset" style={{ marginTop: '12px' }}>
                <legend>Server Access Scope</legend>
                <label className="check"><input type="radio" name="scope" checked={!only} onChange={() => setOnly(false)} />All my servers</label>
                <label className="check"><input type="radio" name="scope" checked={only} onChange={() => setOnly(true)} />Only selected servers</label>
                {only && servers.map((s) => (
                  <label className="check" key={s.id} style={{ marginLeft: '24px' }}>
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.name}
                  </label>
                ))}
              </fieldset>
              <div className="field" style={{ marginTop: '12px' }}>
                <label htmlFor="tk-exp">Expiration</label>
                <select id="tk-exp" className="select" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">Never</option>
                </select>
              </div>
              <button className="btn p" style={{ width: '100%', background: 'linear-gradient(135deg, var(--red) 0%, #dc2626 100%)', border: 'none' }} disabled={busy || !name.trim() || (only && picked.length === 0)}>{busy ? 'Creating...' : 'Create Token'}</button>
              <p className="muted" style={{ fontSize: '11.5px', margin: '8px 0 0', lineHeight: '1.4' }}>Read-only tokens can't run commands, write files, or restart services — good for monitoring or lower-trust integrations.</p>
            </form>
          </section>
        </div>
      </details>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
