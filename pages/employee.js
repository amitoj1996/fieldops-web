import { useEffect, useMemo, useRef, useState } from "react";

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

function ru(n){ return n==null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`; }

function remainingByCategory(task, expenses) {
  const limits = task?.expenseLimits || {Hotel:1000, Food:1000, Travel:1000, Other:1000};
  const rem = {Hotel: limits.Hotel||0, Food: limits.Food||0, Travel: limits.Travel||0, Other: limits.Other||0};
  for (const e of expenses||[]) {
    const st = e?.approval?.status;
    if (st === "REJECTED") continue;
    const cat = e?.category || "Other";
    const amt = Number(e?.editedTotal ?? e?.total ?? 0) || 0;
    // Count PENDING_REVIEW + APPROVED + AUTO_APPROVED toward the cap (mirrors backend logic)
    if (["PENDING_REVIEW","APPROVED","AUTO_APPROVED", null, ""].includes(st)) {
      if (rem[cat] == null) rem[cat] = 0;
      rem[cat] -= amt;
    }
  }
  Object.keys(rem).forEach(k => { if (rem[k] < 0) rem[k] = 0; });
  return rem;
}

export default function Employee() {
  const me = useAuth();
  const [tenantId] = useState("default");
  const myEmail = (me?.userDetails || "").toLowerCase();

  const [allTasks, setAllTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [rem, setRem] = useState({Hotel:0,Food:0,Travel:0,Other:0});

  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState(null); // { blobUrl, filename, merchant, total, date, currency }
  const fileRef = useRef(null);

  // Expense finalize fields
  const [category, setCategory] = useState("");
  const [editedTotal, setEditedTotal] = useState("");

  // Load all tasks (API returns all; we filter client-side by assignee === myEmail)
  useEffect(() => {
    (async () => {
      setTasksLoading(true);
      try {
        const j = await fetch(`/api/tasks?tenantId=${tenantId}`).then(r=>r.json());
        setAllTasks(Array.isArray(j) ? j : []);
      } catch (e) {
        console.error(e);
      } finally {
        setTasksLoading(false);
      }
    })();
  }, [tenantId, me?.userDetails]);

  const myTasks = useMemo(() => {
    if (!myEmail) return [];
    return (allTasks || []).filter(t => (t.assignee || "").toLowerCase() === myEmail);
  }, [allTasks, myEmail]);

  async function selectTask(t) {
    setSelected(t);
    setDraft(null);
    setCategory("");
    setEditedTotal("");
    try {
      const ex = await fetch(`/api/expenses/byTask?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`).then(r=>r.json());
      const arr = Array.isArray(ex) ? ex : [];
      setExpenses(arr);
      const ev = await fetch(`/api/tasks/events?taskId=${encodeURIComponent(t.id)}&tenantId=${tenantId}`).then(r=>r.json());
      setEvents(Array.isArray(ev) ? ev : []);
      setRem(remainingByCategory(t, arr));
    } catch (e) {
      console.error(e);
    }
  }

  async function checkIn() {
    if (!selected) return;
    const r = await fetch(`/api/tasks/checkin`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ tenantId, taskId: selected.id })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Check-in failed");
    await selectTask(selected);
  }

  async function checkOut() {
    if (!selected) return;
    // Attempt checkout without reason; if SLA breached server will demand a reason
    let body = { tenantId, taskId: selected.id };
    let r = await fetch(`/api/tasks/checkout`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    if (r.status === 400) {
      const j = await r.json();
      if (/reason required/i.test(j.error || "")) {
        const reason = window.prompt("SLA appears breached. Please enter a reason:");
        if (!reason) return; // cancelled
        body = { tenantId, taskId: selected.id, reason };
        r = await fetch(`/api/tasks/checkout`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify(body)
        });
      }
    }
    const j2 = await r.json();
    if (!r.ok) return alert(j2.error || "Checkout failed");
    await selectTask(selected);
  }

  async function onChooseFile(ev) {
    if (!selected) return alert("Select a task first.");
    const f = ev.target.files?.[0];
    if (!f) return;

    const safeName = `${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
    setUploading(true);
    try {
      // get SAS to upload
      const sas = await fetch(`/api/receipts/sas?taskId=${encodeURIComponent(selected.id)}&filename=${encodeURIComponent(safeName)}`).then(r=>r.json());
      if (!sas?.uploadUrl) throw new Error("Could not get upload URL");

      // upload to blob
      const put = await fetch(sas.uploadUrl, { method:"PUT", headers: {"x-ms-blob-type":"BlockBlob"}, body: f });
      if (!put.ok) throw new Error(`Blob upload failed (HTTP ${put.status})`);

      // OCR
      const ocr = await fetch(`/api/receipts/ocr`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ tenantId, taskId: selected.id, filename: safeName, save: true })
      }).then(r=>r.json());

      const info = ocr?.ocr || {};
      const detectedTotal = info?.total ?? "";
      setDraft({
        blobUrl: ocr?.blobPath || sas?.blobUrl,
        filename: safeName,
        merchant: info?.merchant || "",
        total: detectedTotal,
        date: info?.date || "",
        currency: info?.currency || ""
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

  async function openReceipt(exp) {
    try {
      const filename = exp.blobPath.split("/").pop();
      const j = await fetch(`/api/receipts/readSas?taskId=${encodeURIComponent(exp.taskId)}&filename=${encodeURIComponent(filename)}&minutes=5`).then(r=>r.json());
      if (j.readUrl) window.open(j.readUrl, "_blank");
    } catch (e) {
      alert("Could not open receipt");
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
      total: amount
    };

    const r = await fetch(`/api/expenses/finalize`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "Submit failed");

    // refresh
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

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Employee portal</h1>
      <div style={{marginBottom:12, color:"#444"}}>
        Signed in as: <strong>{me?.userDetails || "—"}</strong>
      </div>

      <section style={{display:"grid", gridTemplateColumns:"1fr 2fr", gap:16}}>
        <div>
          <h2 style={{marginTop:0}}>My tasks</h2>
          {tasksLoading ? <p>Loading…</p> :
            (myTasks.length === 0 ? <p>No tasks assigned.</p> :
              <ul>
                {myTasks.map(t => (
                  <li key={t.id} style={{margin:"0.5rem 0"}}>
                    <button onClick={() => selectTask(t)} style={{display:"block", width:"100%", textAlign:"left"}}>
                      <strong>{t.title || t.id}</strong>
                      <div style={{fontSize:12, color:"#555"}}>
                        Status: {t.status} • SLA: {t.slaStart ? new Date(t.slaStart).toLocaleString() : "—"} → {t.slaEnd ? new Date(t.slaEnd).toLocaleString() : "—"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
          )}
        </div>

        <div>
          {!selected ? (
            <p>Select a task to view and update.</p>
          ) : (
            <>
              <h2 style={{marginTop:0}}>{selected.title || selected.id}</h2>

              {/* Remaining budget */}
              <div style={{border:"1px solid #e6e6e6", borderRadius:8, padding:12, background:"#fafafa", marginBottom:12}}>
                <strong>Remaining budget</strong>
                <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:8}}>
                  {["Hotel","Food","Travel","Other"].map(k => (
                    <div key={k} style={{padding:8, border:"1px solid #eee", borderRadius:6}}>
                      <div style={{fontSize:12, color:"#666"}}>{k}</div>
                      <div style={{fontWeight:600}}>{ru(rem[k])}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Check in/out */}
              <div style={{display:"flex", gap:8, marginBottom:12}}>
                <button onClick={checkIn}>Check in</button>
                <button onClick={checkOut}>Check out</button>
              </div>

              {/* Timeline */}
              <div style={{marginBottom:16}}>
                <h3>Timeline</h3>
                <ul>
                  {events.map(ev => (
                    <li key={ev.id} style={{margin:"0.5rem 0"}}>
                      {ev.eventType} — {new Date(ev.ts).toLocaleString()} {ev.late ? " (late)" : ""} {ev.reason ? `— ${ev.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Expenses list */}
              <div style={{marginBottom:16}}>
                <h3>My expenses</h3>
                {expenses.length === 0 ? <p>None yet.</p> : (
                  <ul>
                    {expenses.map(e => (
                      <li key={e.id} style={{margin:"0.5rem 0"}}>
                        <div><strong>{e.category || "(uncategorized)"}:</strong> {ru(e.editedTotal ?? e.total)} — {e.approval?.status || "—"}</div>
                        <div style={{fontSize:12, color:"#555"}}>{new Date(e.createdAt).toLocaleString()} — {e.merchant || "Merchant"}</div>
                        <div style={{display:"flex", gap:8, marginTop:6}}>
                          <button onClick={() => openReceipt(e)}>Open receipt</button>
                          {e.approval?.status === "REJECTED" && e.approval?.note && (
                            <span style={{fontSize:12, color:"#b22"}}>Admin note: {e.approval.note}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Upload + OCR + finalize */}
              <div style={{borderTop:"1px dashed #ddd", paddingTop:12}}>
                <h3>Add a new expense</h3>
                <input type="file" accept="image/*,application/pdf" ref={fileRef} onChange={onChooseFile} disabled={uploading}/>
                {uploading && <div style={{fontSize:12, color:"#666"}}>Uploading & OCR…</div>}

                {draft && (
                  <div style={{marginTop:12, border:"1px solid #eee", borderRadius:8, padding:12}}>
                    <div style={{fontSize:12, color:"#666"}}>Detected: {draft.merchant ? `${draft.merchant} • ` : ""}{draft.date || ""} {draft.currency ? `• ${draft.currency}` : ""}</div>
                    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:8, maxWidth:700}}>
                      <label>Category
                        <select value={category} onChange={e=>setCategory(e.target.value)}>
                          <option value="">— Select —</option>
                          <option>Hotel</option>
                          <option>Food</option>
                          <option>Travel</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label>Edited total (₹)
                        <input type="number" step="0.01" value={editedTotal} onChange={e=>setEditedTotal(e.target.value)} />
                      </label>
                      <div style={{display:"flex", alignItems:"end"}}>
                        <button onClick={submitExpense}>Submit expense</button>
                      </div>
                    </div>
                    <div style={{fontSize:12, color:"#666", marginTop:6}}>
                      If the edited total differs from OCR, admin will see it as an override. If your amount exceeds the <em>remaining</em> for the category, it will go to review instead of auto-approving.
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
