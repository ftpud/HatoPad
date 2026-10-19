import type { HttpResponse } from "../types/http.js";

export type HttpOperations = {
  "http.execute": { payload: { method: string; url: string; headers: Record<string, string>; body?: string }; result: HttpResponse };
};
