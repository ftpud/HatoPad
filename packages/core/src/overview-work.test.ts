import { expect, it } from 'vitest';
import { workPage, workText, type WorkTarget } from './overview-work.js';
const target = (rootId: string, taskId?: string): WorkTarget => ({ rootId, rootAlias: 'Project', ...(taskId ? { taskId } : {}), name: taskId ?? 'Project', status: taskId ? 'active' : 'root', archived: false, workspace: `/private/${rootId}/${taskId ?? ''}` });
it('pages stable root/task inventory without leaking workspace paths and restarts changed cursors', () => {
  const targets = [target('a'), target('a', 'one'), target('b')];
  const first = workPage(targets, { limit: 1 }, false); expect(first.targets).toEqual([targets[0]]);
  expect(first.result).toMatchObject({ totalTargets: 3, nextCursor: expect.any(String), truncated: false });
  expect(JSON.stringify(first.result)).not.toContain('/private');
  expect(workPage(targets, { cursor: first.result.nextCursor, limit: 1 }, false).targets).toEqual([targets[1]]);
  const changed = workPage([...targets, target('b', 'two')], { cursor: first.result.nextCursor, limit: 1 }, false);
  expect(changed.result.restarted).toBe(true); expect(changed.targets).toEqual([targets[0]]);
  expect(workPage(targets, { rootId: 'b' }, true).result).toMatchObject({ totalTargets: 1, truncated: true });
});
it('rejects malformed pages and clips activity into a bounded single line', () => {
  for (const request of [{ limit: 0 }, { limit: 26 }, { cursor: 'bad' }, { rootId: 3 }]) expect(() => workPage([target('a')], request, false)).toThrow();
  expect(() => workPage([target('a')], { rootId: 'foreign' }, false)).toThrow('unavailable');
  expect(workText(' x\n\t y ')).toBe('x y'); expect(workText('a'.repeat(1000))).toHaveLength(180);
});

it("distinguishes trigger delivery errors from a proven hourly cap", async () => { const { triggerIssueKind } = await import("./overview-work.js"); expect(triggerIssueKind("Cannot watch this path")).toBe("trigger-error"); expect(triggerIssueKind("Disabled: fired 10 times within an hour (limit 10). Check for a feedback loop, then resume.")).toBe("trigger-capped"); expect(triggerIssueKind(undefined, "Task busy")).toBe("trigger-busy"); });
