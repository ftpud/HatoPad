import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { CoreClient } from "./client";
import { ConnectionRecovery, reconnectWorkspace, type RecoverySelection } from "./connection-recovery";
import { configureMonacoThemes, monacoTheme } from "./theme";
import type { FileRevision } from "@hatopad/protocol";

const languages: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  html: "html",
  css: "css",
  md: "markdown",
  java: "java",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  cds: "sap-cds",
  http: "http",
  txt: "plaintext",
};

export function DetachedEditor() {
  const options = useRef(new URLSearchParams(window.location.search)).current;
  const path = options.get("path") ?? "";
  const type = options.get("type");
  const scope = options.get("scope") as "global" | "local" | null;
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [revision, setRevision] = useState<FileRevision>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const clientRef = useRef<CoreClient>();
  const dirty = content !== saved;
  useEffect(() => {
    document.title = path.split("/").pop() ?? path;
  }, [path]);
  useEffect(() => {
    window.desktop?.setDirtyState(dirty);
  }, [dirty]);
  const contentRef = useRef("");
  const savedRef = useRef("");
  const revisionRef = useRef<FileRevision>();
  contentRef.current = content;
  savedRef.current = saved;
  revisionRef.current = revision;
  useEffect(() => {
    if (!path || (type !== "file" && type !== "useful")) {
      setError("Invalid detached editor request");
      return;
    }
    const client = new CoreClient();
    clientRef.current = client;
    let current = true;
    const host = options.get("host") ?? "127.0.0.1";
    const port = Number(options.get("port") ?? "7331");
    const rootId = options.get("rootId");
    // Bind the request root to the originating tab's root; the client selects it on every (re)connect.
    if (rootId) client.setRoot(rootId);
    let selection: RecoverySelection | undefined;
    const readCurrent = async () =>
      type === "useful"
        ? { ...(await client.request("useful.read", { scope: scope!, name: path })), revision: undefined }
        : client.request("filesystem.readFile", { path });
    const recovery = new ConnectionRecovery(
      async (signal) => {
        if (!selection) throw new Error("Detached editor is not initialised");
        await reconnectWorkspace(client, host, port, false, signal, selection);
        const latest = await readCurrent();
        if (!current || signal.aborted) return;
        const unchanged =
          JSON.stringify(latest.revision) === JSON.stringify(revisionRef.current) &&
          latest.content === savedRef.current;
        if (!unchanged) {
          if (contentRef.current === savedRef.current) {
            setContent(latest.content);
            setSaved(latest.content);
            setRevision(latest.revision);
          } else {
            // Never replace unsaved text; saving stays blocked by the revision check until the user resolves it.
            setError("The file changed outside the editor while disconnected. Your unsaved text was kept.");
          }
        }
        setOffline(false);
      },
      () => undefined,
    );
    client.onDisconnected = () => {
      if (!current) return;
      setOffline(true);
      recovery.start();
    };
    void client
      .connect(host, port)
      .then(async () => {
        await client.request("workspace.open", {});
        const taskId = options.get("taskId") ?? (await client.request("tasks.list", {})).selectedTaskId;
        const target = await client.request("tasks.switch", { ...(taskId ? { taskId } : {}), includeTree: false });
        selection = {
          rootId: client.getRoot() ?? "",
          workspace: target.workspace,
          ...(taskId ? { taskId } : {}),
        };
        const result = await readCurrent();
        if (!current) return;
        setContent(result.content);
        setSaved(result.content);
        setRevision(result.revision);
        setReady(true);
      })
      .catch((loadError: unknown) => {
        if (current) setError(loadError instanceof Error ? loadError.message : "Could not open editor");
      });
    return () => {
      current = false;
      recovery.stop();
      client.onDisconnected = undefined;
      client.disconnect();
    };
  }, [options, path, scope, type]);
  useEffect(() => {
    if (!ready || offline || !dirty || !clientRef.current) return;
    const value = content;
    const timer = setTimeout(() => {
      if (type === "useful") {
        void clientRef
          .current!.request("useful.write", { scope: scope!, name: path, content: value })
          .then(() => setSaved((current) => (current === content ? current : value)))
          .catch((saveError: unknown) => setError(saveError instanceof Error ? saveError.message : "Autosave failed"));
      } else {
        void clientRef
          .current!.request("filesystem.writeFile", { path, content: value, expectedRevision: revision })
          .then((result) => {
            setRevision(result.revision);
            setSaved((current) => (current === content ? current : value));
          })
          .catch((saveError: unknown) => setError(saveError instanceof Error ? saveError.message : "Autosave failed"));
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [content, dirty, offline, path, ready, revision, scope, type]);
  if (error && !ready) return <main className="detached-error">{error}</main>;
  return (
    <main className="detached-editor">
      {offline && <div className="inline-error">Connection lost. Reconnecting; unsaved changes are kept…</div>}
      {error && <div className="inline-error">{error}</div>}
      {ready ? (
        <Editor
          path={`detached/${type}/${scope ?? "workspace"}/${path}`}
          language={languages[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext"}
          value={content}
          beforeMount={configureMonacoThemes}
          theme={monacoTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light")}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontFamily: "JetBrains Mono",
            fontWeight: "normal",
            fontSize: 13,
            scrollBeyondLastLine: false,
            padding: { top: 10 },
          }}
          onChange={(value) => {
            setContent(value ?? "");
            setError("");
          }}
        />
      ) : (
        <div className="empty-editor">Opening {path}...</div>
      )}
    </main>
  );
}
