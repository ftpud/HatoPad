import { useWorkflowTranscript, workflowWriterColor } from "../workflow-transcript";
import { WorkflowError } from "../WorkflowError";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Bot, MessageSquare, X } from "lucide-react";
import type { HarnessBlock, HarnessAppState, HarnessRun, HarnessLogEntry } from "@hatopad/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function WorkflowMeetingTranscript({
  block,
  run,
  state,
  onClose,
}: {
  block: HarnessBlock;
  run?: HarnessRun;
  state?: HarnessRun["blocks"][number];
  onClose(): void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const messages = state?.meeting?.messages ?? [];
  const { onScroll } = useWorkflowTranscript(
    transcript,
    `${run?.id ?? "draft"}:${block.id}`,
    `${messages.length}:${messages.at(-1)?.sequence ?? ""}:${messages.at(-1)?.text ?? ""}`,
  );
  return (
    <section className="harness-run-details workflow-chatbox" aria-label={`${block.label} run details`}>
      <header>
        <div>
          <MessageSquare size={16} aria-hidden="true" />
          <strong>{block.label}</strong>
          <small>Meeting</small>
        </div>
        <button aria-label="Close run details" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div
        className="workflow-chat-messages"
        ref={transcript}
        role="log"
        aria-label={`${block.label} conversation`}
        aria-live="off"
        onScroll={onScroll}
      >
        {!messages.length && <p>Connected agents can publish messages here and read the discussion.</p>}
        {messages.map((message) => (
          <article
            className="workflow-chat-message assistant"
            style={{ borderInlineStartColor: workflowWriterColor(message.author) }}
            key={message.sequence}
          >
            <strong>{message.author}</strong>
            <small>
              {" "}
              #{message.sequence} · {message.model ?? message.provider} ·{" "}
              {new Date(message.timestamp).toLocaleTimeString()}
            </small>
            <p style={{ whiteSpace: "pre-wrap" }}>{message.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowAppOutput({ onRead, refresh }: { onRead(): Promise<HarnessAppState>; refresh: number }) {
  const [app, setApp] = useState<HarnessAppState>();
  const [error, setError] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const followOutput = useRef(true);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await onRead();
        if (!disposed) {
          setApp(next);
          setError("");
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Could not read app output");
      }
      if (!disposed) timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [onRead, refresh]);
  useLayoutEffect(() => {
    if (outputRef.current && followOutput.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [app?.output]);
  return (
    <section className="harness-app-output" aria-label="App output">
      <header>
        <strong>App output</strong>
        <span>
          {app
            ? app.status === "not_found"
              ? "Not started"
              : app.status === "exited"
                ? `Exited${app.exitCode != null ? ` · ${app.exitCode}` : app.signal ? ` · ${app.signal}` : ""}`
                : app.status === "running"
                  ? "Running"
                  : app.status === "descendants-running"
                    ? "Children running"
                    : "Starting"
            : "Loading…"}
        </span>
      </header>
      {error && <p role="alert">{error}</p>}
      <pre
        ref={outputRef}
        tabIndex={0}
        aria-label="App stdout and stderr"
        onScroll={() => {
          const element = outputRef.current;
          if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 30;
        }}
      >
        {app?.output || (app?.status === "not_found" ? "Start the app to see its output." : "Waiting for output…")}
      </pre>
    </section>
  );
}

export function WorkflowMarkdown({ children }: { children: string }) {
  const [linkError, setLinkError] = useState("");
  const openLink = async (href: string) => {
    setLinkError("");
    try {
      if (window.desktop) await window.desktop.openExternal(href);
      else window.open(href, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "Could not open link");
    }
  };
  return (
    <div className="workflow-message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label, title }) => {
            let url: string | undefined;
            try {
              const parsed = new URL(href?.startsWith("//") ? `https:${href}` : (href ?? ""));
              if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.href;
            } catch {
              /* Incomplete and non-web links remain readable without navigating the app. */
            }
            if (!url) return <span title={title}>{label}</span>;
            const followLink = (event: ReactMouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              event.stopPropagation();
              void openLink(url);
            };
            return (
              <a
                href={url}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                onClick={followLink}
                onAuxClick={(event) => {
                  if (event.button === 1) followLink(event);
                }}
              >
                {label}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
      {linkError && <WorkflowError message={linkError} />}
    </div>
  );
}

export function WorkflowMessage({ title, value }: { title: string; value: string }) {
  const [raw, setRaw] = useState(false);
  const markers = title === "Prompt" ? ["\n\nConnected tools:", "\n\nWorkflow runtime capability:"] : [];
  const boundary = markers
    .map((marker) => value.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const content = boundary === undefined ? value : value.slice(0, boundary);
  const markdown = (text: string) => <WorkflowMarkdown>{text}</WorkflowMarkdown>;
  return (
    <section className={`workflow-message ${title.toLowerCase()}`} aria-label={title}>
      <header>
        <span>
          {title === "Answer" ? <Bot size={14} /> : <MessageSquare size={14} />}
          <strong>{title}</strong>
        </span>
        <button
          type="button"
          aria-label={`${raw ? "Format" : "Show raw"} ${title.toLowerCase()}`}
          aria-pressed={raw}
          onClick={() => setRaw((value) => !value)}
        >
          {raw ? "Formatted" : "Raw"}
        </button>
      </header>
      {raw ? (
        <pre className="workflow-message-raw">{value}</pre>
      ) : (
        <>
          {markdown(content)}
          {boundary !== undefined && (
            <details className="workflow-runtime-context">
              <summary>Runtime context</summary>
              {markdown(value.slice(boundary).trim())}
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function LogSection({ title, value, error }: { title: string; value: string; error?: boolean }) {
  return error ? (
    <WorkflowError message={value} label={title} />
  ) : (
    <section className="harness-log">
      <strong>{title}</strong>
      <pre>{value}</pre>
    </section>
  );
}

export function LogEntry({ entry }: { entry: HarnessLogEntry }) {
  return (
    <details className={`harness-log-entry ${entry.kind}`}>
      <summary>
        <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
        <span>{entry.kind}</span>
      </summary>
      <pre>{entry.message}</pre>
    </details>
  );
}
