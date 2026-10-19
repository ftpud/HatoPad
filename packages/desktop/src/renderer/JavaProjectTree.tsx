import { ChevronDown, ChevronRight, FolderOpen, Package } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { FileTreeNode, JavaProjectNode } from "@hatopad/protocol";
import { JavaFileIcon } from "./plugins/languages/java";

export function JavaProjectTree({ nodes, activePath, onOpen }: { nodes: JavaProjectNode[]; activePath?: string; onOpen(node: FileTreeNode): void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.filter((node) => node.type === "sourceRoot").map((node) => node.path)));
  useEffect(() => setExpanded((current) => new Set([...current, ...nodes.filter((node) => node.type === "sourceRoot").map((node) => node.path)])), [nodes]);
  const render = (items: JavaProjectNode[], depth: number): ReactNode => items.map((node) => {
    if (node.type === "file") return <button key={node.path} className={`tree-row java-file-row ${activePath === node.path ? "selected" : ""}`} style={{ paddingLeft: 11 + depth * 13 }} onClick={() => onOpen({ name: node.name, path: node.path, type: "file" })}>
      <JavaFileIcon type={node.javaType} /><span className="tree-file-name">{node.name}</span>
    </button>;
    const open = expanded.has(node.path);
    return <div key={node.path}>
      <button className={`tree-row ${node.type === "sourceRoot" ? "java-source-root" : ""}`} style={{ paddingLeft: 7 + depth * 13 }} onClick={() => setExpanded((current) => { const next = new Set(current); open ? next.delete(node.path) : next.add(node.path); return next; })}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{node.type === "sourceRoot" ? <FolderOpen className={`folder-kind-icon java-root-${node.sourceKind ?? "source"}`} size={14} /> : <Package size={14} color="var(--warning)" />}<span className="tree-file-name">{node.name}</span>
      </button>
      {open && render(node.children ?? [], depth + 1)}
    </div>;
  });
  return <>{render(nodes, 0)}</>;
}
