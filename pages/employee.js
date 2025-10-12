import { useEffect, useMemo, useState } from "react";

function sanitizeName(name) {
  return name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
}
function ru(n){ return n==null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`; }

export default function Employee() {
  const [tenantId] = useState("default");
  const [employeeId] = useState("emp-001");

  const [tasks, setTasks] = useState([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskId, setTaskId] = useState("");
  const selectedTask = useMemo(()=> tasks.find(t=>t.id===taskId) || null, [tasks, taskId]);

  const [events, setEvents] = useState([]);

  // Expense flow
  const [file, setFile] = useState(null);
  const [lastFileName, setLastFileName] = useState("");
  const [expenseId, setExpenseId] = useState(null);
  const [category, setCategory] = useState("Food");
  const [editedTotal, setEditedTotal] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [ocr, setOcr] = useState(null);
  const [approval, setApproval] = useState(null);
  const [currentExpense, setCurrentExpense] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState([]);

  useEffect(() => {
    (async () => {
      const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
      setTasks(Array.isArray(j) ? j.filter(t => t.status !== "COMPLETED") : []);
    })();
  }, []);

  useEffect(() => { taskId ? loadEvents() : setEvents([]); loadTaskExpenses(); }, [taskId]);

  async function loadEvents() {
    if (!taskId) return;
    const j = await fetch(`/api/tasks/events?taskId=${encodeURIComponent(taskId)}&tenantId=${tenantId}`).then(r=>r.json());
    const arr = Array.isArray(j) ? [...j].sort((a,b)=> new Date(b.ts) - new Date(a.ts)) : [];
    setEvents(arr);
  }

  const filteredTasks = useMemo(()=>{
    const q = taskQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t => (t.title||"").toLowerCase().includes(q) || (t.assignee||"").toLowerCase().includes(q) || (t.id||"").toLowerCase().includes(q));
  }, [tasks, taskQuery]);

  const hasCheckIn  = events.some(e => e.eventType === "CHECK_IN");
  const hasCheckOut = events.some(e => e.eventType === "CHECK_OUT");

  function onFileChange(f) {
    setFile(f || null);
    if (f) {
      const safe = sanitizeName(f.name);
      setLastFileName(safe);
      setExpenseId(null);
      setOcr(null); setApproval(null); setCurrentExpense(null); setEditedTotal("");
    } else {
      setLastFileName("");
      setExpenseId(null);
      setCurrentExpense(null);
    }
  }

  async function getPos() {
    if (!navigator.geolocation) return {};
    try {
      return await new Promise((res)=>navigator.geolocation.getCurrentPosition(
        p=>res({lat:p.coords.latitude,lng:p.coords.longitude}), ()=>res({})
      ));
    } catch { return {}; }
  }

  async function checkIn() {
    if (!taskId) return alert("Pick a Task");
    const pos = await getPos();
    const r = await fetch("/api/tasks/checkin", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({tenantId, taskId, employeeId, ...pos}) });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-in failed");
    await loadEvents();
    if (j.idempotent) alert("Already checked in.");
  }

  async function checkOut() {
    if (!taskId) return alert("Pick a Task");
    const pos = await getPos();
    const r = await fetch("/api/tasks/checkout", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({tenantId, taskId, reason: lateReason || undefined, employeeId, ...pos}) });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-out failed");
    await loadEvents();
    if (j.idempotent) alert("Already checked out.");
  }

  function totalOrUndefined() { return editedTotal !== "" ? Number(editedTotal) : undefined; }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!taskId) return alert("Pick a Task");
    try {
      setLoading(true); setApproval(null);

      // Update existing expense
      if (expenseId) {
        const finRes = await fetch(`/api/expenses/finalize`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ tenantId, expenseId, category, total: totalOrUndefined(), submittedBy: employeeId, comment: "Edited total" })
        });
        const fin = await finRes.json();
        if (!finRes.ok) throw new Error(fin.error || "Finalize error");
        setApproval(fin.approval);
        setCurrentExpense(fin);
        await loadTaskExpenses();
        return;
      }

      // First submit: upload + OCR + finalize
      if (!file) return alert("Choose a receipt file first");
      const sas = await fetch(`/api/receipts/sas?taskId=${encodeURIComponent(taskId)}&filename=${encodeURIComponent(lastFileName)}`).then(r=>r.json());
      if (sas.error) throw new Error(sas.error);

      const put = await fetch(sas.uploadUrl, { method:"PUT", headers:{ "x-ms-blob-type":"BlockBlob" }, body:file });
      if (!put.ok) throw new Error("Upload failed");

      const ocrRes = await fetch(`/api/receipts/ocr`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ taskId, filename: lastFileName, tenantId, save: true })
      });
      const ocrJson = await ocrRes.json();
      if (!ocrRes.ok) throw new Error(ocrJson.error||"OCR error");

      setOcr(ocrJson.ocr || null);
      const exp = ocrJson.saved || ocrJson.existing || null;
      if (!exp || !exp.id) throw new Error("Expense upsert failed");
      setExpenseId(exp.id);

      const finRes = await fetch(`/api/expenses/finalize`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ tenantId, expenseId: exp.id, category, total: totalOrUndefined() ?? exp.total, submittedBy: employeeId, comment: "Submitted from employee portal" })
      });
      const fin = await finRes.json();
      if (!finRes.ok) throw new Error(fin.error||"Finalize error");
      setApproval(fin.approval);
      setCurrentExpense(fin);
      await loadTaskExpenses();

    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTaskExpenses() {
    if (!taskId) { setExpenses([]); return; }
    const j = await fetch(`/api/expenses/byTask?taskId=${encodeURIComponent(taskId)}&tenantId=${tenantId}`).then(r=>r.json());
    setExpenses(Array.isArray(j)?j:[]);
  }

  async function openReceipt(blobPath) {
    if (!taskId) return;
    const filename = blobPath.split("/").pop();
    const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(taskId)}&filename=${encodeURIComponent(filename)}&minutes=3`).then(r=>r.json());
    if (j.readUrl) window.open(j.readUrl,"_blank");
  }

  function startEditingRejected(e) {
    setExpenseId(e.id);
    setCategory(e.category || "Food");
    const base = e.editedTotal ?? e.total;
    setEditedTotal(base != null ? String(base) : "");
    setOcr(null); setApproval(e.approval || null);
    setCurrentExpense(e);
    setFile(null); setLastFileName("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Remaining-only budget ----------
  const limits = selectedTask?.expenseLimits || {Hotel:1000, Food:1000, Travel:1000, Other:1000};
  const remaining = useMemo(() => {
    const cats = ["Hotel","Food","Travel","Other"];
    const spentByCat = Object.create(null);
    let overallSpent = 0;

    (expenses || []).forEach(e => {
      if (e.taskId !== taskId) return;
      const status = e.approval?.status;
      if (status === "REJECTED") return; // rejected doesn't consume budget
      const cat = cats.includes(e.category) ? e.category : "Other";
      const amt = Number(e.editedTotal ?? e.total) || 0;
      spentByCat[cat] = (spentByCat[cat] || 0) + amt;
      overallSpent += amt;
    });

    const per = cats.map(cat => {
      const limit = Number(limits[cat] ?? (cat==="Other" ? 1000 : 0)) || 0;
      const spent = Number(spentByCat[cat] || 0);
      return { cat, remaining: limit - spent };
    });

    const overallLimit = cats.reduce((s,k)=> s + (Number(limits[k]||0)), 0);
    return { per, overallRemaining: overallLimit - overallSpent };
  }, [expenses, taskId, limits]);

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto", maxWidth:900}}>
      <h1>Employee portal</h1>

      {/* Task picker */}
      <section style={{display:"grid", gap:10, margin:"1rem 0"}}>
        <div style={{display:"grid", gridTemplateColumns:"2fr 2fr auto", gap:8, alignItems:"end"}}>
          <label>Search task
            <input value={taskQuery} onChange={e=>setTaskQuery(e.target.value)} placeholder="type name / assignee / id"/>
          </label>
          <label>Task
            <select value={taskId} onChange={e=>{ setTaskId(e.target.value); setEvents([]); }}>
              <option value="">— Select a task —</option>
              {filteredTasks.map(t=>(
                <option key={t.id} value={t.id}>
                  {(t.title || "(untitled)")} {t.assignee ? `• ${t.assignee}` : ""} {t.slaEnd ? `• due ${new Date(t.slaEnd).toLocaleString()}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button onClick={()=>{ if (taskId) loadEvents(); }}>Refresh log</button>
        </div>

        <div style={{display:"flex", gap:8}}>
          <button onClick={checkIn} disabled={!taskId || hasCheckIn}>Check in</button>
          <input placeholder="late reason (only if late)" value={lateReason} onChange={e=>setLateReason(e.target.value)} style={{flex:1}}/>
          <button onClick={checkOut} disabled={!taskId || !hasCheckIn || hasCheckOut}>Check out</button>
        </div>
      </section>

      {/* ---------- Assigned products ---------- */}
      {selectedTask && (
        <section style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:16, background:"#fafafa"}}>
          <h2 style={{margin:"0 0 8px"}}>Assigned products</h2>
          {Array.isArray(selectedTask.items) && selectedTask.items.length>0 ? (
            <ul>
              {selectedTask.items.map(it=>(
                <li key={it.productId}>
                  <strong>{it.name}</strong> {it.sku ? `• ${it.sku}` : ""} — Qty: {it.qty}
                </li>
              ))}
            </ul>
          ) : <p>None for this task.</p>}

          {/* Remaining budget (overall + per category) */}
          <div style={{marginTop:12}}>
            <div style={{marginBottom:6}}>Overall remaining: <strong style={{color: remaining.overallRemaining < 0 ? "#c62828" : "#2e7d32"}}>{ru(remaining.overallRemaining)}</strong></div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10}}>
              {remaining.per.map(row => (
                <div key={row.cat} style={{border:"1px solid #eee", borderRadius:8, padding:"10px 12px"}}>
                  <div style={{display:"flex", justifyContent:"space-between"}}>
                    <span><strong>{row.cat}</strong></span>
                    <span style={{color: row.remaining < 0 ? "#c62828" : "#2e7d32"}}>{ru(row.remaining)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Expense form */}
      <form onSubmit={handleSubmit} style={{display:"grid", gap:12, margin:"1rem 0"}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <label style={{flex:1}}>Receipt file
            <input type="file" onChange={e=>onFileChange(e.target.files?.[0]||null)} accept=".jpg,.jpeg,.png,.pdf"/>
          </label>
          <button type="button" onClick={()=>{ setFile(null); setLastFileName(""); setExpenseId(null); setOcr(null); setApproval(null); setCurrentExpense(null); setEditedTotal(""); }} disabled={!file && !expenseId}>
            Reset file
          </button>
        </div>
        <label>Category
          <select value={category} onChange={e=>setCategory(e.target.value)}>
            <option>Food</option><option>Hotel</option><option>Travel</option><option>Other</option>
          </select>
        </label>
        <label>Edited total (optional)
          <input type="number" step="0.01" value={editedTotal} onChange={e=>setEditedTotal(e.target.value)} placeholder="leave empty to keep OCR total"/>
        </label>
        <button disabled={loading || !taskId || (!expenseId && !file)} style={{padding:"0.6rem 1rem"}}>
          {loading ? "Submitting…" : (expenseId ? "Update expense" : "Submit expense")}
        </button>
        {expenseId && <div style={{fontSize:12, color:"#555"}}>Editing existing expense: <code>{expenseId}</code></div>}
      </form>

      {/* Feedback only when REJECTED */}
      {currentExpense?.approval?.status === "REJECTED" && currentExpense?.approval?.note && (
        <div style={{border:"1px solid #f4c", background:"#fff6ff", padding:"1rem", borderRadius:8, marginBottom:"1rem"}}>
          <strong>Admin feedback:</strong>
          <div style={{marginTop:6}}>{currentExpense.approval.note}</div>
        </div>
      )}

      {ocr && <div style={{border:"1px solid #ddd", padding:"1rem", borderRadius:8, marginBottom:"1rem"}}>
        <strong>OCR (raw)</strong>
        <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(ocr, null, 2)}</pre>
      </div>}
      {approval && <div style={{border:"1px solid #ddd", padding:"1rem", borderRadius:8, marginBottom:"1rem"}}>
        <strong>Approval</strong>
        <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(approval, null, 2)}</pre>
      </div>}

      <hr/>
      <h2>My task expenses</h2>
      <button onClick={loadTaskExpenses} disabled={!taskId}>Refresh list</button>
      <ul>
        {expenses.map(e=>(
          <li key={e.id} style={{margin:"0.75rem 0", border:"1px solid #eee", padding:"8px", borderRadius:8}}>
            <div><strong>{e.category || "(uncategorized)"}:</strong> ₹{e.editedTotal ?? e.total} — {e.approval?.status || "—"}</div>
            <div style={{fontSize:13, color:"#555"}}>{new Date(e.createdAt).toLocaleString()}</div>
            <div style={{display:"flex", gap:8, marginTop:6}}>
              <button onClick={()=>openReceipt(e.blobPath)}>Open receipt</button>
              {e.approval?.status === "REJECTED" && (
                <button onClick={()=>startEditingRejected(e)}>Edit &amp; resubmit</button>
              )}
            </div>
            {e.approval?.status === "REJECTED" && e.approval?.note && (
              <div style={{marginTop:6, fontSize:13, color:"#b22"}}>
                Admin feedback: {e.approval.note}
              </div>
            )}
          </li>
        ))}
      </ul>

      <hr/>
      <h2>Logs (timeline)</h2>
      <ul>
        {events.map(ev=>(
          <li key={ev.id} style={{margin:"0.5rem 0"}}>
            {ev.eventType} — {new Date(ev.ts).toLocaleString()} {ev.late ? " (late)" : ""} {ev.reason ? `— ${ev.reason}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
