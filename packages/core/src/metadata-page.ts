import { CoreError } from "./errors.js";
/** Leave room for the response envelope and aggregates under the relay's 1 MiB frame limit. */
export function metadataPage<T>(
  rows: T[],
  offset: number,
  limit: number,
  budget = 600_000,
): { rows: T[]; nextOffset?: number } {
  const page: T[] = [];
  let bytes = 2;
  for (const row of rows.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes + size > budget) {
      if (!page.length)
        throw new CoreError("INVALID_REQUEST", "This metadata item exceeds its byte budget; inspect it in Desktop");
      break;
    }
    page.push(row);
    bytes += size;
  }
  return { rows: page, ...(offset + page.length < rows.length ? { nextOffset: offset + page.length } : {}) };
}
