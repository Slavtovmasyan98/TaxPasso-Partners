import { FileText, RotateCcw } from "lucide-react";
import { t, locale } from "./i18n";

// Анкета ITIN клиента (данные для формы IRS W-7, миграция 024 в репозитории TaxPasso).
// Видят администратор и назначенный CAA/CPA (специалист — нет). Вернуть на исправление может только админ.

export type ItinApplication = {
  order_id: string; data: Record<string, string>; status: "draft" | "submitted" | "returned";
  submitted_at: string | null; returned_note: string | null; returned_at: string | null;
};

const REASON: Record<string, string> = {
  a: "Нерезидент: льгота по налоговому соглашению",
  b: "Нерезидент: подаёт налоговую декларацию США",
  c: "Резидент США по числу дней: подаёт декларацию",
  d: "Иждивенец гражданина или резидента США",
  e: "Супруг(а) гражданина или резидента США",
  f: "Студент, преподаватель или исследователь-нерезидент",
  g: "Супруг(а) или иждивенец нерезидента с визой США",
  h: "Другое: исключение из требования подавать декларацию",
};
const EXCEPTION: Record<string, string> = {
  "1": "1: удержание налога с пассивного дохода",
  "2": "2: льгота по соглашению (зарплата, стипендия, грант, выигрыш)",
  "3": "3: проценты по ипотеке в США",
  "4": "4: продажа недвижимости в США (FIRPTA)",
  "5": "5: отчётность по Treasury Decision 9363",
  other: "Другое",
};
const RELATION: Record<string, string> = { spouse: "Супруг(а)", child: "Ребёнок", parent: "Родитель", other: "Другое" };

function country(code?: string) {
  if (!code) return "—";
  try { return new Intl.DisplayNames([locale().slice(0, 2)], { type: "region" }).of(code) || code; } catch { return code; }
}
const fmt = (d: string) => new Date(d).toLocaleString(locale(), { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const join = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(", ");

export function ItinW7({ app, role, busy, onReturn }: {
  app: ItinApplication | null; role: "admin" | "partner"; busy: boolean; onReturn: () => void;
}) {
  const d = app?.data || {};
  const status = !app ? t("Клиент ещё не начал анкету")
    : app.status === "submitted" ? t("Отправлена {0}", { 0: app.submitted_at ? fmt(app.submitted_at) : "" })
    : app.status === "returned" ? t("Возвращена клиенту на исправление")
    : t("Черновик: клиент ещё заполняет");
  const rows: [string, string, string][] = !app || app.status === "draft" ? [] : [
    ["a–h", t("Причина подачи"), d.reason ? `${d.reason}) ${t(REASON[d.reason] || d.reason)}` : "—"],
    ...(d.reason === "h" ? [["h", t("Исключение"), join(d.exception_code && t(EXCEPTION[d.exception_code] || d.exception_code), d.exception_detail)] as [string, string, string]] : []),
    ...(d.reason === "a" ? [["a", t("Соглашение"), join(country(d.treaty_country), d.treaty_article)] as [string, string, string]] : []),
    ...(["d", "e", "g"].includes(d.reason) ? [["d/e/g", t("Связь"), join(d.relationship && t(RELATION[d.relationship] || d.relationship), d.us_person_name, d.us_person_tin)] as [string, string, string]] : []),
    ...(d.reason === "f" ? [["6g", t("Учёба / организация"), join(d.school_name, d.school_city, d.stay_length)] as [string, string, string]] : []),
    ["1a", t("Имя"), join(d.first_name, d.middle_name, d.last_name).replaceAll(",", "")],
    ...(d.birth_first_name || d.birth_last_name ? [["1b", t("Имя при рождении"), join(d.birth_first_name, d.birth_last_name).replaceAll(",", "")] as [string, string, string]] : []),
    ["2", t("Почтовый адрес"), d.mail_same === "no" ? join(d.mail_street, d.mail_city, d.mail_region, d.mail_postal, country(d.mail_country)) : t("Совпадает с адресом за пределами США")],
    ["3", t("Адрес за пределами США"), join(d.home_street, d.home_city, d.home_region, d.home_postal, country(d.home_country))],
    ["4", t("Дата и место рождения"), join(d.dob, d.birth_city, country(d.birth_country))],
    ["5", t("Пол"), d.gender === "male" ? t("Мужской") : d.gender === "female" ? t("Женский") : "—"],
    ["6a", t("Гражданство"), join(country(d.citizenship), d.citizenship2 && country(d.citizenship2))],
    ["6b", t("Иностранный налоговый номер"), d.foreign_tin || "—"],
    ["6c", t("Виза США"), join(d.visa_type, d.visa_number, d.visa_expiry) || "—"],
    ["6d", t("Паспорт"), join(country(d.passport_country), d.passport_number, d.passport_expiry && t("до {0}", { 0: d.passport_expiry }))],
    ["6d", t("Дата въезда в США"), d.us_entry_date || "—"],
    ["6e", t("Прежний ITIN / IRSN"), join(d.prev_itin, d.prev_irsn, d.prev_name) || "—"],
    ...(d.phone ? [["", t("Телефон"), d.phone] as [string, string, string]] : []),
  ];
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2><FileText size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{t("Анкета ITIN (W-7)")}</h2>
      <div className={`alert ${app?.status === "submitted" ? "success" : app?.status === "returned" ? "warn" : "info"}`} style={{ marginBottom: 10 }}>
        {status}{app?.status === "returned" && app.returned_note ? ` · «${app.returned_note}»` : ""}
      </div>
      {(!app || app.status !== "submitted") && <p className="step-hint">{t("Этап после «Документы» откроется, когда клиент отправит анкету.")}</p>}
      {rows.length > 0 && (
        <dl>
          {rows.map(([line, k, v], i) => (
            <div key={i}><dt>{line && <span className="badge status" style={{ marginRight: 6 }}>{line}</span>}{k}</dt><dd>{v || "—"}</dd></div>
          ))}
        </dl>
      )}
      {role === "admin" && app?.status === "submitted" && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={onReturn}>
          <RotateCcw size={14} /> {t("Вернуть клиенту на исправление")}
        </button>
      )}
    </div>
  );
}
