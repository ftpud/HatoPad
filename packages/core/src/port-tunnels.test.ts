import { afterEach, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { PortTunnels } from "./port-tunnels.js";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function service(handler: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return (server.address() as { port: number }).port;
}
function tunnels() {
  const value = new PortTunnels(7331);
  cleanup.push(() => value.close());
  return value;
}
it("validates ports, forbids hosts/self-dialing, scopes stream IDs and bounds data", async () => {
  const a = tunnels(),
    b = tunnels();
  for (const payload of [
    { port: 0 },
    { port: 65536 },
    { port: 2.5 },
    { port: "80" },
    { port: 7331 },
    { port: 80, host: "169.254.169.254" },
  ])
    await expect(a.handle("portTunnel.open", payload)).rejects.toThrow();
  const port = await service((socket) => socket.pipe(socket));
  const opened = (await a.handle("portTunnel.open", { port })) as { streamId: string };
  await expect(b.handle("portTunnel.write", { ...opened, data: "eA==" })).rejects.toThrow("closed");
  for (const data of ["!", "a===", "", Buffer.alloc(32769).toString("base64")])
    await expect(a.handle("portTunnel.write", { ...opened, data })).rejects.toThrow();
  const bytes = Buffer.from([0, 255, 128, 10, 13]);
  await a.handle("portTunnel.write", { ...opened, data: bytes.toString("base64") });
  const reply = (await a.handle("portTunnel.read", opened)) as { data: string };
  expect(Buffer.from(reply.data, "base64")).toEqual(bytes);
  await a.handle("portTunnel.close", opened);
});
it("preserves half-close responses, releases streams and cancels pending reads on disconnect", async () => {
  const port = await service((socket) => {
    socket.on("data", () => undefined);
    socket.once("end", () => socket.end("response after FIN"));
  });
  const owner = tunnels();
  const opened = (await owner.handle("portTunnel.open", { port })) as { streamId: string };
  await owner.handle("portTunnel.write", { ...opened, data: "eA==" });
  await owner.handle("portTunnel.end", opened);
  let content = "";
  for (let i = 0; i < 5; i++) {
    const read = (await owner.handle("portTunnel.read", opened)) as { data: string; eof: boolean };
    content += Buffer.from(read.data, "base64").toString();
    if (read.eof) break;
  }
  expect(content).toBe("response after FIN");
  await owner.handle("portTunnel.close", opened);
  const idlePort = await service(() => undefined);
  const idle = (await owner.handle("portTunnel.open", { port: idlePort })) as { streamId: string };
  const pending = owner.handle("portTunnel.read", idle);
  owner.close();
  await expect(pending).resolves.toMatchObject({ eof: true });
  await expect(owner.handle("portTunnel.open", { port })).rejects.toThrow("closed");
});
it("bounds streams per authenticated connection and across Core", async () => {
  const port = await service(() => undefined);
  const budget = { active: 127 };
  const a = new PortTunnels(7331, budget);
  cleanup.push(() => a.close());
  const opened = (await a.handle("portTunnel.open", { port })) as { streamId: string };
  await expect(a.handle("portTunnel.open", { port })).rejects.toThrow("limit");
  await a.handle("portTunnel.close", opened);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(budget.active).toBe(127);
});
