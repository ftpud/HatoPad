import { expect, it } from 'vitest';
import { boundedNote } from './bounded-note.js';
it('bounds note previews by encoded bytes without splitting UTF-8 or accepting invalid budgets', () => {
  expect(boundedNote('a日b', 2)).toEqual({ content: 'a', truncated: true }); expect(boundedNote('a日b', 5)).toEqual({ content: 'a日b', truncated: false });
  for (const invalid of [0, -1, 128001, 1.5, '10']) expect(() => boundedNote('note', invalid)).toThrow('note preview');
});
