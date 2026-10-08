import { describe, expect, it } from 'vitest';
import { calculateImportAccounting } from './import-accounting';

describe('import accounting', () => {
  it('counts every row in a failed 250-row batch', () => {
    expect(calculateImportAccounting({
      rowsRead: 250,
      rowsValidated: 250,
      rowsWritten: 0,
      failedBatchRows: 250
    })).toEqual({
      rowsRead: 250,
      rowsValidated: 250,
      rowsWritten: 0,
      rowsFailed: 250
    });
  });

  it('combines validation failures and failed batch rows', () => {
    expect(calculateImportAccounting({
      rowsRead: 300,
      rowsValidated: 280,
      rowsWritten: 30,
      failedBatchRows: 250
    }).rowsFailed).toBe(270);
  });
});
