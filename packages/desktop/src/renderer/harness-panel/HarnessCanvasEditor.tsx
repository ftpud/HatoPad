import {
  ArrowLeftRight,
  ArrowUpDown,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  GripHorizontal,
  Map as MapIcon,
  Maximize,
  Play,
  Plus,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { transferDashStyle } from "../workflow-tracing";
import { responsePreview } from "./definition";
import { blockTypeLabels } from "./block-catalog";
import type { MinimapCorner } from "./types";
import { edgeGeometry, BLOCK_WIDTH, BLOCK_HEIGHT } from "./geometry";
import { WorkflowBlockIcon } from "./WorkflowBlockIcon";
import type { HarnessViewContext } from "./view-types";

export function HarnessCanvasEditor({ context }: { context: HarnessViewContext }) {
  const {
    draft,
    mode,
    run,
    dirty,
    validationIssues,
    input,
    start,
    designOnly,
    setConnectFrom,
    editorSurface,
    addBlock,
    block,
    setSelectedBlockId,
    setSelectedBlockIds,
    setSelectedEdgeId,
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
  } = context;
  if (!draft) return null;
  return (
    <div className="harness-workspace-main">
      {(mode === "view" || editorSurface === "canvas") && (
        <>
          <div className="harness-zoom" role="group" aria-label="Workflow zoom">
            <button aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => changeZoom(zoomRef.current / 1.2)}>
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <button aria-label="Reset workflow zoom" title="Reset zoom to 100%" onClick={() => changeZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button aria-label="Zoom in" disabled={zoom >= 2} onClick={() => changeZoom(zoomRef.current * 1.2)}>
              <ZoomIn size={15} aria-hidden="true" />
            </button>
            <button
              aria-label="Fit workflow to canvas"
              title="Fit all blocks in the canvas"
              disabled={!draft.blocks.length}
              onClick={() => fitCanvasToBlocks()}
            >
              <Maximize size={14} aria-hidden="true" /> Fit
            </button>
            <button
              aria-label="Fit workflow horizontally"
              title="Fit horizontally"
              disabled={!draft.blocks.length}
              onClick={() => fitCanvasToBlocks("horizontal")}
            >
              <ArrowLeftRight size={14} aria-hidden="true" />
            </button>
            <button
              aria-label="Fit workflow vertically"
              title="Fit vertically"
              disabled={!draft.blocks.length}
              onClick={() => fitCanvasToBlocks("vertical")}
            >
              <ArrowUpDown size={14} aria-hidden="true" />
            </button>
            {mode === "edit" && (
              <button
                aria-label="Automatically lay out workflow"
                title="Arrange blocks by workflow connections"
                disabled={draft.blocks.length < 2}
                onClick={autoLayout}
              >
                <Workflow size={14} aria-hidden="true" /> Layout
              </button>
            )}
            {mode === "edit" && selectedBlockIds.length > 1 && (
              <span className="harness-alignment" role="group" aria-label="Align selected workflow blocks">
                <button
                  aria-label="Align selected blocks left"
                  title="Align left"
                  onClick={() => alignSelectedBlocks("left")}
                >
                  <AlignStartVertical size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Align selected blocks center"
                  title="Align horizontal centers"
                  onClick={() => alignSelectedBlocks("center")}
                >
                  <AlignCenterVertical size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Align selected blocks right"
                  title="Align right"
                  onClick={() => alignSelectedBlocks("right")}
                >
                  <AlignEndVertical size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Align selected blocks top"
                  title="Align top"
                  onClick={() => alignSelectedBlocks("top")}
                >
                  <AlignStartHorizontal size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Align selected blocks middle"
                  title="Align vertical centers"
                  onClick={() => alignSelectedBlocks("middle")}
                >
                  <AlignCenterHorizontal size={15} aria-hidden="true" />
                </button>
                <button
                  aria-label="Align selected blocks bottom"
                  title="Align bottom"
                  onClick={() => alignSelectedBlocks("bottom")}
                >
                  <AlignEndHorizontal size={15} aria-hidden="true" />
                </button>
              </span>
            )}
            {mode === "edit" && selectedBlockIds.length > 0 && (
              <button
                aria-label="Clear selected workflow blocks"
                title="Clear block selection"
                onClick={() => {
                  setSelectedBlockIds([]);
                  setSelectedBlockId(undefined);
                }}
              >
                <X size={14} aria-hidden="true" /> Clear selection
              </button>
            )}
            <button
              aria-label={minimapVisible ? "Hide workflow minimap" : "Show workflow minimap"}
              title={minimapVisible ? "Hide minimap" : "Show minimap"}
              aria-pressed={minimapVisible}
              onClick={() => setMinimapVisible((visible) => !visible)}
            >
              <MapIcon size={15} aria-hidden="true" />
            </button>
            {minimapVisible && (
              <select
                className="harness-minimap-corner"
                aria-label="Workflow minimap corner"
                value={minimapCorner}
                onChange={(event) => {
                  setMinimapCorner(event.target.value as MinimapCorner);
                  setMinimapPosition(undefined);
                }}
              >
                <option value="bottom-right">Map: bottom right</option>
                <option value="bottom-left">Map: bottom left</option>
                <option value="top-right">Map: top right</option>
                <option value="top-left">Map: top left</option>
              </select>
            )}
          </div>
          <div ref={canvasFrameRef} className="harness-canvas-frame">
            <small className="harness-canvas-hint" aria-hidden="true">
              Middle-drag or Space+drag to pan · Pinch or Shift+scroll to zoom
            </small>
            <div
              ref={canvasRef}
              aria-label="Workflow canvas"
              className={`harness-canvas ${mode}${canvasPanning ? " panning" : ""}`}
              onScroll={updateCanvasViewport}
              onPointerDownCapture={beginCanvasPan}
              onLostPointerCapture={endCanvasPan}
              onAuxClick={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedEdgeId(undefined);
                  setSelectedBlockId(undefined);
                  setSelectedBlockIds([]);
                }
              }}
              onPointerMove={(event) => {
                moveCanvasPan(event);
                if (!canvasPan.current) pointerMove(event);
              }}
              onPointerUp={(event) => {
                endCanvasPan(event);
                drag.current = undefined;
              }}
              onPointerCancel={(event) => {
                endCanvasPan(event);
                drag.current = undefined;
              }}
            >
              <div className="harness-canvas-extent" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
                <div
                  className="harness-canvas-content"
                  style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}
                >
                  <svg aria-label="Workflow connections" style={{ width: canvasWidth, height: canvasHeight }}>
                    <defs>
                      <marker
                        id={arrowMarkerId}
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 8 4 L 0 8 z" />
                      </marker>
                    </defs>
                    {draft.edges.map((edge) => {
                      const from = blockById.get(edge.from);
                      const to = blockById.get(edge.to);
                      if (!from || !to) return null;
                      const lane =
                        draft.edges
                          .filter((item) => item.from === edge.from && item.to === edge.to)
                          .findIndex((item) => item.id === edge.id) * 16;
                      const { path, label } = edgeGeometry(from, to, edge.loop, lane);
                      const title = edge.loop ? `${from.label} loops to ${to.label}` : `${from.label} then ${to.label}`;
                      const traces = animatedTraces.filter((trace) => trace.edgeId === edge.id);
                      return (
                        <g key={edge.id}>
                          <path
                            className={`harness-edge ${edge.type ?? "follow"}${edge.loop ? " loop" : ""}${selectedEdgeId === edge.id ? " selected" : ""}`}
                            d={path}
                            markerEnd={`url(#${arrowMarkerId})`}
                            role={mode === "edit" ? "button" : undefined}
                            aria-label={mode === "edit" ? `Select connection: ${title}` : undefined}
                            tabIndex={mode === "edit" ? 0 : undefined}
                            onClick={
                              mode === "edit"
                                ? (event) => {
                                    event.stopPropagation();
                                    setSelectedEdgeId(edge.id);
                                    setSelectedBlockId(undefined);
                                    setSelectedBlockIds([]);
                                  }
                                : undefined
                            }
                          >
                            <title>{title}</title>
                          </path>
                          {traces.map((trace) => (
                            <path
                              key={trace.id}
                              className={`harness-transfer ${edge.type ?? "follow"} ${trace.direction} ${trace.status}`}
                              d={path}
                              pathLength={100}
                              style={transferDashStyle(trace, trace.delayMs)}
                              aria-label={`${trace.direction === "return" ? "Output" : "Input"}: ${trace.direction === "return" ? to.label : from.label} → ${trace.direction === "return" ? from.label : to.label}`}
                            />
                          ))}
                          {edge.label && (
                            <text
                              className="harness-edge-label"
                              x={label.x}
                              y={label.y}
                              textAnchor="middle"
                            >{`${edge.type ?? "follow"}${edge.type === "path" ? `: ${edge.label}` : ""}`}</text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                  {draft.blocks.map((item) => {
                    const state = designOnly ? undefined : run?.blocks.find((block) => block.blockId === item.id);
                    const preview = responsePreview(state?.output, state?.status);
                    const inputActive = animatedTraces.some((trace) => {
                      const edge = draft.edges.find((edge) => edge.id === trace.edgeId);
                      return trace.direction === "return" ? edge?.from === item.id : edge?.to === item.id;
                    });
                    const outputActive = animatedTraces.some((trace) => {
                      const edge = draft.edges.find((edge) => edge.id === trace.edgeId);
                      return trace.direction === "return" ? edge?.to === item.id : edge?.from === item.id;
                    });
                    return (
                      <div
                        key={item.id}
                        className={`harness-block ${state?.status === "running" ? "working" : ""} ${selectedBlockIds.includes(item.id) ? "selected" : ""} ${connectFrom === item.id ? "connecting" : ""}`}
                        style={{ left: item.position.x, top: item.position.y }}
                        onPointerDown={(event) => pointerDown(event, item)}
                        onClick={(event) => {
                          if (mode === "view") {
                            setSelectedBlockId(item.id);
                            setSelectedBlockIds([item.id]);
                            return;
                          }
                          if (ignoreNextBlockClick.current) {
                            ignoreNextBlockClick.current = false;
                            return;
                          }
                          selectBlock(item.id, event.ctrlKey || event.metaKey);
                        }}
                      >
                        <button
                          className={`harness-port input${inputActive ? " flowing" : ""}`}
                          tabIndex={mode === "view" ? -1 : 0}
                          aria-label={`Connect into ${item.label}`}
                          aria-keyshortcuts="Enter Space"
                          title="Input: connect selected block here"
                          disabled={!connectFrom || connectFrom === item.id}
                          onPointerDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => keyboardActivate(event, () => connectTo(item.id))}
                          onClick={(event) => {
                            event.stopPropagation();
                            connectTo(item.id);
                          }}
                        />
                        <button
                          className={`harness-port output${outputActive ? " flowing" : ""}`}
                          disabled={mode === "view"}
                          tabIndex={mode === "view" ? -1 : 0}
                          aria-label={`Connect from ${item.label}`}
                          aria-keyshortcuts="Enter Space"
                          title={connectFrom === item.id ? "Cancel connection" : "Output: start connection"}
                          onPointerDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => keyboardActivate(event, () => beginConnection(item.id))}
                          onClick={(event) => {
                            event.stopPropagation();
                            beginConnection(item.id);
                          }}
                        />
                        <header>
                          <WorkflowBlockIcon type={item.type} />
                          <span className={`harness-status ${state?.status ?? "idle"}`} />
                          {item.label}
                        </header>
                        <small>
                          {state?.status === "running" && state.iterations?.length
                            ? `Stack item ${state.iterations.length} of ${state.plannedRuns ?? state.iterations.length}`
                            : state?.status === "running"
                              ? "Running…"
                              : (state?.error ??
                                (["ai", "chatbox"].includes(item.type) ||
                                ["prompt", "task", "review"].includes(item.type)
                                  ? (item.model ?? item.provider ?? "Default model")
                                  : (blockTypeLabels[item.type] ?? item.type)))}
                        </small>
                        {mode === "view" && (item.type === "start_button" || item.type === "start_input") ? (
                          <div
                            className="harness-start"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {item.type === "start_input" && (
                              <input
                                aria-label={`Input for ${item.label}`}
                                placeholder="Type text…"
                                value={startInputs[item.id] ?? ""}
                                onChange={(event) =>
                                  setStartInputs((current) => ({ ...current, [item.id]: event.target.value }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void start(item);
                                }}
                              />
                            )}
                            <button
                              disabled={
                                dirty ||
                                validationIssues.length > 0 ||
                                !(item.type === "start_button" ? item.prompt : startInputs[item.id])?.trim()
                              }
                              onClick={() => void start(item)}
                            >
                              <Play size={12} /> Start
                            </button>
                          </div>
                        ) : (
                          <div
                            className={`harness-response-preview ${state?.output ? "available" : ""}`}
                            title={state?.output}
                            aria-label={`${item.label} response preview`}
                          >
                            {preview}
                          </div>
                        )}
                        <footer>
                          {mode === "edit" && onTestBlock && (
                            <button
                              className="harness-block-test"
                              aria-label={`Test ${item.label}`}
                              disabled={!!testingBlockId}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                void testBlock(item);
                              }}
                            >
                              <Play size={12} /> Test
                            </button>
                          )}
                          <button
                            title="Delete block"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeBlock(item.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </footer>
                      </div>
                    );
                  })}
                  {!draft.blocks.length && (
                    <button className="harness-canvas-empty" onClick={() => addBlock()}>
                      <Plus size={16} /> Add the first AI Agent
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showMinimap && (
              <div
                className={`harness-minimap-dock ${minimapCorner}`}
                style={minimapPosition ? { ...minimapPosition, right: "auto", bottom: "auto" } : undefined}
              >
                <header>
                  <button
                    className="harness-minimap-handle"
                    aria-label="Move workflow minimap"
                    title="Drag to dock the minimap in another corner"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const bounds = event.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
                      minimapDrag.current = {
                        grabX: event.clientX - bounds.left,
                        grabY: event.clientY - bounds.top,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={dragMinimap}
                    onPointerUp={dockMinimap}
                    onPointerCancel={() => {
                      minimapDrag.current = undefined;
                      setMinimapPosition(undefined);
                    }}
                  >
                    <GripHorizontal size={14} aria-hidden="true" />
                    <span>Overview</span>
                  </button>
                  <button
                    aria-label="Hide workflow minimap"
                    title="Hide minimap"
                    onClick={() => setMinimapVisible(false)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </header>
                <button
                  className="harness-minimap"
                  aria-label="Workflow minimap"
                  title="Click to move the workflow viewport"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    moveViewportFromMinimap(event);
                  }}
                >
                  {draft.blocks.map((block) => (
                    <span
                      key={block.id}
                      className="harness-minimap-block"
                      style={{
                        left: `${(block.position.x / canvasWidth) * 100}%`,
                        top: `${(block.position.y / canvasHeight) * 100}%`,
                        width: `${(BLOCK_WIDTH / canvasWidth) * 100}%`,
                        height: `${(BLOCK_HEIGHT / canvasHeight) * 100}%`,
                      }}
                    />
                  ))}
                  <span
                    className="harness-minimap-viewport"
                    style={{
                      left: `${minimap.left}%`,
                      top: `${minimap.top}%`,
                      width: `${minimap.width}%`,
                      height: `${minimap.height}%`,
                    }}
                  />
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {mode === "edit" && editorSurface === "list" && (
        <section className="harness-list-editor" aria-label="Workflow list editor">
          <ol>
            {draft.blocks.map((item, index) => (
              <li key={item.id} className={selectedBlockIds.includes(item.id) ? "selected" : ""}>
                <button
                  aria-label={`Edit block ${item.label}`}
                  aria-pressed={selectedBlockIds.includes(item.id)}
                  onClick={() => {
                    setSelectedBlockId(item.id);
                    setSelectedBlockIds([item.id]);
                    setSelectedEdgeId(undefined);
                  }}
                >
                  <strong>
                    <WorkflowBlockIcon type={item.type} />
                    {index + 1}. {item.label}
                  </strong>
                  <small>{blockTypeLabels[item.type] ?? item.type}</small>
                </button>
                <button
                  aria-label={`Test ${item.label}`}
                  disabled={!onTestBlock || !!testingBlockId}
                  onClick={() => void testBlock(item)}
                >
                  Test
                </button>
                <button aria-label={`Remove block ${item.label}`} onClick={() => removeBlock(item.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {draft.blocks.length > 1 && (
            <section className="harness-list-connections" aria-label="Workflow list connections">
              <strong>Connections</strong>
              <div>
                <label>
                  From
                  <select
                    aria-label="List connection source"
                    value={connectFrom ?? ""}
                    onChange={(event) => {
                      setConnectFrom(event.target.value || undefined);
                      setConnectionType("follow");
                    }}
                  >
                    <option value="">Choose a block</option>
                    {draft.blocks.map((block) => (
                      <option key={block.id} value={block.id}>
                        {block.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select
                    aria-label="List connection target"
                    value={listConnectionTarget}
                    onChange={(event) => setListConnectionTarget(event.target.value)}
                  >
                    <option value="">Choose a block</option>
                    {draft.blocks
                      .filter((block) => block.id !== connectFrom)
                      .map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Type
                  <select
                    aria-label="List connection type"
                    value={connectionType}
                    onChange={(event) => setConnectionType(event.target.value as typeof connectionType)}
                  >
                    <option value="follow">Follow</option>
                    {["ai", "chatbox"].includes(blockById.get(connectFrom ?? "")?.type ?? "") && (
                      <>
                        <option value="use">Use</option>
                        <option value="path">Path</option>
                      </>
                    )}
                  </select>
                </label>
                <button
                  disabled={!connectFrom || !listConnectionTarget}
                  onClick={() => {
                    connectTo(listConnectionTarget);
                    setListConnectionTarget("");
                  }}
                >
                  <Plus size={14} aria-hidden="true" /> Add connection
                </button>
              </div>
              {draft.edges.length ? (
                <ul>
                  {draft.edges.map((edge) => (
                    <li key={edge.id}>
                      <button
                        aria-label={`Edit connection ${blockById.get(edge.from)?.label ?? edge.from} then ${blockById.get(edge.to)?.label ?? edge.to}`}
                        onClick={() => {
                          setSelectedEdgeId(edge.id);
                          setSelectedBlockId(undefined);
                          setSelectedBlockIds([]);
                        }}
                      >
                        {blockById.get(edge.from)?.label ?? edge.from} → {blockById.get(edge.to)?.label ?? edge.to} ·{" "}
                        {edge.type ?? "follow"}
                      </button>
                      <button aria-label={`Remove connection ${edge.id}`} onClick={() => removeEdge(edge.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <small>No connections yet.</small>
              )}
            </section>
          )}
        </section>
      )}
    </div>
  );
}
