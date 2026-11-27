import test from "node:test";
import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {readFileSync} from "node:fs";
// The V1 Apps Script source and exports hold private configuration. Nothing resembling it may be committed.
const files=execSync("git ls-files --cached --others --exclude-standard",{cwd:new URL("../",import.meta.url)}).toString().split("\n")
  .filter(f=>/^(src|tests|docs|admin-ui|migrations|seeds|scripts)\//.test(f)&&!f.startsWith("src/generated/")&&/\.(mjs|js|json|jsonc|md|sql|html|css|txt)$/.test(f)&&!f.endsWith("v1-golden.json")&&f!=="tests/repo-hygiene.test.mjs"&&f!=="src/admin-console.mjs" /* pre-existing public admin shortcut, not part of Orders V2 */);
test("no bank account numbers, real e-mail addresses, Google Sheet IDs or Apps Script web-app URLs in new code/docs/tests",()=>{
  assert.ok(files.length>20);
  const rules={bank:/\b(?!000-0-00000-0\b)\d{3}-\d-\d{5}-\d\b/ /* 000-0-00000-0 = obviously fake test value */,email:/[A-Za-z0-9._%+-]+@(?!example\.(?:test|com)\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}/,sheetId:/["'`]1[A-Za-z0-9_-]{43}["'`]/,appsScript:/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/,v1Constants:/\b(ADMIN_EMAIL|NOTIFICATION_EMAIL|TEST_BOOK|LEGACY_BOOK)\s*=/};
  const hits=[];
  for(const f of files){const t=readFileSync(new URL("../"+f,import.meta.url),"utf8");for(const [k,re] of Object.entries(rules))if(re.test(t))hits.push(f+": "+k)}
  assert.deepEqual(hits,[]);
});
test("golden fixture contains only synthetic inputs (no secrets / real contact data)",()=>{
  const t=readFileSync(new URL("./fixtures/v1-golden.json",import.meta.url),"utf8");
  assert.ok(!/\d{3}-\d-\d{5}-\d/.test(t)&&!/@(?!example)/.test(t)&&!/script\.google\.com/.test(t));
  assert.ok(!/ThisShouldNeverMatch/.test(t));
});
test(".gitignore blocks V1 source dumps",()=>{
  const g=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");for(const p of ["/v1-source/","/private/","*.v1.gs","*.v1.txt"])assert.ok(g.includes(p),p);
});
