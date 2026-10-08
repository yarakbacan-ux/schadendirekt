export type ImportAccounting = {
  rowsRead: number;
  rowsValidated: number;
  rowsWritten: number;
  rowsFailed: number;
};

export function calculateImportAccounting(input: {
  rowsRead: number;
  rowsValidated: number;
  rowsWritten: number;
  failedBatchRows: number;
}): ImportAccounting {
  const validationFailures = Math.max(0, input.rowsRead - input.rowsValidated);
  return {
    rowsRead: input.rowsRead,
    rowsValidated: input.rowsValidated,
    rowsWritten: input.rowsWritten,
    rowsFailed: validationFailures + Math.max(0, input.failedBatchRows)
  };
}
