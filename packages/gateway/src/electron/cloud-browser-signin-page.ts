import { createHash } from "node:crypto";

export type BrowserSignInPageState = "success" | "cancelled" | "rejected" | "failed";
const content = {
  success: { title: "Signed in", message: "Your HatoHub account is now connected to Gateway on this device.", note: "You can close this tab and return to Gateway.", status: "Connected to HatoHub" },
  cancelled: { title: "Sign-in cancelled", message: "Your HatoHub account has not been connected to Gateway.", note: "Return to Gateway whenever you're ready to sign in.", status: "Connection cancelled" },
  rejected: { title: "Sign-in not accepted", message: "This sign-in response was not accepted.", note: "Return to Gateway and start sign-in again.", status: "Connection not confirmed" },
  failed: { title: "Couldn't finish sign-in", message: "Gateway could not confirm your HatoHub connection.", note: "Return to Gateway and start sign-in again.", status: "Connection not confirmed" },
} as const;

// Standalone browser document: no renderer runtime, network assets or scripts.
// Colors follow Gateway's public renderer/design-tokens.css.
const style = `
:root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.5;
  --panel: #fff; --border: #e0e6f1; --heading: #142039; --text: #52627e; --muted: #5b6985;
  --accent: #5268e8; --soft: #edf1ff; --success: #298566; --success-soft: #eaf7f0;
  --background: radial-gradient(ellipse at 30% 0%, #dce6ff9c, transparent 65%), linear-gradient(130deg, #edf1fc, #eff5fc 65%, #e8edfc);
  --shadow: 0 16px 48px #243a6721, 0 2px 8px #243a670f; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark;
  --panel: #1c2334; --border: #303b54; --heading: #f0f4ff; --text: #bbc6dc; --muted: #93a1bc;
  --accent: #8299ff; --soft: #263653; --success: #78c9a6; --success-soft: #203c36;
  --background: radial-gradient(ellipse at 40% 0%, #35446b55, transparent 65%), #141927;
  --shadow: 0 16px 48px #050b2440, 0 2px 8px #050b2426; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; background: var(--background) fixed; color: var(--text); }
main { min-height: 100dvh; display: grid; place-items: center;
  padding: max(32px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(32px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
.panel { width: min(440px, 100%); min-width: 0; padding: clamp(24px, 6vw, 36px); text-align: center;
  background: var(--panel); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); overflow-wrap: anywhere; }
.mark { width: 72px; height: 72px; margin: 0 auto 24px; display: grid; place-items: center; border-radius: 50%; color: var(--accent); background: var(--soft); }
.success .mark { color: var(--success); background: var(--success-soft); }
.mark svg { width: 36px; height: 36px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.eyebrow { display: block; color: var(--muted); font-size: .7rem; font-weight: 600; letter-spacing: .12em; margin-bottom: 8px; }
h1 { margin: 0 0 12px; font-size: clamp(1.5rem, 5vw, 1.9rem); line-height: 1.15; font-weight: 650; letter-spacing: -.04em; color: var(--heading); }
p { margin: 0 0 24px; }
.status { display: inline-flex; gap: 8px; align-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: .85rem; color: var(--heading); }
.status::before { content: ''; width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--accent); }
.success .status::before { background: var(--success); }
.note { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }
`;
export const browserSignInPagePolicy = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

export function browserSignInPage(state: BrowserSignInPageState): string {
  const copy = content[state];
  const glyph = state === "success" ? '<path d="m5 12 4 4L19 6"/>' : state === "cancelled" ? '<path d="m6 6 12 12M18 6 6 18"/>' : '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="10"/>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${copy.title} · HatoPad Gateway</title><style>${style}</style></head>
<body><main><section class="panel ${state}" aria-labelledby="signin-title">
<div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24">${glyph}</svg></div>
<span class="eyebrow">HATOPAD GATEWAY</span><h1 id="signin-title">${copy.title}</h1>
<p>${copy.message}</p><span class="status">${copy.status}</span><p class="note">${copy.note}</p>
</section></main></body></html>`;
}
