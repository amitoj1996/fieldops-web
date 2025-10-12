import { useEffect, useMemo, useState, useRef } from "react";

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

  // --- Reports (shared date filters for dashboard/charts/EoM) ---
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  function downloadReport() {
    let url = `/api/report/csv?tenantId=${tenantId}`;
    if (reportFrom) url += `&fromDate=${reportFrom}`;
    if (reportTo)   url += `&toDate=${reportTo}`;
    window.open(url, "_blank", "noopener");
  }
  const dFrom = useMemo(()=> reportFrom ? new Date(`${reportFrom}T00:00:00Z`) : null, [reportFrom]);
  const dTo   = useMemo(()=> reportTo   ? new Date(`${reportTo}T23:59:59.999Z`) : null, [reportTo]);
  const inRange = (iso) => {
    if (!iso) return !dFrom && !dTo;
    const dt = new Date(iso);
    if (dFrom && dt < dFrom) return false;
    if (dTo && dt > dTo) return false;
    return true;
  };

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

  // Create task (SLA split + products)
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

  // Delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cascadeDelete, setCascadeDelete] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Product create (admin section)
  const [newProduct, setNewProduct] = useState({ name:"", sku:"" });
  const [savingProduct, setSavingProduct] = useState(false);

  // Load tasks + expenses
  async function loadTasks() {
    try {
      const t = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
      setTasks(Array.isArray(t)? t : []);
    } catch(e){ console.error(e); }
  }
  useEffect(() => { loadTasks(); }, [tenantId]);

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
    await loadTasks();
    setNewTask({
      title: "", type: "data_collection", assignee: "",
      slaStartDate: "", slaStartTime: "", slaEndDate: "", slaEndTime: "",
      expenseLimits: { Hotel:1000, Food:1000, Travel:1000, Other:1000 },
      items: []
    });
    alert("Task created");
  }

  // ---- Dashboard calculations (createdAt-based, same as CSV) ----
  const tasksInRange = useMemo(() => (tasks||[]).filter(t => inRange(t.createdAt)), [tasks, dFrom, dTo]);
  const expensesInRange = useMemo(() => {
    const allowed = new Set(tasksInRange.map(t => t.id));
    return (expenses||[]).filter(e => allowed.has(e.taskId) && inRange(e.createdAt));
  }, [expenses, tasksInRange, dFrom, dTo]);

  const kpis = useMemo(() => {
    // Open vs Completed
    const open = tasksInRange.filter(t => (t.status || "ASSIGNED") !== "COMPLETED").length;
    const completedList = tasksInRange.filter(t => (t.status || "") === "COMPLETED");
    const completed = completedList.length;
    // SLA breach rate among completed
    const breached = completedList.filter(t => !!t.slaBreached).length;
    const breachRate = completed ? (breached / completed) * 100 : 0;

    // Budget sums by category (from tasks)
    const catKeys = ["Hotel","Food","Travel","Other"];
    const budget = { Hotel:0, Food:0, Travel:0, Other:0 };
    for (const t of tasksInRange) {
      const el = t.expenseLimits || {};
      for (const k of catKeys) budget[k] += Number(el[k] || 0);
    }

    // Spend by category: include APPROVED, AUTO_APPROVED, PENDING_REVIEW (exclude REJECTED)
    const spend = { Hotel:0, Food:0, Travel:0, Other:0 };
    for (const e of expensesInRange) {
      const st = (e.approval?.status) || "";
      if (st === "REJECTED") continue;
      const amt = Number(e.editedTotal ?? e.total ?? 0) || 0;
      const cat = (e.category || "Other");
      if (spend[cat] == null) spend[cat] = 0;
      spend[cat] += amt;
    }

    // Top spenders (sum non-rejected)
    const perUser = {};
    for (const e of expensesInRange) {
      const st = (e.approval?.status) || "";
      if (st === "REJECTED") continue;
      const t = tasksById[e.taskId] || {};
      const user = (t.assignee || "—").toLowerCase();
      const amt = Number(e.editedTotal ?? e.total ?? 0) || 0;
      perUser[user] = (perUser[user] || 0) + amt;
    }
    const top = Object.entries(perUser)
      .map(([assignee, total]) => ({ assignee, total }))
      .sort((a,b)=> b.total - a.total)
      .slice(0, 5);

    return { open, completed, breachRate, budget, spend, top };
  }, [tasksInRange, expensesInRange, tasksById]);

  // ---- Employee of the Month (EoM) ----
  // Scoring (transparent):
  // +10 per completed task
  // +10 per on-time completion (COMPLETED without slaBreached)
  // +1 per product unit worked (sum of quantities across assigned tasks), capped at +20
  // Budget bonus/penalty capped to ±20 based on spend vs sum of budgets for that employee’s tasks in range
  const eom = useMemo(() => {
    const byAssignee = {};
    // prepare budgets & product units per assignee
    for (const t of tasksInRange) {
      const a = (t.assignee || "—").toLowerCase();
      const limits = t.expenseLimits || {};
      const totalBudget = ["Hotel","Food","Travel","Other"].reduce((s,k)=> s + Number(limits[k]||0), 0);
      const s = byAssignee[a] || (byAssignee[a] = {
        assignee:a, tasks:[], completed:0, onTime:0, breaches:0, budget:0, spend:0, productUnits:0
      });
      s.tasks.push(t.id);
      s.budget += totalBudget;

      // product units = sum of quantities on task items (default 1)
      if (Array.isArray(t.items)) {
        for (const it of t.items) s.productUnits += Number(it?.quantity || 1);
      }

      if ((t.status||"") === "COMPLETED") {
        s.completed += 1;
        if (!t.slaBreached) s.onTime += 1; else s.breaches += 1;
      }
    }
    // spend per assignee (non-rejected)
    for (const e of expensesInRange) {
      const st = (e.approval?.status) || "";
      if (st === "REJECTED") continue;
      const t = tasksById[e.taskId] || {};
      const a = (t.assignee || "—").toLowerCase();
      if (!byAssignee[a]) byAssignee[a] = { assignee:a, tasks:[], completed:0, onTime:0, breaches:0, budget:0, spend:0, productUnits:0 };
      const amt = Number(e.editedTotal ?? e.total ?? 0) || 0;
      byAssignee[a].spend += amt;
    }
    const rows = Object.values(byAssignee).map(s => {
      const base = s.completed * 10;
      const ontime = s.onTime * 10;
      const productBonus = Math.min(20, Math.max(0, s.productUnits * 1)); // +1 per unit, capped at +20
      let budgetBonus = 0;
      if (s.budget > 0) {
        if (s.spend <= s.budget) {
          const underPct = 1 - (s.spend / s.budget); // 0..1
          budgetBonus = Math.min(20, Math.max(0, 20 * underPct));
        } else {
          const overPct = (s.spend - s.budget) / s.budget; // >0
          budgetBonus = -Math.min(20, 20 * overPct);
        }
      } else {
        if (s.spend > 0) budgetBonus = -10;
      }
      const score = Math.round(base + ontime + productBonus + budgetBonus);
      return { ...s, score };
    }).sort((a,b)=> b.score - a.score);
    return { rows, winner: rows[0] || null };
  }, [tasksInRange, expensesInRange, tasksById]);

  // ---- Tasks list + Edit/Delete flow ----
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

  function openDelete(t) {
    setDeleteTarget(t);
    setCascadeDelete(true);
    setDeleteOpen(true);
  }
  function closeDelete() {
    setDeleteOpen(false);
    setDeleteTarget(null);
    setCascadeDelete(true);
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

      const r = await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let j = {};
      try { j = await r.json(); } catch {}
      if (!r.ok) {
        alert(j.error || `Update failed (HTTP ${r.status})`);
        return;
      }
      await loadTasks();
      closeEdit();
      alert("Task updated");
    } catch (e) {
      alert(e.message || "Update failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          tenantId,
          taskId: deleteTarget.id,
          cascade: !!cascadeDelete
        })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) {
        alert(j?.error || `Delete failed (HTTP ${r.status})`);
        return;
      }
      await loadTasks();
      closeDelete();
      alert(`Deleted task ${deleteTarget.title || deleteTarget.id}\nRemoved events: ${j.events||0}, expenses: ${j.expenses||0}`);
    } catch(e) {
      alert(e.message || "Delete failed");
    } finally {
      setDeleting(false);
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

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Admin</h1>
      <div style={{marginBottom:12, color:"#444"}}>Signed in as: <strong>{me?.userDetails || "—"}</strong></div>

      {/* DASHBOARD */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Dashboard</h2>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, maxWidth:600, alignItems:"end", marginBottom:12}}>
          <label>From (date)
            <input type="date" value={reportFrom} onChange={e=>setReportFrom(e.target.value)} />
          </label>
          <label>To (date)
            <input type="date" value={reportTo} onChange={e=>setReportTo(e.target.value)} />
          </label>
        </div>

        {/* KPI cards */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, minmax(160px, 1fr))", gap:12, marginBottom:12}}>
          <KPI title="Open tasks" value={kpis.open} />
          <KPI title="Completed tasks" value={kpis.completed} />
          <KPI title="SLA breach rate" value={`${kpis.breachRate.toFixed(1)}%`} />
        </div>

        {/* CHARTS (interactive) */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, alignItems:"start"}}>
          <div>
            <h3 style={{margin:"8px 0"}}>Spend vs Budget (by category)</h3>
            <InteractiveGroupedBars
              categories={["Hotel","Food","Travel","Other"]}
              series={[
                { name: "Budget", values: ["Hotel","Food","Travel","Other"].map(k=>Number(kpis.budget[k]||0)) },
                { name: "Spend",  values: ["Hotel","Food","Travel","Other"].map(k=>Number(kpis.spend[k]||0)) }
              ]}
              height={240}
            />
          </div>
          <div>
            <h3 style={{margin:"8px 0"}}>Top spenders</h3>
            <InteractiveHBar
              data={(kpis.top||[]).map(r => ({ label: r.assignee || "—", value: Number(r.total||0) }))}
              height={240}
              maxBars={5}
            />
          </div>
        </div>

        {/* EOM */}
        <div style={{marginTop:16}}>
          <h3 style={{margin:"8px 0"}}>Employee of the Month</h3>
          {(!eom.rows || eom.rows.length===0) ? (
            <div style={{color:"#666"}}>No activity in this range.</div>
          ) : (
            <>
              <div style={{padding:"8px 10px", border:"1px dashed #d7e7d7", borderRadius:8, background:"#f7fff7", marginBottom:8}}>
                🏆 <strong>Winner:</strong> {eom.winner.assignee || "—"} &nbsp;—&nbsp;
                <strong>Score:</strong> {eom.winner.score} &nbsp;|&nbsp;
                <strong>Completed:</strong> {eom.winner.completed} &nbsp;|&nbsp;
                <strong>On-time:</strong> {eom.winner.onTime} &nbsp;|&nbsp;
                <strong>Products worked:</strong> {eom.winner.productUnits} &nbsp;|&nbsp;
                <strong>Spend/Budget:</strong> {ru(eom.winner.spend)} / {ru(eom.winner.budget)}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{borderCollapse:"collapse", width:"100%", minWidth:820}}>
                  <thead>
                    <tr style={{textAlign:"left", borderBottom:"1px solid #eee"}}>
                      <th style={{padding:"6px 8px"}}>#</th>
                      <th style={{padding:"6px 8px"}}>Employee</th>
                      <th style={{padding:"6px 8px"}}>Score</th>
                      <th style={{padding:"6px 8px"}}>Completed</th>
                      <th style={{padding:"6px 8px"}}>On-time</th>
                      <th style={{padding:"6px 8px"}}>SLA breaches</th>
                      <th style={{padding:"6px 8px"}}>Products worked</th>
                      <th style={{padding:"6px 8px"}}>Spend</th>
                      <th style={{padding:"6px 8px"}}>Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eom.rows.map((r, i) => (
                      <tr key={r.assignee} style={{borderBottom:"1px solid #f4f4f4", background: i===0 ? "#fffbef" : undefined}}>
                        <td style={{padding:"6px 8px"}}>{i+1}</td>
                        <td style={{padding:"6px 8px"}}><strong>{r.assignee || "—"}</strong></td>
                        <td style={{padding:"6px 8px"}}>{r.score}</td>
                        <td style={{padding:"6px 8px"}}>{r.completed}</td>
                        <td style={{padding:"6px 8px"}}>{r.onTime}</td>
                        <td style={{padding:"6px 8px"}}>{r.breaches}</td>
                        <td style={{padding:"6px 8px"}}>{r.productUnits}</td>
                        <td style={{padding:"6px 8px"}}>{ru(r.spend)}</td>
                        <td style={{padding:"6px 8px"}}>{ru(r.budget)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{fontSize:12, color:"#666", marginTop:6}}>
                Scoring: +10/completed, +10/on-time, +1/product unit (capped +20), budget bonus/penalty up to ±20 based on spend vs budget.
              </div>
            </>
          )}
        </div>
      </section>

      {/* Reports */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Reports</h2>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"end", maxWidth:600}}>
          <label>From (date)
            <input type="date" value={reportFrom} onChange={e=>setReportFrom(e.target.value)} />
          </label>
          <label>To (date)
            <input type="date" value={reportTo} onChange={e=>setReportTo(e.target.value)} />
          </label>
          <button onClick={downloadReport}>Download CSV</button>
        </div>
        <div style={{fontSize:12, color:"#666", marginTop:6}}>
          Leave fields blank for an all-time report. “To” is inclusive here (CSV logic matches).
        </div>
      </section>

      {/* Products admin */}
      <section style={{border:"1px solid #eee", borderRadius:8, padding:12, marginBottom:18}}>
        <h2 style={{marginTop:0}}>Products</h2>
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          const name = (newProduct.name||"").trim();
          const sku  = (newProduct.sku||"").trim();
          if (!name) { alert("Enter a product name"); return; }
          setSavingProduct(true);
          try {
            const body = { tenantId, name, sku: sku || undefined };
            const r = await fetch(`/api/products`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
            const j = await r.json();
            if (!r.ok) return alert(j.error || "Could not create product");
            setNewProduct({ name:"", sku:"" });
            await loadProducts();
            alert("Product created");
          } catch (e) {
            alert(e.message || "Could not create product");
          } finally {
            setSavingProduct(false);
          }
        }} style={{display:"grid", gridTemplateColumns:"2fr 1fr auto", gap:8, alignItems:"end", maxWidth:700}}>
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

      {/* Create task */}
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

          <label>SLA start (date)
            <input type="date" value={newTask.slaStartDate} onChange={e=>setNewTask({...newTask, slaStartDate:e.target.value})}/>
          </label>
          <label>SLA start (time)
            <input type="time" value={newTask.slaStartTime} onChange={e=>setNewTask({...newTask, slaStartTime:e.target.value})}/>
          </label>
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

      {/* Tasks list with Edit + Delete */}
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
                    <td style={{padding:"8px", display:"flex", gap:8}}>
                      <button onClick={()=>openEdit(t)}>Edit</button>
                      <button style={{background:"#fff0f0", border:"1px solid #f2b5b5", color:"#8a0b0b"}} onClick={()=>openDelete(t)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Expenses pending review */}
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

      {/* Edit Modal */}
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
                      <select value={row.productId} onChange={e=>setEditForm(prev=>{
                        const a=prev.items.slice(); a[idx]={...a[idx], productId: e.target.value}; return {...prev, items:a};
                      })}>
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
                             onChange={e=>setEditForm(prev=>{
                               const a=prev.items.slice(); a[idx]={...a[idx], quantity:Number(e.target.value||1)}; return {...prev, items:a};
                             })}/>
                    </label>
                    <button onClick={()=>setEditForm(prev=>({...prev, items:(prev.items||[]).filter((_,i)=>i!==idx)}))}>Remove</button>
                  </div>
                ))}
                <button onClick={()=>setEditForm(prev=>({...prev, items:[...(prev.items||[]), {productId:"", quantity:1}]}))}>Add product</button>
              </div>
            </div>

            <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:16}}>
              <button onClick={closeEdit}>Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteOpen && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:"20px", zIndex:1100
        }}
          onClick={closeDelete}
        >
          <div style={{background:"#fff", borderRadius:10, padding:16, width:"min(560px, 96vw)"}}
               onClick={e=>e.stopPropagation()}>
            <h2 style={{marginTop:0, color:"#8a0b0b"}}>Delete task</h2>
            <p>Are you sure you want to delete <strong>{deleteTarget?.title || deleteTarget?.id}</strong>?</p>
            <label style={{display:"flex", alignItems:"center", gap:8}}>
              <input type="checkbox" checked={cascadeDelete} onChange={e=>setCascadeDelete(e.target.checked)}/>
              Also delete related <em>expenses</em> and <em>check-in/out events</em> (recommended)
            </label>
            <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:16}}>
              <button onClick={closeDelete}>Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                style={{background:"#fff0f0", border:"1px solid #f2b5b5", color:"#8a0b0b"}}
              >{deleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function KPI({title, value}) {
  return (
    <div style={{border:"1px solid #eee", borderRadius:8, padding:"10px 12px"}}>
      <div style={{fontSize:12, color:"#666"}}>{title}</div>
      <div style={{fontSize:22, fontWeight:700, marginTop:2}}>{value}</div>
    </div>
  );
}

function formatINR(n) {
  const v = Number(n||0);
  if (v >= 1e7) return "₹" + (v/1e7).toFixed(1) + "cr";
  if (v >= 1e5) return "₹" + (v/1e5).toFixed(1) + "L";
  if (v >= 1e3) return "₹" + (v/1e3).toFixed(1) + "k";
  return "₹" + v.toFixed(0);
}

/* ------------------ Interactive Charts ------------------ */
function useTooltip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null); // {x,y,html}
  function onMove(e, html) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTip({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8, html });
  }
  function onLeave() { setTip(null); }
  return { ref, tip, onMove, onLeave };
}

function InteractiveGroupedBars({ categories, series, height=240, width=560, padding=28 }) {
  const [visible, setVisible] = useState(series.map(()=>true));
  const activeSeries = series.map((s,i)=> visible[i] ? s : { ...s, values: s.values.map(()=>0) });
  const max = Math.max(1, ...activeSeries.flatMap(s => s.values));
  const barW = 18;
  const gapInner = 10;
  const groupW = (series.length * barW) + gapInner*(series.length-1);
  const gapOuter = 20;
  const totalW = Math.max(width, padding*2 + categories.length*groupW + (categories.length-1)*gapOuter);
  const h = height;
  const chartH = h - padding*1.6;
  const baselineY = chartH + padding*0.2;
  const { ref, tip, onMove, onLeave } = useTooltip();

  const fills = ["#dbeafe","#c7f9e3","#fde68a","#fbcfe8","#e5e7eb"];
  const strokes = ["#9ac1ee","#85dcb5","#f1bf42","#f28dbf","#c7c9cc"];

  return (
    <div style={{position:"relative"}} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${totalW} ${h}`} role="img" aria-label="Grouped bar chart">
        {/* axes */}
        <line x1={padding} y1={baselineY} x2={totalW-padding} y2={baselineY} stroke="#ddd"/>
        {/* y ticks */}
        {Array.from({length:4}, (_,i)=> (i+1)).map(i=>{
          const y = baselineY - (i*(chartH/4));
          return <g key={i}>
            <line x1={padding} x2={totalW-padding} y1={y} y2={y} stroke="#f5f5f5"/>
            <text x={padding-6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#777">
              {formatINR(max*(i/4))}
            </text>
          </g>;
        })}

        {categories.map((c, idx) => {
          const gx = padding + idx*(groupW + gapOuter);
          return (
            <g key={c} transform={`translate(${gx},0)`}>
              {/* bars */}
              {series.map((s, si) => {
                const v = Number(activeSeries[si].values[idx]||0);
                const hgt = Math.max(0, (v/max) * (chartH-4));
                const x = si*(barW + gapInner);
                const y = baselineY - hgt;
                const fill = fills[si % fills.length];
                const stroke = strokes[si % strokes.length];
                const faded = !visible[si];
                return (
                  <rect
                    key={si}
                    x={x} y={y} width={barW} height={hgt}
                    fill={fill} stroke={stroke}
                    opacity={faded ? 0.25 : 1}
                    onMouseMove={(e)=> onMove(e, `<strong>${s.name}</strong> in <em>${c}</em><br/>${ru(Number(series[si].values[idx]||0))}`)}
                    onMouseLeave={onLeave}
                  />
                );
              })}
              {/* label */}
              <text x={groupW/2} y={baselineY+12} textAnchor="middle" fontSize="11" fill="#555">{c}</text>
            </g>
          );
        })}

        {/* legend (click to toggle) */}
        <g transform={`translate(${padding}, ${padding-12})`}>
          {series.map((s, i)=>(
            <g key={s.name} transform={`translate(${i*130},0)`} style={{cursor:"pointer"}}
               onClick={()=> setVisible(v => v.map((x,idx)=> idx===i ? !x : x))}>
              <rect width="12" height="12" fill={fills[i % fills.length]} stroke={strokes[i % strokes.length]} opacity={visible[i]?1:0.25}/>
              <text x="16" y="10.5" fontSize="11" fill="#555">{s.name} {visible[i] ? "" : "(off)"}</text>
            </g>
          ))}
        </g>
      </svg>
      {tip && (
        <div
          style={{
            position:"absolute", left: tip.x, top: tip.y, background:"#111", color:"#fff",
            fontSize:12, padding:"6px 8px", borderRadius:6, pointerEvents:"none", whiteSpace:"nowrap", boxShadow:"0 4px 12px rgba(0,0,0,0.2)"
          }}
          dangerouslySetInnerHTML={{__html: tip.html}}
        />
      )}
    </div>
  );
}

function InteractiveHBar({ data, height=240, width=560, padding=28, maxBars=5 }) {
  const rows = (data||[]).slice(0, maxBars);
  const max = Math.max(1, ...rows.map(r=>r.value));
  const rowH = Math.max(22, (height - padding*1.6) / Math.max(1, rows.length));
  const totalH = Math.max(height, padding*1.6 + rows.length*rowH);
  const chartW = width - padding*2;
  const { ref, tip, onMove, onLeave } = useTooltip();

  return (
    <div style={{position:"relative"}} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${width} ${totalH}`} role="img" aria-label="Horizontal bar chart">
        {rows.map((r, i) => {
          const y = padding + i*rowH;
          const w = Math.max(2, (r.value/max)*chartW);
          return (
            <g key={r.label}>
              <rect x={padding} y={y+4} width={chartW} height={rowH-8} fill="#f6f6f6" />
              <rect
                x={padding} y={y+4} width={w} height={rowH-8}
                fill="#e3f2fd" stroke="#9ac1ee"
                onMouseMove={(e)=> onMove(e, `<strong>${r.label}</strong><br/>${ru(r.value)}`)}
                onMouseLeave={onLeave}
              />
              <text x={padding+6} y={y + rowH/2 + 1} fontSize="11" dominantBaseline="middle" fill="#333">
                {r.label}
              </text>
              <text x={padding + chartW - 6} y={y + rowH/2 + 1} fontSize="11" dominantBaseline="middle" textAnchor="end" fill="#555">
                {ru(r.value)}
              </text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          style={{
            position:"absolute", left: tip.x, top: tip.y, background:"#111", color:"#fff",
            fontSize:12, padding:"6px 8px", borderRadius:6, pointerEvents:"none", whiteSpace:"nowrap", boxShadow:"0 4px 12px rgba(0,0,0,0.2)"
          }}
          dangerouslySetInnerHTML={{__html: tip.html}}
        />
      )}
    </div>
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
