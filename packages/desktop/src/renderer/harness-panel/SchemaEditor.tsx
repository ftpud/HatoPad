import { useEffect, useState } from "react";
import type { HarnessDataSchema } from "@hatopad/protocol";

export function SchemaEditor({
  title,
  schema,
  onChange,
}: {
  title: string;
  schema?: HarnessDataSchema;
  onChange(schema?: HarnessDataSchema): void;
}) {
  const serialized = schema ? JSON.stringify(schema, null, 2) : "";
  const [value, setValue] = useState(serialized);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setValue(serialized);
    setError(undefined);
  }, [serialized]);
  const update = (next: string) => {
    setValue(next);
    if (!next.trim()) {
      setError(undefined);
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      if (!isDataSchema(parsed)) throw new Error("Use a schema object with a supported type");
      setError(undefined);
      onChange(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid JSON schema");
    }
  };
  return (
    <label>
      {" "}
      {title}
      <textarea
        aria-label={title}
        rows={5}
        value={value}
        placeholder={'{"type":"object","required":["featureId"],"properties":{"featureId":{"type":"string"}}}'}
        onChange={(event) => update(event.target.value)}
      />
      {error && <small className="error">{error}</small>}
    </label>
  );
}

export function isDataSchema(value: unknown, depth = 0): value is HarnessDataSchema {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 10) return false;
  const schema = value as Record<string, unknown>;
  if (!["string", "number", "boolean", "object", "array"].includes(String(schema.type))) return false;
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || !schema.required.every((key) => typeof key === "string" && key.length > 0))
  )
    return false;
  if (
    schema.properties !== undefined &&
    (!schema.properties ||
      typeof schema.properties !== "object" ||
      Array.isArray(schema.properties) ||
      !Object.values(schema.properties).every((property) => isDataSchema(property, depth + 1)))
  )
    return false;
  return schema.items === undefined || isDataSchema(schema.items, depth + 1);
}
