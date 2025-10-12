import { useEffect, useMemo, useState } from "react";

function ru(n){ return n==null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`; }
function toIsoFromLocal(dateStr, timeStr) {
  if (!dateStr && !timeStr) return null;
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  let hh = 0, mm = 0;
  if (timeStr) { const parts = timeStr.split(":").map(Number); hh = parts[0] ?? 0; mm = parts[1] ?? 0; }
  const dt = new Date(y, (m || 1) - 1, d || 1, hh, mm, 0);
  return dt.toISOString();
}

export default function Admin() {
  const [tenantId] = useState("default");

  // Catalog
  const [products, setProducts] = useState([]);
  const [pName, setPName] = useState("");
  const [pSku, setPSku] = useState("");
  const [pPrice, setPPrice] = useState("");

  // Task state
  const [tasks, setTasks] = useState([]);
  const [taskTitleById, setTaskTitleById] = useState({});
  const [selected, setSelected] = useState(null);

  // Create form
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [slaStartDate, setSlaStartDate] = useState("");
  const [slaStartTime, setSlaStartTime] = useState("");
  const [slaEndDate, setSlaEndDate] = useState("");
  const [slaEndTime, setSlaEndTime] = useState("");

  // Limits + details
  const [limits, setLimits] = useState({Hotel:1000, Food:1000, Travel:1000, Other:1000});
  const [expenses, setExpenses] = useState([]);
  const [events, setEvents] = useState([]);

  // Pending approval queue
  const [pending, setPending] = useState([]);
  const [note, setNote] = useState({}); // expenseId -> note string

  // Task items (staging for create)
  const [chosenProductId, setChosenProductId] = useState("");
  const [chosenQty, setChosenQty] = useState(1);
  const [taskItems, setTaskItems] = useState([]);

  // Report filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function loadProducts() {
    const r = await fetch(`/api/products`).then(r=>r.json());
    setProducts(Array.isArray(r) ? r : []);
  }
  async function loadTasks() {
    const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
    const arr = Array.isArray(j) ? j : [];
    setTasks(arr);
    const m = {}; arr.forEach(t => { m[t.id] = t.title || t.id; });
    setTaskTitleById(m);
  }
  async function loadPending() {
    const j = await fetch(`/api/expenses/pending?tenantId=${tenantId}`).then(r=>r.json());
    setPending(Array.isArray(j) ? j : []);
  }

  useEffect(()=>{ loadProducts(); loadTasks(); loadPending(); }, []);

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

  // Catalog: create product
  async function createProduct() {
    try {
      if (!pName.trim()) return alert("Name required");
      const body = { tenantId, name: pName.trim(), sku: pSku.trim() || undefined, unitPrice: pPrice ? Number(pPrice) : undefined, docType:"Product" };
      const r = await fetch(`/api/products`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      let j;
      try { j = await r.json(); } catch { j = { error: `HTTP ${r.status}` }; }
      if (!r.ok) return alert(j.error || `Create product failed (HTTP ${r.status})`);
      setPName(""); setPSku(""); setPPrice("");
      await loadProducts();
    } catch (e) {
      console.error(e);
      alert(`Create product failed: ${e.message || e}`);
    }
  }

  // Create task with items
  function addItem() {
    if (!chosenProductId) return;
    const p = products.find(x=>x.id===chosenProductId);
    if (!p) return;
    const qty = Math.max(1, Number(chosenQty || 1));
    setTaskItems(items=>{
      const i = items.findIndex(it=>it.productId===p.id);
      if (i>=0) {
        const copy = [...items];
        copy[i] = {...copy[i], qty: copy[i].qty + qty};
        return copy;
      }
      return [...items, { productId: p.id, name: p.name, sku: p.sku, qty, unitPrice: p.unitPrice }];
    });
    setChosenQty(1);
  }
  function removeItem(pid) {
    setTaskItems(items=> items.filter(it=>it.productId!==pid));
  }

  async function createTask() {
    if (!title) return alert("Title required");
    const slaStartISO = toIsoFromLocal(slaStartDate, slaStartTime);
    const slaEndISO   = toIsoFromLocal(slaEndDate, slaEndTime);

    const body = {
      tenantId, title, assignee,
      slaStart: slaStartISO, slaEnd: slaEndISO,
      type: "Data collection", status: "ASSIGNED",
      expenseLimits: limits,
      items: taskItems.map(it => ({ productId: it.productId, name: it.name, sku: it.sku, qty: it.qty, unitPrice: it.unitPrice }))
    };

    const r = await fetch(`/api/tasks`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) return alert(j.error||"create failed");

    // reset form
    setTitle(""); setAssignee("");
    setSlaStartDate(""); setSlaStartTime("");
    setSlaEndDate(""); setSlaEndTime("");
    setTaskItems([]);

    await loadTasks();
    await selectTask(j);
  }

  async function openReceiptFor(exp) {
    const filename = exp.blobPath.split("/").pop();
    const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(exp.taskId)}&filename=${encodeURIComponent(filename)}&minutes=5`).then(r=>r.json());
    if (j.readUrl) window.open(j.readUrl, "_blank");
  }

  async function decide(expenseId, action) {
    if (action === "reject" && !(note[expenseId]||"").trim()) {
      alert("Please add a note to reject.");
      return;
    }
    const url = action === "approve" ? "/api/expenses/approve" : "/api/expenses/reject";
    const r = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ tenantId, expenseId, note: note[expenseId] || "", decidedBy: "admin" })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error||`${action} failed`);
    await loadPending();
    if (selected && j.taskId === selected.id) {
      const ex = await fetch(`/api/expenses/byTask?taskId=${selected.id}&tenantId=${tenantId}`).then(r=>r.json());
      setExpenses(Array.isArray(ex)?ex:[]);
    }
  }

  const pendingSorted = useMemo(()=> {
    const arr = [...pending];
    arr.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
    return arr;
  }, [pending]);

  function downloadCsv() {
    const qs = new URLSearchParams();
    qs.set("tenantId", tenantId);
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    window.open(`/api/report/csv?${qs.toString()}`, "_blank");
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Admin portal</h1>

      {/* Report */}
      <section style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:16, background:"#f9fbff"}}>
        <h2 style={{marginTop:0}}>Reports</h2>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"end", maxWidth:600}}>
          <label>From (created on/after)
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
          </label>
          <label>To (created on/before)
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} />
          </label>
          <button onClick={downloadCsv}>Download CSV</button>
        </div>
        <div style={{fontSize:12, color:"#666", marginTop:6}}>
          CSV includes: Task basics, SLA &amp; late flag, assigned products, per-category totals (excludes rejected), counts for pending/approved/rejected.
        </div>
      </section>

      {/* Pending expenses queue */}
      <section style={{border:"2px solid #f3c", borderRadius:10, padding:14, marginBottom:16, background:"#fff6ff"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <h2 style={{margin:0}}>Pending expenses ({pending.length})</h2>
          <button onClick={loadPending}>Refresh</button>
        </div>

        {pendingSorted.length === 0 ? (
          <p style={{marginTop:8}}>Nothing pending 🎉</p>
        ) : (
          <ul style={{marginTop:12}}>
            {pendingSorted.map(e=>(
              <li key={e.id} style={{border:"1px solid #eee", borderRadius:8, padding:10, margin:"10px 0"}}>
                <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr auto", gap:8, alignItems:"center"}}>
                  <div>
                    <div><strong>{taskTitleById[e.taskId] || e.taskId}</strong></div>
                    <div style={{fontSize:12, color:"#555"}}>{new Date(e.createdAt).toLocaleString()}</div>
                    <div style={{fontSize:12, color:"#555"}}>{e.merchant || "Merchant —"}</div>
                  </div>
                  <div>Category: <strong>{e.category || "—"}</strong></div>
                  <div>Amount: <strong>{ru(e.editedTotal ?? e.total)}</strong></div>
                  <div style={{display:"flex", gap:6}}>
                    <button onClick={()=>openReceiptFor(e)}>Open receipt</button>
                  </div>
                </div>

                <div style={{display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, marginTop:8}}>
                  <input
                    placeholder="note (required to reject)"
                    value={note[e.id] || ""}
                    onChange={ev=>setNote(n => ({...n, [e.id]: ev.target.value}))}
                  />
                  <button onClick={()=>decide(e.id, "approve")}>Approve</button>
                  <button onClick={()=>decide(e.id, "reject")}>Reject</button>
                </div>

                {e.approval && <div style={{fontSize:12, color:"#666", marginTop:6}}>
                  limit {ru(e.approval.limit)} • reason: {e.approval.reason}
                </div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Product catalog */}
      <section style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:16}}>
        <h2>Product catalog</h2>
        <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr auto", gap:8, alignItems:"end", maxWidth:800}}>
          <label>Name
            <input value={pName} onChange={e=>setPName(e.target.value)} placeholder="e.g., Model X Router"/>
          </label>
          <label>SKU
            <input value={pSku} onChange={e=>setPSku(e.target.value)} placeholder="e.g., MXR-200"/>
          </label>
          <label>Unit price (₹)
            <input type="number" step="0.01" value={pPrice} onChange={e=>setPPrice(e.target.value)} placeholder="optional"/>
          </label>
          <button onClick={createProduct}>Add product</button>
        </div>

        <div style={{marginTop:10}}>
          {products.length === 0 ? <p>No products yet.</p> : (
            <ul>
              {products.map(p=>(
                <li key={p.id} style={{margin:"4px 0"}}>
                  <strong>{p.name}</strong> {p.sku ? `• ${p.sku}` : ""} {p.unitPrice ? `• ${ru(p.unitPrice)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Create task */}
      <section style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:16}}>
        <h2>Create task</h2>

        <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:8, alignItems:"end", marginBottom:10}}>
          <label>Title
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Visit Site A"/>
          </label>
          <label>Assignee
            <input value={assignee} onChange={e=>setAssignee(e.target.value)} placeholder="emp-001"/>
          </label>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, alignItems:"end"}}>
          <label>SLA start (date)
            <input type="date" value={slaStartDate} onChange={e=>setSlaStartDate(e.target.value)} />
          </label>
          <label>SLA start (time)
            <input type="time" step="60" value={slaStartTime} onChange={e=>setSlaStartTime(e.target.value)} />
          </label>
          <label>SLA end (date)
            <input type="date" value={slaEndDate} onChange={e=>setSlaEndDate(e.target.value)} />
          </label>
          <label>SLA end (time)
            <input type="time" step="60" value={slaEndTime} onChange={e=>setSlaEndTime(e.target.value)} />
          </label>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, maxWidth:720, marginTop:10}}>
          {["Hotel","Food","Travel","Other"].map(k=>(
            <label key={k}>{k}
              <input type="number" step="1" value={limits[k]??0} onChange={e=>upd(k, e.target.value)}/>
            </label>
          ))}
        </div>

        {/* Attach products */}
        <div style={{borderTop:"1px dashed #ddd", marginTop:12, paddingTop:12}}>
          <h3>Attach products</h3>
          <div style={{display:"grid", gridTemplateColumns:"2fr 1fr auto", gap:8, alignItems:"end", maxWidth:600}}>
            <label>Product
              <select value={chosenProductId} onChange={e=>setChosenProductId(e.target.value)}>
                <option value="">— Select product —</option>
                {products.map(p=><option key={p.id} value={p.id}>{p.name} {p.sku ? `• ${p.sku}` : ""}</option>)}
              </select>
            </label>
            <label>Qty
              <input type="number" min="1" step="1" value={chosenQty} onChange={e=>setChosenQty(e.target.value)} />
            </label>
            <button type="button" onClick={addItem}>Add</button>
          </div>

          {taskItems.length>0 && (
            <table style={{marginTop:10, borderCollapse:"collapse", minWidth:500}}>
              <thead><tr>
                <th style={{borderBottom:"1px solid #ddd", textAlign:"left", padding:"6px"}}>Product</th>
                <th style={{borderBottom:"1px solid #ddd", textAlign:"left", padding:"6px"}}>SKU</th>
                <th style={{borderBottom:"1px solid #ddd", textAlign:"right", padding:"6px"}}>Qty</th>
                <th></th>
              </tr></thead>
              <tbody>
                {taskItems.map(it=>(
                  <tr key={it.productId}>
                    <td style={{borderBottom:"1px solid #eee", padding:"6px"}}>{it.name}</td>
                    <td style={{borderBottom:"1px solid #eee", padding:"6px"}}>{it.sku || "—"}</td>
                    <td style={{borderBottom:"1px solid #eee", padding:"6px", textAlign:"right"}}>{it.qty}</td>
                    <td style={{borderBottom:"1px solid #eee", padding:"6px"}}><button onClick={()=>removeItem(it.productId)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{marginTop:10, fontSize:12, color:"#666"}}>
          Times are interpreted in your local timezone and saved as ISO (UTC).
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

              <h3 style={{marginTop:24}}>Assigned products</h3>
              {Array.isArray(selected.items) && selected.items.length>0 ? (
                <ul>
                  {selected.items.map(it=>(
                    <li key={it.productId}>{it.name} {it.sku ? `• ${it.sku}`:""} — Qty: <strong>{it.qty}</strong></li>
                  ))}
                </ul>
              ) : <p>None.</p>}

              <h3 style={{marginTop:24}}>Timeline</h3>
              <ul>
                {events.map(ev=>(
                  <li key={ev.id} style={{margin:"0.5rem 0"}}>
                    {ev.eventType} — {new Date(ev.ts).toLocaleString()} {ev.late ? " (late)" : ""} {ev.reason ? `— ${ev.reason}` : ""}
                  </li>
                ))}
              </ul>

              <h3 style={{marginTop:12}}>Expenses for this task</h3>
              <ul>
                {expenses.map(e=>(
                  <li key={e.id} style={{margin:"0.75rem 0"}}>
                    <div><strong>{e.category || "(uncategorized)"}:</strong> {ru(e.editedTotal ?? e.total)} — {e.approval?.status || "—"}</div>
                    <div style={{fontSize:12, color:"#555"}}>{new Date(e.createdAt).toLocaleString()} — {e.merchant || "Merchant"}</div>
                    <button onClick={()=>openReceiptFor(e)} style={{marginTop:6}}>Open receipt</button>
                    {e.isManualOverride && <span style={{marginLeft:8, fontSize:12, color:"#b95"}}>edited total</span>}
                    {e.approval?.status === "REJECTED" && e.approval?.note && (
                      <div style={{marginTop:6, fontSize:12, color:"#b22"}}>Decision note: {e.approval.note}</div>
                    )}
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
