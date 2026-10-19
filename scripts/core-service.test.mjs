import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

for (const fail of [false,true]) test(`Git launcher ${fail ? 'preserves the previous release after a build failure' : 'builds and runs the pinned compatible release'}`, async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'core-launcher-test-'));
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    const origin=path.join(root,'origin'), local=path.join(root,'local');
    git(root,'init','-b','main',origin);git(origin,'config','user.email','fixture@example.com');git(origin,'config','user.name','Fixture');
    for (const dir of ['scripts','packages/core/dist','packages/protocol/dist']) await mkdir(path.join(origin,dir),{recursive:true});
    await writeFile(path.join(origin,'packages/core/dist/server.js'),'export const ready=true;');
    await writeFile(path.join(origin,'package.json'),'{"type":"module"}');
    await writeFile(path.join(origin,'scripts/core-service.mjs'),await readFile(new URL('./core-service.mjs',import.meta.url)));
    await cp(new URL('../packages/protocol/dist/',import.meta.url),path.join(origin,'packages/protocol/dist'),{recursive:true});
    await writeFile(path.join(origin,'packages/core/dist/index.js'),`if(process.env.HATOPAD_CORE_UPDATE_FAILED==='1'){ console.log('PREVIOUS_RESTARTED');process.exit(0); } process.send({type:'hatopad-core-update',branch:'main',expectedCurrent:process.env.HATOPAD_CORE_RUNNING_COMMIT,expectedLatest:process.env.FIXTURE_LATEST},()=>process.exit(75));`);
    git(origin,'add','.');git(origin,'commit','-m','initial');const first=git(origin,'rev-parse','HEAD');git(root,'clone',origin,local);
    await writeFile(path.join(origin,'packages/core/dist/index.js'),"console.log('UPDATED_CORE');");git(origin,'commit','-am','update');git(origin,'tag','core-protocol-19-v0.1.2');const latest=git(origin,'rev-parse','HEAD');
    const npm=path.join(root,'npm.mjs');await writeFile(npm,`process.exit(${fail?23:0});`);
    const result=spawnSync(process.execPath,['scripts/core-service.mjs'],{cwd:local,encoding:'utf8',timeout:20000,env:{...process.env,npm_execpath:npm,FIXTURE_LATEST:latest}});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,fail?/PREVIOUS_RESTARTED/:/UPDATED_CORE/);
    assert.equal(git(local,'rev-parse','HEAD'),fail?first:latest);assert.equal(git(local,'status','--porcelain'),'');
    assert.equal(git(local,'worktree','list','--porcelain').split('\n').filter(line=>line.startsWith('worktree ')).length,1);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('source archives without Git still start Core with updates unavailable',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'core-archive-test-'));
  try {
    for(const directory of ['scripts','packages/core/dist','packages/protocol/dist']) await mkdir(path.join(root,directory),{recursive:true});
    await writeFile(path.join(root,'package.json'),'{"type":"module"}');
    await cp(new URL('../packages/protocol/dist/',import.meta.url),path.join(root,'packages/protocol/dist'),{recursive:true});
    await cp(new URL('./core-service.mjs',import.meta.url),path.join(root,'scripts/core-service.mjs'));
    await writeFile(path.join(root,'packages/core/dist/index.js'),"console.log(process.env.HATOPAD_CORE_UPDATE_MANAGED === '0' ? 'UNMANAGED_CORE' : 'INCORRECT');");
    const result=spawnSync(process.execPath,['scripts/core-service.mjs'],{cwd:root,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/UNMANAGED_CORE/);
  } finally {await rm(root,{recursive:true,force:true});}
});
