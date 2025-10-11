import { useEffect, useMemo, useState } from "react";

function sanitizeName(name) {
  return name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
}

export default function Employee() {
  const [tenantId] = useState("default");
  const [employeeId] = useState("emp-001"); // TODO: replace with signed-in user when we add auth

  // Task picker
  const [tasks, setTasks] = useState([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskId, setTaskId] = useState("");

  // Timeline (persistent logs)
  const [events, setEvents] = useState([]);

  // Expense state
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("Food");
  const [editedTotal, setEditedTotal] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [ocr, setOcr] = useState(null);
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load tasks (non-completed) for the dropdown
  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/tasks?tenantId=${tenantId}`);
      const j = await r.json();
      const filtered = Array.isArray(j) ? j.filter(t => t.status !== "COMPLETED") : [];
      setTasks(filtered);
    })();
  }, []);

  // Load timeline whenever task changes
  useEffect(() => {
    if (!taskId) { setEvents([]); return; }
    loadEvents();
  }, [taskId]);

  async function loadEvents() {
    if (!taskId) return;
    const r = await fetch(`/api/tasks/events?taskId=${encodeURIComponent(taskId)}&tenantId=${tenantId}`);
    const j = await r.json();
    // ensure newest first in UI
    const arr = Array.isArray(j) ? [...j].sort((a,b)=> new Date(b.ts) - new Date(a.ts)) : [];
    setEvents(arr);
  }

  const filteredTasks = useMemo(()=>{
    const q = taskQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t => (t.title||"").toLowerCase().includes(q) || (t.assignee||"").toLowerCase().includes(q) || (t.id||"").toLowerCase().includes(q));
  }, [tasks, taskQuery]);

  const selectedTask = useMemo(()=> tasks.find(t => t.id === taskId) || null, [tasks, taskId]);

  // Derived flags to control CI/CO buttons
  const hasCheckIn  = events.some(e => e.eventType === "CHECK_IN");
  const hasCheckOut = events.some(e => e.eventType === "CHECK_OUT");

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
    const r = await fetch("/api/tasks/checkin", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({tenantId, taskId, employeeId, ...pos})
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-in failed");
    await loadEvents(); // refresh persistent log & disable button
    if (j.idempotent) alert("Already checked in for this task.");
  }

  async function checkOut() {
    if (!taskId) return alert("Pick a Task");
    const pos = await getPos();
    const r = await fetch("/api/tasks/checkout", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({tenantId, taskId, reason: lateReason || undefined, employeeId, ...pos})
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-out failed");
    await loadEvents();
    if (j.idempotent) alert("Already checked out for this task.");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!taskId || !file) { alert("Pick a Task and choose a file"); return; }
    setLoading(true); setApproval(null); setOcr(null);
    try {
      const safeName = sanitizeName(file.name);

      // SAS + Upload
      const sas = await fetch(`/api/receipts/sas?taskId=${encodeURIComponent(taskId)}&filename=${encodeURIComponent(safeName)}`).then(r=>r.json());
      if (sas.error) throw new Error(sas.error);
      const put = await fetch(sas.uploadUrl, { method:"PUT", headers:{ "x-ms-blob-type":"BlockBlob" }, body:file });
      if (!put.ok) throw new Error("Upload failed");

      // OCR (save)
      const ocrRes = await fetch(`/api/receipts/ocr`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ taskId, filename: safeName, tenantId, save: true })
      });
      const ocrJson = await ocrRes.json();
      if (!ocrRes.ok) throw new Error(ocrJson.error||"OCR error");
      setOcr(ocrJson.ocr || null);

      // Finalize
      const all = await fetch(`/api/expenses?tenantId=${tenantId}`).then(r=>r.json());
      const latest = all[0];
      const finRes = await fetch(`/api/expenses/finalize`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          tenantId, expenseId: latest.id, category,
          total: editedTotal ? Number(editedTotal) : latest.total,
          submittedBy: employeeId, comment: "Submitted from employee portal"
        })
      });
      const fin = await finRes.json();
      if (!finRes.ok) throw new Error(fin.error||"Finalize error");
      setApproval(fin.approval);
    } catch(e){ alert(e.message); }
    finally { setLoading(false); }
  }

  async function openReceipt(blobPath) {
    if (!taskId) return;
    const filename = blobPath.split("/").pop();
    const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(taskId)}&filename=${encodeURIComponent(filename)}&minutes=3`).then(r=>r.json());
    if (j.readUrl) window.open(j.readUrl,"_blank");
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto", maxWidth:900}}>
      <h1>Employee portal</h1>

      {/* Task picker by NAME */}
      <section style={{display:"grid", gap:10, margin:"1rem 0"}}>
        <div style={{display:"grid", gridTemplateColumns:"2fr 2fr auto", gap:8, alignItems:"end"}}>
          <label>Search task
            <input value={taskQuery} onChange={e=>setTaskQuery(e.target.value)} placeholder="type name / assignee / id"/>
          </label>
          <label>Task
            <select value={taskId} onChange={e=>setTaskId(e.target.value)}>
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

      {/* Expense flow */}
      <form onSubmit={handleSubmit} style={{display:"grid", gap:12, margin:"1rem 0"}}>
        <label>Receipt file
          <input type="file" onChange={e=>setFile(e.target.files?.[0]||null)} accept=".jpg,.jpeg,.png,.pdf"/>
        </label>
        <label>Category
          <select value={category} onChange={e=>setCategory(e.target.value)}>
            <option>Food</option><option>Hotel</option><option>Travel</option><option>Other</option>
          </select>
        </label>
        <label>Edited total (optional)
          <input type="number" step="0.01" value={editedTotal} onChange={e=>setEditedTotal(e.target.value)} placeholder="leave empty to keep OCR total"/>
        </label>
        <button disabled={loading || !taskId || !file} style={{padding:"0.6rem 1rem"}}>
          {loading ? "Submitting…" : "Submit expense"}
        </button>
      </form>

      {ocr && <div style={{border:"1px solid #ddd", padding:"1rem", borderRadius:8, marginBottom:"1rem"}}>
        <strong>OCR:</strong>
        <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(ocr, null, 2)}</pre>
      </div>}
      {approval && <div style={{border:"1px solid #ddd", padding:"1rem", borderRadius:8, marginBottom:"1rem"}}>
        <strong>Approval:</strong>
        <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(approval, null, 2)}</pre>
      </div>}

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
