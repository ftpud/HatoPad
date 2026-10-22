import { chooseSelect } from "./select-test-helpers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleInput } from "@hatopad/protocol";
import { ScheduleForm } from "./ScheduleForm";

afterEach(cleanup);
const tasks = [
  { id: "task-a", name: "Selected task", status: "active" },
  { id: "task-b", name: "Another task", status: "active" },
] as never;
const providers = [{ id: "codex", name: "Codex" }] as never;
const workflows = [{ id: "workflow-a", name: "Release workflow" }] as never;

function setup() {
  const onCreate = vi.fn(async (_input: ScheduleInput) => undefined);
  const onCancel = vi.fn();
  const onLoadAgents = vi.fn(
    async (taskId?: string) =>
      [{ scope: "workspace", name: `${taskId}-reviewer.md`, agent: { name: `Reviewer ${taskId}` } }] as never,
  );
  render(
    <ScheduleForm
      tasks={tasks}
      workflows={workflows}
      providers={providers}
      selectedTaskId="task-a"
      defaultProvider="codex"
      onLoadAgents={onLoadAgents}
      onLoadModels={async () => []}
      onCreate={onCreate}
      onCancel={onCancel}
    />,
  );
  return { onCreate, onCancel, onLoadAgents };
}

describe("schedule creation", () => {
  it("creates a recurring prompt with the selected task's agent and an ISO time", async () => {
    const { onCreate, onCancel, onLoadAgents } = setup();
    chooseSelect(screen.getByLabelText("Session"), "new");
    await waitFor(() => expect(screen.getByLabelText("Agent preset")).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByLabelText("Agent preset"));
    await screen.findByRole("option", { name: "Reviewer task-a (workspace)" });
    fireEvent.keyDown(screen.getByLabelText("Agent preset"), { key: "Escape" });
    expect(onLoadAgents).toHaveBeenCalledWith("task-a");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Review daily" } });
    chooseSelect(screen.getByLabelText("Agent preset"), "workspace:task-a-reviewer.md");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Review changes" } });
    chooseSelect(screen.getByLabelText("Schedule"), "repeat");
    chooseSelect(screen.getByLabelText("Interval unit"), "86400");
    fireEvent.submit(screen.getByRole("form", { name: "New schedule" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Review daily",
        taskId: "task-a",
        intervalSeconds: 86400,
        dueAt: expect.stringMatching(/Z$/),
        action: {
          type: "prompt",
          provider: "codex",
          prompt: "Review changes",
          newSession: true,
          agent: { scope: "workspace", name: "task-a-reviewer.md" },
        },
      }),
    );
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it("loads presets for a changed target and creates a one-time workflow", async () => {
    const { onCreate, onLoadAgents } = setup();
    chooseSelect(screen.getByLabelText("Session"), "new");
    await waitFor(() => expect(screen.getByLabelText("Agent preset")).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByLabelText("Agent preset"));
    await screen.findByRole("option", { name: "Reviewer task-a (workspace)" });
    fireEvent.keyDown(screen.getByLabelText("Agent preset"), { key: "Escape" });
    chooseSelect(screen.getByLabelText("Target task"), "task-b");
    await waitFor(() => expect(screen.getByLabelText("Agent preset")).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByLabelText("Agent preset"));
    await screen.findByRole("option", { name: "Reviewer task-b (workspace)" });
    expect(onLoadAgents).toHaveBeenLastCalledWith("task-b");
    expect(screen.queryByRole("option", { name: "Reviewer task-a (workspace)" })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Agent preset"), { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Release" } });
    chooseSelect(screen.getByLabelText("Action"), "workflow");
    fireEvent.change(screen.getByLabelText("Workflow input"), { target: { value: "Prepare release" } });
    fireEvent.submit(screen.getByRole("form", { name: "New schedule" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-b",
        action: { type: "workflow", provider: "codex", harnessId: "workflow-a", input: "Prepare release" },
      }),
    );
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("intervalSeconds");
  });
  it("lets a workflow with multiple starts choose its entry block", async () => {
    const onCreate = vi.fn(async (_input: ScheduleInput) => undefined);
    render(
      <ScheduleForm
        tasks={tasks}
        workflows={
          [
            {
              id: "multi",
              name: "Multi-start",
              blocks: [
                { id: "check", type: "start_button", label: "Check" },
                { id: "release", type: "start_input", label: "Release" },
              ],
            },
          ] as never
        }
        providers={providers}
        defaultProvider="codex"
        onLoadAgents={async () => []}
        onLoadModels={async () => []}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Release schedule" } });
    chooseSelect(screen.getByLabelText("Action"), "workflow");
    chooseSelect(screen.getByLabelText("Start block"), "release");
    fireEvent.change(screen.getByLabelText("Workflow input"), { target: { value: "Release v1" } });
    fireEvent.submit(screen.getByRole("form", { name: "New schedule" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: {
            type: "workflow",
            provider: "codex",
            harnessId: "multi",
            input: "Release v1",
            startBlockId: "release",
          },
        }),
      ),
    );
  });
});
