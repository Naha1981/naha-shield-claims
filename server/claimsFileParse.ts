import ExcelJS from 'exceljs';

// Reads insurer Excel exports (.xlsx / .xlsm) into plain header + row records
// for claimsFileIngest. In-memory only; the workbook is discarded after use.

const MAX_ROWS = 50_000;

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    // Rich text, formula results and hyperlinks: use the rendered text.
    return String(cell.text ?? '').trim();
  }
  return String(v).trim();
}

export type ParsedSheet = {
  sheet_name: string;
  headers: string[];
  rows: Array<Record<string, string>>;
};

export async function rowsFromXlsx(buffer: Buffer, sheetName?: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets.find((w) => w.actualRowCount > 0);
  if (!sheet) throw new Error('No sheet with data found in this workbook');

  // Header row: the first row with at least two non-empty cells, so exports
  // with a title banner above the table still read correctly.
  let headerRowNumber = 0;
  let headers: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (headerRowNumber) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellText(cell)));
    const nonEmpty = cells.filter((c) => c !== '');
    if (nonEmpty.length >= 2) {
      headerRowNumber = n;
      headers = cells;
    }
  });
  if (!headerRowNumber) throw new Error(`No header row found on sheet "${sheet.name}"`);

  const rows: Array<Record<string, string>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRowNumber || rows.length >= MAX_ROWS) return;
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const value = cellText(row.getCell(i + 1));
      rec[h] = value;
      if (value !== '') any = true;
    });
    if (any) rows.push(rec);
  });

  return { sheet_name: sheet.name, headers: headers.filter(Boolean), rows };
}
