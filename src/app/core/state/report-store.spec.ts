import { parseReportCode } from './report-store';

describe('parseReportCode', () => {
  it('extracts the code from a full report URL', () => {
    expect(parseReportCode('https://www.warcraftlogs.com/reports/a1B2c3D4e5F6g7H8#fight=12')).toBe(
      'a1B2c3D4e5F6g7H8',
    );
  });

  it('extracts anonymised report codes', () => {
    expect(parseReportCode('https://www.warcraftlogs.com/reports/a:x9Y8z7W6v5U4t3S2')).toBe(
      'a:x9Y8z7W6v5U4t3S2',
    );
  });

  it('accepts a bare code', () => {
    expect(parseReportCode('  a1B2c3D4e5F6g7H8 ')).toBe('a1B2c3D4e5F6g7H8');
  });

  it('accepts the demo keyword case-insensitively', () => {
    expect(parseReportCode('demo')).toBe('DEMO');
  });

  it('rejects garbage input', () => {
    expect(parseReportCode('')).toBeNull();
    expect(parseReportCode('not a report')).toBeNull();
    expect(parseReportCode('https://example.com/whatever')).toBeNull();
  });
});
