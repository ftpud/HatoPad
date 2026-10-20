import { HarnessToolbar } from "./HarnessToolbar";
import { HarnessCanvasEditor } from "./HarnessCanvasEditor";
import { HarnessInspector } from "./HarnessInspector";
import type { HarnessViewContext } from "./view-types";
import { WorkflowError } from "../WorkflowError";
import {
  Download,
  Eye,
  LayoutGrid,
  List,
  PanelTop,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import type { HarnessEditorModel } from "./useHarnessEditor";
import { activeRunStatuses, downloadWorkflowRun } from "./definition";

import { WorkflowTimeline, RunComparison } from "./WorkflowTimeline";

import { BlockRunDetails } from "./BlockRunDetails";
import { PauseResolution } from "./PauseResolution";

export function HarnessEditorView({ model }: { model: HarnessEditorModel }) {
  const {
    draft,
    setSetting,
    mode,
    run,
    activeRuns,
    dirty,
    validationIssues,
    input,
    start,
    rerunSelected,
    onCancelRun,
    validationAnnouncement,
    runAnnouncement,
    diagnostics,
    dismissedRecoveryNoticeId,
    recoveryNoticeId,
    setDismissedRecoveryNoticeId,
    createName,
    create,
    setCreateName,
    createTemplate,
    setCreateTemplate,
    selectedId,
    discardDraft,
    setSelectedId,
    harnesses,
    onOpenWorkflow,
    selected,
    remove,
    designOnly,
    setMode,
    setConnectFrom,
    editorSurface,
    setEditorSurface,
    setDraft,
    addBlock,
    saving,
    save,
    undoStack,
    undo,
    redoStack,
    redo,
    importInputRef,
    importWorkflow,
    duplicate,
    block,
    duplicateBlock,
    copyBlock,
    copiedBlock,
    pasteBlock,
    workflowSettingsOpen,
    selectedEdge,
    setSelectedBlockId,
    setSelectedBlockIds,
    setSelectedEdgeId,
    setWorkflowSettingsOpen,
    workflowRuns,
    setSelectedRunId,
    selectedBlockId,
    blockRun,
    onDeleteRun,
    removeSelectedRun,
    comparisonRun,
    setCompareRunId,
    saveConflict,
    resetDraft,
    setBaseline,
    setSaveConflict,
    saveAsCopy,
    connectFrom,
    blockById,
    connectionType,
    setConnectionType,
    zoom,
    changeZoom,
    zoomRef,
    fitCanvasToBlocks,
    autoLayout,
    selectedBlockIds,
    alignSelectedBlocks,
    minimapVisible,
    setMinimapVisible,
    minimapCorner,
    setMinimapCorner,
    setMinimapPosition,
    canvasFrameRef,
    canvasRef,
    canvasPanning,
    updateCanvasViewport,
    beginCanvasPan,
    endCanvasPan,
    moveCanvasPan,
    canvasPan,
    pointerMove,
    drag,
    canvasWidth,
    canvasHeight,
    arrowMarkerId,
    animatedTraces,
    selectedEdgeId,
    pointerDown,
    ignoreNextBlockClick,
    selectBlock,
    keyboardActivate,
    connectTo,
    beginConnection,
    startInputs,
    setStartInputs,
    onTestBlock,
    testingBlockId,
    testBlock,
    removeBlock,
    showMinimap,
    minimapPosition,
    minimapDrag,
    dragMinimap,
    dockMinimap,
    moveViewportFromMinimap,
    minimap,
    listConnectionTarget,
    setListConnectionTarget,
    removeEdge,
    updateBlock,
    providers,
    blockModels,
    selectedBlockModel,
    agents,
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
    onChat,
    pausedBlock,
    setInput,
  } = model;
  const numberSetting = (
    label: string,
    aria: string,
    description: string,
    value: number | undefined,
    bounds: { min: number; max: number; step?: number },
    onValue: (value: number | undefined) => void,
    placeholder?: string,
  ) => (
    <label title={description}>
      {label}
      <input
        aria-label={aria}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(event) => onValue(event.target.value === "" ? undefined : Number(event.target.value))}
      />
      <small className="harness-setting-description">{description}</small>
    </label>
  );
  const workflowSettingsFields = draft ? (
    <div className="harness-settings-fields">
      {numberSetting(
        "Concurrent blocks",
        "Workflow concurrency",
        "Blocks that may execute at the same time within one run.",
        draft.settings?.concurrency ?? 4,
        { min: 1, max: 32 },
        (concurrency) => setSetting({ concurrency }),
      )}
      {numberSetting(
        "Active runs",
        "Workflow active run limit",
        "Runs of this workflow that may be active at once; starting another is refused.",
        draft.settings?.maxActiveRuns ?? 4,
        { min: 1, max: 32 },
        (maxActiveRuns) => setSetting({ maxActiveRuns }),
      )}
      {numberSetting(
        "Block attempts",
        "Workflow block attempt limit",
        "Times a single block may be executed in one run, including loop passes and retries, before it fails.",
        draft.settings?.maxBlockAttempts ?? 100,
        { min: 1, max: 1000 },
        (maxBlockAttempts) => setSetting({ maxBlockAttempts }),
      )}
      {numberSetting(
        "Stack inputs",
        "Workflow stack size limit",
        "Inputs a stack block accepts per invocation.",
        draft.settings?.maxStackSize ?? 100,
        { min: 1, max: 1000 },
        (maxStackSize) => setSetting({ maxStackSize }),
      )}
      {numberSetting(
        "Loop iterations",
        "Workflow loop limit",
        "Times each loop connection may be followed before the run fails.",
        draft.settings?.maxLoopCount ?? 100,
        { min: 1, max: 1000 },
        (maxLoopCount) => setSetting({ maxLoopCount }),
      )}
      {numberSetting(
        "Child tasks",
        "Workflow child task limit",
        "Child tasks a single run may create.",
        draft.settings?.maxChildTasks ?? 100,
        { min: 1, max: 1000 },
        (maxChildTasks) => setSetting({ maxChildTasks }),
      )}
      {numberSetting(
        "Prompt limit",
        "Workflow prompt limit",
        "Largest prompt, in characters, that may be sent to an agent in one turn.",
        draft.settings?.promptLimitChars ?? 100000,
        { min: 1000, max: 200000, step: 1000 },
        (promptLimitChars) => setSetting({ promptLimitChars }),
      )}
      {numberSetting(
        "Context budget",
        "Workflow context budget",
        "Total characters delivered to one block across all its turns; the block fails when reached, so start a new run with a handoff.",
        draft.settings?.contextBudgetChars ?? 400000,
        { min: 1000, max: 10000000, step: 1000 },
        (contextBudgetChars) => setSetting({ contextBudgetChars }),
      )}
      {numberSetting(
        "Retry attempts",
        "Workflow retry attempts",
        "Automatic retries after a provider failure before the block must be retried manually.",
        draft.settings?.retry?.maxAttempts ?? 3,
        { min: 1, max: 10 },
        (maxAttempts) => setSetting({ retry: { ...draft.settings?.retry, maxAttempts } }),
      )}
      {numberSetting(
        "Output limit",
        "Workflow output limit",
        "Characters of a block's output kept and passed downstream; only the end is kept when longer.",
        draft.settings?.outputLimitChars ?? 200000,
        { min: 1000, max: 200000, step: 1000 },
        (outputLimitChars) => setSetting({ outputLimitChars }),
      )}
      {numberSetting(
        "Log entries",
        "Workflow log limit",
        "Newest log entries kept per block; older ones are dropped.",
        draft.settings?.logLimitEntries ?? 500,
        { min: 10, max: 500 },
        (logLimitEntries) => setSetting({ logLimitEntries }),
      )}
      {numberSetting(
        "Run duration (minutes)",
        "Workflow run duration",
        "Stops the run after this long. Leave empty for no time limit.",
        draft.settings?.maxRunDurationMs === undefined ? undefined : draft.settings.maxRunDurationMs / 60_000,
        { min: 1, max: 1440 },
        (minutes) => setSetting({ maxRunDurationMs: minutes === undefined ? undefined : minutes * 60_000 }),
        "No limit",
      )}
      {numberSetting(
        "Token budget",
        "Workflow token budget",
        "Total tokens all blocks may use in one run; the run fails once it is exceeded. Leave empty for no budget.",
        draft.settings?.tokenBudget,
        { min: 1000, max: 10000000, step: 1000 },
        (tokenBudget) => setSetting({ tokenBudget }),
        "No limit",
      )}
      <small>
        Defaults: 4 concurrent blocks, 4 active runs, 100 block attempts, 100 stack inputs, 100 loop iterations, 100
        child tasks, 100,000 prompt characters, 400,000 context characters, 3 retry attempts, 200,000 output characters
        and 500 log entries. Run duration and token budget are unlimited unless set.
      </small>
    </div>
  ) : null;
  const runActions = draft &&
    (!draft.blocks.some((item) => item.type === "start_button" || item.type === "start_input") ||
      (mode === "view" && run) ||
      activeRuns.length > 0) && (
      <div
        className="harness-run-actions"
        onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
      >
        {!draft.blocks.some((item) => item.type === "start_button" || item.type === "start_input") && (
          <button
            disabled={dirty || validationIssues.length > 0 || !input.trim() || !draft.blocks.length}
            title={
              dirty
                ? "Save changes before running"
                : validationIssues.length
                  ? "Fix workflow issues before running"
                  : activeRuns.length
                    ? "Append to the active dispatcher session"
                    : "Run workflow"
            }
            onClick={() => void start()}
          >
            <Play size={14} /> {activeRuns.length ? "Send" : "Run"}
          </button>
        )}
        {mode === "view" && run && (
          <button
            aria-label="Rerun selected workflow snapshot"
            disabled={!run.definition || activeRunStatuses.has(run.status)}
            onClick={() => void rerunSelected()}
          >
            <RotateCcw size={14} aria-hidden="true" /> Rerun
          </button>
        )}
        {activeRuns.map((active) => (
          <button
            key={active.id}
            className="danger"
            aria-label={`Stop run ${active.id}`}
            title={`Stop workflow run ${active.id}`}
            onClick={() => void onCancelRun(active.id)}
          >
            <Square size={13} aria-hidden="true" /> Stop{activeRuns.length > 1 ? ` · ${active.id.slice(0, 6)}` : ""}
          </button>
        ))}
      </div>
    );
  const context: HarnessViewContext = { ...model, workflowSettingsFields, runActions };
  return (
    <div className={`harness-panel ${mode}`}>
      <div
        className="visually-hidden"
        role="status"
        aria-label="Workflow validation status"
        aria-live="polite"
        aria-atomic="true"
      >
        {validationAnnouncement}
      </div>
      <div
        className="visually-hidden"
        role="status"
        aria-label="Workflow run status"
        aria-live="polite"
        aria-atomic="true"
      >
        {runAnnouncement}
      </div>
      {diagnostics.length > 0 && dismissedRecoveryNoticeId !== recoveryNoticeId && (
        <div className="harness-connect-hint harness-recovery-notice" role="alert">
          <div>
            <strong>Workflow state recovered from backup</strong>
            <ul>
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.source}:${diagnostic.detectedAt}:${index}`}>
                  {diagnostic.source}: {diagnostic.reason}
                </li>
              ))}
            </ul>
          </div>
          <button
            aria-label="Dismiss workflow recovery notice"
            title="Dismiss recovery notice"
            onClick={() => setDismissedRecoveryNoticeId(recoveryNoticeId)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {createName !== undefined ? (
        <form
          className="harness-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            autoFocus
            aria-label="Workflow name"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="New Workflow"
          />
          <select
            aria-label="Workflow template"
            value={createTemplate}
            onChange={(event) => {
              const template = event.target.value as typeof createTemplate;
              setCreateTemplate(template);
              if (template && createName === "New Workflow")
                setCreateName(
                  template === "git-review-commit" ? "Review, commit & ask to push" : "Five-minute workspace check-in",
                );
            }}
          >
            <option value="">Blank workflow</option>
            <option value="five-minute-check-in">Five-minute workspace check-in · all blocks</option>
            <option value="git-review-commit">Review, commit & ask to push · Git command blocks</option>
          </select>
          <button type="submit" disabled={!createName.trim()}>
            <Plus size={14} aria-hidden="true" /> Create
          </button>
          <button type="button" title="Cancel workflow creation" onClick={() => setCreateName(undefined)}>
            <X size={14} />
          </button>
        </form>
      ) : (
        <div className="harness-picker">
          <select
            aria-label="Selected workflow"
            value={selectedId ?? ""}
            onChange={(event) => {
              const nextId = event.target.value || undefined;
              if (nextId !== selectedId && discardDraft()) setSelectedId(nextId);
            }}
          >
            <option value="">Select a workflow</option>
            {harnesses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {onOpenWorkflow && (
            <button
              aria-label="Open workflow in editor tab"
              title={dirty ? "Save workflow changes before opening in a tab" : "Open workflow in editor tab"}
              disabled={!selected || dirty}
              onClick={() => {
                if (selected) onOpenWorkflow(selected);
              }}
            >
              <PanelTop size={14} aria-hidden="true" />
            </button>
          )}
          {mode === "edit" && (
            <>
              <button
                title="Create workflow"
                onClick={() => {
                  if (discardDraft()) setCreateName("New Workflow");
                }}
              >
                <Plus size={14} />
              </button>
              <button title="Delete workflow" disabled={!draft} onClick={() => void remove()}>
                <Trash2 size={14} />
              </button>
            </>
          )}
          {!designOnly && (
            <div className="harness-mode" role="group" aria-label="Workflow mode">
              <button
                className={mode === "view" ? "active" : ""}
                onClick={() => {
                  if (mode !== "view" && !discardDraft()) return;
                  setMode("view");
                  setConnectFrom(undefined);
                }}
              >
                <Eye size={14} aria-hidden="true" /> View
              </button>
              <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            </div>
          )}
          {mode === "edit" && (
            <div className="harness-mode" role="group" aria-label="Workflow editor surface">
              <button className={editorSurface === "canvas" ? "active" : ""} onClick={() => setEditorSurface("canvas")}>
                <LayoutGrid size={14} aria-hidden="true" /> Canvas
              </button>
              <button className={editorSurface === "list" ? "active" : ""} onClick={() => setEditorSurface("list")}>
                <List size={14} aria-hidden="true" /> List
              </button>
            </div>
          )}
        </div>
      )}
      {!draft ? (
        <div className="harness-empty">
          <Workflow size={32} aria-hidden="true" />
          <strong>Build an AI workflow</strong>
          <span>Add a start block, connect followers, and give AI Agents tools and paths.</span>
          <button onClick={() => setCreateName("New Workflow")}>
            <Plus size={14} /> Create workflow
          </button>
        </div>
      ) : (
        <>
          {mode === "edit" ? (
            <>
              <HarnessToolbar context={context} />
            </>
          ) : (
            <div className="harness-view-summary">
              <strong>{draft.name}</strong>
              {workflowRuns.length ? (
                <select
                  aria-label="Selected workflow run"
                  value={run?.id ?? ""}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                >
                  {workflowRuns.map((item) => (
                    <option key={item.id} value={item.id}>
                      {activeRunStatuses.has(item.status) ? "● " : ""}
                      {item.status} · {new Date(item.createdAt).toLocaleString()} · {item.input.slice(0, 50)}
                    </option>
                  ))}
                </select>
              ) : (
                <span>No runs yet</span>
              )}
              {run && selectedBlockId && run.definition?.blocks.some((item) => item.id === selectedBlockId) && (
                <button
                  aria-label="Rerun selected workflow block"
                  disabled={activeRunStatuses.has(run.status)}
                  onClick={() => void rerunSelected(selectedBlockId)}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Rerun from block
                </button>
              )}
              {run &&
                blockRun?.status === "failed" &&
                run.definition?.blocks.some((item) => item.id === blockRun.blockId) && (
                  <button
                    aria-label="Retry failed workflow block"
                    disabled={activeRunStatuses.has(run.status)}
                    onClick={() => void rerunSelected(blockRun.blockId)}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Retry failed block
                  </button>
                )}
              {run && (
                <button
                  aria-label="Export selected workflow run"
                  disabled={!!run.summary}
                  onClick={() => downloadWorkflowRun(run)}
                >
                  <Download size={14} aria-hidden="true" /> Export run
                </button>
              )}
              {run && (
                <button
                  aria-label="Delete selected workflow run"
                  disabled={activeRunStatuses.has(run.status) || !onDeleteRun}
                  onClick={() => void removeSelectedRun()}
                >
                  <Trash2 size={14} aria-hidden="true" /> Delete run
                </button>
              )}
              {workflowRuns.length > 1 && (
                <select
                  aria-label="Compare workflow run"
                  value={comparisonRun?.id ?? ""}
                  onChange={(event) => setCompareRunId(event.target.value || undefined)}
                >
                  <option value="">Compare with…</option>
                  {workflowRuns
                    .filter((item) => item.id !== run?.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.status} · {new Date(item.createdAt).toLocaleString()}
                      </option>
                    ))}
                </select>
              )}
              {activeRuns.length > 1 && <small>{activeRuns.length} active runs</small>}
            </div>
          )}
          {validationIssues.length > 0 && (
            <div className="harness-connect-hint" role="alert">
              <strong>
                {validationIssues.length} workflow issue{validationIssues.length === 1 ? "" : "s"}
              </strong>
              <ul>
                {validationIssues.map((issue, index) => (
                  <li key={`${issue.code}:${issue.blockId ?? issue.edgeId ?? index}`}>
                    <button
                      onClick={() => {
                        if (issue.blockId) {
                          setSelectedBlockId(issue.blockId);
                          setSelectedEdgeId(undefined);
                        } else if (issue.edgeId) {
                          setSelectedEdgeId(issue.edgeId);
                          setSelectedBlockId(undefined);
                        }
                      }}
                    >
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {saveConflict && (
            <div className="harness-conflict" role="alert">
              <strong>This workflow was changed elsewhere.</strong>
              <span>
                The saved version is {saveConflict.remote.version}; your draft is version {saveConflict.local.version}.
              </span>
              <div>
                <button
                  onClick={() => {
                    const next = structuredClone(saveConflict.remote);
                    resetDraft(next);
                    setBaseline(next);
                    setSaveConflict(undefined);
                  }}
                >
                  Reload
                </button>
                <button
                  onClick={() =>
                    setSaveConflict((current) => (current ? { ...current, comparing: !current.comparing } : current))
                  }
                >
                  {saveConflict.comparing ? "Hide comparison" : "Compare"}
                </button>
                <button onClick={() => void saveAsCopy()} disabled={saving}>
                  Save as copy
                </button>
              </div>
              {saveConflict.comparing && (
                <div className="harness-conflict-comparison">
                  <section>
                    <strong>Your draft</strong>
                    <pre>{JSON.stringify(saveConflict.local, null, 2)}</pre>
                  </section>
                  <section>
                    <strong>Saved workflow</strong>
                    <pre>{JSON.stringify(saveConflict.remote, null, 2)}</pre>
                  </section>
                </div>
              )}
            </div>
          )}
          {mode === "view" && run && <WorkflowTimeline run={run} blocks={draft.blocks} />}
          {mode === "view" && run && !run.summary && comparisonRun && !comparisonRun.summary && (
            <RunComparison selected={run} compared={comparisonRun} blocks={draft.blocks} />
          )}
          {mode === "edit" && editorSurface === "canvas" && connectFrom && (
            <div className="harness-connect-hint">
              Select an input port to connect from <strong>{blockById.get(connectFrom)?.label}</strong>.{" "}
              <select
                aria-label="New connection type"
                value={connectionType}
                onChange={(event) => setConnectionType(event.target.value as typeof connectionType)}
              >
                <option value="follow">Follow · pass output when done</option>
                {blockById.get(connectFrom)?.type === "ai" && (
                  <>
                    <option value="use">Use · expose as an MCP tool</option>
                    <option value="path">Path · AI chooses</option>
                  </>
                )}
              </select>{" "}
              <button onClick={() => setConnectFrom(undefined)}>Cancel</button>
            </div>
          )}
          <div
            className={`harness-workspace ${mode}${block || selectedEdge || workflowSettingsOpen ? " inspector-open" : ""}`}
          >
            <HarnessCanvasEditor context={context} />
            {mode === "edit" && <HarnessInspector context={context} />}
          </div>
          {block && mode === "view" && !run?.summary && (
            <BlockRunDetails
              providers={providers}
              defaultProvider={defaultProvider}
              onLoadModels={onLoadModels}
              key={`${run?.id}:${block.id}`}
              block={block}
              run={run}
              state={blockRun}
              tasks={run?.children?.filter((child) => child.blockId === block.id)}
              onClose={() => setSelectedBlockId(undefined)}
              onAutopilot={
                onAutopilot && run && blockRun?.sessionId
                  ? (enabled) => onAutopilot(run.id, block.id, blockRun.sessionId!, enabled).then(() => undefined)
                  : undefined
              }
              onChat={
                onChat && !dirty
                  ? async (message, settings) => {
                      const next = await onChat(draft.id, block.id, message, run?.id, settings);
                      setSelectedRunId(next.id);
                    }
                  : undefined
              }
              onCancelChat={run ? () => onCancelRun(run.id) : undefined}
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
              onReadApp={
                onReadApp && block.type === "run_app" ? () => onReadApp(draft.id, block.id, run?.id) : undefined
              }
              onKillApp={
                onKillApp && block.type === "run_app" ? () => onKillApp(draft.id, block.id, run?.id) : undefined
              }
              definition={draft}
            />
          )}
          {!designOnly && run && pausedBlock && (
            <PauseResolution
              run={run}
              block={pausedBlock}
              yesNo={blockById.get(pausedBlock.blockId)?.type === "yes_no_prompt"}
              label={blockById.get(pausedBlock.blockId)?.label ?? pausedBlock.blockId}
              onResolvePermission={onResolvePermission}
              onAnswerQuestion={onAnswerQuestion}
              onResumePause={onResumePause}
              onRetryPause={onRetryPause}
              onCancelPause={onCancelPause}
              onError={onError}
            />
          )}
          {!designOnly && !draft.blocks.some((item) => item.type === "start_button" || item.type === "start_input") && (
            <div className="harness-run">
              <textarea
                aria-label="Workflow input"
                rows={3}
                placeholder={
                  activeRuns.length
                    ? "Append another prompt to the active dispatcher…"
                    : "Describe the task for this workflow…"
                }
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              {runActions}
              <small className={run?.status === "failed" || run?.cleanupErrors?.length ? "error" : ""}>
                {dirty
                  ? "Save changes before running."
                  : validationIssues.length
                    ? "Fix validation issues before running."
                    : activeRuns.length
                      ? pausedBlock
                        ? `${pausedBlock.blockId} is waiting for your response.`
                        : "The dispatcher session is active. New prompts are appended without restarting it."
                      : run
                        ? `Last run: ${run.status}`
                        : "Use Autopilot in block settings to run without tool permission prompts."}
              </small>
              {run?.error && <WorkflowError message={run.error} />}
              {!!run?.cleanupErrors?.length && (
                <WorkflowError message={run.cleanupErrors.join("; ")} label="Cleanup error" />
              )}
            </div>
          )}
          {!designOnly && draft.blocks.some((item) => item.type === "start_button" || item.type === "start_input") && (
            <div className="harness-run">
              {runActions}
              <small>
                {dirty
                  ? "Save changes before starting."
                  : run
                    ? `Run: ${run.status}`
                    : "Switch to View to start a flow from its start blocks."}
              </small>
              {run?.error && <WorkflowError message={run.error} />}
              {!!run?.cleanupErrors?.length && (
                <WorkflowError message={run.cleanupErrors.join("; ")} label="Cleanup error" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
