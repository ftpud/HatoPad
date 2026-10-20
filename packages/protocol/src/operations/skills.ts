import type { SkillCatalog, SkillPolicy } from "../types/configuration.js";

export type SkillsOperations = {
  "skills.list": { payload: Record<string, never>; result: SkillCatalog };
  "skills.read": { payload: { id: string; path?: string }; result: { content: string } };
  "skills.write": { payload: { id: string; content: string }; result: Record<string, never> };
  "skills.delete": { payload: { id: string }; result: Record<string, never> };
  "skills.policy": { payload: SkillPolicy; result: Record<string, never> };
  "skills.policy.moveToLocal": { payload: Record<string, never>; result: Record<string, never> };
};
