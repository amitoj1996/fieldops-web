import { useEffect, useState } from "react";

export default function Admin() {
  const [tenantId] = useState("default");
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [limits, setLimits] = useState({Hotel:1000, Food:1000, Travel:1000, Other:1000});
  const [expenses, setExpenses] = useState([]);
  const [events, setEvents] = useState([]);
  // create form
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [slaStart, setSlaStart] = useState("");
  const [slaEnd, setSlaEnd] = useState("");

  async function loadTasks() {
    const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
    setTasks(Array.isArray(j) ? j : []);
  }
  useEffect(()=>{ loadTasks(); }, []);

  async function selectTask(t) {
    setSelected(t);
    setLimits(t.expenseLimits || {Hotel:1000, Food:1000, Travel:1000, Other:1000});
    const ex = await fetch(`/api/expenses/byTask?taskId=${t.id}&tenantId=${tenantId}`).then(r=>r.json());
    setExpenses(Array.isArray(ex)?ex:[]);
    const ev = await fetch(`/api/tasks/events?taskId=${t.id}&tenantId=${tenantId}`).then(r=>r.json());
    setEvents(Array.isArray(ev)?ev:[]);
  }

  function upd(field, val) { setLimits((L)=>({...L, [field]: Number(val||0)})); }

  async function saveLimits() {
    if (!selected) return;
    const r = await fetch(`/api/tasks/limits`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ tenantId, taskId: selected.id, expenseLimits: limits })
    });
    const j = await r.json();
    setSelected(j);
    await selectTask(j);
  }

  async function createTask() {
    if (!title) return alert("Title required");
    const body = {
      tenantId, title, assignee,
      slaStart: slaStart ? new Date(slaStart).toISOString() : null,
      slaEnd:   slaEnd   ? new Date(slaEnd).toISOString()   : null,
      type: "Data collection",
      status: "ASSIGNED",
      expenseLimits: limits
    };
    const r = await fetch(`/api/tasks`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"create failed");
    setTitle(""); setAssignee(""); setSlaStart(""); setSlaEnd("");
    await loadTasks();
    await selectTask(j);
  }

  async function openReceipt(blobPath) {
    const filename = blobPath.split("/").slice(-1)[0];
    const j = await fetch(`/api/receipts/readSas?taskId=${selected.id}&filename=${encodeURIComponent(filename)}&minutes=5`).then(r=>r.json());
    if (j.readUrl) window.open(j.readUrl, "_blank");
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Admin portal</h1>

      <section style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:16}}>
        <h2>Create task</h2>
        <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:8, alignItems:"end"}}>
          <label>Title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Visit Site A"/></label>
          <label>Assignee<input value={assignee} onChange={e=>setAssignee(e.target.value)} placeholder="emp-001"/></label>
          <label>SLA start<input type="datetime-local" value={slaStart} onChange={e=>setSlaStart(e.target.value)}/></label>
          <label>SLA end<input type="datetime-local" value={slaEnd} onChange={e=>setSlaEnd(e.target.value)}/></label>
        </div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, maxWidth:720, marginTop:8}}>
          {["Hotel","Food","Travel","Other"].map(k=>(
            <label key={k}>{k}<input type="number" step="1" value={limits[k]??0} onChange={e=>upd(k, e.target.value)}/></label>
          ))}
        </div>
        <button onClick={createTask} style={{marginTop:10}}>Create task</button>
      </section>

      <section style={{display:"grid", gridTemplateColumns:"1fr 2fr", gap:16}}>
        <div>
          <h2>Tasks</h2>
          <button onClick={loadTasks}>Refresh</button>
          <ul style={{marginTop:12}}>
            {tasks.map(t=>(
              <li key={t.id} style={{margin:"0.5rem 0"}}>
                <button onClick={()=>selectTask(t)} style={{display:"block", width:"100%", textAlign:"left"}}>
                  <strong>{t.title || t.type}</strong>
                  <div style={{fontSize:12, color:"#555"}}>ID: {t.id} • Assignee: {t.assignee || "—"} • Status: {t.status}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {selected ? (
            <>
              <h2>Limits for: <span style={{fontWeight:600}}>{selected.title || selected.id}</span></h2>
              <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, maxWidth:720}}>
                {["Hotel","Food","Travel","Other"].map(k=>(
                  <label key={k}>{k}
                    <input type="number" step="1" value={limits[k] ?? 0} onChange={e=>upd(k, e.target.value)} />
                  </label>
                ))}
              </div>
              <button onClick={saveLimits} style={{marginTop:10}}>Save limits</button>

              <h3 style={{marginTop:24}}>Timeline</h3>
              <ul>
                {events.map(ev=>(
                  <li key={ev.id} style={{margin:"0.5rem 0"}}>
                    {ev.eventType} — {new Date(ev.ts).toLocaleString()} {ev.late ? " (late)" : ""} {ev.reason ? `— ${ev.reason}` : ""}
                  </li>
                ))}
              </ul>

              <h3 style={{marginTop:12}}>Expenses</h3>
              <ul>
                {expenses.map(e=>(
                  <li key={e.id} style={{margin:"0.75rem 0"}}>
                    <div><strong>{e.category || "(uncategorized)"}:</strong> ₹{e.editedTotal ?? e.total} — {e.approval?.status || "—"}</div>
                    <div style={{fontSize:12, color:"#555"}}>{new Date(e.createdAt).toLocaleString()} — {e.merchant || "Merchant"}</div>
                    <button onClick={()=>openReceipt(e.blobPath)} style={{marginTop:6}}>Open receipt</button>
                    {e.isManualOverride && <span style={{marginLeft:8, fontSize:12, color:"#b95"}}>edited total</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : <p>Select a task to view details.</p>}
        </div>
      </section>
    </main>
  );
}
