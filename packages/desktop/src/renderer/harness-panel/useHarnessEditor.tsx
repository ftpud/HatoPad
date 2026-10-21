import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { AiModel, HarnessBlock, HarnessDefinition, HarnessValidationIssue } from "@hatopad/protocol";
import { useWorkflowTraces } from "../workflow-tracing";
import type { HarnessPanelProps, MinimapCorner } from "./types";
import {
  BLOCK_WIDTH,
  BLOCK_HEIGHT,
  fitCanvasViewport,
  autoLayoutBlocks,
  alignBlocks,
  dragPosition,
  minimapScrollPosition,
  minimapViewport,
} from "./geometry";
import type { WorkflowBlockAlignment } from "./geometry";
import { activeRunStatuses, availabilityIssues, parseWorkflowDefinitionImport } from "./definition";
import { flowBlockTypes, blockTypeLabels } from "./block-catalog";
import { nextBlockCopyLabel, workflowBlockClipboardPayload, parseWorkflowBlockClipboard } from "./clipboard";

export function useHarnessEditor({
  onOpenWorkflow,
  designOnly = false,
  harnesses,
  runs,
  diagnostics = [],
  providers,
  agents,
  mcpServers = [],
  skillCatalog,
  onRefreshSkills,
  defaultProvider,
  onLoadModels,
  onValidate,
  onCreate,
  onRead,
  onReadRun,
  onSave,
  onDelete,
  onRun,
  onTestBlock,
  onOpenAppTerminal,
  onAutopilot,
  onSteerChat,
  onKillApp,
  onReadApp,
  onChat,
  onAppendRun,
  onResolvePermission,
  onAnswerQuestion,
  onResumePause,
  onRetryPause,
  onCancelPause,
  onCancelRun,
  onDeleteRun,
  onError,
}: HarnessPanelProps) {
  useEffect(() => {
    if (onRefreshSkills) void onRefreshSkills().catch((error) => onError(String(error)));
  }, [onRefreshSkills]);
  const arrowMarkerId = `harness-arrow-${useId().replace(/:/g, "")}`;
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraftState] = useState<HarnessDefinition>();
  const [baseline, setBaseline] = useState<HarnessDefinition>();
  const [undoStack, setUndoStack] = useState<HarnessDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<HarnessDefinition[]>([]);
  const setDraft = useCallback(
    (next: SetStateAction<HarnessDefinition | undefined>) => {
      const value =
        typeof next === "function"
          ? (next as (current: HarnessDefinition | undefined) => HarnessDefinition | undefined)(draft)
          : next;
      if (JSON.stringify(value) === JSON.stringify(draft)) return;
      if (draft) setUndoStack((current) => [...current.slice(-49), structuredClone(draft)]);
      setRedoStack([]);
      setDraftState(value);
    },
    [draft],
  );
  const resetDraft = useCallback((next: HarnessDefinition | undefined) => {
    setDraftState(next);
    setUndoStack([]);
    setRedoStack([]);
  }, []);
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!draft || !previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-49), structuredClone(draft)]);
    setDraftState(structuredClone(previous));
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!draft || !next) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-49), structuredClone(draft)]);
    setDraftState(structuredClone(next));
  };
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [copiedBlock, setCopiedBlock] = useState<HarnessBlock>();
  const [connectFrom, setConnectFrom] = useState<string>();
  const [connectionType, setConnectionType] = useState<"use" | "follow" | "path">("follow");
  const [startInputs, setStartInputs] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [testingBlockId, setTestingBlockId] = useState<string>();
  const [testInput, setTestInput] = useState("Test input");
  const [testRunId, setTestRunId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<"" | "five-minute-check-in" | "git-review-commit">("");
  const [createName, setCreateName] = useState<string>();
  const [mode, setMode] = useState<"view" | "edit">(designOnly ? "edit" : "view");
  const [editorSurface, setEditorSurface] = useState<"canvas" | "list">("canvas");
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [compareRunId, setCompareRunId] = useState<string>();
  const [listConnectionTarget, setListConnectionTarget] = useState("");
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, AiModel[]>>({});
  const [remoteValidationIssues, setRemoteValidationIssues] = useState<HarnessValidationIssue[]>([]);
  const [saveConflict, setSaveConflict] = useState<{
    local: HarnessDefinition;
    remote: HarnessDefinition;
    comparing: boolean;
  }>();
  const recoveryNoticeId = JSON.stringify(diagnostics);
  const [dismissedRecoveryNoticeId, setDismissedRecoveryNoticeId] = useState<string>();
  const [validationAnnouncement, setValidationAnnouncement] = useState("");
  const [runAnnouncement, setRunAnnouncement] = useState("");
  const [minimapVisible, setMinimapVisible] = useState(true);
  /** Opens the inspector on workflow settings when nothing is selected (always shown when the panel is wide). */
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [minimapCorner, setMinimapCorner] = useState<MinimapCorner>("bottom-right");
  const [minimapPosition, setMinimapPosition] = useState<{ left: number; top: number }>();
  const minimapDrag = useRef<{ grabX: number; grabY: number }>();
  const canvasPan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number }>();
  const [canvasPanning, setCanvasPanning] = useState(false);
  const spacePan = useRef(false);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pendingScroll = useRef<{ left: number; top: number }>();
  const [canvasViewport, setCanvasViewport] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const updateCanvasViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas)
      setCanvasViewport({
        left: canvas.scrollLeft,
        top: canvas.scrollTop,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
  }, []);
  const changeZoom = useCallback((requested: number, clientX?: number, clientY?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = Math.max(0.25, Math.min(2, requested));
    if (next === zoomRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const x = clientX === undefined ? canvas.clientWidth / 2 : clientX - bounds.left - canvas.clientLeft;
    const y = clientY === undefined ? canvas.clientHeight / 2 : clientY - bounds.top - canvas.clientTop;
    const ratio = next / zoomRef.current;
    pendingScroll.current = {
      left: ((pendingScroll.current?.left ?? canvas.scrollLeft) + x) * ratio - x,
      top: ((pendingScroll.current?.top ?? canvas.scrollTop) + y) * ratio - y,
    };
    zoomRef.current = next;
    setZoom(next);
  }, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && pendingScroll.current) {
      canvas.scrollLeft = pendingScroll.current.left;
      canvas.scrollTop = pendingScroll.current.top;
      pendingScroll.current = undefined;
    }
    updateCanvasViewport();
  }, [draft?.id, editorSurface, mode, updateCanvasViewport, zoom]);
  const drag = useRef<{
    id: string;
    ids: string[];
    positions: Map<string, HarnessBlock["position"]>;
    grabX: number;
    grabY: number;
  }>();
  const ignoreNextBlockClick = useRef(false);
  const selected = harnesses.find((item) => item.id === selectedId);
  useEffect(() => {
    if (!selectedId && harnesses[0]) setSelectedId(harnesses[0].id);
  }, [harnesses, selectedId]);
  useEffect(() => {
    const next = selected ? structuredClone(selected) : undefined;
    resetDraft(next);
    setBaseline(next);
    setSelectedBlockId(undefined);
    setSelectedBlockIds([]);
    setSelectedEdgeId(undefined);
    setListConnectionTarget("");
    setCompareRunId(undefined);
    setSaveConflict(undefined);
  }, [selected?.id, selected?.version]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.shiftKey) return;
      // Shift can remap vertical wheel motion to deltaX on Windows.
      const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);
      event.preventDefault();
      if (!delta) return;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      changeZoom(
        zoomRef.current * Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [Boolean(draft), editorSurface, mode, changeZoom]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))
      )
        return;
      spacePan.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePan.current = false;
    };
    const onBlur = () => {
      spacePan.current = false;
      canvasPan.current = undefined;
      setCanvasPanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(updateCanvasViewport);
    observer.observe(canvas);
    updateCanvasViewport();
    window.addEventListener("resize", updateCanvasViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateCanvasViewport);
    };
  }, [Boolean(draft), editorSurface, mode, updateCanvasViewport]);
  const canvasWidth = Math.max(1200, ...(draft?.blocks.map((block) => block.position.x + BLOCK_WIDTH + 80) ?? []));
  const canvasHeight = Math.max(800, ...(draft?.blocks.map((block) => block.position.y + BLOCK_HEIGHT + 80) ?? []));
  const fitCanvasToBlocks = useCallback(
    (axis?: "horizontal" | "vertical") => {
      const canvas = canvasRef.current;
      if (!canvas || !draft?.blocks.length) return;
      const next = fitCanvasViewport(draft.blocks, canvas.clientWidth, canvas.clientHeight, 48, axis);
      const zoomChanged = next.zoom !== zoomRef.current;
      pendingScroll.current = zoomChanged ? { left: next.scrollLeft, top: next.scrollTop } : undefined;
      zoomRef.current = next.zoom;
      setZoom(next.zoom);
      // Changing only the scroll position does not cause a render, so apply it now too.
      canvas.scrollLeft = next.scrollLeft;
      canvas.scrollTop = next.scrollTop;
    },
    [draft?.blocks],
  );
  const autoLayout = () => {
    if (!draft || mode !== "edit") return;
    setDraft({ ...draft, blocks: autoLayoutBlocks(draft.blocks, draft.edges) });
    setSelectedEdgeId(undefined);
  };
  const alignSelectedBlocks = (alignment: WorkflowBlockAlignment) => {
    if (!draft || selectedBlockIds.length < 2) return;
    setDraft({ ...draft, blocks: alignBlocks(draft.blocks, selectedBlockIds, alignment) });
  };
  const block = draft?.blocks.find((item) => item.id === selectedBlockId);
  const blockProvider =
    block && ["ai", "chatbox", "task_controls", "prompt", "task", "review"].includes(block.type)
      ? (block.provider ?? defaultProvider)
      : undefined;
  const blockModels = blockProvider ? (modelsByProvider[blockProvider] ?? []) : [];
  const selectedBlockModel = blockModels.find((model) => model.id === block?.model);
  useEffect(() => {
    if (!blockProvider || modelsByProvider[blockProvider] || !onLoadModels) return;
    let active = true;
    void onLoadModels(blockProvider)
      .then((models) => {
        if (active) setModelsByProvider((current) => ({ ...current, [blockProvider]: models }));
      })
      .catch((error) => {
        if (active) onError(error instanceof Error ? error.message : "Could not load models");
      });
    return () => {
      active = false;
    };
  }, [blockProvider, modelsByProvider, onError, onLoadModels]);
  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const activeRuns = runs.filter((item) => item.harnessId === selectedId && activeRunStatuses.has(item.status));
  const workflowRuns = runs
    .filter((item) => item.harnessId === selectedId)
    .sort(
      (left, right) =>
        Number(activeRunStatuses.has(right.status)) - Number(activeRunStatuses.has(left.status)) ||
        right.createdAt.localeCompare(left.createdAt),
    );
  const run = workflowRuns.find((item) => item.id === selectedRunId) ?? workflowRuns[0];
  useEffect(() => {
    if (!run?.summary || !onReadRun || (mode !== "view" && !testRunId)) return;
    let active = true;
    void onReadRun(run.id).catch((error) => {
      if (active) onError(error instanceof Error ? error.message : "Could not load run details");
    });
    return () => {
      active = false;
    };
  }, [run?.id, run?.summary, onReadRun, mode, testRunId, onError]);
  const comparisonRun = workflowRuns.find((item) => item.id === compareRunId && item.id !== run?.id);
  useEffect(() => {
    if (!comparisonRun?.summary || !onReadRun) return;
    let active = true;
    void onReadRun(comparisonRun.id).catch((error) => {
      if (active) onError(String(error));
    });
    return () => {
      active = false;
    };
  }, [comparisonRun?.id, comparisonRun?.summary, onReadRun, onError]);
  useEffect(() => {
    if (selectedRunId && !workflowRuns.some((item) => item.id === selectedRunId)) setSelectedRunId(undefined);
  }, [selectedRunId, workflowRuns]);
  const animatedTraces = useWorkflowTraces(designOnly ? undefined : run);
  const blockRun = run?.blocks.find((item) => item.blockId === selectedBlockId);
  const pausedBlock = run?.blocks.find((item) =>
    ["awaiting_permission", "awaiting_user_input", "waiting_timer", "retry_scheduled"].includes(item.status),
  );
  const blockById = useMemo(() => new Map(draft?.blocks.map((item) => [item.id, item]) ?? []), [draft?.blocks]);
  const selectedEdge = draft?.edges.find((edge) => edge.id === selectedEdgeId);
  useEffect(() => {
    if (!draft || !onValidate) {
      setRemoteValidationIssues([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void onValidate(draft)
        .then((result) => {
          if (active) setRemoteValidationIssues(result.issues);
        })
        .catch((error) => {
          if (active) onError(error instanceof Error ? error.message : "Could not validate workflow");
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, onError, onValidate]);
  const validationIssues = useMemo(
    () => [
      ...remoteValidationIssues,
      ...availabilityIssues(draft, providers, agents, defaultProvider, modelsByProvider, skillCatalog),
    ],
    [skillCatalog, agents, defaultProvider, draft, modelsByProvider, providers, remoteValidationIssues],
  );
  const validationAnnouncementKey = validationIssues
    .map((issue) => `${issue.code}:${issue.blockId ?? issue.edgeId ?? "workflow"}`)
    .join("|");
  useEffect(() => {
    if (!draft) return;
    setValidationAnnouncement(
      validationIssues.length
        ? `${validationIssues.length} workflow validation issue${validationIssues.length === 1 ? "" : "s"}. ${validationIssues[0]?.message ?? ""}`
        : "Workflow validation has no issues.",
    );
  }, [draft?.id, validationAnnouncementKey]);
  useEffect(() => {
    if (run) setRunAnnouncement(`Workflow run ${run.id} is ${run.status.replaceAll("_", " ")}.`);
  }, [run?.id, run?.status]);
  useEffect(() => {
    const warnBeforeClosing = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClosing);
    return () => window.removeEventListener("beforeunload", warnBeforeClosing);
  }, [dirty]);
  useEffect(() => {
    if (mode !== "edit" || !selectedEdgeId) return;
    const removeSelectedEdge = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (
        target &&
        "matches" in target &&
        typeof target.matches === "function" &&
        target.matches("input, textarea, select, [contenteditable=true]")
      )
        return;
      event.preventDefault();
      setDraft((current) =>
        current ? { ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdgeId) } : current,
      );
      setSelectedEdgeId(undefined);
    };
    window.addEventListener("keydown", removeSelectedEdge);
    return () => window.removeEventListener("keydown", removeSelectedEdge);
  }, [mode, selectedEdgeId]);

  const create = async () => {
    const name = createName?.trim();
    if (!name) return;
    try {
      const harness = createTemplate ? await onCreate(name, createTemplate) : await onCreate(name);
      setSelectedId(harness.id);
      setCreateName(undefined);
      setCreateTemplate("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create workflow");
    }
  };
  const discardDraft = () =>
    !dirty || typeof window.confirm !== "function" || window.confirm("Discard unsaved workflow changes?");
  const validateCurrentDraft = async () => {
    if (!draft || !onValidate) return true;
    const result = await onValidate(draft);
    setRemoteValidationIssues(result.issues);
    return result.valid;
  };
  const testBlock = async (item: HarnessBlock) => {
    if (!draft || !onTestBlock || testingBlockId) return;
    setTestingBlockId(item.id);
    try {
      const next = await onTestBlock(draft, item.id, testInput);
      setSelectedRunId(next.id);
      setTestRunId(next.id);
      setSelectedBlockId(item.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not test block");
    } finally {
      setTestingBlockId(undefined);
    }
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (!(await validateCurrentDraft())) return;
      const harness = await onSave(draft);
      const next = structuredClone(harness);
      setSelectedId(harness.id);
      resetDraft(next);
      setBaseline(next);
    } catch (error) {
      if (draft && error instanceof Error && error.message.startsWith("CONFLICT:") && onRead) {
        try {
          setSaveConflict({ local: structuredClone(draft), remote: await onRead(draft.id), comparing: false });
        } catch (readError) {
          onError(readError instanceof Error ? readError.message : "Could not load the changed workflow");
        }
      } else onError(error instanceof Error ? error.message : "Could not save workflow");
    } finally {
      setSaving(false);
    }
  };
  const saveAsCopy = async () => {
    if (!saveConflict) return;
    setSaving(true);
    try {
      const copy = await onCreate(`${saveConflict.local.name} copy`);
      const saved = await onSave({
        ...saveConflict.local,
        id: copy.id,
        name: copy.name,
        version: copy.version,
        createdAt: copy.createdAt,
        updatedAt: copy.updatedAt,
      });
      const next = structuredClone(saved);
      setSelectedId(saved.id);
      resetDraft(next);
      setBaseline(next);
      setSaveConflict(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save workflow copy");
    } finally {
      setSaving(false);
    }
  };
  const rerunSelected = async (startBlockId?: string) => {
    if (!run?.definition) return;
    try {
      const next = await onRun(run.harnessId, run.input, startBlockId, run.id);
      setSelectedRunId(next.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not rerun workflow");
    }
  };
  const removeSelectedRun = async () => {
    if (
      !run ||
      activeRunStatuses.has(run.status) ||
      !onDeleteRun ||
      !window.confirm(`Delete completed run ${run.id} from retained history?`)
    )
      return;
    try {
      await onDeleteRun(run.id);
      setSelectedRunId(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete workflow run");
    }
  };
  const importWorkflow = async (file?: File) => {
    if (!file) return;
    setSaving(true);
    try {
      const imported = parseWorkflowDefinitionImport(await file.text());
      const copy = await onCreate(`${imported.name} import`);
      const saved = await onSave({
        ...imported,
        id: copy.id,
        name: copy.name,
        version: copy.version,
        createdAt: copy.createdAt,
        updatedAt: copy.updatedAt,
      });
      const next = structuredClone(saved);
      setSelectedId(saved.id);
      resetDraft(next);
      setBaseline(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not import workflow");
    } finally {
      setSaving(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const duplicate = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const copy = await onCreate(`${draft.name} copy`);
      const saved = await onSave({
        ...draft,
        id: copy.id,
        name: copy.name,
        version: copy.version,
        createdAt: copy.createdAt,
        updatedAt: copy.updatedAt,
      });
      const next = structuredClone(saved);
      setSelectedId(saved.id);
      resetDraft(next);
      setBaseline(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not duplicate workflow");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!draft || !window.confirm(`Delete workflow ${draft.name}?`)) return;
    try {
      await onDelete(draft.id);
      setSelectedId(undefined);
      resetDraft(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete workflow");
    }
  };
  const start = async (startBlock?: HarnessBlock) => {
    const value =
      startBlock?.type === "start_button" ? startBlock.prompt : startBlock ? (startInputs[startBlock.id] ?? "") : input;
    if (!draft || dirty || !value.trim()) return;
    try {
      if (!(await validateCurrentDraft())) return;
      if (
        !startBlock &&
        !draft.blocks.some((block) => flowBlockTypes.includes(block.type)) &&
        activeRuns[0] &&
        onAppendRun
      )
        await onAppendRun(activeRuns[0].id, value);
      else {
        const nextRun = await onRun(draft.id, value, startBlock?.id);
        setSelectedRunId(nextRun.id);
      }
      setInput("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send workflow input");
    }
  };
  const updateBlock = (changes: Partial<HarnessBlock>) => {
    if (draft && block)
      setDraft({
        ...draft,
        blocks: draft.blocks.map((item) => (item.id === block.id ? { ...item, ...changes } : item)),
      });
  };
  const addBlock = (type: HarnessBlock["type"] = "ai") => {
    if (!draft) return;
    const id = crypto.randomUUID();
    const next: HarnessBlock = {
      id,
      type,
      label: `${blockTypeLabels[type] ?? type} ${draft.blocks.length + 1}`,
      prompt:
        type === "start_button"
          ? "Start the workflow."
          : type === "task_controls" ||
              type === "terminal_control" ||
              type === "meeting" ||
              type === "skill" ||
              type === "mcp" ||
              type === "start_input" ||
              type === "timer" ||
              type === "script" ||
              type === "run_app" ||
              type === "chatbox"
            ? ""
            : "{{input}}",
      ...(type === "timer" ? { seconds: 60 } : {}),
      ...(type === "run_app" ? { app: { actions: ["start" as const], name: "app" } } : {}),
      position: { x: 32 + (draft.blocks.length % 3) * 220, y: 30 + Math.floor(draft.blocks.length / 3) * 170 },
    };
    setDraft({ ...draft, blocks: [...draft.blocks, next] });
    setSelectedBlockId(id);
    setSelectedBlockIds([id]);
    if (type === "mcp") setTestInput('{"action":"list"}');
    if (type === "terminal_control") setTestInput('{"action":"list"}');
    if (type === "task_controls") setTestInput('{"action":"status"}');
  };
  const duplicateBlock = () => {
    if (!draft || !block || mode !== "edit") return;
    const id = crypto.randomUUID();
    const next: HarnessBlock = {
      ...structuredClone(block),
      id,
      label: nextBlockCopyLabel(block.label, draft.blocks),
      position: { x: block.position.x + 32, y: block.position.y + 32 },
    };
    setDraft({ ...draft, blocks: [...draft.blocks, next] });
    setSelectedBlockId(id);
    setSelectedBlockIds([id]);
    setSelectedEdgeId(undefined);
  };
  const copyBlock = async () => {
    if (!block) return;
    const copied = structuredClone(block);
    setCopiedBlock(copied);
    try {
      await navigator.clipboard?.writeText(workflowBlockClipboardPayload(copied));
    } catch {
      /* Keep the in-editor copy when clipboard access is unavailable. */
    }
  };
  const pasteBlock = async () => {
    if (!draft) return;
    let source = copiedBlock;
    try {
      const text = await navigator.clipboard?.readText();
      if (text) source = parseWorkflowBlockClipboard(text) ?? source;
    } catch {
      /* Fall back to the in-editor copy. */
    }
    if (!source) {
      onError("Copy a workflow block before pasting");
      return;
    }
    const id = crypto.randomUUID();
    const next: HarnessBlock = {
      ...structuredClone(source),
      id,
      label: nextBlockCopyLabel(source.label, draft.blocks),
      position: { x: source.position.x + 32, y: source.position.y + 32 },
    };
    setDraft({ ...draft, blocks: [...draft.blocks, next] });
    setSelectedBlockId(id);
    setSelectedBlockIds([id]);
    setSelectedEdgeId(undefined);
  };
  const removeBlock = (id: string) => {
    if (!draft || mode !== "edit") return;
    setDraft({
      ...draft,
      blocks: draft.blocks.filter((item) => item.id !== id),
      edges: draft.edges.filter((edge) => edge.from !== id && edge.to !== id),
    });
    setSelectedBlockId((current) => (current === id ? undefined : current));
    setSelectedBlockIds((current) => current.filter((selected) => selected !== id));
    setConnectFrom((current) => (current === id ? undefined : current));
  };
  const removeEdge = (id: string) => {
    if (!draft || mode !== "edit") return;
    setDraft({ ...draft, edges: draft.edges.filter((edge) => edge.id !== id) });
    setSelectedEdgeId(undefined);
  };
  const connectTo = (id: string) => {
    if (!draft || mode !== "edit") return;
    if (!connectFrom || connectFrom === id) return;
    if (
      draft.edges.some(
        (edge) => edge.from === connectFrom && edge.to === id && (edge.type ?? "follow") === connectionType,
      )
    )
      onError("These blocks are already connected");
    else {
      setDraft({
        ...draft,
        edges: [
          ...draft.edges,
          {
            id: crypto.randomUUID(),
            from: connectFrom,
            to: id,
            type: connectionType,
            label: draft.blocks.find((item) => item.id === id)?.label ?? "Next",
          },
        ],
      });
    }

    setConnectFrom(undefined);
  };
  const beginConnection = (id: string) => {
    setConnectionType("follow");
    setConnectFrom((current) => (current === id ? undefined : id));
  };
  const keyboardActivate = (event: ReactKeyboardEvent<HTMLButtonElement>, action: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  const selectBlock = (id: string, extend = false) => {
    const next = extend
      ? selectedBlockIds.includes(id)
        ? selectedBlockIds.filter((selected) => selected !== id)
        : [...selectedBlockIds, id]
      : [id];
    setSelectedBlockIds(next);
    setSelectedBlockId(next.includes(id) ? id : next.at(-1));
    setSelectedEdgeId(undefined);
    return next;
  };
  const pointerDown = (event: ReactPointerEvent, item: HarnessBlock) => {
    if (mode !== "edit" || event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const bounds = target.getBoundingClientRect();
    const ids = selectBlock(item.id, event.ctrlKey || event.metaKey);
    ignoreNextBlockClick.current = true;
    drag.current = {
      id: item.id,
      ids,
      positions: new Map(
        draft?.blocks.filter((block) => ids.includes(block.id)).map((block) => [block.id, block.position]),
      ),
      grabX: (event.clientX - bounds.left) / zoom,
      grabY: (event.clientY - bounds.top) / zoom,
    };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || mode !== "edit" || !drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const item = drag.current;
    const position = dragPosition(
      event.clientX,
      event.clientY,
      bounds.left + event.currentTarget.clientLeft,
      bounds.top + event.currentTarget.clientTop,
      event.currentTarget.scrollLeft,
      event.currentTarget.scrollTop,
      item.grabX,
      item.grabY,
      zoom,
    );
    const origin = item.positions.get(item.id)!;
    const delta = { x: position.x - origin.x, y: position.y - origin.y };
    setDraft({
      ...draft,
      blocks: draft.blocks.map((block) => {
        const start = item.positions.get(block.id);
        return start
          ? { ...block, position: { x: Math.max(8, start.x + delta.x), y: Math.max(8, start.y + delta.y) } }
          : block;
      }),
    });
  };
  const moveViewportFromMinimap = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.detail === 0 ? bounds.width / 2 : event.clientX - bounds.left;
    const y = event.detail === 0 ? bounds.height / 2 : event.clientY - bounds.top;
    const next = minimapScrollPosition(
      x,
      y,
      bounds.width,
      bounds.height,
      canvasWidth,
      canvasHeight,
      zoom,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    canvas.scrollLeft = next.left;
    canvas.scrollTop = next.top;
    updateCanvasViewport();
  };
  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !(event.button === 0 && spacePan.current)) return;
    if (canvasPan.current) return;
    event.stopPropagation();
    drag.current = undefined;
    event.preventDefault();
    canvasPan.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCanvasPanning(true);
  };
  const moveCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = canvasPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
    event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
    updateCanvasViewport();
  };
  const endCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (canvasPan.current?.pointerId !== event.pointerId) return;
    canvasPan.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setCanvasPanning(false);
  };
  const minimap = minimapViewport(canvasWidth, canvasHeight, zoom, canvasViewport);
  const showMinimap = minimapVisible && (draft?.blocks.length ?? 0) > 0;
  const dragMinimap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const frame = canvasFrameRef.current;
    if (!frame || !minimapDrag.current) return;
    const bounds = frame.getBoundingClientRect();
    const map = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
    setMinimapPosition({
      left: Math.max(
        10,
        Math.min(bounds.width - map.width - 10, event.clientX - bounds.left - minimapDrag.current.grabX),
      ),
      top: Math.max(
        10,
        Math.min(bounds.height - map.height - 10, event.clientY - bounds.top - minimapDrag.current.grabY),
      ),
    });
  };
  const dockMinimap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!minimapDrag.current) return;
    const bounds = canvasFrameRef.current!.getBoundingClientRect();
    setMinimapCorner(
      `${event.clientY < bounds.top + bounds.height / 2 ? "top" : "bottom"}-${event.clientX < bounds.left + bounds.width / 2 ? "left" : "right"}`,
    );
    minimapDrag.current = undefined;
    setMinimapPosition(undefined);
  };

  // Selecting something replaces workflow settings in the inspector.
  useEffect(() => {
    if (selectedBlockId || selectedEdgeId) setWorkflowSettingsOpen(false);
  }, [selectedBlockId, selectedEdgeId]);
  const setSetting = (patch: Partial<NonNullable<typeof draft>["settings"]>) => {
    if (draft) setDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  };
  return {
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
    onChat,
    pausedBlock,
    setInput,
  };
}

export type HarnessEditorModel = ReturnType<typeof useHarnessEditor>;
