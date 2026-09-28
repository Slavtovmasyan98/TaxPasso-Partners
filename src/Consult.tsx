import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, MessageCircle, Send, UserCheck, XCircle } from "lucide-react";

// Консультация специалиста (docs/UI_SPEC_016_017.md в репозитории TaxPasso).
// Specialist только предлагает план (propose_specialist_plan); решение принимает администратор
// (confirm_specialist_plan / reject_specialist_plan). Денег, оплаты и этапов IRS здесь нет.

export type SpecialistProposal = {
  order_id: string; decision: "approve" | "reject";
  recommended_product?: string | null; reason?: string | null; proposed_at: string;
};
type ConsultOrder = {
  id: string; product: string; status: string; eligibility: string; eligibility_note?: string | null;
  applicant: Record<string, string>; partner_id?: string | null; closed_at?: string | null; cancelled_at?: string | null;
  order_status_history?: { status: string; created_at: string }[];
};
type PartnerRow = { id: string; display_name: string; qualification: string };
type ConfirmSpec = { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };

export const CONSULT_PRODUCTS: Record<string, string> = {
  itin_standard: "ITIN Standard",
  itin_return: "ITIN + 1040-NR",
};
const QUIZ_SSN: Record<string, string> = { no: "SSN нет", unsure: "Не уверен(а), есть ли право на SSN" };
const QUIZ_BASIS: Record<string, string> = {
  unknown: "«Не знаю», есть ли налоговая причина",
  none: "«Налоговой причины, похоже, нет»",
};

export const CONSULT_ERRORS: Record<string, string> = {
  "Not a consult order": "Этот заказ уже перешёл на другой этап. Обновите страницу",
  "Partner must be a Specialist": "Для консультации назначьте специалиста",
  "Recommended product must be itin_standard or itin_return": "Выберите ITIN Standard или ITIN + 1040-NR",
  "Invalid decision": "Выберите решение",
};

function contactLink(method?: string, value?: string): string | null {
  if (!value) return null;
  const v = value.trim();
  const digits = v.replace(/[^\d]/g, "");
  if (method === "whatsapp") return digits.length >= 7 ? `https://wa.me/${digits}` : null;
  if (method === "telegram") {
    if (/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)) return `https://t.me/${v.replace(/^@/, "")}`;
    if (digits.length >= 7) return `https://t.me/+${digits}`;
  }
  return null;
}

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

export function ConsultPanel({
  order, role, partners, proposal, busy, rpc, askConfirm,
}: {
  order: ConsultOrder;
  role: "admin" | "partner";
  partners: PartnerRow[];
  proposal: SpecialistProposal | null;
  busy: boolean;
  rpc: (fn: string, args: Record<string, unknown>, successMsg: string) => Promise<void>;
  askConfirm: (c: ConfirmSpec) => void;
}) {
  const closed = !!order.closed_at || !!order.cancelled_at;
  const rejected = order.eligibility === "rejected";
  const draft = order.status === "draft";
  const a = order.applicant || {};
  const specialists = partners.filter(p => p.qualification === "SPECIALIST");
  const assigned = partners.find(p => p.id === order.partner_id);

  // Один ключ идемпотентности на операцию: повторный клик/повтор после сбоя сети не создаёт второе действие.
  const opKey = useRef<Record<string, string>>({});
  const op = (name: string) => (opKey.current[name] ||= crypto.randomUUID());
  useEffect(() => { opKey.current = {}; }, [order.id, proposal?.proposed_at, order.closed_at, order.product]);

  const [decision, setDecision] = useState<"" | "approve" | "reject">("");
  const [product, setProduct] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [selectedSpecialist, setSelectedSpecialist] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [adminTouched, setAdminTouched] = useState(false);
  useEffect(() => {
    setDecision(""); setProduct(""); setReason(""); setEditing(false); setTouched(false);
    setSelectedSpecialist(""); setAdminReason(""); setAdminTouched(false);
  }, [order.id, proposal?.proposed_at]);

  const reasonLen = reason.trim().length;
  const formError = !decision ? "Выберите решение"
    : decision === "approve" && !product ? "Выберите продукт"
    : decision === "reject" && (reasonLen < 3 || reasonLen > 1000) ? "Причина: от 3 до 1000 символов"
    : reason.trim().length > 1000 ? "Комментарий: до 1000 символов" : "";
  const adminReasonLen = adminReason.trim().length;
  const adminReasonError = adminReasonLen < 3 || adminReasonLen > 1000 ? "Причина: от 3 до 1000 символов" : "";

  // Шаги для обеих ролей: «Интервью» активно, пока нет решения администратора.
  const steps = ["Заявка", "Интервью", "Решение Taxpasso"];
  const current = draft ? 0 : rejected || closed ? 3 : 1;
  const submittedAt = order.order_status_history?.find(h => h.status === "consult_interview")?.created_at;
  const link = contactLink(a.contact_method, a.contact_value);
  const method = a.contact_method === "whatsapp" ? "WhatsApp" : a.contact_method === "telegram" ? "Telegram" : "—";

  function submitProposal() {
    setTouched(true);
    if (formError) return;
    rpc("propose_specialist_plan", {
      p_order: order.id, p_decision: decision,
      p_recommended_product: decision === "approve" ? product : null,
      p_reason: reason.trim() || null, p_op: op("propose"),
    }, "Предложение отправлено администратору");
  }

  return (
    <>
      <div className="tracker" aria-label="Этапы консультации">
        <div className="tracker-steps">
          {steps.map((s, i) => (
            <div key={s} className={`tracker-step ${i < current ? "done" : i === current ? "active" : ""}`}>
              <div className="tracker-dot">{i < current ? <Check size={14}/> : i + 1}</div>
              <div className="tracker-label">
                {s}
                {i === 0 && submittedAt && <div style={{ fontSize: 9, marginTop: 2, opacity: .8 }}>{fmtDate(submittedAt)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {rejected && (
        <div className="alert danger" role="status">
          <XCircle size={16}/> Основание не подтверждено, заказ закрыт{order.eligibility_note ? `: ${order.eligibility_note}` : ""}
        </div>
      )}
      {!rejected && order.cancelled_at && <div className="alert danger"><XCircle size={16}/> Заказ отменён</div>}
      {draft && <div className="alert info"><AlertCircle size={16}/> Клиент ещё не отправил заявку</div>}

      <div className="grid-2">
        <div className="card">
          <h2>Консультация · контакт клиента</h2>
          <dl>
            <div><dt>Имя</dt><dd>{a.name || "—"}</dd></div>
            <div><dt>Страна</dt><dd>{a.country || "—"}</dd></div>
            <div><dt>Способ связи</dt><dd>{method}</dd></div>
            <div><dt>Контакт</dt><dd>
              {a.contact_value || "—"}
              {link && <> · <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "#304fc0" }}>написать в {method}</a></>}
            </dd></div>
            <div><dt>Удобное время</dt><dd>{a.preferred_time || "—"}</dd></div>
            <div><dt>Опросник: SSN</dt><dd>{QUIZ_SSN[a.quiz_ssn] || a.quiz_ssn || "—"}</dd></div>
            <div><dt>Опросник: причина</dt><dd>{QUIZ_BASIS[a.quiz_basis] || a.quiz_basis || "—"}</dd></div>
          </dl>
        </div>

        <div className="card">
          <h2>Действия</h2>

          {role === "admin" && (
            <div className="action-section">
              <div className="action-label">СПЕЦИАЛИСТ</div>
              {assigned
                ? <div className="step-hint"><UserCheck size={14} style={{ verticalAlign: -2 }}/> {assigned.display_name} ({assigned.qualification})</div>
                : <div className="alert warn" style={{ marginBottom: 10 }}><AlertCircle size={15}/> Специалист не назначен</div>}
              {!closed && !draft && (
                specialists.length === 0
                  ? <p className="step-hint">Нет партнёров с квалификацией SPECIALIST</p>
                  : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <label style={{ flex: "1 1 200px" }}>
                        <span className="sr-only">Специалист</span>
                        <select className="partner-select" aria-label="Специалист" value={selectedSpecialist}
                          onChange={e => setSelectedSpecialist(e.target.value)}>
                          <option value="">{assigned ? "Сменить специалиста…" : "Выберите специалиста…"}</option>
                          {specialists.filter(p => p.id !== order.partner_id).map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                        </select>
                      </label>
                      <button className="btn btn-primary btn-sm" disabled={busy || !selectedSpecialist}
                        onClick={() => askConfirm({
                          title: assigned ? "Сменить специалиста?" : "Назначить специалиста?",
                          body: assigned ? "Текущее предложение прежнего специалиста будет удалено." : "Специалист увидит контакт клиента и сможет предложить решение.",
                          confirmLabel: "Назначить",
                          onConfirm: () => { rpc("assign_partner", { p_order: order.id, p_partner: selectedSpecialist }, "Специалист назначен"); setSelectedSpecialist(""); },
                        })}>
                        <Send size={14}/> Назначить
                      </button>
                    </div>
              )}
            </div>
          )}

          {/* Предложение специалиста: видно специалисту и администратору, но не клиенту. */}
          {proposal && (
            <div className={`alert ${proposal.decision === "approve" ? "info" : "warn"}`} style={{ marginBottom: 12 }}>
              <AlertCircle size={15}/>
              <span>
                <b>{role === "admin" ? "Специалист предлагает: " : "Ваше предложение: "}</b>
                {proposal.decision === "approve"
                  ? <>основание есть → {CONSULT_PRODUCTS[proposal.recommended_product || ""] || proposal.recommended_product}</>
                  : <>основание не подтверждается</>}
                {proposal.reason && <> · «{proposal.reason}»</>}
                <br/><small>{fmtDate(proposal.proposed_at)} · ожидает решения администратора</small>
              </span>
            </div>
          )}

          {role === "partner" && !closed && !draft && (!proposal || editing) && (
            <div className="action-section">
              <div className="action-label">РЕШЕНИЕ СПЕЦИАЛИСТА</div>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-invalid={touched && !decision}>
                <legend className="sr-only">Решение</legend>
                <label className="consult-choice">
                  <input type="radio" name={`decision-${order.id}`} checked={decision === "approve"} onChange={() => setDecision("approve")}/>
                  Основание подтверждается
                </label>
                <label className="consult-choice">
                  <input type="radio" name={`decision-${order.id}`} checked={decision === "reject"} onChange={() => setDecision("reject")}/>
                  Основание не подтверждается
                </label>
              </fieldset>
              {decision === "approve" && (
                <label style={{ display: "block", marginTop: 8 }}>
                  <span className="step-hint">Подходящий продукт *</span>
                  <select className="partner-select" aria-label="Подходящий продукт" value={product}
                    aria-invalid={touched && !product} onChange={e => setProduct(e.target.value)}>
                    <option value="">Выберите…</option>
                    {Object.entries(CONSULT_PRODUCTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              )}
              {decision && (
                <label style={{ display: "block", marginTop: 8 }}>
                  <span className="step-hint">{decision === "reject" ? "Причина для клиента * (3–1000 символов)" : "Комментарий для администратора (необязательно)"}</span>
                  <textarea className="note-area" aria-label={decision === "reject" ? "Причина" : "Комментарий"} maxLength={1000}
                    value={reason} aria-invalid={touched && decision === "reject" && (reasonLen < 3)} onChange={e => setReason(e.target.value)}/>
                </label>
              )}
              {touched && formError && <p className="error-msg" role="alert">{formError}</p>}
              <div className="doc-actions" style={{ marginTop: 10 }}>
                {editing && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setEditing(false); setTouched(false); }}>Отмена</button>}
                <button className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy} onClick={submitProposal}>
                  <Send size={14}/> {busy ? "Отправляем…" : "Отправить администратору"}
                </button>
              </div>
            </div>
          )}
          {role === "partner" && proposal && !editing && !closed && (
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setEditing(true); setDecision(proposal.decision); setProduct(proposal.recommended_product || ""); setReason(proposal.reason || ""); }}>
              Изменить предложение
            </button>
          )}

          {role === "admin" && !closed && !draft && (
            <div className="action-section">
              <div className="action-label">РЕШЕНИЕ АДМИНИСТРАТОРА</div>
              {!proposal && <p className="step-hint">Подтвердить можно после предложения специалиста. Отклонить можно в любой момент.</p>}
              {proposal && (
                <button className="btn btn-success btn-sm" disabled={busy} style={{ marginBottom: 10 }}
                  onClick={() => askConfirm(proposal.decision === "approve" ? {
                    title: "Подтвердить план специалиста?",
                    body: `Заказ станет «${CONSULT_PRODUCTS[proposal.recommended_product || ""] || proposal.recommended_product}», этап «Документы». После решения клиенту откроется оплата. Затем назначьте ${proposal.recommended_product === "itin_return" ? "партнёра CAA/CPA" : "партнёра CAA или CAA/CPA"}.`,
                    confirmLabel: "Подтвердить и открыть оплату",
                    onConfirm: () => rpc("confirm_specialist_plan", { p_order: order.id, p_op: op("confirm") }, "План подтверждён: клиент видит продукт и оплату"),
                  } : {
                    title: "Подтвердить отказ?",
                    body: `Клиент увидит отказ с причиной «${proposal.reason || ""}». Заказ будет закрыт, это необратимо.`,
                    confirmLabel: "Подтвердить отказ", danger: true,
                    onConfirm: () => rpc("confirm_specialist_plan", { p_order: order.id, p_op: op("confirm") }, "Отказ подтверждён, заказ закрыт"),
                  })}>
                  <CheckCircle2 size={14}/> Подтвердить план
                </button>
              )}
              <label style={{ display: "block" }}>
                <span className="step-hint">Отклонить самостоятельно: причина для клиента * (3–1000 символов)</span>
                <textarea className="note-area" aria-label="Причина отказа" maxLength={1000} value={adminReason}
                  aria-invalid={adminTouched && !!adminReasonError} onChange={e => setAdminReason(e.target.value)}/>
              </label>
              {adminTouched && adminReasonError && <p className="error-msg" role="alert">{adminReasonError}</p>}
              <button className="btn btn-danger btn-sm" disabled={busy} style={{ marginTop: 8 }}
                onClick={() => {
                  setAdminTouched(true);
                  if (adminReasonError) return;
                  askConfirm({
                    title: "Отклонить консультацию?",
                    body: `Клиент увидит отказ с причиной «${adminReason.trim()}». Заказ будет закрыт, это необратимо.`,
                    confirmLabel: "Отклонить", danger: true,
                    onConfirm: () => rpc("reject_specialist_plan", { p_order: order.id, p_reason: adminReason.trim(), p_op: op("reject") }, "Консультация отклонена, заказ закрыт"),
                  });
                }}>
                <XCircle size={14}/> Отклонить
              </button>
            </div>
          )}

          {closed && <p className="step-hint"><MessageCircle size={14} style={{ verticalAlign: -2 }}/> Консультация завершена, действий нет.</p>}
        </div>
      </div>
    </>
  );
}
