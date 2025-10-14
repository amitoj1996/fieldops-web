import { useEffect, useMemo, useState } from "react";

function extractEmail(s="") {
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : s.trim().toLowerCase();
}

export default function AssigneePicker({ value, onChange, placeholder="Start typing a name or email…" }) {
  const [opts, setOpts] = useState([]);
  const [q, setQ] = useState(value || "");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users");
        if (res.ok) {
          const arr = await res.json();
          setOpts(Array.isArray(arr) ? arr : []);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => { setQ(value || ""); }, [value]);

  const suggestions = useMemo(() => {
    const needle = (q || "").toLowerCase().trim();
    if (!needle) return opts.slice(0, 50);
    return opts.filter(o => {
      const hay = `${(o.displayName||"").toLowerCase()} ${(o.email||"").toLowerCase()}`;
      return hay.includes(needle);
    }).slice(0, 50);
  }, [q, opts]);

  return (
    <div style={{ position:"relative" }}>
      <input
        value={q}
        onChange={(e) => {
          const s = e.target.value;
          setQ(s);
          const email = extractEmail(s);
          if (email && onChange) onChange(email);
        }}
        onBlur={() => {
          const email = extractEmail(q);
          if (email && onChange) onChange(email);
        }}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width:"100%", padding:"8px 10px", border:"1px solid #dcdfe4", borderRadius:8,
          outline:"none"
        }}
        list="assignee-options"
      />
      <datalist id="assignee-options">
        {suggestions.map((o) => {
          const label = o.displayName ? `${o.displayName} (${o.email})` : o.email;
          return <option key={o.email} value={o.email}>{label}</option>;
        })}
      </datalist>
      <div style={{fontSize:12, color:"#6b7280", marginTop:6}}>
        Tip: you can also type an email not in the list.
      </div>
    </div>
  );
}
