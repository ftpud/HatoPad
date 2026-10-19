import type { BrowserWindow, WebAuthnAccount } from "electron";

/** OAuth providers may open HTTPS child windows or start from a blank popup. */
export function isCloudSignInUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}

export function configureCloudSignInWindow(window: BrowserWindow): void {
  const children = new Set<BrowserWindow>();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isCloudSignInUrl(url)) return { action: "deny" };
    return { action: "allow", overrideBrowserWindowOptions: {
      parent: window, width: 560, height: 760, title: "HatoPad Cloud sign-in",
      webPreferences: { session: window.webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
    } };
  });
  window.webContents.on("will-navigate", (event, url) => { if (!isCloudSignInUrl(url)) event.preventDefault(); });
  window.webContents.on("will-redirect", (event, url) => { if (!isCloudSignInUrl(url)) event.preventDefault(); });
  window.webContents.on("did-create-window", (child) => {
    children.add(child);
    configureCloudSignInWindow(child);
    child.once("closed", () => children.delete(child));
  });
  window.once("closed", () => { for (const child of children) if (!child.isDestroyed()) child.destroy(); children.clear(); });
}

/** Electron requires an explicit account choice and exactly one callback invocation. */
export async function selectCloudPasskey(accounts: WebAuthnAccount[], choose: (labels: string[]) => Promise<number>, callback: (credentialId?: string) => void): Promise<void> {
  let selected: string | undefined;
  try {
    if (accounts.length) {
      const index = await choose(accounts.map((account, index) => account.displayName && account.name ? `${account.displayName} (${account.name})` : account.name || account.displayName || `Account ${index + 1}`));
      selected = accounts[index]?.credentialId;
    }
  } finally { callback(selected); }
}
