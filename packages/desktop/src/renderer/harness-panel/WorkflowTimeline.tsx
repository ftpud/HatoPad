import { useEffect, useState } from "react";
import type { HarnessBlock, HarnessRun } from "@hatopad/protocol";

export function WorkflowTimeline({ run, blocks }: { run: HarnessRun; blocks: HarnessBlock[] }) {
  const [page, setPage] = useState(0);
  const labels = new Map(blocks.map((block) => [block.id, block.label]));
  const entries = [
    ...(run.operations ?? []).map((operation) => ({
      timestamp: operation.updatedAt,
      kind: operation.kind.replaceAll("_", " "),
      message: `${operation.blockId ? `${labels.get(operation.blockId) ?? operation.blockId} · ` : ""}${operation.status}${operation.error ? ` · ${operation.error}` : ""}`,
    })),
    ...run.blocks.flatMap((state) =>
      (state.log ?? []).map((entry) => ({
        ...entry,
        message: `${labels.get(state.blockId) ?? state.blockId} · ${entry.message}`,
      })),
    ),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  useEffect(() => setPage(0), [run.id]);
  if (!entries.length) return null;
  const pageSize = 50;
  const lastPage = Math.ceil(entries.length / pageSize) - 1;
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const visibleEntries = entries.slice(start, start + pageSize);
  return (
    <details className="harness-execution-log" aria-label="Workflow execution timeline">
      <summary>Execution timeline ({entries.length})</summary>
      <div className="harness-execution-log-entries">
        {visibleEntries.map((entry, index) => (
          <details key={`${entry.timestamp}-${start + index}`} className="harness-log-entry">
            <summary>
              <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
              <span>{entry.kind}</span>
            </summary>
            <pre>{entry.message}</pre>
          </details>
        ))}
      </div>
      {entries.length > pageSize && (
        <div className="harness-timeline-pagination">
          <span>
            Showing {start + 1}–{start + visibleEntries.length} of {entries.length}
          </span>
          <button
            aria-label="Previous timeline events"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            aria-label="Next timeline events"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </details>
  );
}

export function RunComparison({
  selected,
  compared,
  blocks,
}: {
  selected: HarnessRun;
  compared: HarnessRun;
  blocks: HarnessBlock[];
}) {
  const labels = new Map(blocks.map((block) => [block.id, block.label]));
  const selectedStates = new Map(selected.blocks.map((state) => [state.blockId, state]));
  const comparedStates = new Map(compared.blocks.map((state) => [state.blockId, state]));
  const blockIds = [...new Set([...selectedStates.keys(), ...comparedStates.keys()])];
  const total = (run: HarnessRun) => run.blocks.reduce((sum, state) => sum + (state.tokens?.total ?? 0), 0);
  return (
    <section className="harness-execution-log" aria-label="Workflow run comparison">
      <strong>Run comparison</strong>
      <p className="harness-detail-empty">
        {selected.id} ({selected.status}, {total(selected).toLocaleString()} tokens) compared with {compared.id} (
        {compared.status}, {total(compared).toLocaleString()} tokens)
      </p>
      {blockIds.map((id) => {
        const current = selectedStates.get(id);
        const previous = comparedStates.get(id);
        const changed = current?.status !== previous?.status || current?.tokens?.total !== previous?.tokens?.total;
        return (
          <div key={id} className={changed ? "harness-log error" : "harness-log"}>
            <strong>{labels.get(id) ?? id}</strong>
            <pre>
              {selected.id}: {current?.status ?? "not run"}
              {current?.tokens ? ` · ${current.tokens.total.toLocaleString()} tokens` : ""}
              {"\n"}
              {compared.id}: {previous?.status ?? "not run"}
              {previous?.tokens ? ` · ${previous.tokens.total.toLocaleString()} tokens` : ""}
            </pre>
          </div>
        );
      })}
    </section>
  );
}
