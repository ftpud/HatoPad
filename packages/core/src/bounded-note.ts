import { CoreError } from './errors.js';
export function boundedNote(content: string, maxBytes: unknown) {
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128_000) throw new CoreError('INVALID_REQUEST', 'Choose a note preview from 1 to 128000 bytes');
  const data = Buffer.from(content, 'utf8'); const truncated = data.length > maxBytes;
  return { content: truncated ? new TextDecoder().decode(data.subarray(0, maxBytes), { stream: true }) : content, truncated };
}
