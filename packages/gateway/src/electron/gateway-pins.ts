export type GatewayPins = { connections: string[]; workspaces: string[] };
export function readGatewayPins(value: unknown): GatewayPins {
  const record = value && typeof value === "object" ? (value as Partial<GatewayPins>) : {};
  const ids = (items: unknown) =>
    Array.isArray(items)
      ? [
          ...new Set(
            items.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 2000),
          ),
        ].slice(0, 2000)
      : [];
  return { connections: ids(record.connections), workspaces: ids(record.workspaces) };
}
export function updateGatewayPins(value: unknown, kind: unknown, id: unknown, pinned: unknown): GatewayPins {
  if (
    (kind !== "connection" && kind !== "workspace") ||
    typeof id !== "string" ||
    !id ||
    id.length > 2000 ||
    typeof pinned !== "boolean"
  )
    throw Error("Invalid pin selection");
  const pins = readGatewayPins(value);
  const collection = kind === "connection" ? "connections" : "workspaces";
  const next = pins[collection].filter((item) => item !== id);
  if (pinned) next.push(id);
  if (next.length > 2000) throw Error("Too many pinned items. Unpin an item first.");
  return { ...pins, [collection]: next };
}
