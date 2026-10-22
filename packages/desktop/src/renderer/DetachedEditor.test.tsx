import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value: string; onChange(value: string): void }) => (
    <textarea aria-label="code" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

type Handler = (type: string, payload: Record<string, unknown>) => unknown;
const fake = vi.hoisted(() => ({ instances: [] as unknown[], handler: undefined as unknown }));

vi.mock("./client", () => ({
  CoreClient: class {
    onDisconnected?: (message: string) => void;
    root?: string;
    connected = false;
    connects = 0;
    requests: Array<[string, Record<string, unknown>]> = [];
    constructor() {
      fake.instances.push(this);
    }
    setRoot(root: string) {
      this.root = root;
    }
    getRoot() {
      return this.root;
    }
    async connect() {
      this.connects += 1;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
    async request(type: string, payload: Record<string, unknown>) {
      if (!this.connected) throw new Error("Not connected");
      this.requests.push([type, payload]);
      return (fake.handler as Handler)(type, payload);
    }
  },
}));

import { DetachedEditor } from "./DetachedEditor";

type FakeClient = {
  onDisconnected?: (message: string) => void;
  connects: number;
  connected: boolean;
  requests: Array<[string, Record<string, unknown>]>;
};

let disk = { content: "one\n", revision: { mtimeMs: 1, size: 4 } };
const writes: string[] = [];
beforeEach(() => {
  disk = { content: "one\n", revision: { mtimeMs: 1, size: 4 } };
  writes.length = 0;
  fake.instances.length = 0;
  fake.handler = (type: string, payload: Record<string, unknown>) => {
    if (type === "workspace.open") return { workspace: "/root" };
    if (type === "workspace.roots") return { selectedRootId: "root-2", roots: [] };
    if (type === "tasks.list") return { tasks: [{ id: "task-1" }], selectedTaskId: "task-1" };
    if (type === "tasks.switch") return { workspace: "/task-1" };
    if (type === "filesystem.readFile") return { path: "a.ts", ...disk };
    if (type === "filesystem.writeFile") {
      writes.push(String(payload.content));
      return { path: "a.ts", bytesWritten: 1, revision: { mtimeMs: 9, size: 9 } };
    }
  };
  window.history.pushState({}, "", "/?detached=1&host=h&port=1&type=file&path=a.ts&rootId=root-2&taskId=task-1");
});
afterEach(cleanup);

it("binds the client to the originating root and task", async () => {
  render(<DetachedEditor />);
  await screen.findByLabelText("code");
  const client = fake.instances[0] as FakeClient & { root?: string };
  expect(client.root).toBe("root-2");
  expect(client.requests.map(([type]) => type)).toEqual(
    expect.arrayContaining(["workspace.open", "tasks.switch", "filesystem.readFile"]),
  );
  expect(client.requests.find(([type]) => type === "tasks.switch")?.[1]).toMatchObject({ taskId: "task-1" });
});

it("reconnects after connection loss, keeps the dirty buffer and resumes saving", async () => {
  render(<DetachedEditor />);
  const box = (await screen.findByLabelText("code")) as HTMLTextAreaElement;
  const client = fake.instances[0] as FakeClient;
  client.connected = false;
  client.onDisconnected?.("Connection closed");
  fireEvent.change(box, { target: { value: "two\n" } });
  expect(await screen.findByText(/Reconnecting/)).toBeTruthy();
  await waitFor(() => expect(client.connects).toBeGreaterThan(1), { timeout: 3000 });
  await waitFor(() => expect(screen.queryByText(/Reconnecting/)).toBeNull(), { timeout: 3000 });
  expect(box.value).toBe("two\n");
  await waitFor(() => expect(writes).toEqual(["two\n"]), { timeout: 3000 });
});

it("keeps unsaved text when the file changed on disk while disconnected", async () => {
  render(<DetachedEditor />);
  const box = (await screen.findByLabelText("code")) as HTMLTextAreaElement;
  const client = fake.instances[0] as FakeClient;
  client.connected = false;
  client.onDisconnected?.("Connection closed");
  fireEvent.change(box, { target: { value: "mine\n" } });
  disk = { content: "theirs\n", revision: { mtimeMs: 5, size: 7 } };
  expect(await screen.findByText(/changed outside the editor/, undefined, { timeout: 3000 })).toBeTruthy();
  expect(box.value).toBe("mine\n");
});

it("stops recovery when unmounted", async () => {
  const view = render(<DetachedEditor />);
  await screen.findByLabelText("code");
  const client = fake.instances[0] as FakeClient;
  client.connected = false;
  client.onDisconnected?.("Connection closed");
  view.unmount();
  const before = client.connects;
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(client.connects).toBe(before);
});
