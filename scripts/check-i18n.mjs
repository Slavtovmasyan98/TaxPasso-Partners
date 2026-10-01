// Проверка перевода: весь русский текст интерфейса должен быть строкой в t()/tr()
// и иметь английский перевод в src/i18n/en.json с теми же подстановками {0} и пробелами по краям.
// Запуск: node scripts/check-i18n.mjs   (печать недостающих ключей в JSON: --missing)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const CYR = /[А-Яа-яЁё]/;
const en = JSON.parse(readFileSync(join(SRC, "i18n/en.json"), "utf8"));

function files(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

// Минимальный лексер: комментарии, строки '…' "…", шаблоны `…${…}…`. Всё остальное — код или JSX-текст.
function scan(s, file, keys, errors) {
  const line = i => s.slice(0, i).split("\n").length;
  const readString = i => { const q = s[i]; let j = i + 1; while (s[j] !== q) j += s[j] === "\\" ? 2 : 1; return j + 1; };
  function readTemplate(i) {
    let j = i + 1;
    while (true) {
      if (s[j] === "\\") { j += 2; continue; }
      if (s[j] === "`") return j + 1;
      if (s[j] === "$" && s[j + 1] === "{") {
        let k = j + 2, depth = 1;
        while (depth) {
          const c = s[k];
          if (c === '"' || c === "'") { k = readString(k); continue; }
          if (c === "`") { k = readTemplate(k); continue; }
          if (c === "/" && s[k + 1] === "/") { k = s.indexOf("\n", k); continue; }
          if (c === "{") depth++; else if (c === "}") depth--;
          k++;
        }
        walk(j + 2, k - 1); j = k; continue;
      }
      if (CYR.test(s[j])) errors.push(`${file}:${line(j)} русский текст в шаблонной строке — используйте t("… {0} …", { 0: … })`);
      j++;
    }
  }
  function walk(a, b) {
    let i = a;
    while (i < b) {
      const c = s[i];
      if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); i = j < 0 ? b : j; continue; }
      if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i) + 2; continue; }
      if (c === '"' || c === "'") {
        const j = readString(i);
        if (CYR.test(s.slice(i, j))) keys.push({ key: c === '"' ? JSON.parse(s.slice(i, j)) : s.slice(i + 1, j - 1).replace(/\\'/g, "'"), at: `${file}:${line(i)}` });
        i = j; continue;
      }
      if (c === "`") { i = readTemplate(i); continue; }
      if (CYR.test(c)) {
        errors.push(`${file}:${line(i)} текст без t(): «${s.slice(i, s.indexOf("\n", i)).trim().slice(0, 60)}»`);
        const j = s.indexOf("\n", i); i = j < 0 ? b : j; continue;
      }
      i++;
    }
  }
  walk(0, s.length);
}

const keys = [], errors = [];
for (const f of files(SRC)) scan(readFileSync(f, "utf8"), relative(ROOT, f), keys, errors);

const placeholders = s => (s.match(/\{\w+\}/g) || []).sort().join(",");
const edges = s => [/^\s/.test(s), /\s$/.test(s)].join();
const missing = {};
for (const { key, at } of keys) {
  if (!(key in en)) { missing[key] = ""; errors.push(`${at} нет перевода: ${JSON.stringify(key)}`); continue; }
  const v = en[key];
  if (!v || CYR.test(v)) errors.push(`${at} пустой или русский перевод: ${JSON.stringify(key)}`);
  else if (placeholders(v) !== placeholders(key)) errors.push(`${at} подстановки не совпадают: ${JSON.stringify(key)} → ${JSON.stringify(v)}`);
  else if (edges(v) !== edges(key)) errors.push(`${at} пробелы по краям не совпадают: ${JSON.stringify(key)} → ${JSON.stringify(v)}`);
}
const used = new Set(keys.map(k => k.key));
const unused = Object.keys(en).filter(k => !used.has(k));

if (process.argv.includes("--missing")) { console.log(JSON.stringify(missing, null, 2)); process.exit(0); }
if (unused.length) console.warn(`i18n: ${unused.length} неиспользуемых переводов: ${unused.slice(0, 5).map(k => JSON.stringify(k)).join(", ")}${unused.length > 5 ? "…" : ""}`);
if (errors.length) { console.error(errors.join("\n")); console.error(`i18n: ошибок ${errors.length}`); process.exit(1); }
console.log(`i18n: ${used.size} строк, перевод полный`);
