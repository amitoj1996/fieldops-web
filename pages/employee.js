// pages/employee.js
import { useEffect, useMemo, useRef, useState } from "react";

/* -------------------- tiny utils -------------------- */
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
const ru = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

/* Remaining + spend helpers (include PENDING/APPROVED; exclude REJECTED) */
const DEFAULT_LIMITS = { Hotel: 1000, Food: 1000, Travel: 1000, Other: 1000 };
function spendStats(task, expenses) {
  const limits = task?.expenseLimits || DEFAULT_LIMITS;
  const cats = ["Hotel", "Food", "Travel", "Other"];
  const spent = { Hotel: 0, Food: 0, Travel: 0, Other: 0 };
  for (const e of expenses || []) {
    const st = e?.approval?.status || "";
    if (st === "REJECTED") continue;
    if (!["PENDING_REVIEW", "APPROVED", "AUTO_APPROVED", ""].includes(st)) continue;
    const cat = e?.category || "Other";
    const amt = Number(e?.editedTotal ?? e?.total ?? 0) || 0;
    if (spent[cat] == null) spent[cat] = 0;
    spent[cat] += amt;
  }
  const out = {};
  for (const k of cats) {
    const limit = Number(limits[k] || 0);
    const s = Number(spent[k] || 0);
    const remaining = Math.max(0, limit - s);
    const pct = limit > 0 ? Math.min(1, s / limit) : 0;
    out[k] = { limit, spent: s, remaining, pct };
  }
  return out;
}

/* -------------------------- Page -------------------------- */
export default function Employee() {
  const me = useAuth();
  const [tenantId] = useState("default");
  const myEmail = (me?.userDetails || "").toLowerCase();

  const [allTasks, setAllTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [stats, setStats] = useState(spendStats(null, []));

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

  /* ------------- Load my tasks ------------- */
  useEffect(() => {
    (async () => {
      setTasksLoading(true);
      try {
        const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then((r) => r.json());
        setAllTasks(Array.isArray(j) ? j : []);
      } catch (e) {
        console.error(e);
      } finally {
        setTasksLoading(false);
      }
    })();
  }, [tenantId, myEmail]);

  const myTasks = useMemo(() => {
    if (!myEmail) return [];
    return (allTasks || []).filter((t) => (t.assignee || "").toLowerCase() === myEmail);
  }, [allTasks, myEmail]);

  async function selectTask(t) {
    setSelected(t);
    setDraft(null);
    setCategory("");
    setEditedTotal("");
    setEditExp(null);
    setEditCategory("");
    setEditAmount("");
    setSavingEdit(false);
    try {
      const ex = await fetch(
        `/api/expenses/byTask?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`
      ).then((r) => r.json());
      const arr = Array.isArray(ex) ? ex : [];
      setExpenses(arr);

      const ev = await fetch(
        `/api/tasks/events?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`
      ).then((r) => r.json());
      setEvents(Array.isArray(ev) ? ev : []);

      setStats(spendStats(t, arr));
    } catch (e) {
      console.error(e);
    }
  }

  /* ------------- Check-in / out ------------- */
  async function checkIn() {
    if (!selected) return;
    const r = await fetch(`/api/tasks/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, taskId: selected.id }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 400) {
      const j = await r.json();
      if (/reason required/i.test(j.error || "")) {
        const reason = window.prompt("SLA appears breached. Please enter a reason:");
        if (!reason) return;
        body = { ...body, reason };
        r = await fetch(`/api/tasks/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
    }
    const j2 = await r.json();
    if (!r.ok) return alert(j2.error || "Checkout failed");
    await selectTask(selected);
  }

  /* ------------- Upload + OCR + finalize ------------- */
  async function onChooseFile(ev) {
    if (!selected) return alert("Select a task first.");
    const f = ev.target.files?.[0];
    if (!f) return;

    const safeName = `${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    setUploading(true);
    try {
      const sas = await fetch(
        `/api/receipts/sas?taskId=${encodeURIComponent(selected.id)}&filename=${encodeURIComponent(
          safeName
        )}`
      ).then((r) => r.json());
      if (!sas?.uploadUrl) throw new Error("Could not get upload URL");

      const put = await fetch(sas.uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob" },
        body: f,
      });
      if (!put.ok) throw new Error(`Blob upload failed (HTTP ${put.status})`);

      const ocr = await fetch(`/api/receipts/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, taskId: selected.id, filename: safeName, save: true }),
      }).then((r) => r.json());

      const info = ocr?.ocr || {};
      const detectedTotal = info?.total ?? "";
      setDraft({
        blobUrl: ocr?.blobPath || sas?.blobUrl,
        filename: safeName,
        merchant: info?.merchant || "",
        total: detectedTotal,
        date: info?.date || "",
        currency: info?.currency || "",
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
      total: amount,
    };

    const r = await fetch(`/api/expenses/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  /* ------------- Receipts / open ------------- */
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

  /* ------------- Edit & resubmit (rejected) ------------- */
  function beginEdit(e) {
    setEditExp(e);
    setEditCategory(e.category || "");
    const amt = e.editedTotal ?? e.total ?? "";
    setEditAmount(amt);
  }
  async function submitEdit() {
    if (!selected || !editExp) return;
    if (!editCategory) return alert("Choose a category");
    const amt = Number(editAmount || 0);
    if (!Number.isFinite(amt) || amt <= 0) return alert("Enter a valid amount");
    setSavingEdit(true);
    try {
      const body = {
        tenantId,
        expenseId: editExp.id,
        category: editCategory,
        total: amt,
      };
      const r = await fetch(`/api/expenses/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Resubmit failed");

      setEditExp(null);
      setEditCategory("");
      setEditAmount("");

      await selectTask(selected);

      const st = j?.approval?.status;
      if (st === "AUTO_APPROVED") {
        alert("Updated expense auto-approved (within remaining).");
      } else if (st === "PENDING_REVIEW") {
        alert("Updated expense submitted for review.");
      } else {
        alert("Updated.");
      }
    } catch (e) {
      alert(e.message || "Resubmit failed");
    } finally {
      setSavingEdit(false);
    }
  }

  /* -------------------------- UI -------------------------- */
  return (
    <main style={{ padding: "24px", fontFamily: "-apple-system, system-ui, Segoe UI, Roboto" }}>
      <h1 style={{ margin: 0 }}>Employee portal</h1>
      <div style={{ marginBottom: 16, color: "#444" }}>
        Signed in as: <strong>{me?.userDetails || "—"}</strong>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 360px) 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* -------- Left column: Task list -------- */}
        <div style={{ position: "sticky", top: 76 }}>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              background: "#fff",
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 700, margin: "4px 0 8px" }}>My tasks</div>
            {tasksLoading ? (
              <p style={{ color: "#666" }}>Loading…</p>
            ) : myTasks.length === 0 ? (
              <p style={{ color: "#666" }}>No tasks assigned.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {myTasks.map((t) => {
                  const active = selected?.id === t.id;
                  return (
                    <li key={t.id} style={{ marginBottom: 8 }}>
                      <button
                        onClick={() => selectTask(t)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid " + (active ? "#cfe5ff" : "#eee"),
                          background: active ? "#f5faff" : "#fff",
                          borderRadius: 10,
                          padding: "10px 12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <strong style={{ fontSize: 14 }}>{t.title || t.id}</strong>
                          <span
                            style={{
                              fontSize: 11,
                              padding: "1px 6px",
                              borderRadius: 999,
                              background: "#f6f6f6",
                              color: "#444",
                            }}
                          >
                            {(t.status || "ASSIGNED").toLowerCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                          {fmtDT(t.slaStart)} → {fmtDT(t.slaEnd)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* -------- Right column: Task details -------- */}
        <div>
          {!selected ? (
            <div
              style={{
                border: "1px dashed #d9e3f0",
                background: "#fbfdff",
                borderRadius: 12,
                padding: 24,
                color: "#556",
              }}
            >
              Select a task to view details, upload a receipt, and submit expenses.
            </div>
          ) : (
            <>
              {/* Header card */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  background: "#fff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h2 style={{ margin: "0 0 6px" }}>{selected.title || selected.id}</h2>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      SLA: {fmtDT(selected.slaStart)} → {fmtDT(selected.slaEnd)}
                      {selected.slaBreached ? (
                        <span style={{ color: "#b11", marginLeft: 8 }}>(breached)</span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={checkIn}>Check in</button>
                    <button onClick={checkOut}>Check out</button>
                  </div>
                </div>
              </div>

              {/* Remaining / spend bars */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  background: "#fff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Budget usage</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                  {["Hotel", "Food", "Travel", "Other"].map((k) => {
                    const s = stats[k] || { limit: 0, spent: 0, remaining: 0, pct: 0 };
                    const pct = s.limit > 0 ? Math.min(100, Math.round((s.spent / s.limit) * 100)) : 0;
                    return (
                      <div
                        key={k}
                        style={{
                          border: "1px solid #f1f1f1",
                          borderRadius: 10,
                          padding: 10,
                          background: "#fafafa",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <strong>{k}</strong>
                          <span style={{ fontSize: 12, color: "#666" }}>{pct}% used</span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 999,
                            background: "#eee",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: "#d7e7ff",
                              border: "1px solid #c2d9ff",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#555", marginTop: 6 }}>
                          <span>Limit: {ru(s.limit)}</span>
                          <span>Spent: {ru(s.spent)}</span>
                          <span>Remaining: {ru(s.remaining)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Timeline & Expenses side-by-side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12, marginBottom: 12 }}>
                {/* Timeline */}
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    background: "#fff",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Timeline</div>
                  {events.length === 0 ? (
                    <div style={{ color: "#666", fontSize: 13 }}>No events yet.</div>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {events.map((ev) => (
                        <li key={ev.id} style={{ padding: "8px 0", borderBottom: "1px solid #f4f4f4" }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{ev.eventType.replace("_", " ")}</div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            {fmtDT(ev.ts)}
                            {ev.late ? <span style={{ color: "#b22" }}> • late</span> : null}
                            {ev.reason ? <span> — {ev.reason}</span> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Expenses */}
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    background: "#fff",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    padding: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>My expenses</div>
                  {expenses.length === 0 ? (
                    <div style={{ color: "#666", fontSize: 13 }}>None yet.</div>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {expenses.map((e) => {
                        const st = e?.approval?.status;
                        const pill = {
                          PENDING_REVIEW: { bg: "#fff4e5", color: "#8a5b00", label: "Pending" },
                          AUTO_APPROVED: { bg: "#e8fff2", color: "#0b6d3d", label: "Auto-approved" },
                          APPROVED: { bg: "#e8f4ff", color: "#0b4d8a", label: "Approved" },
                          REJECTED: { bg: "#ffe8e8", color: "#8a0b0b", label: "Rejected" },
                        }[st] || { bg: "#eee", color: "#444", label: st || "—" };
                        return (
                          <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid #f4f4f4" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <strong>{e.category || "(uncategorized)"}:</strong>
                                  <span>{ru(e.editedTotal ?? e.total)}</span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      padding: "2px 6px",
                                      borderRadius: 999,
                                      background: pill.bg,
                                      color: pill.color,
                                    }}
                                  >
                                    {pill.label}
                                  </span>
                                </div>
                                <div style={{ fontSize: 12, color: "#666" }}>
                                  {fmtDT(e.createdAt)} • {e.merchant || "Merchant"}
                                </div>
                                {e.approval?.status === "REJECTED" && e.approval?.note && (
                                  <div style={{ marginTop: 6, fontSize: 12, color: "#b22" }}>
                                    Admin note: {e.approval.note}
                                  </div>
                                )}
                              </div>
                              <div style={{ minWidth: 220, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                <button onClick={() => openReceipt(e)}>Open receipt</button>
                                {e.approval?.status === "REJECTED" && (
                                  <button onClick={() => beginEdit(e)}>Edit &amp; resubmit</button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Edit rejected expense */}
              {editExp && (
                <div
                  style={{
                    border: "2px solid #ffe0e0",
                    background: "#fff8f8",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Edit &amp; resubmit</div>
                  {editExp?.approval?.note && (
                    <div style={{ fontSize: 12, color: "#b22", marginBottom: 8 }}>
                      Admin note: {editExp.approval.note}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 640 }}>
                    <label>
                      Category
                      <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                        <option value="">— Select —</option>
                        <option>Hotel</option>
                        <option>Food</option>
                        <option>Travel</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label>
                      Amount (₹)
                      <input
                        type="number"
                        step="0.01"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={submitEdit} disabled={savingEdit}>
                      {savingEdit ? "Saving…" : "Resubmit"}
                    </button>
                    <button
                      onClick={() => {
                        setEditExp(null);
                        setEditCategory("");
                        setEditAmount("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                    After resubmitting, this expense is re-evaluated against the <em>remaining</em> budget.
                  </div>
                </div>
              )}

              {/* Upload + OCR + finalize new expense */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  background: "#fff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Add a new expense</div>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  ref={fileRef}
                  onChange={onChooseFile}
                  disabled={uploading}
                />
                {uploading && <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>Uploading &amp; OCR…</div>}

                {draft && (
                  <div style={{ marginTop: 12, border: "1px solid #f1f1f1", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      Detected: {draft.merchant ? `${draft.merchant} • ` : ""}
                      {draft.date || ""} {draft.currency ? `• ${draft.currency}` : ""}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 8,
                        marginTop: 8,
                        maxWidth: 700,
                      }}
                    >
                      <label>
                        Category
                        <select value={category} onChange={(e) => setCategory(e.target.value)}>
                          <option value="">— Select —</option>
                          <option>Hotel</option>
                          <option>Food</option>
                          <option>Travel</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label>
                        Edited total (₹)
                        <input
                          type="number"
                          step="0.01"
                          value={editedTotal}
                          onChange={(e) => setEditedTotal(e.target.value)}
                        />
                      </label>
                      <div style={{ display: "flex", alignItems: "end" }}>
                        <button onClick={submitExpense}>Submit expense</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                      If the edited total differs from OCR, admin will see it as an override. If it exceeds the remaining
                      budget for the category, it goes to review.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
