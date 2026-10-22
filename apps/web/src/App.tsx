import { useEffect, useState } from 'react';
import { api, type Me } from './api';
import { Login } from './pages/Login';
import { Servers } from './pages/Servers';
import { Overview } from './pages/Overview';
import { Reinstall } from './pages/Reinstall';
import { Files } from './pages/Files';
import { Apps } from './pages/Apps';
import { Activity } from './pages/Activity';
import { Agents } from './pages/Agents';
import { Authorize } from './pages/Authorize';
import { Shell } from './components/Shell';
import { TerminalPage } from './pages/TerminalPage';

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const hash = useHash();
  const [route, query = ''] = hash.split('?');

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return null;
  if (!me) return <Login onSignedIn={setMe} />;

  if (route === '/authorize') return <Authorize id={new URLSearchParams(query).get('req') ?? ''} />;
  if (route === '/agents') return <Shell me={me} onSignedOut={() => setMe(null)} active="agents"><Agents /></Shell>;
  if (route === '/activity') return <Shell me={me} onSignedOut={() => setMe(null)} active="activity"><Activity /></Shell>;
  const match = route.match(/^\/servers\/([0-9a-f-]{36})(\/terminal|\/reinstall|\/files|\/apps)?$/);
  return (
    <Shell me={me} onSignedOut={() => setMe(null)}>
      {match ? (match[2] === '/terminal' ? <TerminalPage serverId={match[1]} /> : match[2] === '/reinstall' ? <Reinstall serverId={match[1]} /> : match[2] === '/files' ? <Files serverId={match[1]} path={new URLSearchParams(query).get('p') || '/'} /> : match[2] === '/apps' ? <Apps serverId={match[1]} /> : <Overview serverId={match[1]} />) : <Servers />}
    </Shell>
  );
}
