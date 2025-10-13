import { useRef, useState } from "react";

/* Local helpers so this file is self-contained */
function ru(n){ return n==null ? "—" : `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:2})}`; }
function formatINR(v){ const n=Number(v||0); if(n>=1e7) return "₹"+(n/1e7).toFixed(1)+"cr";
  if(n>=1e5) return "₹"+(n/1e5).toFixed(1)+"L"; if(n>=1e3) return "₹"+(n/1e3).toFixed(1)+"k"; return "₹"+n.toFixed(0); }

/* Lightweight tooltip hook */
function useTooltip(){
  const ref=useRef(null); const [tip,setTip]=useState(null);
  function onMove(e,html){ const el=ref.current; if(!el) return;
    const r=el.getBoundingClientRect(); setTip({x:e.clientX-r.left+8,y:e.clientY-r.top+8,html}); }
  function onLeave(){ setTip(null); }
  return {ref,tip,onMove,onLeave};
}

/* --- FIXED: Legend moved to top-right; extra padding for Y ticks --- */
export function InteractiveGroupedBars({ categories, series, height=240, width=560, padding=28 }){
  const [visible,setVisible]=useState(series.map(()=>true));
  const active=series.map((s,i)=>visible[i]?s:{...s,values:s.values.map(()=>0)});
  const max=Math.max(1,...active.flatMap(s=>s.values));
  const barW=18, gapInner=10, groupW=series.length*barW+gapInner*(series.length-1), gapOuter=20;

  const totalW=Math.max(width, padding*2 + categories.length*groupW + (categories.length-1)*gapOuter);
  const h=height, chartH=h - padding*1.6, baselineY=chartH + padding*0.2;
  const {ref,tip,onMove,onLeave}=useTooltip();

  const fills=["#dbeafe","#c7f9e3","#fde68a","#fbcfe8","#e5e7eb"];
  const strokes=["#9ac1ee","#85dcb5","#f1bf42","#f28dbf","#c7c9cc"];

  // Legend sizing & position (top-right)
  const legendItemW=130;
  const legendW=series.length*legendItemW;
  const legendX=Math.max(padding, totalW - padding - legendW);
  const legendY=padding - 12;

  return (
    <div style={{position:"relative"}} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${totalW} ${h}`} role="img" aria-label="Grouped bar chart">
        <line x1={padding} y1={baselineY} x2={totalW-padding} y2={baselineY} stroke="#ddd" />
        {Array.from({length:4},(_,i)=>i+1).map(i=>{
          const y=baselineY - i*(chartH/4);
          return (
            <g key={i}>
              <line x1={padding} x2={totalW-padding} y1={y} y2={y} stroke="#f0f2f5" />
              {/* a bit more left padding so it never touches */}
              <text x={padding-10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#64748b">
                {formatINR((max*i)/4)}
              </text>
            </g>
          );
        })}

        {categories.map((c,idx)=>{
          const gx=padding + idx*(groupW+gapOuter);
          return (
            <g key={c} transform={`translate(${gx},0)`}>
              {series.map((s,si)=>{
                const v=Number(active[si].values[idx]||0);
                const hgt=Math.max(0,(v/max)*(chartH-4));
                const x=si*(barW+gapInner); const y=baselineY-hgt;
                const fill=fills[si%fills.length], stroke=strokes[si%strokes.length];
                const faded=!visible[si];
                return (
                  <rect key={si} x={x} y={y} width={barW} height={hgt}
                        fill={fill} stroke={stroke} opacity={faded?0.25:1}
                        onMouseMove={(e)=>onMove(e, `<strong>${s.name}</strong> in <em>${c}</em><br/>${ru(Number(series[si].values[idx]||0))}`)}
                        onMouseLeave={onLeave}/>
                );
              })}
              <text x={groupW/2} y={baselineY+12} textAnchor="middle" fontSize="11" fill="#475569">{c}</text>
            </g>
          );
        })}

        {/* Legend: top-right */}
        <g transform={`translate(${legendX}, ${legendY})`}>
          {series.map((s,i)=>(
            <g key={s.name}
               transform={`translate(${i*legendItemW},0)`}
               style={{cursor:"pointer"}}
               onClick={()=>setVisible(v=>v.map((x,idx)=>idx===i?!x:x))}>
              <rect width="12" height="12" fill={fills[i%fills.length]} stroke={strokes[i%strokes.length]} opacity={visible[i]?1:0.25}/>
              <text x="16" y="10.5" fontSize="11" fill="#475569">{s.name} {visible[i]?"":"(off)"}</text>
            </g>
          ))}
        </g>
      </svg>

      {tip && (
        <div style={{position:"absolute",left:tip.x,top:tip.y,background:"#111",color:"#fff",fontSize:12,
                     padding:"6px 8px",borderRadius:6,pointerEvents:"none",whiteSpace:"nowrap",
                     boxShadow:"0 4px 12px rgba(0,0,0,0.2)"}}
             dangerouslySetInnerHTML={{__html:tip.html}}/>
      )}
    </div>
  );
}

/* unchanged */
export function InteractiveHBar({ data, height=240, width=560, padding=28, maxBars=5 }){
  const rows=(data||[]).slice(0,maxBars);
  const max=Math.max(1,...rows.map(r=>r.value));
  const rowH=Math.max(22,(height - padding*1.6)/Math.max(1,rows.length));
  const totalH=Math.max(height, padding*1.6 + rows.length*rowH);
  const chartW=width - padding*2;
  const {ref,tip,onMove,onLeave}=useTooltip();

  return (
    <div style={{position:"relative"}} ref={ref}>
      <svg width="100%" viewBox={`0 0 ${width} ${totalH}`} role="img" aria-label="Horizontal bar chart">
        {rows.map((r,i)=>{
          const y=padding + i*rowH; const w=Math.max(2,(r.value/max)*chartW);
          return (
            <g key={r.label}>
              <rect x={padding} y={y+4} width={chartW} height={rowH-8} fill="#f6f7fb" />
              <rect x={padding} y={y+4} width={w} height={rowH-8} fill="#e3f2fd" stroke="#9ac1ee"
                    onMouseMove={(e)=>onMove(e, `<strong>${r.label}</strong><br/>${ru(r.value)}`)}
                    onMouseLeave={onLeave}/>
              <text x={padding+6} y={y+rowH/2+1} fontSize="11" dominantBaseline="middle" fill="#374151">{r.label}</text>
              <text x={padding+chartW-6} y={y+rowH/2+1} fontSize="11" dominantBaseline="middle" textAnchor="end" fill="#475569">
                {ru(r.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {tip && (
        <div style={{position:"absolute",left:tip.x,top:tip.y,background:"#111",color:"#fff",fontSize:12,
                     padding:"6px 8px",borderRadius:6,pointerEvents:"none",whiteSpace:"nowrap",
                     boxShadow:"0 4px 12px rgba(0,0,0,0.2)"}}
             dangerouslySetInnerHTML={{__html:tip.html}}/>
      )}
    </div>
  );
}
