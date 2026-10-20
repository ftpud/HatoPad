export type PortTunnelOperations = {
  "portTunnel.open": { payload: { port: number }; result: { streamId: string } };
  "portTunnel.read": { payload: { streamId: string }; result: { data: string; eof: boolean } };
  "portTunnel.write": { payload: { streamId: string; data: string }; result: Record<string, never> };
  "portTunnel.end": { payload: { streamId: string }; result: Record<string, never> };
  "portTunnel.close": { payload: { streamId: string }; result: Record<string, never> };
};
