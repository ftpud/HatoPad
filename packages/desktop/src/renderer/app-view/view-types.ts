import type { AppViewModel } from "../use-app-orchestration";
import type { createAppViewParts } from "./AppViewParts";

export type AppViewContext = AppViewModel & ReturnType<typeof createAppViewParts>;
