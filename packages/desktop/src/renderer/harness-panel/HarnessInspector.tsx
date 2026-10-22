import { Spline, Settings2, Trash2, X } from "lucide-react";
import type { HarnessBlock } from "@hatopad/protocol";
import { ModelPicker } from "../ModelPicker";
import { activeRunStatuses, executionBehavior, previewPrompt } from "./definition";
import { flowBlockTypes, blockTypeLabels } from "./block-catalog";
import { WorkflowBlockIcon } from "./WorkflowBlockIcon";
import { WorkflowReasoningField } from "./WorkflowReasoningField";
import { SchemaEditor } from "./SchemaEditor";
import { BlockRunDetails } from "./BlockRunDetails";
import { PauseResolution } from "./PauseResolution";
import type { HarnessViewContext } from "./view-types";

export function HarnessInspector({ context }: { context: HarnessViewContext }) {
  const {
    draft,
    mode,
    run,
    input,
    onCancelRun,
    selected,
    setDraft,
    block,
    selectedEdge,
    setSelectedBlockId,
    setSelectedBlockIds,
    setSelectedEdgeId,
    setWorkflowSettingsOpen,
    blockRun,
    blockById,
    onTestBlock,
    removeEdge,
    updateBlock,
    providers,
    blockModels,
    selectedBlockModel,
    agents,
    mcpServers,
    skillCatalog,
    onRefreshSkills,
    onError,
    testInput,
    setTestInput,
    testRunId,
    defaultProvider,
    onLoadModels,
    setTestRunId,
    onAutopilot,
    onOpenAppTerminal,
    onSteerChat,
    onReadApp,
    onKillApp,
    onResolvePermission,
    onAnswerQuestion,
    onResumePause,
    onRetryPause,
    onCancelPause,
    workflowSettingsFields,
  } = context;
  if (!draft) return null;
  return (
    <aside className="harness-sidebar" aria-label="Workflow inspector">
      {block && mode === "edit" && (
        <section className="harness-inspector" aria-label="Block settings">
          <header>
            <span className="harness-inspector-title">
              <WorkflowBlockIcon type={block.type} />
              <span>
                <strong>{block.label || "Untitled block"}</strong>
                <small>{blockTypeLabels[block.type] ?? block.type}</small>
              </span>
            </span>
            <button
              title="Close block settings"
              aria-label="Close block settings"
              onClick={() => {
                setSelectedBlockId(undefined);
                setSelectedBlockIds([]);
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <label>
            Name
            <input
              placeholder="Name this block…"
              value={block.label}
              onChange={(event) => updateBlock({ label: event.target.value })}
            />
          </label>
          <label>
            Type
            <select
              aria-label="Block type"
              value={block.type}
              onChange={(event) =>
                updateBlock({
                  type: event.target.value as HarnessBlock["type"],
                  seconds: 60,
                  ...(["mcp", "terminal_control", "meeting"].includes(event.target.value)
                    ? { prompt: "", agent: undefined }
                    : {}),
                  ...(event.target.value === "task_controls" ? { agent: undefined, prompt: "" } : {}),
                  ...(event.target.value === "run_app"
                    ? { app: block.app ?? { actions: ["start" as const], name: "app" } }
                    : {}),
                  watchdog: undefined,
                  join: undefined,
                  routing: undefined,
                  review: undefined,
                  verification: undefined,
                  ...(event.target.value !== "skill" ? { skillId: undefined } : {}),
                  ...(event.target.value !== "mcp" ? { mcp: undefined } : {}),
                })
              }
            >
              {!flowBlockTypes.includes(block.type) && <option value={block.type}>Legacy {block.type}</option>}
              {flowBlockTypes.map((type) => (
                <option key={type} value={type}>
                  {blockTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          {["ai", "chatbox", "task_controls", "prompt", "task", "review"].includes(block.type) && (
            <>
              <div className="harness-fields">
                <label>
                  Provider
                  <select
                    value={block.provider ?? ""}
                    onChange={(event) =>
                      updateBlock({
                        provider: event.target.value || undefined,
                        model: undefined,
                        reasoning: undefined,
                      })
                    }
                  >
                    <option value="">Default</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ModelPicker
                  models={blockModels}
                  value={block.model ?? ""}
                  label="AI model"
                  onChange={(model) => {
                    const selected = blockModels.find((item) => item.id === model);
                    updateBlock({ model, reasoning: selected?.defaultReasoning || undefined });
                  }}
                />
              </div>
              {selectedBlockModel?.reasoningLevels.length || ["ai", "chatbox"].includes(block.type) ? (
                <WorkflowReasoningField
                  model={selectedBlockModel}
                  modelSelected={!!block.model}
                  value={block.reasoning}
                  onChange={(reasoning) => updateBlock({ reasoning })}
                />
              ) : null}
              {block.type !== "task_controls" && (
                <>
                  <label>
                    Agent preset
                    <select
                      value={block.agent ? `${block.agent.scope}:${block.agent.name}` : ""}
                      onChange={(event) => {
                        const agent = agents.find((item) => `${item.scope}:${item.name}` === event.target.value);
                        updateBlock({ agent: agent ? { scope: agent.scope, name: agent.name } : undefined });
                      }}
                    >
                      <option value="">None</option>
                      {agents.map((item) => (
                        <option key={`${item.scope}:${item.name}`} value={`${item.scope}:${item.name}`}>
                          {item.agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>
                    {block.type === "chatbox"
                      ? "Keeps one conversation per run. Open its details in View / Run to chat and use connected blocks."
                      : "One context per AI Agent in each run. Use connected blocks through MCP; choose a path before finishing."}
                  </small>
                </>
              )}
            </>
          )}
          {block.type === "task_controls" && (
            <small>
              Connect with Use to an AI Agent, or connect to a Chatbox. Actions: create, create_and_start, status,
              prompt, set_status (active or finished), set_commit_message (draft), and update_commit_message (latest
              unpushed commit). Commit-message actions take a task_id and message. Prompts use the provider, model, and
              reasoning above. Direct runs accept a JSON object, for example {'{"action":"status"}'}.
            </small>
          )}
          {block.type === "mcp" && (
            <>
              <label>
                MCP server
                <select
                  aria-label="Workflow MCP server"
                  value={block.mcp?.serverId ?? ""}
                  onChange={(event) =>
                    updateBlock({ mcp: event.target.value ? { serverId: event.target.value } : undefined })
                  }
                >
                  <option value="">Choose a server</option>
                  {block.mcp && !mcpServers.some((server) => server.id === block.mcp?.serverId) && (
                    <option value={block.mcp.serverId}>Unavailable server</option>
                  )}
                  {mcpServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Connection
                <select
                  aria-label="Workflow MCP connection"
                  value={block.mcp?.connectionId ?? ""}
                  disabled={!block.mcp}
                  onChange={(event) =>
                    updateBlock({
                      mcp: {
                        serverId: block.mcp!.serverId,
                        ...(event.target.value ? { connectionId: event.target.value } : {}),
                      },
                    })
                  }
                >
                  <option value="">Default connection</option>
                  {mcpServers
                    .find((server) => server.id === block.mcp?.serverId)
                    ?.connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                Connect an AI Agent or Chatbox to this block with a Use connection. It can discover and call this
                server’s actions.
              </p>
            </>
          )}
          {block.type === "skill" && (
            <>
              <label>
                Existing skill
                <select
                  aria-label="Existing skill"
                  value={block.skillId ?? ""}
                  onChange={(event) => {
                    const selected = skillCatalog?.skills.find((skill) => skill.id === event.target.value);
                    updateBlock(
                      selected
                        ? {
                            skillId: selected.id,
                            label: selected.title,
                            description: selected.description ?? selected.title,
                            prompt: "",
                          }
                        : { skillId: undefined, description: "", prompt: "" },
                    );
                  }}
                >
                  <option value="">Custom instructions</option>
                  {block.skillId && !skillCatalog?.skills.some((skill) => skill.id === block.skillId) && (
                    <option value={block.skillId}>Unavailable: {block.skillId}</option>
                  )}
                  {skillCatalog?.skills.map((skill) => (
                    <option key={skill.id} value={skill.id} disabled={!skillCatalog.policy.allowed.includes(skill.id)}>
                      {skill.title} ({skill.scope})
                    </option>
                  ))}
                </select>
              </label>
              {onRefreshSkills && (
                <button
                  title="Refresh workflow skills"
                  onClick={() => void onRefreshSkills().catch((error) => onError(String(error)))}
                >
                  Refresh skills
                </button>
              )}
              {block.skillId ? (
                <>
                  <small>
                    Linked skill: {block.skillId}. Its current instructions load when used. Supporting files stay with
                    the skill.
                  </small>
                  <p>
                    {skillCatalog?.skills.find((skill) => skill.id === block.skillId)?.description ?? block.description}
                  </p>
                </>
              ) : (
                <label>
                  Description
                  <textarea
                    aria-label="Skill description"
                    placeholder="Describe when an agent should use this skill…"
                    rows={3}
                    value={block.description ?? ""}
                    onChange={(event) => updateBlock({ description: event.target.value })}
                  />
                </label>
              )}
              <small>
                Connect an AI Agent to this block with Use, or connect it to a Chatbox. Agents see the description and
                load the instructions when relevant.
              </small>
            </>
          )}
          {block.type === "timer" && (
            <>
              <label>
                Delay in seconds
                <input
                  aria-label="Timer seconds"
                  type="number"
                  min="0"
                  max="86400"
                  value={block.seconds ?? 60}
                  onChange={(event) => updateBlock({ seconds: Number(event.target.value) })}
                />
              </label>
              <small>
                Using this block arms its countdown and returns immediately. When it fires, its follow connections
                receive the input used to arm it.
              </small>
            </>
          )}
          {block.type === "run_app" && (
            <>
              <fieldset className="harness-app-actions">
                <legend>Allowed actions</legend>
                {(["start", "kill", "status", "tail"] as const).map((action) => {
                  const actions = block.app?.actions ?? [block.app?.action ?? "start"];
                  return (
                    <label key={action}>
                      <input
                        type="checkbox"
                        aria-label={`Run App allow ${action}`}
                        checked={actions.includes(action)}
                        onChange={(event) =>
                          updateBlock({
                            app: {
                              name: block.app?.name ?? "app",
                              lines: block.app?.lines,
                              actions: event.target.checked
                                ? [...actions, action]
                                : actions.filter((item) => item !== action),
                            },
                          })
                        }
                      />
                      {action === "start"
                        ? "Run"
                        : action === "tail"
                          ? "Tail logs"
                          : action === "kill"
                            ? "Kill"
                            : "Status"}
                    </label>
                  );
                })}
              </fieldset>
              <label>
                App name
                <input
                  aria-label="Run App name"
                  placeholder="e.g. dev-server"
                  maxLength={120}
                  value={block.app?.name ?? ""}
                  onChange={(event) =>
                    updateBlock({
                      app: {
                        ...block.app,
                        actions: block.app?.actions ?? [block.app?.action ?? "start"],
                        name: event.target.value,
                      },
                    })
                  }
                />
              </label>
              {(block.app?.actions ?? [block.app?.action ?? "start"]).includes("start") && (
                <label>
                  Start script
                  <textarea
                    aria-label="Run App script"
                    placeholder="e.g. npm run dev"
                    rows={6}
                    value={block.command ?? ""}
                    onChange={(event) => updateBlock({ command: event.target.value })}
                  />
                </label>
              )}
              {(block.app?.actions ?? [block.app?.action ?? "start"]).includes("tail") && (
                <label>
                  Last N lines
                  <input
                    aria-label="Run App tail lines"
                    type="number"
                    min="1"
                    max="10000"
                    value={block.app?.lines ?? 100}
                    onChange={(event) => updateBlock({ app: { ...block.app!, lines: Number(event.target.value) } })}
                  />
                </label>
              )}
              <small>
                Connected agents choose from the checked actions. Direct runs start the app when Run is checked;
                otherwise they use the single checked action or the action supplied in the input.
              </small>
              <small>
                Runs in an interactive terminal in the task workspace. Workflow input is available in
                HATOPAD_WORKFLOW_INPUT. Keep the app in the foreground (no &amp;). Apps with the same name are shared
                within this workspace and stay alive after the workflow finishes. An already running app is reused.
              </small>
            </>
          )}
          {["ai", "chatbox"].includes(block.type) && (
            <label className="harness-autopilot" title="Approve tool permission requests automatically">
              <input
                type="checkbox"
                aria-label="Block Autopilot"
                checked={block.autopilot ?? true}
                onChange={(event) => updateBlock({ autopilot: event.target.checked })}
              />{" "}
              Autopilot
            </label>
          )}
          {block.type === "meeting" && (
            <small>
              Connect AI Agents and Chatboxes to this Meeting with Use. Participants can publish messages, read the
              recent tail, read a diff since their own last read, or wait for new messages without polling. The shared
              transcript belongs to each workflow run. Keeps the latest 1,000 messages; publishing does not start other
              agents.
            </small>
          )}
          {block.type === "terminal_control" && (
            <small>
              Use only for long-running apps and services. Do not spawn agents in terminals. List terminals first and
              reuse an existing terminal whenever possible; avoid spawning new terminals unnecessarily. Runs in the task
              workspace. Supply JSON input: {'{"action":"list"}'}, {'{"action":"open","name":"Server"}'},{" "}
              {'{"action":"open_and_run","name":"Server","command":"npm run dev"}'},{" "}
              {'{"action":"write","terminal_id":"ID","data":"npm run dev\\n"}'}, or{" "}
              {'{"action":"read","terminal_id":"ID","lines":100}'}. open_and_run starts a terminal and runs the command
              in one call, adding a newline automatically. Connect with Use to make these actions available to an agent.
            </small>
          )}
          {block.type === "script" && (
            <>
              <label>
                Shell script
                <textarea
                  placeholder="e.g. git status --short"
                  aria-label="Shell script"
                  rows={6}
                  value={block.command ?? ""}
                  onChange={(event) => updateBlock({ command: event.target.value })}
                />
              </label>
              <small>
                Runs in the Core workspace. Input arrives on stdin and in HATOPAD_WORKFLOW_INPUT. Stdout becomes this
                block’s output.
              </small>
            </>
          )}
          {!(block.type === "skill" && block.skillId) &&
            ![
              "mcp",
              "task_controls",
              "terminal_control",
              "meeting",
              "timer",
              "script",
              "run_app",
              "start_input",
            ].includes(block.type) && (
              <label>
                {block.type === "markdown"
                  ? "Markdown (blank uses input)"
                  : block.type === "text"
                    ? "Text"
                    : ["user_prompt", "yes_no_prompt"].includes(block.type)
                      ? "Question"
                      : block.type === "start_button"
                        ? "Start prompt"
                        : "Instructions"}
                <textarea
                  placeholder={
                    block.type === "skill"
                      ? "Write the instructions the agent should follow when using this skill…"
                      : block.type === "markdown"
                        ? "Write Markdown, or leave blank to use the incoming text…"
                        : block.type === "text"
                          ? "Enter text to pass to the next block…"
                          : ["user_prompt", "yes_no_prompt"].includes(block.type)
                            ? "What would you like to ask?"
                            : block.type === "start_button"
                              ? "Enter the prompt that starts this workflow…"
                              : "Describe what this agent should do. Use {{input}} for incoming text…"
                  }
                  aria-label="Block prompt"
                  rows={5}
                  value={block.prompt}
                  onChange={(event) => updateBlock({ prompt: event.target.value })}
                />
              </label>
            )}
          {onTestBlock && (
            <>
              <label>
                Test input
                <textarea
                  aria-label="Block test input"
                  value={testInput}
                  onChange={(event) => setTestInput(event.target.value)}
                />
              </label>
              <small>Tests the current draft with connected tools. Follow steps are skipped.</small>
            </>
          )}
          <details>
            <summary>Data schemas</summary>
            <SchemaEditor
              title="Input schema"
              schema={block.inputSchema}
              onChange={(inputSchema) => updateBlock({ inputSchema })}
            />
            <SchemaEditor
              title="Output schema"
              schema={block.outputSchema}
              onChange={(outputSchema) => updateBlock({ outputSchema })}
            />
          </details>
          <small>
            Follow connections pass this block’s output into the next block. Templates support {"{{input}}"} and{" "}
            {"{{blocks.ID.output}}"}.
          </small>
        </section>
      )}
      {block && mode === "edit" && (
        <section className="harness-input-help" aria-label="Workflow execution preview">
          <strong>Execution preview</strong>
          <p>{executionBehavior(block, draft.edges)}</p>
          {previewPrompt(block.prompt, input).trim() && (
            <pre aria-label="Rendered prompt preview">{previewPrompt(block.prompt, input)}</pre>
          )}
        </section>
      )}
      {block && mode === "edit" && testRunId !== undefined && testRunId === run?.id && (
        <>
          <BlockRunDetails
            providers={providers}
            defaultProvider={defaultProvider}
            onLoadModels={onLoadModels}
            block={block}
            run={run}
            state={blockRun}
            onClose={() => setTestRunId(undefined)}
            onAutopilot={
              onAutopilot && run && blockRun?.sessionId
                ? (enabled) => onAutopilot(run.id, block.id, blockRun.sessionId!, enabled).then(() => undefined)
                : undefined
            }
            onOpenAppTerminal={
              onOpenAppTerminal && block.type === "run_app"
                ? () => onOpenAppTerminal(draft.id, block.id, run?.id)
                : undefined
            }
            onSteer={
              onSteerChat && run && blockRun?.sessionId
                ? (input) => onSteerChat(run.id, block.id, blockRun.sessionId!, input).then(() => undefined)
                : undefined
            }
            onReadApp={onReadApp && block.type === "run_app" ? () => onReadApp(draft.id, block.id, run?.id) : undefined}
            onKillApp={onKillApp && block.type === "run_app" ? () => onKillApp(draft.id, block.id, run?.id) : undefined}
          />
          {blockRun && (
            <PauseResolution
              run={run!}
              block={blockRun}
              label={block.label}
              yesNo={block.type === "yes_no_prompt"}
              onResolvePermission={onResolvePermission}
              onAnswerQuestion={onAnswerQuestion}
              onResumePause={onResumePause}
              onRetryPause={onRetryPause}
              onCancelPause={onCancelPause}
              onError={onError}
            />
          )}
          <button
            onClick={() => void onCancelRun(run!.id).catch((error) => onError(String(error)))}
            disabled={!run || !activeRunStatuses.has(run.status)}
          >
            Stop test
          </button>
        </>
      )}
      {mode === "edit" && selectedEdge && !block && (
        <section className="harness-inspector harness-edge-inspector" aria-label="Connection settings">
          <header>
            <span className="harness-inspector-title">
              <Spline size={16} aria-hidden="true" />
              <span>
                <strong>Connection</strong>
                <small>
                  {blockById.get(selectedEdge.from)?.label} → {blockById.get(selectedEdge.to)?.label}
                </small>
              </span>
            </span>
            <button
              title="Close connection settings"
              aria-label="Close connection settings"
              onClick={() => setSelectedEdgeId(undefined)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <label>
            Type
            <select
              aria-label="Connection type"
              value={selectedEdge.type ?? "follow"}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  edges: draft.edges.map((edge) =>
                    edge.id === selectedEdge.id
                      ? {
                          ...edge,
                          type: event.target.value as "use" | "follow" | "path",
                          loop: undefined,
                          execution: undefined,
                          timeoutMs: undefined,
                        }
                      : edge,
                  ),
                })
              }
            >
              <option value="follow">Follow</option>
              {["ai", "chatbox"].includes(blockById.get(selectedEdge.from)?.type ?? "") && (
                <>
                  <option value="use">Use</option>
                  <option value="path">Path</option>
                </>
              )}
            </select>
          </label>
          {(selectedEdge.type === "use" || blockById.get(selectedEdge.from)?.type === "chatbox") && (
            <label>
              Use timeout (seconds)
              <input
                type="number"
                min="0.001"
                max="86400"
                step="any"
                aria-label="Use timeout (seconds)"
                placeholder="300"
                value={selectedEdge.timeoutMs === undefined ? "" : selectedEdge.timeoutMs / 1000}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    edges: draft.edges.map((edge) =>
                      edge.id === selectedEdge.id
                        ? {
                            ...edge,
                            timeoutMs:
                              event.target.value === "" ? undefined : Math.round(Number(event.target.value) * 1000),
                          }
                        : edge,
                    ),
                  })
                }
              />
            </label>
          )}
          {selectedEdge.type === "path" && (
            <label>
              Path name
              <input
                placeholder="e.g. approved"
                aria-label="Path name"
                value={selectedEdge.label ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    edges: draft.edges.map((edge) =>
                      edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge,
                    ),
                  })
                }
              />
            </label>
          )}
          <button className="danger harness-inspector-delete" onClick={() => removeEdge(selectedEdge.id)}>
            <Trash2 size={14} aria-hidden="true" /> Remove connection
          </button>
        </section>
      )}
      {!block && !selectedEdge && (
        <section className="harness-inspector harness-workflow-settings" aria-label="Workflow settings">
          <header>
            <span className="harness-inspector-title">
              <Settings2 size={16} aria-hidden="true" />
              <span>
                <strong>Workflow settings</strong>
                <small>Limits for every run of this workflow</small>
              </span>
            </span>
            <button
              className="harness-sidebar-close"
              title="Close workflow settings"
              aria-label="Close workflow settings"
              onClick={() => setWorkflowSettingsOpen(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          {workflowSettingsFields}
        </section>
      )}
    </aside>
  );
}
