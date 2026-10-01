import { useSyncExternalStore } from "react";
import EN from "./i18n/en.json";

// Интерфейс написан по-русски; английский перевод — словарь «русская строка → английская» в i18n/en.json.
// Строка без перевода показывается по-русски. Полноту словаря проверяет scripts/check-i18n.mjs при сборке.

export type Lang = "ru" | "en";
const STORAGE_KEY = "taxpasso_partners_lang";
const dict: Record<string, string> = EN;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch { /* приватный режим: язык по умолчанию */ }
  return "ru";
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export function getLang(): Lang { return lang; }

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* язык действует до перезагрузки */ }
  document.documentElement.lang = next;
  listeners.forEach(l => l());
}

/** Подписка компонента на смену языка: App вызывает её, и всё дерево перерисовывается. */
export function useLang(): Lang {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => lang,
  );
}

/** Перевод строки. Подстановки: t("Оплачено {0}", { 0: usd(x) }). */
export function t(ru: string, vars?: Record<string, unknown>): string {
  const s = lang === "en" ? (dict[ru] ?? ru) : ru;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : s;
}

/** Словарь значений (статусы, продукты…), который переводится при каждом чтении. */
export function tr<T extends Record<string, string>>(map: T): T {
  return new Proxy(map, {
    get: (o, k) => {
      const v = Reflect.get(o, k);
      return typeof k === "string" && typeof v === "string" ? t(v) : v;
    },
  });
}

/** Локаль для дат и чисел. */
export function locale(): string { return lang === "en" ? "en-US" : "ru-RU"; }

export function LangSwitch({ className }: { className?: string }) {
  const current = useLang();
  return (
    <div className={`lang-switch ${className || ""}`} role="group" aria-label={t("Язык")}>
      {(["ru", "en"] as const).map(l => (
        <button key={l} type="button" className={current === l ? "active" : ""} aria-pressed={current === l}
          onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}
