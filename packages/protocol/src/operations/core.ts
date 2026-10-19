import type { CoreUpdateStatus } from "../types/transport.js";

export type CoreOperations = {
  "core.update.check": { payload: { branch: 'dev' | 'main' }; result: CoreUpdateStatus };
  "core.update.apply": { payload: { branch: 'dev' | 'main'; expectedCurrent: string; expectedLatest: string }; result: { accepted: true } };
};
