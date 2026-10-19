import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { GitService } from './git.js';
const exec = promisify(execFile);
it('pages content-free git summaries and marks binary/untracked counts unavailable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloud-git-summary-'));
  const git = (...args: string[]) => exec('git', ['-C', directory, ...args]);
  try {
    await git('init'); await git('config', 'user.email', 'test@example.invalid'); await git('config', 'user.name', 'Test');
    await writeFile(path.join(directory, 'tracked.txt'), 'before\n');
    await writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 1]));
    await git('add', '.'); await git('commit', '-m', 'Base');
    await writeFile(path.join(directory, 'tracked.txt'), 'PRIVATE FILE BODY\nsecond line\n');
    await writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(directory, 'untracked.txt'), 'PRIVATE UNTRACKED BODY');
    const service = new GitService(directory); const summary = await service.summary(1);
    expect(summary).toMatchObject({ clean: false, totalFiles: 3, additions: 2, deletions: 1, unknownCounts: 2, nextOffset: 1 });
    expect(summary.entries).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    const rest = await service.summary(500);
    expect(rest.entries.find(entry => entry.path === 'binary.bin')!.additions).toBeNull();
    expect(rest.entries.find(entry => entry.path === 'untracked.txt')).toMatchObject({ group: 'untracked', additions: null });
    expect(rest.entries.find(entry => entry.path === 'tracked.txt')).toMatchObject({ group: 'working-tree', additions: 2, deletions: 1 });
    await expect(service.summary(501)).rejects.toThrow('page');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
