import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type User } from "@supabase/supabase-js";
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, ChevronRight,
  Clock, FileText, LogOut, RefreshCw, Search, Send, ShieldCheck,
  Upload, Users, XCircle, ClipboardList, UserCheck, X,
} from "lucide-react";
import "./styles.css";

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "",
);

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = "admin" | "partner" | "";
type Order = {
  id: string; product: string; status: string; itin_status?: string | null;
  eligibility: string; eligibility_note?: string | null;
  payment_status: string; payment_note?: string | null; payment_marked_manually?: boolean;
  applicant: Record<string, string>; created_at: string; partner_id?: string | null;
  order_status_history?: { status: string; created_at: string }[];
};
type PartnerApp = {
  id: string; user_id: string; full_name: string; qualification: string;
  bio?: string | null; status: "pending" | "approved" | "rejected";
  reject_reason?: string | null; created_at: string;
};
type Partner = { id: string; profile_id: string; display_name: string; qualification: string };
type PartnerDoc = {
  id: string; order_id: string; name: string; path: string;
  mime_type: string; size_bytes: number; visibility: string;
  note?: string | null; created_at: string;
};
type ClientDoc = {
  id: string; order_id: string; name: string; path: string;
  mime_type: string; size_bytes: number; created_at: string;
  review_status: string; review_comment?: string | null;
};
type Toast = { id: number; type: "success"|"error"|"info"|"warn"; text: string; leaving?: boolean };
type Confirm = { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };

// ─── Constants ────────────────────────────────────────────────────────────────
const LLC_CHAIN = ["application","review","filed_state","registered","ein_requested","ein_received"];
const ITIN_CHAIN = ["documents","caa_interview","sent_irs","itin_received"];
const STATUS: Record<string,string> = {
  draft:"Черновик", application:"Анкета", review:"Проверка",
  filed_state:"Подано в штат", registered:"Компания зарегистрирована",
  ein_requested:"EIN запрошен", ein_received:"EIN получен",
  documents:"Документы", caa_interview:"Интервью CAA",
  sent_irs:"Отправлено в IRS", itin_received:"ITIN получен",
};
const PROD: Record<string,string> = {
  llc_wy:"LLC Wyoming", llc_de:"LLC Delaware",
  itin_standard:"ITIN Standard", itin_return:"ITIN + 1040-NR",
  bundle_wy:"Bundle WY", bundle_de:"Bundle DE",
};
const STEP_HINTS: Record<string,string> = {
  review:"Проверить анкету клиента и загруженные документы",
  filed_state:"Подать документы в штат (WY/DE)",
  registered:"Компания зарегистрирована в штате",
  ein_requested:"Запрос EIN отправлен в IRS (тел. или факс)",
  ein_received:"EIN получен от IRS",
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
    <div className="toast-wrap">
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
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>{c.title}</h2>
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
          <input placeholder="ФИО *" value={name} onChange={e=>setName(e.target.value)}/>
          <select className="partner-select" value={qual} onChange={e=>setQual(e.target.value)} style={{marginBottom:10}}>
            <option>CAA</option><option>CPA</option><option>CAA/CPA</option>
          </select>
          <textarea className="note-area" placeholder="Коротко о себе (необязательно)" value={bio} onChange={e=>setBio(e.target.value)} style={{marginBottom:10}}/>
        </>}
        <input type="email" placeholder="Email *" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input type="password" placeholder="Пароль (мин. 8 символов) *" value={password} onChange={e=>setPassword(e.target.value)}/>
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
  const [tab, setTab] = useState<"orders"|"applications">("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order|null>(null);
  const [updatedId, setUpdatedId] = useState<string|null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [applications, setApplications] = useState<PartnerApp[]>([]);
  const [clientDocs, setClientDocs] = useState<ClientDoc[]>([]);
  const [partnerDocs, setPartnerDocs] = useState<PartnerDoc[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [partnerNote, setPartnerNote] = useState("");
  const [selectedPartner, setSelectedPartner] = useState("");
  const [confirm, setConfirm] = useState<Confirm|null>(null);
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

  async function bootstrap() {
    setLoading(true);
    const { data: prof } = await sb.from("profiles").select("role").eq("id", user!.id).single();
    // Кабинет доступен только ролям admin и partner; все остальные (в т.ч. client) — на экран заявки.
    const raw = prof?.role;
    const r: Role = raw === "admin" || raw === "partner" ? raw : "";
    setRole(r);
    if (r==="admin"||r==="partner") {
      await loadOrders();
      if (r==="admin") { await loadPartners(); await loadApplications(); }
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

  async function loadOrders() {
    const { data } = await sb.from("orders").select("*,order_status_history(*)").order("created_at",{ascending:false});
    setOrders(data||[]);
    if (data&&data.length>0) setSelected(s => s ? (data.find(o=>o.id===s.id)||data[0]) : data[0]);
  }
  async function loadPartners() {
    const { data } = await sb.from("partners").select("*");
    setPartners(data||[]);
  }
  async function loadApplications() {
    const { data } = await sb.from("partner_applications").select("*").order("created_at",{ascending:false});
    setApplications(data||[]);
  }
  async function loadDocs(orderId: string) {
    const [c, p] = await Promise.all([
      sb.from("documents").select("*").eq("order_id",orderId).order("created_at"),
      sb.from("partner_documents").select("*").eq("order_id",orderId).order("created_at"),
    ]);
    setClientDocs(c.data||[]);
    setPartnerDocs(p.data||[]);
  }

  useEffect(() => {
    if (selected) { loadDocs(selected.id); setRejectNote(""); setPartnerNote(""); }
  }, [selected?.id]);

  async function rpc(fn: string, args: Record<string,unknown>, successMsg: string) {
    setBusy(true);
    const { error } = await sb.rpc(fn, args);
    if (error) {
      toast("error", error.message==="Payment required" ? "Сначала нужна оплата" :
        error.message==="Eligibility approval required" ? "Сначала подтвердите основание ITIN" :
        error.message==="Admin only" ? "Только для администратора" :
        error.message||"Не удалось выполнить действие");
    } else {
      toast("success", successMsg);
      const prevId = selected?.id;
      await loadOrders();
      if (prevId) {
        await loadDocs(prevId);
        setUpdatedId(prevId);
        setTimeout(() => setUpdatedId(null), 1200);
      }
      if (fn.includes("application")) await loadApplications();
      if (fn.includes("partner")&&role==="admin") await loadPartners();
    }
    setBusy(false);
  }

  async function openDoc(path: string) {
    const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 60);
    if (error) toast("error", "Не удалось открыть документ");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function uploadPartnerDoc(file: File) {
    if (!selected||!user) return;
    setBusy(true);
    const ext = file.name.split(".").pop();
    const path = `${selected.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { toast("error", upErr.message); setBusy(false); return; }
    const myPartner = partners.find(p => p.profile_id===user.id);
    if (!myPartner) { toast("error", "Профиль партнёра не найден"); setBusy(false); return; }
    const { error: dbErr } = await sb.from("partner_documents").insert({
      order_id: selected.id, partner_id: myPartner.id, uploaded_by: user.id,
      path, name: file.name, mime_type: file.type, size_bytes: file.size,
      note: partnerNote.trim()||null,
    });
    if (dbErr) toast("error", dbErr.message);
    else { toast("success", "Документ загружен"); await loadDocs(selected.id); setPartnerNote(""); }
    setBusy(false);
  }

  const filtered = orders.filter(o =>
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
  if (!role) return <PendingScreen app={app} userId={user.id} onApplied={bootstrap}/>;
  if (app?.status==="rejected") return <PendingScreen app={app}/>;

  const pendingApps = applications.filter(a=>a.status==="pending");

  return (
    <div className="shell">
      <Toasts toasts={toasts}/>
      {confirm && <ConfirmDialog c={confirm} onCancel={()=>setConfirm(null)}/>}

      <header>
        <div className="brand">Taxpasso <span>PARTNERS</span></div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {role==="admin" && (
            <div className="nav-tabs">
              <button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>
                <ClipboardList size={14} style={{marginRight:5,verticalAlign:-2}}/> Заказы
              </button>
              <button className={tab==="applications"?"active":""} onClick={()=>setTab("applications")}>
                <Users size={14} style={{marginRight:5,verticalAlign:-2}}/> Заявки
                {pendingApps.length>0&&<span className="badge pending-el" style={{marginLeft:5}}>{pendingApps.length}</span>}
              </button>
            </div>
          )}
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

      {/* ─── Orders tab ────────────────────────────────────────────── */}
      {tab==="orders"&&(
        <div className="workspace">
          <aside>
            <div className="aside-header">
              <span className="aside-title">ЗАКАЗЫ</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="aside-count">{orders.length}</span>
                <button className="icon-btn btn-sm" onClick={loadOrders} disabled={busy} title="Обновить">
                  <RefreshCw size={14}/>
                </button>
              </div>
            </div>
            <div className="search-box">
              <Search size={15} color="#94a3b8"/>
              <input placeholder="Поиск…" value={query} onChange={e=>setQuery(e.target.value)}/>
            </div>
            {filtered.length===0&&<p style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"20px 0"}}>Заказов нет</p>}
            {filtered.map(o=>(
              <button key={o.id}
                className={`order-item ${selected?.id===o.id?"active":""} ${updatedId===o.id?"updated":""}`}
                onClick={()=>setSelected(o)}>
                <strong>{o.applicant?.company||o.applicant?.name||"Без названия"}</strong>
                <small>{PROD[o.product]||o.product} · {STATUS[o.status]||o.status}</small>
                <div className="badges">
                  <span className={`badge ${o.payment_status==="paid"?"paid":"unpaid"}`}>
                    {o.payment_status==="paid"?"Оплачено":"Ожидает оплаты"}
                  </span>
                  {(o.product.includes("itin")||o.product.includes("bundle"))&&(
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
                  <span className="status-pill">{STATUS[selected.status]||selected.status}</span>
                </div>

                {/* Status tracker */}
                <StatusTracker order={selected}/>

                {/* Alerts */}
                {selected.payment_status!=="paid"&&(
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

                    {/* Следующий шаг */}
                    {selected.payment_status==="paid"&&(()=>{
                      const next = getNextStep(selected);
                      return next?(
                        <div className="action-section">
                          <div className="action-label">СЛЕДУЮЩИЙ ЭТАП</div>
                          <button className="next-step-btn" disabled={busy}
                            onClick={()=>setConfirm({
                              title:`Перевести в «${next.label}»?`,
                              body: STEP_HINTS[next.status]||"Подтвердите переход на следующий этап.",
                              confirmLabel:"Перевести",
                              onConfirm:()=>rpc("advance_order",{p_order:selected.id,p_status:next.status},`Статус → ${next.label}`)
                            })}>
                            <span>{next.label}</span>
                            <span className="step-arrow"><ArrowRight size={13}/></span>
                          </button>
                          {STEP_HINTS[next.status]&&<div className="step-hint">{STEP_HINTS[next.status]}</div>}
                        </div>
                      ):null;
                    })()}

                    {/* Оплата */}
                    {role==="admin"&&selected.payment_status!=="paid"&&(
                      <div className="action-section">
                        <div className="action-label">ОПЛАТА</div>
                        <button className="btn btn-primary btn-full" disabled={busy}
                          onClick={()=>{
                            const note=prompt("Комментарий к оплате (необязательно)")||"";
                            setConfirm({
                              title:"Отметить оплату вручную?",
                              body:"Убедитесь, что перевод получен. Это действие нельзя отменить.",
                              confirmLabel:"Отметить оплату",
                              onConfirm:()=>rpc("mark_order_paid_manually",{p_order:selected.id,p_note:note},"Оплата отмечена")
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
                          {partners.map(p=>(
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

                    {/* ITIN */}
                    {(selected.product.includes("itin")||selected.product.includes("bundle"))&&selected.eligibility==="pending"&&(
                      <div className="action-section">
                        <div className="action-label">РЕШЕНИЕ ПО ITIN</div>
                        <button className="btn btn-success btn-full" disabled={busy}
                          onClick={()=>setConfirm({
                            title:"Подтвердить основание ITIN?",
                            body:"Клиент сможет оплатить услугу ITIN после вашего одобрения.",
                            confirmLabel:"Одобрить",
                            onConfirm:()=>rpc("approve_eligibility",{p_order:selected.id},"Основание ITIN одобрено")
                          })}>
                          <CheckCircle2 size={15}/> Одобрить ITIN
                        </button>
                        <div style={{marginTop:8}}>
                          <textarea className="note-area" placeholder="Причина отказа *"
                            value={rejectNote} onChange={e=>setRejectNote(e.target.value)}/>
                          <button className="btn btn-danger btn-full" style={{marginTop:6}}
                            disabled={busy||!rejectNote.trim()}
                            onClick={()=>setConfirm({
                              title:"Отклонить ITIN?",
                              body:`Причина будет показана клиенту: «${rejectNote}»`,
                              confirmLabel:"Отклонить",danger:true,
                              onConfirm:()=>{ rpc("reject_eligibility",{p_order:selected.id,p_reason:rejectNote},"ITIN отклонён"); setRejectNote(""); }
                            })}>
                            <XCircle size={15}/> Отклонить ITIN
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

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
                      </div>
                      <span className={`badge ${d.review_status==="accepted"?"doc-published":d.review_status==="rejected"?"pending-el":"unpaid"}`}>
                        {d.review_status==="accepted"?"Принят":d.review_status==="rejected"?"Отклонён":"На проверке"}
                      </span>
                      <div className="doc-actions">
                        <button className="btn btn-outline btn-sm" onClick={()=>openDoc(d.path)}>Открыть</button>
                        {role==="admin"&&d.review_status!=="accepted"&&(
                          <button className="btn btn-success btn-sm" disabled={busy}
                            onClick={()=>rpc("review_document",{p_document:d.id,p_status:"accepted",p_comment:null},"Документ принят")}>
                            <Check size={13}/>
                          </button>
                        )}
                        {role==="admin"&&d.review_status!=="rejected"&&(
                          <button className="btn btn-danger btn-sm" disabled={busy}
                            onClick={()=>{
                              const reason=prompt("Причина отклонения документа");
                              if(reason) rpc("review_document",{p_document:d.id,p_status:"rejected",p_comment:reason},"Документ отклонён");
                            }}>
                            <X size={13}/>
                          </button>
                        )}
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
                        <div className="doc-meta">{fmtBytes(d.size_bytes)} · {fmt(d.created_at)}</div>
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
