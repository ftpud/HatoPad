import { Bot, Clock, FileText, MessageSquare, Play, Terminal } from "lucide-react";
import type { HarnessBlock } from "@hatopad/protocol";

export function WorkflowBlockIcon({ type }: { type: HarnessBlock["type"] }) {
  const Icon =
    type === "ai" || ["prompt", "task", "review"].includes(type)
      ? Bot
      : ["chatbox", "meeting"].includes(type)
        ? MessageSquare
        : type === "timer"
          ? Clock
          : type === "script" || type === "run_app" || type === "terminal_control" || type === "task_controls"
            ? Terminal
            : type === "markdown" || type === "text" || type === "skill"
              ? FileText
              : type === "user_prompt" || type === "yes_no_prompt"
                ? MessageSquare
                : Play;
  return <Icon size={14} aria-hidden="true" />;
}
