import "server-only";
import { readSheet } from "read-excel-file/node";

export type SheetRow = Record<string, string>;

// Minimal RFC4180-ish CSV parser -- handles quoted fields (including
// embedded commas/newlines) and doubled-quote escaping. No dependency:
// the format is simple enough to read correctly by hand, and the one
// npm package that reads both csv and xlsx (`xlsx`/SheetJS) has two
// unpatched high-severity advisories on the registry version.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Parses an uploaded .csv or .xlsx file into row objects keyed by the
// header row's column names, so callers look up fields by name rather
// than position -- works the same regardless of which format was uploaded.
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<SheetRow[]> {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const grid: unknown[][] = isCsv
    ? parseCsv(buffer.toString("utf-8"))
    : await readSheet(buffer);

  if (!grid.length) return [];

  const headers = grid[0].map((h) => String(h ?? "").trim());
  return grid
    .slice(1)
    .filter((r) => r.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((r) => {
      const obj: SheetRow = {};
      headers.forEach((h, i) => {
        const v = r[i];
        obj[h] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();
      });
      return obj;
    });
}
