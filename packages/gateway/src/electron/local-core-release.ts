import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compatibleCoreTags, protocolCompatibility } from './protocol-versions.js';
import { normalizeRepositorySettings, type RepositorySettings } from './repository-settings.js';
const exec = promisify(execFile);
/** The cache is installation state under Gateway userData, never a workspace directory. */
export class LocalCoreReleases {
  constructor(private readonly cache: string) {}
  private async git(cwd: string, ...args: string[]) { try {return (await exec('git', args, {cwd,timeout:60_000,maxBuffer:128_000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();} catch {throw Error('Unable to read Core release metadata. Check Git access.');} }
  private async source(settings: RepositorySettings) {
    const {repository,branch}=normalizeRepositorySettings(settings);
    const directory=path.join(this.cache,'sources',createHash('sha256').update(repository+'\0'+branch).digest('hex'));
    await mkdir(directory,{recursive:true,mode:0o700}); await this.git(directory,'init');
    await this.git(directory,'fetch','--tags',repository,`${branch}:refs/remotes/origin/${branch}`);
    const tag=compatibleCoreTags((await this.git(directory,'tag','--merged',`refs/remotes/origin/${branch}`,'--list','core-protocol-*-v*')).split('\n'),protocolCompatibility)[0];
    if(!tag) throw Error('No protocol-compatible tagged Core is available on the selected branch.');
    return {directory,tag,branch,commit:await this.git(directory,'rev-parse',`refs/tags/${tag}^{commit}`)};
  }
  async check(settings: RepositorySettings) { const {directory:_,...release}=await this.source(settings);return release; }
  async installed(commit: string, node: string, env: NodeJS.ProcessEnv): Promise<string> {
    if(!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid Core revision');
    const abi=(await exec(node,['-p','process.versions.modules'],{env})).stdout.trim();
    if(!/^\d+$/.test(abi)) throw Error('Invalid Node runtime');
    const release=path.join(this.cache,`${commit}-node${abi}`);
    if(await readFile(path.join(release,'.complete'),'utf8')!==commit) throw Error('Saved compatible Core is missing. Check updates before restarting.');
    return release;
  }
  async prepare(settings: RepositorySettings, expectedCommit: string, toolchain: {node:string;npm:string;env:NodeJS.ProcessEnv}): Promise<string> {
    if(!/^[a-f0-9]{40}$/.test(expectedCommit)) throw Error('Invalid Core revision');
    const selected=await this.source(settings); if(selected.commit!==expectedCommit) throw Error('Core release changed. Refresh before updating.');
    const abi=(await exec(toolchain.node,['-p','process.versions.modules'],{env:toolchain.env})).stdout.trim();
    if(!/^\d+$/.test(abi)) throw Error('Invalid Node runtime');
    const release=path.join(this.cache,`${expectedCommit}-node${abi}`);
    try {if(await readFile(path.join(release,'.complete'),'utf8')===expectedCommit) return release;} catch {}
    const staging=release+'.staging-'+randomUUID();
    const run=async(args:string[])=>{await exec(toolchain.node,[toolchain.npm,...args],{cwd:staging,env:toolchain.env,timeout:600_000,maxBuffer:4_000_000});};
    try {
      await this.git(this.cache,'clone','--no-checkout',selected.directory,staging);
      await this.git(staging,'checkout','--detach',expectedCommit);
      await run(['ci','--no-audit','--no-fund']);
      for(const name of ['acp','protocol','client','relay','connector','test-fixtures','core','desktop']) await run(['run','build','-w',`@hatopad/${name}`]);
      await exec(toolchain.node,['--input-type=module','-e',`const p=await import('./packages/protocol/dist/index.js'); const wire=p.serverProtocolVersion; const range=p.protocolCompatibility; if(wire ? wire<${protocolCompatibility.minimum}||wire>${protocolCompatibility.maximum} : !range||range.minimum>${protocolCompatibility.maximum}||range.maximum<${protocolCompatibility.minimum}) throw Error('Incompatible built Core'); await import('./packages/core/dist/server.js');`],{cwd:staging,env:toolchain.env,timeout:30_000});
      await writeFile(path.join(staging,'.complete'),expectedCommit); await rename(staging,release);return release;
    } catch {throw Error('Compatible Core could not be built. The previous Core remains installed.');} finally {await rm(staging,{recursive:true,force:true});}
  }
}
