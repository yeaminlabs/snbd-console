// Ed25519 release signing for the agent.
//   node scripts/release.mjs keygen          create the private key (once)
//   node scripts/release.mjs sign <dir>      sign <dir>/SHA256SUMS, write SHA256SUMS.sig and release.pub
// Private key: $SNBD_RELEASE_KEY or ~/.snbd/release-ed25519.pem (mode 0600). Never commit it.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const keyPath = process.env.SNBD_RELEASE_KEY ?? join(homedir(), '.snbd', 'release-ed25519.pem');
const [cmd, dir] = process.argv.slice(2);

if (cmd === 'keygen') {
  if (existsSync(keyPath)) throw new Error(`${keyPath} already exists; refusing to overwrite`);
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  console.log('created', keyPath);
} else if (cmd === 'sign' && dir) {
  if (!existsSync(keyPath)) throw new Error(`no release key at ${keyPath}; run: node scripts/release.mjs keygen`);
  const priv = createPrivateKey(readFileSync(keyPath));
  const sums = readFileSync(join(dir, 'SHA256SUMS'));
  writeFileSync(join(dir, 'SHA256SUMS.sig'), sign(null, sums, priv));
  writeFileSync(join(dir, 'release.pub'), createPublicKey(priv).export({ type: 'spki', format: 'pem' }));
  console.log('signed SHA256SUMS');
} else {
  console.error('usage: release.mjs keygen | sign <dir>');
  process.exit(2);
}
