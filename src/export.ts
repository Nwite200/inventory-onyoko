// Exports without extra dependencies. CSV opens in any spreadsheet; the Excel export is an
// HTML table served as .xls, which Excel and LibreOffice open natively. PDF is produced by the
// browser's print-to-PDF dialog so fonts and paper size stay under the user's control.
export type Cell = string | number;

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function downloadBlob(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: Cell[][]): void {
  downloadBlob(filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`, 'text/csv;charset=utf-8', toCsv(rows));
}

const escapeHtml = (v: Cell): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function downloadExcel(filename: string, title: string, rows: Cell[][]): void {
  const head = rows[0] ?? [];
  const body = rows.slice(1);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Inter,Arial,sans-serif;font-size:12px}h1{font-size:16px}table{border-collapse:collapse}th,td{border:1px solid #d5deea;padding:6px 9px;text-align:left}th{background:#eef2ff}</style>
</head><body><h1>${escapeHtml(title)}</h1><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  downloadBlob(filename.toLowerCase().endsWith('.xls') ? filename : `${filename}.xls`, 'application/vnd.ms-excel', html);
}

export function printPdf(): void {
  window.print();
}
