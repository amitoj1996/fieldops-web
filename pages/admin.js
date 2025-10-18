import AssigneePicker from "../components/AssigneePicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { InteractiveGroupedBars as FixedGroupedBars } from "../components/Charts";

/* ---------- auth + small utils ---------- */
function useAuth() {
  const [me, setMe] = useState(null);
  async function loadAssignees(){
    try {
      const j = await fetch(`/api/assignees?tenantId=${tenantId}`).then(r=>r.json());
      setAssignees(Array.isArray(j) ? j : []);
    } catch(e) { console.error(e); }
  }

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
const ru = (n) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function toDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  const d = dateStr || new Date().toISOString().slice(0, 10);
  return new Date(`${d}T${t}`).toISOString();
}
function fmtYMDUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatINR(n) {
  const v = Number(n || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(1) + "cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1) + "L";
  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(1) + "k";
  return "₹" + v.toFixed(0);
}

/* ------------------ PAGE ------------------ */
export default function Admin() {
  const me = useAuth();
  const [tenantId] = useState("default");

  /* ---------- Global filters shared by all tabs ---------- */
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  function downloadReport() {
    let url = `/api/report/csv?tenantId=${tenantId}`;
    if (reportFrom) url += `&fromDate=${reportFrom}`;
    if (reportTo) url += `&toDate=${reportTo}`;
    window.open(url, "_blank", "noopener");
  }
  const dFrom = useMemo(
    () => (reportFrom ? new Date(`${reportFrom}T00:00:00Z`) : null),
    [reportFrom]
  );
  const dTo = useMemo(() => (reportTo ? new Date(`${reportTo}T23:59:59.999Z`) : null), [reportTo]);
  const inRange = (iso) => {
    if (!iso) return !dFrom && !dTo;
    const dt = new Date(iso);
    if (dFrom && dt < dFrom) return false;
    if (dTo && dt > dTo) return false;
    return true;
  };
  const rangeDays = useMemo(() => {
    if (dFrom && dTo) return Math.max(1, Math.round((dTo - dFrom) / 86400000) + 1);
    return 30; // default estimate
  }, [dFrom, dTo]);

  /* ---------- Data loads ---------- */
  const [tasks, setTasks] = useState([]);
  const [products, setProducts] = useState([]);
  const [pending, setPending] = useState([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);

  const tasksById = useMemo(() => {
    const m = {};
    (tasks || []).forEach((t) => (m[t.id] = t));
    return m;
  }, [tasks]);

  async function loadTasks() {
    try {
      const t = await fetch(`/api/tasks?tenantId=${tenantId}`).then((r) => r.json());
      setTasks(Array.isArray(t) ? t : []);
    } catch (e) {
      console.error(e);
    }
  }
  async function loadProducts() {
    try {
      const j = await fetch(`/api/products?tenantId=${tenantId}`).then((r) => r.json());
      if (Array.isArray(j)) setProducts(j);
    } catch {}
  }
  async function loadPending() {
    setLoadingPending(true);
    try {
      const p = await fetch(`/api/expenses/pending?tenantId=${tenantId}`).then((r) => r.json());
      setPending(Array.isArray(p) ? p : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPending(false);
    }
  }
  async function loadAllExpenses() {
    setLoadingAll(true);
    try {
      const all = await fetch(`/api/expenses?tenantId=${tenantId}`).then((r) => r.json());
      const arr = Array.isArray(all)
        ? all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        : [];
      setExpenses(arr);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAll(false);
    }
  }
  useEffect(() => {
    loadTasks();
    loadProducts();
    loadPending();
    loadAllExpenses();
  }, [tenantId]);

  async function openReceipt(exp) {
    try {
      const filename = exp.blobPath.split("/").pop();
      const j = await fetch(
        `/api/receipts/readSas?taskId=${encodeURIComponent(exp.taskId)}&filename=${encodeURIComponent(
          filename
        )}&minutes=5`
      ).then((r) => r.json());
      if (j.readUrl) window.open(j.readUrl, "_blank");
    } catch {
      alert("Could not open receipt");
    }
  }

  /* ---------- Shared computed lists ---------- */
  const tasksInRange = useMemo(
    () => (tasks || []).filter((t) => inRange(t.createdAt)),
    [tasks, dFrom, dTo]
  );
  const expensesInRange = useMemo(() => {
    const allowed = new Set(tasksInRange.map((t) => t.id));
    return (expenses || []).filter((e) => allowed.has(e.taskId) && inRange(e.createdAt));
  }, [expenses, tasksInRange, dFrom, dTo]);

  /* ---------- KPIs ---------- */
  const kpis = useMemo(() => {
    const open = tasksInRange.filter((t) => (t.status || "ASSIGNED") !== "COMPLETED").length;
    const completedList = tasksInRange.filter((t) => (t.status || "") === "COMPLETED");
    const completed = completedList.length;
    const breached = completedList.filter((t) => !!t.slaBreached).length;
    const breachRate = completed ? (breached / completed) * 100 : 0;

    const catKeys = ["Hotel", "Food", "Travel", "Other"];
    const budget = { Hotel: 0, Food: 0, Travel: 0, Other: 0 };
    for (const t of tasksInRange) {
      const el = t.expenseLimits || {};
      for (const k of catKeys) budget[k] += Number(el[k] || 0);
    }

    const spend = { Hotel: 0, Food: 0, Travel: 0, Other: 0 };
    for (const e of expensesInRange) {
      const st = e.approval?.status || "";
      if (st === "REJECTED") continue;
      const amt = Number(e.editedTotal ?? e.total ?? 0) || 0;
      const cat = e.category || "Other";
      if (spend[cat] == null) spend[cat] = 0;
      spend[cat] += amt;
    }

    const perUser = {};
    for (const e of expensesInRange) {
      const st = e.approval?.status || "";
      if (st === "REJECTED") continue;
      const t = tasksById[e.taskId] || {};
      const user = (t.assignee || "—").toLowerCase();
      const amt = Number(e.editedTotal ?? e.total ?? 0) || 0;
      perUser[user] = (perUser[user] || 0) + amt;
    }
    const ranked = Object.entries(perUser)
      .map(([assignee, total]) => ({ assignee, total }))
      .sort((a, b) => b.total - a.total);

    return { open, completed, breachRate, budget, spend, rankedSpenders: ranked };
  }, [tasksInRange, expensesInRange, tasksById]);

  /* ---------- EOM (with adjustable N, NO caps on products) ---------- */
  const [eomN, setEomN] = useState(3);
  const eom = useMemo(() => {
    const byAssignee = {};
    for (const t of tasksInRange) {
      const a = (t.assignee || "—").toLowerCase();
      const limits = t.expenseLimits || {};
      const totalBudget = ["Hotel", "Food", "Travel", "Other"].reduce(
        (s, k) => s + Number(limits[k] || 0),
        0
      );
      const s = byAssignee[a] || (byAssignee[a] = {
        assignee: a,
        completed: 0,
        onTime: 0,
        breaches: 0,
        budget: 0,
        spend: 0,
        productUnits: 0
      });
      s.budget += totalBudget;
      if (Array.isArray(t.items))
        for (const it of t.items) s.productUnits += Number(it?.qty ?? it?.quantity ?? 1);
      if ((t.status || "") === "COMPLETED") {
        s.completed += 1;
        if (!t.slaBreached) s.onTime += 1;
        else s.breaches += 1;
      }
    }
    for (const e of expensesInRange) {
      const st = e.approval?.status || "";
      if (st === "REJECTED") continue;
      const t = tasksById[e.taskId] || {};
      const a = (t.assignee || "—").toLowerCase();
      if (!byAssignee[a])
        byAssignee[a] = {
          assignee: a,
          completed: 0,
          onTime: 0,
          breaches: 0,
          budget: 0,
          spend: 0,
          productUnits: 0
        };
      byAssignee[a].spend += Number(e.editedTotal ?? e.total ?? 0) || 0;
    }
    const rows = Object.values(byAssignee)
      .map((s) => {
        const base = s.completed * 10;
        const ontime = s.onTime * 10;
        const breachPenalty = -(s.breaches * 5); // NO CAP
        const productBonus = s.productUnits * 1; // NO CAP
        let budgetBonus = 0;
        if (s.budget > 0) {
          if (s.spend <= s.budget) {
            const underPct = 1 - s.spend / s.budget;
            budgetBonus = Math.min(20, Math.max(0, 20 * underPct));
          } else {
            const overPct = (s.spend - s.budget) / s.budget;
            budgetBonus = -Math.min(20, 20 * overPct);
          }
        } else {
          if (s.spend > 0) budgetBonus = -10;
        }
        const score = Math.round(base + ontime + breachPenalty + productBonus + budgetBonus);
        return { ...s, score };
      })
      .sort((a, b) => b.score - a.score);

    const winner = rows[0] || null;
    const n = Math.max(1, Math.min(50, Number(eomN) || 3));
    const topN = rows.slice(0, Math.min(n, rows.length));
    const lowN = rows.slice(-Math.min(n, rows.length)).reverse();
    return { rows, winner, topN, lowN, n };
  }, [tasksInRange, expensesInRange, tasksById, eomN]);

  /* ---------- PERFORMANCE (OPI) with adjustable N ---------- */
  const [opiN, setOpiN] = useState(10);
  function percentile(values, v) {
    const arr = (values || []).slice().sort((a, b) => a - b);
    const n = arr.length;
    if (n <= 1) return 100;
    let countLE = 0;
    for (let i = 0; i < n; i++) if (arr[i] <= v) countLE++;
    return ((countLE - 1) / (n - 1)) * 100; // 0..100
  }
  const performance = useMemo(() => {
    const per = {};
    for (const t of tasksInRange) {
      const a = (t.assignee || "—").toLowerCase();
      const limits = t.expenseLimits || {};
      const totalBudget = ["Hotel", "Food", "Travel", "Other"].reduce(
        (s, k) => s + Number(limits[k] || 0),
        0
      );
      const row =
        per[a] ||
        (per[a] = {
          assignee: a,
          assigned: 0,
          completed: 0,
          onTime: 0,
          breaches: 0,
          budget: 0,
          spend: 0,
          productUnits: 0
        });
      row.assigned += 1;
      row.budget += totalBudget;
      if ((t.status || "") === "COMPLETED") {
        row.completed += 1;
        if (!t.slaBreached) row.onTime += 1;
        else row.breaches += 1;
      }
      if (Array.isArray(t.items))
        for (const it of t.items) row.productUnits += Number(it?.qty ?? it?.quantity ?? 1);
    }
    for (const e of expensesInRange) {
      const t = tasksById[e.taskId] || {};
      const a = (t.assignee || "—").toLowerCase();
      if (!per[a])
        per[a] = {
          assignee: a,
          assigned: 0,
          completed: 0,
          onTime: 0,
          breaches: 0,
          budget: 0,
          spend: 0,
          productUnits: 0
        };
      const st = e.approval?.status || "";
      if (st !== "REJECTED") per[a].spend += Number(e.editedTotal ?? e.total ?? 0) || 0;
    }

    const base = Object.values(per).map((r) => {
      const completionRate = r.assigned ? r.completed / r.assigned : 0;
      const onTimeRate = r.completed ? r.onTime / r.completed : 0;
      const breachRate = r.completed ? r.breaches / r.completed : 0;
      const budgetScore =
        r.budget > 0
          ? Math.max(0, 1 - Math.max(0, r.spend - r.budget) / r.budget)
          : r.spend > 0
          ? 0
          : 1;
      const tasksPer30d = (r.assigned / rangeDays) * 30;
      const unitsPer30d = (r.productUnits / rangeDays) * 30;

      return {
        ...r,
        metrics: {
          completionRate,
          onTimeRate,
          breachRate,
          budgetScore,
          tasksPer30d,
          unitsPer30d
        }
      };
    });
    if (base.length === 0) return { rows: [], top: [], low: [], n: Math.max(1, Number(opiN) || 10) };

    const onTimeArr = base.map((r) => r.metrics.onTimeRate);
    const okBreachArr = base.map((r) => 1 - r.metrics.breachRate);
    const budgetArr = base.map((r) => r.metrics.budgetScore);
    const tasksArr = base.map((r) => r.metrics.tasksPer30d);
    const unitsArr = base.map((r) => r.metrics.unitsPer30d);

    const rows = base
      .map((r) => {
        const pOnTime = percentile(onTimeArr, r.metrics.onTimeRate);
        const pBreachOK = percentile(okBreachArr, 1 - r.metrics.breachRate);
        const pBudget = percentile(budgetArr, r.metrics.budgetScore);
        const pTasks = percentile(tasksArr, r.metrics.tasksPer30d);
        const pUnits = percentile(unitsArr, r.metrics.unitsPer30d);
        const pProd = (pTasks + pUnits) / 2;

        const score = Math.round(
          0.35 * pOnTime + 0.25 * pBreachOK + 0.25 * pBudget + 0.15 * pProd
        );

        return { ...r, percentiles: { pOnTime, pBreachOK, pBudget, pProd }, score };
      })
      .sort((a, b) => b.score - a.score);

    const n = Math.max(1, Math.min(50, Number(opiN) || 10));
    const top = rows.slice(0, Math.min(n, rows.length));
    const low = rows.slice(-Math.min(n, rows.length)).reverse();
    return { rows, top, low, n };
  }, [tasksInRange, expensesInRange, tasksById, rangeDays, opiN]);

  /* ---------- UI state: tabs ---------- */
  const tabs = ["overview", "performance", "eom", "products", "tasks", "expenses", "reports"];
  const [tab, setTab] = useState("overview");
  const [topSpendN, setTopSpendN] = useState(5);

  // Auto-set current month when switching to EoM
  useEffect(() => {
    if (tab === "eom") {
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      setReportFrom(fmtYMDUTC(first));
      setReportTo(fmtYMDUTC(last));
    }
  }, [tab]);

  /* ---------- NEW: Quick List Modal state ---------- */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickRows, setQuickRows] = useState([]); // array of tasks

  function openQuickList(kind) {
    if (kind === "open") {
      const rows = tasksInRange.filter((t) => (t.status || "ASSIGNED") !== "COMPLETED");
      setQuickTitle("Open tasks");
      setQuickRows(rows);
      setQuickOpen(true);
    } else if (kind === "completed") {
      const rows = tasksInRange.filter((t) => (t.status || "") === "COMPLETED");
      setQuickTitle("Completed tasks");
      setQuickRows(rows);
      setQuickOpen(true);
    }
  }
  function closeQuick() {
    setQuickOpen(false);
    setQuickTitle("");
    setQuickRows([]);
  }

  /* Create task */
  const [newTask, setNewTask] = useState({
    title: "",
    type: "data_collection",
    assignee: "",
    slaStartDate: "",
    slaStartTime: "",
    slaEndDate: "",
    slaEndTime: "",
    expenseLimits: { Hotel: 1000, Food: 1000, Travel: 1000, Other: 1000 },
    items: []
  });
  function createAddItem() {
    setNewTask((prev) => ({ ...prev, items: [...(prev.items || []), { productId: "", qty: 1 }] }));
  }
  function createUpdateItem(idx, patch) {
    setNewTask((prev) => {
      const arr = (prev.items || []).slice();
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, items: arr };
    });
  }
  function createRemoveItem(idx) {
    setNewTask((prev) => ({ ...prev, items: (prev.items || []).filter((_, i) => i !== idx) }));
  }

  async function createTask(ev) {
    ev.preventDefault();
    const payload = {
      tenantId,
      title: newTask.title,
      type: newTask.type,
      assignee: newTask.assignee,
      slaStart: combineISO(newTask.slaStartDate, newTask.slaStartTime) || undefined,
      slaEnd: combineISO(newTask.slaEndDate, newTask.slaEndTime) || undefined,
      expenseLimits: {
        Hotel: Number(newTask.expenseLimits.Hotel || 0),
        Food: Number(newTask.expenseLimits.Food || 0),
        Travel: Number(newTask.expenseLimits.Travel || 0),
        Other: Number(newTask.expenseLimits.Other || 0)
      },
      items: (newTask.items || [])
        .filter((x) => (x.productId || "").trim().length > 0)
        .map((x) => ({ productId: x.productId, quantity: Number(x.qty ?? x.quantity ?? 1) }))
    };
    const r = await fetch(`/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Create task failed");
    await loadTasks();
    setNewTask({
      title: "",
      type: "data_collection",
      assignee: "",
      slaStartDate: "",
      slaStartTime: "",
      slaEndDate: "",
      slaEndTime: "",
      expenseLimits: { Hotel: 1000, Food: 1000, Travel: 1000, Other: 1000 },
      items: []
    });
    alert("Task created");
  }

  /* Edit/Delete */
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
    expenseLimits: { Hotel: 1000, Food: 1000, Travel: 1000, Other: 1000 },
    items: []
  });
  const [savingEdit, setSavingEdit] = useState(false);

  function openEdit(t) {
    setEditId(t.id);
    setEditForm({
      title: t.title || "",
      type: t.type || "data_collection",
      assignee: t.assignee || "",
      slaStartDate: toDateInput(t.slaStart),
      slaStartTime: toTimeInput(t.slaStart),
      slaEndDate: toDateInput(t.slaEnd),
      slaEndTime: toTimeInput(t.slaEnd),
      expenseLimits: {
        Hotel: t.expenseLimits?.Hotel ?? 1000,
        Food: t.expenseLimits?.Food ?? 1000,
        Travel: t.expenseLimits?.Travel ?? 1000,
        Other: t.expenseLimits?.Other ?? 1000
      },
      items: Array.isArray(t.items)
        ? t.items.map((x) => ({
            productId: x.productId || x.product || "",
            qty: Number(x.qty ?? x.quantity ?? 1)
          }))
        : []
    });
    setEditOpen(true);
  }
  function closeEdit() {
    setEditOpen(false);
    setEditId(null);
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
        slaEnd: combineISO(editForm.slaEndDate, editForm.slaEndTime) || null,
        expenseLimits: {
          Hotel: Number(editForm.expenseLimits.Hotel || 0),
          Food: Number(editForm.expenseLimits.Food || 0),
          Travel: Number(editForm.expenseLimits.Travel || 0),
          Other: Number(editForm.expenseLimits.Other || 0)
        },
        items: (editForm.items || [])
          .filter((x) => (x.productId || "").trim().length > 0)
          .map((x) => ({ productId: x.productId, quantity: Number(x.qty ?? x.quantity ?? 1) }))
      };
      const r = await fetch("/api/tasks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let j = {};
      try {
        j = await r.json();
      } catch {}
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

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cascadeDelete, setCascadeDelete] = useState(true);
  const [deleting, setDeleting] = useState(false);
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
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, taskId: deleteTarget.id, cascade: !!cascadeDelete })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error || `Delete failed (HTTP ${r.status})`);
        return;
      }
      await loadTasks();
      closeDelete();
      alert(
        `Deleted task ${deleteTarget.title || deleteTarget.id}\nRemoved events: ${
          j.events || 0
        }, expenses: ${j.expenses || 0}`
      );
    } catch (e) {
      alert(e.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  /* Pending decisions */
  const [decidingId, setDecidingId] = useState(null);
  const [notes, setNotes] = useState({});
  async function decide(expenseId, action) {
    setDecidingId(expenseId);
    try {
      const body = { tenantId, expenseId, note: (notes[expenseId] || "").trim() || undefined };
      const url = action === "approve" ? "/api/expenses/approve" : "/api/expenses/reject";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) return alert(j.error || `Could not ${action}`);
      setNotes((prev) => ({ ...prev, [expenseId]: "" }));
      await loadPending();
      await loadAllExpenses();
    } catch (e) {
      alert(e.message || `Could not ${action}`);
    } finally {
      setDecidingId(null);
    }
  }

  /* ---------- Expenses filters ---------- */
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    let list = expenses.slice();
    if (statusFilter !== "ALL")
      list = list.filter((e) => (e.approval?.status || "") === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => {
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

  /* ---------- Tasks filtering ---------- */
  const [taskSearch, setTaskSearch] = useState("");
  const filteredTasks = useMemo(() => {
    const q = (taskSearch || "").toLowerCase();
    return (tasks || []).filter((t) => {
      if (!q) return true;
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.assignee || "").toLowerCase().includes(q) ||
        (t.type || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, taskSearch]);

  /* ---------- Render ---------- */
  return (
    <main style={{ padding: "2rem", fontFamily: "-apple-system, system-ui, Segoe UI, Roboto" }}>
      <h1>Admin</h1>
      <div style={{ marginBottom: 12, color: "#444" }}>
        Signed in as: <strong>{me?.userDetails || "—"}</strong>
      </div>

      {/* Global date filters + Tabs */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#fff",
          zIndex: 20,
          border: "1px solid #eee",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 12
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            From (date)
            <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
          </label>
          <label>
            To (date)
            <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
          </label>
          <span style={{ fontSize: 12, color: "#666" }}>
            These filters apply to Overview/Performance/EoM and KPIs/charts.
          </span>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["overview", "Overview"],
            ["performance", "Performance"],
            ["eom", "EoM"],
            ["products", "Products"],
            ["tasks", "Tasks"],
            ["expenses", "Expenses"],
            ["reports", "Reports"]
          ].map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: active ? "#eef6ff" : "#f7f7f7",
                  border: active ? "1px solid #c9e1ff" : "1px solid #e7e7e7",
                  color: "#123"
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* -------- OVERVIEW -------- */}
      {tab === "overview" && (
        <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Overview</h2>

          {/* KPI cards (clickable for open/completed lists) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 12
            }}
          >
            <KPI title="Open tasks" value={kpis.open} onClick={() => openQuickList("open")} />
            <KPI title="Completed tasks" value={kpis.completed} onClick={() => openQuickList("completed")} />
            <KPI title="SLA breach rate" value={`${kpis.breachRate.toFixed(1)}%`} />
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
            <div>
              <h3 style={{ margin: "8px 0" }}>Spend vs Budget (by category)</h3>
              <FixedGroupedBars
                categories={["Hotel", "Food", "Travel", "Other"]}
                series={[
                  { name: "Budget", values: ["Hotel", "Food", "Travel", "Other"].map((k) => Number(kpis.budget[k] || 0)) },
                  { name: "Spend", values: ["Hotel", "Food", "Travel", "Other"].map((k) => Number(kpis.spend[k] || 0)) }
                ]}
                height={300}
              />
            </div>
            <TopSpendersPanel
              ranked={kpis.rankedSpenders}
              topSpendN={topSpendN}
              setTopSpendN={setTopSpendN}
            />
          </div>
        </section>
      )}

      {/* -------- PERFORMANCE -------- */}
      {tab === "performance" && (
        <PerformanceTab performance={performance} opiN={opiN} setOpiN={setOpiN} />
      )}

      {/* -------- EOM -------- */}
      {tab === "eom" && <EoMTab eom={eom} eomN={eom.n} setEomN={setEomN} />}

      {/* -------- PRODUCTS -------- */}
      {tab === "products" && (
        <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Products</h2>
          <ProductAdmin products={products} reload={loadProducts} tenantId={tenantId} />
        </section>
      )}

      {/* -------- TASKS -------- */}
      {tab === "tasks" && (
        <TasksTab
          products={products}
          tasks={tasks}
          filteredTasks={filteredTasks}
          taskSearch={taskSearch}
          setTaskSearch={setTaskSearch}
          newTask={newTask}
          setNewTask={setNewTask}
          createAddItem={createAddItem}
          createUpdateItem={createUpdateItem}
          createRemoveItem={createRemoveItem}
          createTask={createTask}
          openEdit={openEdit}
          // edit modal bits
          editOpen={editOpen}
          editForm={editForm}
          setEditForm={setEditForm}
          closeEdit={closeEdit}
          saveEdit={saveEdit}
          // delete modal bits
          deleteOpen={deleteOpen}
          deleteTarget={deleteTarget}
          cascadeDelete={cascadeDelete}
          deleting={deleting}
          setCascadeDelete={setCascadeDelete}
          openDelete={openDelete}
          closeDelete={closeDelete}
          confirmDelete={confirmDelete}
         assignees={assignees} assignees={assignees} assignees={assignees}/>
      )}

      {/* -------- EXPENSES -------- */}
      {tab === "expenses" && (
        <ExpensesTab
          pending={pending}
          loadingPending={loadingPending}
          filtered={filtered}
          loadingAll={loadingAll}
          tasksById={tasksById}
          notes={notes}
          setNotes={setNotes}
          decidingId={decidingId}
          decide={decide}
          openReceipt={openReceipt}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          search={search}
          setSearch={setSearch}
        reloadExpenses={() => { loadPending(); loadAllExpenses(); }}
        />
      )}

      {/* -------- REPORTS -------- */}
      {tab === "reports" && (
        <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Reports</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", maxWidth: 600 }}>
            <label>
              From (date)
              <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
            </label>
            <label>
              To (date)
              <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
            </label>
            <button onClick={downloadReport}>Download CSV</button>
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            Leave fields blank for an all-time report. “To” is inclusive (CSV logic matches).
          </div>
        </section>
      )}

      {/* Edit Modal */}
      {editOpen && (
        <EditModal
          editForm={editForm}
          setEditForm={setEditForm}
          closeEdit={closeEdit}
          saveEdit={saveEdit}
          products={products}
          savingEdit={savingEdit} assignees={assignees} assignees={assignees} assignees={assignees} assignees={assignees}
        />
      )}

      {/* Delete Modal */}
      {deleteOpen && (
        <DeleteModal
          deleteTarget={deleteTarget}
          cascadeDelete={cascadeDelete}
          setCascadeDelete={setCascadeDelete}
          closeDelete={closeDelete}
          confirmDelete={confirmDelete}
          deleting={deleting}
        />
      )}

      {/* NEW: Quick List Modal */}
      {quickOpen && (
        <QuickListModal
          title={quickTitle}
          rows={quickRows}
          onClose={closeQuick}
          onEdit={openEdit}
          onDelete={openDelete}
        />
      )}
    </main>
  );
}

/* ---------- Small UI helpers ---------- */
function KPI({ title, value, onClick }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid #eee",
        borderRadius: 8,
        padding: "10px 12px",
        cursor: clickable ? "pointer" : "default",
        transition: "transform 120ms ease, background 120ms ease",
        background: clickable ? "#fcfcff" : "#fff"
      }}
      onMouseEnter={(e) => clickable && (e.currentTarget.style.background = "#f6f9ff")}
      onMouseLeave={(e) => clickable && (e.currentTarget.style.background = "#fcfcff")}
    >
      <div style={{ fontSize: 12, color: "#666" }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {clickable && <div style={{ fontSize: 11, color: "#8aa", marginTop: 4 }}>Click to view</div>}
    </div>
  );
}

/* ---------- Top spenders subpanel ---------- */
function TopSpendersPanel({ ranked, topSpendN, setTopSpendN }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h3 style={{ margin: "8px 0" }}>Top spenders</h3>
        <label style={{ fontSize: 12 }}>
          Top N&nbsp;
          <input
            type="number"
            min="1"
            max="50"
            value={topSpendN}
            onChange={(e) => setTopSpendN(Number(e.target.value || 5))}
            style={{ width: 64 }}
          />
        </label>
      </div>
      <InteractiveHBar
        data={(ranked || [])
          .slice(0, Math.max(1, topSpendN))
          .map((r) => ({ label: r.assignee || "—", value: Number(r.total || 0) }))}
        height={240}
        maxBars={Math.max(1, topSpendN)}
      />
    </div>
  );
}

/* ---------- Products Admin component ---------- */
function ProductAdmin({ products, reload, tenantId }) {
  const [savingProduct, setSavingProduct] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [newProduct, setNewProduct] = useState({ name: "", sku: "" });

  async function removeProduct(id, name) {
    if (!id) return;
    const ok = window.confirm(`Delete product "${name || id}"? This does not change existing tasks.`);
    if (!ok) return;
    setDeletingId(id);
    try {
      let r = await fetch(`/api/products/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, productId: id })
      });

      // If server says it's still referenced, allow force delete confirmation.
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}));
        const forceOk = window.confirm((j?.error || "Product used in tasks.") + "\nForce delete anyway?");
        if (!forceOk) return;
        r = await fetch(`/api/products/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, productId: id, force: true })
        });
      }

      const j2 = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j2?.error || `Delete failed (HTTP ${r.status})`);
        return;
      }
      await reload();
    } catch (e) {
      alert(e.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const name = (newProduct.name || "").trim();
          const sku = (newProduct.sku || "").trim();
          if (!name) {
            alert("Enter a product name");
            return;
          }
          setSavingProduct(true);
          try {
            const body = { tenantId, name, sku: sku || undefined };
            const r = await fetch(`/api/products`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) return alert(j.error || "Could not create product");
            setNewProduct({ name: "", sku: "" });
            await reload();
            alert("Product created");
          } catch (e) {
            alert(e.message || "Could not create product");
          } finally {
            setSavingProduct(false);
          }
        }}
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end", maxWidth: 700 }}
      >
        <label>
          Name
          <input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} />
        </label>
        <label>
          SKU (optional)
          <input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} />
        </label>
        <button type="submit" disabled={savingProduct}>
          {savingProduct ? "Saving…" : "Add product"}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        {products.length === 0 ? (
          <p style={{ color: "#666" }}>No products yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, maxWidth: 720 }}>
            {products.map((p) => {
              const id = p.id || p.productId;
              const label = (p.name || p.title || id) + (p.sku ? ` — ${p.sku}` : "");
              const busy = deletingId === id;
              return (
                <li
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid #f1f1f1"
                  }}
                >
                  <span>{label}</span>
                  <button
                    onClick={() => removeProduct(id, p.name || p.title)}
                    disabled={busy}
                    style={{ background: "#fff0f0", border: "1px solid #f2b5b5", color: "#8a0b0b" }}
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
/* ---------- Tasks Tab ---------- */
function TasksTab(props) {
  const assignees = (props function TasksTab(props) {function TasksTab(props) { props.assignees) || [];
  const assignees = (props && props.assignees) || [];
  const {
ref, tip, onMove, onLeave } = useTooltip();

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${totalH}`}
        role="img"
        aria-label="Horizontal bar chart"
        style={{ overflow: "visible" }}
      >
        {rows.map((r, i) => {
          const y = topPad + i * rowH;
          const w = Math.max(2, (r.value / max) * chartW);
          return (
            <g key={r.label}>
              <rect x={leftPad} y={y + 4} width={chartW} height={rowH - 8} fill="#f6f6f6" />
              <rect
                x={leftPad}
                y={y + 4}
                width={w}
                height={rowH - 8}
                fill="#e3f2fd"
                stroke="#9ac1ee"
                onMouseMove={(e) => onMove(e, `<strong>${r.label}</strong><br/>${ru(r.value)}`)}
                onMouseLeave={onLeave}
              />
              <text
                x={leftPad - 6}
                y={y + rowH / 2 + 1}
                fontSize="11"
                dominantBaseline="middle"
                textAnchor="end"
                fill="#333"
              >
                {r.label}
              </text>
              <text
                x={leftPad + chartW + 6}
                y={y + rowH / 2 + 1}
                fontSize="11"
                dominantBaseline="middle"
                textAnchor="start"
                fill="#555"
              >
                {ru(r.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {tip && (
        <div
          style={{
            position: "absolute",
            left: tip.x,
            top: tip.y,
            background: "#111",
            color: "#fff",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 6,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}

function StatusTag({ s }) {
  const map = {
    PENDING_REVIEW: { bg: "#fff4e5", color: "#8a5b00", label: "Pending" },
    AUTO_APPROVED: { bg: "#e8fff2", color: "#0b6d3d", label: "Auto-approved" },
    APPROVED: { bg: "#e8f4ff", color: "#0b4d8a", label: "Approved" },
    REJECTED: { bg: "#ffe8e8", color: "#8a0b0b", label: "Rejected" }
  };
  const m = map[s] || { bg: "#eee", color: "#444", label: String(s || "—") };
  return (
    <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 6, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

/* ---------- Modals ---------- */
function EditModal({ editForm, setEditForm, closeEdit, saveEdit, products, savingEdit, assignees }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 1000
      }}
      onClick={closeEdit}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 16,
          width: "min(900px, 96vw)",
          maxHeight: "90vh",
          overflow: "auto"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Edit task</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          <label>
            Title
            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </label>
          <label>
            Assignee
            <input list="assigneesListEdit"
                   placeholder="name or email"
                   value={editForm.assignee}
                   onChange={(e) => setEditForm({ ...editForm, assignee: e.target.value })} />
            <datalist id="assigneesListEdit">
              {(assignees||[]).map(a => (
                <option key={a.email} value={a.email}>
                  {a.name ? ` ()` : a.email}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            Type
            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
              <option value="data_collection">Data collection</option>
              <option value="product_execution">Product execution</option>
              <option value="revisit">Revisit (issue)</option>
            </select>
          </label>

          <label>
            SLA start (date)
            <input
              type="date"
              value={editForm.slaStartDate}
              onChange={(e) => setEditForm({ ...editForm, slaStartDate: e.target.value })}
            />
          </label>
          <label>
            SLA start (time)
            <input
              type="time"
              value={editForm.slaStartTime}
              onChange={(e) => setEditForm({ ...editForm, slaStartTime: e.target.value })}
            />
          </label>
          <label>
            SLA end (date)
            <input
              type="date"
              value={editForm.slaEndDate}
              onChange={(e) => setEditForm({ ...editForm, slaEndDate: e.target.value })}
            />
          </label>
          <label>
            SLA end (time)
            <input
              type="time"
              value={editForm.slaEndTime}
              onChange={(e) => setEditForm({ ...editForm, slaEndTime: e.target.value })}
            />
          </label>
          <div />
        </div>

        <div style={{ marginTop: 10 }}>
          <strong>Budgets</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 6 }}>
            {["Hotel", "Food", "Travel", "Other"].map((k) => (
              <label key={k}>
                {k} limit (₹)
                <input
                  type="number"
                  step="0.01"
                  value={editForm.expenseLimits[k]}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      expenseLimits: { ...editForm.expenseLimits, [k]: Number(e.target.value || 0) }
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <strong>Products</strong>
          <div style={{ marginTop: 6 }}>
            {(editForm.items || []).map((row, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "3fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}
              >
                <label>
                  Product
                  <select
                    value={row.productId}
                    onChange={(e) =>
                      setEditForm((prev) => {
                        const a = prev.items.slice();
                        a[idx] = { ...a[idx], productId: e.target.value };
                        return { ...prev, items: a };
                      })
                    }
                  >
                    <option value="">— Select —</option>
                    {products.map((p) => (
                      <option key={p.id || p.productId} value={p.id || p.productId}>
                        {p.name || p.title || p.id || p.productId}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Qty
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={row.qty}
                    onChange={(e) =>
                      setEditForm((prev) => {
                        const a = prev.items.slice();
                        a[idx] = { ...a[idx], qty: Number(e.target.value || 1) };
                        return { ...prev, items: a };
                      })
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    setEditForm((prev) => ({ ...prev, items: (prev.items || []).filter((_, i) => i !== idx) }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button onClick={() => setEditForm((prev) => ({ ...prev, items: [...(prev.items || []), { productId: "", qty: 1 }] }))}>
              Add product
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={closeEdit}>Cancel</button>
          <button onClick={saveEdit} disabled={savingEdit}>
            {savingEdit ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, id }) {
  function toggle(){ onChange(!checked); }
  function onKey(e){
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
  }
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={toggle}
      onKeyDown={onKey}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        border: "1px solid #d0d7de",
        background: checked ? "#d1fae5" : "#f3f4f6",
        display: "inline-flex",
        alignItems: "center",
        padding: 2,
        cursor: "pointer",
        position: "relative"
      }}
    >
      <span
        style={{
          width: 19,
          height: 19,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.2)",
          transform: `translateX(${checked ? 20 : 0}px)`,
          transition: "transform 160ms ease"
        }}
      />
    </button>
  );
}

function DeleteModal({ deleteTarget, cascadeDelete, setCascadeDelete, closeDelete, confirmDelete, deleting }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 1100
      }}
      onClick={closeDelete}
    >
      <div
        style={{ background: "#fff", borderRadius: 10, padding: 16, width: "min(560px, 96vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, color: "#8a0b0b" }}>Delete task</h2>
        <p>
          Are you sure you want to delete <strong>{deleteTarget?.title || deleteTarget?.id}</strong>?
        </p>

        <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ToggleSwitch
            checked={!!cascadeDelete}
            onChange={(v) => setCascadeDelete(v)}
            id="cascade-toggle"
          />
          <span>
            Also delete related <em>expenses</em> and <em>check-in/out events</em> (recommended)
          </span>
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={closeDelete}>Cancel</button>
          <button
            onClick={confirmDelete}
            disabled={deleting}
            style={{ background: "#fff0f0", border: "1px solid #f2b5b5", color: "#8a0b0b" }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
/* ---------- NEW: Quick List Modal ---------- */
function QuickListModal({ title, rows, onClose, onEdit, onDelete }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 1200
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 16,
          width: "min(900px, 96vw)",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {(!rows || rows.length === 0) ? (
          <p style={{ color: "#666", marginTop: 12 }}>No tasks in this list.</p>
        ) : (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "8px" }}>Title</th>
                  <th style={{ padding: "8px" }}>Assignee</th>
                  <th style={{ padding: "8px" }}>Type</th>
                  <th style={{ padding: "8px" }}>SLA</th>
                  <th style={{ padding: "8px" }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f4f4f4" }}>
                    <td style={{ padding: "8px" }}>{t.title || t.id}</td>
                    <td style={{ padding: "8px" }}>{t.assignee || "—"}</td>
                    <td style={{ padding: "8px" }}>{t.type || "—"}</td>
                    <td style={{ padding: "8px" }}>
                      {(t.slaStart ? new Date(t.slaStart).toLocaleString() : "—")} →{" "}
                      {t.slaEnd ? new Date(t.slaEnd).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "8px", display: "flex", gap: 8 }}>
                      <button onClick={() => { onClose(); onEdit(t); }}>Edit</button>
                      <button onClick={() => { onClose(); onDelete(t); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              Showing {rows.length} task{rows.length === 1 ? "" : "s"} in current date range.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Status pill placeholder to avoid duplicate export in some bundlers ---------- */
function StatusTagInner() { return null; }
