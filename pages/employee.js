import { useEffect, useMemo, useRef, useState } from "react";

/* ------------ auth helper ------------ */
function useAuth() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.auth/me");
        const j = await res.json();
        setMe(j?.clientPrincipal || null);
      } catch {
        setMe(null);
      }
    })();
  }, []);
  return me;
}

/* ------------ utils ------------ */
function ru(n){ return n==null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`; }

function remainingByCategory(task, expenses) {
  const limits = task?.expenseLimits || {Hotel:1000, Food:1000, Travel:1000, Other:1000};
  const rem = {Hotel: limits.Hotel||0, Food: limits.Food||0, Travel: limits.Travel||0, Other: limits.Other||0};
  for (const e of expenses||[]) {
    const st = e?.approval?.status;
    if (st === "REJECTED") continue;
    const cat = e?.category || "Other";
    const amt = Number(e?.editedTotal ?? e?.total ?? 0) || 0;
    if (["PENDING_REVIEW","APPROVED","AUTO_APPROVED", null, ""].includes(st)) {
      if (rem[cat] == null) rem[cat] = 0;
      rem[cat] -= amt;
    }
  }
  Object.keys(rem).forEach(k => { if (rem[k] < 0) rem[k] = 0; });
  return rem;
}

function fmtLocal(iso){
  if(!iso) return "—";
  const d=new Date(iso);
  const mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  const day=d.getDate();
  const ord=(n)=>{const s=["th","st","nd","rd"],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
  let h=d.getHours(); const m=("0"+d.getMinutes()).slice(-2);
  const ap=h>=12?"PM":"AM"; h=h%12; if(h===0) h=12;
  return `${ord(day)} ${mon} ${d.getFullYear()}, ${h}:${m} ${ap}`;
}
function fmtSLA(s,e){ return `${fmtLocal(s)} → ${fmtLocal(e)}`; }

function statusBadge(s){
  const v = (s||"").toLowerCase();
  const m = {
    assigned:   {bg:"#eef3ff", fg:"#3156d8", text:"assigned"},
    in_progress:{bg:"#fff6e6", fg:"#a05a00", text:"in_progress"},
    completed:  {bg:"#e9f9ef", fg:"#117b34", text:"completed"},
  }[v] || {bg:"#f3f4f6", fg:"#374151", text:(s||"—")};
  return (
    <span style={{
      fontSize:12, padding:"2px 8px", borderRadius:999,
      background:m.bg, color:m.fg, border:"1px solid rgba(0,0,0,0.05)"
    }}>{m.text}</span>
  );
}

/* ---- SLA proximity tags on tile ---- */
function slaTag(t){
  const now = Date.now();
  const ONE_DAY = 24*60*60*1000;
  const start = t?.slaStart ? new Date(t.slaStart).getTime() : NaN;
  const end   = t?.slaEnd   ? new Date(t.slaEnd).getTime()   : NaN;
  const done  = (t?.status || "").toLowerCase() === "completed";

  if (done) return null;                            // hide pills once completed
  if (!Number.isNaN(end) && now > end)
    return { label: "Overdue",   style: styles.pillDanger };
  if (!Number.isNaN(end) && end - now <= ONE_DAY && end - now >= 0)
    return { label: "Ends soon", style: styles.pillWarn };
  if (!Number.isNaN(start) && start - now <= ONE_DAY && start - now >= 0)
    return { label: "Starts soon", style: styles.pillSoon };
  return null;
}

/* ------------ page ------------ */
export default function Employee() {
  const me = useAuth();
  const [tenantId] = useState("default");
  const myEmail = (me?.userDetails || "").toLowerCase();

  const [allTasks, setAllTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [rem, setRem] = useState({Hotel:0,Food:0,Travel:0,Other:0});

  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState(null);
  const fileRef = useRef(null);

  // New expense finalize fields
  const [category, setCategory] = useState("");
  const [editedTotal, setEditedTotal] = useState("");

  // EDIT rejected expense (no comment now)
  const [editExp, setEditExp] = useState(null);
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // --- Products: fetch once and map id -> label (name+optional sku)
  const [products, setProducts] = useState([]);
  const productLabel = useMemo(() => {
    const map = {};
    for (const p of products || []) {
      const id  = p.id || p.productId;
      const nm  = p.name || p.title || id;
      const sku = p.sku ? ` (${p.sku})` : "";
      if (id) map[id] = nm + sku;
    }
    return map;
  }, [products]);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetch(`/api/products?tenantId=${tenantId}`).then(r=>r.json());
        setProducts(Array.isArray(j) ? j : []);
      } catch {}
    })();
  }, [tenantId]);

  // Load tasks
  useEffect(() => {
    (async () => {
      setTasksLoading(true);
      try {
        const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
        setAllTasks(Array.isArray(j) ? j : []);
      } catch (e) {
        console.error(e);
      } finally {
        setTasksLoading(false);
      }
    })();
  }, [tenantId, me?.userDetails]);

  const myTasks = useMemo(() => {
    if (!myEmail) return [];
    return (allTasks || []).filter(t => (t.assignee || "").toLowerCase() === myEmail);
  }, [allTasks, myEmail]);

  /* ---------- NEW: Filters for My tasks ---------- */
  const [taskQ, setTaskQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [statusF, setStatusF] = useState("ALL");   // ALL | ASSIGNED | IN_PROGRESS | COMPLETED
  const [proxF, setProxF]   = useState("ALL");     // ALL | STARTS_SOON | ENDS_SOON | OVERDUE

  function proxFlags(t){
    const status=(t.status||"").toLowerCase();
    const done = status==="completed";
    const now=Date.now();
    const s=t.slaStart? new Date(t.slaStart).getTime(): NaN;
    const e=t.slaEnd?   new Date(t.slaEnd).getTime():   NaN;
    const DAY=24*60*60*1000;
    return {
      done,
      overdue:   !done && Number.isFinite(e) && now>e,
      endsSoon:  !done && Number.isFinite(e) && e>now && (e-now)<=DAY,
      startsSoon:!done && Number.isFinite(s) && s>now && (s-now)<=DAY
    };
  }

  const productIndex = useMemo(() => {
    // create a lower-cased name map for search
    const m = {};
    for (const id in productLabel) m[id] = (productLabel[id]||"").toLowerCase();
    return m;
  }, [productLabel]);

  const filteredTasks = useMemo(() => {
    const q=(taskQ||"").trim().toLowerCase();
    const pq=(prodQ||"").trim().toLowerCase();

    return myTasks.filter(t => {
      // title filter
      if (q && !String(t.title||t.id||"").toLowerCase().includes(q)) return false;

      // product filter: match any item name against prodQ
      if (pq) {
        const items = Array.isArray(t.items)? t.items : [];
        const hit = items.some(it => {
          const id = it.productId || it.product || "";
          const name = productIndex[id] || String(id).toLowerCase();
          return name.includes(pq);
        });
        if (!hit) return false;
      }

      // status filter
      if (statusF !== "ALL") {
        const s = String(t.status||"").toUpperCase();
        if (s !== statusF) return false;
      }

      // proximity filter
      if (proxF !== "ALL") {
        const f = proxFlags(t);
        if (proxF === "STARTS_SOON" && !f.startsSoon) return false;
        if (proxF === "ENDS_SOON"   && !f.endsSoon)   return false;
        if (proxF === "OVERDUE"     && !f.overdue)    return false;
      }

      return true;
    });
  }, [myTasks, taskQ, prodQ, statusF, proxF, productIndex]);

  async function selectTask(t) {
    setSelected(t);
    setDraft(null); setCategory(""); setEditedTotal("");
    setEditExp(null); setEditCategory(""); setEditAmount(""); setSavingEdit(false);
    try {
      const ex = await fetch(`/api/expenses/byTask?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`).then(r=>r.json());
      const arr = Array.isArray(ex) ? ex : [];
      setExpenses(arr);
      const ev = await fetch(`/api/tasks/events?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`).then(r=>r.json());
      setEvents(Array.isArray(ev) ? ev : []);
      setRem(remainingByCategory(t, arr));
    } catch (e) {
      console.error(e);
    }
  }

  async function checkIn() {
    if (!selected) return;
    const r = await fetch(`/api/tasks/checkin`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ tenantId, taskId: selected.id })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Check-in failed");
    await selectTask(selected);
  }

  async function checkOut() {
    if (!selected) return;
    let body = { tenantId, taskId: selected.id };
    let r = await fetch(`/api/tasks/checkout`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    if (r.status === 400) {
      const j = await r.json();
      if (/reason required/i.test(j.error || "")) {
        const reason = window.prompt("SLA appears breached. Please enter a reason:");
        if (!reason) return;
        body = { tenantId, taskId: selected.id, reason };
        r = await fetch(`/api/tasks/checkout`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify(body)
        });
      }
    }
    const j2 = await r.json();
    if (!r.ok) return alert(j2.error || "Checkout failed");
    await selectTask(selected);
  }

  async function onChooseFile(ev) {
    if (!selected) return alert("Select a task first.");
    const f = ev.target.files?.[0];
    if (!f) return;

    const safeName = `${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
    setUploading(true);
    try {
      const sas = await fetch(`/api/receipts/sas?taskId=${encodeURIComponent(selected.id)}&filename=${encodeURIComponent(safeName)}`).then(r=>r.json());
      if (!sas?.uploadUrl) throw new Error("Could not get upload URL");

      const put = await fetch(sas.uploadUrl, { method:"PUT", headers: {"x-ms-blob-type":"BlockBlob"}, body: f });
      if (!put.ok) throw new Error(`Blob upload failed (HTTP ${put.status})`);

      const ocr = await fetch(`/api/receipts/ocr`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ tenantId, taskId: selected.id, filename: safeName, save: true })
      }).then(r=>r.json());

      const info = ocr?.ocr || {};
      const detectedTotal = info?.total ?? "";
      setDraft({
        blobUrl: ocr?.blobPath || sas?.blobUrl,
        filename: safeName,
        merchant: info?.merchant || "",
        total: detectedTotal,
        date: info?.date || "",
        currency: info?.currency || ""
      });
      setCategory("");
      setEditedTotal(detectedTotal ?? "");
    } catch (e) {
      console.error(e);
      alert(e.message || "Upload or OCR failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openReceipt(exp) {
    try {
      const filename = exp.blobPath.split("/").pop();
      const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(exp.taskId)}&filename=${encodeURIComponent(filename)}&minutes=5`).then(r=>r.json());
      if (j.readUrl) window.open(j.readUrl, "_blank");
    } catch {
      alert("Could not open receipt");
    }
  }

  async function submitExpense() {
    if (!selected || !draft) return;
    if (!category) return alert("Please choose a category");
    const amount = Number(editedTotal || 0);
    if (!Number.isFinite(amount) || amount <= 0) return alert("Enter a valid total");

    const body = {
      tenantId,
      taskId: selected.id,
      blobPath: draft.blobUrl,
      category,
      total: amount
    };

    const r = await fetch(`/api/expenses/finalize`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Submit failed");

    setDraft(null);
    setCategory("");
    setEditedTotal("");
    await selectTask(selected);
    const status = j?.approval?.status;
    if (status === "AUTO_APPROVED") {
      alert("Expense auto-approved (within remaining).");
    } else if (status === "PENDING_REVIEW") {
      alert("Expense submitted for review (exceeds remaining).");
    }
  }

  /* ---------- TASK LIST (with filters) ---------- */
  const tasksPane =
    tasksLoading ? <p style={{margin:8}}>Loading…</p> :
    (myTasks.length === 0 ? <p style={{margin:8}}>No tasks assigned.</p> :
      <div>
        {/* Filter bar */}
        <div style={{
          display:"grid",
          gridTemplateColumns:"1fr",
          gap:6,
          marginBottom:10
        }}>
          <input
            placeholder="Search title…"
            value={taskQ}
            onChange={(e)=>setTaskQ(e.target.value)}
            style={styles.input}
          />
          <input
            placeholder="Filter by product…"
            value={prodQ}
            onChange={(e)=>setProdQ(e.target.value)}
            style={styles.input}
          />
          <select value={statusF} onChange={(e)=>setStatusF(e.target.value)} style={styles.input}>
            <option value="ALL">All statuses</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <select value={proxF} onChange={(e)=>setProxF(e.target.value)} style={styles.input}>
            <option value="ALL">All proximity</option>
            <option value="STARTS_SOON">Starts soon (24h)</option>
            <option value="ENDS_SOON">Ends soon (24h)</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </div>

        {filteredTasks.length === 0 ? (
          <p style={{margin:8}}>No tasks match the filters.</p>
        ) : (
          <div style={styles.tasksList}>
            {filteredTasks.map(t => {
              const tag = slaTag(t);
              return (
                <button key={t.id} onClick={() => selectTask(t)} style={{
                  ...styles.taskRow,
                  ...(selected?.id === t.id ? styles.taskRowActive : null)
                }}>
                  <div style={styles.rowTop}>
                    <div style={styles.taskTitle} title={t.title || t.id}>{t.title || t.id}</div>
                    <div style={{display:"flex", gap:6, alignItems:"center"}}>
                      {tag && <span style={tag.style}>{tag.label}</span>}
                      {statusBadge(t.status)}
                    </div>
                  </div>
                  <div style={styles.slaLine}>
                    <div><span style={{color:"#6b7280", fontWeight:600}}>Start:</span> {fmtLocal(t.slaStart)}</div>
                    <div><span style={{color:"#6b7280", fontWeight:600}}>End:</span> {fmtLocal(t.slaEnd)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1 style={{marginBottom:6}}>Employee portal</h1>
      <div style={{marginBottom:12, color:"#444"}}>
        Signed in as: <strong>{me?.userDetails || "—"}</strong>
      </div>

      <section style={{display:"grid", gridTemplateColumns:"360px 1fr", gap:16}}>
        <div>
          <div style={styles.card}>
            <div style={styles.cardHead}>My tasks</div>
            {tasksPane}
          </div>
        </div>

        <div>
          {!selected ? (
            <p>Select a task to view and update.</p>
          ) : (
            <>
              <div style={styles.card}>
                <div style={{...styles.cardHead, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                  <div>{selected.title || selected.id}</div>
                  <div style={{display:"flex", gap:8}}>
                    <button onClick={checkIn}  style={styles.btn}>Check in</button>
                    <button onClick={checkOut} style={styles.btnGhost}>Check out</button>
                  </div>
                </div>

                {/* Task details (visible only when selected) */}
                <div style={{...styles.subCard, marginBottom:12}}>
                  <div style={styles.subHead}>Task details</div>
                  <div style={{fontSize:13, color:"#374151"}}>
                    <div><strong>Type:</strong> {selected.type || "—"}</div>
                    <div><strong>SLA:</strong> {fmtSLA(selected.slaStart, selected.slaEnd)}</div>
                    <div style={{marginTop:6}}>
                      <strong>Products:</strong>{" "}
                      {Array.isArray(selected.items) && selected.items.length > 0 ? (
                        <ul style={{margin:"6px 0 0 16px", padding:0}}>
                          {selected.items.map((it, idx) => {
                            const id   = it.productId || it.product || "";
                            const name = productLabel[id] || id || "Item";
                            const qty  = Number(it.qty ?? it.quantity ?? 1);
                            return <li key={idx} style={{fontSize:13}}>{name} × {qty}</li>;
                          })}
                        </ul>
                      ) : "—"}
                    </div>
                  </div>
                </div>

                {/* Remaining budget + timeline */}
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
                  <div style={styles.subCard}>
                    <div style={styles.subHead}>Budget usage</div>
                    {["Hotel","Food","Travel","Other"].map(k => {
                      const limit = selected?.expenseLimits?.[k] ?? 0;
                      const used  = (limit - (rem[k] ?? 0)) || 0;
                      const pct   = limit ? Math.min(100, Math.round((used/limit)*100)) : 0;
                      return (
                        <div key={k} style={{margin:"10px 0"}}>
                          <div style={{display:"flex", justifyContent:"space-between"}}>
                            <strong>{k}</strong>
                            <span style={{fontSize:12, color:"#666"}}>{pct}% used</span>
                          </div>
                          <div style={{height:8, background:"#eef2ff", borderRadius:999, overflow:"hidden"}}>
                            <div style={{width:`${pct}%`, height:"100%", background:"#91b5ff"}}/>
                          </div>
                          <div style={{fontSize:12, color:"#666", marginTop:4}}>
                            Limit: {ru(limit)} &nbsp; &nbsp;
                            Spent: {ru(used)} &nbsp; &nbsp;
                            Remaining: <strong>{ru(rem[k])}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={styles.subCard}>
                    <div style={styles.subHead}>Timeline</div>
                    <ul style={{margin:0, padding:"6px 0", listStyle:"none"}}>
                      {events.length === 0 ? (
                        <li style={{color:"#6b7280"}}>No events yet.</li>
                      ) : events.map(ev => (
                        <li key={ev.id} style={{margin:"6px 0"}}>
                          <strong>{ev.eventType.replace("_"," ")}</strong> — {new Date(ev.ts).toLocaleString()} {ev.late ? " (late)" : ""} {ev.reason ? `— ${ev.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Expenses + Add expense */}
              <div style={{display:"grid", gridTemplateColumns:"1fr", gap:16, marginTop:12}}>
                <div style={styles.card}>
                  <div style={styles.cardHead}>My expenses</div>
                  {expenses.length === 0 ? <p style={{margin:8}}>None yet.</p> : (
                    <ul style={{listStyle:"none", margin:0, padding:0}}>
                      {expenses.map(e => (
                        <li key={e.id} style={{margin:"10px 0", borderBottom:"1px solid #f2f2f2", paddingBottom:8}}>
                          <div><strong>{e.category || "(uncategorized)"}:</strong> {ru(e.editedTotal ?? e.total)} — {e.approval?.status || "—"}</div>
                          <div style={{fontSize:12, color:"#555"}}>{new Date(e.createdAt).toLocaleString()} — {e.merchant || "Merchant"}</div>
                          <div style={{display:"flex", gap:6, marginTop:6}}>
                            <button onClick={() => openReceipt(e)} style={styles.btnSmall}>Open receipt</button>
                            {e.approval?.status === "REJECTED" && (
                              <button onClick={() => beginEdit(e)} style={styles.btnSmall}>Edit &amp; resubmit</button>
                            )}
                          </div>
                          {e.approval?.status === "REJECTED" && e.approval?.note && (
                            <div style={{marginTop:6, fontSize:12, color:"#b22"}}>Admin note: {e.approval.note}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Upload + OCR + finalize new expense */}
                <div style={styles.card}>
                  <div style={styles.cardHead}>Add a new expense</div>
                  <input type="file" accept="image/*,application/pdf" ref={fileRef} onChange={onChooseFile} disabled={uploading}/>
                  {uploading && <div style={{fontSize:12, color:"#666", marginTop:6}}>Uploading & OCR…</div>}

                  {draft && (
                    <div style={{marginTop:12, border:"1px solid #eee", borderRadius:8, padding:12}}>
                      <div style={{fontSize:12, color:"#666"}}>Detected: {draft.merchant ? `${draft.merchant} • ` : ""}{draft.date || ""} {draft.currency ? `• ${draft.currency}` : ""}</div>
                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginTop:8, maxWidth:700}}>
                        <label>Category
                          <select value={category} onChange={e=>setCategory(e.target.value)}>
                            <option value="">— Select —</option>
                            <option>Hotel</option>
                            <option>Food</option>
                            <option>Travel</option>
                            <option>Other</option>
                          </select>
                        </label>
                        <label>Edited total (₹)
                          <input type="number" step="0.01" value={editedTotal} onChange={e=>setEditedTotal(e.target.value)} />
                        </label>
                        <div style={{display:"flex", alignItems:"end"}}>
                          <button onClick={submitExpense} style={styles.btn}>Submit expense</button>
                        </div>
                      </div>
                      <div style={{fontSize:12, color:"#666", marginTop:6}}>
                        If the edited total differs from OCR, admin will see it as an override. If your amount exceeds the remaining for the category, it will go to review instead of auto-approving.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

/* ------------ styles ------------ */
const styles = {
  card: {
    border: "1px solid #e6e8ef",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
    boxShadow: "0 1px 0 rgba(16,24,40,.04)"
  },
  cardHead: { fontWeight: 700, marginBottom: 10, color:"#0f172a" },
  subCard: { border:"1px dashed #e8e8ee", borderRadius:10, padding:12, background:"#fafafa", marginBottom:12 },
  subHead: { fontWeight:600, color:"#344054", marginBottom:6 },

  // --- My tasks list ---
  tasksList: {
    display:"flex",
    flexDirection:"column",
    gap:12,
    maxHeight: 420,
    overflow:"auto",
    paddingRight: 2
  },
  taskRow: {
    textAlign:"left",
    width:"100%",
    minHeight: 96,
    border:"1px solid #e5e7eb",
    background:"#ffffff",
    borderRadius:12,
    padding:"14px 16px",
    cursor:"pointer",
    outline:"none",
    boxShadow:"0 1px 2px rgba(0,0,0,0.04)",
    display:"grid",
    rowGap:8,
    boxSizing: "border-box"
  },
  taskRowActive: { background:"#eef6ff", borderColor:"#c9e2ff", boxShadow:"0 0 0 2px #e6f0ff inset" },

  rowTop: { display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" },
  taskTitle:{ fontWeight:700, color:"#0f172a", fontSize:16, overflow:"hidden", whiteSpace:"normal", paddingRight:8, lineHeight:"20px", minWidth:0 },
  slaLine:{ fontSize:14, color:"#111827", lineHeight:"20px", whiteSpace:"normal", marginTop:2, marginBottom:2 },

  // inputs for filter bar
  input: {
    width:"100%", padding:"8px 10px", border:"1px solid #e5e7eb", borderRadius:8, background:"#fff", outline:"none"
  },

  // proximity pill styles
  pillSoon:   { fontSize:11, padding:"2px 6px", borderRadius:999, background:"#eff6ff", color:"#0b4d8a", border:"1px solid #cfe3ff" },
  pillWarn:   { fontSize:11, padding:"2px 6px", borderRadius:999, background:"#fff7ed", color:"#a05a00", border:"1px solid #fde2bd" },
  pillDanger: { fontSize:11, padding:"2px 6px", borderRadius:999, background:"#fee2e2", color:"#7f1d1d", border:"1px solid #fecaca" },

  btn: {
    background:"#0b4d8a", color:"#fff", border:"1px solid #0b4d8a",
    borderRadius:8, padding:"8px 12px", fontWeight:600
  },
  btnGhost: {
    background:"#fff", color:"#0b4d8a", border:"1px solid #cfe3ff",
    borderRadius:8, padding:"8px 12px", fontWeight:600
  },
  btnSmall: {
    background:"#fff", color:"#0b4d8a", border:"1px solid #cfe3ff",
    borderRadius:6, padding:"6px 10px", fontWeight:600, fontSize:13
  }
};
