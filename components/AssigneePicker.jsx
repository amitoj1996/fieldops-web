import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * AssigneePicker (tasks-only)
 * - Fetches /api/tasks?... once (or when reopened after clear)
 * - Builds unique assignee list on the client
 * - Filters as you type; always allows free-text email
 *
 * Props:
 *   value: string
 *   onChange: (email: string) => void
 *   placeholder?: string
 *   taskUrl?: string  (default: "/api/tasks?tenantId=default")
 *   allowFreeText?: boolean (default: true)
 *   defaultDomain?: string
 *   disabled?: boolean
 */
export default function AssigneePicker({
  value = "",
  onChange,
  placeholder = "Search name or email…",
  taskUrl = "/api/tasks?tenantId=default",
  allowFreeText = true,
  defaultDomain,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]); // {displayName,email}
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function onDoc(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [open]);

  // Load tasks → unique assignees (once when opened)
  useEffect(() => {
    if (!open) return;
    if (items.length) return;
    (async () => {
      setLoading(true); setError("");
      try {
        const r = await fetch(taskUrl, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const arr = await r.json();
        const seen = new Set();
        const out = [];
        for (const t of (Array.isArray(arr) ? arr : [])) {
          const email = String(t?.assignee || "").trim().toLowerCase();
          if (!email || seen.has(email)) continue;
          seen.add(email);
          out.push({ email, displayName: humanize(email) });
        }
        setItems(out);
      } catch (e) {
        setError("Couldn’t read tasks. You can type an email.");
      } finally {
        setLoading(false);
        setHighlight(0);
      }
    })();
  }, [open, taskUrl, items.length]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items
      .filter(u =>
        (u.displayName || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [items, term]);

  function labelFor(u) {
    if (!u) return "";
    if (!u.displayName || eqi(u.displayName, u.email)) return u.email;
    return `${u.displayName} <${u.email}>`;
  }

  function pick(u) {
    setOpen(false);
    setTerm("");
    if (u && u.email) onChange(u.email);
    inputRef.current?.focus();
  }

  function clearSelection(e) {
    e.preventDefault(); e.stopPropagation();
    onChange(""); setTerm(""); setOpen(false);
    inputRef.current?.focus();
  }

  function coerceEmail(input) {
    const s = (input || "").trim();
    if (!s) return "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s.toLowerCase();
    if (defaultDomain && /^[a-z0-9._-]+$/i.test(s)) return `${s.toLowerCase()}@${defaultDomain}`;
    return "";
  }

  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown")      { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, filtered.length - 1))); scrollIntoView(); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); scrollIntoView(); }
    else if (e.key === "Enter")     { e.preventDefault(); filtered[highlight] ? pick(filtered[highlight]) : (allowFreeText && coerceEmail(term) && (onChange(coerceEmail(term)), setOpen(false))); }
    else if (e.key === "Escape")    { setOpen(false); }
  }

  function scrollIntoView() {
    requestAnimationFrame(() => {
      const li = listRef.current?.children?.[highlight];
      // @ts-ignore
      li?.scrollIntoView?.({ block: "nearest" });
    });
  }

  const showFreeText = allowFreeText && !!coerceEmail(term);
  const selectedLabel = useMemo(() => {
    if (!value) return "";
    const m = items.find(x => eqi(x.email, value));
    return m ? labelFor(m) : value;
  }, [value, items]);

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          display: "flex", alignItems: "center",
          border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", gap: 8,
          background: disabled ? "#f9fafb" : "#fff", cursor: disabled ? "not-allowed" : "text"
        }}
        onClick={() => !disabled && setOpen(true)}
      >
        <span aria-hidden title="Assignee"
          style={{ width: 26, height: 26, borderRadius: "50%", background: "#e5e7eb",
                   display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
          👤
        </span>

        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={open ? term : selectedLabel}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoComplete="off"
          style={{ border: "none", outline: "none", flex: 1, minWidth: 0, background: "transparent" }}
        />

        {(value && !disabled) ? (
          <button type="button" onClick={clearSelection} title="Clear"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "#6b7280" }}>×</button>
        ) : (
          <span aria-hidden title={open ? "Close" : "Open"} style={{ color: "#9ca3af", fontSize: 12 }}>▾</span>
        )}
      </div>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 2000,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.08)", overflow: "hidden"
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#6b7280", background: "#fafafa" }}>
            {loading ? "Loading assignees from tasks…" : error || "Suggestions from tasks"}
          </div>

          <ul ref={listRef} role="listbox" aria-label="Assignee options"
              style={{ maxHeight: 260, overflowY: "auto", margin: 0, padding: 0, listStyle: "none" }}>
            {!loading && filtered.map((u, idx) => (
              <li key={`${u.email}-${idx}`}
                  role="option"
                  aria-selected={highlight === idx}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", background: highlight === idx ? "#f3f4f6" : "#fff", cursor: "pointer"
                  }}
              >
                <Avatar label={u.displayName || u.email} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#111827", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                    {u.displayName || u.email}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                    {u.email}
                  </div>
                </div>
              </li>
            ))}
            {!loading && filtered.length === 0 && (
              <li style={{ padding: "12px", color: "#6b7280", fontSize: 13 }}>
                No matches.
              </li>
            )}
          </ul>

          {showFreeText && (
            <div style={{ borderTop: "1px solid #f3f4f6", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#fafafa" }}>
              <div style={{ fontSize: 12, color: "#374151" }}>
                Use <strong>{coerceEmail(term)}</strong>
              </div>
              <button type="button"
                      onClick={() => { const em = coerceEmail(term); if (em) onChange(em); setOpen(false); }}
                      style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", background: "#fff", cursor: "pointer", fontSize: 12 }}>
                Select
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function eqi(a,b){ return (a||"").toLowerCase()===(b||"").toLowerCase(); }
function initials(s){ const t=(s||"").trim(); if(!t) return "?"; const p=t.split(/\s+/); return (p.length===1?p[0].slice(0,2):(p[0][0]+p[p.length-1][0])).toUpperCase(); }
function Avatar({label}){ return (
  <span aria-hidden title={label}
    style={{ width: 26, height: 26, borderRadius: "50%", background: "#e5e7eb",
             display: "inline-flex", alignItems: "center", justifyContent: "center",
             fontSize: 12, fontWeight: 600 }}>
    {initials(label)}
  </span>
);}
function humanize(email){ const left=(email||"").split("@")[0]; return left.replace(/[._-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
