import { useRef, useState, useLayoutEffect, useEffect } from 'react';
import * as THREE from 'three';

function rng(seed) {
  let x = ((seed + 1) * 16807) % 2147483647;
  return () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
}

// Long overlapping loops: a filled hand-scribbled disk, not a hollow ring.
function scribble(seed) {
  const random = rng(seed);
  let path = '';
  const loops = 7;
  for (let loop = 0; loop < loops; loop++) {
    const cx = 50 + (random() - .5) * 10;
    const cy = 50 + (random() - .5) * 10;
    const rx = 14 + random() * 27;
    const ry = 14 + random() * 27;
    const phase = random() * Math.PI * 2;
    const count = 44;
    for (let i = 0; i <= count; i++) {
      const a = phase + i / count * Math.PI * 2;
      const r = 1 + (random() - .5) * .20;
      const x = cx + Math.cos(a) * rx * r;
      const y = cy + Math.sin(a) * ry * r;
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }
  }
  return path;
}

let scribbleInstanceNumber = 0;

export function ScribbleRing() {
  const paths = useRef([]);
  const unique = useRef(null);
  if (unique.current === null) {
    // A unique seed and animation phase for each button, including buttons
    // created within expanded menus. Avoid synchronized redraws.
    const n = ++scribbleInstanceNumber;
    unique.current = {
      seed: 1037 + n * 9973,
      interval: 172 + ((n * 67) % 151),
      phase: ((n * 127) % 320) / 100,
      duration: 23 + ((n * 79) % 290) / 10,
      delay: -((n * 37) % 240) / 10,
    };
  }
  const config = unique.current;
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame++;
      paths.current.forEach((p, i) => {
        if (p) p.setAttribute('d', scribble(config.seed + frame * 19 + i * 173));
      });
    };
    // Stagger each button's first redraw as well as its repeat interval.
    const timer = window.setInterval(update, config.interval);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <svg className="scribble-ring" viewBox="0 0 100 100" aria-hidden="true"
      style={{ '--scribble-duration': `${config.duration}s`, '--scribble-delay': `${config.delay}s` }}>
      <circle cx="50" cy="50" r="40" fill="white" />
      {[0,1,2,3].map(i => <path key={i} ref={el => { paths.current[i] = el; }}
        d={scribble(config.seed + i * 173 + 1)} fill="none" stroke="currentColor"
        strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

function branchPath(x1,y1,x2,y2,seed) {
  const random = rng(seed);
  const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);
  if (!len) return '';
  const count=Math.max(4,Math.ceil(len/9));
  let d='';
  for(let i=0;i<=count;i++) {
    const t=i/count;
    const wobble=(random()-.5)*5.25*Math.sin(Math.PI*t);
    const x=x1+dx*t-dy/len*wobble;
    const y=y1+dy*t+dx/len*wobble;
    d+=`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d;
}

export function ValueNode({label,value,min=0,max=1,onChange}) {
  const drag=useRef(null);
  const move=e=>{
    const d=drag.current;
    if(!d || d.id!==e.pointerId) return;
    onChange(THREE.MathUtils.clamp(d.value+(d.y-e.clientY)/160*(max-min),min,max));
  };
  const end=e=>{
    if(drag.current?.id!==e.pointerId)return;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current=null;
  };
  return <div className="node-cell">
    <button className="circle-node value-node" role="slider" aria-label={label}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();drag.current={id:e.pointerId,y:e.clientY,value};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={e=>{const step=(max-min)/100;if(['ArrowUp','ArrowRight'].includes(e.key)){e.preventDefault();onChange(Math.min(max,value+step));}if(['ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();onChange(Math.max(min,value-step));}}}>
      <ScribbleRing/><span className="node-content">{value.toFixed(max<=.1?3:2)}</span>
    </button><span className="node-label">{label}</span>
  </div>;
}

export function ColorNode({label,value,onChange}) {
  return <div className="node-cell"><label className="circle-node color-node" title={label}>
    <ScribbleRing/><span className="color-dot" style={{background:value}} />
    <input type="color" value={value} aria-label={label} onPointerDown={e=>e.stopPropagation()} onChange={e=>onChange(e.target.value)}/>
  </label><span className="node-label">{label}</span></div>;
}

// One material node with a base-color circle and a smaller emission circle.
// The inner swatch has its own input, independent from the base color input.
export function MaterialColorNode({ baseColor, emissionColor, onBaseChange, onEmissionChange }) {
  return (
    <div className="node-cell material-color-cell">
      <div className="circle-node material-color-node" title="Base color (outer) / Emission color (inner)">
        <ScribbleRing />
        <span className="material-base-swatch" style={{ background: baseColor }} aria-hidden="true" />
        <input
          className="material-base-input"
          type="color"
          value={baseColor}
          aria-label="Base Color"
          title="Change base color"
          onPointerDown={e => e.stopPropagation()}
          onChange={e => onBaseChange(e.target.value)}
        />
        <span className="material-emission-swatch" style={{ background: emissionColor }}>
          <input
            type="color"
            value={emissionColor}
            aria-label="Emission Color"
            title="Change emission color"
            onPointerDown={e => e.stopPropagation()}
            onChange={e => onEmissionChange(e.target.value)}
          />
        </span>
      </div>
      <span className="node-label">Base / Emission Color</span>
    </div>
  );
}

export function ChoiceNode({label,short,selected,onClick}) {
  return <div className="node-cell"><button className={`circle-node choice-node ${selected?'selected':''}`} title={label} aria-pressed={selected} onClick={onClick}>
    <ScribbleRing/><span className="node-content">{short}</span>
  </button><span className="node-label">{label}</span></div>;
}

export function BranchNetwork({items,columns=3,side='right',className=''}) {
  const networkRef=useRef(null);
  const [branches,setBranches]=useState([]);
  const left=side==='left';
  useLayoutEffect(()=>{
    const network=networkRef.current;
    if(!network)return;
    function update(){
      const cells=[...network.querySelectorAll('.node-cell')];
      const bounds=network.getBoundingClientRect();
      const points=cells.map(cell=>{
        const circle=cell.querySelector('.circle-node');
        if(!circle)return null;
        const r=circle.getBoundingClientRect();
        return {x:r.left-bounds.left+r.width/2,y:r.top-bounds.top+r.height/2,r:r.width/2};
      }).filter(Boolean);
      if(!points.length){setBranches([]);return;}
      const rows=[];
      for(let i=0;i<points.length;i+=columns)rows.push(points.slice(i,i+columns));
      const trunk=left?network.clientWidth+12:-12;
      const center=(rows[0][0].y+rows[rows.length-1][0].y)/2;
      const segments=[[left?network.clientWidth+42:-42,center,trunk,center]];
      if(rows.length>1)segments.push([trunk,rows[0][0].y,trunk,rows[rows.length-1][0].y]);
      rows.forEach(row=>{
        const ordered=left?[...row].reverse():row;
        ordered.forEach((p,i)=>{
          const start=i===0?trunk:(left?ordered[i-1].x-ordered[i-1].r:ordered[i-1].x+ordered[i-1].r);
          const end=left?p.x+p.r:p.x-p.r;
          segments.push([start,p.y,end,p.y]);
        });
      });
      setBranches(segments);
    }
    const observer=new ResizeObserver(update);
    observer.observe(network);
    update();
    return()=>observer.disconnect();
  },[items.length,columns,left]);
  return <div ref={networkRef} className={`node-network ${left?'network-left':''} ${className}`} style={{'--columns':columns}}>
    <svg className="branch-lines" aria-hidden="true">{branches.map((segment,i)=><path key={i} className="scribble-edge" d={branchPath(...segment,i*31+10)}
      style={{ animationDuration: `${0.77 + ((i * 17) % 13) * .093}s`, animationDelay: `${-((i * 29) % 19) / 10}s` }} fill="none" stroke="currentColor" strokeWidth="2.2"/>)}</svg>
    {items.map(item=><div className="network-item" key={item.key}>{item.content}</div>)}
  </div>;
}
