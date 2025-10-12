import { useEffect, useMemo, useState } from "react";

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
const ru = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`);

function toDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function toTimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function combineISO(dateStr, timeStr) {
  if (!dateStr && !timeStr) return "";
  const t = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : "00:00";
  const d = dateStr || new Date().toISOString().slice(0,10);
  return new Date(`${d}T${t}`).toISOString();
}

export default function Admin() {
  const me = useAuth();
  const [tenantId] = useState("default");

  // Tasks + lookup
  const [tasks, setTasks] = useState([]);
  const tasksById = useMemo(() => {
    const m = {};
    (tasks||[]).forEach(t => m[t.id] = t);
    return m;
  }, [tasks]);

  // Products (shared: for create & edit task)
  const [products, setProducts] = useState([]);
  async function loadProducts() {
    try {
      const j = await fetch(`/api/products?tenantId=${tenantId}`).then(r=>r.json());
      if (Array.isArray(j)) setProducts(j);
    } catch {}
  }
  useEffect(() => { loadProducts(); }, [tenantId]);

  // Pending review
  const [pending, setPending] = useState([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [decidingId, setDecidingId] = useState(null);
  const [notes, setNotes] = useState({});

  // All expenses (any status)
  const [expenses, setExpenses] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  // Create task (SLA split + products restored)
  const [newTask, setNewTask] = useState({
    title: "",
    type: "data_collection",
    assignee: "",
    slaStartDate: "",
    slaStartTime: "",
    slaEndDate: "",
    slaEndTime: "",
    expenseLimits: { Hotel:1000, Food:1000, Travel:1000, Other:1000 },
    items: [] // [{productId, quantity}]
  });
  function createAddItem() {
    setNewTask(prev => ({ ...prev, items: [...(prev.items||[]), {productId:"", quantity:1}] }));
  }
  function createUpdateItem(idx, patch) {
    setNewTask(prev => {
      const arr = (prev.items||[]).slice();
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, items: arr };
    });
  }
  function createRemoveItem(idx) {
    setNewTask(prev => ({ ...prev, items: (prev.items||[]).filter((_,i)=>i!==idx) }));
  }

  // Edit modal state (includes products)
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    type: "data_collection",
    assignee: "",
    slaStartDate: "",
    slaStartTime: "",
    slaEndDate: "",
    slaEndTime: "",
    expenseLimits: { Hotel:1000, Food:1000, Travel:1000, Other:1000 },
    items: [] // [{productId, quantity}]
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Product create (admin section)
  const [newProduct, setNewProduct] = useState({ name:"", sku:"" });
  const [savingProduct, setSavingProduct] = useState(false);

  // Load tasks + expenses
  useEffect(() => {
    (async () => {
      try {
        const t = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
        setTasks(Array.isArray(t)? t : []);
      } catch(e){ console.error(e); }
    })();
  }, [tenantId]);

  async function loadPending() {
    setLoadingPending(true);
    try {
      const p = await fetch(`/api/expenses/pending?tenantId=${tenantId}`).then(r=>r.json());
      setPending(Array.isArray(p)? p : []);
    } catch(e){ console.error(e); }
    finally { setLoadingPending(false); }
  }
  async function loadAllExpenses() {
    setLoadingAll(true);
    try {
      const all = await fetch(`/api/expenses?tenantId=${tenantId}`).then(r=>r.json());
      const arr = Array.isArray(all) ? all.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)) : [];
      setExpenses(arr);
    } catch(e){ console.error(e); }
    finally { setLoadingAll(false); }
  }
  useEffect(() => { loadPending(); loadAllExpenses(); }, [tenantId]);

  async function openReceipt(exp) {
    try {
      const filename = exp.blobPath.split("/").pop();
      const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(exp.taskId)}&filename=${encodeURIComponent(filename)}&minutes=5`).then(r=>r.json());
      if (j.readUrl) window.open(j.readUrl, "_blank");
    } catch {
      alert("Could not open receipt");
    }
  }

  async function decide(expenseId, action) {
    setDecidingId(expenseId);
    try {
      const body = { tenantId, expenseId, note: (notes[expenseId]||"").trim() || undefined };
      const url  = action === "approve" ? "/api/expenses/approve" : "/api/expenses/reject";
      const r = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || `Could not ${action}`);
      setNotes(prev => ({ ...prev, [expenseId]: "" }));
      await loadPending();
      await loadAllExpenses();
    } catch (e) {
      alert(e.message || `Could not ${action}`);
    } finally {
      setDecidingId(null);
    }
  }

  async function createTask(ev){
    ev.preventDefault();
    const payload = {
      tenantId,
      title: newTask.title,
      type: newTask.type,
      assignee: newTask.assignee,
      slaStart: combineISO(newTask.slaStartDate, newTask.slaStartTime) || undefined,
      slaEnd:   combineISO(newTask.slaEndDate,   newTask.slaEndTime)   || undefined,
      expenseLimits: {
        Hotel: Number(newTask.expenseLimits.Hotel||0),
        Food:  Number(newTask.expenseLimits.Food||0),
        Travel:Number(newTask.expenseLimits.Travel||0),
        Other: Number(newTask.expenseLimits.Other||0)
      },
      items: (newTask.items||[])
        .filter(x => (x.productId||"").trim().length>0)
        .map(x => ({ productId: x.productId, quantity: Number(x.quantity||1) }))
    };
    const r = await fetch(`/api/tasks`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Create task failed");
    const t = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
    setTasks(Array.isArray(t)? t : []);
    setNewTask({
      title: "", type: "data_collection", assignee: "",
      slaStartDate: "", slaStartTime: "", slaEndDate: "", slaEndTime: "",
      expenseLimits: { Hotel:1000, Food:1000, Travel:1000, Other:1000 },
      items: []
    });
    alert("Task created");
  }

  // ---- Tasks list + Edit flow ----
  const [taskSearch, setTaskSearch] = useState("");
  const filteredTasks = useMemo(() => {
    const q = (taskSearch || "").toLowerCase();
    return (tasks || []).filter(t => {
      if (!q) return true;
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.assignee || "").toLowerCase().includes(q) ||
        (t.type || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, taskSearch]);

  function openEdit(t) {
    setEditId(t.id);
    setEditForm({
      title: t.title || "",
      type: t.type || "data_collection",
      assignee: t.assignee || "",
      slaStartDate: toDateInput(t.slaStart),
      slaStartTime: toTimeInput(t.slaStart),
      slaEndDate:   toDateInput(t.slaEnd),
      slaEndTime:   toTimeInput(t.slaEnd),
      expenseLimits: {
        Hotel:  t.expenseLimits?.Hotel  ?? 1000,
        Food:   t.expenseLimits?.Food   ?? 1000,
        Travel: t.expenseLimits?.Travel ?? 1000,
        Other:  t.expenseLimits?.Other  ?? 1000
      },
      items: Array.isArray(t.items) ? t.items.map(x => ({ productId: x.productId || x.product || "", quantity: Number(x.quantity || 1) })) : []
    });
    setEditOpen(true);
  }
  function closeEdit() {
    setEditOpen(false); setEditId(null);
  }
  function updateEditItem(idx, patch) {
    setEditForm(prev => {
      const arr = prev.items.slice();
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, items: arr };
    });
  }
  function addEditItem() {
    setEditForm(prev => ({ ...prev, items: [...(prev.items||[]), {productId:"", quantity:1}] }));
  }
  function removeEditItem(idx) {
    setEditForm(prev => ({ ...prev, items: (prev.items||[]).filter((_,i)=>i!==idx) }));
  }

  async function saveEdit() {
    if (!editId) return;
    setSavingEdit(true);
    try {
      const payload = {
        tenantId,
        taskId: editId,
        title: editForm.title,
        type: editForm.type,
        assignee: editForm.assignee,
        slaStart: combineISO(editForm.slaStartDate, editForm.slaStartTime) || null,
        slaEnd:   combineISO(editForm.slaEndDate,   editForm.slaEndTime)   || null,
        expenseLimits: {
          Hotel: Number(editForm.expenseLimits.Hotel || 0),
          Food:  Number(editForm.expenseLimits.Food || 0),
          Travel:Number(editForm.expenseLimits.Travel || 0),
          Other: Number(editForm.expenseLimits.Other || 0)
        },
        items: (editForm.items || [])
          .filter(x => (x.productId || "").trim().length > 0)
          .map(x => ({ productId: x.productId, quantity: Number(x.quantity || 1) }))
      };
      const r = await fetch(`/api/tasks`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) {
        alert(j?.error || "Update failed (is PUT /api/tasks implemented?)");
        return;
      }
      const t = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
      setTasks(Array.isArray(t)? t : []);
      closeEdit();
      alert("Task updated");
    } catch (e) {
      alert(e.message || "Update failed");
    } finally {
      setSavingEdit(false);
    }
  }

  // Filters for All expenses
  const filtered = useMemo(() => {
    let list = expenses.slice();
    if (statusFilter !== "ALL") {
      list = list.filter(e => (e.approval?.status || "") === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => {
        const t = tasksById[e.taskId] || {};
        return (
          (t.title || "").toLowerCase().includes(q) ||
          (t.assignee || "").toLowerCase().includes(q) ||
          (e.merchant || "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [expenses, statusFilter, search, tasksById]);

  // Create a product
  async function saveProduct(ev) {
    ev.preventDefault();
    if (!newProduct.name.trim()) {
      alert("Enter a product name");
      return;
    }
    setSavingProduct(true);
    try {
      const body = { tenantId, name: newProduct.name.trim(), sku: newProduct.sku.trim() || undefined };
      const r = await fetch(`/api/products`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not create product");
      setNewProduct({ name:"", sku:"" });
      await loadProducts(); // refresh dropdowns
      alert("Product created");
    } catch (e) {
      alert(e.message || "Could not create product");
    } finally {
      setSavingProduct(false);
    }
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Admin</h1>
      <div style={{marginBottom:12, color:"#444"}}>Signed in as: <strong>{me?.userDetails || "—"}</strong></div>

      {/* Quick create product (restored) */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Products</h2>
        <form onSubmit={saveProduct} style={{display:"grid", gridTemplateColumns:"2fr 1fr auto", gap:8, alignItems:"end", maxWidth:700}}>
          <label>Name
            <input value={newProduct.name} onChange={e=>setNewProduct({...newProduct, name:e.target.value})}/>
          </label>
          <label>SKU (optional)
            <input value={newProduct.sku} onChange={e=>setNewProduct({...newProduct, sku:e.target.value})}/>
          </label>
          <button type="submit" disabled={savingProduct}>{savingProduct ? "Saving…" : "Add product"}</button>
        </form>
        <div style={{marginTop:12}}>
          {products.length === 0 ? <p style={{color:"#666"}}>No products yet.</p> : (
            <ul>
              {products.map(p => (
                <li key={p.id || p.productId}>{p.name || p.title || (p.id || p.productId)}{p.sku ? ` — ${p.sku}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Quick create task (restored products picker) */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Create task</h2>
        <form onSubmit={createTask} style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8}}>
          <label>Title
            <input value={newTask.title} onChange={e=>setNewTask({...newTask, title:e.target.value})}/>
          </label>
          <label>Assignee (email)
            <input value={newTask.assignee} onChange={e=>setNewTask({...newTask, assignee:e.target.value})}/>
          </label>
          <label>Type
            <select value={newTask.type} onChange={e=>setNewTask({...newTask, type:e.target.value})}>
              <option value="data_collection">Data collection</option>
              <option value="product_execution">Product execution</option>
              <option value="revisit">Revisit (issue)</option>
            </select>
          </label>

          {/* SLA start */}
          <label>SLA start (date)
            <input type="date" value={newTask.slaStartDate} onChange={e=>setNewTask({...newTask, slaStartDate:e.target.value})}/>
          </label>
          <label>SLA start (time)
            <input type="time" value={newTask.slaStartTime} onChange={e=>setNewTask({...newTask, slaStartTime:e.target.value})}/>
          </label>

          {/* SLA end */}
          <label>SLA end (date)
            <input type="date" value={newTask.slaEndDate} onChange={e=>setNewTask({...newTask, slaEndDate:e.target.value})}/>
          </label>
          <label>SLA end (time)
            <input type="time" value={newTask.slaEndTime} onChange={e=>setNewTask({...newTask, slaEndTime:e.target.value})}/>
          </label>
          <div/>

          <div style={{gridColumn:"1 / -1", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8}}>
            {["Hotel","Food","Travel","Other"].map(k=>(
              <label key={k}>{k} limit (₹)
                <input type="number" step="0.01"
                  value={newTask.expenseLimits[k]}
                  onChange={e=>setNewTask({...newTask, expenseLimits:{...newTask.expenseLimits, [k]: Number(e.target.value||0)}})}/>
              </label>
            ))}
          </div>

          {/* Products rows */}
          <div style={{gridColumn:"1 / -1", marginTop:6}}>
            <strong>Products for this task</strong>
            <div style={{marginTop:6}}>
              {(newTask.items||[]).map((row, idx) => (
                <div key={idx} style={{display:"grid", gridTemplateColumns:"3fr 1fr auto", gap:8, alignItems:"end", marginBottom:8, maxWidth:700}}>
                  <label>Product
                    <select value={row.productId} onChange={e=>createUpdateItem(idx, {productId: e.target.value})}>
                      <option value="">— Select —</option>
                      {products.map(p => (
                        <option key={p.id || p.productId} value={p.id || p.productId}>
                          {p.name || p.title || (p.id || p.productId)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Qty
                    <input type="number" min="1" step="1" value={row.quantity}
                           onChange={e=>createUpdateItem(idx, {quantity: Number(e.target.value || 1)})}/>
                  </label>
                  <button type="button" onClick={()=>createRemoveItem(idx)}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={createAddItem}>Add product</button>
            </div>
          </div>

          <div style={{gridColumn:"1 / -1", marginTop:8}}>
            <button type="submit">Create</button>
          </div>
        </form>
      </section>

      {/* Tasks list with Edit */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Tasks</h2>
        <div style={{marginBottom:8}}>
          <input placeholder="Search title, assignee, type" value={taskSearch} onChange={e=>setTaskSearch(e.target.value)} style={{width:"100%", maxWidth:420}}/>
        </div>
        {filteredTasks.length === 0 ? <p>No tasks.</p> : (
          <div style={{overflowX:"auto"}}>
            <table style={{borderCollapse:"collapse", width:"100%"}}>
              <thead>
                <tr style={{textAlign:"left", borderBottom:"1px solid #eee"}}>
                  <th style={{padding:"8px"}}>Title</th>
                  <th style={{padding:"8px"}}>Assignee</th>
                  <th style={{padding:"8px"}}>Type</th>
                  <th style={{padding:"8px"}}>SLA</th>
                  <th style={{padding:"8px"}}>#Products</th>
                  <th style={{padding:"8px"}}></th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map(t => (
                  <tr key={t.id} style={{borderBottom:"1px solid #f4f4f4"}}>
                    <td style={{padding:"8px"}}>{t.title || t.id}</td>
                    <td style={{padding:"8px"}}>{t.assignee || "—"}</td>
                    <td style={{padding:"8px"}}>{t.type || "—"}</td>
                    <td style={{padding:"8px"}}>
                      {(t.slaStart ? new Date(t.slaStart).toLocaleString() : "—")} → {(t.slaEnd ? new Date(t.slaEnd).toLocaleString() : "—")}
                    </td>
                    <td style={{padding:"8px"}}>{Array.isArray(t.items) ? t.items.length : 0}</td>
                    <td style={{padding:"8px"}}>
                      <button onClick={()=>openEdit(t)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending review queue */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12}}>
        <h2 style={{marginTop:0}}>Expenses pending review</h2>
        {loadingPending ? <p>Loading…</p> :
          (pending.length === 0 ? <p>No expenses awaiting review.</p> :
            <ul style={{listStyle:"none", padding:0, margin:0}}>
              {pending.map(e => {
                const t = tasksById[e.taskId] || {};
                const amount = Number(e.editedTotal ?? e.total ?? 0) || 0;
                const cat = e.category || "Other";
                const remBefore = e.approval?.remainingBefore;
                const limit = e.approval?.limit;
                const ocrDiff = (e.editedTotal != null) && (Number(e.editedTotal) !== Number(e.total));
                return (
                  <li key={e.id} style={{padding:"12px 0", borderBottom:"1px solid #f1f1f1"}}>
                    <div style={{display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
                      <div>
                        <div style={{display:"flex", gap:8, alignItems:"center"}}>
                          <strong>{t.title || e.taskId}</strong>
                          <StatusTag s={e.approval?.status}/>
                        </div>
                        <div style={{fontSize:12, color:"#666"}}>
                          Assignee: {t.assignee || "—"} • Category: {cat} • Amount: {ru(amount)}
                          {ocrDiff && <span style={{marginLeft:8, color:"#b25"}}>edited (OCR was {ru(e.total)})</span>}
                        </div>
                        <div style={{fontSize:12, color:"#666"}}>
                          Limit: {ru(limit)} • Remaining before: {ru(remBefore)}
                        </div>
                      </div>
                      <div style={{minWidth:220}}>
                        <button onClick={() => openReceipt(e)}>Open receipt</button>
                      </div>
                    </div>

                    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8, maxWidth:700}}>
                      <label>Decision note (optional)
                        <input
                          value={notes[e.id] || ""}
                          onChange={ev=>setNotes({...notes, [e.id]: ev.target.value})}
                          placeholder="Explain approval/rejection (shared with employee)"
                        />
                      </label>
                      <div style={{display:"flex", alignItems:"end", gap:8}}>
                        <button
                          onClick={() => decide(e.id, "approve")}
                          disabled={decidingId === e.id}
                        >{decidingId === e.id ? "Working…" : "Approve"}</button>
                        <button
                          onClick={() => {
                            if (!(notes[e.id] || "").trim()) {
                              alert("Please write a rejection reason.");
                              return;
                            }
                            decide(e.id, "reject");
                          }}
                          disabled={decidingId === e.id}
                        >{decidingId === e.id ? "Working…" : "Reject"}</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
        )}
      </section>

      {/* All expenses */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginTop:18}}>
        <h2 style={{marginTop:0}}>All expenses</h2>

        <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:10}}>
          <label>Status&nbsp;
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="PENDING_REVIEW">Pending</option>
              <option value="AUTO_APPROVED">Auto-approved</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <input
            placeholder="Search: task title, assignee, merchant"
            value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{flex:"1 1 300px"}}
          />
        </div>

        {loadingAll ? <p>Loading…</p> :
          ((() => {
            const list = filtered;
            if (list.length === 0) return <p>No expenses match the filter.</p>;
            return (
              <ul style={{listStyle:"none", padding:0, margin:0}}>
                {list.map(e => {
                  const t = tasksById[e.taskId] || {};
                  const amount = Number(e.editedTotal ?? e.total ?? 0) || 0;
                  const ocrDiff = (e.editedTotal != null) && (Number(e.editedTotal) !== Number(e.total));
                  const cat = e.category || "Other";
                  return (
                    <li key={e.id} style={{padding:"10px 0", borderBottom:"1px solid #f3f3f3"}}>
                      <div style={{display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
                        <div>
                          <div style={{display:"flex", gap:8, alignItems:"center"}}>
                            <strong>{t.title || e.taskId}</strong>
                            <StatusTag s={e.approval?.status}/>
                          </div>
                          <div style={{fontSize:12, color:"#666"}}>
                            {new Date(e.createdAt).toLocaleString()} • Assignee: {t.assignee || "—"} • Category: {cat} • Amount: {ru(amount)}
                            {ocrDiff && <span style={{marginLeft:8, color:"#b25"}}>edited (OCR was {ru(e.total)})</span>}
                          </div>
                          {e.approval?.note && e.approval?.status === "REJECTED" && (
                            <div style={{marginTop:6, fontSize:12, color:"#b22"}}>
                              Admin rejection note: {e.approval.note}
                            </div>
                          )}
                        </div>
                        <div style={{minWidth:220}}>
                          <button onClick={() => openReceipt(e)}>Open receipt</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          })())
        }
      </section>

      {/* Edit Modal (includes products) */}
      {editOpen && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:"20px", zIndex:1000
        }}
          onClick={closeEdit}
        >
          <div style={{background:"#fff", borderRadius:10, padding:16, width:"min(900px, 96vw)", maxHeight:"90vh", overflow:"auto"}}
               onClick={e=>e.stopPropagation()}>
            <h2 style={{marginTop:0}}>Edit task</h2>
            <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8}}>
              <label>Title
                <input value={editForm.title} onChange={e=>setEditForm({...editForm, title:e.target.value})}/>
              </label>
              <label>Assignee (email)
                <input value={editForm.assignee} onChange={e=>setEditForm({...editForm, assignee:e.target.value})}/>
              </label>
              <label>Type
                <select value={editForm.type} onChange={e=>setEditForm({...editForm, type:e.target.value})}>
                  <option value="data_collection">Data collection</option>
                  <option value="product_execution">Product execution</option>
                  <option value="revisit">Revisit (issue)</option>
                </select>
              </label>

              <label>SLA start (date)
                <input type="date" value={editForm.slaStartDate} onChange={e=>setEditForm({...editForm, slaStartDate:e.target.value})}/>
              </label>
              <label>SLA start (time)
                <input type="time" value={editForm.slaStartTime} onChange={e=>setEditForm({...editForm, slaStartTime:e.target.value})}/>
              </label>
              <label>SLA end (date)
                <input type="date" value={editForm.slaEndDate} onChange={e=>setEditForm({...editForm, slaEndDate:e.target.value})}/>
              </label>
              <label>SLA end (time)
                <input type="time" value={editForm.slaEndTime} onChange={e=>setEditForm({...editForm, slaEndTime:e.target.value})}/>
              </label>
              <div/>
            </div>

            {/* Budgets */}
            <div style={{marginTop:10}}>
              <strong>Budgets</strong>
              <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:6}}>
                {["Hotel","Food","Travel","Other"].map(k=>(
                  <label key={k}>{k} limit (₹)
                    <input type="number" step="0.01"
                      value={editForm.expenseLimits[k]}
                      onChange={e=>setEditForm({
                        ...editForm,
                        expenseLimits:{...editForm.expenseLimits, [k]: Number(e.target.value||0)}
                      })}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Products */}
            <div style={{marginTop:14}}>
              <strong>Products</strong>
              <div style={{marginTop:6}}>
                {(editForm.items || []).map((row, idx) => (
                  <div key={idx} style={{display:"grid", gridTemplateColumns:"3fr 1fr auto", gap:8, alignItems:"end", marginBottom:8}}>
                    <label>Product
                      <select value={row.productId} onChange={e=>updateEditItem(idx, {productId: e.target.value})}>
                        <option value="">— Select —</option>
                        {products.map(p => (
                          <option key={p.id || p.productId} value={p.id || p.productId}>
                            {p.name || p.title || (p.id || p.productId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>Qty
                      <input type="number" min="1" step="1" value={row.quantity}
                             onChange={e=>updateEditItem(idx, {quantity: Number(e.target.value || 1)})}/>
                    </label>
                    <button onClick={()=>removeEditItem(idx)}>Remove</button>
                  </div>
                ))}
                <button onClick={addEditItem}>Add product</button>
              </div>
            </div>

            <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:16}}>
              <button onClick={closeEdit}>Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick report */}
      <section style={{marginTop:16}}>
        <a href={`/api/report/csv?tenantId=${tenantId}`} target="_blank" rel="noreferrer">Download CSV report</a>
      </section>
    </main>
  );
}

function StatusTag({s}) {
  const map = {
    PENDING_REVIEW: {bg:"#fff4e5", color:"#8a5b00", label:"Pending"},
    AUTO_APPROVED:  {bg:"#e8fff2", color:"#0b6d3d", label:"Auto-approved"},
    APPROVED:       {bg:"#e8f4ff", color:"#0b4d8a", label:"Approved"},
    REJECTED:       {bg:"#ffe8e8", color:"#8a0b0b", label:"Rejected"}
  };
  const m = map[s] || {bg:"#eee", color:"#444", label:String(s||"—")};
  return <span style={{fontSize:12, padding:"2px 6px", borderRadius:6, background:m.bg, color:m.color}}>{m.label}</span>;
}
