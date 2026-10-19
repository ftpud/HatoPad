import type { UsefulFile, UsefulFileScope } from "../types/configuration.js";

export type UsefulOperations = {
  "useful.list": { payload: Record<string, never>; result: { files: UsefulFile[] } };
  "useful.read": {
    payload: { scope: UsefulFileScope; name: string; maxBytes?: number };
    result: { content: string; truncated?: boolean };
  };
  "useful.create": { payload: { scope: UsefulFileScope; name: string }; result: Record<string, never> };
  "useful.write": { payload: { scope: UsefulFileScope; name: string; content: string }; result: Record<string, never> };
  "useful.rename": {
    payload: { scope: UsefulFileScope; name: string; newName: string };
    result: Record<string, never>;
  };
  "useful.delete": { payload: { scope: UsefulFileScope; name: string }; result: Record<string, never> };
};
