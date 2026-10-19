import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { CloudPortTunnel } from './cloud-port-tunnel.js';

async function port(): Promise<number> { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return value; }
async function fixture(capability = true) {
  const hub = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(hub, 'listening');
  const sockets = new Set<WebSocket>(); let authorized = false; let opens = 0;
  hub.on('connection', (ws, request) => {
    authorized = request.headers.cookie === 'session=test' && request.url === '/relay/browser?coreId=core';
    sockets.add(ws); ws.once('close', () => sockets.delete(ws));
    const streams = new Map<string, { chunks: string[]; eof: boolean; waiting?: () => void }>();
    ws.on('message', async raw => {
      const request = JSON.parse(String(raw)); let result: unknown = {};
      if (request.type === 'protocol.maintenance') result = { maintenance: true, compatible: true, capabilities: capability ? ['ports.tunnel'] : [] };
      if (request.type === 'portTunnel.open') { const streamId = (++opens).toString(16).padStart(36, '0'); streams.set(streamId, { chunks: [], eof: false }); result = { streamId }; }
      const stream = streams.get(request.payload.streamId);
      if (request.type === 'portTunnel.write') { assert.ok(stream); assert.ok(Buffer.from(request.payload.data, 'base64').length <= 32768); stream.chunks.push(request.payload.data); stream.waiting?.(); }
      if (request.type === 'portTunnel.end') { assert.ok(stream); stream.chunks.push(Buffer.from('after-fin').toString('base64')); stream.eof = true; stream.waiting?.(); }
      if (request.type === 'portTunnel.read') {
        assert.ok(stream);
        if (!stream.chunks.length && !stream.eof) await new Promise<void>(resolve => { const finish = () => { clearTimeout(timer); stream.waiting = undefined; resolve(); }; const timer = setTimeout(finish, 1000); stream.waiting = finish; });
        result = { data: stream.chunks.shift() ?? '', eof: stream.eof && !stream.chunks.length };
      }
      if (ws.readyState === 1) ws.send(JSON.stringify({ id: request.id, ok: true, result }));
    });
  });
  const localPort = await port();
  const statuses: string[] = [];
  const tunnel = new CloudPortTunnel({ target: { origin: `http://127.0.0.1:${(hub.address() as { port: number }).port}`, coreId: 'core', cookie: async () => 'session=test' }, compatibility: { minimum: 19, maximum: 19 }, localPort, remotePort: 3000, onStatus: status => statuses.push(status) });
  return { tunnel, localPort, statuses, authorized: () => authorized, revoke: () => { for (const socket of sockets) socket.terminate(); }, close: async () => { tunnel.stop(); for (const socket of sockets) socket.terminate(); await new Promise<void>(resolve => hub.close(() => resolve())); } };
}
test('cloud tunnel authenticates, carries bounded binary TCP data and preserves half-close replies', async () => {
  const f = await fixture();
  try {
    await f.tunnel.start(); assert.equal(f.authorized(), true);
    const client = connect({ host: '127.0.0.1', port: f.localPort, allowHalfOpen: true });
    const received: Buffer[] = []; client.on('data', bytes => received.push(bytes));
    client.on('error', () => undefined); await once(client, 'connect');
    const content = Buffer.alloc(256 * 1024); for (let i = 0; i < content.length; i++) content[i] = i % 256;
    client.end(content);
    await once(client, 'end'); client.destroy();
    assert.deepEqual(Buffer.concat(received), Buffer.concat([content, Buffer.from('after-fin')]));
    assert.deepEqual(f.statuses, ['running']);
  } finally { await f.close(); }
});
test('unsupported Core refuses a listener; revocation closes active listeners and connections', async () => {
  const old = await fixture(false);
  try { await assert.rejects(old.tunnel.start(), /Update Core and Gateway/); } finally { await old.close(); }
  const f = await fixture();
  try {
    await f.tunnel.start(); const client = connect(f.localPort, '127.0.0.1'); client.on('error', () => undefined); await once(client, 'connect');
    const closed = once(client, 'close'); f.revoke(); await closed;
    assert.ok(f.statuses.includes('error'));
    const denied = connect(f.localPort, '127.0.0.1'); await once(denied, 'error'); denied.destroy();
  } finally { await f.close(); }
});
