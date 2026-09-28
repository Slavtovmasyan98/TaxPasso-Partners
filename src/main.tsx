import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type User } from "@supabase/supabase-js";
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, ChevronRight,
  Clock, FileText, LogOut, RefreshCw, Search, Send, ShieldCheck,
  Upload, Users, XCircle, ClipboardList, UserCheck, X,
} from "lucide-react";
import "./styles.css";
import { ConsultPanel, CONSULT_ERRORS, type SpecialistProposal } from "./Consult";
import { ProductPrices, moneyErrorMessage, usd, type PaymentDue, type ProductPrice } from "./Money";

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "",
);

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = "admin" | "partner" | "";
type Order = {
  id: string; product: string; status: string; itin_status?: string | null; itin_attempt?: number;
  eligibility: string; eligibility_note?: string | null;
  payment_status?: string; payment_note?: string | null; payment_marked_manually?: boolean; in_work?: boolean;
  applicant: Record<string, string>; created_at: string; partner_id?: string | null;
  order_status_history?: { status: string; created_at: string }[];
  service_years?: number; closed_at?: string | null; service_until?: string | null;
  cancelled_at?: string | null; cancel_reason?: string | null;
  amount_cents?: number | null;
};
type Milestone = { order_id: string; milestone: string; recorded_at: string; partner_id?: string | null };
type Refund = { id: string; order_id: string; amount_cents: number; scope: string; reason: string; created_at: string };
type AuditRow = { id: number; at: string; actor_role?: string | null; entity: string; action: string; old_value?: Record<string, unknown> | null; new_value?: Record<string, unknown> | null; reason?: string | null };
type Proposal = { order_id: string; stream: "main"|"itin"; proposed_status: string; proposed_at: string };
type EligibilityProposal = { order_id: string; decision: "approve" | "reject"; reason?: string | null; proposed_at: string };
type ItinRecord = { order_id: string; itin: string; assigned_on?: string | null; approved: boolean };
type IrsEvent = { id: string; order_id: string; kind: "request" | "rejection"; note: string; attempt: number; created_at: string };
type PartnerApp = {
  id: string; user_id: string; full_name: string; qualification: string;
  bio?: string | null; status: "pending" | "approved" | "rejected";
  reject_reason?: string | null; created_at: string;
};
type Partner = { id: string; profile_id: string; display_name: string; qualification: string };
type PartnerDoc = {
  id: string; order_id: string; name: string; path: string;
  mime_type: string; size_bytes: number; visibility: string;
  note?: string | null; created_at: string; doc_type?: string;
};
type Company = { order_id: string; name: string; state: string; ein: string | null; registered_on: string | null; approved?: boolean };
type ClientDoc = {
  id: string; order_id: string; name: string; path: string;
  mime_type: string; size_bytes: number; created_at: string;
  review_status: string; review_comment?: string | null; superseded_at?: string | null;
};
type DocumentReviewProposal = {
  document_id: string; order_id: string; status: "accepted" | "rejected";
  comment?: string | null; proposed_by?: string | null; proposed_at: string;
};
type Toast = { id: number; type: "success"|"error"|"info"|"warn"; text: string; leaving?: boolean };
type Confirm = { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };

// ─── Constants ────────────────────────────────────────────────────────────────
const LLC_CHAIN = ["application","review","filed_state","registered","ein_requested","ein_received"];
const ITIN_CHAIN = ["documents","caa_interview","sent_irs","itin_received"];
const ITIN_RETURN_CHAIN = ["documents","return_prep","client_signed","caa_interview","sent_irs","itin_received"];
const STATUS: Record<string,string> = {
  draft:"Черновик", application:"Анкета", review:"Проверка",
  filed_state:"Подано в штат", registered:"Компания зарегистрирована",
  ein_requested:"EIN запрошен", ein_received:"EIN получен",
  documents:"Документы", return_prep:"Подготовка декларации", client_signed:"Декларация подписана клиентом",
  caa_interview:"Интервью CAA", sent_irs:"Отправлено в IRS", itin_received:"ITIN получен",
  consult_interview:"Консультация специалиста",
};
const PROD: Record<string,string> = {
  llc_wy:"LLC Wyoming", llc_de:"LLC Delaware",
  itin_standard:"ITIN Standard", itin_return:"ITIN + 1040-NR",
  bundle_wy:"LLC Wyoming + ITIN", bundle_de:"LLC Delaware + ITIN",
  itin_consult:"Консультация ITIN",
};
const DOC_TYPES: Record<string,string> = {
  articles:"Articles of Organization", ein_letter:"Письмо EIN (IRS)",
  operating_agreement:"Operating Agreement", w7:"Форма W-7", coa:"Certificate of Accuracy (COA)",
  tax_return:"Налоговая декларация", itin_letter:"Письмо IRS с ITIN (CP565)",
  other:"Другой документ",
};
const STEP_HINTS: Record<string,string> = {
  review:"Проверить анкету клиента и загруженные документы",
  filed_state:"Подать документы в штат (WY/DE)",
  registered:"Компания зарегистрирована в штате",
  ein_requested:"Запрос EIN отправлен в IRS (тел. или факс)",
  ein_received:"EIN получен от IRS",
  return_prep:"Подготовить налоговую декларацию (1040-NR или 1040)",
  client_signed:"Клиент проверил и подписал декларацию",
  caa_interview:"Провести видеоинтервью с клиентом",
  sent_irs:"Отправить W-7 в IRS",
  itin_received:"ITIN получен, сообщить клиенту",
};

function fmt(d: string) {
  return new Date(d).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function fmtBytes(n: number) {
  return n<1024?n+" B":n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";
}
function chain(product: string): string[] {
  if (product === "itin_return") return ITIN_RETURN_CHAIN;
  return product.startsWith("itin") ? ITIN_CHAIN : LLC_CHAIN;
}

// ─── Toast system ─────────────────────────────────────────────────────────────
let _toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast["type"], text: string) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, type, text }]);
    setTimeout(() => {
      setToasts(t => t.map(x => x.id === id ? { ...x, leaving: true } : x));
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 200);
    }, 3500);
  }, []);
  return { toasts, add };
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-wrap" role="status" aria-live="polite" aria-atomic="true">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}${t.leaving?" leaving":""}`}>
          {t.type==="success"?<Check size={16}/>:t.type==="error"?<XCircle size={16}/>:
           t.type==="warn"?<AlertCircle size={16}/>:<ShieldCheck size={16}/>}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ c, onCancel }: { c: Confirm; onCancel: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => returnFocus.current?.focus();
  }, []);
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    if (e.key !== "Tab") return;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()}>
        <h2 id={titleId}>{c.title}</h2>
        <p>{c.body}</p>
        <div className="dialog-actions">
          <button className="btn btn-outline" onClick={onCancel}>Отмена</button>
          <button className={`btn ${c.danger?"btn-danger":"btn-primary"}`} onClick={() => { c.onConfirm(); onCancel(); }}>
            {c.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Status tracker ───────────────────────────────────────────────────────────
function StatusTracker({ order }: { order: Order }) {
  const steps = chain(order.product);
  const current = steps.indexOf(order.status);
  const history = order.order_status_history || [];
  return (
    <div className="tracker">
      <div className="tracker-steps">
        {steps.map((s, i) => {
          const h = history.find(x => x.status === s);
          const isDone = i < current;
          const isActive = i === current;
          return (
            <div key={s} className={`tracker-step ${isDone?"done":isActive?"active":""}`}>
              <div className="tracker-dot">
                {isDone ? <Check size={14}/> : i+1}
              </div>
              <div className="tracker-label">
                {STATUS[s]||s}
                {h && <div style={{fontSize:9,marginTop:2,opacity:.8}}>{fmt(h.created_at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {/* ITIN bundle */}
      {order.itin_status && (
        <div style={{marginTop:12}}>
          <div className="action-label">ITIN ПОТОК</div>
          <div className="tracker-steps">
            {ITIN_CHAIN.map((s, i) => {
              const cur = ITIN_CHAIN.indexOf(order.itin_status!);
              const h = history.find(x => x.status === s);
              return (
                <div key={s} className={`tracker-step ${i<cur?"done":i===cur?"active":""}`}>
                  <div className="tracker-dot">{i<cur?<Check size={14}/>:i+1}</div>
                  <div className="tracker-label">
                    {STATUS[s]||s}
                    {h && <div style={{fontSize:9,marginTop:2,opacity:.8}}>{fmt(h.created_at)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }: { onAuth: (u: User) => void }) {
  const [tab, setTab] = useState<"sign_in"|"sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [qual, setQual] = useState("CAA");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function submit() {
    setBusy(true); setMsg(""); setOk(false);
    if (tab === "sign_in") {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) setMsg(error.message);
      else if (data.user) onAuth(data.user);
    } else {
      // Заявку нельзя сохранить до подтверждения email (ещё нет сессии),
      // поэтому данные кладём в профиль аккаунта, а заявка создаётся при первом входе.
      const { data, error } = await sb.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: {
          emailRedirectTo: location.origin,
          data: {
            partner_full_name: name.trim(),
            partner_qualification: qual,
            partner_bio: bio.trim() || null,
          },
        },
      });
      if (error) setMsg(error.message);
      else if (data.session && data.user) onAuth(data.user);
      else {
        setOk(true);
        setMsg("Проверьте email и подтвердите регистрацию. После первого входа заявка уйдёт администратору.");
      }
    }
    setBusy(false);
  }
  return (
    <div className="full-page">
      <div className="login-card">
        <ShieldCheck size={36} color="#4762c9"/>
        <h1>Taxpasso Partners</h1>
        <p>Кабинет для CAA/CPA и администратора</p>
        <div className="login-tabs">
          <button className={tab==="sign_in"?"active":""} onClick={()=>{setTab("sign_in");setMsg("");}}>Войти</button>
          <button className={tab==="sign_up"?"active":""} onClick={()=>{setTab("sign_up");setMsg("");}}>Регистрация</button>
        </div>
        {tab==="sign_up" && <>
          <input aria-label="ФИО" placeholder="ФИО *" value={name} onChange={e=>setName(e.target.value)}/>
          <select className="partner-select" aria-label="Квалификация" value={qual} onChange={e=>setQual(e.target.value)} style={{marginBottom:10}}>
            <option>CAA</option><option>CPA</option><option>CAA/CPA</option>
          </select>
          <textarea className="note-area" aria-label="Коротко о себе" placeholder="Коротко о себе (необязательно)" value={bio} onChange={e=>setBio(e.target.value)} style={{marginBottom:10}}/>
        </>}
        <input aria-label="Email" type="email" placeholder="Email *" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input aria-label="Пароль" type="password" placeholder="Пароль (мин. 8 символов) *" value={password} onChange={e=>setPassword(e.target.value)}/>
        <button className="btn btn-primary btn-full" style={{marginTop:4}}
          disabled={busy||!email||password.length<8||(tab==="sign_up"&&!name.trim())}
          onClick={submit}>
          {busy?"Подождите…":tab==="sign_in"?"Войти":"Подать заявку"}
        </button>
        {msg && <p className={ok?"success-msg":"error-msg"}>{msg}</p>}
      </div>
    </div>
  );
}

// ─── Pending ──────────────────────────────────────────────────────────────────
// ─── Двухфакторная защита (TOTP) ─────────────────────────────────────────────
function MfaChallenge({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function verify() {
    setBusy(true); setErr("");
    const { data: f } = await sb.auth.mfa.listFactors();
    const factor = f?.totp?.[0];
    if (!factor) { setErr("Аутентификатор не найден"); setBusy(false); return; }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (error) setErr("Неверный код. Проверьте время на телефоне и попробуйте снова.");
    else onDone();
    setBusy(false);
  }
  return (
    <div className="full-page">
      <div className="login-card">
        <ShieldCheck size={36} color="#4762c9"/>
        <h1>Код подтверждения</h1>
        <p>Введите 6 цифр из приложения-аутентификатора</p>
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
          value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}/>
        <button className="btn btn-primary btn-full" disabled={busy||code.length!==6} onClick={verify}>Подтвердить</button>
        {err&&<p className="error-msg">{err}</p>}
        <button className="btn btn-outline btn-full" style={{marginTop:10}} onClick={()=>sb.auth.signOut()}><LogOut size={16}/> Выйти</button>
      </div>
    </div>
  );
}

function MfaSetup({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const [state, setState] = useState<"loading"|"enabled"|"enroll">("loading");
  const [qr, setQr] = useState(""); const [secret, setSecret] = useState(""); const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  useEffect(() => { (async () => {
    const { data } = await sb.auth.mfa.listFactors();
    if ((data?.totp||[]).length>0) { setState("enabled"); return; }
    for (const f of (data?.all||[])) if (f.status==="unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data: en, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Taxpasso ${Date.now()}` });
    if (error||!en) { setMsg(error?.message||"Не удалось начать подключение"); setState("enroll"); return; }
    setFactorId(en.id); setQr(en.totp.qr_code); setSecret(en.totp.secret); setState("enroll");
  })(); }, []);
  async function verify() {
    setBusy(true); setMsg("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) setMsg("Неверный код. Попробуйте ещё раз."); else setState("enabled");
    setBusy(false);
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}
        onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();onClose();} if(e.key==="Tab"){
          const controls=dialogRef.current?.querySelectorAll<HTMLElement>("input,button:not(:disabled)");
          if(!controls?.length)return;
          if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls[controls.length-1].focus();}
          else if(!e.shiftKey&&document.activeElement===controls[controls.length-1]){e.preventDefault();controls[0].focus();}
        }}} onClick={e=>e.stopPropagation()}>
        <h2 id={titleId}>Двухфакторная защита</h2>
        {state==="loading"&&<p>Загрузка…</p>}
        {state==="enabled"&&<p>✓ Подключена. При входе потребуется код из приложения-аутентификатора.</p>}
        {state==="enroll"&&(
          <>
            <p>1. Откройте Google Authenticator, 1Password или другое приложение-аутентификатор и отсканируйте QR-код.</p>
            {qr&&<img src={qr} alt="QR-код для аутентификатора" style={{width:180,height:180,display:"block",margin:"8px auto"}}/>}
            {secret&&<p style={{fontSize:12,wordBreak:"break-all"}}>Или введите ключ вручную: <code>{secret}</code></p>}
            <p>2. Введите 6 цифр из приложения:</p>
            <input className="partner-select" aria-label="Шестизначный код из приложения-аутентификатора" inputMode="numeric" maxLength={6} placeholder="123456"
              value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}/>
            <div className="dialog-actions" style={{marginTop:12}}>
              <button className="btn btn-primary" disabled={busy||code.length!==6||!factorId} onClick={verify}>Подключить</button>
            </div>
          </>
        )}
        {msg&&<p className="error-msg">{msg}</p>}
        <div className="dialog-actions" style={{marginTop:12}}><button className="btn btn-outline" onClick={onClose}>Закрыть</button></div>
      </div>
    </div>
  );
}

function ApplyForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [qual, setQual] = useState("CAA");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send() {
    setBusy(true); setErr("");
    const { error } = await sb.from("partner_applications").insert({
      user_id: userId, full_name: name.trim(), qualification: qual, bio: bio.trim() || null,
    });
    if (error) setErr(error.message); else onDone();
    setBusy(false);
  }
  return (
    <div style={{ textAlign: "left", marginTop: 20 }}>
      <input className="partner-select" placeholder="ФИО *" value={name} onChange={e=>setName(e.target.value)} style={{ marginBottom: 10 }}/>
      <select className="partner-select" value={qual} onChange={e=>setQual(e.target.value)} style={{ marginBottom: 10 }}>
        <option>CAA</option><option>CPA</option><option>CAA/CPA</option>
      </select>
      <textarea className="note-area" placeholder="Коротко о себе (необязательно)" value={bio} onChange={e=>setBio(e.target.value)}/>
      <button className="btn btn-primary btn-full" style={{ marginTop: 10 }} disabled={busy || name.trim().length < 2} onClick={send}>
        {busy ? "Отправка…" : "Отправить заявку"}
      </button>
      {err && <p className="error-msg">{err}</p>}
    </div>
  );
}

function PendingScreen({ app, userId, onApplied }: { app: PartnerApp|null; userId?: string; onApplied?: () => void }) {
  if (!app && userId && onApplied) {
    return (
      <div className="full-page">
        <div className="pending-card">
          <ShieldCheck size={40} color="#4762c9"/>
          <h1>Заявка партнёра</h1>
          <p>Расскажите о себе, и администратор рассмотрит заявку.</p>
          <ApplyForm userId={userId} onDone={onApplied}/>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={()=>sb.auth.signOut()}>
            <LogOut size={16}/> Выйти
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="full-page">
      <div className="pending-card">
        <Clock size={40} color="#92400e"/>
        <h1>Заявка на проверке</h1>
        {app ? (
          <p>Ваша заявка ({app.qualification}) подана {fmt(app.created_at)}.<br/>
          Администратор рассмотрит её в ближайшее время.</p>
        ) : <p>Обратитесь к администратору для получения доступа.</p>}
        {app?.status==="rejected" && (
          <div className="alert danger" style={{marginTop:20,textAlign:"left"}}>
            <XCircle size={18}/> Заявка отклонена{app.reject_reason?": "+app.reject_reason:""}
          </div>
        )}
        <button className="btn btn-outline" style={{marginTop:24}} onClick={()=>sb.auth.signOut()}>
          <LogOut size={16}/> Выйти
        </button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState<User|null>(null);
  const [role, setRole] = useState<Role>("");
  const [app, setApp] = useState<PartnerApp|null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders"|"operations"|"applications">("orders");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [eligibilityProposals, setEligibilityProposals] = useState<EligibilityProposal[]>([]);
  const [specialistProposals, setSpecialistProposals] = useState<SpecialistProposal[]>([]);
  const [pendingReviewOrderIds, setPendingReviewOrderIds] = useState<string[]>([]);
  const [itinRecord, setItinRecord] = useState<ItinRecord|null>(null);
  const [itinEntry, setItinEntry] = useState("");
  const [itinAssignedOn, setItinAssignedOn] = useState("");
  const [irsEvents, setIrsEvents] = useState<IrsEvent[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order|null>(null);
  const [updatedId, setUpdatedId] = useState<string|null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [applications, setApplications] = useState<PartnerApp[]>([]);
  const [clientDocs, setClientDocs] = useState<ClientDoc[]>([]);
  const [documentReviewProposals, setDocumentReviewProposals] = useState<DocumentReviewProposal[]>([]);
  const [partnerDocs, setPartnerDocs] = useState<PartnerDoc[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const [rejectNote, setRejectNote] = useState("");
  const [partnerNote, setPartnerNote] = useState("");
  const [selectedPartner, setSelectedPartner] = useState("");
  const [docType, setDocType] = useState("articles");
  const [company, setCompany] = useState<Company|null>(null);
  const [coName, setCoName] = useState("");
  const [coEin, setCoEin] = useState("");
  const [coDate, setCoDate] = useState("");
  const [confirm, setConfirm] = useState<Confirm|null>(null);
  const [needMfa, setNeedMfa] = useState(false);
  const [showMfa, setShowMfa] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [cancelReason, setCancelReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundScope, setRefundScope] = useState("order");
  const [refundReason, setRefundReason] = useState("");
  // Миграция 020: должная сумма и цены продуктов. null — база ещё без 020, работаем по-старому.
  const [productPrices, setProductPrices] = useState<ProductPrice[]>([]);
  const [due, setDue] = useState<PaymentDue|null>(null);
  const [paidInput, setPaidInput] = useState("");
  const { toasts, add: toast } = useToasts();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (!data.user) setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((_, s) => setUser(s?.user||null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) bootstrap(); else setLoading(false); }, [user]);

  // Автообновление: партнёр и админ работают одновременно — подтягиваем свежие статусы
  // каждые 15 секунд и при возвращении на вкладку, чтобы кнопки сразу становились активными.
  useEffect(() => {
    if (role!=="admin"&&role!=="partner") return;
    const tick = () => { if (document.visibilityState==="visible") loadOrders(); };
    const id = window.setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [role]);

  async function bootstrap() {
    setLoading(true);
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel==="aal2" && aal.currentLevel!=="aal2") { setNeedMfa(true); setLoading(false); return; }
    setNeedMfa(false);
    const { data: prof } = await sb.from("profiles").select("role").eq("id", user!.id).single();
    // Кабинет доступен только ролям admin и partner; все остальные (в т.ч. client) — на экран заявки.
    const raw = prof?.role;
    const r: Role = raw === "admin" || raw === "partner" ? raw : "";
    setRole(r);
    if (r==="admin"||r==="partner") {
      await loadOrders(r);
      await loadPartners();
      if (r==="admin") { await loadApplications(); await loadPrices(); }
    } else {
      let { data: papp } = await sb.from("partner_applications").select("*").eq("user_id", user!.id).maybeSingle();
      const meta = user!.user_metadata || {};
      if (!papp && meta.partner_full_name) {
        await sb.from("partner_applications").insert({
          user_id: user!.id,
          full_name: String(meta.partner_full_name),
          qualification: ["CAA","CPA","CAA/CPA"].includes(meta.partner_qualification) ? meta.partner_qualification : "CAA",
          bio: meta.partner_bio ? String(meta.partner_bio) : null,
        });
        ({ data: papp } = await sb.from("partner_applications").select("*").eq("user_id", user!.id).maybeSingle());
      }
      setApp(papp);
    }
    setLoading(false);
  }

  async function loadOrders(activeRole: Role = role) {
    const [{ data: pr }, { data: ep }, { data: cos }, { data: sp }] = await Promise.all([
      sb.from("status_proposals").select("*"),
      sb.from("eligibility_proposals").select("*"),
      sb.from("companies").select("*"),
      sb.from("specialist_proposals").select("*"),
    ]);
    setProposals(pr||[]); setEligibilityProposals(ep||[]); setAllCompanies(cos||[]); setSpecialistProposals(sp||[]);
    if (activeRole==="admin") {
      const { data: reviewQueue } = await sb.from("document_review_proposals").select("order_id");
      setPendingReviewOrderIds((reviewQueue||[]).map(p=>p.order_id));
    } else setPendingReviewOrderIds([]);
    let data: any[] = [];
    if(activeRole==="partner"){
      const { data: partnerOrders } = await sb.rpc("partner_orders");
      const rows = partnerOrders||[];
      if(rows.length){
        const ids=rows.map((o:any)=>o.id);
        const { data: history } = await sb.from("order_status_history").select("*").in("order_id",ids);
        data=rows.map((o:any)=>({...o,order_status_history:(history||[]).filter((h:any)=>h.order_id===o.id)}));
      }
    } else {
      const { data: adminOrders } = await sb.from("orders").select("*,order_status_history(*)").order("created_at",{ascending:false});
      data=adminOrders||[];
    }
    setOrders(data);
    if(data.length>0) setSelected(s=>s?(data.find(o=>o.id===s.id)||data[0]):data[0]);
  }
  async function loadPartners() {
    const { data } = await sb.from("partners").select("*");
    setPartners(data||[]);
  }
  async function loadPrices() {
    const { data, error } = await sb.from("product_prices").select("product,price_cents,updated_at").order("price_cents");
    setProductPrices(error ? [] : (data||[]));
  }
  async function loadApplications() {
    const { data } = await sb.from("partner_applications").select("*").order("created_at",{ascending:false});
    setApplications(data||[]);
  }
  async function loadDocs(orderId: string) {
    const [c, p, reviewProposals] = await Promise.all([
      sb.from("documents").select("*").eq("order_id",orderId).order("created_at"),
      sb.from("partner_documents").select("*").eq("order_id",orderId).order("created_at"),
      sb.from("document_review_proposals").select("*").eq("order_id",orderId),
    ]);
    setClientDocs(c.data||[]);
    setDocumentReviewProposals(reviewProposals.data||[]);
    setPartnerDocs(p.data||[]);
    const [{ data: ir }, { data: events }] = await Promise.all([
      sb.from("order_itin").select("*").eq("order_id",orderId).maybeSingle(),
      sb.from("itin_irs_events").select("*").eq("order_id",orderId).order("created_at",{ascending:false}),
    ]);
    setItinRecord(ir||null);
    setItinEntry(ir?.itin||"");
    setItinAssignedOn(ir?.assigned_on||"");
    setIrsEvents(events||[]);
    const { data: co } = await sb.from("companies").select("*").eq("order_id",orderId).maybeSingle();
    setCompany(co||null);
    const { data: ms } = await sb.from("order_milestones").select("*").eq("order_id",orderId);
    setMilestones(ms||[]);
    if (role==="admin") {
      const [rf, au] = await Promise.all([
        sb.from("order_refunds").select("*").eq("order_id",orderId).order("created_at"),
        sb.from("audit_log").select("*").eq("order_id",orderId).order("at",{ascending:false}).limit(50),
      ]);
      setRefunds(rf.data||[]); setAudit(au.data||[]);
      const order = orders.find(o=>o.id===orderId);
      if (order && order.payment_status!=="paid" && order.product!=="itin_consult") {
        const { data: d, error: dErr } = await sb.rpc("order_payment_due", { p_order: orderId });
        const row = !dErr && Array.isArray(d) ? d[0] as PaymentDue : null;
        setDue(row||null); setPaidInput(row ? (row.total_cents/100).toString() : "");
      } else { setDue(null); setPaidInput(""); }
    } else { setRefunds([]); setAudit([]); setDue(null); }
  }

  useEffect(() => {
    if (selected) {
      loadDocs(selected.id); setRejectNote(""); setPartnerNote("");
      setCoName(selected.applicant?.company||""); setCoEin(""); setCoDate("");
    }
  }, [selected?.id]);
  useEffect(() => {
    if (company) { setCoName(company.name); setCoEin(company.ein||""); setCoDate(company.registered_on||""); }
  }, [company?.order_id, company?.ein, company?.registered_on]);

  async function rpc(fn: string, args: Record<string,unknown>, successMsg: string) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    const { data, error } = await sb.rpc(fn, args);
    if (error && error.message==="Status changed") { await loadOrders(); }
    if (error) {
      const money = moneyErrorMessage(error.message, (error as { details?: string }).details);
      const messages: Record<string,string> = {
        ...(money ? { [error.message]: money } : {}),
        "Operation id reused":"Действие уже обработано, обновите страницу",
        "Field too long":"Слишком длинное значение (имя ≤ 200, страна ≤ 100, компания ≤ 200, деятельность ≤ 1000)",
        "Invalid characters":"Уберите символы < и >",
        "Order setup incomplete":"Анкета не заполнена: владельцы, доли 100%, ответственный, данные компании, паспорта",
        "Invalid partner":"Этот партнёр не подходит для заказа",
        "Not released": role==="partner"?"Заказ ещё не передан в работу":"Заказ не оплачен",
        "Partner ITIN required":"Внесите номер ITIN",
        "Partner ITIN letter required":"Загрузите и отправьте письмо IRS (CP565)",
        "ITIN required":"Одобрите номер ITIN",
        "ITIN letter required":"Передайте клиенту письмо IRS (CP565)",
        "ITIN format must be 9XX-XX-XXXX":"Номер ITIN в формате 9XX-XX-XXXX",
        "Eligibility already decided":"Решение по основанию уже принято",
        "Partner must be CAA/CPA":"Для ITIN + декларации нужен партнёр CAA/CPA",
        "Partner must be CAA":"Для ITIN нужен партнёр с квалификацией CAA",
        "Not at IRS stage":"Действие доступно на этапе «Отправлено в IRS»",
        "Too many attempts":"Превышено число попыток подачи",
        "Document replaced":"Документ уже заменён клиентом",
        "No proposal":"Предложение уже обработано — обновите страницу",
        ...CONSULT_ERRORS,
      };
      toast("error", messages[error.message] || (error.message==="Payment required" ? (role==="partner"?"Заказ ещё не передан в работу":"Сначала нужна оплата") :
        error.message==="Eligibility approval required" ? "Сначала подтвердите основание ITIN" :
        error.message==="Partner eligibility approval required" ? "Основание ITIN ещё не подтверждено администратором" :
        error.message==="Admin only" ? "Только для администратора" :
        error.message==="Waiting for partner" ? "Партнёр ещё не дошёл до этого этапа" :
        error.message==="Partner EIN required" ? "Сначала внесите EIN в «Данные компании»" :
        error.message==="Partner documents required" ? "Загрузите и отправьте Articles, письмо EIN и Operating Agreement" :
        error.message==="Proposal outdated" ? "Предложение устарело, обновите страницу" :
        error.message==="Order closed" ? "Заказ закрыт" :
        error.message==="Order cancelled" ? "Заказ отменён" :
        error.message==="Status changed" ? "Статус уже изменился — страница обновлена, проверьте ещё раз" :
        error.message==="Already filed" ? "Нельзя отменить: документы уже поданы (у клиента или у партнёра)" :
        error.message==="Reason required" ? "Укажите причину" :
        error.message==="Amount must be positive" ? "Сумма должна быть больше нуля" :
        error.message==="MFA required" ? "Нужен вход с кодом из приложения-аутентификатора" :
        error.message==="Company EIN required" ? "Нужны EIN и одобрение данных компании администратором" :
        error.message==="Final documents required" ? "Передайте клиенту Articles, письмо EIN и Operating Agreement" :
        error.message==="EIN format must be 12-3456789" ? "EIN в формате 12-3456789" :
        error.message==="Invalid registration date" ? "Укажите дату регистрации (не в будущем)" :
        "Не удалось выполнить действие"));
      await loadOrders();
      if (selected) await loadDocs(selected.id);
    } else {
      toast(data==="already_done" ? "info" : "success", data==="already_done" ? "Уже выполнено ранее" : successMsg);
      const prevId = selected?.id;
      await loadOrders();
      if (prevId) {
        await loadDocs(prevId);
        setUpdatedId(prevId);
        setTimeout(() => setUpdatedId(null), 1200);
      }
      if (fn.includes("application")) await loadApplications();
      if (fn==="set_product_price") await loadPrices();
      if (fn.includes("partner")&&role==="admin") await loadPartners();
    }
    actionInFlight.current = false;
    setBusy(false);
  }

  async function openDoc(path: string) {
    const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 60);
    if (error) toast("error", "Не удалось открыть документ");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function uploadPartnerDoc(file: File) {
    if (!selected||!user) return;
    const myPartner = partners.find(p => p.profile_id===user.id);
    if (!myPartner) { toast("error", "Профиль партнёра не найден. Обратитесь к администратору."); return; }
    if (!["application/pdf","image/jpeg","image/png"].includes(file.type) || file.size > 10*1024*1024) {
      toast("error", "Только PDF, JPG или PNG до 10 МБ"); return;
    }
    setBusy(true);
    const ext = file.name.split(".").pop();
    const path = `${selected.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { toast("error", "Не удалось загрузить файл"); setBusy(false); return; }
    const { error: dbErr } = await sb.from("partner_documents").insert({
      order_id: selected.id, partner_id: myPartner.id, uploaded_by: user.id,
      path, name: file.name, mime_type: file.type, size_bytes: file.size,
      note: partnerNote.trim()||null, doc_type: docType,
    });
    if (dbErr) toast("error", "Не удалось сохранить документ");
    else { toast("success", `Загружено: ${DOC_TYPES[docType]}. Теперь нажмите «Отправить».`); await loadDocs(selected.id); setPartnerNote(""); }
    setBusy(false);
  }

  // Партнёр видит свой прогресс (status_proposals), админ и клиент — подтверждённый статус.
  const viewOrder = (o: Order): Order => {
    if (role!=="partner") return o;
    const pm = proposals.find(p=>p.order_id===o.id&&p.stream==="main");
    const pi = proposals.find(p=>p.order_id===o.id&&p.stream==="itin");
    return { ...o, status: pm?.proposed_status||o.status, itin_status: pi?.proposed_status||o.itin_status };
  };
  const filtered = orders.filter(o => showClosed ? !!o.closed_at : !o.closed_at).filter(o =>
    (o.applicant?.company||o.applicant?.name||o.product).toLowerCase().includes(query.toLowerCase())
  );

  // Next step logic
  function getNextStep(o: Order): { status: string; label: string } | null {
    const ch = chain(o.product);
    const idx = ch.indexOf(o.status);
    if (idx<0||idx>=ch.length-1) return null;
    const next = ch[idx+1];
    return { status: next, label: STATUS[next]||next };
  }

  if (loading) return <div className="full-page"><p style={{color:"#667085"}}>Загрузка…</p></div>;
  if (!user) return <LoginScreen onAuth={u=>setUser(u)}/>;
  if (needMfa) return <MfaChallenge onDone={()=>{ setNeedMfa(false); bootstrap(); }}/>;
  if (!role) return <PendingScreen app={app} userId={user.id} onApplied={bootstrap}/>;
  if (app?.status==="rejected") return <PendingScreen app={app}/>;

  const pendingApps = applications.filter(a=>a.status==="pending");
  // После одобрения консультации заказ становится обычным ITIN, но специалист остаётся назначен,
  // пока админ не передаст его CAA/CPA. Специалисту в это время действия ITIN не показываем.
  const selectedPartnerIsSpecialist = !!selected && partners.find(p=>p.id===selected.partner_id)?.qualification==="SPECIALIST";
  const specialistHandoff = role==="partner" && !!selected && selected.product!=="itin_consult" && selectedPartnerIsSpecialist
    && partners.find(p=>p.id===selected.partner_id)?.profile_id===user.id;

  return (
    <div className="shell">
      <Toasts toasts={toasts}/>
      {showMfa&&<MfaSetup onClose={()=>setShowMfa(false)}/>}
      {confirm && <ConfirmDialog c={confirm} onCancel={()=>setConfirm(null)}/>}

      <header>
        <div className="brand">Taxpasso <span>PARTNERS</span></div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {role==="admin" && (
            <div className="nav-tabs">
              <button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>
                <ClipboardList size={14} style={{marginRight:5,verticalAlign:-2}}/> Заказы
              </button>
              <button className={tab==="operations"?"active":""} onClick={()=>setTab("operations")}>
                <ShieldCheck size={14} style={{marginRight:5,verticalAlign:-2}}/> Operations
              </button>
              <button className={tab==="applications"?"active":""} onClick={()=>setTab("applications")}>
                <Users size={14} style={{marginRight:5,verticalAlign:-2}}/> Заявки
                {pendingApps.length>0&&<span className="badge pending-el" style={{marginLeft:5}}>{pendingApps.length}</span>}
              </button>
            </div>
          )}
          <button className="icon-btn" title="Двухфакторная защита" onClick={()=>setShowMfa(true)}><ShieldCheck size={17}/></button>
          <span className="role-badge">{role.toUpperCase()}</span>
          <button className="icon-btn" onClick={()=>sb.auth.signOut()} title="Выйти"><LogOut size={17}/></button>
        </div>
      </header>

      {/* ─── Applications tab ──────────────────────────────────────── */}
      {tab==="applications"&&role==="admin"&&(
        <div className="app-list">
          {applications.length===0&&(
            <div className="empty-state"><Users size={40}/><h2>Нет заявок</h2><p>Новые заявки партнёров появятся здесь.</p></div>
          )}
          {applications.map(a=>(
            <div className="app-card" key={a.id}>
              <div className="app-info">
                <h3>{a.full_name}</h3>
                <p>{a.qualification} · {fmt(a.created_at)}</p>
                {a.bio&&<p style={{marginTop:4,color:"#475569"}}>{a.bio}</p>}
                {a.reject_reason&&<p style={{color:"#a32828",marginTop:4}}>Причина: {a.reject_reason}</p>}
              </div>
              <span className={`badge ${a.status==="pending"?"pending-app":a.status==="approved"?"approved-app":"rejected-app"}`}>
                {a.status==="pending"?"На рассмотрении":a.status==="approved"?"Одобрен":"Отклонён"}
              </span>
              {a.status==="pending"&&(
                <div className="app-actions">
                  <button className="btn btn-success btn-sm" disabled={busy}
                    onClick={()=>setConfirm({
                      title:"Одобрить партнёра?",
                      body:`${a.full_name} получит роль партнёра и доступ к назначенным заказам.`,
                      confirmLabel:"Одобрить",
                      onConfirm:()=>rpc("approve_partner_application",{p_app:a.id},"Партнёр одобрен")
                    })}>
                    <CheckCircle2 size={14}/> Одобрить
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy}
                    onClick={()=>{
                      const reason=prompt("Причина отказа (необязательно)")||"";
                      setConfirm({
                        title:"Отклонить заявку?",
                        body:`Партнёру ${a.full_name} будет отказано в доступе.`,
                        confirmLabel:"Отклонить",danger:true,
                        onConfirm:()=>rpc("reject_partner_application",{p_app:a.id,p_reason:reason},"Заявка отклонена")
                      });
                    }}>
                    <XCircle size={14}/> Отклонить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Operations tab (admin) ────────────────────────────────── */}
      {tab==="operations"&&role==="admin"&&(()=>{
        const ops = orders.filter(o=>o.closed_at&&!o.cancelled_at&&!o.product.startsWith("itin"))
          .sort((a,b)=>(a.service_until||"").localeCompare(b.service_until||""));
        return (
          <div className="app-list">
            <ProductPrices prices={productPrices} names={PROD} busy={busy}
              onSave={(product,cents)=>setConfirm({
                title:`Цена ${PROD[product]||product}: ${usd(cents)}?`,
                body:"Новая цена сразу применяется к оплате новых и неоплаченных заказов. Сначала обновите цену на сайте, чтобы суммы совпадали.",
                confirmLabel:"Сохранить цену",
                onConfirm:()=>rpc("set_product_price",{p_product:product,p_price_cents:cents},"Цена обновлена"),
              })}/>
            {ops.length===0&&<div className="empty-state"><ShieldCheck size={40}/><h2>Нет компаний на обслуживании</h2><p>Закрытые заказы LLC появятся здесь.</p></div>}
            {ops.map(o=>{
              const co = allCompanies.find(c=>c.order_id===o.id);
              const days = o.service_until ? Math.round((new Date(o.service_until+"T12:00:00").getTime()-Date.now())/86400000) : null;
              return (
                <div className="app-card" key={o.id}>
                  <div className="app-info">
                    <h3>{co?.name||o.applicant?.company||"Компания"}</h3>
                    <p>{co?.state==="DE"?"Delaware":"Wyoming"} · EIN {co?.ein||"—"} · пакет {o.service_years||1} {(o.service_years||1)===1?"год":"года"}</p>
                    <p>Обслуживание до {o.service_until?new Date(o.service_until+"T12:00:00").toLocaleDateString("ru-RU"):"—"}</p>
                  </div>
                  {days!==null&&(
                    <span className={`badge ${days<0?"pending-el":days<=60?"unpaid":"approved-el"}`}>
                      {days<0?`Истёк ${-days} дн. назад`:days<=60?`Продление через ${days} дн.`:`Активно · ${days} дн.`}
                    </span>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={()=>{ setSelected(o); setShowClosed(true); setTab("orders"); }}>Открыть</button>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ─── Orders tab ────────────────────────────────────────────── */}
      {tab==="orders"&&(
        <div className="workspace">
          <aside>
            <div className="aside-header">
              <span className="aside-title">ЗАКАЗЫ</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="aside-count">{orders.length}</span>
                <button className="icon-btn btn-sm" onClick={()=>loadOrders()} disabled={busy} title="Обновить">
                  <RefreshCw size={14}/>
                </button>
              </div>
            </div>
            <div className="login-tabs" style={{marginBottom:10}}>
              <button className={!showClosed?"active":""} onClick={()=>setShowClosed(false)}>В работе</button>
              <button className={showClosed?"active":""} onClick={()=>setShowClosed(true)}>Закрытые</button>
            </div>
            <div className="search-box">
              <Search size={15} color="#94a3b8"/>
              <input aria-label="Поиск заказов" placeholder="Поиск…" value={query} onChange={e=>setQuery(e.target.value)}/>
            </div>
            {filtered.length===0&&<p style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"20px 0"}}>Заказов нет</p>}
            {filtered.map(o=>(
              <button key={o.id}
                className={`order-item ${selected?.id===o.id?"active":""} ${updatedId===o.id?"updated":""}`}
                onClick={()=>setSelected(o)}>
                <strong>{o.applicant?.company||o.applicant?.name||"Без названия"}</strong>
                <small>{PROD[o.product]||o.product} · {STATUS[viewOrder(o).status]||o.status}</small>
                <div className="badges">
                  {o.cancelled_at ? <span className="badge pending-el">Отменён</span> : o.closed_at&&<span className="badge approved-el">Закрыт</span>}
                  {role==="admin"&&(proposals.some(p=>p.order_id===o.id)||eligibilityProposals.some(p=>p.order_id===o.id)||specialistProposals.some(p=>p.order_id===o.id)||pendingReviewOrderIds.includes(o.id))&&(
                    <span className="badge doc-review">Ждёт вашего подтверждения</span>
                  )}
                  {o.product==="itin_consult" ? <span className="badge status">Консультация{role==="admin"&&!o.partner_id&&!o.closed_at&&o.status!=="draft"?" · нужен специалист":""}</span> :
                  role==="admin" ? <span className={`badge ${o.payment_status==="paid"?"paid":"unpaid"}`}>
                    {o.payment_status==="paid"?"Оплачено":"Ожидает оплаты"}
                  </span> : <span className={`badge ${o.in_work?"paid":"unpaid"}`}>
                    {o.in_work?"В работе":"Ожидает передачи в работу"}
                  </span>}
                  {o.product!=="itin_consult"&&(o.product.includes("itin")||o.product.includes("bundle"))&&(
                    <span className={`badge ${o.eligibility==="approved"?"approved-el":o.eligibility==="rejected"?"pending-el":"unpaid"}`}>
                      ITIN: {o.eligibility==="approved"?"✓ Одобрен":o.eligibility==="rejected"?"✗ Отклонён":"На проверке"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </aside>

          <div className="detail">
            {!selected?(
              <div className="empty-state"><FileText size={42}/><h2>Выберите заказ</h2></div>
            ):(
              <>
                {/* Head */}
                <div className="detail-head">
                  <div>
                    <span className="eyebrow">ORDER / {selected.id.slice(0,8)}</span>
                    <h1>{selected.applicant?.company||selected.applicant?.name||"Заказ"}</h1>
                    <p>{PROD[selected.product]||selected.product} · создан {fmt(selected.created_at)}</p>
                    {selected.partner_id&&(
                      <div className="assigned-chip">
                        <UserCheck size={14}/>
                        {partners.find(p=>p.id===selected.partner_id)?.display_name||"Партнёр назначен"}
                      </div>
                    )}
                  </div>
                  <span className="status-pill">{STATUS[viewOrder(selected).status]||selected.status}</span>
                </div>

                {selected.cancelled_at&&(
                  <div className="alert danger"><XCircle size={16}/> Заказ отменён {fmt(selected.cancelled_at)}{selected.cancel_reason?`: ${selected.cancel_reason}`:""}</div>
                )}
                {milestones.map(m=>(
                  <div key={m.milestone} className="alert info">
                    <ShieldCheck size={16}/> {m.milestone==="state_filed"?"Документы поданы в штат":"W-7 отправлена в IRS"} {fmt(m.recorded_at)}
                    {m.partner_id&&role==="admin"?` · ${partners.find(p=>p.id===m.partner_id)?.display_name||"партнёр"}`:""}. Повторно не подавать.
                  </div>
                ))}

                {selected.product==="itin_consult" ? (
                  <ConsultPanel order={selected} role={role as "admin"|"partner"} partners={partners}
                    proposal={specialistProposals.find(p=>p.order_id===selected.id)||null}
                    busy={busy} rpc={rpc} askConfirm={setConfirm}/>
                ) : specialistHandoff ? (
                  <div className="alert info"><CheckCircle2 size={16}/> Консультация завершена: администратор подтвердил план «{PROD[selected.product]||selected.product}». Заказ передаётся партнёру CAA/CPA, действий для специалиста нет.</div>
                ) : (<>
                {role==="admin"&&selectedPartnerIsSpecialist&&(
                  <div className="alert warn"><AlertCircle size={16}/> После консультации назначен специалист. Назначьте {selected.product==="itin_return"?"партнёра CAA/CPA":"партнёра CAA или CAA/CPA"} в блоке «Назначить CAA/CPA».</div>
                )}
                {/* Status tracker */}
                <StatusTracker order={viewOrder(selected)}/>

                {/* Alerts */}
                {role==="admin"&&selected.payment_status!=="paid"&&(
                  <div className="alert warn">
                    <AlertCircle size={16}/>
                    {role==="admin"?"Заказ не оплачен. Отметьте оплату вручную после получения перевода.":"Ожидается оплата от клиента."}
                  </div>
                )}
                {selected.eligibility==="rejected"&&(
                  <div className="alert danger">
                    <XCircle size={16}/> ITIN отклонён: {selected.eligibility_note||"причина не указана"}
                  </div>
                )}
                {role==="admin"&&selected.product.startsWith("bundle")&&selected.eligibility==="rejected"&&!refunds.some(r=>r.scope==="itin"&&r.amount_cents===10000)&&(
                  <div className="alert warn">
                    <AlertCircle size={16}/> Верните клиенту $100 (доля ITIN).
                    <button className="btn btn-outline btn-sm" onClick={()=>{
                      setRefundAmount("100"); setRefundScope("itin"); setRefundReason("Отказ в основании ITIN");
                      document.getElementById("refund-entry")?.scrollIntoView({behavior:"smooth",block:"center"});
                    }}>Записать возврат $100</button>
                  </div>
                )}
                {selected.eligibility==="approved"&&(selected.product.includes("itin")||selected.product.includes("bundle"))&&(
                  <div className="alert success"><CheckCircle2 size={16}/> Основание ITIN подтверждено</div>
                )}

                <div className="grid-2">
                  {/* Анкета */}
                  <div className="card">
                    <h2>Анкета клиента</h2>
                    <dl>
                      {Object.entries(selected.applicant||{}).map(([k,v])=>(
                        <div key={k}><dt>{k}</dt><dd>{v||"—"}</dd></div>
                      ))}
                    </dl>
                  </div>

                  {/* Действия */}
                  <div className="card">
                    <h2>Действия</h2>

                    {(selected.product.startsWith("itin")||selected.product.startsWith("bundle"))&&(
                      <div className="action-section">
                        <div className="action-label">{role==="admin"?"ОСНОВАНИЕ ITIN · РЕШЕНИЕ АДМИНИСТРАТОРА":"ОСНОВАНИЕ ITIN"}</div>
                        {eligibilityProposals.find(p=>p.order_id===selected.id)&&(()=>{
                          const proposal=eligibilityProposals.find(p=>p.order_id===selected.id)!;
                          return <div className="alert warn" style={{marginBottom:10}}>
                            <AlertCircle size={15}/> {role==="admin"?"Партнёр предлагает:":"Ваше решение отправлено:"} {proposal.decision==="approve"?"одобрить":"отклонить"}
                            {proposal.reason&&<span> · {proposal.reason}</span>}
                          </div>;
                        })()}
                        {role==="partner"&&!eligibilityProposals.some(p=>p.order_id===selected.id)&&(selected.eligibility==="pending"||(selected.product.startsWith("bundle")&&selected.eligibility==="approved"))&&(
                          <div className="doc-actions">
                            <button className="btn btn-success btn-sm" disabled={busy}
                              onClick={()=>rpc("propose_eligibility",{p_order:selected.id,p_decision:"approve",p_reason:null,p_op:crypto.randomUUID()},"Ваше решение отправлено")}>
                              Предложить: основание подтверждено
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busy}
                              onClick={()=>{
                                const reason=prompt("Почему основание ITIN не подходит?");
                                if(reason?.trim()) rpc("propose_eligibility",{p_order:selected.id,p_decision:"reject",p_reason:reason.trim(),p_op:crypto.randomUUID()},"Ваше решение отправлено");
                              }}>
                              Предложить отказ
                            </button>
                          </div>
                        )}
                        {role==="admin"&&eligibilityProposals.some(p=>p.order_id===selected.id)&&(
                          <div className="doc-actions">
                            <button className="btn btn-success btn-sm" disabled={busy}
                              onClick={()=>rpc("confirm_eligibility",{p_order:selected.id,p_op:crypto.randomUUID()},"Решение по основанию подтверждено")}>
                              <Check size={13}/> Подтвердить
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={busy}
                              onClick={()=>rpc("return_eligibility_proposal",{p_order:selected.id},"Предложение возвращено партнёру")}>
                              Вернуть
                            </button>
                          </div>
                        )}
                        {role==="admin"&&selected.eligibility!=="approved"&&(
                          <button className="btn btn-success btn-full" disabled={busy} style={{marginTop:8}}
                            onClick={()=>rpc("approve_eligibility",{p_order:selected.id},"Основание одобрено; ITIN-клиент уведомлён")}>
                            Решить самому: одобрить
                          </button>
                        )}
                        {role==="admin"&&selected.eligibility!=="rejected"&&(
                          <button className="btn btn-danger btn-full" disabled={busy} style={{marginTop:8}}
                            onClick={()=>{
                              const reason=prompt("Причина отказа в основании ITIN");
                              if(reason?.trim()) rpc("reject_eligibility",{p_order:selected.id,p_reason:reason.trim()},"Основание отклонено; ITIN-клиент уведомлён");
                            }}>
                            Решить самому: отклонить
                          </button>
                        )}
                      </div>
                    )}

                    {/* Этапы: партнёр предлагает → admin подтверждает */}
                    {selected.closed_at&&(
                      <div className="action-section">
                        <div className="assigned-chip" style={{background:"#f0fdf4",color:"#15803d"}}>
                          <CheckCircle2 size={14}/> Заказ закрыт {fmt(selected.closed_at)}
                          {role==="admin"&&selected.service_until&&<span style={{color:"#667085",marginLeft:4}}>· обслуживание до {new Date(selected.service_until+"T12:00:00").toLocaleDateString("ru-RU")}</span>}
                        </div>
                      </div>
                    )}
                    {!selected.closed_at&&(role==="partner"?selected.in_work:selected.payment_status==="paid")&&(["main","itin"] as const)
                      .filter(stream=>stream==="main"||(selected.product.startsWith("bundle")&&!!selected.itin_status))
                      .map(stream=>{
                        const prop = proposals.find(p=>p.order_id===selected.id&&p.stream===stream);
                        const clientCur = stream==="itin" ? selected.itin_status||"" : selected.status;
                        const cur = role==="partner" ? (prop?.proposed_status||clientCur) : clientCur;
                        const ch = stream==="itin" ? ITIN_CHAIN : chain(selected.product);
                        const idx = ch.indexOf(cur);
                        if (idx<0||idx>=ch.length-1) return null;
                        const next = ch[idx+1]; const label = STATUS[next]||next;
                        const partnerAhead = !!prop && prop.proposed_status!==clientCur;
                        const noPartner = !selected.partner_id;
                        return (
                          <div className="action-section" key={stream}>
                            <div className="action-label">{stream==="itin"?"СЛЕДУЮЩИЙ ЭТАП ITIN":"СЛЕДУЮЩИЙ ЭТАП"}</div>
                            {role==="partner"&&(
                              <>
                                <button className="next-step-btn" disabled={busy}
                                  onClick={()=>setConfirm({
                                    title:`Перевести в «${label}»?`,
                                    body: STEP_HINTS[next]||"Подтвердите переход на следующий этап.",
                                    confirmLabel:"Перевести",
                                    onConfirm:()=>rpc("propose_status",{p_order:selected.id,p_stream:stream,p_to:next,p_op:crypto.randomUUID()},`Статус → ${label}`)
                                  })}>
                                  <span>{label}</span><span className="step-arrow"><ArrowRight size={13}/></span>
                                </button>
                                {STEP_HINTS[next]&&<div className="step-hint">{STEP_HINTS[next]}</div>}
                              </>
                            )}
                            {role==="admin"&&(
                              <>
                                <button className="next-step-btn" disabled={busy||(!partnerAhead&&!noPartner)}
                                  onClick={()=>setConfirm({
                                    title:`Уведомить клиента: «${label}»?`,
                                    body:"Клиент сразу увидит новый статус в своём кабинете.",
                                    confirmLabel:"Подтвердить",
                                    onConfirm:()=>rpc("confirm_status",{p_order:selected.id,p_stream:stream,p_to:next,p_op:crypto.randomUUID()},`Клиент видит: ${label}`)
                                  })}>
                                  <span>{partnerAhead||noPartner?`Подтвердить: ${label}`:`Ждём партнёра: ${label}`}</span>
                                  <span className="step-arrow"><ArrowRight size={13}/></span>
                                </button>
                                <div className="step-hint">
                                  {partnerAhead ? `Партнёр на этапе «${STATUS[prop!.proposed_status]||prop!.proposed_status}» · клиент видит «${STATUS[clientCur]||clientCur}».`
                                    : noPartner ? "Партнёр не назначен — можно переводить самостоятельно."
                                    : "Кнопка станет активной, когда партнёр перейдёт на этот этап."}
                                </div>
                                {partnerAhead&&(
                                  <button className="btn btn-danger btn-sm" style={{marginTop:8}} disabled={busy}
                                    onClick={()=>setConfirm({
                                      title:"Вернуть партнёра к текущему этапу клиента?",
                                      body:`Прогресс партнёра откатится до «${STATUS[clientCur]||clientCur}».`,
                                      confirmLabel:"Вернуть",danger:true,
                                      onConfirm:()=>rpc("reject_status_proposal",{p_order:selected.id,p_stream:stream},"Прогресс партнёра возвращён")
                                    })}>↩ Вернуть партнёру</button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}

                    {/* Отмена (admin) */}
                    {role==="admin"&&!selected.closed_at&&(
                      <div className="action-section">
                        <div className="action-label">ОТМЕНА ЗАКАЗА</div>
                        {milestones.length>0 ? (
                          <div className="step-hint">Отмена недоступна: документы уже поданы ({milestones.map(m=>m.milestone==="state_filed"?"в штат":"в IRS").join(", ")}).</div>
                        ) : (
                          <>
                            <textarea className="note-area" aria-label="Причина отмены заказа" placeholder="Причина отмены *" value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/>
                            <button className="btn btn-danger btn-full" style={{marginTop:6}} disabled={busy||cancelReason.trim().length<3}
                              onClick={()=>setConfirm({
                                title:"Отменить заказ?",
                                body:`Причина: «${cancelReason.trim()}». Отмена не возвращает деньги — сумму возврата запишите отдельно ниже.`,
                                confirmLabel:"Отменить заказ",danger:true,
                                onConfirm:()=>{ rpc("cancel_order",{p_order:selected.id,p_reason:cancelReason,p_op:crypto.randomUUID()},"Заказ отменён"); setCancelReason(""); }
                              })}>
                              <XCircle size={15}/> Отменить заказ
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Возврат (admin) */}
                    {role==="admin"&&selected.payment_status==="paid"&&(
                      <div className="action-section">
                        <div className="action-label" id="refund-entry">ВОЗВРАТ СРЕДСТВ</div>
                        {selected.amount_cents!=null&&(()=>{ const r=refunds.reduce((a,x)=>a+x.amount_cents,0);
                          return <div className="step-hint" style={{marginBottom:8}}>Оплачено {usd(selected.amount_cents)}, уже возвращено {usd(r)}, доступно {usd(Math.max(0,selected.amount_cents-r))}</div>; })()}
                        <div style={{display:"flex",gap:8}}>
                          <input className="partner-select" aria-label="Сумма возврата в долларах" style={{flex:1}} type="number" min={1} step="0.01" placeholder="Сумма, $" value={refundAmount} onChange={e=>setRefundAmount(e.target.value)}/>
                          <select className="partner-select" aria-label="Часть заказа для возврата" style={{flex:1}} value={refundScope} onChange={e=>setRefundScope(e.target.value)}>
                            <option value="order">Весь заказ</option>
                            {(selected.product.startsWith("llc")||selected.product.startsWith("bundle"))&&<option value="llc">LLC</option>}
                            {(selected.product.startsWith("itin")||selected.product.startsWith("bundle"))&&<option value="itin">ITIN</option>}
                            <option value="other">Другое</option>
                          </select>
                        </div>
                        <textarea className="note-area" aria-label="Причина и расчёт возврата" placeholder="Причина и расчёт возврата *" value={refundReason} onChange={e=>setRefundReason(e.target.value)}/>
                        <button className="btn btn-outline btn-full" style={{marginTop:6}}
                          disabled={busy||!(Number(refundAmount)>0)||refundReason.trim().length<3}
                          onClick={()=>{
                            const cents = Math.round(Number(refundAmount)*100);
                            setConfirm({
                              title:`Записать возврат $${(cents/100).toFixed(2)}?`,
                              body:"Запись нельзя изменить или удалить. Клиент увидит её в кабинете. Сами деньги переводите отдельно.",
                              confirmLabel:"Записать",
                              onConfirm:()=>{ rpc("record_refund",{p_order:selected.id,p_amount_cents:cents,p_scope:refundScope,p_reason:refundReason,p_op:crypto.randomUUID()},"Возврат записан"); setRefundAmount(""); setRefundReason(""); }
                            });
                          }}>Записать возврат</button>
                        {refunds.map(r=>(
                          <div key={r.id} className="step-hint">↩ ${(r.amount_cents/100).toFixed(2)} · {r.scope} · {fmt(r.created_at)} · {r.reason}</div>
                        ))}
                      </div>
                    )}

                    {/* Срок пакета (admin) */}
                    {role==="admin"&&!selected.product.startsWith("itin")&&(
                      <div className="action-section">
                        <div className="action-label">СРОК ОБСЛУЖИВАНИЯ</div>
                        <select className="partner-select" value={selected.service_years||1} disabled={busy}
                          onChange={e=>rpc("set_service_years",{p_order:selected.id,p_years:Number(e.target.value)},"Срок пакета обновлён")}>
                          {[1,2,3,4,5].map(y=><option key={y} value={y}>{y} {y===1?"год":y<5?"года":"лет"}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Оплата */}
                    {role==="admin"&&selected.payment_status!=="paid"&&(
                      <div className="action-section">
                        <div className="action-label">ОПЛАТА</div>
                        {(()=>{ const gated=selected.product.startsWith("itin")&&selected.eligibility!=="approved";
                          return gated ? <div className="step-hint" style={{marginBottom:8}}>Оплату можно отметить только после одобрения основания ITIN. Сейчас: {selected.eligibility==="rejected"?"отклонено":"на проверке"}.</div> : null; })()}
                        {due&&(
                          <>
                            <div className="step-hint" style={{marginBottom:8}}>
                              К получению: <b>{usd(due.total_cents)}</b> (пакет {usd(due.base_cents)}{due.addons_cents>0?` + услуги ${usd(due.addons_cents)}`:""})
                            </div>
                            <label style={{display:"block",marginBottom:8}}>
                              <span className="step-hint">Получено, $</span>
                              <input className="partner-select" type="number" min={0} step="0.01" aria-label="Получено, $"
                                value={paidInput} onChange={e=>setPaidInput(e.target.value)}/>
                            </label>
                          </>
                        )}
                        <button className="btn btn-primary btn-full"
                          disabled={busy||(selected.product.startsWith("itin")&&selected.eligibility!=="approved")||(!!due&&!(Number(paidInput)>0))}
                          onClick={()=>{
                            const note=prompt("Комментарий к оплате (необязательно)")||"";
                            const cents = due ? Math.round(Number(paidInput)*100) : null;
                            setConfirm({
                              title: cents!==null ? `Отметить оплату ${usd(cents)}?` : "Отметить оплату вручную?",
                              body:"Убедитесь, что перевод получен. Это действие нельзя отменить.",
                              confirmLabel:"Отметить оплату",
                              // С миграцией 020 — всегда форма с суммой; без неё (старая база) — прежний вызов.
                              onConfirm:()=>rpc("mark_order_paid_manually",
                                cents!==null ? {p_order:selected.id,p_note:note,p_amount_cents:cents} : {p_order:selected.id,p_note:note},
                                "Оплата отмечена")
                            });
                          }}>
                          <CheckCircle2 size={15}/> Отметить оплату
                        </button>
                      </div>
                    )}
                    {selected.payment_status==="paid"&&selected.payment_marked_manually&&(
                      <div className="action-section">
                        <div className="assigned-chip" style={{background:"#f0fdf4",color:"#15803d"}}>
                          <Check size={13}/> Оплата отмечена вручную
                          {selected.payment_note&&<span style={{color:"#667085",marginLeft:4}}>· {selected.payment_note}</span>}
                        </div>
                      </div>
                    )}

                    {/* Назначение партнёра (admin) */}
                    {role==="admin"&&(
                      <div className="action-section">
                        <div className="action-label">НАЗНАЧИТЬ CAA/CPA</div>
                        <select className="partner-select" value={selectedPartner}
                          onChange={e=>setSelectedPartner(e.target.value)}>
                          <option value="">— выберите специалиста —</option>
                          {partners.filter(p=>p.qualification!=="SPECIALIST").filter(p=>selected.product==="itin_return"?p.qualification==="CAA/CPA":selected.product==="itin_standard"||selected.product.startsWith("bundle")?p.qualification==="CAA"||p.qualification==="CAA/CPA":true).map(p=>(
                            <option key={p.id} value={p.id}>{p.display_name} · {p.qualification}</option>
                          ))}
                        </select>
                        <button className="btn btn-outline btn-full" style={{marginTop:8}}
                          disabled={busy||!selectedPartner}
                          onClick={()=>setConfirm({
                            title:"Назначить партнёра?",
                            body:`Специалист получит доступ к этому заказу и документам клиента.`,
                            confirmLabel:"Назначить",
                            onConfirm:()=>{ rpc("assign_partner",{p_order:selected.id,p_partner:selectedPartner},"Партнёр назначен"); setSelectedPartner(""); }
                          })}>
                          <Send size={14}/> Назначить
                        </button>
                      </div>
                    )}


                  </div>
                </div>

                {(selected.product.startsWith("itin")||selected.product.startsWith("bundle"))&&(
                  <div className="card" style={{marginBottom:18}}>
                    <h2>Номер ITIN</h2>
                    {itinRecord&&<div className="alert info" style={{marginBottom:10}}>
                      {itinRecord.approved?"Одобрен администратором — клиент видит номер: ":"Внесён партнёром — клиент пока не видит номер: "}
                      <b>{itinRecord.itin}</b>
                      {itinRecord.assigned_on&&<span> · дата присвоения {itinRecord.assigned_on}</span>}
                    </div>}
                    {(role==="admin"||(role==="partner"&&["sent_irs","itin_received"].includes(selected.product.startsWith("bundle")?selected.itin_status||"":viewOrder(selected).status)))&&(
                      <div className="grid-2">
                        <input className="partner-select" aria-label="Номер ITIN в формате 9XX-XX-XXXX" placeholder="9XX-XX-XXXX" value={itinEntry} onChange={e=>setItinEntry(e.target.value)} />
                        <input className="partner-select" aria-label="Дата присвоения ITIN" type="date" value={itinAssignedOn} onChange={e=>setItinAssignedOn(e.target.value)} />
                        <button className="btn btn-primary" disabled={busy||!/^9[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(itinEntry)}
                          onClick={()=>rpc("record_itin",{p_order:selected.id,p_itin:itinEntry,p_assigned_on:itinAssignedOn||null},role==="admin"?"✓ Сохранено и одобрено":"✓ Сохранено")}>
                          Сохранить ITIN
                        </button>
                      </div>
                    )}
                    {(role==="admin"||(role==="partner"&&["sent_irs","itin_received"].includes(selected.product.startsWith("bundle")?selected.itin_status||"":viewOrder(selected).status)))&&
                      <p className="step-hint">Формат номера: 9XX-XX-XXXX. Кнопка станет доступной после ввода полного номера.</p>}
                    {role==="admin"&&itinRecord&&!itinRecord.approved&&(
                      <button className="btn btn-success" disabled={busy}
                        onClick={()=>rpc("approve_itin",{p_order:selected.id},"Номер ITIN одобрен; теперь он виден клиенту")}>
                        Одобрить ITIN для клиента
                      </button>
                    )}
                    <div className="action-section" style={{marginTop:14}}>
                      <div className="action-label">ФИНАЛЬНЫЕ ДОКУМЕНТЫ ITIN</div>
                      <div className="step-hint">{itinRecord?"✓":"○"} Номер ITIN внесён</div>
                      <div className="step-hint">{partnerDocs.some(d=>d.doc_type==="itin_letter"&&(role==="admin"?d.visibility==="published":d.visibility!=="partner_only"))?"✓":"○"} Письмо IRS (CP565) {role==="admin"?"передано клиенту":"отправлено"}</div>
                    </div>
                    {irsEvents.length>0&&<div style={{marginTop:12}}>
                      <div className="action-label">ИСТОРИЯ IRS · ПОПЫТКА {selected.itin_attempt||1}</div>
                      {irsEvents.map(event=><div className="history-row" key={event.id}>
                        <span>{event.kind==="request"?"Запрос IRS":"Отказ IRS"} · {event.note} · попытка {event.attempt}</span>
                        <time>{fmt(event.created_at)}</time>
                      </div>)}
                    </div>}
                    {role==="admin"&&(selected.product==="itin_return"||selected.product==="itin_standard"||selected.product.startsWith("bundle"))&&(
                      <div className="doc-actions" style={{marginTop:12}}>
                        <button className="btn btn-outline btn-sm" disabled={busy||((selected.product.startsWith("bundle")?selected.itin_status:selected.status)!=="sent_irs")}
                          onClick={()=>{
                            const note=prompt("Что запросил IRS?");
                            if(note?.trim()) rpc("record_irs_event",{p_order:selected.id,p_stream:selected.product.startsWith("bundle")?"itin":"main",p_kind:"request",p_note:note.trim(),p_op:crypto.randomUUID()},"Запрос IRS записан");
                          }}>
                          Запрос IRS
                        </button>
                        <button className="btn btn-danger btn-sm" disabled={busy||((selected.product.startsWith("bundle")?selected.itin_status:selected.status)!=="sent_irs")}
                          onClick={()=>{
                            const note=prompt("Причина отказа IRS?");
                            if(note?.trim()) setConfirm({
                               title:"Отказ IRS — повторная подача бесплатно?",
                               body:"Поток ITIN вернётся к этапу «Документы», попытка +1. Оплата не требуется.",
                               confirmLabel:"Подтвердить отказ", danger:true,
                               onConfirm:()=>rpc("record_irs_event",{p_order:selected.id,p_stream:selected.product.startsWith("bundle")?"itin":"main",p_kind:"rejection",p_note:note.trim(),p_op:crypto.randomUUID()},"Отказ IRS записан; готовим бесплатную повторную подачу")
                             });
                          }}>
                          Отказ IRS · повторная подача
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Company + delivery checklist (LLC) */}
                {!selected.product.startsWith("itin")&&(()=>{
                  const isAdmin = role==="admin";
                  const pub = new Set(partnerDocs.filter(d=>isAdmin?d.visibility==="published":d.visibility!=="partner_only").map(d=>d.doc_type));
                  const verb = isAdmin?"передан клиенту":"отправлен";
                  const checks = [
                    { ok: isAdmin?(!!company?.ein&&!!company?.approved):!!company?.ein, label: isAdmin?"EIN одобрен (видит клиент)":"EIN внесён" },
                    { ok: pub.has("articles"), label: `Articles of Organization ${verb}` },
                    { ok: pub.has("ein_letter"), label: `Письмо EIN ${verb}` },
                    { ok: pub.has("operating_agreement"), label: `Operating Agreement ${verb}` },
                  ];
                  const showCompany = ["registered","ein_requested","ein_received"].includes(selected.status);
                  return (
                    <div className="grid-2">
                      <div className="card">
                        <h2>Данные компании</h2>
                        {!showCompany ? (
                          <p style={{color:"#94a3b8",fontSize:13}}>Заполняется после регистрации в штате (этап «Компания зарегистрирована»).</p>
                        ) : (
                          <>
                            <label className="eyebrow" style={{display:"block",marginBottom:4}}>Название</label>
                            <input className="partner-select" value={coName} onChange={e=>setCoName(e.target.value)} style={{marginBottom:10}}/>
                            <label className="eyebrow" style={{display:"block",marginBottom:4}}>EIN</label>
                            <input className="partner-select" placeholder="12-3456789" value={coEin} onChange={e=>setCoEin(e.target.value)} style={{marginBottom:10}}/>
                            <label className="eyebrow" style={{display:"block",marginBottom:4}}>Дата регистрации в штате</label>
                            <input className="partner-select" type="date" value={coDate} onChange={e=>setCoDate(e.target.value)} style={{marginBottom:12}}/>
                            <button className="btn btn-primary btn-full" disabled={busy||!coName.trim()||!coDate}
                              onClick={()=>rpc("record_company",{p_order:selected.id,p_name:coName,p_ein:coEin||null,p_registered_on:coDate},role==="admin"?"Данные компании сохранены и видны клиенту":"Данные компании сохранены")}>
                              <Check size={15}/> Сохранить
                            </button>
                            {company&&!company.approved&&role==="admin"&&(
                              <div className="alert warn" style={{marginTop:10,marginBottom:0}}>
                                <Clock size={15}/> Данные внесены партнёром и ждут вашего одобрения. Клиент их пока не видит.
                              </div>
                            )}
                            {company&&role==="partner"&&<p style={{fontSize:12,color:"#15803d",marginTop:8}}>✓ Сохранено</p>}
                            {company&&!company.approved&&role==="admin"&&(
                              <button className="btn btn-success btn-full" style={{marginTop:8}} disabled={busy}
                                onClick={()=>setConfirm({
                                  title:"Одобрить данные компании?",
                                  body:`Клиент увидит: ${company.name}, EIN ${company.ein||"—"}, и календарь сроков.`,
                                  confirmLabel:"Одобрить",
                                  onConfirm:()=>rpc("approve_company",{p_order:selected.id},"Данные компании одобрены")
                                })}><CheckCircle2 size={15}/> Одобрить данные</button>
                            )}
                            {company?.approved&&role==="admin"&&<p style={{fontSize:12,color:"#15803d",marginTop:8}}>✓ Одобрено. Клиент видит карточку компании и календарь сроков.</p>}
                          </>
                        )}
                      </div>
                      <div className="card">
                        <h2>{isAdmin?"Выдача клиенту":"Финальные документы"}</h2>
                        {checks.map(c=>(
                          <div key={c.label} className="history-row">
                            <span style={{color:c.ok?"#15803d":"#667085"}}>
                              {c.ok?<CheckCircle2 size={14} style={{verticalAlign:-2,marginRight:6}}/>:<Clock size={14} style={{verticalAlign:-2,marginRight:6}}/>}
                              {c.label}
                            </span>
                          </div>
                        ))}
                        <p style={{fontSize:12,color:"#667085",marginTop:10}}>Этап «EIN получен» откроется, когда все пункты выполнены.</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Client docs */}
                <div className="card" style={{marginBottom:18}}>
                  <h2>Документы клиента</h2>
                  {clientDocs.length===0&&<p style={{color:"#94a3b8",fontSize:13}}>Клиент ещё не загрузил документы</p>}
                  {clientDocs.map(d=>(
                    <div className="doc-row" key={d.id}>
                      <FileText size={18} color="#94a3b8"/>
                      <div style={{flex:1}}>
                        <div className="doc-name">{d.name}</div>
                        <div className="doc-meta">{fmtBytes(d.size_bytes)} · {fmt(d.created_at)}</div>
                        {d.review_comment&&<div className="doc-meta" style={{color:"#a32828"}}>Замечание: {d.review_comment}</div>}
                        {role==="partner"&&documentReviewProposals.find(p=>p.document_id===d.id)&&<div className="doc-meta" style={{color:"#a15c00",fontWeight:600}}>Ваше предложение: {documentReviewProposals.find(p=>p.document_id===d.id)?.status==="accepted"?"принять":"отклонить"}{documentReviewProposals.find(p=>p.document_id===d.id)?.comment?` · ${documentReviewProposals.find(p=>p.document_id===d.id)?.comment}`:""}</div>}
                      </div>
                      <span className={`badge ${d.review_status==="accepted"?"doc-published":d.review_status==="rejected"?"pending-el":"unpaid"}`}>
                        {d.review_status==="accepted"?"Принят":d.review_status==="rejected"?"Отклонён":"На проверке"}
                      </span>
                      <div className="doc-actions">
                        <button className="btn btn-outline btn-sm" onClick={()=>openDoc(d.path)}>Открыть</button>
                        {role==="partner"&&!d.superseded_at&&!documentReviewProposals.some(p=>p.document_id===d.id)&&d.review_status!=="accepted"&&d.review_status!=="rejected"&&(
                          <div className="doc-actions">
                            <button className="btn btn-success btn-sm" disabled={busy}
                              onClick={()=>rpc("propose_document_review",{p_document:d.id,p_status:"accepted",p_comment:null,p_op:crypto.randomUUID()},"Предложение принять отправлено администратору")}>
                              Предложить: принять
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busy}
                              onClick={()=>{
                                const reason=prompt("Причина отклонения документа");
                                if(reason?.trim()) rpc("propose_document_review",{p_document:d.id,p_status:"rejected",p_comment:reason.trim(),p_op:crypto.randomUUID()},"Предложение отклонить отправлено администратору");
                              }}>
                              Предложить: отклонить
                            </button>
                          </div>
                        )}
                        {role==="admin"&&(()=>{
                          const proposal=documentReviewProposals.find(p=>p.document_id===d.id);
                          return (
                            <div>
                              {proposal&&<div className="doc-meta" style={{color:"#a15c00",fontWeight:600,marginBottom:6}}>
                                Партнёр предлагает {proposal.status==="accepted"?"принять":"отклонить"} документ
                                {proposal.comment&&<span> · {proposal.comment}</span>}
                              </div>}
                              <div className="doc-actions">
                                {proposal&&<>
                                  <button className="btn btn-success btn-sm" disabled={busy}
                                    onClick={()=>rpc("confirm_document_review",{p_document:d.id,p_op:crypto.randomUUID()},"Предложение подтверждено; клиент увидит решение")}>
                                    <Check size={13}/> Подтвердить
                                  </button>
                                  <button className="btn btn-outline btn-sm" disabled={busy}
                                    onClick={()=>rpc("return_document_review",{p_document:d.id},"Предложение возвращено партнёру")}>
                                    Вернуть
                                  </button>
                                </>}
                                {d.review_status!=="accepted"&&<button className="btn btn-success btn-sm" disabled={busy}
                                  onClick={()=>rpc("review_document",{p_document:d.id,p_status:"accepted",p_comment:null},"Вы приняли документ; клиент увидит решение")}>
                                  Решить самому: принять
                                </button>}
                                {d.review_status!=="rejected"&&<button className="btn btn-danger btn-sm" disabled={busy}
                                  onClick={()=>{
                                    const reason=prompt("Причина отклонения документа");
                                    if(reason?.trim()) rpc("review_document",{p_document:d.id,p_status:"rejected",p_comment:reason.trim()},"Вы отклонили документ; клиент увидит решение");
                                  }}>
                                  Решить самому: отклонить
                                </button>}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Partner docs */}
                <div className="card" style={{marginBottom:18}}>
                  <h2>Документы партнёра</h2>
                  {partnerDocs.length===0&&<p style={{color:"#94a3b8",fontSize:13}}>Нет загруженных документов</p>}
                  {partnerDocs.map(d=>(
                    <div className="doc-row" key={d.id}>
                      <FileText size={18} color="#4762c9"/>
                      <div style={{flex:1}}>
                        <div className="doc-name">{d.name}</div>
                        <div className="doc-meta"><b>{DOC_TYPES[d.doc_type||"other"]}</b> · {fmtBytes(d.size_bytes)} · {fmt(d.created_at)}</div>
                        {d.note&&<div className="doc-meta" style={{color:"#a32828"}}>Замечание: {d.note}</div>}
                      </div>
                      <span className={`badge ${d.visibility==="published"?"doc-published":d.visibility==="admin_review"?"doc-review":"status"}`}>
                        {d.visibility==="published"?"✓ Передан клиенту":d.visibility==="admin_review"?"На проверке у admin":"Черновик"}
                      </span>
                      <div className="doc-actions">
                        <button className="btn btn-outline btn-sm" onClick={()=>openDoc(d.path)}>Открыть</button>
                        {role==="partner"&&d.visibility==="partner_only"&&(
                          <button className="btn btn-primary btn-sm" disabled={busy}
                            onClick={()=>setConfirm({
                              title:"Отправить на проверку?",
                              body:"Документ будет отправлен администратору на проверку перед передачей клиенту.",
                              confirmLabel:"Отправить",
                              onConfirm:()=>rpc("submit_partner_doc_for_review",{p_doc:d.id},"Документ отправлен на проверку")
                            })}>
                            <Send size={12}/> Отправить
                          </button>
                        )}
                        {role==="admin"&&d.visibility==="admin_review"&&(
                          <>
                            <button className="btn btn-success btn-sm" disabled={busy}
                              onClick={()=>setConfirm({
                                title:"Передать документ клиенту?",
                                body:"Клиент сразу увидит этот документ в своём кабинете.",
                                confirmLabel:"Передать клиенту",
                                onConfirm:()=>rpc("publish_partner_doc",{p_doc:d.id},"Документ передан клиенту")
                              })}>
                              <ChevronRight size={13}/> Клиенту
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busy}
                              onClick={()=>{
                                const note=prompt("Замечание для партнёра")||"";
                                setConfirm({
                                  title:"Вернуть документ партнёру?",
                                  body:note?`Партнёр увидит замечание: «${note}»`:"Документ вернётся в черновики партнёра.",
                                  confirmLabel:"Вернуть",danger:true,
                                  onConfirm:()=>rpc("return_partner_doc",{p_doc:d.id,p_note:note},"Документ возвращён партнёру")
                                });
                              }}>
                              ↩ Вернуть
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {role==="partner"&&(
                    <>
                      <div className="section-title" style={{marginTop:16}}>ЗАГРУЗИТЬ ДОКУМЕНТ</div>
                      <select className="partner-select" value={docType} onChange={e=>setDocType(e.target.value)} style={{marginBottom:8}}>
                        {Object.entries(DOC_TYPES).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                      <textarea className="note-area" placeholder="Комментарий к документу (необязательно)"
                        value={partnerNote} onChange={e=>setPartnerNote(e.target.value)}/>
                      <label className="upload-zone" style={{marginTop:10}}>
                        <Upload size={22} color="#4762c9"/>
                        <p>PDF, JPG или PNG · до 10 МБ</p>
                        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png"
                          disabled={busy}
                          onChange={async e=>{ const f=e.target.files?.[0]; if(f) await uploadPartnerDoc(f); e.target.value=""; }}/>
                      </label>
                    </>
                  )}
                </div>

                </>)}

                {/* Audit (admin) */}
                {role==="admin"&&(
                  <div className="card" style={{marginBottom:18}}>
                    <h2>Журнал действий</h2>
                    {audit.length===0&&<p style={{color:"#94a3b8",fontSize:13}}>Записей нет</p>}
                    {audit.map(a=>{
                      const nv=(a.new_value||{}) as Record<string,unknown>; const ov=(a.old_value||{}) as Record<string,unknown>;
                      const what = a.entity==="orders" ? (nv.product!==ov.product&&ov.product?`продукт: ${PROD[String(ov.product)]||ov.product} → ${PROD[String(nv.product)]||nv.product}`
                          : nv.status!==ov.status?`статус: ${STATUS[String(ov.status)]||ov.status||"—"} → ${STATUS[String(nv.status)]||nv.status}`
                          : nv.partner_id!==ov.partner_id?"смена партнёра" : nv.payment_status!==ov.payment_status?`оплата: ${nv.payment_status}`
                          : nv.cancelled_at&&!ov.cancelled_at?"отмена" : nv.eligibility!==ov.eligibility?`ITIN: ${nv.eligibility}` : nv.closed_at&&!ov.closed_at?"закрытие":"изменение заказа")
                        : a.entity==="status_proposals" ? (a.action==="delete"?"прогресс партнёра сброшен/подтверждён":`партнёр: ${STATUS[String(nv.proposed_status)]||nv.proposed_status}`)
                        : a.entity==="partner_documents" ? `документ партнёра: ${nv.visibility}`
                        : a.entity==="documents" ? (nv.superseded_at&&!ov.superseded_at?"документ клиента заменён":`документ клиента: ${nv.review_status}`)
                        : a.entity==="companies" ? (nv.approved&&!ov.approved?"данные компании одобрены":"данные компании")
                        : a.entity==="order_refunds" ? `возврат $${(Number(nv.amount_cents)/100).toFixed(2)}`
                        : a.entity==="order_milestones" ? "факт подачи"
                        : a.entity==="specialist_proposals" ? (a.action==="delete"?"предложение специалиста обработано":`специалист предлагает: ${nv.decision==="approve"?`одобрить → ${PROD[String(nv.recommended_product)]||nv.recommended_product}`:"отказать"}`) : `${a.entity}: ${a.action}`;
                      return (
                        <div className="history-row" key={a.id}>
                          <span>{what}{a.reason?` · «${a.reason}»`:""} <span style={{color:"#94a3b8"}}>· {a.actor_role||"система"}</span></span>
                          <time>{fmt(a.at)}</time>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* History */}
                <div className="card">
                  <h2>История</h2>
                  <div className="history-list">
                    {(selected.order_status_history||[]).length===0&&(
                      <p style={{color:"#94a3b8",fontSize:13}}>История пуста</p>
                    )}
                    {(selected.order_status_history||[]).map((h,i)=>(
                      <div className="history-row" key={i}>
                        <span>{STATUS[h.status]||h.status}</span>
                        <time>{fmt(h.created_at)}</time>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App/>);
