// Uses existing tsc and installed Pi declarations; installs nothing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './pi-runtime.mjs';
const directory = mkdtempSync(join(tmpdir(), 'pi-plan-types-'));
const config = join(directory, 'tsconfig.json');
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true,
    noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
    types: ['node'], typeRoots: [join(root, 'node_modules/@types')], baseUrl: root,
    paths: {
      '@earendil-works/pi-coding-agent': ['dist/index.d.ts'],
      typebox: ['node_modules/typebox/build/index.d.mts'],
    },
  },
  include: [resolve('.pi/agent/extensions/plan-mode/*.ts')],
}));
const result = spawnSync('tsc', ['-p', config], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
console.log(`Temporary typecheck config: ${config}`);
