import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, type Server } from '../api';
import { ServerHeader } from '../components/ServerHeader';

const closeReasons: Record<number, string> = {
  4403: 'You do not have access to this server.',
  4404: 'The server agent is offline.',
  1001: 'The agent disconnected.',
  1000: 'Session ended.',
};

export function TerminalPage({ serverId }: { serverId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [server, setServer] = useState<Server | null>(null);
  const [ended, setEnded] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api.server(serverId).then(setServer).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    if (!host.current) return;
    setEnded('');
    let disposed = false; // StrictMode mounts twice; ignore events from the discarded socket
    const term = new Terminal({ cursorBlink: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, theme: { background: '#18181b' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal/${serverId}`);
    ws.binaryType = 'arraybuffer';
    const sendSize = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    ws.onopen = sendSize; // the first resize message is what opens the shell
    ws.onmessage = (e) => term.write(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = (e) => !disposed && setEnded(closeReasons[e.code] ?? 'Connection closed.');
    const input = term.onData((data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'in', data })));
    const onResize = () => { fit.fit(); sendSize(); };
    addEventListener('resize', onResize);
    term.focus();

    return () => {
      disposed = true;
      removeEventListener('resize', onResize);
      input.dispose();
      ws.close();
      term.dispose();
    };
  }, [serverId, attempt]);

  return (
    <>
      <ServerHeader server={server} tab="terminal" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', flexWrap: 'wrap', minHeight: 40 }}>
        {ended && <><span className="badge off">{ended}</span><button className="btn" onClick={() => setAttempt((n) => n + 1)}>Reconnect</button></>}
      </div>
      <div className="term-wrap"><div ref={host} style={{ height: '100%' }} /></div>
    </>
  );
}
