import { afterEach, expect, it, vi } from 'vitest';
import { CoreClient } from './index';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  static capabilities?: string[];
  get capabilities() { return Socket.capabilities; }
  sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  constructor(readonly url: string) { Socket.instances.push(this); }
  send(text: string) {
    const request = JSON.parse(text);
    this.sent.push(request);
    const result = request.type === 'protocol.handshake' ? { compatible: true, ...(this.capabilities ? { capabilities: this.capabilities } : {}) } : request.type === 'workspace.roots' ? { roots: [{ id: 'root' }, { id: 'saved' }], selectedRootId: 'root' } : request.type === 'workspace.selectRoot' ? { tree: [] } : { roots: [{ id: 'root' }], selectedRootId: 'root' };
    this.onmessage?.({ data: JSON.stringify({ id: request.id, ok: true, result }) });
  }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
afterEach(() => { vi.unstubAllGlobals(); Socket.instances = []; Socket.capabilities = undefined; });
it('connects using injected URL and credentials without Electron globals', async () => {
  vi.stubGlobal('WebSocket', Socket);
  const client = new CoreClient();
  const getToken = vi.fn(async () => 'private-local-credential');
  try {
    const connecting = client.connect({ url: 'wss://core.example/socket', getToken });
    const socket = Socket.instances[0]!; socket.open(); await connecting;
    expect(socket.url).toBe('wss://core.example/socket');
    expect(getToken).toHaveBeenCalledOnce();
    expect(socket.sent[0]!.payload.token).toBe('private-local-credential');
    expect(client.getRoot()).toBe('root');
    expect(client.supports('overview.summary')).toBe(false);
  } finally { client.disconnect(); }
});
it('rejects obsolete asynchronous credentials after disconnect', async () => {
  vi.stubGlobal('WebSocket', Socket);
  const client = new CoreClient();
  let release!: (token: string) => void;
  const token = new Promise<string>(resolve => { release = resolve; });
  const connecting = client.connect({ url: 'wss://core.example/socket', getToken: () => token });
  const rejected = expect(connecting).rejects.toThrow('Connection replaced or closed');
  const socket = Socket.instances[0]!; socket.open(); client.disconnect(); release('secret');
  await rejected; await Promise.resolve();
  expect(socket.sent).toEqual([]);
});
it('fails lean root restore on Cores without the capability instead of fetching the full tree', async () => {
  vi.stubGlobal('WebSocket', Socket);
  const client = new CoreClient();
  client.setRoot('saved');
  const connecting = client.connect({ url: 'wss://core.example/socket', leanWorkspace: true });
  const socket = Socket.instances[0]!; socket.open();
  await expect(connecting).rejects.toThrow('too old for lean workspace restore');
  expect(socket.sent.map(request => request.type)).not.toContain('workspace.selectRoot');
});
it('restores a saved root without the tree when the Core advertises the capability', async () => {
  vi.stubGlobal('WebSocket', Socket);
  Socket.capabilities = ['workspace.selectRoot.includeTree'];
  const client = new CoreClient();
  client.setRoot('saved');
  const connecting = client.connect({ url: 'wss://core.example/socket', leanWorkspace: true });
  const socket = Socket.instances[0]!; socket.open(); await connecting;
  expect(client.supports('workspace.selectRoot.includeTree')).toBe(true);
  expect(socket.sent.find(request => request.type === 'workspace.selectRoot')!.payload).toMatchObject({ rootId: 'saved', includeTree: false });
  client.disconnect();
});

it('keeps all overview reads unscoped even when another root is selected', async () => {
  vi.stubGlobal('WebSocket', Socket); const client = new CoreClient();
  const connecting = client.connect({ url: 'wss://core.example/socket' }); const socket = Socket.instances[0]!; socket.open(); await connecting;
  try {
    client.setRoot('other'); await client.request('overview.work', { limit: 1 }); await client.request('overview.events', { limit: 1 });
    for (const request of socket.sent.filter(request => ['overview.work', 'overview.events'].includes(request.type))) expect(request).not.toHaveProperty('rootId');
    expect(client.getRoot()).toBe('other');
  } finally { client.disconnect(); }
});
