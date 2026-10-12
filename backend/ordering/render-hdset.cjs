// render-hdset.cjs — 几何内核 JSON → HDSet 标准模式「显示屏配置·连接设置」画布 SVG
// 视觉对标真机 HDSet V4.0.38 标准模式，并按用户要求做两处真机做不到的可读性优化：
//   1) 基准取 70% 档（卡格大、字号大、最清晰）；整屏超白区才同比缩小；
//   2) 单卡用「统一可读格」（不按真实像素比例，否则 160×640 竖高卡变细条写不下字），
//      卡内文字主动让出一条走线空白带（卡高 ~46%），红线/方向三角只走这条带，绝不压字；
//      S/E 用透明空心圈（非真机实心圆）+ 圈心字母，首末卡宽高仍可读。
// 真实像素信息一字不丢：卡内宽高=真实像素，右侧面板=整屏/箱体真实像素，底部图例=每口 R 范围/像素/万点/卡数/带载。
// 外层：整屏蓝粗框 + 每个网口分区粗彩边、口内同色，一眼看清每根网线管哪片。
// 纯函数渲染器：不反向依赖 ordering-engine，输入为 topo-hdset 适配器产出的 topology 对象。
"use strict";

const FONT = "'Microsoft YaHei',Arial";
// HDSet 网口经典色板（前4口与真机一致：橙/金/紫/青）
const PORT_COLORS = ["#EF9566","#D8A93A","#B47BC9","#4FB6C2","#E06666","#6FB36B","#6C8FD6","#D98CC4","#7FB3D5","#C9A76B","#9B8CD6","#5BB89A","#E08A5B","#8FBF6A","#5E97D6","#CF7AA8"];
const BLUE="#1E64D6", ICONBLUE="#1f73d0", RED="#E5322D", SGREEN="#27A35F", EPINK="#EC4E7A", LOADCY="#22b8e6";
const pc = i => PORT_COLORS[i % PORT_COLORS.length];
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const nd = v => (Math.round(v*10)/10).toString();
function shade(hex, f){const m=hex.replace("#","");let r=parseInt(m.substr(0,2),16),g=parseInt(m.substr(2,2),16),b=parseInt(m.substr(4,2),16);r=Math.round(r*f);g=Math.round(g*f);b=Math.round(b*f);return `rgb(${r},${g},${b})`;}

// 70% 档统一可读卡格（真机 70% 约 64×78）；行/列号、卡内文字均以此为基准
const BASE_CW=64, BASE_CH=80;
// 卡内纵向排版比例：主动在 0.46 留一条走线空白带（约 0.40~0.52 不放任何字）
const RY={ port:0.15, card:0.30, wire:0.46, width:0.70, height:0.92 };

// 16x16 无底色蓝色线性工具图标（近似 HDSet）
function ICO(name,x,y,c){
  const s=c||ICONBLUE,g=`fill="none" stroke="${s}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  switch(name){
    case "save":   return `<path d="M${x+3} ${y+2} H${x+13} V${y+14} H${x+3} Z" ${g}/><path d="M${x+5.5} ${y+2} V${y+7} H${x+11} V${y+2} M${x+5.5} ${y+10.5} H${x+10.5}" ${g}/>`;
    case "cloud":  return `<path d="M${x+4.5} ${y+12} a3 3 0 0 1 .5-6 4 4 0 0 1 7.5 1.2 2.6 2.6 0 0 1-.5 4.8 Z" ${g}/>`;
    case "pencil": return `<path d="M${x+3.5} ${y+12.5} L${x+11} ${y+5} L${x+13} ${y+7} L${x+5.5} ${y+14} Z M${x+11} ${y+5} L${x+12.5} ${y+3.5} L${x+14.5} ${y+5.5} L${x+13} ${y+7}" ${g}/>`;
    case "undo":   return `<path d="M${x+13} ${y+11} a4.5 4.5 0 1 0-1 2 M${x+4} ${y+8} L${x+4} ${y+3.5} L${x+8.5} ${y+5.5}" ${g}/>`;
    case "redo":   return `<path d="M${x+3} ${y+11} a4.5 4.5 0 1 1 1 2 M${x+12} ${y+8} L${x+12} ${y+3.5} L${x+7.5} ${y+5.5}" ${g}/>`;
    case "eye":    return `<path d="M${x+2} ${y+8} Q${x+8} ${y+3} ${x+14} ${y+8} Q${x+8} ${y+13} ${x+2} ${y+8} Z" ${g}/><circle cx="${x+8}" cy="${y+8}" r="2" ${g}/>`;
    case "grid":   return `<rect x="${x+3}" y="${y+3}" width="${10}" height="${10}" ${g}/><path d="M${x+8} ${y+3} V${y+13} M${x+3} ${y+8} H${x+13}" ${g}/>`;
    default: return "";
  }
}

function render(t, meta) {
  meta = meta || {};
  const W=t.screen.w,H=t.screen.h,ports=t.ports,cards=t.cards,cols=t.grid.cols,rows=t.grid.rows;
  const portN=ports.length;
  // 版面
  const VW=1400, VH=940, OX=24, OY=118, CW=1078, CH=778;
  const panelX=1120, panelW=262, TOP=OY;
  const gx=OX+26, gy=OY+26;

  // 底部图例预留高度（每口一项、两列）
  const legRowsN=Math.max(1, Math.ceil(portN/2));
  const LEG_H=26+legRowsN*20+10;
  // 70% 基准；整屏超白区同比缩小（绝不放大铺满）
  const s=Math.min((CW-72)/(cols*BASE_CW), (CH-44-LEG_H)/(rows*BASE_CH), 1);
  const cw=BASE_CW*s, ch=BASE_CH*s;
  const ZLABEL=s>=0.99?"70%":Math.round(70*s)+"%";
  const lx=gx, ly=gy;
  const lw=cols*cw, lh=rows*ch;
  const R=(cd,rk)=>{ const r=rk; return {x:lx+cd.col*cw, y:ly+cd.row*ch, w:cw-1.5, h:ch-1.5}; };
  const rectOf=cd=>({x:lx+cd.col*cw, y:ly+cd.row*ch, w:cw-1.5, h:ch-1.5});
  const wireY=cd=>ly+cd.row*ch+ch*RY.wire;
  // 全局接收卡 R 号：按网口级联连续编号（口1 R1..Rn，口2 接 Rn+1..），口内沿蛇形 S→E
  const portOffset={}; let __acc=0;
  ports.forEach(p=>{portOffset[p.id]=__acc; __acc+=p.cardCount;});
  const globalR=cd=>portOffset[cd.port]+cd.seqInPort+1;

  const P=[];
  P.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}" font-family="${FONT}">`);
  P.push(`<rect width="${VW}" height="${VH}" fill="#eef0f3"/>`);

  // ===== 标题栏 =====
  P.push(`<rect x="0" y="0" width="${VW}" height="26" fill="#f6f7f9"/>`);
  P.push(`<rect x="8" y="6" width="14" height="14" rx="2" fill="${ICONBLUE}"/>`);
  P.push(`<text x="28" y="17" font-size="12.5" fill="#333">显示屏配置</text>`);
  // tab
  P.push(`<rect x="0" y="26" width="${VW}" height="26" fill="#ffffff" stroke="#d8d8d8"/>`);
  const tabs=["发送卡参数","接收卡参数","连接设置（从显示屏正面看）"];
  let tx=8;
  tabs.forEach((tb,i)=>{const w=[92,92,232][i];const on=i===2;
    P.push(`<rect x="${tx}" y="28" width="${w}" height="22" fill="${on?"#ffffff":"#f1f2f4"}" stroke="${on?"#c9c9c9":"#dddddd"}"/>`);
    P.push(`<text x="${tx+w/2}" y="43" font-size="12.5" text-anchor="middle" fill="${on?"#222":"#666"}">${tb}</text>`);
    tx+=w+2;});
  // 屏幕类型
  P.push(`<text x="10" y="72" font-size="13" fill="#333">屏幕类型</text>`);
  P.push(`<circle cx="118" cy="68" r="6.5" fill="#fff" stroke="${ICONBLUE}" stroke-width="1.6"/><circle cx="118" cy="68" r="3" fill="${ICONBLUE}"/><text x="131" y="73" font-size="12.5" fill="#333">标准模式</text>`);
  P.push(`<circle cx="210" cy="68" r="6.5" fill="#fff" stroke="#9a9a9a" stroke-width="1.4"/><text x="223" y="73" font-size="12.5" fill="#444">复杂模式</text>`);

  // ===== 单行工具条 =====
  const TY=96;
  [["save",ICONBLUE],["cloud",ICONBLUE],["pencil",ICONBLUE],["undo",ICONBLUE],["redo","#b3b3b3"],["eye",ICONBLUE],["grid",ICONBLUE]].forEach((ic,i)=>{
    P.push(ICO(ic[0], 24+i*28, TY, ic[1]));
  });
  P.push(`<path d="M${24+3*28+20} ${TY-2} V${TY+16}" stroke="#d0d0d0"/>`);
  P.push(`<path d="M${24+2*28+13} ${TY+12} l3 0 l-1.5 2.4 Z" fill="#333"/>`);
  const chk=(x,label,checked,zx)=>{
    if(checked){P.push(`<rect x="${x}" y="${TY-1}" width="13" height="13" rx="2" fill="${ICONBLUE}"/><path d="M${x+2.5} ${TY+5.5} l2.5 2.6 l5 -6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`);}
    else{P.push(`<rect x="${x}" y="${TY-1}" width="13" height="13" rx="2" fill="#fff" stroke="#9a9a9a"/>`);}
    P.push(`<text x="${x+17}" y="${TY+10}" font-size="12" fill="#444">${label}</text>`);
    return x+17+label.length*12+(zx||6);
  };
  const combo=(x,text,w)=>{P.push(`<rect x="${x}" y="${TY-3}" width="${w}" height="17" fill="#fff" stroke="#c2c2c2"/>`);
    P.push(`<text x="${x+6}" y="${TY+9}" font-size="11.5" fill="#333">${text}</text>`);
    P.push(`<path d="M${x+w-11} ${TY+3} l5 0 l-2.5 3 Z" fill="#444"/>`);return x+w+10;};
  let cxT=236;
  P.push(`<text x="${cxT}" y="${TY+10}" font-size="12" fill="#444">交换：</text>`);cxT+=42;
  cxT=combo(cxT,"无",52);
  P.push(`<text x="${cxT}" y="${TY+10}" font-size="12" fill="#444">追加：</text>`);cxT+=42;
  cxT=combo(cxT,"无",52);
  cxT=chk(cxT,"显示走线",true,8);
  cxT=combo(cxT,ZLABEL,52);
  cxT=chk(cxT,"吸附",true,8);
  chk(cxT,"接收卡参数",false,0);

  // ===== 画布白区 + 淡逻辑网格（与统一卡格对齐）=====
  P.push(`<rect x="${OX-1}" y="${OY-1}" width="${CW+2}" height="${CH+2}" fill="#ffffff" stroke="#b9b9b9"/>`);
  if(cw>=18){
    for(let c=0;c<=cols;c++){const xx=lx+c*cw;
      P.push(`<line x1="${nd(xx)}" y1="${ly}" x2="${nd(xx)}" y2="${nd(ly+lh)}" stroke="#ececec" stroke-dasharray="1,4"/>`);}
    for(let r2=0;r2<=rows;r2++){const yy=ly+r2*ch;
      P.push(`<line x1="${lx}" y1="${nd(yy)}" x2="${nd(lx+lw)}" y2="${nd(yy)}" stroke="#ececec" stroke-dasharray="1,4"/>`);}
  }
  if(cw>=20){for(let c=0;c<cols;c++)P.push(`<text x="${nd(lx+c*cw+cw/2)}" y="${ly-7}" font-size="10" text-anchor="middle" fill="#a9a9a9">${c+1}</text>`);}
  if(ch>=20){for(let r2=0;r2<rows;r2++)P.push(`<text x="${lx-9}" y="${nd(ly+r2*ch+ch/2+3.5)}" font-size="10" text-anchor="middle" fill="#a9a9a9">${r2+1}</text>`);}
  P.push(`<polygon points="${lx},${ly} ${lx+9},${ly} ${lx},${ly+9}" fill="#bdbdbd"/>`);

  // ===== 卡填充（口内同色）=====
  cards.forEach(cd=>{
    const r=rectOf(cd);
    P.push(`<rect x="${nd(r.x)}" y="${nd(r.y)}" width="${nd(r.w)}" height="${nd(r.h)}" fill="${pc(cd.port-1)}" stroke="${shade(pc(cd.port-1),0.72)}" stroke-width="1"/>`);
  });

  // ===== 每个网口分区：粗彩边描分界 =====
  ports.forEach(p=>{
    let c0=1e9,c1=-1,r0=1e9,r1=-1;
    p.cardIdx.forEach(i=>{const c=cards[i];c0=Math.min(c0,c.col);c1=Math.max(c1,c.col);r0=Math.min(r0,c.row);r1=Math.max(r1,c.row);});
    const x=lx+c0*cw-1.5, y=ly+r0*ch-1.5, w=(c1-c0+1)*cw+1.5, h=(r1-r0+1)*ch+1.5;
    P.push(`<rect x="${nd(x)}" y="${nd(y)}" width="${nd(w)}" height="${nd(h)}" fill="none" stroke="${shade(pc(p.id-1),0.42)}" stroke-width="2.6"/>`);
  });
  // ===== 整屏蓝粗框 =====
  P.push(`<rect x="${nd(lx-1.5)}" y="${nd(ly-1.5)}" width="${nd(lw+1.5)}" height="${nd(lh+1.5)}" fill="none" stroke="${BLUE}" stroke-width="2"/>`);

  // ===== 红色蛇形走线（只走卡内 0.46 留白带，半透明，不压字）=====
  ports.forEach(p=>{
    const ids=p.cardIdx, pts=[];
    ids.forEach((ci,k)=>{
      const cd=cards[ci], r=rectOf(cd);
      const cy=ly+cd.row*ch+ch*RY.wire, cx=r.x+r.w/2;
      if(k>0){const prev=cards[ids[k-1]], pr=rectOf(prev);
        if(prev.row!==cd.row){
          const pcy=ly+prev.row*ch+ch*RY.wire;
          const edgeX=cd.col<prev.col ? Math.max(pr.x+pr.w, r.x+r.w) : Math.min(pr.x, r.x);
          pts.push([edgeX,pcy]); pts.push([edgeX,cy]);
        }}
      pts.push([cx,cy]);
    });
    if(pts.length>1)P.push(`<polyline points="${pts.map(q=>nd(q[0])+","+nd(q[1])).join(" ")}" fill="none" stroke="${RED}" stroke-width="2.3" stroke-opacity="0.92" stroke-linejoin="round" stroke-linecap="round"/>`);

    // 蓝色方向三角：每段走线一个（横段在 to 卡入缘，折行竖段向下），对齐真机
    const bs=Math.max(3.5,Math.min(cw,ch)*0.075);
    for(let k=1;k<ids.length;k++){
      const prev=cards[ids[k-1]], cd=cards[ids[k]];
      const cy=ly+cd.row*ch+ch*RY.wire;
      if(prev.row!==cd.row){
        const pr=rectOf(prev), cr=rectOf(cd);
        const pcy=ly+prev.row*ch+ch*RY.wire;
        const edgeX=cd.col<prev.col ? Math.max(pr.x+pr.w,cr.x+cr.w) : Math.min(pr.x,cr.x);
        const mY=(pcy+cy)/2;
        P.push(`<polygon points="${nd(edgeX-bs)},${nd(mY-bs)} ${nd(edgeX+bs)},${nd(mY-bs)} ${nd(edgeX)},${nd(mY+bs+1)}" fill="${BLUE}"/>`);
      } else {
        const cr=rectOf(cd);
        const dir=cd.col>prev.col?1:-1;
        const tx=cr.x+cr.w/2-dir*cw*0.34;
        if(dir>0) P.push(`<polygon points="${nd(tx-bs)},${nd(cy-bs)} ${nd(tx-bs)},${nd(cy+bs)} ${nd(tx+bs+1)},${nd(cy)}" fill="${BLUE}"/>`);
        else P.push(`<polygon points="${nd(tx+bs)},${nd(cy-bs)} ${nd(tx+bs)},${nd(cy+bs)} ${nd(tx-bs-1)},${nd(cy)}" fill="${BLUE}"/>`);
      }
    }  });

  // ===== S/E 透明空心圈（圈心在走线带，不遮宽高）=====
  // 整屏首口首卡=走线起点、末口尾卡=终点，保留大圈+「首/尾」汉字；
  // 口间交界处（前口尾卡/后口首卡相邻）只画小色圈不写字，避免「尾/首」两圈叠字。
  const gStart=ports[0].sCard, gEnd=ports[ports.length-1].eCard;
  ports.forEach(p=>{
    [[p.sCard,SGREEN,"S","首"],[p.eCard,EPINK,"E","尾"]].forEach(([ci,col,ch2,han])=>{
      const cd=cards[ci], r=rectOf(cd);
      const isGlobal=(ch2==="S"&&ci===gStart)||(ch2==="E"&&ci===gEnd);
      const cx=r.x+cw*(ch2==="S"?0.16:0.84), cy=ly+cd.row*ch+ch*RY.wire;
      const rad=isGlobal?Math.max(6,Math.min(cw,ch)*0.18):Math.max(3.5,Math.min(cw,ch)*0.105);
      P.push(`<circle cx="${nd(cx)}" cy="${nd(cy)}" r="${nd(rad)}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="${isGlobal?2.3:1.6}"/>`);
      if(isGlobal&&rad>=8.5)
        P.push(`<text x="${nd(cx)}" y="${nd(cy)}" font-size="${nd(rad*1.34)}" text-anchor="middle" dominant-baseline="central" fill="${col}" font-weight="800">${han}</text>`);
    });
  });

  // ===== 卡内文字（最后画，最上层；走线带 0.46 留白）=====
  const fsPort=Math.max(7.5,Math.min(11,cw/5.9)), fsWH=Math.max(6.8,Math.min(10.6,cw/6.0)), fsCard=Math.max(8.5,Math.min(14,cw/4.6));
  cards.forEach(cd=>{
    const r=rectOf(cd);
    const isSE=cd.role!=="M";
    const txt=(yy,fs,col,bold,t)=>P.push(`<text x="${nd(r.x+r.w/2)}" y="${nd(r.y+ch*yy)}" font-size="${nd(fs)}" text-anchor="middle" fill="${col}" ${bold?'font-weight="700"':''}>${t}</text>`);
    if(cw>=66){
      // 对齐真机卡面四行：网口:N(小号灰字) / 卡:N(加粗) / 宽度 / 高度，走线 0.46 穿中不压字
      txt(RY.port,fsPort,"#555",false,`网口:${cd.port}`);
      txt(RY.card,fsCard,"#1a1a1a",true,`卡:${cd.seqInPort+1}`);
      txt(RY.width,fsWH,"#1a1a1a",false,`宽度:${cd.w}`);
      txt(RY.height,fsWH,"#1a1a1a",false,`高度:${cd.h}`);
    } else if(cw>=40){
      txt(0.30,fsCard,"#1a1a1a",true,`卡:${cd.seqInPort+1}`);
      txt(0.68,fsWH,"#1a1a1a",false,`宽:${cd.w}`);
      txt(0.90,fsWH,"#1a1a1a",false,`高:${cd.h}`);
    } else if(cw>=22){
      txt(0.60,Math.max(8,fsCard),"#1a1a1a",true,`${cd.seqInPort+1}`);
    } else {
      // 极窄竖带：数字竖排
      if(!isSE){const ds=String(cd.seqInPort+1).split(""),vfs=Math.max(6,Math.min(10,ch/(ds.length+1))),y0=r.y+r.h/2-(ds.length-1)*vfs/2;
        ds.forEach((d2,i)=>P.push(`<text x="${nd(r.x+r.w/2)}" y="${nd(y0+i*vfs)}" font-size="${nd(vfs)}" text-anchor="middle" fill="#1a1a1a" font-weight="700">${d2}</text>`));}
    }
  });

  // ===== 底部图例：每口 R 范围 / 像素 / 万点 / 卡数 / 带载（完整信息兜底）=====
  const legX=OX+12, legY=ly+lh+28, legW=CW-24, legH=LEG_H-8;
  P.push(`<rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" rx="4" fill="#fafbfc" stroke="#dcdfe4"/>`);
  P.push(`<text x="${legX+12}" y="${legY+18}" font-size="12" font-weight="700" fill="#333">网口分配（走线 首→尾：绿圈=首卡起点，粉圈=尾卡终点；R=接收卡全局序号）</text>`);
  const colW=(legW-24)/2;
  ports.forEach((p,i)=>{
    const cl=i%2, rrn=Math.floor(i/2);
    const bx=legX+12+cl*colW, by=legY+36+rrn*20;
    const first=cards[p.cardIdx[0]], last=cards[p.cardIdx[p.cardIdx.length-1]];
    const rA=globalR(first), rB=globalR(last);
    const wan=((p.points||p.pxW*p.pxH)/10000);
    const over=p.loadPct>100;
    P.push(`<rect x="${bx}" y="${by-10}" width="13" height="11" rx="2" fill="${pc(p.id-1)}" stroke="${shade(pc(p.id-1),0.5)}"/>`);
    P.push(`<text x="${bx+19}" y="${by}" font-size="11.5" font-weight="700" fill="#333">网口${p.id}</text>`);
    P.push(`<text x="${bx+66}" y="${by}" font-size="11.5" fill="#444">R${rA}→R${rB}</text>`);
    P.push(`<text x="${bx+128}" y="${by}" font-size="11.5" fill="#444">${p.pxW}×${p.pxH}</text>`);
    P.push(`<text x="${bx+196}" y="${by}" font-size="11.5" fill="#444">${wan>=10?Math.round(wan):wan.toFixed(1)}万点</text>`);
    P.push(`<text x="${bx+248}" y="${by}" font-size="11.5" fill="#444">${p.cardCount}张</text>`);
    P.push(`<text x="${bx+286}" y="${by}" font-size="11.5" font-weight="700" fill="${over?"#e23c3c":"#1f8a9e"}">${Math.floor(p.loadPct)}%</text>`);
  });

  // ================= 右侧面板 =================
  const L=panelX+12, RW=panelW-24;
  P.push(`<rect x="${panelX}" y="${TOP-2}" width="${panelW}" height="${VH-TOP-38}" fill="#f4f5f7" stroke="#cfcfcf"/>`);
  const group=(gy0,gh,title)=>{
    P.push(`<rect x="${panelX+10}" y="${gy0}" width="${panelW-20}" height="${gh}" fill="none" stroke="#cfcfcf"/>`);
    P.push(`<rect x="${panelX+16}" y="${gy0-8}" width="${title.length*13+8}" height="15" fill="#f4f5f7"/>`);
    P.push(`<text x="${panelX+20}" y="${gy0+3.5}" font-size="12.5" font-weight="700" fill="#333">${title}</text>`);
  };
  const inp=(x,y,w,val)=>{
    P.push(`<rect x="${x}" y="${y}" width="${w}" height="21" fill="#fff" stroke="#c6c6c6"/>`);
    P.push(`<text x="${x+w/2}" y="${y+15}" font-size="12" text-anchor="middle" fill="#222">${val}</text>`);
    P.push(`<rect x="${x+w}" y="${y}" width="15" height="21" fill="#f1f2f4" stroke="#c6c6c6"/><path d="M${x+w+4.5} ${y+7} l6 0 l-3 3 Z M${x+w+4.5} ${y+14} l6 0 l-3 -3 Z" fill="#555"/>`);
  };
  const btn=(x,y,w,h,txt,style)=>{
    const fill=style==="blue"?"#1f73d0":"#ffffff",col=style==="blue"?"#fff":"#333",dis=style==="dis";
    P.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${dis?"#e9eaec":fill}" stroke="${dis?"#d4d4d4":"#c4c4c4"}"/>`);
    P.push(`<text x="${x+w/2}" y="${y+h/2+4.5}" font-size="12" text-anchor="middle" fill="${dis?"#a4a4a4":col}">${txt}</text>`);
  };
  let py=TOP+16;
  // 网口（>4 口显示前3 + 余N）
  P.push(`<text x="${L}" y="${py}" font-size="13" font-weight="700" fill="#333">网口</text>`);
  const showP=Math.min(portN,4), bw=52,bh=28,gap=8;
  for(let i=0;i<showP;i++){const bx=L+i*(bw+gap),byy=py+10;const used=!!ports[i];const col=used?pc(i):"#e3e3e3";
    if(i===0)P.push(`<rect x="${bx-3}" y="${byy-3}" width="${bw+6}" height="${bh+6}" rx="4" fill="none" stroke="${ICONBLUE}" stroke-width="1.6"/>`);
    P.push(`<rect x="${bx}" y="${byy}" width="${bw}" height="${bh}" rx="5" fill="${col}" stroke="#bdbdbd"/>`);
    P.push(`<text x="${bx+bw/2}" y="${byy+bh/2+5}" font-size="15" text-anchor="middle" fill="${used?"#3a2a12":"#9a9a9a"}" font-weight="700">${i+1}</text>`);
    if(i===0)P.push(`<circle cx="${bx+bw-7}" cy="${byy+7}" r="4.5" fill="#37c037" stroke="#fff" stroke-width="1"/>`);
  }
  if(portN>4)P.push(`<text x="${L+3*(bw+gap)+6}" y="${py+30}" font-size="12" fill="#888">+${portN-3}口…</text>`);
  py+=bh+30;
  P.push(`<circle cx="${L+6}" cy="${py-4}" r="6.5" fill="#fff" stroke="${ICONBLUE}" stroke-width="1.6"/><circle cx="${L+6}" cy="${py-4}" r="3" fill="${ICONBLUE}"/><text x="${L+19}" y="${py}" font-size="12.5" fill="#333">常规箱体</text>`);
  P.push(`<circle cx="${L+132}" cy="${py-4}" r="6.5" fill="#fff" stroke="#9a9a9a"/><text x="${L+145}" y="${py}" font-size="12.5" fill="#555">箱体&amp;参数</text>`);
  py+=20;
  btn(L,py,RW,28,"⇩  回读");
  // 当前信息（真实像素）
  const p1=ports[0];
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  p1.cardIdx.forEach(i=>{const c=cards[i];minX=Math.min(minX,c.x);minY=Math.min(minY,c.y);maxX=Math.max(maxX,c.x+c.w);maxY=Math.max(maxY,c.y+c.h);});
  const g1=py+42; group(g1,126,"当前信息");
  inp(L+34,g1+16,58,(p1.c1-p1.c0)); P.push(`<text x="${L}" y="${g1+31}" font-size="12.5" fill="#333">水平</text>`);
  inp(L+150,g1+16,60,rows); P.push(`<text x="${L+108}" y="${g1+31}" font-size="12.5" fill="#333">垂直</text>`);
  inp(L+34,g1+50,68,Math.round(maxX-minX)); P.push(`<text x="${L}" y="${g1+65}" font-size="12.5" fill="#333">宽</text>`);
  inp(L+150,g1+50,70,Math.round(maxY-minY)); P.push(`<text x="${L+124}" y="${g1+65}" font-size="12.5" fill="#333">高</text>`);
  btn(L,g1+88,RW,26,"清除所有连接");
  // 箱体信息（首卡真实像素）
  const sCard=cards[p1.sCard];
  const g2=g1+138; group(g2,128,"箱体信息");
  inp(L+34,g2+16,70,sCard.w); P.push(`<text x="${L}" y="${g2+31}" font-size="12.5" fill="#333">宽</text>`);
  btn(L+128,g2+15,RW-128,22,"应用到整列");
  P.push(ICO("undo",L+44,g2+48,ICONBLUE)); btn(L+128,g2+47,RW-128,22,"应用到全部");
  inp(L+34,g2+80,70,sCard.h); P.push(`<text x="${L}" y="${g2+95}" font-size="12.5" fill="#333">高</text>`);
  btn(L+128,g2+79,RW-128,22,"应用到整行");
  // 快速设置
  const g3=g2+140; group(g3,100,"快速设置");
  const qx=L+8,qy=g3+18,qw=RW-16,qh=66;
  P.push(`<rect x="${qx}" y="${qy}" width="${qw}" height="${qh}" rx="3" fill="#fff" stroke="#d2d2d2"/>`);
  P.push(`<path d="M${qx+4} ${qy+qh/2-5} l0 10 l-4 -5 Z M${qx+qw-4} ${qy+qh/2-5} l0 10 l4 -5 Z" fill="${ICONBLUE}"/>`);
  const qsym=["⇄","⇆","S","Z","⇵","U","∩","∪"];
  qsym.forEach((s2,i)=>{const col=i%4,rr=Math.floor(i/4);const ccx=qx+20+col*((qw-40)/4)+((qw-40)/8);const ccy=qy+18+rr*32;
    P.push(`<text x="${nd(ccx)}" y="${nd(ccy+6)}" font-size="19" text-anchor="middle" fill="${ICONBLUE}">${s2}</text>`);});
  // 负载视图（4 口内逐口；>4 口权威见图例）
  const g4=g3+112; group(g4,210,"负载视图（双击可查看详情）");
  const ax=L+30, aw=RW-50, slotH=30, baseY=g4+24;
  const loadSlots=Math.max(1,Math.min(portN,4));
  for(let i=0;i<loadSlots;i++){const k=loadSlots-i;const pp=ports[k-1];const load=pp?pp.loadPct:null;const over=load!=null&&load>100;
    const ry=baseY+i*slotH;
    P.push(`<text x="${ax-10}" y="${ry+15}" font-size="11" text-anchor="end" fill="#555">${k}</text>`);
    if(load!=null){
      const bw2=Math.max(0,Math.min(1,load/100))*aw;
      if(bw2>1)P.push(`<rect x="${ax}" y="${ry+5}" width="${nd(bw2)}" height="15" fill="${over?"#e23c3c":LOADCY}"/>`);
      P.push(`<text x="${nd(ax+Math.max(bw2,2)+(bw2<1?2:5))}" y="${ry+17}" font-size="10.5" fill="${over?"#e23c3c":"#444"}">${Math.floor(load)}%</text>`);
    }
  }
  if(portN>4)P.push(`<text x="${L}" y="${baseY+loadSlots*slotH+14}" font-size="10.5" fill="#888">共${portN}口，余口详见下图例</text>`);
  P.push(`<path d="M${ax} ${baseY-4} V${baseY+loadSlots*slotH-12} H${ax+aw}" fill="none" stroke="${LOADCY}" stroke-width="3"/>`);
  [0,50,100].forEach(pct=>{const xx=ax+aw*pct/100;P.push(`<text x="${nd(xx)}" y="${baseY+loadSlots*slotH+6}" font-size="10" text-anchor="middle" fill="#888">${pct}%</text>`);});

  // ===== 底部按钮条 =====
  const bby=VH-36;
  P.push(`<rect x="0" y="${bby}" width="${VW}" height="36" fill="#eceef1" stroke="#cfcfcf"/>`);
  const bdefs=[["导出（*.ssm）","dis"],["升级字库文件","dis"],["导出到U盘","dis"],["隐藏工具栏","n"],["导入","n"],["导出","n"],["发送 &amp; 固化","blue"]];
  let bxx=VW-24;
  for(let i=bdefs.length-1;i>=0;i--){const b=bdefs[i];const w=b[0].replace(/&amp;/g,"&").length*13+26;bxx-=w;
    btn(bxx,bby+6,w,24,b[0],b[1]);bxx-=8;}

  P.push(`</svg>`);
  return P.join("");
}

module.exports = { render, PORT_COLORS, pc, shade, nd, esc, BASE_CW, BASE_CH, RY, FONT, BLUE, RED, SGREEN, EPINK };
