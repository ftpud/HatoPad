// Cross-package integration: npm run build, then node --test scripts/cloud-port-tunnel.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as tcpServer, connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as coreServer, shutdownCore } from '../packages/core/dist/server.js';
import { CloudPortTunnel } from '../packages/gateway/dist-electron/cloud-port-tunnel.js';

test('real Gateway/Core port forwarding preserves binary streams and half-close across a relay bridge', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hatopad-ports-'));
  const previous = process.env.HATOPAD_STATE_DIR; process.env.HATOPAD_STATE_DIR = join(directory, 'state');
  execFileSync('git', ['init', '-q', directory]);
  const token = 'test-local-core-token'.padEnd(64, 'x');
  const core = await coreServer('127.0.0.1', 0, directory, { access: { token } });
  const corePort = core.address().port;
  const serviceSockets = new Set();
  const service = tcpServer({ allowHalfOpen: true }, socket => {
    serviceSockets.add(socket); socket.once('close', () => serviceSockets.delete(socket));
    socket.on('data', bytes => socket.write(bytes)); socket.once('end', () => socket.end('after-fin'));
  });
  service.listen(0, '127.0.0.1'); await once(service, 'listening');
  const hub = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(hub, 'listening');
  const upstreams = new Set();
  hub.on('connection', (browser, request) => {
    assert.equal(request.headers.cookie, 'test-session');
    assert.equal(request.url, '/relay/browser?coreId=core');
    const upstream = new WebSocket(`ws://127.0.0.1:${corePort}`); upstreams.add(upstream);
    const queue = [];
    const send = raw => { const frame = JSON.parse(String(raw)); if (frame.type === 'protocol.maintenance') frame.payload.token = token; upstream.send(JSON.stringify(frame)); };
    browser.on('message', raw => { if (upstream.readyState === WebSocket.OPEN) send(raw); else queue.push(raw); });
    upstream.once('open', () => { for (const raw of queue) send(raw); queue.length = 0; });
    upstream.on('message', raw => { if (browser.readyState === WebSocket.OPEN) browser.send(String(raw)); });
    upstream.on('error', () => browser.terminate());
    upstream.once('close', () => { upstreams.delete(upstream); browser.terminate(); });
    browser.once('close', () => upstream.terminate());
  });
  const allocate = tcpServer(); allocate.listen(0, '127.0.0.1'); await once(allocate, 'listening'); const localPort = allocate.address().port; await new Promise(resolve => allocate.close(resolve));
  const statuses = [];
  const tunnel = new CloudPortTunnel({ target: { origin: `http://127.0.0.1:${hub.address().port}`, coreId: 'core', cookie: async () => 'test-session' }, compatibility: { minimum: 19, maximum: 19 }, localPort, remotePort: service.address().port, onStatus: status => statuses.push(status) });
  try {
    await tunnel.start();
    const exchange = async seed => {
      const socket = connect({ port: localPort, host: '127.0.0.1', allowHalfOpen: true }); const chunks = [];
      socket.on('data', bytes => chunks.push(bytes));
      await once(socket, 'connect');
      const data = Buffer.alloc(64 * 1024); for (let i = 0; i < data.length; i++) data[i] = (i + seed) % 256;
      socket.end(data); await once(socket, 'end'); socket.destroy();
      assert.deepEqual(Buffer.concat(chunks), Buffer.concat([data, Buffer.from('after-fin')]));
    };
    await Promise.all([exchange(0), exchange(17)]);
    assert.deepEqual(statuses, ['running']);
    for (const socket of hub.clients) socket.terminate();
    for (let i = 0; i < 100 && !statuses.includes('error'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(statuses.includes('error'), 'relay loss closes the local forwarding listener');
  } finally {
    tunnel.stop(); for (const socket of hub.clients) socket.terminate(); for (const socket of upstreams) socket.terminate();
    await new Promise(resolve => hub.close(resolve));
    for (const socket of serviceSockets) socket.destroy(); await new Promise(resolve => service.close(resolve));
    await shutdownCore(core);
    if (previous === undefined) delete process.env.HATOPAD_STATE_DIR; else process.env.HATOPAD_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
