import { useRef, useState } from "react";

/* ---------- small utils ---------- */
function formatCompact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e7) return (v / 1e7).toFixed(1).replace(/\.0$/, "") + "cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, "") + "L";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}
function ru(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
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

/* ====================================================================== */
/*  GROUPED BARS  — legend above, generous left margin, no clipping       */
/* ====================================================================== */
export function InteractiveGroupedBars({
  categories,
  series,
  height = 280,
  width = 720,
  margins // optional: {top,right,bottom,left}
}) {
  // generous default margins (left keeps y labels inside viewBox)
  const M = Object.assign({ top: 56, right: 18, bottom: 40, left: 64 }, margins || {});
  const [visible, setVisible] = useState(series.map(() => true));
  const active = series.map((s, i) => (visible[i] ? s : { ...s, values: s.values.map(() => 0) }));

  const max = Math.max(1, ...active.flatMap((s) => s.values.map((v) => Number(v || 0))));
  const barW = 18;
  const innerGap = 10;
  const outerGap = 24;
  const groupW = series.length * barW + innerGap * (series.length - 1);

  const plotW = Math.max(
    width - (M.left + M.right),
    categories.length * groupW + (categories.length - 1) * outerGap
  );
  const viewW = M.left + plotW + M.right;

  const plotH = Math.max(140, height - (M.top + M.bottom)); // never too short
  const viewH = M.top + plotH + M.bottom;
  const baseY = M.top + plotH;

  const { ref, tip, onMove, onLeave } = useTooltip();

  const fills = ["#dbeafe", "#c7f9e3", "#fde68a", "#fbcfe8", "#e5e7eb"];
  const strokes = ["#9ac1ee", "#85dcb5", "#f1bf42", "#f28dbf", "#c7c9cc"];

  // legend will sit inside the top margin band
  const legendX = M.left;
  const legendY = 18;

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${viewW} ${viewH}`} role="img" aria-label="Grouped bar chart">
        {/* grid & y-axis ticks */}
        <line x1={M.left} y1={baseY} x2={viewW - M.right} y2={baseY} stroke="#e5e7eb" />
        {Array.from({ length: 5 }, (_, i) => i + 1).map((i) => {
          const y = baseY - (i * plotH) / 5;
          return (
            <g key={`g-${i}`}>
              <line x1={M.left} x2={viewW - M.right} y1={y} y2={y} stroke="#f1f5f9" />
              <text
                x={M.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="#334155"
              >
                {formatCompact((max * i) / 5)}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {categories.map((c, idx) => {
          const gx = M.left + idx * (groupW + outerGap);
          return (
            <g key={c} transform={`translate(${gx},0)`}>
              {series.map((s, si) => {
                const v = Number(active[si].values[idx] || 0);
                const hgt = Math.max(0, (v / max) * (plotH - 4));
                const x = si * (barW + innerGap);
                const y = baseY - hgt;
                const fill = fills[si % fills.length];
                const stroke = strokes[si % strokes.length];
                const faded = !visible[si];
                return (
                  <rect
                    key={`${c}-${si}`}
                    x={x}
                    y={y}
                    width={barW}
                    height={hgt}
                    fill={fill}
                    stroke={stroke}
                    opacity={faded ? 0.25 : 1}
                    onMouseMove={(e) =>
                      onMove(
                        e,
                        `<strong>${s.name}</strong> in <em>${c}</em><br/>${ru(
                          Number(series[si].values[idx] || 0)
                        )}`
                      )
                    }
                    onMouseLeave={onLeave}
                  />
                );
              })}
              <text
                x={groupW / 2}
                y={baseY + 14}
                textAnchor="middle"
                fontSize="11"
                fill="#475569"
              >
                {c}
              </text>
            </g>
          );
        })}

        {/* legend (click to toggle) */}
        <g transform={`translate(${legendX}, ${legendY})`}>
          {series.map((s, i) => (
            <g
              key={`legend-${s.name}-${i}`}
              transform={`translate(${i * 130},0)`}
              style={{ cursor: "pointer" }}
              onClick={() =>
                setVisible((v) => v.map((x, idx) => (idx === i ? !x : x)))
              }
            >
              <rect
                width="12"
                height="12"
                fill={fills[i % fills.length]}
                stroke={strokes[i % strokes.length]}
                opacity={visible[i] ? 1 : 0.25}
                rx="2"
                ry="2"
              />
              <text x="16" y="10.5" fontSize="11" fill="#334155">
                {s.name} {visible[i] ? "" : "(off)"}
              </text>
            </g>
          ))}
        </g>
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

/* ====================================================================== */
/*  HORIZONTAL BARS  — small padding bump so labels/values never clip     */
/* ====================================================================== */
export function InteractiveHBar({
  data,
  height = 240,
  width = 560,
  padding = 32,
  maxBars = 5
}) {
  const rows = (data || []).slice(0, maxBars);
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  const rowH = Math.max(22, (height - padding * 1.6) / Math.max(1, rows.length));
  const totalH = Math.max(height, padding * 1.6 + rows.length * rowH);

  // a bit more left/right room than before
  const leftPad = padding + 10;
  const rightPad = padding + 10;
  const chartW = width - (leftPad + rightPad);

  const { ref, tip, onMove, onLeave } = useTooltip();

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${width} ${totalH}`} role="img" aria-label="Horizontal bar chart">
        {rows.map((r, i) => {
          const y = padding + i * rowH;
          const w = Math.max(2, (Number(r.value || 0) / max) * chartW);
          return (
            <g key={r.label}>
              <rect x={leftPad} y={y + 4} width={chartW} height={rowH - 8} fill="#f6f7fb" />
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
              <text x={leftPad + 6} y={y + rowH / 2 + 1} fontSize="11" dominantBaseline="middle" fill="#374151">
                {r.label}
              </text>
              <text
                x={leftPad + chartW - 6}
                y={y + rowH / 2 + 1}
                fontSize="11"
                dominantBaseline="middle"
                textAnchor="end"
                fill="#475569"
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

/* Also export with the alias your admin.js currently uses. */
export { InteractiveGroupedBars as FixedGroupedBars };
