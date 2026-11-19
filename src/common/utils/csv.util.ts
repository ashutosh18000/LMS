import { BadRequestException } from '@nestjs/common';

export interface CsvColumn<T = any> {
  header: string;
  key?: keyof T;
  value?: (row: T) => any;
}

export class CsvUtil {
  /**
   * Escapes a single cell for CSV formatting, mitigating formula injection
   * and properly wrapping characters like quotes, commas, and newlines.
   */
  static escapeCell(val: any): string {
    if (val === null || val === undefined) {
      return '';
    }
    let str = String(val);

    // Formula Injection Mitigation (Excel / Google Sheets / LibreOffice):
    // Prepend single quote (') if value begins with =, +, -, or @
    if (/^[=+\-@]/.test(str)) {
      str = `'${str}`;
    }

    // Standard CSV escaping: if comma, double-quote, or newline is present,
    // enclose cell in double-quotes and escape internal double-quotes by doubling them.
    if (/[",\n\r]/.test(str)) {
      str = `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Generates a CSV string with a UTF-8 BOM, header line, and escaped rows.
   * Enforces a maximum row limit (defaults to 10,000).
   */
  static generateCsv<T>(
    columns: CsvColumn<T>[],
    rows: T[],
    maxRows = 10000,
  ): string {
    if (rows.length > maxRows) {
      throw new BadRequestException(
        `CSV export limit exceeded (max ${maxRows} rows). Please apply filters to reduce dataset size.`,
      );
    }

    const headerLine = columns
      .map((col) => this.escapeCell(col.header))
      .join(',');

    const dataLines = rows.map((row) =>
      columns
        .map((col) => {
          const rawVal = col.value ? col.value(row) : (row as any)[col.key!];
          return this.escapeCell(rawVal);
        })
        .join(','),
    );

    // UTF-8 BOM (\uFEFF) ensures proper Unicode rendering across spreadsheet applications
    return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
  }
}
