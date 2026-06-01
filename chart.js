/* ==========================================================================
   Shared equirectangular chart builder.
   Used by: map.html (all city pins) · city.html (locator) · profile.html (journey)
   ========================================================================== */

const CONTINENT_LABELS = [
  ["North America",-100,42],["South America",-60,-18],["Europe",18,52],
  ["Africa",20,3],["Asia",95,46],["Oceania",140,-25]
];

/* equirectangular projection -> percentage coords inside the chart box */
const projPct = (lat,lng) => ({ x:(lng+180)/360*100, y:(90-lat)/180*100 });

/* Build a chart inside `host` (a .chart element). Returns helpers.
   opts: { labels:true, stars:true, graticule:true } */
function buildChart(host, opts = {}) {
  const { labels = true, stars = true, graticule = true } = opts;

  // Inner content layer: canvas + svg + labels + pins all live here so a single
  // CSS transform on `inner` zooms/pans the whole map together. Pages that don't
  // zoom (city/profile) simply leave `inner` untransformed.
  const inner = document.createElement("div");
  inner.className = "chart-inner";
  Object.assign(inner.style, { position:"absolute", inset:"0", transformOrigin:"0 0" });
  host.appendChild(inner);

  const cv = document.createElement("canvas");
  inner.appendChild(cv);

  // a dedicated SVG layer for path lines (journeys), under the pins
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 100 100");
  svg.setAttribute("preserveAspectRatio","none");
  Object.assign(svg.style,{ position:"absolute", inset:"0", width:"100%", height:"100%", zIndex:2, pointerEvents:"none" });
  inner.appendChild(svg);

  if (labels) {
    CONTINENT_LABELS.forEach(([t,lng,lat])=>{
      const p = projPct(lat,lng); const el=document.createElement("div");
      el.className="continent-label"; el.textContent=t; el.style.left=p.x+"%"; el.style.top=p.y+"%";
      inner.appendChild(el);
    });
  }

  function draw(){
    const r = host.getBoundingClientRect();
    cv.width = r.width; cv.height = r.height;
    const ctx = cv.getContext("2d"); ctx.clearRect(0,0,cv.width,cv.height);
    if (typeof WORLD_LAND !== "undefined"){
      ctx.fillStyle = "rgba(159,180,216,.075)";
      ctx.strokeStyle = "rgba(159,180,216,.22)";
      ctx.lineWidth = 1; ctx.lineJoin = "round";
      for (const ring of WORLD_LAND){
        ctx.beginPath();
        for (let i=0;i<ring.length;i++){
          const x=(ring[i][0]+180)/360*cv.width, y=(90-ring[i][1])/180*cv.height;
          i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (graticule){
      ctx.lineWidth = 1;
      for(let lng=-180; lng<=180; lng+=30){
        const x=(lng+180)/360*cv.width;
        ctx.strokeStyle = lng===0 ? "rgba(159,180,216,.22)" : "rgba(159,180,216,.08)";
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,cv.height); ctx.stroke();
      }
      for(let lat=-90; lat<=90; lat+=30){
        const y=(90-lat)/180*cv.height;
        ctx.strokeStyle = lat===0 ? "rgba(216,162,76,.22)" : "rgba(159,180,216,.08)";
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cv.width,y); ctx.stroke();
      }
    }
    if (stars){
      ctx.fillStyle="rgba(159,180,216,.10)";
      for(let i=0;i<120;i++){ const x=Math.random()*cv.width,y=Math.random()*cv.height; ctx.beginPath(); ctx.arc(x,y,Math.random()*1.1,0,7); ctx.fill(); }
    }
  }
  draw();
  let raf; window.addEventListener("resize",()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(draw); });

  /* draw a polyline through [{lat,lng}] in order (the journey path) */
  function drawPath(points, { color = "var(--gold)", dash = "2.5 2.5", width = 0.5 } = {}) {
    if (points.length < 2) return;
    const d = points.map((pt,i)=>{ const p=projPct(pt.lat,pt.lng); return `${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`; }).join(" ");
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d", d);
    path.setAttribute("fill","none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-dasharray", dash);
    path.setAttribute("stroke-linecap","round");
    path.setAttribute("stroke-linejoin","round");
    path.setAttribute("opacity","0.7");
    path.setAttribute("vector-effect","non-scaling-stroke");
    path.style.strokeWidth = "1.5px";
    svg.appendChild(path);
    return path;
  }

  return { projPct, draw, drawPath, svg, inner };
}

if (typeof window !== "undefined") Object.assign(window, { buildChart, projPct, CONTINENT_LABELS });
