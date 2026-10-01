import { useState } from "react";
import { Check } from "lucide-react";
import { t, tr } from "./i18n";

// Цены продуктов на сервере (миграция 020): оплата сверяется с ними, поэтому они должны
// совпадать с ценами на сайте. Меняет только администратор через set_product_price.

export type ProductPrice = { product: string; price_cents: number; updated_at?: string };
export type PaymentDue = {
  base_cents: number; addons_cents: number; total_cents: number;
  // Миграция 021: продления обслуживания и госсбор штата за годы 2…N. В базе без 021 этих полей нет.
  renewals_cents?: number; state_fee_cents?: number; years?: number;
};
export type RenewalPrice = { state: string; renewal_cents: number; state_fee_cents: number };
export type PaymentLine = { kind: "package" | "service_year" | "state_fee" | "addon"; period_number: number | null; amount_cents: number };

// «пакет $349 + обслуживание $149 + госсбор $60 + услуги $179» — только ненулевые части.
export function dueBreakdown(d: PaymentDue): string {
  const parts = [t("пакет {0}", { 0: usd(d.base_cents) })];
  if (d.renewals_cents) parts.push(t("обслуживание {0}", { 0: usd(d.renewals_cents) }));
  if (d.state_fee_cents) parts.push(t("госсбор {0}", { 0: usd(d.state_fee_cents) }));
  if (d.addons_cents) parts.push(t("услуги {0}", { 0: usd(d.addons_cents) }));
  return parts.join(" + ") + (d.years && d.years > 1 ? t(" · срок {0} {1}", { 0: d.years, 1: d.years < 5 ? t("года") : t("лет") }) : "");
}

const LINE_LABEL: Record<PaymentLine["kind"], string> = tr({
  package: "Пакет", service_year: "Обслуживание", state_fee: "Госсбор штата", addon: "Доп. услуга",
});
// Состав оплаченного заказа (снимок на момент оплаты). Госсбор — транзит: его нужно оплатить штату.
export function PaymentLines({ lines, state }: { lines: PaymentLine[]; state: string | null }) {
  if (!lines.length) return null;
  const fee = lines.filter(l => l.kind === "state_fee").reduce((a, l) => a + l.amount_cents, 0);
  return (
    <div className="action-section">
      <div className="action-label">{t("Состав оплаты")}</div>
      {lines.map((l, i) => (
        <div key={i} className="history-row">
          <span>{LINE_LABEL[l.kind]}{l.period_number ? t(" · год {0}", { 0: l.period_number }) : ""}
            {l.kind === "state_fee" && <span className="badge unpaid" style={{ marginLeft: 6 }}>{t("транзит: оплатить штату")}</span>}</span>
          <b>{usd(l.amount_cents)}</b>
        </div>
      ))}
      {fee > 0 && (
        <p className="step-hint" style={{ marginTop: 8 }}>{t("Госсбор ")}{usd(fee)}{t(" не выручка Taxpasso: оплатить штату от имени клиента в срок")}{state === "DE" ? t(" — до 1 июня каждого года.") : state === "WY" ? t(" — в месяц регистрации компании каждого года.") : "."}
        </p>
      )}
    </div>
  );
}

export function RenewalPrices({ prices, busy, onSave }: {
  prices: RenewalPrice[]; busy: boolean; onSave: (state: string, renewal: number, fee: number) => void;
}) {
  const [edit, setEdit] = useState<Record<string, { r: string; f: string }>>({});
  if (!prices.length) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2>{t("Продление и госсбор (за каждый год после первого)")}</h2>
      <p className="step-hint" style={{ marginBottom: 10 }}>{t("Обслуживание — доход Taxpasso; госсбор — транзит, оплачивается штату.")}</p>
      {prices.map(p => {
        const v = edit[p.state] ?? { r: (p.renewal_cents / 100).toString(), f: (p.state_fee_cents / 100).toString() };
        const r = Math.round(Number(v.r) * 100), f = Math.round(Number(v.f) * 100);
        const valid = Number.isFinite(r) && r > 0 && Number.isFinite(f) && f >= 0;
        const changed = valid && (r !== p.renewal_cents || f !== p.state_fee_cents);
        const name = p.state === "DE" ? "Delaware" : "Wyoming";
        return (
          <div key={p.state} className="history-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 120px" }}>{name}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>{t("обслуживание $")}<input className="partner-select" style={{ width: 90 }} type="number" min={1} step="0.01"
                aria-label={t("Обслуживание {0}, $", { 0: name })} value={v.r} onChange={e => setEdit({ ...edit, [p.state]: { ...v, r: e.target.value } })}/>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>{t("госсбор $")}<input className="partner-select" style={{ width: 90 }} type="number" min={0} step="0.01"
                aria-label={t("Госсбор {0}, $", { 0: name })} value={v.f} onChange={e => setEdit({ ...edit, [p.state]: { ...v, f: e.target.value } })}/>
            </label>
            <button className="btn btn-outline btn-sm" disabled={busy || !changed}
              onClick={() => { onSave(p.state, r, f); setEdit(({ [p.state]: _, ...rest }) => rest); }}>
              <Check size={14}/>{t(" Сохранить")}</button>
          </div>
        );
      })}
    </div>
  );
}

export const usd = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

// Детали ошибок сервера приходят строкой вида "expected_cents=54900" или "paid_cents=… refunded_cents=…".
export function detailCents(details: string | undefined, key: string): number | null {
  const m = details?.match(new RegExp(`${key}=(\\d+)`));
  return m ? Number(m[1]) : null;
}

export function moneyErrorMessage(message: string, details?: string): string | null {
  const expected = detailCents(details, "expected_cents");
  const paid = detailCents(details, "paid_cents");
  const refunded = detailCents(details, "refunded_cents");
  switch (message) {
    case "Amount mismatch": return t("Сумма не совпадает с должной{0}", { 0: expected !== null ? t(" (нужно {0})", { 0: usd(expected) }) : "" });
    case "Amount required": return t("Введите полученную сумму{0}", { 0: expected !== null ? ` (${usd(expected)})` : "" });
    case "Price not configured": return t("Для продукта не задана цена");
    case "Order not paid": return t("Заказ не оплачен");
    case "Refund exceeds amount paid":
      return t("Больше оплаченного{0}", { 0: paid !== null ? t(" (оплачено {0}, возвращено {1})", { 0: usd(paid), 1: usd(refunded || 0) }) : "" });
    case "Duplicate refund": return t("Такой возврат только что записан");
    case "Scope does not match order": return t("Эта часть не относится к заказу");
    case "Cannot mark a cancelled order as paid": return t("Заказ отменён: платёж нужно вернуть вручную");
    case "Invalid state": return t("Штат: только WY или DE");
    case "Price must be positive": return t("Цена должна быть больше нуля");
    default: return null;
  }
}

export function ProductPrices({
  prices, names, busy, onSave,
}: {
  prices: ProductPrice[];
  names: Record<string, string>;
  busy: boolean;
  onSave: (product: string, cents: number) => void;
}) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  if (!prices.length) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2>{t("Цены продуктов")}</h2>
      <p className="step-hint" style={{ marginBottom: 10 }}>{t("По этим ценам сверяется оплата. Они должны совпадать с ценами на сайте.")}</p>
      {prices.map(p => {
        const value = edit[p.product] ?? (p.price_cents / 100).toString();
        const cents = Math.round(Number(value) * 100);
        const changed = Number.isFinite(cents) && cents > 0 && cents !== p.price_cents;
        return (
          <div key={p.product} className="history-row" style={{ gap: 10, alignItems: "center" }}>
            <span style={{ flex: "1 1 160px" }}>{names[p.product] || p.product}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="sr-only">{t("Цена ")}{names[p.product] || p.product}, $</span>
              $<input className="partner-select" style={{ width: 110 }} type="number" min={1} step="0.01"
                aria-label={t("Цена {0}, $", { 0: names[p.product] || p.product })} value={value}
                onChange={e => setEdit({ ...edit, [p.product]: e.target.value })}/>
            </label>
            <button className="btn btn-outline btn-sm" disabled={busy || !changed}
              onClick={() => { onSave(p.product, cents); setEdit(({ [p.product]: _, ...rest }) => rest); }}>
              <Check size={14}/>{t(" Сохранить")}</button>
          </div>
        );
      })}
    </div>
  );
}
