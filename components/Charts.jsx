import { useEffect, useMemo, useRef, useState } from "react";

/* ---------- tiny utils (local-only) ---------- */
function ru(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function formatShort(n) {
  const v = Number(n || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(1) + "cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1) + "L";
  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(1) + "k";
  return "₹" + v.toFixed(0);
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
  function onLeave() {
    setTip(null);
  }
  return { ref, tip, onMove, onLeave };
}
function useMeasureWidth() {
  const wrapRef = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!wrapRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  return [wrapRef, w];
}

/* =========================================================
   Grouped Bars — legend on top (doesn't steal chart width)
   ========================================================= */
export function InteractiveGroupedBars({
  categories = [],
  series = [],          // [{name, values: [...]}, ...]
  height = 260          // you can pass 260–300 if you want a taller plot
}) {
  const [wrapRef, wrapW] = useMeasureWidth();
  const totalW = Math.max(360, wrapW || 720); // responsive width
  const max = useMemo(() => {
    const vals = series.flatMap((s) => s.values || []);
    return Math.max(1, ...vals, 1);
  }, [series]);

  // paddings (left is dynamic to fit tick labels)
  const yTickSample = formatShort(max);
  const leftPad = Math.max(44, 10 + yTickSample.length * 7); // char-width ~7px
  const rightPad = 16;
  const topPadLegend = 28;   // top band for the legend (no width reserved)
  const bottomPad = 28;

  const chartW = Math.max(60, totalW - leftPad - rightPad);
  const chartH = Math.max(80, height - topPadLegend - bottomPad);
  const baselineY = topPadLegend + chartH;

  // horizontal layout that always fills available width
  const groupSlot = chartW / Math.max(1, categories.length);
  const gapBetweenGroups = Math.min(28, groupSlot * 0.32);
  const barsAreaW = Math.max(32, groupSlot - gapBetweenGroups);
  const gapInner = 10;
  const barW = Math.max(12, Math.min(28, (barsAreaW - gapInner * (Math.max(1, series.length) - 1)) / Math.max(1, series.length)));

  const { ref, tip, onMove, onLeave } = useTooltip();
  const fills = ["#dbeafe", "#c7f9e3", "#fde68a", "#fbcfe8", "#e5e7eb"];
  const strokes = ["#9ac1ee", "#85dcb5", "#f1bf42", "#f28dbf", "#c7c9cc"];

  // legend x-positions (inline, no width reservation)
  const legendItems = useMemo(() => {
    const items = [];
    let x = leftPad; // start at chart's left edge, inside legend band
    for (let i = 0; i < series.length; i++) {
      const label = series[i].name || `S${i + 1}`;
      const approxW = 18 + Math.max(40, label.length * 7); // swatch(12) + gap + text
      items.push({ x, label, idx: i });
      x += approxW + 18;
      if (x > leftPad + chartW - 80) x = leftPad; // wrap if super long (rare)
    }
    return items;
  }, [series, leftPad, chartW]);

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <svg
        ref={ref}
        width="100%"
        viewBox={`0 0 ${totalW} ${height}`}
        role="img"
        aria-label="Grouped bar chart"
      >
        {/* X+Y axes grid */}
        <line x1={leftPad} y1={baselineY} x2={leftPad + chartW} y2={baselineY} stroke="#e5e7eb" />
        {Array.from({ length: 4 }, (_, i) => i + 1).map((i) => {
          const y = baselineY - i * (chartH / 4);
          return (
            <g key={`grid-${i}`}>
              <line x1={leftPad} x2={leftPad + chartW} y1={y} y2={y} stroke="#f3f4f6" />
              <text
                x={leftPad - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="#6b7280"
              >
                {formatShort((max * i) / 4)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {categories.map((c, ci) => {
          const slotX = leftPad + ci * groupSlot;
          // center the bar pack inside the slot
          const packW = barW * series.length + gapInner * (series.length - 1);
          const gx = slotX + (groupSlot - packW) / 2;

          return (
            <g key={`cat-${c}`} transform={`translate(${gx},0)`}>
              {series.map((s, si) => {
                const v = Number((s.values || [])[ci] || 0);
                const hgt = Math.max(0, (v / max) * (chartH - 4));
                const x = si * (barW + gapInner);
                const y = baselineY - hgt;
                const fill = fills[si % fills.length];
                const stroke = strokes[si % strokes.length];
                return (
                  <rect
                    key={`bar-${si}`}
                    x={x}
                    y={y}
                    width={barW}
                    height={hgt}
                    fill={fill}
                    stroke={stroke}
                    onMouseMove={(e) =>
                      onMove(
                        e,
                        `<strong>${s.name || "Value"}</strong> in <em>${c}</em><br/>${ru(v)}`
                      )
                    }
                    onMouseLeave={onLeave}
                  />
                );
              })}
              {/* category label */}
              <text
                x={packW / 2}
                y={baselineY + 14}
                textAnchor="middle"
                fontSize="11"
                fill="#4b5563"
              >
                {c}
              </text>
            </g>
          );
        })}

        {/* Legend (top band, doesn't take chart width) */}
        <g transform={`translate(0, ${topPadLegend - 18})`}>
          {legendItems.map((it) => (
            <g key={`leg-${it.idx}`} transform={`translate(${it.x},0)`}>
              <rect
                width="12"
                height="12"
                fill={fills[it.idx % fills.length]}
                stroke={strokes[it.idx % strokes.length]}
                rx="2"
                ry="2"
              />
              <text x="18" y="10.5" fontSize="11" fill="#374151">
                {it.label}
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

/* =========================================================
   Horizontal Bars — dynamic left label padding
   ========================================================= */
export function InteractiveHBar({
  data,
  height = 240,
  maxBars = 5
}) {
  const rows = (data || []).slice(0, maxBars);
  const [wrapRef, wrapW] = useMeasureWidth();
  const totalW = Math.max(360, wrapW || 720);
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));

  // dynamic left padding for long labels
  const longest = rows.reduce((m, r) => Math.max(m, String(r.label || "").length), 0);
  const leftPad = Math.min(240, Math.max(90, 10 + longest * 6.5));
  const rightPad = 64;
  const topPad = 18;
  const bottomPad = 16;

  const chartW = Math.max(60, totalW - leftPad - rightPad);
  const rowH = Math.max(22, (height - topPad - bottomPad) / Math.max(1, rows.length));
  const totalH = Math.max(height, topPad + bottomPad + rows.length * rowH);

  const { ref, tip, onMove, onLeave } = useTooltip();

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <svg
        ref={ref}
        width="100%"
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label="Horizontal bar chart"
      >
        {rows.map((r, i) => {
          const y = topPad + i * rowH;
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
                onMouseMove={(e) =>
                  onMove(e, `<strong>${r.label}</strong><br/>${ru(r.value)}`)
                }
                onMouseLeave={onLeave}
              />
              <text
                x={leftPad - 10}
                y={y + rowH / 2 + 1}
                fontSize="11"
                dominantBaseline="middle"
                textAnchor="end"
                fill="#374151"
              >
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

/* Keep the alias your admin.js already uses */
export { InteractiveGroupedBars as FixedGroupedBars };
