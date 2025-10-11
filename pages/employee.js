import { useEffect, useMemo, useState } from "react";

function sanitizeName(name) {
  return name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
}

export default function Employee() {
  const [tenantId] = useState("default");

  // Task picker state
  const [tasks, setTasks] = useState([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskId, setTaskId] = useState(""); // internal id used by API

  // Expense upload/finalize state
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("Food");
  const [editedTotal, setEditedTotal] = useState("");
  const [lateReason, setLateReason] = useState("");

  const [log, setLog] = useState([]);
  const [ocr, setOcr] = useState(null);
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState([]);

  const pushLog = (m) => setLog((l)=>[m, ...l]);

  // Load tasks for the dropdown
  async function loadTasks() {
    const r = await fetch(`/api/tasks?tenantId=${tenantId}`);
    const j = await r.json();
    // Show only non-completed tasks by default (employee-focused)
    const filtered = Array.isArray(j) ? j.filter(t => t.status !== "COMPLETED") : [];
    setTasks(filtered);
  }
  useEffect(()=>{ loadTasks(); }, []);

  const filteredTasks = useMemo(()=>{
    const q = taskQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t => {
      const name = (t.title || "").toLowerCase();
      return name.includes(q) || (t.id || "").toLowerCase().includes(q) || (t.assignee || "").toLowerCase().includes(q);
    });
  }, [tasks, taskQuery]);

  const selectedTask = useMemo(()=> tasks.find(t => t.id === taskId) || null, [tasks, taskId]);

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
      body: JSON.stringify({tenantId, taskId, ...pos})
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-in failed");
    pushLog(`Checked in at ${j.ts}`);
  }

  async function checkOut() {
    if (!taskId) return alert("Pick a Task");
    const pos = await getPos();
    const r = await fetch("/api/tasks/checkout", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({tenantId, taskId, reason: lateReason || undefined, ...pos})
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"check-out failed");
    pushLog(`Checked out at ${j.event.ts} ${j.event.late ? "(late)" : ""}`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!taskId || !file) { alert("Pick a Task and choose a file"); return; }
    setLoading(true); setApproval(null); setOcr(null);
    try {
      const safeName = sanitizeName(file.name);
      pushLog(`SAS for ${safeName}…`);
      const sas = await fetch(`/api/receipts/sas?taskId=${encodeURIComponent(taskId)}&filename=${encodeURIComponent(safeName)}`).then(r=>r.json());
      if (sas.error) throw new Error(sas.error);

      pushLog(`Uploading…`);
      const put = await fetch(sas.uploadUrl, { method:"PUT", headers:{ "x-ms-blob-type":"BlockBlob" }, body:file });
      if (!put.ok) throw new Error("Upload failed");

      pushLog(`OCR…`);
      const ocrRes = await fetch(`/api/receipts/ocr`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ taskId, filename: safeName, tenantId, save: true })
      });
      const ocrJson = await ocrRes.json();
      if (!ocrRes.ok) throw new Error(ocrJson.error||"OCR error");
      setOcr(ocrJson.ocr || null);

      // Grab the latest expense and finalize
      const all = await fetch(`/api/expenses?tenantId=${tenantId}`).then(r=>r.json());
      const latest = all[0];
      const finRes = await fetch(`/api/expenses/finalize`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          tenantId, expenseId: latest.id, category,
          total: editedTotal ? Number(editedTotal) : latest.total,
          submittedBy: "emp-001", comment: "Submitted from employee portal"
        })
      });
      const fin = await finRes.json();
      if (!finRes.ok) throw new Error(fin.error||"Finalize error");
      setApproval(fin.approval);
      pushLog(`Expense ${fin.approval?.status}`);
    } catch(e){ alert(e.message); pushLog("Error: "+e.message); }
    finally { setLoading(false); }
  }

  async function loadTaskExpenses() {
    if (!taskId) return alert("Pick a Task");
    const j = await fetch(`/api/expenses/byTask?taskId=${encodeURIComponent(taskId)}&tenantId=${tenantId}`).then(r=>r.json());
    setExpenses(Array.isArray(j)?j:[]);
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

      {/* Task picker by NAME (id is hidden) */}
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
          <button onClick={loadTasks}>Refresh</button>
        </div>
        {selectedTask && (
          <div style={{fontSize:12, color:"#555"}}>
            <strong>Selected:</strong> {(selectedTask.title || "(untitled)")} • Status: {selectedTask.status}
            {selectedTask.assignee ? ` • Assignee: ${selectedTask.assignee}` : "" }
          </div>
        )}

        <div style={{display:"flex", gap:8}}>
          <button onClick={checkIn} disabled={!taskId}>Check in</button>
          <input placeholder="late reason (only if late)" value={lateReason} onChange={e=>setLateReason(e.target.value)} style={{flex:1}}/>
          <button onClick={checkOut} disabled={!taskId}>Check out</button>
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
      <h2>My task expenses</h2>
      <button onClick={loadTaskExpenses} disabled={!taskId}>Refresh list</button>
      <ul>
        {expenses.map(e=>(
          <li key={e.id} style={{margin:"0.75rem 0"}}>
            <div><strong>{e.category || "(uncategorized)"}:</strong> ₹{e.editedTotal ?? e.total} — {e.approval?.status || "—"}</div>
            <div style={{fontSize:13, color:"#555"}}>{new Date(e.createdAt).toLocaleString()}</div>
            <div><button onClick={()=>openReceipt(e.blobPath)} style={{marginTop:6}}>Open receipt</button></div>
          </li>
        ))}
      </ul>

      <hr/><h3>Logs</h3>
      <ul style={{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", fontSize:12}}>
        {log.map((m,i)=>(<li key={i}>{m}</li>))}
      </ul>
    </main>
  );
}
