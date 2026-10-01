import type { ReactNode } from 'react';
import { CheckCircle2, Clock, FileText } from 'lucide-react';
import { t } from '../i18n';

/** Presentation only: selection and all data remain owned by App. */
export function OrderLedgerEntry({ title, product, status, active, updated, onSelect, children }: {
  title: string; product: string; status: string; active: boolean; updated: boolean;
  onSelect: () => void; children: ReactNode;
}) {
  return <button className={`order-item ${active ? 'active' : ''} ${updated ? 'updated' : ''}`}
    aria-current={active ? 'true' : undefined} onClick={onSelect}>
    <span className="ledger-product">{product}</span>
    <strong>{title}</strong>
    <span className="ledger-status"><FileText size={14} aria-hidden="true"/>{status}</span>
    <span className="badges">{children}</span>
  </button>;
}

export function ReviewState({ confirmed, proposals, terminal }: {
  confirmed: string; proposals: { label: string; value: string }[]; terminal?: string;
}) {
  return <section className="review-state" aria-label={t("Состояние заказа")}>
    <div className="review-confirmed">
      <CheckCircle2 size={22} aria-hidden="true"/>
      <div><p>{terminal ? t("Заказ завершён") : t("Подтверждённый статус")}</p><h2>{terminal || confirmed}</h2></div>
    </div>
    {!terminal && <div className={`review-proposed ${proposals.length ? 'has-proposal' : ''}`}>
      <Clock size={19} aria-hidden="true"/>
      <div><p>{proposals.length ? t("Предложено партнёром") : t("Ожидание следующего решения")}</p>
        {proposals.length ? <><ul>{proposals.map(p => <li key={p.label}><span>{p.label}</span><strong>{p.value}</strong></li>)}</ul>
          <small>{t("Клиент увидит изменения после подтверждения администратором.")}</small></>
          : <small>{t("Новых предложений по этапам нет.")}</small>}
      </div>
    </div>}
  </section>;
}

/** Finance has a distinct admin-only composition, rather than shared partner fields. */
export function AdminFinance({ children }: { children: ReactNode }) {
  return <section className="admin-finance" aria-label={t("Финансы администратора")}>
    <div className="finance-heading"><h3>{t("Финансы заказа")}</h3><span>{t("Администратор")}</span></div>
    {children}
  </section>;
}
