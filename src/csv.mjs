// CSV output safe for spreadsheets: formula-injection guard (cells that start a formula get a leading apostrophe),
// quoting, CRLF, and a UTF-8 BOM so Excel opens Thai text correctly.
export const csvCell = (value) => {
  let s = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
