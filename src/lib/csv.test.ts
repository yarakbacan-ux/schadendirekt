import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('RFC4180 CSV parser', () => {
  it('handles commas, escaped quotes, CRLF, UTF-8 and quoted newlines', () => {
    const csv = 'vin,externalId,eventType,eventDate,country,mileageKm,title,description\r\n' +
      'WBA12345678901234,abc,damage,2025-01-02,DE,12345,"Front, links","Text mit ""Quote"" und\nZeilenumbruch"\r\n' +
      'WBA12345678901235,,service,2025-02-03,AT,22222,Ölwechsel,Größe geprüft\r\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Front, links');
    expect(rows[0].description).toBe('Text mit "Quote" und\nZeilenumbruch');
    expect(rows[1].description).toBe('Größe geprüft');
  });
});
