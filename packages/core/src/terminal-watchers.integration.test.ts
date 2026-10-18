import { once } from 'node:events';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, shutdownCore } from './server.js';
import { protocolCompatibility } from '@hatopad/protocol';

it('delivers live PTY output to independent read-only watchers and removes subscriptions on selection changes', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'terminal-watch-live-')));
  vi.stubEnv('HATOPAD_STATE_DIR', path.join(directory, 'state'));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  const sockets: WebSocket[] = [];
  try {
    await promisify(execFile)('git', ['init', directory]);
    server = await createServer('127.0.0.1', 0, directory);
    const port = (server.address() as { port: number }).port;
    const connect = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(socket); await once(socket, 'open');
      let rootId: string | undefined, sequence = 0;
      const events: any[] = []; socket.on('message', raw => { const frame = JSON.parse(raw.toString()); if (!frame.id) events.push(frame); });
      const request = (type: string, payload: unknown) => new Promise<any>((resolve, reject) => {
        const id = String(++sequence);
        const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error(`Timeout: ${type}`)); }, 5000);
        function receive(raw: WebSocket.RawData) { const frame = JSON.parse(raw.toString()); if (frame.id !== id) return; clearTimeout(timeout); socket.off('message', receive); resolve(frame); }
        socket.on('message', receive); socket.send(JSON.stringify({ id, type, payload, ...(rootId ? { rootId } : {}) }));
      });
      await request('protocol.handshake', { compatibility: protocolCompatibility });
      rootId = (await request('workspace.roots', {})).result.selectedRootId;
      return { socket, request, events };
    };
    const owner = await connect(), watcher = await connect(), peer = await connect();
    const terminalId = (await owner.request('terminal.create', { cols: 80, rows: 24 })).result.terminalId;
    const attached = await watcher.request('terminal.watch.attach', { terminalId, follow: true, maxBytes: 4096 });
    expect(attached).toMatchObject({ ok: true, result: { state: 'available', watchId: expect.any(String) } });
    const watchId = attached.result.watchId;
    expect(await peer.request('terminal.watch.ack', { watchId, sequence: 0 })).toMatchObject({ ok: false, error: { code: 'FILE_NOT_FOUND' } });
    expect(await watcher.request('terminal.watch.ack', { watchId, sequence: 999 })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await watcher.request('terminal.watch.ack', { watchId, sequence: 0 });
    await owner.request('terminal.input', { terminalId, data: "printf '%s%s\\n' WATCH_ LIVE\r" });
    await vi.waitFor(() => expect(watcher.events.filter(event => event.type === 'terminal.watch.output').map(event => event.payload.data).join('')).toContain('WATCH_LIVE'));
    expect(peer.events.some(event => event.type === 'terminal.watch.output')).toBe(false);
    expect(owner.events.some(event => event.type === 'terminal.output')).toBe(true);
    await watcher.request('tasks.switch', { includeTree: false });
    expect(await watcher.request('terminal.watch.ack', { watchId, sequence: 0 })).toMatchObject({ ok: false, error: { code: 'FILE_NOT_FOUND' } });
    const watchCount = watcher.events.filter(event => event.type === 'terminal.watch.output').length;
    await owner.request('terminal.input', { terminalId, data: "printf '%s%s\\n' AFTER_ SWITCH\r" });
    await vi.waitFor(() => expect(owner.events.filter(event => event.type === 'terminal.output').map(event => event.payload.data).join('')).toContain('AFTER_SWITCH'));
    expect(watcher.events.filter(event => event.type === 'terminal.watch.output')).toHaveLength(watchCount);
    expect(await watcher.request('terminal.watch.attach', { terminalId: 'missing', follow: true })).toMatchObject({ ok: true, result: { state: 'stale' } });
    await owner.request('terminal.close', { terminalId });
  } finally {
    for (const socket of sockets) socket.close();
    if (server) await shutdownCore(server);
    vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
  }
}, 15000);
