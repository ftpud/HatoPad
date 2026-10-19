import type { WorkspaceRootId } from "../types/workspace.js";
import type { SupervisionEvent } from "../types/events.js";
import type { OverviewWorkPage, OverviewRoot, AttentionItem, ActivityItem } from "../types/supervision.js";

export type OverviewOperations = {
  /** Read-only, root-agnostic attention summary: never selects a root/task or restores a session. Page with `nextCursor`; a cursor from an older `revision` restarts at the first page (`restarted`). */
  "overview.events": {
    payload: { limit?: number; cursor?: string; rootId?: WorkspaceRootId };
    result: {
      events: SupervisionEvent[];
      startedAt: string;
      truncated: boolean;
      nextCursor?: string;
      restarted?: boolean;
    };
  };
  "overview.work": { payload: { limit?: number; cursor?: string; rootId?: WorkspaceRootId }; result: OverviewWorkPage };
  "overview.summary": {
    payload: { limit?: number; cursor?: string };
    result: {
      revision: string;
      roots: OverviewRoot[];
      items: AttentionItem[];
      /** Newest conversations (max `overviewLimits.maxActivity`), included in every page and in `revision`. */ activity: ActivityItem[];
      nextCursor?: string;
      restarted?: boolean;
      /** True when more than `overviewLimits.maxRoots` roots or `maxTasksPerRoot` tasks per root existed. */ truncated: boolean;
      /** With `client.presence`: whether an interactive client window reported being visible within `presenceLeaseMs`. */ presence?: {
        active: boolean;
      };
    };
  };
};
