import type { ErrorCode } from "@hatopad/protocol";

export class CoreError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}
