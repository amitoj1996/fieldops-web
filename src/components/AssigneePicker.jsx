import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * AssigneePicker (v2-friendly)
 * ---------------------------
 * - Queries your backend at /api/users?q=... (admin-only route in your function_app.py)
 * - Falls back to free-text email entry
 * - Returns a STRING email via onChange (default), so it plugs into your forms
 *
 * Props:
 *   value: string
 *   onChange: (email: string) => void
 *   placeholder?: string
 *   fetchUrl?: string (default: "/api/users")
 *   allowFreeText?: boolean (default: true)
 *   defaultDomain?: string (if user types "jsmith", turns into "jsmith@defaultDomain")
 *   disabled?: boolean
 */
export default function AssigneePicker({
  value = "",
  onChange,
  placeholder = "Search name or email…",
  fetchUrl = "/api/users",
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
  const listRef  = useRef(null);
  const debounceRef = useRef(null);

  // outside click to close
  useEffect(() => {
    function onDoc(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [open]);

  // fetch users (debounced)
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void search(term);
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, open]);

  async function search(q) {
    setLoading(true);
    setError("");
    try {
      const url = q ? `${fetchUrl}?q=${encodeURIComponent(q)}` : fetchUrl;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j.value || j.users || []);
      const norm = arr
        .map(u => ({
          displayName: u.displayName || u.name || u.email || "",
          email: (u.email || "").toLowerCase(),
        }))
        .filter(u => u.email);
      // dedupe by email
      const seen = new Set();
      const out = [];
      for (const u of norm) {
        if (seen.has(u.email)) continue;
        seen.add(u.email);
        out.push(u);
      }
      setItems(out);
    } catch (e) {
      setItems([]);
      setError("Directory unavailable. You can type an email.");
    } finally {
      setLoading(false);
      setHighlight(0);
    }
  }

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return items.slice(0, 30);
    return items
      .filter(u =>
        (u.displayName || "").toLowerCase().includes(t) ||
        (u.email || "").toLowerCase().includes(t)
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
    e.preventDefault();
    e.stopPropagation();
    onChange("");
    setTerm("");
    setOpen(false);
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
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      scrollIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
      scrollIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
      else if (allowFreeText) {
        const em = coerceEmail(term);
        if (em) onChange(em);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function scrollIntoView() {
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const li = list.children[highlight];
      if (li && li.scrollIntoView) {
        // @ts-ignore
        li.scrollIntoView({ block: "nearest" });
      }
    });
  }

  const showFreeText = allowFreeText && !!coerceEmail(term);
  const selectedLabel = useMemo(() => {
    if (!value) return "";
    const m = items.find(x => eqi(x.email, value));
    return m ? labelFor(m) : value;
  }, [value, items]);

  return (
    <div ref={rootRef} className="assignee-picker" style={{ position: "relative", width: "100%" }}>
      <div
        className={`ap-input-wrapper ${disabled ? "ap-disabled" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          padding: "6px 10px",
          gap: 8,
          background: disabled ? "#f9fafb" : "white",
          cursor: disabled ? "not-allowed" : "text",
        }}
        onClick={() => !disabled && setOpen(true)}
      >
        <span
          aria-hidden
          style={{
            width: 26, height: 26, borderRadius: "50%", background: "#e5e7eb",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600, color: "#374151", flex: "0 0 auto",
          }}
          title="Assignee"
        >
          👤
        </span>

        <input
          ref={inputRef}
          type="text"
          className="ap-input"
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
          <button
            type="button"
            className="ap-clear"
            onClick={clearSelection}
            aria-label="Clear assignee"
            title="Clear"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "#6b7280" }}
          >
            ×
          </button>
        ) : (
          <span aria-hidden style={{ color: "#9ca3af", fontSize: 12, flex: "0 0 auto" }} title={open ? "Close" : "Open"}>
            ▾
          </span>
        )}
      </div>

      {open && (
        <div
          className="ap-popover"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
            background: "white", border: "1px solid #e5e7eb", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)", overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 10px", borderBottom: "1px solid #f3f4f6",
              display: "flex", alignItems: "center", gap: 8, color: "#6b7280", fontSize: 12, background: "#fafafa",
            }}
          >
            {loading ? "Searching directory…" : error || "Directory: /api/users"}
          </div>

          <ul
            ref={listRef}
            role="listbox"
            aria-label="Assignee options"
            className="ap-options"
            style={{ maxHeight: 260, overflowY: "auto", margin: 0, padding: 0, listStyle: "none" }}
          >
            {!loading && filtered.map((u, idx) => (
              <li
                key={`${u.email}-${idx}`}
                role="option"
                aria-selected={highlight === idx}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(u)}
                className={`ap-option ${highlight === idx ? "is-active" : ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", background: highlight === idx ? "#f3f4f6" : "white",
                  cursor: "pointer",
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
            <div
              style={{
                borderTop: "1px solid #f3f4f6", padding: "8px 10px",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#fafafa",
              }}
            >
              <div style={{ fontSize: 12, color: "#374151" }}>
                Use <strong>{coerceEmail(term)}</strong>
              </div>
              <button
                type="button"
                onClick={() => { const em = coerceEmail(term); if (em) onChange(em); setOpen(false); }}
                style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", background: "white", cursor: "pointer", fontSize: 12 }}
              >
                Select
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function eqi(a, b) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}
function initials(s) {
  const t = (s || "").trim();
  if (!t) return "?";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function Avatar({ label }) {
  return (
    <span
      aria-hidden
      style={{
        width: 26, height: 26, borderRadius: "50%", background: "#e5e7eb",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 600, color: "#374151", flex: "0 0 auto",
      }}
      title={label}
    >
      {initials(label)}
    </span>
  );
}
