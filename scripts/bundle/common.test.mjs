import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, readlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pruneRuntimeDependencies, prepareElectronRuntime, copyBundledApplication } from './common.mjs';

test('runtime pruning retains transitive and optional dependencies, excluding renderers and AI runtimes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hatopad-runtime-closure-'));
  const pkg = async (name, metadata = {}) => {
    const target = path.join(directory, 'node_modules', name);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name, ...metadata }));
  };
  try {
    await pkg('ssh2', { dependencies: { shared: '1' }, optionalDependencies: { optional: '1', unavailable: '1' } });
    await pkg('shared', { peerDependencies: { zod: '^4', absentPeer: '*' }, peerDependenciesMeta: { absentPeer: { optional: true } } }); await pkg('zod'); await pkg('optional'); await pkg('monaco-editor');
    await pkg('@openai/codex'); await pkg('@anthropic-ai/claude-agent-sdk');
    await pkg('@agentclientprotocol/codex-acp'); await pkg('@agentclientprotocol/claude-agent-acp');
    await pruneRuntimeDependencies(directory, ['ssh2']);
    for (const name of ['ssh2', 'shared', 'optional', 'zod']) await access(path.join(directory, 'node_modules', name, 'package.json'));
    for (const name of ['monaco-editor', '@openai/codex', '@anthropic-ai/claude-agent-sdk', '@agentclientprotocol/codex-acp', '@agentclientprotocol/claude-agent-acp']) {
      await assert.rejects(access(path.join(directory, 'node_modules', name)));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('runtime pruning refuses incomplete required dependency closures before removing anything', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hatopad-runtime-incomplete-'));
  try {
    await mkdir(path.join(directory, 'node_modules/keep'), { recursive: true });
    await writeFile(path.join(directory, 'node_modules/keep/package.json'), '{"name":"keep"}');
    await assert.rejects(pruneRuntimeDependencies(directory, ['missing']), /Missing runtime dependency: missing/);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'node_modules/keep/package.json'), 'utf8')).name, 'keep');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('embedded app framework links stay relative and survive removal of the original build', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hatopad-embedded-framework-'));
  const source = path.join(directory, 'source');
  const destination = path.join(directory, 'gateway/desktop');
  try {
    await mkdir(path.join(source, 'Framework/Versions/A/Resources'), { recursive: true });
    await writeFile(path.join(source, 'Framework/Versions/A/Resources/icudtl.dat'), 'fixture');
    await symlink('A', path.join(source, 'Framework/Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(source, 'Framework/Resources'));
    await copyBundledApplication(source, destination);
    {
      assert.equal(await readlink(path.join(destination, 'Framework/Resources')), 'Versions/Current/Resources');
      assert.equal(await readlink(path.join(destination, 'Framework/Versions/Current')), 'A');
    }
    await rm(source, { recursive: true });
    assert.equal(await readFile(path.join(destination, 'Framework/Resources/icudtl.dat'), 'utf8'), 'fixture');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('Electron runtime retains built protocol helpers and ACP when copied outside the checkout', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hatopad-electron-runtime-'));
  const staging = path.join(directory, 'staging');
  const source = path.join(directory, 'source');
  const app = path.join(directory, 'app');
  try {
    for (const name of ['ws', 'ssh2']) {
      await mkdir(path.join(staging, 'node_modules', name), { recursive: true });
      await writeFile(path.join(staging, 'node_modules', name, 'package.json'), JSON.stringify({ name }));
    }
    await mkdir(path.join(staging, 'node_modules/@hatopad'), { recursive: true });
    for (const name of ['acp', 'protocol']) {
      await mkdir(path.join(staging, 'packages', name), { recursive: true });
      await writeFile(path.join(staging, 'packages', name, 'package.json'), JSON.stringify({ name: `@hatopad/${name}`, type: 'module', main: 'dist/index.js', ...(name === 'protocol' ? { dependencies: { '@hatopad/acp': '0.1.0' } } : {}) }));
      await symlink(`../../packages/${name}`, path.join(staging, 'node_modules/@hatopad', name), 'junction');
      await mkdir(path.join(source, 'packages', name, 'dist'), { recursive: true });
      await writeFile(path.join(source, 'packages', name, 'dist/index.js'), name === 'protocol' ? 'export { ready } from "@hatopad/acp";' : 'export const ready = true;');
    }
    await prepareElectronRuntime(staging, source);
    const { cp } = await import('node:fs/promises');
    await cp(path.join(staging, 'node_modules'), path.join(app, 'node_modules'), { recursive: true, dereference: true });
    await rm(staging, { recursive: true, force: true });
    execFileSync(process.execPath, ['--input-type=module', '-e', 'import { ready } from "@hatopad/protocol"; if (!ready) process.exit(1);'], { cwd: app });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
