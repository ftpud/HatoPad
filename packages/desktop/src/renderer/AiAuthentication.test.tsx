import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AiAuthentication as Authentication } from "@hatopad/protocol";
import type { CoreClient } from "./client";
import { AiAuthentication, AuthenticationTerminal, AuthenticationClientContext } from "./AiAuthentication";

const terminals = vi.hoisted(() => [] as Array<{
  key?: (event: KeyboardEvent) => boolean;
  data?: (value: string) => void;
  paste: ReturnType<typeof vi.fn>;
}>);
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 90; rows = 18; key?: (event: KeyboardEvent) => boolean; data?: (value: string) => void;
  constructor() { terminals.push(this); }
  loadAddon() {} open() {} focus() {} write() {} reset() {} dispose() {}
  attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) { this.key = callback; }
  onData(callback: (value: string) => void) { this.data = callback; return { dispose() {} }; }
  paste = vi.fn((value: string) => this.data?.(value));
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
function terminalFixture() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const input = vi.fn();
  const view = render(<AuthenticationTerminal output="Paste a code:" onInput={input} onResize={vi.fn()} />);
  return { input, view, terminal: terminals.at(-1)! };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("discovers advertised methods, opens a login link only on click, and confirms the active request", async () => {
  let authentication: Authentication = { status: "required", methods: [{ id: "browser", name: "Use browser", type: "agent" }] };
  const request = vi.fn(async (operation: string, payload: Record<string, unknown>) => {
    if (operation === "ai.auth.start") authentication = { ...authentication, status: "authenticating", requestId: "login-1", url: "https://example.com/login", awaitingConfirmation: true };
    if (operation === "ai.auth.input") authentication = { status: payload.action === "accept" ? "authenticated" : "required", methods: [] };
    return { authentication };
  });
  const openExternal = vi.fn(async () => {});
  vi.stubGlobal("desktop", { openExternal });
  const client = { getRoot: () => "workspace", request } as unknown as CoreClient;
  render(<AuthenticationClientContext.Provider value={client}><AiAuthentication provider="fixture" /></AuthenticationClientContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "Use browser" }));
  const link = await screen.findByRole("button", { name: "https://example.com/login" });
  expect(openExternal).not.toHaveBeenCalled();
  fireEvent.click(link);
  expect(openExternal).toHaveBeenCalledWith("https://example.com/login");
  fireEvent.click(screen.getByRole("button", { name: "Continue after signing in" }));
  await screen.findByText("Signed in");
  expect(request).toHaveBeenCalledWith("ai.auth.input", { provider: "fixture", requestId: "login-1", action: "accept" });
});
it("shows discovery failures and supports cancelling a pending sign-in", async () => {
  const request = vi.fn(async (operation: string, payload: Record<string, unknown>) => {
    if (payload.discover) throw new Error("Agent unavailable");
    return { authentication: operation === "ai.auth.input" ? { status: "required", methods: [] } : { status: "authenticating", methods: [], requestId: "pending" } };
  });
  const client = { getRoot: () => "workspace", request } as unknown as CoreClient;
  render(<AuthenticationClientContext.Provider value={client}><AiAuthentication provider="fixture" /></AuthenticationClientContext.Provider>);
  await screen.findByText("Signing in…");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("ai.auth.input", { provider: "fixture", requestId: "pending", action: "cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Agent unavailable");
});

it('submits a pasted sign-in response once, adds Enter, and clears the secret field', () => {
  const { input } = terminalFixture();
  const field = screen.getByLabelText('Sign-in code or response') as HTMLInputElement;
  expect(field.type).toBe('password'); expect(field.autocomplete).toBe('off');
  fireEvent.change(field, { target: { value: 'fixture-oauth-response' } });
  expect(input).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  expect(input).toHaveBeenCalledExactlyOnceWith('fixture-oauth-response\r');
  expect(field.value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  expect(input).toHaveBeenCalledTimes(1);
});
it('routes a submitted response to the active provider and sign-in request', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let authentication: Authentication = { status: 'authenticating', methods: [], requestId: 'current-login', terminal: true };
  const request = vi.fn(async (_operation: string, payload: Record<string, unknown>) => {
    if (payload.data) authentication = { status: 'authenticated', methods: [] };
    return { authentication };
  });
  const client = { getRoot: () => 'workspace', request } as unknown as CoreClient;
  render(<AuthenticationClientContext.Provider value={client}><AiAuthentication provider="fixture" /></AuthenticationClientContext.Provider>);
  await screen.findByText('Signing in…');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.change(await screen.findByLabelText('Sign-in code or response'), { target: { value: 'fixture-response' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  await screen.findByText('Signed in');
  expect(request).toHaveBeenCalledWith('ai.auth.input', { provider: 'fixture', requestId: 'current-login', data: 'fixture-response\r' });
  expect(screen.queryByLabelText('Sign-in code or response')).toBeNull();
});
it('handles terminal paste without a duplicate send or accidental trailing Enter', () => {
  const { input, terminal } = terminalFixture();
  fireEvent.paste(screen.getByRole('group', { name: 'Interactive provider sign-in terminal' }), { clipboardData: { getData: () => 'fixture-code\r\n' } });
  expect(terminal.paste).toHaveBeenCalledExactlyOnceWith('fixture-code');
  expect(input).toHaveBeenCalledExactlyOnceWith('fixture-code');
});
it('supports keyboard and button paste, reports clipboard denial, and ignores late reads after unmount', async () => {
  const readClipboard = vi.fn(async () => 'fixture-code\n');
  vi.stubGlobal('desktop', { readClipboard });
  const { input, terminal, view } = terminalFixture();
  const event = new KeyboardEvent('keydown', { key: 'v', metaKey: true, cancelable: true });
  expect(terminal.key?.(event)).toBe(false); expect(event.defaultPrevented).toBe(true);
  await waitFor(() => expect(input).toHaveBeenCalledWith('fixture-code'));
  fireEvent.click(screen.getByRole('button', { name: 'Paste into terminal' }));
  await waitFor(() => expect(input).toHaveBeenCalledTimes(2));
  readClipboard.mockRejectedValueOnce(new Error('denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Paste into terminal' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Paste into the sign-in code field');
  let finish!: (value: string) => void;
  readClipboard.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Paste into terminal' }));
  view.unmount(); finish('late-sensitive-response');
  await Promise.resolve();
  expect(input).toHaveBeenCalledTimes(2);
});
