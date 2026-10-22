import type { HarnessBlock } from "@hatopad/protocol";

export const flowBlockTypes: HarnessBlock["type"][] = [
  "ai",
  "chatbox",
  "skill",
  "mcp",
  "task_controls",
  "terminal_control",
  "meeting",
  "text",
  "timer",
  "user_prompt",
  "yes_no_prompt",
  "markdown",
  "script",
  "run_app",
  "start_button",
  "start_input",
];

export const blockTypeLabels: Partial<Record<HarnessBlock["type"], string>> = {
  ai: "AI Agent",
  chatbox: "Chatbox",
  skill: "SKILL",
  mcp: "MCP server",
  terminal_control: "Terminal Control",
  meeting: "Meeting",
  task_controls: "Task controls",
  text: "Text input",
  timer: "Timer",
  user_prompt: "User Prompt",
  yes_no_prompt: "Yes/No Prompt",
  markdown: "Markdown document",
  script: "Script execution",
  run_app: "Run App",
  start_button: "Start button",
  start_input: "Start with text",
};
