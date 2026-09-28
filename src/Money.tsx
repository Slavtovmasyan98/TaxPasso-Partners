import { useState } from "react";
import { Check } from "lucide-react";

// Цены продуктов на сервере (миграция 020): оплата сверяется с ними, поэтому они должны
// совпадать с ценами на сайте. Меняет только администратор через set_product_price.

export type ProductPrice = { product: string; price_cents: number; updated_at?: string };
export type PaymentDue = { base_cents: number; addons_cents: number; total_cents: number };

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
    case "Amount mismatch": return `Сумма не совпадает с должной${expected !== null ? ` (нужно ${usd(expected)})` : ""}`;
    case "Amount required": return `Введите полученную сумму${expected !== null ? ` (${usd(expected)})` : ""}`;
    case "Price not configured": return "Для продукта не задана цена";
    case "Order not paid": return "Заказ не оплачен";
    case "Refund exceeds amount paid":
      return `Больше оплаченного${paid !== null ? ` (оплачено ${usd(paid)}, возвращено ${usd(refunded || 0)})` : ""}`;
    case "Duplicate refund": return "Такой возврат только что записан";
    case "Scope does not match order": return "Эта часть не относится к заказу";
    case "Cannot mark a cancelled order as paid": return "Заказ отменён: платёж нужно вернуть вручную";
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
      <h2>Цены продуктов</h2>
      <p className="step-hint" style={{ marginBottom: 10 }}>
        По этим ценам сверяется оплата. Они должны совпадать с ценами на сайте.
      </p>
      {prices.map(p => {
        const value = edit[p.product] ?? (p.price_cents / 100).toString();
        const cents = Math.round(Number(value) * 100);
        const changed = Number.isFinite(cents) && cents > 0 && cents !== p.price_cents;
        return (
          <div key={p.product} className="history-row" style={{ gap: 10, alignItems: "center" }}>
            <span style={{ flex: "1 1 160px" }}>{names[p.product] || p.product}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="sr-only">Цена {names[p.product] || p.product}, $</span>
              $<input className="partner-select" style={{ width: 110 }} type="number" min={1} step="0.01"
                aria-label={`Цена ${names[p.product] || p.product}, $`} value={value}
                onChange={e => setEdit({ ...edit, [p.product]: e.target.value })}/>
            </label>
            <button className="btn btn-outline btn-sm" disabled={busy || !changed}
              onClick={() => { onSave(p.product, cents); setEdit(({ [p.product]: _, ...rest }) => rest); }}>
              <Check size={14}/> Сохранить
            </button>
          </div>
        );
      })}
    </div>
  );
}
