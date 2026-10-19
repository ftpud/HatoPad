export type ClientOperations = {
  /** An interactive client reports whether its window is visible. Feeds `overview.summary` presence; never persisted. */
  "client.presence": { payload: { visible: boolean }; result: Record<string, never> };
};
