import { Children, isValidElement, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownLink =
  | { type: "external"; url: string }
  | { type: "file"; path: string }
  | { type: "fragment"; id: string }
  | { type: "unsupported" };

export function resolveMarkdownLink(href: string, sourcePath: string, workspacePath = ""): MarkdownLink {
  if (href.startsWith("#")) {
    try {
      return { type: "fragment", id: decodeURIComponent(href.slice(1)) };
    } catch {
      return { type: "unsupported" };
    }
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    const target = href.split(/[?#]/, 1)[0];
    if (!target) return { type: "unsupported" };
    let decoded: string;
    try {
      decoded = decodeURIComponent(target).replaceAll("\\", "/");
    } catch {
      return { type: "unsupported" };
    }
    const base = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const path = normalizeWorkspacePath(decoded.startsWith("/") ? decoded.slice(1) : `${base}/${decoded}`);
    return path ? { type: "file", path } : { type: "unsupported" };
  }

  if (url.protocol === "http:" || url.protocol === "https:") return { type: "external", url: url.toString() };
  if (url.protocol !== "file:" || url.host) return { type: "unsupported" };

  let filePath: string;
  try {
    filePath = decodeURIComponent(url.pathname).replaceAll("\\", "/");
  } catch {
    return { type: "unsupported" };
  }
  const workspace = workspacePath.replaceAll("\\", "/").replace(/\/$/, "");
  if (!workspace || (filePath !== workspace && !filePath.startsWith(`${workspace}/`))) return { type: "unsupported" };
  const path = normalizeWorkspacePath(filePath.slice(workspace.length + 1));
  return path ? { type: "file", path } : { type: "unsupported" };
}

function normalizeWorkspacePath(value: string): string | undefined {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/") || undefined;
}

function markdownUrlTransform(url: string, key: string): string {
  if (key === "href" && /^file:/i.test(url)) return url;
  return /^(?:[a-z][a-z+.-]*:)/i.test(url) && !/^(?:https?|ircs?|mailto|xmpp):/i.test(url) ? "" : url;
}

function nodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? nodeText(child.props.children)
          : "",
    )
    .join("");
}

/** GitHub-style heading anchor: lower-cased, punctuation removed, spaces as hyphens. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const taskMarker = /^((?:[-+*]|\d+[.)])\s+)\[[ xX]\]/;

/** Toggles the task whose list item starts at `itemOffset` in `source` (a Markdown AST source offset). */
export function toggleMarkdownTask(source: string, itemOffset: number, checked: boolean): string {
  const rest = source.slice(itemOffset);
  if (!taskMarker.test(rest)) return source;
  return source.slice(0, itemOffset) + rest.replace(taskMarker, `$1[${checked ? "x" : " "}]`);
}

export function MarkdownPreview({
  children,
  sourcePath,
  workspacePath,
  renderPre,
  onOpenFile,
  onOpenExternal,
  onChange,
}: {
  children: string;
  sourcePath: string;
  workspacePath?: string;
  renderPre?: Components["pre"];
  onOpenFile(path: string): void;
  onOpenExternal(url: string): void;
  onChange?(content: string): void;
}) {
  // React renders depth-first, so a task checkbox always belongs to the last rendered list item.
  let itemOffset: number | undefined;
  const headingIds = new Map<string, number>();
  const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function Heading({ node: _node, children: content, ...props }: { node?: unknown; children?: ReactNode }) {
      const base = headingSlug(nodeText(content));
      const seen = headingIds.get(base) ?? 0;
      headingIds.set(base, seen + 1);
      const id = base ? (seen ? `${base}-${seen}` : base) : undefined;
      return (
        <Tag {...props} id={id}>
          {content}
        </Tag>
      );
    };
  const followLink = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
    event.preventDefault();
    if (!href) return;
    const link = resolveMarkdownLink(href, sourcePath, workspacePath);
    if (link.type === "external") onOpenExternal(link.url);
    else if (link.type === "file") onOpenFile(link.path);
    else if (link.type === "fragment") document.getElementById(link.id)?.scrollIntoView();
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={markdownUrlTransform}
      components={{
        ...(renderPre ? { pre: renderPre } : {}),
        h1: heading("h1"),
        h2: heading("h2"),
        h3: heading("h3"),
        h4: heading("h4"),
        h5: heading("h5"),
        h6: heading("h6"),
        a: ({ href, children: label, ...props }) => (
          <a {...props} href={href} onClick={(event) => followLink(event, href)}>
            {label}
          </a>
        ),
        li: ({ node, ...props }) => {
          itemOffset = node?.position?.start.offset;
          return <li {...props} />;
        },
        input: ({ node: _node, ...props }) => {
          if (props.type !== "checkbox" || !onChange) return <input {...props} />;
          const offset = itemOffset;
          return (
            <input
              {...props}
              disabled={false}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (offset === undefined) return;
                const content = toggleMarkdownTask(children, offset, event.target.checked);
                if (content !== children) onChange(content);
              }}
            />
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
