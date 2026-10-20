import { writeSetting } from "./settings";
import { type LayoutModel } from "./model";

export interface UsePanelActionsDeps {
  setLeftSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  setRightSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  setClassicLeftWidth: React.Dispatch<React.SetStateAction<number>>;
  setClassicRightWidth: React.Dispatch<React.SetStateAction<number>>;
  setClassicSplit: React.Dispatch<React.SetStateAction<number>>;
  setSideLayout: React.Dispatch<React.SetStateAction<"classic" | "ai-focused">>;
  layout: LayoutModel;
  setLayout: React.Dispatch<React.SetStateAction<LayoutModel>>;
  checkJava: () => Promise<void>;
}

export function usePanelActions(deps: UsePanelActionsDeps) {
  const {
    setLeftSidebarWidth,
    setRightSidebarWidth,
    setClassicLeftWidth,
    setClassicRightWidth,
    setClassicSplit,
    setSideLayout,
    layout,
    setLayout,
    checkJava,
  } = deps;

  const beginLeftSidebarResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setLeftSidebarWidth(Math.max(280, Math.min(Math.min(900, window.innerWidth * 0.65), moveEvent.clientX - 30)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginRightSidebarResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setRightSidebarWidth(
        Math.max(180, Math.min(Math.min(700, window.innerWidth * 0.55), window.innerWidth - moveEvent.clientX - 30)),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicLeftResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setClassicLeftWidth(Math.max(180, Math.min(500, moveEvent.clientX - 30)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicRightResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setClassicRightWidth(
        Math.max(240, Math.min(Math.min(960, window.innerWidth * 0.72), window.innerWidth - moveEvent.clientX - 30)),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const beginClassicSplitResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) =>
      setClassicSplit(Math.max(20, Math.min(80, ((moveEvent.clientY - bounds.top) / bounds.height) * 100)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const changeSideLayout = (value: "classic" | "ai-focused") => {
    setSideLayout(value);
    writeSetting("sideLayout", value);
  };

  const toggleJavaPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "languageOutput");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "languageOutput")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "languageOutput", type: "languageOutput" },
          ],
    }));
  };

  const toggleProblemsPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "problems");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "problems")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "problems", type: "problems" },
          ],
    }));
    if (!visible) void checkJava();
  };

  const toggleGitLogPanel = () => {
    const visible = layout.panels.some((panel) => panel.type === "gitlog");
    setLayout((current) => ({
      ...current,
      panels: visible
        ? current.panels.filter((panel) => panel.type !== "gitlog")
        : [
            ...current.panels.filter(
              (panel) => !["terminal", "languageOutput", "problems", "gitlog"].includes(panel.type),
            ),
            { id: "gitlog", type: "gitlog" },
          ],
    }));
  };
  return {
    beginLeftSidebarResize,
    beginRightSidebarResize,
    beginClassicLeftResize,
    beginClassicRightResize,
    beginClassicSplitResize,
    changeSideLayout,
    toggleJavaPanel,
    toggleProblemsPanel,
    toggleGitLogPanel,
  };
}
