import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type User } from "@supabase/supabase-js";
import {
  AlertCircle, CheckCircle2, ChevronRight, Clock, FileText,
  LogOut, RefreshCw, Search, Send, ShieldCheck, Upload,
  Users, XCircle, ClipboardList,
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
  eligibility: string; payment_status: string; payment_note?: string | null;
  eligibility_note?: string | null; applicant: Record<string, string>;
  created_at: string; partner_id?: string | null;
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

const STATUS: Record<string, string> = {
  draft:"Черновик", application:"Анкета", review:"Проверка",
  filed_state:"Подано в штат", registered:"Зарегистрирована",
  ein_requested:"EIN запрошен", ein_received:"EIN получен",
  documents:"Документы", caa_interview:"Интервью CAA",
  sent_irs:"Отправлено в IRS", itin_received:"ITIN получен",
};
const PROD: Record<string, string> = {
  llc_wy:"LLC Wyoming", llc_de:"LLC Delaware",
  itin_standard:"ITIN Standard", itin_return:"ITIN + 1040-NR",
  bundle_wy:"Bundle WY", bundle_de:"Bundle DE",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(date: string) {
  return new Date(date).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function fmtBytes(n: number) {
  return n < 1024 ? n + " B" : n < 1048576 ? (n/1024).toFixed(0) + " KB" : (n/1048576).toFixed(1) + " MB";
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }: { onAuth: (u: User) => void }) {
  const [tab, setTab] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [name, setName] = useState(""); const [qual, setQual] = useState("CAA");
  const [bio, setBio] = useState(""); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState(false);

  async function submit() {
    setBusy(true); setMsg(""); setOk(false);
    if (tab === "sign_in") {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) setMsg(error.message);
      else if (data.user) onAuth(data.user);
    } else {
      const { data, error } = await sb.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: { emailRedirectTo: location.origin },
      });
      if (error) { setMsg(error.message); }
      else {
        // Подать заявку
        if (data.user) {
          await sb.from("partner_applications").insert({
            user_id: data.user.id, full_name: name.trim(),
            qualification: qual, bio: bio.trim() || null,
          });
        }
        setOk(true);
        setMsg("Проверьте email для подтверждения регистрации. После входа ваша заявка будет отправлена на проверку.");
      }
    }
    setBusy(false);
  }

  return (
    <div className="full-page">
      <div className="login-card">
        <ShieldCheck size={36} color="#4762c9" />
        <h1>Taxpasso Partners</h1>
        <p>Кабинет для CAA/CPA и администратора</p>
        <div className="login-tabs">
          <button className={tab === "sign_in" ? "active" : ""} onClick={() => { setTab("sign_in"); setMsg(""); }}>Войти</button>
          <button className={tab === "sign_up" ? "active" : ""} onClick={() => { setTab("sign_up"); setMsg(""); }}>Регистрация</button>
        </div>
        {tab === "sign_up" && (
          <>
            <input placeholder="ФИО *" value={name} onChange={e => setName(e.target.value)} />
            <select className="partner-select" value={qual} onChange={e => setQual(e.target.value)} style={{ marginBottom: 10 }}>
              <option>CAA</option><option>CPA</option><option>CAA/CPA</option>
            </select>
            <textarea className="note-area" placeholder="Коротко о себе (необязательно)" value={bio} onChange={e => setBio(e.target.value)} style={{ marginBottom: 10 }} />
          </>
        )}
        <input type="email" placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Пароль (мин. 8 символов) *" value={password} onChange={e => setPassword(e.target.value)} />
        <button
          className="btn btn-primary btn-full"
          disabled={busy || !email || password.length < 8 || (tab === "sign_up" && !name.trim())}
          onClick={submit}
          style={{ marginTop: 4 }}
        >
          {busy ? "Подождите…" : tab === "sign_in" ? "Войти" : "Подать заявку"}
        </button>
        {msg && <p className={ok ? "success-msg" : "error-msg"}>{msg}</p>}
      </div>
    </div>
  );
}

// ─── Pending approval screen ──────────────────────────────────────────────────
function PendingScreen({ app }: { app: PartnerApp | null }) {
  return (
    <div className="full-page">
      <div className="pending-card">
        <Clock size={40} color="#92400e" />
        <h1>Заявка на проверке</h1>
        {app ? (
          <p>Ваша заявка ({app.qualification}) подана {fmt(app.created_at)}.<br />Администратор рассмотрит её в ближайшее время. После одобрения вы автоматически получите доступ к кабинету партнёра.</p>
        ) : (
          <p>Подайте заявку на регистрации или обратитесь к администратору.</p>
        )}
        {app?.status === "rejected" && (
          <div className="alert danger" style={{ marginTop: 20, textAlign: "left" }}>
            <XCircle size={18} /> Заявка отклонена{app.reject_reason ? ": " + app.reject_reason : ""}
          </div>
        )}
        <button className="btn btn-outline" style={{ marginTop: 24 }} onClick={() => sb.auth.signOut()}>
          <LogOut size={16} /> Выйти
        </button>
      </div>
    </div>
  );
}

// ─── Order sidebar item ───────────────────────────────────────────────────────
function OrderItem({ o, active, onClick }: { o: Order; active: boolean; onClick: () => void }) {
  return (
    <button className={`order-item ${active ? "active" : ""}`} onClick={onClick}>
      <strong>{o.applicant?.company || o.applicant?.name || "Без названия"}</strong>
      <small>{PROD[o.product] || o.product} · {STATUS[o.status] || o.status}</small>
      <div className="badges">
        <span className={`badge ${o.payment_status === "paid" ? "paid" : "unpaid"}`}>
          {o.payment_status === "paid" ? "Оплачено" : "Ожидает оплаты"}
        </span>
        {(o.product.includes("itin") || o.product.includes("bundle")) && o.eligibility !== "pending" && (
          <span className={`badge ${o.eligibility === "approved" ? "approved-el" : "pending-el"}`}>
            {o.eligibility === "approved" ? "ITIN ✓" : "ITIN ✗"}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>("");
  const [app, setApp] = useState<PartnerApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders" | "applications">("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [applications, setApplications] = useState<PartnerApp[]>([]);
  const [clientDocs, setClientDocs] = useState<ClientDoc[]>([]);
  const [partnerDocs, setPartnerDocs] = useState<PartnerDoc[]>([]);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [partnerNote, setPartnerNote] = useState("");
  const [selectedPartner, setSelectedPartner] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Auth
  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (!data.user) setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((_, s) => setUser(s?.user || null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) bootstrap(); else { setLoading(false); } }, [user]);

  async function bootstrap() {
    setLoading(true);
    const { data: prof } = await sb.from("profiles").select("role").eq("id", user!.id).single();
    const r = (prof?.role as Role) || "";
    setRole(r);
    if (r === "admin" || r === "partner") {
      await loadOrders();
      if (r === "admin") { await loadPartners(); await loadApplications(); }
    } else {
      // проверить заявку
      const { data: papp } = await sb.from("partner_applications").select("*").eq("user_id", user!.id).single();
      setApp(papp);
    }
    setLoading(false);
  }

  async function loadOrders() {
    const { data } = await sb.from("orders")
      .select("*,order_status_history(*)")
      .order("created_at", { ascending: false });
    setOrders(data || []);
    if (data && data.length > 0 && !selected) setSelected(data[0]);
  }
  async function loadPartners() {
    const { data } = await sb.from("partners").select("*");
    setPartners(data || []);
  }
  async function loadApplications() {
    const { data } = await sb.from("partner_applications").select("*").order("created_at", { ascending: false });
    setApplications(data || []);
  }
  async function loadDocs(orderId: string) {
    const [c, p] = await Promise.all([
      sb.from("documents").select("*").eq("order_id", orderId).order("created_at"),
      sb.from("partner_documents").select("*").eq("order_id", orderId).order("created_at"),
    ]);
    setClientDocs(c.data || []);
    setPartnerDocs(p.data || []);
  }

  useEffect(() => { if (selected) { loadDocs(selected.id); setMsg(""); setRejectNote(""); setPartnerNote(""); } }, [selected?.id]);

  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true); setMsg("");
    const { error } = await sb.rpc(fn, args);
    if (error) setMsg(error.message);
    else { await loadOrders(); if (selected) await loadDocs(selected.id); if (fn.includes("application")) await loadApplications(); }
    setBusy(false);
  }

  async function uploadPartnerDoc(file: File) {
    if (!selected || !user) return;
    setBusy(true); setMsg("");
    const path = `${selected.id}/${crypto.randomUUID()}.${file.name.split(".").pop()}`;
    const { error: upErr } = await sb.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { setMsg(upErr.message); setBusy(false); return; }
    // найти partner id текущего пользователя
    const myPartner = partners.find(p => p.profile_id === user.id);
    if (!myPartner) { setMsg("Профиль партнёра не найден"); setBusy(false); return; }
    const { error: dbErr } = await sb.from("partner_documents").insert({
      order_id: selected.id, partner_id: myPartner.id, uploaded_by: user.id,
      path, name: file.name, mime_type: file.type, size_bytes: file.size,
    });
    if (dbErr) setMsg(dbErr.message);
    else { await loadDocs(selected.id); setMsg("Документ загружен"); }
    setBusy(false);
  }

  // Filter orders
  const filtered = orders.filter(o =>
    (o.applicant?.company || o.applicant?.name || o.product).toLowerCase().includes(query.toLowerCase())
  );

  if (loading) return <div className="full-page"><p>Загрузка…</p></div>;
  if (!user) return <LoginScreen onAuth={u => setUser(u)} />;
  if (!role) return <PendingScreen app={app} />;
  if (app?.status === "rejected") return <PendingScreen app={app} />;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="shell">
      <header>
        <div className="brand">Taxpasso <span>PARTNERS</span></div>
        <div style={{ display:"flex", alignItems:"center", gap: 16 }}>
          {role === "admin" && (
            <div className="nav-tabs">
              <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
                <ClipboardList size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Заказы
              </button>
              <button className={tab === "applications" ? "active" : ""} onClick={() => setTab("applications")}>
                <Users size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                Заявки {applications.filter(a => a.status === "pending").length > 0 && (
                  <span className="badge pending-el" style={{ marginLeft: 4 }}>
                    {applications.filter(a => a.status === "pending").length}
                  </span>
                )}
              </button>
            </div>
          )}
          <span className="role-badge">{role.toUpperCase()}</span>
          <button className="icon-btn" onClick={() => sb.auth.signOut()}><LogOut size={17} /></button>
        </div>
      </header>

      {/* ─── Applications tab (admin) ─────────────────────────────────────── */}
      {tab === "applications" && role === "admin" && (
        <div className="app-list">
          {applications.length === 0 && (
            <div className="empty-state"><Users size={40} /><h2>Нет заявок</h2><p>Новые заявки партнёров появятся здесь.</p></div>
          )}
          {applications.map(a => (
            <div className="app-card" key={a.id}>
              <div className="app-info">
                <h3>{a.full_name}</h3>
                <p>{a.qualification} · Заявка {fmt(a.created_at)}</p>
                {a.bio && <p style={{ marginTop: 4, color: "#475569" }}>{a.bio}</p>}
                {a.reject_reason && <p style={{ color: "#a32828", marginTop: 4 }}>Причина отказа: {a.reject_reason}</p>}
              </div>
              <span className={`badge ${a.status === "pending" ? "pending-app" : a.status === "approved" ? "approved-app" : "rejected-app"}`}>
                {a.status === "pending" ? "На рассмотрении" : a.status === "approved" ? "Одобрен" : "Отклонён"}
              </span>
              {a.status === "pending" && (
                <div className="app-actions">
                  <button className="btn btn-success btn-sm" disabled={busy}
                    onClick={() => rpc("approve_partner_application", { p_app: a.id })}>
                    <CheckCircle2 size={14} /> Одобрить
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => {
                      const reason = prompt("Причина отказа (необязательно)");
                      rpc("reject_partner_application", { p_app: a.id, p_reason: reason });
                    }}>
                    <XCircle size={14} /> Отклонить
                  </button>
                </div>
              )}
            </div>
          ))}
          {msg && <p className="error-msg">{msg}</p>}
        </div>
      )}

      {/* ─── Orders tab ───────────────────────────────────────────────────── */}
      {tab === "orders" && (
        <div className="workspace">
          <aside>
            <div className="aside-header">
              <span className="aside-title">ЗАКАЗЫ</span>
              <span className="aside-count">{orders.length}</span>
            </div>
            <div className="search-box">
              <Search size={15} color="#94a3b8" />
              <input placeholder="Поиск…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            {filtered.length === 0 && <p style={{ color:"#94a3b8", fontSize:13, textAlign:"center", padding:"20px 0" }}>Заказов нет</p>}
            {filtered.map(o => (
              <OrderItem key={o.id} o={o} active={selected?.id === o.id} onClick={() => setSelected(o)} />
            ))}
          </aside>

          <div className="detail">
            {!selected ? (
              <div className="empty-state"><FileText size={42} /><h2>Выберите заказ</h2></div>
            ) : (
              <>
                {/* Head */}
                <div className="detail-head">
                  <div>
                    <span className="eyebrow">ORDER / {selected.id.slice(0,8)}</span>
                    <h1>{selected.applicant?.company || selected.applicant?.name || "Заказ"}</h1>
                    <p>{PROD[selected.product] || selected.product} · создан {fmt(selected.created_at)}</p>
                  </div>
                  <span className="status-pill">{STATUS[selected.status] || selected.status}</span>
                </div>

                {/* Alerts */}
                {selected.payment_status !== "paid" && (
                  <div className="alert warn"><AlertCircle size={16} /> Заказ не оплачен. {role === "admin" ? "Отметьте оплату вручную." : "Дождитесь оплаты."}</div>
                )}
                {selected.eligibility === "rejected" && (
                  <div className="alert danger"><XCircle size={16} /> ITIN отклонён: {selected.eligibility_note || "причина не указана"}</div>
                )}
                {selected.eligibility === "pending" && (selected.product.includes("itin") || selected.product.includes("bundle")) && (
                  <div className="alert info"><Clock size={16} /> ITIN ожидает проверки партнёра</div>
                )}
                {selected.eligibility === "approved" && (selected.product.includes("itin") || selected.product.includes("bundle")) && (
                  <div className="alert success"><CheckCircle2 size={16} /> Основание ITIN подтверждено</div>
                )}

                <div className="grid-2">
                  {/* Client form */}
                  <div className="card">
                    <h2>Анкета клиента</h2>
                    <dl>
                      {Object.entries(selected.applicant || {}).map(([k,v]) => (
                        <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>
                      ))}
                    </dl>
                  </div>

                  {/* Actions */}
                  <div className="card">
                    <h2>Действия</h2>
                    <div className="actions">
                      {/* Admin: ручная оплата */}
                      {role === "admin" && selected.payment_status !== "paid" && (
                        <button className="btn btn-primary" disabled={busy}
                          onClick={() => {
                            const note = prompt("Комментарий к оплате (необязательно)") || "";
                            rpc("mark_order_paid_manually", { p_order: selected.id, p_note: note });
                          }}>
                          <CheckCircle2 size={15} /> Отметить оплату
                        </button>
                      )}

                      {/* Admin: назначить партнёра */}
                      {role === "admin" && (
                        <div>
                          <label className="eyebrow" style={{ display:"block", marginBottom:6 }}>Назначить CAA/CPA</label>
                          <select className="partner-select" value={selectedPartner}
                            onChange={e => setSelectedPartner(e.target.value)}>
                            <option value="">— выберите партнёра —</option>
                            {partners.map(p => (
                              <option key={p.id} value={p.id}>{p.display_name} · {p.qualification}</option>
                            ))}
                          </select>
                          <button className="btn btn-outline btn-full" style={{ marginTop:8 }}
                            disabled={busy || !selectedPartner}
                            onClick={() => rpc("assign_partner", { p_order: selected.id, p_partner: selectedPartner })}>
                            <Send size={14} /> Назначить
                          </button>
                        </div>
                      )}

                      {/* ITIN решения */}
                      {(selected.product.includes("itin") || selected.product.includes("bundle")) && selected.eligibility === "pending" && (
                        <>
                          <button className="btn btn-success" disabled={busy}
                            onClick={() => rpc("approve_eligibility", { p_order: selected.id })}>
                            <CheckCircle2 size={15} /> Одобрить основание ITIN
                          </button>
                          <div>
                            <textarea className="note-area" placeholder="Причина отказа ITIN *"
                              value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
                            <button className="btn btn-danger btn-full" style={{ marginTop:6 }}
                              disabled={busy || !rejectNote.trim()}
                              onClick={() => { rpc("reject_eligibility", { p_order: selected.id, p_reason: rejectNote }); setRejectNote(""); }}>
                              <XCircle size={15} /> Отклонить ITIN
                            </button>
                          </div>
                        </>
                      )}

                      {/* Продвинуть статус */}
                      {selected.payment_status === "paid" && (
                        <button className="btn btn-outline" disabled={busy}
                          onClick={() => {
                            const chain = selected.product.startsWith("itin")
                              ? ["documents","caa_interview","sent_irs","itin_received"]
                              : ["application","review","filed_state","registered","ein_requested","ein_received"];
                            const idx = chain.indexOf(selected.status);
                            if (idx >= 0 && idx < chain.length - 1)
                              rpc("advance_order", { p_order: selected.id, p_status: chain[idx+1] });
                          }}>
                          <ChevronRight size={15} /> Следующий этап
                        </button>
                      )}
                    </div>
                    {selected.partner_id && (
                      <p style={{ marginTop:14, fontSize:12, color:"#667085" }}>
                        Партнёр назначен: {partners.find(p=>p.id===selected.partner_id)?.display_name || selected.partner_id.slice(0,8)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Client docs */}
                <div className="card" style={{ marginBottom:18 }}>
                  <h2>Документы клиента</h2>
                  {clientDocs.length === 0 && <p style={{ color:"#94a3b8", fontSize:13 }}>Клиент ещё не загрузил документы</p>}
                  {clientDocs.map(d => (
                    <div className="doc-row" key={d.id}>
                      <FileText size={18} color="#94a3b8" />
                      <div style={{ flex:1 }}>
                        <div className="doc-name">{d.name}</div>
                        <div className="doc-meta">{fmtBytes(d.size_bytes)} · {fmt(d.created_at)}</div>
                        {d.review_comment && <div className="doc-meta" style={{ color:"#a32828" }}>Комментарий: {d.review_comment}</div>}
                      </div>
                      <span className={`badge ${d.review_status === "accepted" ? "doc-published" : d.review_status === "rejected" ? "pending-el" : "unpaid"}`}>
                        {d.review_status === "accepted" ? "Принят" : d.review_status === "rejected" ? "Отклонён" : "На проверке"}
                      </span>
                      <div className="doc-actions">
                        <button className="btn btn-outline btn-sm" onClick={async () => {
                          const { data } = await sb.storage.from("documents").createSignedUrl(d.path, 60);
                          if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                        }}>Открыть</button>
                        {role === "admin" && d.review_status !== "accepted" && (
                          <button className="btn btn-success btn-sm" disabled={busy}
                            onClick={() => rpc("review_document", { p_document: d.id, p_status: "accepted", p_comment: null })}>
                            ✓
                          </button>
                        )}
                        {role === "admin" && d.review_status !== "rejected" && (
                          <button className="btn btn-danger btn-sm" disabled={busy}
                            onClick={() => {
                              const reason = prompt("Причина отклонения");
                              if (reason) rpc("review_document", { p_document: d.id, p_status: "rejected", p_comment: reason });
                            }}>✗</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Partner docs */}
                <div className="card" style={{ marginBottom:18 }}>
                  <h2>Документы партнёра</h2>
                  {partnerDocs.length === 0 && <p style={{ color:"#94a3b8", fontSize:13 }}>Нет загруженных документов</p>}
                  {partnerDocs.map(d => (
                    <div className="doc-row" key={d.id}>
                      <FileText size={18} color="#4762c9" />
                      <div style={{ flex:1 }}>
                        <div className="doc-name">{d.name}</div>
                        <div className="doc-meta">{fmtBytes(d.size_bytes)} · {fmt(d.created_at)}</div>
                        {d.note && <div className="doc-meta" style={{ color:"#a32828" }}>Замечание: {d.note}</div>}
                      </div>
                      <span className={`badge ${d.visibility === "published" ? "doc-published" : d.visibility === "admin_review" ? "doc-review" : "status"}`}>
                        {d.visibility === "published" ? "Передан клиенту" : d.visibility === "admin_review" ? "На проверке у admin" : "Черновик"}
                      </span>
                      <div className="doc-actions">
                        <button className="btn btn-outline btn-sm" onClick={async () => {
                          const { data } = await sb.storage.from("documents").createSignedUrl(d.path, 60);
                          if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                        }}>Открыть</button>
                        {/* Партнёр: отправить на проверку */}
                        {role === "partner" && d.visibility === "partner_only" && (
                          <button className="btn btn-primary btn-sm" disabled={busy}
                            onClick={() => rpc("submit_partner_doc_for_review", { p_doc: d.id })}>
                            <Send size={12} /> Отправить
                          </button>
                        )}
                        {/* Админ: передать клиенту */}
                        {role === "admin" && d.visibility === "admin_review" && (
                          <>
                            <button className="btn btn-success btn-sm" disabled={busy}
                              onClick={() => rpc("publish_partner_doc", { p_doc: d.id })}>
                              ✓ Клиенту
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busy}
                              onClick={() => {
                                const note = prompt("Замечание для партнёра") || "";
                                rpc("return_partner_doc", { p_doc: d.id, p_note: note });
                              }}>
                              ↩ Вернуть
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Загрузка документа партнёром */}
                  {role === "partner" && (
                    <>
                      <div className="section-title">ЗАГРУЗИТЬ ДОКУМЕНТ</div>
                      <textarea className="note-area" placeholder="Комментарий к документу (необязательно)"
                        value={partnerNote} onChange={e => setPartnerNote(e.target.value)} />
                      <label className="upload-zone" style={{ marginTop:10 }}>
                        <Upload size={22} color="#4762c9" />
                        <p>PDF, JPG или PNG · до 10 МБ</p>
                        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png"
                          disabled={busy}
                          onChange={async e => {
                            const f = e.target.files?.[0];
                            if (f) await uploadPartnerDoc(f);
                            e.target.value = "";
                          }} />
                      </label>
                    </>
                  )}
                </div>

                {/* History */}
                <div className="card">
                  <h2>История статусов</h2>
                  <div className="history-list">
                    {(selected.order_status_history || []).map((h,i) => (
                      <div className="history-row" key={i}>
                        <span>{STATUS[h.status] || h.status}</span>
                        <time>{fmt(h.created_at)}</time>
                      </div>
                    ))}
                  </div>
                </div>

                {msg && <p className="error-msg" style={{ marginTop:14 }}>{msg}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
