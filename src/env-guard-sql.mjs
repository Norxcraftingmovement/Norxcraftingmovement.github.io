// SQL prefix for every file that WRITES to a remote D1 database: aborts the whole file unless the database's own
// `meta.environment` marker equals the expected environment. json('…') raises "malformed JSON", which stops execution
// (D1 runs a file as one batch, so nothing before or after the failing statement is applied).
export const guardSql = (environment) => {
  if (!/^(staging|production)$/.test(environment)) throw new Error("unknown environment");
  return `-- environment guard: refuse to run against anything but '${environment}'\nSELECT CASE WHEN (SELECT value FROM meta WHERE key='environment')='${environment}' THEN 1 ELSE json('ENVIRONMENT MARKER MISSING OR MISMATCH') END;\n`;
};
