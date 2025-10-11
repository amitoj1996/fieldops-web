import { useEffect, useState } from "react";

export default function Admin() {
  const [tenantId] = useState("default");
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [limits, setLimits] = useState({Hotel:1000, Food:1000, Travel:1000, Other:1000});
  const [expenses, setExpenses] = useState([]);

  async function loadTasks() {
    const r = await fetch(`/api/tasks?tenantId=${tenantId}`);
    const j = await r.json();
    setTasks(Array.isArray(j) ? j : []);
  }
  useEffect(()=>{ loadTasks(); }, []);

  async function selectTask(t) {
    setSelected(t);
    setLimits(t.expenseLimits || {Hotel:1000, Food:1000, Travel:1000, Other:1000});
    const r = await fetch(`/api/expenses/byTask?taskId=${t.id}&tenantId=${tenantId}`);
    const j = await r.json();
    setExpenses(Array.isArray(j) ? j : []);
  }

  function upd(field, val) {
    setLimits((L)=>({...L, [field]: Number(val||0)}));
  }

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

  async function openReceipt(blobPath) {
    const filename = blobPath.split("/").slice(-1)[0];
    const r = await fetch(`/api/receipts/readSas?taskId=${selected.id}&filename=${encodeURIComponent(filename)}&minutes=5`);
    const j = await r.json();
    if (j.readUrl) window.open(j.readUrl, "_blank");
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Admin portal</h1>

      <section style={{display:"grid", gridTemplateColumns:"1fr 2fr", gap:16}}>
        <div>
          <h2>Tasks</h2>
          <button onClick={loadTasks}>Refresh</button>
          <ul style={{marginTop:12}}>
            {tasks.map(t=>(
              <li key={t.id} style={{margin:"0.5rem 0"}}>
                <button onClick={()=>selectTask(t)} style={{display:"block", width:"100%", textAlign:"left"}}>
                  <strong>{t.title || t.type}</strong>
                  <div style={{fontSize:12, color:"#555"}}>ID: {t.id} • Assignee: {t.assignee || "—"}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {selected ? (
            <>
              <h2>Limits for task: <span style={{fontWeight:600}}>{selected.title || selected.id}</span></h2>
              <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, maxWidth:720}}>
                {["Hotel","Food","Travel","Other"].map(k=>(
                  <label key={k}>{k}
                    <input type="number" step="1" value={limits[k] ?? 0} onChange={e=>upd(k, e.target.value)} />
                  </label>
                ))}
              </div>
              <button onClick={saveLimits} style={{marginTop:10}}>Save limits</button>

              <h3 style={{marginTop:24}}>Expenses</h3>
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
