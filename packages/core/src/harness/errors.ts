export class Cancelled extends Error {}

export class RunDurationExceeded extends Error {
  constructor(duration: number) {
    super(`Workflow run duration of ${Math.round(duration / 60_000)} minute(s) was exceeded`);
  }
}

export class BlockedCorrection extends Error {}
