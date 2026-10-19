import type { HarnessFeature, HarnessReviewFinding } from "@hatopad/protocol";
import { HarnessSchemaError } from "../harness-graph.js";

export function parseReviewReport(output: string, reviewBlockId: string, expectedRevision: string, defaultOwner: string): { revision: string; findings: HarnessReviewFinding[] } {
  let value: unknown;
  try { value = JSON.parse(output); }
  catch { throw new HarnessSchemaError(`Review '${reviewBlockId}' must return JSON: {"revision":"${expectedRevision}","findings":[{"id":"...","message":"..."}]}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessSchemaError(`Review '${reviewBlockId}' must return an object with revision and findings`);
  const report = value as Record<string, unknown>;
  if (report.revision !== expectedRevision) throw new HarnessSchemaError(`Review '${reviewBlockId}' findings must be bound to the exact reviewed revision '${expectedRevision}'`);
  if (!Array.isArray(report.findings)) throw new HarnessSchemaError(`Review '${reviewBlockId}' must return a findings array`);
  const ids = new Set<string>(); const findings: HarnessReviewFinding[] = report.findings.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new HarnessSchemaError(`Review finding ${index + 1} must be an object`);
    const finding = item as Record<string, unknown>; const id = finding.id; const message = finding.message; const ownerBlockId = finding.ownerBlockId ?? defaultOwner;
    if (typeof id !== "string" || !id.trim() || ids.has(id) || typeof message !== "string" || !message.trim() || typeof ownerBlockId !== "string" || !ownerBlockId.trim()) throw new HarnessSchemaError(`Review finding ${index + 1} needs a unique id, message, and owner block ID`);
    ids.add(id); return { id, message, ownerBlockId, revision: expectedRevision };
  });
  if (findings.some((finding) => finding.ownerBlockId !== defaultOwner)) throw new HarnessSchemaError(`Review '${reviewBlockId}' returned a finding for an owner outside its configured correction block`);
  return { revision: expectedRevision, findings };
}

export function parseCorrectionRevision(output: string): string {
  let value: unknown;
  try { value = JSON.parse(output); }
  catch { throw new HarnessSchemaError("Correction response must be JSON: {\"revision\":\"<new exact commit SHA>\"}"); }
  const revision = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).revision : undefined;
  if (typeof revision !== "string" || !/^[0-9a-f]{7,64}$/i.test(revision)) throw new HarnessSchemaError("Correction response must name a new exact commit SHA");
  return revision;
}

export function validFeature(feature: { id: string; prompt: string; prerequisites?: string[] }): boolean {
  return typeof feature.id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(feature.id) && typeof feature.prompt === "string" && Boolean(feature.prompt.trim()) && Array.isArray(feature.prerequisites ?? []) && (feature.prerequisites ?? []).every((dependency) => typeof dependency === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(dependency));
}

export function hasFeatureCycle(features: Array<{ id: string; prerequisites?: string[] }>): boolean {
  const byId = new Map(features.map((feature) => [feature.id, feature])); const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const cycle = (byId.get(id)?.prerequisites ?? []).some(visit); visiting.delete(id); visited.add(id); return cycle; };
  return features.some((feature) => visit(feature.id));
}

export function readyFeatures(features: HarnessFeature[]): HarnessFeature[] {
  return features.filter((feature) => feature.status === "planned" && feature.prerequisites.every((dependency) => features.find((item) => item.id === dependency)?.status === "completed")).map((feature) => structuredClone(feature));
}
