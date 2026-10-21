// Confirms the OS catalog and a server type exist in your Hetzner project.
//   HETZNER_API_TOKEN=... node scripts/hetzner-check.mjs [server_type ...]
const token = process.env.HETZNER_API_TOKEN;
if (!token) { console.error('set HETZNER_API_TOKEN'); process.exit(2); }
const base = process.env.HETZNER_API_URL ?? 'https://api.hetzner.cloud/v1';
const get = async (p) => { const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };

const catalog = ['ubuntu-24.04', 'ubuntu-22.04', 'debian-12', 'alma-9', 'rocky-9', 'fedora-41']; // keep in sync with apps/api/src/os.ts
const images = (await get('/images?type=system&per_page=50')).images;
const have = new Set(images.map((i) => i.name));
for (const c of catalog) console.log(have.has(c) ? 'ok     ' : 'MISSING', 'image', c);
const types = (await get('/server_types?per_page=50')).server_types.filter((t) => !t.deprecated);
console.log('\nserver types:', types.map((t) => `${t.name} (${t.cores}c/${t.memory}G/${t.disk}G ${t.architecture})`).join(', '));
for (const t of process.argv.slice(2)) console.log(types.some((x) => x.name === t) ? 'ok     ' : 'MISSING', 'server type', t);
