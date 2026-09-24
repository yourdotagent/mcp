import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  'src/server.js',
  'src/wallet-store.js',
  'src/solana-tools.js',
  'src/pump-tools.js',
  'src/stonkfun-tools.js',
  ...readdirSync('ops/pump').filter((file) => file.endsWith('.cjs')).map((file) => join('ops/pump', file)),
  ...readdirSync('ops/pump/lib').filter((file) => file.endsWith('.cjs')).map((file) => join('ops/pump/lib', file)),
  ...readdirSync('ops/stonkfun').filter((file) => file.endsWith('.cjs')).map((file) => join('ops/stonkfun', file)),
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of files) run(process.execPath, ['--check', file]);
run(process.execPath, ['test/offline.test.mjs']);
