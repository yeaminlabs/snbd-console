// PM2 process file for CloudPanel (or any host without systemd access).
//   cd <repo> && pm2 start deploy/ecosystem.config.cjs && pm2 save
// Environment comes from $SNBD_ENV_FILE (default ~/snbd.env), so no secrets live in this file.
const path = require('node:path');
const os = require('node:os');

const envFile = process.env.SNBD_ENV_FILE || path.join(os.homedir(), 'snbd.env');

module.exports = {
  apps: [
    {
      name: 'snbd',
      cwd: path.join(__dirname, '..', 'apps', 'api'),
      script: 'npx',
      args: `tsx --env-file=${envFile} src/server.ts`,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 8000,
    },
  ],
};
