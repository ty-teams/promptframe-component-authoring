import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reviewClip} from '../dist/review-clip.js';

test('a short local composition render uses the exact inclusive Remotion interval and its own props',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pf-review-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const pkg=join(dir,'node_modules/@remotion/cli');mkdirSync(pkg,{recursive:true});
  writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'@remotion/cli',bin:{remotion:'render.cjs'}}));
  writeFileSync(join(pkg,'render.cjs'),"require('node:fs').writeFileSync(process.argv[5],JSON.stringify(process.argv.slice(2)))");
  const output=join(dir,'clip.mp4'),entry=join(dir,'entry.tsx'),props=join(dir,'scene props.json');
  const args=['--entry',entry,'--composition','Scene','--props',props,'--from-frame','12','--frames','3','--output',output];
  const cli=fileURLToPath(new URL('../dist/index.js',import.meta.url));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[cli,'review-clip',...args],{encoding:'utf8'})),{output,fromFrame:12,endFrameExclusive:15,frames:3});
  const call=JSON.parse(readFileSync(output,'utf8'));assert.ok(call.includes('--frames=12-14'));assert.ok(call.includes('--props='+props));
  assert.throws(()=>reviewClip(args),/already exists/);
  assert.throws(()=>reviewClip([...args,'--video',entry]),/Select/);
  assert.equal(readdirSync(dir).some(name=>name.startsWith('.promptframe-review-')),false);
});
