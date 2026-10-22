import { useEffect, useRef, useState } from 'react';
import { api, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';

type Provider = 'claude' | 'chatgpt';

interface Msg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
}

// ── MCP helper ──────────────────────────────────────────────────────────────
async function mcpCall(token: string, method: string, params?: object) {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? 'MCP error');
  return data.result;
}

// ── Tool execution via MCP ───────────────────────────────────────────────────
async function callTool(token: string, name: string, args: object): Promise<string> {
  const result = await mcpCall(token, 'tools/call', { name, arguments: args });
  if (result?.isError) return `[Error] ${result.content?.[0]?.text ?? 'Unknown error'}`;
  return result?.content?.[0]?.text ?? '(no output)';
}

// ── Claude agentic loop ──────────────────────────────────────────────────────
async function runClaude(
  apiKey: string,
  sessionToken: string,
  tools: any[],
  history: any[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onToolCall: (name: string, input: object, result: string) => void,
): Promise<string> {
  let messages = [...history];
  for (let i = 0; i < 10; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-allow-browser': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, system: systemPrompt, tools, messages }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message ?? `Claude API error ${res.status}`);
    }
    const data = await res.json();
    const content: any[] = data.content ?? [];

    // Collect text and tool_use blocks
    const textBlocks = content.filter((b) => b.type === 'text');
    const toolBlocks = content.filter((b) => b.type === 'tool_use');

    const text = textBlocks.map((b) => b.text).join('');
    if (text) onChunk(text);

    if (data.stop_reason !== 'tool_use' || toolBlocks.length === 0) return text;

    // Execute tool calls
    messages.push({ role: 'assistant', content });
    const toolResults: any[] = [];
    for (const tb of toolBlocks) {
      const result = await callTool(sessionToken, tb.name, tb.input);
      onToolCall(tb.name, tb.input, result);
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return '';
}

// ── ChatGPT agentic loop ─────────────────────────────────────────────────────
async function runChatGPT(
  apiKey: string,
  sessionToken: string,
  tools: any[],
  history: any[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onToolCall: (name: string, input: object, result: string) => void,
): Promise<string> {
  const oaiTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  let messages: any[] = [{ role: 'system', content: systemPrompt }, ...history];
  for (let i = 0; i < 10; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 4096, tools: oaiTools, messages }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message ?? `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Empty response from OpenAI');

    messages.push(msg);

    const text = msg.content ?? '';
    if (text) onChunk(text);

    if (choice.finish_reason !== 'tool_calls' || !msg.tool_calls?.length) return text;

    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments ?? '{}');
      const result = await callTool(sessionToken, tc.function.name, args);
      onToolCall(tc.function.name, args, result);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  return '';
}

// ── Provider logo components ─────────────────────────────────────────────────
function ClaudeLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChatGPTLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.28 9.78a5.998 5.998 0 00-.52-4.93 6.14 6.14 0 00-6.6-2.94A6.003 6.003 0 009.82 0a6.14 6.14 0 00-5.86 4.26 6.002 6.002 0 00-4 2.91 6.14 6.14 0 00.76 7.19 5.998 5.998 0 00.52 4.93 6.14 6.14 0 006.6 2.94A6.003 6.003 0 0014.18 24a6.14 6.14 0 005.86-4.26 6.002 6.002 0 004-2.91 6.14 6.14 0 00-.76-7.05zM14.18 22.5a4.64 4.64 0 01-2.98-1.08l.15-.08 4.95-2.86a.82.82 0 00.41-.71v-6.99l2.09 1.21a.07.07 0 01.04.06v5.78a4.66 4.66 0 01-4.66 4.67zm-9.97-4.28a4.64 4.64 0 01-.56-3.13l.15.09 4.95 2.86a.82.82 0 00.82 0l6.04-3.49v2.42a.08.08 0 01-.03.06L10.6 20.1a4.66 4.66 0 01-6.39-1.88zm-1.28-10.8a4.63 4.63 0 012.42-2.04v5.89a.82.82 0 00.41.71l6.04 3.49-2.09 1.21a.08.08 0 01-.07 0L5.3 13.6a4.66 4.66 0 01-.37-6.18zm17.16 4.01L14.05 8l2.09-1.21a.08.08 0 01.07 0l4.35 2.51a4.65 4.65 0 01-.72 8.4v-5.9a.82.82 0 00-.41-.67zm2.08-3.16l-.15-.09-4.95-2.86a.82.82 0 00-.82 0L10.2 9.81V7.39a.08.08 0 01.03-.06l4.35-2.51a4.65 4.65 0 016.39 1.88 4.6 4.6 0 01.2 2.07zM9.1 13.01l-2.09-1.21a.07.07 0 01-.04-.06V6.16a4.65 4.65 0 017.64-3.57l-.15.08-4.95 2.86a.82.82 0 00-.41.71v6.77zm1.13-2.44l2.69-1.55 2.69 1.55v3.1l-2.69 1.55-2.69-1.55v-3.1z"/>
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function AiPage({ serverId }: { serverId: string }) {
  const [server, setServer] = useState<Server | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [provider, setProvider] = useState<Provider>(() => (localStorage.getItem('snbd_ai_provider') as Provider) ?? 'claude');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(`snbd_ai_key_${localStorage.getItem('snbd_ai_provider') ?? 'claude'}`) ?? '');
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [initError, setInitError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load server info and create session token
  useEffect(() => {
    api.server(serverId).then(setServer).catch(() => {});
    api.aiSession(serverId)
      .then(async ({ token }) => {
        setSessionToken(token);
        const result = await mcpCall(token, 'tools/list').catch(() => null);
        if (result?.tools) setTools(result.tools);
      })
      .catch((e) => setInitError(e.message));
  }, [serverId]);

  // Scroll to bottom when messages change
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function switchProvider(p: Provider) {
    setProvider(p);
    localStorage.setItem('snbd_ai_provider', p);
    const saved = localStorage.getItem(`snbd_ai_key_${p}`) ?? '';
    setApiKey(saved);
    setEditingKey(false);
  }

  function saveKey() {
    const trimmed = keyDraft.trim();
    setApiKey(trimmed);
    localStorage.setItem(`snbd_ai_key_${provider}`, trimmed);
    setEditingKey(false);
  }

  function addMsg(msg: Msg) {
    setMessages((prev) => [...prev, msg]);
  }

  const systemPrompt = `You are an AI assistant connected to the SNBD server management panel.
You are managing the server "${server?.name ?? serverId}" (ID: ${serverId}, IP: ${server?.ip ?? 'unknown'}).
You have tools to inspect and manage this server. Always pass server="${serverId}" as the server argument to every tool.
Be concise and helpful. Before running destructive commands (delete, rm -rf, format), confirm with the user.
After running commands, verify they succeeded by checking the output or reading back the state.`;

  async function send() {
    if (!input.trim() || busy || !sessionToken || !apiKey) return;
    const userText = input.trim();
    setInput('');
    setBusy(true);
    addMsg({ role: 'user', content: userText });

    // Build conversation history in provider format
    const history = messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.content };
      if (m.role === 'assistant') return { role: 'assistant', content: m.content };
      return null;
    }).filter(Boolean) as any[];
    history.push({ role: 'user', content: userText });

    let assistantText = '';
    const onChunk = (text: string) => {
      assistantText = text;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && !last.toolName) {
          return [...prev.slice(0, -1), { role: 'assistant', content: text }];
        }
        return [...prev, { role: 'assistant', content: text }];
      });
    };
    const onToolCall = (name: string, input: object, result: string) => {
      setMessages((prev) => [
        ...prev,
        { role: 'tool', content: result, toolName: name, toolInput: JSON.stringify(input, null, 2) },
      ]);
    };

    try {
      if (provider === 'claude') {
        await runClaude(apiKey, sessionToken, tools, history.slice(0, -1), systemPrompt, onChunk, onToolCall);
      } else {
        await runChatGPT(apiKey, sessionToken, tools, history.slice(0, -1), systemPrompt, onChunk, onToolCall);
      }
      if (!assistantText) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') return prev;
          return [...prev, { role: 'assistant', content: '(Done)' }];
        });
      }
    } catch (e) {
      addMsg({ role: 'assistant', content: `Error: ${(e as Error).message}`, isError: true });
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const hasKey = !!apiKey;

  return (
    <>
      <ServerHeader server={server} tab="ai" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', gap: 0 }}>
        {/* Provider + key bar */}
        <div className="card pad-lg" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn${provider === 'claude' ? ' p' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => switchProvider('claude')}
              >
                <ClaudeLogo /> Claude
              </button>
              <button
                className={`btn${provider === 'chatgpt' ? ' p' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => switchProvider('chatgpt')}
              >
                <ChatGPTLogo /> ChatGPT
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingKey ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    className="input"
                    placeholder={provider === 'claude' ? 'sk-ant-…' : 'sk-…'}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button className="btn p" onClick={saveKey}>Save</button>
                  <button className="btn" onClick={() => setEditingKey(false)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {hasKey
                    ? <span className="muted" style={{ fontSize: 13 }}>API key saved in browser · <button className="link-btn" onClick={() => { setKeyDraft(apiKey); setEditingKey(true); }}>Change</button></span>
                    : <button className="btn" onClick={() => { setKeyDraft(''); setEditingKey(true); }}>Add {provider === 'claude' ? 'Anthropic' : 'OpenAI'} API key</button>
                  }
                </div>
              )}
            </div>
            {messages.length > 0 && (
              <button className="link-btn" onClick={() => setMessages([])}>Clear chat</button>
            )}
          </div>
          {initError && <p className="error" style={{ margin: '8px 0 0' }}>Session error: {initError}</p>}
          {!initError && sessionToken && tools.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {tools.length} tools available · key stored in your browser only · session expires in 24 h
            </div>
          )}
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
          {messages.length === 0 && !busy && (
            <div className="card pad-lg" style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                {hasKey ? `Ask anything about ${server?.name ?? 'this server'}` : 'Add your API key to start'}
              </div>
              <div style={{ fontSize: 13 }}>
                {hasKey
                  ? 'Check logs, run commands, manage files, restart services — the AI has full deploy access.'
                  : `Enter your ${provider === 'claude' ? 'Anthropic' : 'OpenAI'} API key above. It stays in your browser and is never sent to this panel.`}
              </div>
              {hasKey && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                  {['Check CPU and memory usage', 'Show recent system logs', 'List files in /etc/nginx', 'Restart nginx'].map((s) => (
                    <button key={s} className="btn" style={{ fontSize: 13 }} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'tool' && (
                <details style={{ width: '100%', maxWidth: 680 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none', padding: '4px 0' }}>
                    ⚙ {m.toolName}({m.toolInput ? JSON.parse(m.toolInput ?? '{}') && m.toolName : ''})
                  </summary>
                  <pre className="codebox" style={{ margin: '4px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>{m.content}</pre>
                </details>
              )}
              {m.role !== 'tool' && (
                <div style={{
                  maxWidth: '80%',
                  padding: '10px 14px',
                  borderRadius: 12,
                  fontSize: 14,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: m.role === 'user' ? 'var(--red)' : 'var(--card)',
                  color: m.role === 'user' ? '#fff' : m.isError ? 'var(--red-dark)' : 'var(--ink)',
                  border: m.role === 'assistant' ? '1px solid var(--line)' : 'none',
                }}>
                  {m.content}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
              <span className="spinner" aria-hidden="true" />Thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="card pad-lg" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              placeholder={hasKey ? `Message ${provider === 'claude' ? 'Claude' : 'ChatGPT'}… (Enter to send, Shift+Enter for newline)` : 'Add an API key above to start chatting'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!hasKey || busy || !sessionToken}
              style={{ flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 14 }}
            />
            <button
              className="btn p"
              onClick={send}
              disabled={!input.trim() || busy || !hasKey || !sessionToken}
              style={{ alignSelf: 'flex-end' }}
            >
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
