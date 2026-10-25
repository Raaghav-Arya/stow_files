import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root } from './pi-runtime.mjs';
const tmp=mkdtempSync(join(tmpdir(),'pi-ask-user-types-'));
try {
 const config={compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',strict:true,noEmit:true,skipLibCheck:true,allowImportingTsExtensions:true,types:['node'],typeRoots:[join(root,'node_modules/@types')],baseUrl:root,paths:{'@earendil-works/pi-coding-agent':['dist/index.d.ts'],'@earendil-works/pi-tui':['node_modules/@earendil-works/pi-tui/dist/index.d.ts'],'typebox':['node_modules/typebox/build/index.d.mts']}},files:[fileURLToPath(new URL('../.pi/agent/extensions/ask-user/index.ts',import.meta.url))]};
 const path=join(tmp,'tsconfig.json'); writeFileSync(path,JSON.stringify(config));
 const r=spawnSync('tsc',['-p',path],{stdio:'inherit'}); if(r.error)throw r.error;process.exitCode=r.status??1;
} finally {rmSync(tmp,{recursive:true,force:true});}
