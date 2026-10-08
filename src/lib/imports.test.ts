import { describe, expect, it } from 'vitest';
import { chunkArray } from './imports';

describe('import batching', () => {
  it('splits a large simulation into deterministic batches', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => index);
    const batches = chunkArray(rows, 250);
    expect(batches).toHaveLength(4);
    expect(batches.flat()).toEqual(rows);
  });
});
