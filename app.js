/* ================= 管道数据查询 · 移动版 ================= */
(function(){
'use strict';

let P = window.PIPELINE_DATA || {cols:[],rows:[]};   // 可被云端下发的数据覆盖
let S = window.SUPPORT_DATA  || {cols:[],rows:[]};
let V = window.VALVE_DATA    || {cols:[],rows:[]};
const WALL = window.WALL_DATA || [];
const WALL_CODES = window.WALL_CODES || [];

// 接口基址：网页版自动用当前域名；APK 内用「设置」里填写的正式域名
function apiOrigin(){
  let b = (localStorage.getItem('pipeApiBase')||'').trim();
  if(!b && window.APP_CONFIG) b = String(window.APP_CONFIG.apiBase||'').trim();
  b = b.replace(/\/+$/,'');
  if(b) return b;
  if(/^https?:$/.test(location.protocol)) return location.origin;
  return '';   // APK 未配置服务器地址
}
function apiUrl(path, extra){
  const base = apiOrigin();
  if(!base) return '';
  const out = new URLSearchParams();
  // 预览链接的 eo_token 只在同域访问时才需要透传
  if(base === location.origin){
    try{
      const q = new URLSearchParams(location.search);
      const t = q.get('eo_token'), tm = q.get('eo_time');
      if(t) out.set('eo_token', t);
      if(tm) out.set('eo_time', tm);
    }catch(e){}
  }
  if(extra) Object.keys(extra).forEach(k=>out.set(k, extra[k]));
  const s = out.toString();
  return base + path + (s ? '?' + s : '');
}

// 云端备注 API（EdgeOne Pages Function /api/notes）
let cloudReady = false;
function notesUrl(extra){ return apiUrl('/api/notes', extra); }
async function initCloud(){
  const u = notesUrl();
  if(!u){ cloudReady = false; return false; }   // 未配置服务器地址，离线运行
  try{
    const res = await fetch(u, { method:'GET' });
    if(res.ok){ const j = await res.json(); cloudReady = !!(j && j.ok); return cloudReady; }
  }catch(e){ /* 无 API，离线模式 */ }
  cloudReady = false;
  return false;
}

const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ci = (ds,col) => ds.cols.indexOf(col);
const val = (row,ds,col) => { const i=ci(ds,col); return i<0?'':(row[i]==null?'':row[i]); };
const LIMIT = 200; // 列表最多显示条数

// 从图纸号提取子项号: GCC-XXX-DDD-12600-12-3307-TKM-ISO-xxxx -> 12600-12-3307
function subNo(iso){
  const m = String(iso||'').match(/-([0-9]{4,6}-[0-9]{2,4}-[0-9]{3,4})-/);
  return m ? m[1] : (String(iso||'').match(/DDD-([0-9]+-[0-9]+-[0-9]+)/)||[])[1] || '';
}

// 索引
const idx = {};
function buildIndex(){
  idx.pLine   = ci(P,'管线号');
  idx.pArea   = ci(P,'区域');
  idx.pIso    = ci(P,'图纸号');
  idx.pT1     = ci(P,'厚度1');
  idx.pT2     = ci(P,'厚度2');
  idx.pWeld   = ci(P,'焊缝编号');
  idx.pSize   = ci(P,'尺寸');
  idx.pWeldDate = ci(P,'焊接日期');
  idx.pZone   = ci(P,'工区号');
  idx.pWelder = ci(P,'焊工号根层');
  idx.pFS     = ci(P,'安装/F预制/S');
  idx.sArea   = ci(S,'区域');
  idx.sIso    = ci(S,'图号');
  idx.sLine   = ci(S,'文件编号 (管线号)');
  idx.sNo     = ci(S,'支架编号');
  idx.sInstDate = ci(S,'安装日期');
  idx.sWeight  = ci(S,'单重kg');
  idx.vArea   = ci(V,'单元号');
  idx.vIso    = ci(V,'图纸编号');
  idx.vLine   = ci(V,'管线号');
  idx.vCode   = ci(V,'阀门识别代码');
  idx.vName   = ci(V,'阀门名称');
  idx.vInstDate = ci(V,'法兰型阀门安装日期');
  // 图号 -> 索引
  idx.iso = { P:{}, S:{}, V:{} };
  [['P',P,idx.pIso],['S',S,idx.sIso],['V',V,idx.vIso]].forEach(([k,ds,col])=>{
    if(col<0) return;
    ds.rows.forEach((r,i)=>{ const g=(r[col]||'').trim(); if(g){(idx.iso[k][g]||(idx.iso[k][g]=[])).push(i);} });
  });
  // 区域集合
  idx.areas = [...new Set(P.rows.map(r=>(r[idx.pArea]||'').trim()).filter(Boolean))].sort();
  idx.sAreas= [...new Set(S.rows.map(r=>(r[idx.sArea]||'').trim()).filter(Boolean))].sort();
  idx.vAreas= [...new Set(V.rows.map(r=>(r[idx.vArea]||'').trim()).filter(Boolean))].sort();
  // 厚度集合
  const tset = new Set();
  P.rows.forEach(r=>{ [r[idx.pT1],r[idx.pT2]].forEach(t=>{ const s=(t||'').trim(); if(s) tset.add(s); }); });
  idx.thicks = [...tset].sort((a,b)=>parseFloat(a)-parseFloat(b));
}

function fillSelect(el, arr, allLabel){
  el.innerHTML = `<option value="">${allLabel||'全部'}</option>` + arr.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
}

/* ---------- 页面切换 ---------- */
const TITLES = {work:'工作量',pipeline:'管线',support:'支架',valve:'阀门',thick:'壁厚'};
function switchPage(page){
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.page===page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-'+page).classList.add('active');
  $('pageTitle').textContent = TITLES[page]||'';
  $('topRight').style.visibility = (page==='work')?'hidden':'visible';
  // 支架页蓝色 / 阀门页青色主题
  document.body.classList.toggle('blue-theme', page==='support');
  document.body.classList.toggle('teal-theme', page==='valve');
  window.scrollTo(0,0);
  if(page==='work') renderWork();
}

/* ---------- 管线查询 ---------- */
// 管线查询结果：按图号聚合成详细卡片（截图样式）
function pipeCards(rowsIdx){
  const grp = {}; // 图号 -> {iso, line, ver, rt, welds, rows, sample}
  rowsIdx.forEach(i=>{
    const r=P.rows[i];
    const iso=(r[idx.pIso]||'').trim();
    const key=iso||('__noidx_'+i);
    let g=grp[key];
    if(!g){
      g=grp[key]={ iso, line:val(r,P,'图纸管线号')||val(r,P,'管线号'),
        ver:val(r,P,'版本号'), rt:val(r,P,'RT比例'), welds:[], rows:[], sample:i };
    }
    g.rows.push(i);
    const w=(r[idx.pWeld]||'').trim();
    if(w && g.welds.indexOf(w)<0) g.welds.push(w);
  });
  const keys=Object.keys(grp);
  let html=`<div class="found-bar">📌 找到 <b>${keys.length}</b> 条结果</div>`;
  keys.forEach(k=>{
    const g=grp[k];
    const sub=subNo(g.iso);
    const ns=(idx.iso.S[g.iso]||[]).length;
    const nv=(idx.iso.V[g.iso]||[]).length;
    const weldsHtml=g.welds.length
      ? g.welds.map(w=>{
          // 只取本图号(本管线)范围内、焊缝编号等于 w 的行
          const rows=g.rows.filter(i=>(P.rows[i][idx.pWeld]||'').trim()===w).join(',');
          return `<span class="weld-chip" data-weld="${esc(w)}" data-rows="${rows}">${esc(w)} <span class="glass">🔍</span></span>`;
        }).join('')
      : '<span class="weld-none">无已焊接焊口</span>';
    html+=`<div class="pipe-card" data-i="${g.sample}">
      <div class="pc-head">
        <div class="pc-line"><span class="pc-label">子项号</span><span class="pc-value">${esc(sub)||'—'}</span></div>
        <div class="pc-line"><span class="pc-label">管线号</span>
          <span class="pc-value pipe-no" data-copy="${esc(g.line)}">${esc(g.line)||'—'}</span>
          <button class="mini-btn ${ns?'':'zero'}" data-rel="support" data-iso="${esc(g.iso)}" data-line="${esc(g.line)}">📊 所有支架状态</button>
        </div>
        <div class="pc-line"><span class="pc-label">单线图号</span><span class="pc-iso">${esc(g.iso)||'—'}</span></div>
        <div class="pc-actions">
          <button class="mini-btn" data-copy="${esc(g.iso)}">📋 复制</button>
          <button class="mini-btn" data-drawing="${esc(g.iso)}">📐 图纸</button>
        </div>
        <div class="pc-line"><span class="pc-label">阀门</span>
          <button class="mini-btn ${nv?'':'zero'}" data-rel="valve" data-iso="${esc(g.iso)}" data-line="${esc(g.line)}">🚪 所有阀门状态</button>
          <span class="pc-hint">本图号全部阀门录入状态</span>
        </div>
      </div>
      <div class="pc-meta">
        <div class="pc-line"><span class="pc-label">图纸版本</span><span class="pc-value">${esc(g.ver)||'—'}</span></div>
        <div class="pc-line"><span class="pc-label">探伤比例</span><span class="pc-value">${g.rt?esc(g.rt)+'%':'—'}</span></div>
        <div class="pc-line"><span class="pc-label">保温厚度</span><span class="pc-value">0.0</span></div>
      </div>
      <button class="add-tail" data-add="${esc(g.line)}">➕ 添加尾项</button>
      <div class="pc-welds">
        <div class="pc-welds-label">已焊接焊口</div>
        <div class="weld-chips">${weldsHtml}</div>
      </div>
    </div>`;
  });
  return html;
}

function doPipeQuery(){
  const kw = $('kwInput').value.trim().toLowerCase();
  const area = $('areaSelect').value;
  const list = $('pipeList'), empty = $('pipeEmpty');
  if(!kw && !area){
    list.innerHTML=''; empty.style.display='block';
    $('pipeEmptyMain').textContent='输入管线号开始查询';
    return;
  }
  // 全表扫描，按图号聚合（不提前截断，保证图号完整）
  const res=[];
  for(let i=0;i<P.rows.length;i++){
    const r=P.rows[i];
    if(area && (r[idx.pArea]||'').trim()!==area) continue;
    if(kw){
      const line=(r[idx.pLine]||'').toLowerCase();
      const draw=(r[ci(P,'图纸管线号')]||'').toLowerCase();
      const iso=(r[idx.pIso]||'').toLowerCase();
      if(line.indexOf(kw)<0 && draw.indexOf(kw)<0 && iso.indexOf(kw)<0) continue;
    }
    res.push(i);
  }
  empty.style.display='none';
  if(!res.length){
    list.innerHTML='<div class="found-bar">📌 找到 <b>0</b> 条结果</div><div class="more-tip">没有找到匹配的管线数据</div>'; return;
  }
  let html=pipeCards(res);
  if(res.length>=3000) html+='<div class="more-tip">匹配行数较多，结果按图号合并显示</div>';
  list.innerHTML=html;
}

/* ---------- 阀门查询（青色页，截图样式） ---------- */
// 到货/安装状态：Excel 只有「安装状态」列(已安装169)，到货状态无对应列，用安装状态+id有无推断
function valveInstalled(r){ return String(r[ci(V,'安装状态')]||'').trim()==='已安装'; }
function valveArrived(r){
  // 有阀门ID代码/识别代码 且未被标记未到货 → 视为已到货；保留推断说明
  const code=String(r[ci(V,'阀门ID代码')]||r[idx.vCode]||'').trim();
  return code!=='';
}
function valvePrefix(){
  const cnt={};
  V.rows.forEach(r=>{
    const code=String(r[idx.vCode]||'').trim();
    const m=code.match(/^(\d+-[A-Z]{2}-)/);
    if(m) cnt[m[1]]=(cnt[m[1]]||0)+1;
  });
  const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  $('valvePrefix').innerHTML=top.map(p=>`<button class="prefix-btn teal-prefix-btn" data-vprefix="${p}">${p}</button>`).join('');
}
function renderValveOverview(){
  const total=V.rows.length;
  const arrived=V.rows.filter(valveArrived).length;
  const installed=V.rows.filter(valveInstalled).length;
  const row=(label,num,cls,ico)=>`<div class="ov-line"><span class="ov-l">${ico} ${label}</span><span class="ov-n ${cls||''}">${num.toLocaleString()} 台</span></div>`;
  $('valveArrival').innerHTML=
    `<div class="ov-line ov-head"><span>全部到货情况</span><span>已到 ${arrived} 台</span></div>`+
    row('已到货',arrived,'teal','☑')+
    row('未到货',total-arrived,'red','❌');
  $('valveInstall').innerHTML=
    `<div class="ov-line ov-head"><span>安装状态总览</span><span>已安装 ${installed} 台</span></div>`+
    row('已安装',installed,'teal','☑')+
    row('未安装',total-installed,'grey','○')+
    `<div class="ov-note">* 到货状态原表无对应字段，按「阀门ID代码是否录入」推断；安装状态取自「安装状态」列。</div>`;
}
// 阀门查询：按规格(名称+识别代码+口径)分组展示
let valveGroups=[], valveQueryRes=[];
function doValveQuery(){
  const kw=$('valveKw').value.trim().toLowerCase();
  if(!kw){
    $('valveEmpty').style.display='block';
    $('valveResult').style.display='none';
    return;
  }
  const searchCols=[idx.vCode,idx.vLine,idx.vIso,ci(V,'阀门ID代码'),idx.vName,ci(V,'阀门描述'),ci(V,'阀门公称直径')];
  const res=[];
  for(let i=0;i<V.rows.length;i++){
    const r=V.rows[i]; let hit=false;
    for(const col of searchCols){ if(col>=0 && String(r[col]||'').toLowerCase().indexOf(kw)>=0){hit=true;break;} }
    if(hit) res.push(i);
  }
  $('valveEmpty').style.display='none';
  $('valveResult').style.display='block';
  $('valveSpecKw').value='';
  valveQueryRes=res;
  renderValveSpec(res);
}
function renderValveSpec(res){
  // 按 名称+识别代码+口径 分组
  const grp={};
  res.forEach(i=>{
    const r=V.rows[i];
    const name=String(r[idx.vName]||'其他').trim();
    const code=String(r[idx.vCode]||r[ci(V,'阀门ID代码')]||'').trim();
    const dn=String(r[ci(V,'阀门公称直径')]||'').trim();
    const key=name+'|'+code+'|'+dn;
    if(!grp[key]) grp[key]={name,code,dn,rows:[]};
    grp[key].rows.push(i);
  });
  const specKw=$('valveSpecKw').value.trim().toLowerCase();
  const entries=Object.values(grp).filter(g=>{
    if(!specKw) return true;
    return (g.code+' '+g.dn+' '+g.name).toLowerCase().indexOf(specKw)>=0;
  });
  valveGroups=entries;
  if(!entries.length){ $('valveSpecList').innerHTML='<div class="more-tip">没有找到匹配的阀门规格</div>'; return; }
  $('valveSpecList').innerHTML=entries.map(g=>{
    const total=g.rows.length;
    const inst=g.rows.filter(i=>valveInstalled(V.rows[i])).length;
    const arr=g.rows.filter(i=>valveArrived(V.rows[i])).length;
    const noarr=total-arr;
    return `<div class="vspec-card" data-code="${esc(g.code)}">
      <div class="vs-head"><span class="vs-name">🔹 ${esc(g.name)}</span>${g.code?`<span class="vs-code">${esc(g.code)}</span>`:''}<span class="vs-dn">${esc(g.dn)||'—'}</span></div>
      <div class="vs-stat">
        <div class="vs-cell"><div class="vs-n">${total}</div><div class="vs-l">总量 台</div></div>
        <div class="vs-cell"><div class="vs-n teal">${inst}</div><div class="vs-l teal">✅ 已安装 台</div></div>
        <div class="vs-cell"><div class="vs-n teal">${arr}</div><div class="vs-l teal">📦 已到货 台</div></div>
        <div class="vs-cell"><div class="vs-n red">${noarr}</div><div class="vs-l red">❌ 未到货 台</div></div>
      </div>
      <div class="vs-more" data-more="${esc(g.code)}">点此查该规格明细 ›</div>
    </div>`;
  }).join('');
}

/* ---------- 支架查询（蓝色页，截图样式） ---------- */
function buildSupportPrefix(){
  // 从支架编号提取子项前缀，如 12600-19-SUP-xxxx -> 19-SUP-
  const cnt={};
  S.rows.forEach(r=>{
    const no=String(r[idx.sNo]||'');
    const m=no.match(/^\d+-(\d+)-(SUP)/);
    if(m){ const key=m[1]+'-SUP-'; cnt[key]=(cnt[key]||0)+1; }
  });
  const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  $('supportPrefix').innerHTML=top.map(p=>`<button class="prefix-btn" data-prefix="${p}">${p}</button>`).join('');
}
function supportStatus(r){
  // 截图样式：自制支架-5.303KG-已到现场，8号管廊
  const db=String(r[ci(S,'数据库状态')]||'').trim();
  const stat=String(r[ci(S,'支架状态表状态')]||'').trim();
  const w=String(r[ci(S,'单重kg')]||'').trim();
  let base=db||stat||'支架';
  if(base==='成品'||base==='自制') base=base+'支架';
  let stage=stat && stat!==db ? stat : '';
  // 从备注/安装日期推断阶段
  const install=String(r[ci(S,'安装日期')]||'').trim();
  const note=String(r[ci(S,'备注')]||'').trim();
  if(install && !stage) stage='已安装';
  let s=base;
  if(w && w!=='0') s+='-'+w+'KG';
  if(stage) s+='-'+stage;
  if(note) s+='，'+note;
  return s;
}
function doSupportQuery(){
  const kw=$('supportKw').value.trim().toLowerCase();
  const list=$('supportList'), empty=$('supportEmpty');
  if(!kw){
    list.innerHTML=''; empty.style.display='block';
    return;
  }
  const searchCols=[idx.sNo,idx.sIso,idx.sLine,ci(S,'支架类型'),ci(S,'支架形式'),ci(S,'唯一码')];
  const res=[];
  for(let i=0;i<S.rows.length;i++){
    const r=S.rows[i];
    let hit=false;
    for(const col of searchCols){ if(col>=0 && String(r[col]||'').toLowerCase().indexOf(kw)>=0){hit=true;break;} }
    if(hit){ res.push(i); if(res.length>=200) break; }
  }
  empty.style.display='none';
  if(!res.length){ list.innerHTML='<div class="found-bar">📌 找到 <b>0</b> 条结果</div><div class="more-tip">没有找到匹配的支架</div>'; return; }
  let html=`<div class="found-bar">📌 找到 <b>${res.length}</b> 条结果</div>`;
  res.forEach(i=>{
    const r=S.rows[i];
    const no=String(r[idx.sNo]||'');
    const line=String(r[idx.sLine]||'');
    const iso=String(r[idx.sIso]||'');
    const sub=subNo(iso);
    const note=String(r[ci(S,'备注')]||'').trim();
    const status=supportStatus(r);
    // 该支架号对应的管线数
    const pipeCnt=idx.iso.P[iso] ? idx.iso.P[iso].length : 0;
    html+=`<div class="support-card" data-i="${i}">
      <div class="sc-bar">🔧 支架 "${esc(no)}" 对应 ${pipeCnt} 条管线</div>
      <div class="sc-body">
        <div class="sc-line"><span class="sc-label">管线号</span><span class="sc-val sc-blue">${esc(line)||'—'}</span></div>
        <div class="sc-line"><span class="sc-label">子项号</span><span class="sc-val">${esc(sub)||'—'}</span></div>
        <div class="sc-line"><span class="sc-label">单线图号</span><span class="sc-iso">${esc(iso)||'—'}</span><button class="mini-btn mini-blue" data-drawing="${esc(iso)}">📐 图纸</button></div>
        <div class="sc-line"><span class="sc-label">支架号</span><span class="sc-val sc-purple">${esc(no)||'—'}</span></div>
        <div class="sc-line"><span class="sc-label">📊 状态</span><span class="status-tag">${esc(status)||'—'}</span></div>
        ${note?`<div class="sc-line sc-note"><span class="sc-label">📝 原备注</span><span class="sc-val">${esc(note)}</span></div>`:''}
        ${noteBlock('support',no,'现场备注')}
      </div>
    </div>`;
  });
  list.innerHTML=html;
}
function renderSupportOverview(){
  const total=S.rows.length;
  const dbCnt={};S.rows.forEach(r=>{const v=String(r[ci(S,'数据库状态')]||'').trim()||'未分类';dbCnt[v]=(dbCnt[v]||0)+1;});
  const finished=dbCnt['成品']||0, self=dbCnt['自制']||0, remake=dbCnt['成品重新预制']||0;
  const rfi=ci(S,'RFI状态'); const rfiOk=S.rows.filter(r=>String(r[rfi]||'').indexOf('无意见通过')>=0).length;
  const install=S.rows.filter(r=>String(r[ci(S,'安装日期')]||'').trim()).length;
  const welded=S.rows.filter(r=>String(r[ci(S,'焊接日期')]||'').trim() && String(r[ci(S,'焊接日期')]||'').trim()!=='/').length;
  const row=(label,num,indent,cls)=>`<div class="ov-row" style="padding-left:${indent||0}px"><span>${label}</span><span class="ov-num ${cls||''}">${num.toLocaleString()} 个</span></div>`;
  $('supportOverview').innerHTML=
    row('📦 支架总数',total,0)+
    row('成品支架',finished,14,'blue')+
    row('自制支架',self,14,'blue')+
    (remake?row('成品重新预制',remake,14,'blue'):'')+
    `<div class="ov-divider"></div>`+
    row('✅ RFI 无意见通过',rfiOk,0,'blue')+
    row('已安装（有安装日期）',install,0,'blue')+
    row('已焊接（有焊接日期）',welded,0,'blue')+
    `<div class="ov-note">* 统计数据基于当前 Excel 的「数据库状态 / RFI状态 / 安装日期 / 焊接日期」列；到货、领用等细分状态原表无对应字段。</div>`;
}

/* ---------- 现场备注：先存本机立即生效，有网自动补传后台 ---------- */
const NOTE_LS = 'pipeNotes_v2';
let noteStore = {};    // key = kind+':'+编号
let noteQueue = [];    // 待上传的 key
let noteFlushing = false;

function cloudMsg(t){ const el=$('noteStatus'); if(el) el.textContent=t; }
async function apiFetch(opt, extra){
  const u = notesUrl(extra);
  if(!u) throw new Error('未设置服务器地址');
  const res=await fetch(u, opt);
  const j=await res.json().catch(()=>({}));
  if(!res.ok || j.error) throw new Error(j.error||('HTTP '+res.status));
  return j;
}
function fmtDate(s){ if(!s) return ''; const d=new Date(s); if(isNaN(d)) return String(s); return d.toLocaleString('zh-CN',{hour12:false}).replace(/\//g,'-'); }
function noteKey(kind,no){ return String(kind||'support')+':'+String(no||''); }
function noteGet(kind,no){ return noteStore[noteKey(kind,no)]||null; }
function noteReindex(){
  noteQueue=Object.keys(noteStore).filter(k=>noteStore[k]&&noteStore[k].pending);
  const b=$('noteCountBadge');
  if(b) b.textContent = noteQueue.length ? (Object.keys(noteStore).length+'/待传'+noteQueue.length) : Object.keys(noteStore).length;
}
function noteLoadLocal(){
  try{ noteStore=JSON.parse(localStorage.getItem(NOTE_LS)||'{}'); }catch(e){ noteStore={}; }
  if(!noteStore||typeof noteStore!=='object') noteStore={};
  noteReindex();
}
function notePersist(){
  try{ localStorage.setItem(NOTE_LS,JSON.stringify(noteStore)); }catch(e){}
  noteReindex();
}
// 备注输入区（支架卡片、支架/阀门详情共用）
function noteBlock(kind, no, title){
  const rec=noteGet(kind,no);
  return `<div class="cloud-note" data-kind="${esc(kind)}" data-no="${esc(no)}">
    <div class="cn-title">📝 ${esc(title||'现场备注')}（先存本机，有网自动上传）</div>
    <input class="cn-input cn-note" type="text" placeholder="如：已找到，在A区3号管廊" value="${esc(rec?rec.note:'')}">
    <div class="cn-row">
      <input class="cn-input cn-loc" type="text" placeholder="位置（可选）" value="${esc(rec?rec.location:'')}">
      <button class="cn-save" data-save-note="${esc(no)}" data-save-kind="${esc(kind)}">保存</button>
    </div>
    <div class="cn-saved${rec&&rec.pending?' pending':''}">${rec?(rec.pending?'✓ 已存本机 · 待上传':'✓ 已同步后台 '+(rec.syncedAt||rec.savedAt||'')):''}</div>
  </div>`;
}
// 保存：无条件先写本机，不依赖网络
async function saveNote(kind, no){
  let card=null;
  document.querySelectorAll('.cloud-note').forEach(el=>{
    if(el.dataset.kind===kind && el.dataset.no===no) card=el;
  });
  if(!card) return;
  const note=(card.querySelector('.cn-note').value||'').trim();
  const location=(card.querySelector('.cn-loc').value||'').trim();
  if(!note){ toast('请先填写备注内容'); return; }
  noteStore[noteKey(kind,no)]={
    kind,no,note,location,
    owner_name:(localStorage.getItem('pipeUser')||''),
    savedAt:fmtDate(new Date().toISOString()), pending:true
  };
  notePersist();
  const st=card.querySelector('.cn-saved');
  if(st){ st.textContent='✓ 已存本机 · 待上传'; st.className='cn-saved pending'; }
  toast('已保存到本机，联网后自动上传');
  flushNotes();
}
// 有网时把待上传的逐条推到后台
async function flushNotes(){
  if(noteFlushing || !cloudReady || !noteQueue.length) return;
  noteFlushing=true;
  try{
    for(const k of noteQueue.slice()){
      const rec=noteStore[k];
      if(!rec||!rec.pending) continue;
      try{
        await apiFetch({method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({support_no:rec.no,kind:rec.kind,note:rec.note,location:rec.location,
            owner_name:rec.owner_name,iso_no:'',line_no:'',area:''})});
        rec.pending=false; rec.syncedAt=fmtDate(new Date().toISOString());
        notePersist();
      }catch(e){ break; }   // 断网就停，下次再试
    }
    refreshNoteUI();
  }finally{ noteFlushing=false; }
}
function refreshNoteUI(){
  document.querySelectorAll('.cloud-note').forEach(el=>{
    const rec=noteGet(el.dataset.kind,el.dataset.no);
    const st=el.querySelector('.cn-saved'); if(!st) return;
    if(!rec){ st.textContent=''; st.className='cn-saved'; return; }
    st.textContent=rec.pending?'✓ 已存本机 · 待上传':'✓ 已同步后台 '+(rec.syncedAt||rec.savedAt||'');
    st.className='cn-saved'+(rec.pending?' pending':'');
  });
  noteReindex();
}
// 云端备注合并进本机（本地待上传的优先保留）
async function loadNotes(){
  if(!cloudReady) return [];
  try{
    const j=await apiFetch({method:'GET'});
    const data=Array.isArray(j.notes)?j.notes:[];
    data.forEach(n=>{
      if(!n || !n.support_no || Array.isArray(n)) return;   // 过滤索引脏数据
      const kind=n.kind||'support', k=noteKey(kind,n.support_no);
      if(noteStore[k] && noteStore[k].pending) return;
      noteStore[k]={kind,no:String(n.support_no),note:n.note||'',location:n.location||'',
        owner_name:n.owner_name||'',savedAt:fmtDate(n.updated_at||''),pending:false,
        iso_no:n.iso_no||'',line_no:n.line_no||'',area:n.area||''};
    });
    notePersist();
    refreshNoteUI();
    return data;
  }catch(e){ return []; }
}
function doSupportQueryKeepKw(){ doSupportQuery(); }
// 备注控制台：离线也能查看与导出
async function openNoteConsole(){
  $('notePanel').classList.add('show'); $('noteMask').classList.add('show');
  await renderNoteConsole();
}
function closeNoteConsole(){ $('notePanel').classList.remove('show'); $('noteMask').classList.remove('show'); }
async function renderNoteConsole(){
  const body=$('noteBody');
  if(cloudReady) await loadNotes();
  const rows=Object.values(noteStore).filter(n=>n&&n.no&&!Array.isArray(n))
    .sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||'')));
  const pending=noteQueue.length;
  $('noteStatus').textContent='共 '+rows.length+' 条备注'+(pending?' · '+pending+' 条待上传':'')+
    (cloudReady?' · 云端已连接':' · 离线模式（有网自动上传）');
  if(!rows.length){
    body.innerHTML='<div class="nc-empty">📭 还没有备注。<br>在支架卡片，或支架 / 阀门的详情里填写并保存，就会显示在这里。</div>';
    return;
  }
  body.innerHTML=rows.map(n=>`<div class="nc-card">
    <div class="nc-head">
      <span class="nc-no">${n.kind==='valve'?'🚪':'🔧'} ${esc(n.no)}</span>
      <span class="nc-tag ${n.pending?'wait':'ok'}">${n.pending?'待上传':'已同步'}</span>
      <button class="nc-del" data-del-note="${esc(n.kind)}|${esc(n.no)}">删除</button>
    </div>
    <div class="nc-line"><span>类型</span><b>${n.kind==='valve'?'阀门':'支架'}</b></div>
    <div class="nc-line"><span>备注</span><b class="nc-note-txt">${esc(n.note||'')}</b></div>
    <div class="nc-line"><span>位置</span><b>${esc(n.location||'—')}</b></div>
    <div class="nc-line"><span>录入</span><b>${esc(n.owner_name||'—')} · ${esc(n.savedAt||'')}</b></div>
  </div>`).join('');
}
// 导出 CSV（本机 + 云端合并，离线也能导）
function exportNotes(){
  const rows=Object.values(noteStore).filter(n=>n&&n.no);
  if(!rows.length){ toast('没有备注可导出'); return; }
  const head=['类型','编号','备注内容','位置','录入人','录入时间','同步状态'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const lines=[head.map(q).join(',')];
  rows.forEach(n=>lines.push([n.kind==='valve'?'阀门':'支架',n.no,n.note,n.location,n.owner_name,n.savedAt,n.pending?'待上传':'已同步'].map(q).join(',')));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='现场备注_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  const st=$('noteStatus'); if(st) st.textContent='已导出 '+rows.length+' 条备注';
  toast('已导出 '+rows.length+' 条备注');
}
async function deleteNote(combo){
  if(!combo) return;
  const [kind,no]=String(combo).split('|');
  if(!confirm('确定删除 '+no+' 的备注？此操作不可恢复。')) return;
  delete noteStore[noteKey(kind,no)];
  notePersist();
  if(cloudReady){
    try{ await apiFetch({method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({support_no:no})}); }
    catch(e){}
  }
  await renderNoteConsole(); refreshNoteUI(); doSupportQueryKeepKw();
  toast('已删除');
}

/* ---------- 工作量 · 数据管理控制台（可录入台账） ---------- */
// 列定义：与截图一致，14 个数据列 + 操作列
const WORK_FIELDS = [
  {k:'area',       t:'区域',             type:'text', cls:'area'},
  {k:'pipeWorker', t:'管工',             type:'num',  cls:'num'},
  {k:'welder',     t:'焊工',             type:'num',  cls:'num'},
  {k:'common',     t:'普工',             type:'num',  cls:'num'},
  {k:'pipeInst',   t:'管道安装(寸)',      type:'num',  cls:'num'},
  {k:'pipePre',    t:'管道预制(寸)',      type:'num',  cls:'num'},
  {k:'supInst',    t:'支架安装(个)',      type:'num',  cls:'num'},
  {k:'instWeight', t:'安装重量(kg)',      type:'num',  cls:'num'},
  {k:'valveInst',  t:'阀门安装(台)',      type:'num',  cls:'num'},
  {k:'supPre',     t:'支架预制(个)',      type:'num',  cls:'num'},
  {k:'preWeight',  t:'预制重量(kg)',      type:'num',  cls:'num'},
  {k:'under2',     t:'包含2寸以下(寸)',   type:'num',  cls:'num'},
  {k:'method',     t:'做法',             type:'text', cls:'method'},
  {k:'date',       t:'日期',             type:'date', cls:'date'},
];
const WORK_NUM_FIELDS = WORK_FIELDS.filter(f=>f.type==='num');
const WORK_LS = 'pipeWorkRows_v1';
let workRows = [];
let workCloud = false;                 // 工作台是否已连上云端 KV
let workFilter = {from:'', to:''};
let workSaveTimer = null;

function workStatus(t, warn){
  const el=$('workStatus');
  if(el){ el.textContent=t; el.className='wc-status'+(warn?' warn':''); }
}
function workStatusDefault(){
  workStatus(workCloud
    ? '☁️ 云端已连接 · 共 '+workRows.length+' 条记录 · 修改后自动同步到云端'
    : '💾 本地保存模式 · 共 '+workRows.length+' 条记录 · 数据保存在本机浏览器，可导出Excel');
}
function updateWorkBadge(){ const b=$('workCountBadge'); if(b) b.textContent=workRows.length; }
function workLoadLocal(){
  try{ workRows=JSON.parse(localStorage.getItem(WORK_LS)||'[]'); }catch(e){ workRows=[]; }
  if(!Array.isArray(workRows)) workRows=[];
  workRows=workRows.filter(r=>r&&r.id);
}
function workSaveLocal(){
  try{ localStorage.setItem(WORK_LS, JSON.stringify(workRows)); }catch(e){}
  updateWorkBadge();
}
// 云端可用时以云端为准合并，并把本地独有的记录补传上去
async function workInitCloud(){
  if(location.protocol==='file:' || !cloudReady){ workCloud=false; return; }
  try{
    const j=await apiFetch({method:'GET'}, {type:'work'});
    if(!j || !j.ok) throw new Error('work api unavailable');
    workCloud=true;
    const remote=j.rows||[];
    const remoteIds=new Set(remote.map(r=>String(r.id)));
    const map=new Map();
    workRows.forEach(r=>map.set(String(r.id), r));
    remote.forEach(r=>map.set(String(r.id), r));
    workRows=[...map.values()];
    workSaveLocal();
    for(const r of workRows) if(!remoteIds.has(String(r.id))) await workPush(r);
  }catch(e){ workCloud=false; }
}
async function workPush(row){
  if(!workCloud || !row) return;
  try{
    await apiFetch({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(row)}, {type:'work'});
  }catch(e){ workStatus('云端同步失败，已保存在本机', true); }
}
async function workRemoveRemote(id){
  if(!workCloud) return;
  try{ await apiFetch({method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id})}, {type:'work'}); }
  catch(e){}
}
function workVisible(){
  const f=workFilter.from, t=workFilter.to;
  if(!f && !t) return workRows.slice();
  return workRows.filter(r=>{
    const d=String(r.date||'');
    if(!d) return false;
    if(f && d<f) return false;
    if(t && d>t) return false;
    return true;
  });
}
function renderWorkFoot(){
  const tfoot=$('workTfoot'); if(!tfoot) return;
  const rows=workVisible();
  const sum={}; WORK_NUM_FIELDS.forEach(f=>sum[f.k]=0);
  rows.forEach(r=>WORK_NUM_FIELDS.forEach(f=>sum[f.k]+=numOf(r[f.k])));
  tfoot.innerHTML='<tr><td>汇总</td>'+
    WORK_FIELDS.filter(f=>f.k!=='area').map(f=>{
      if(f.type==='num') return '<td>'+fmt(sum[f.k])+'</td>';
      if(f.k==='date') return '<td>—</td>';
      return '<td>备注汇总</td>';
    }).join('')+'<td>'+rows.length+' 条</td></tr>';
}
function renderWorkConsole(){
  const thead=$('workThead'), tbody=$('workTbody');
  if(!thead || !tbody) return;
  thead.innerHTML='<tr>'+WORK_FIELDS.map(f=>'<th>'+f.t+'</th>').join('')+'<th>操作</th></tr>';
  const colspan=WORK_FIELDS.length+1;
  const rows=workVisible();
  let html='';
  if(!rows.length){
    html='<tr><td colspan="'+colspan+'"><div class="wc-empty-tip">'+
      (workRows.length ? '该日期范围内没有记录，请调整筛选或点「清除筛选」' : '请至少选择开始或结束日期后再查询，或点下方「+ 新增一行记录」开始录入')+
      '</div></td></tr>';
  }else{
    html=rows.map(r=>'<tr data-wid="'+esc(r.id)+'">'+
      WORK_FIELDS.map(f=>{
        const v=r[f.k]==null?'':r[f.k];
        if(f.type==='date') return '<td><input type="date" class="wc-in date" data-wk="'+f.k+'" value="'+esc(v)+'"></td>';
        if(f.k==='area')  return '<td><input type="text" class="wc-in area" data-wk="'+f.k+'" list="wcAreas" value="'+esc(v)+'" placeholder="区域"></td>';
        return '<td><input type="text" '+(f.type==='num'?'inputmode="decimal" ':'')+'class="wc-in '+f.cls+'" data-wk="'+f.k+'" value="'+esc(v)+'" placeholder="'+(f.type==='num'?'0':'')+'"></td>';
      }).join('')+
      '<td><button class="wc-del" data-wdel="'+esc(r.id)+'">删除</button></td></tr>').join('');
  }
  html+='<tr class="wc-add-row"><td colspan="'+colspan+'"><button id="workAdd" class="wc-add">＋ 新增一行记录</button></td></tr>';
  tbody.innerHTML=html;
  renderWorkFoot();
  workStatusDefault();
}
function addWorkRow(){
  const today=new Date().toISOString().slice(0,10);
  const row={ id:'w'+Date.now().toString(36)+Math.random().toString(36).slice(2,7) };
  WORK_FIELDS.forEach(f=>row[f.k]='');
  row.date=workFilter.from || workFilter.to || today;
  workRows.push(row);
  workSaveLocal(); workPush(row); renderWorkConsole();
  const el=$('workTbody').querySelector('tr[data-wid="'+row.id+'"]');
  if(el && el.scrollIntoView) el.scrollIntoView({block:'center'});
  workStatus('已新增一行，直接点单元格即可录入');
}
async function deleteWorkRow(id){
  if(!confirm('确定删除这一行记录？此操作不可恢复。')) return;
  workRows=workRows.filter(r=>String(r.id)!==String(id));
  workSaveLocal(); workRemoveRemote(id); renderWorkConsole();
  workStatus('已删除一行');
}
function onWorkEdit(e){
  const inp=e.target.closest('input[data-wk]'); if(!inp) return;
  const tr=inp.closest('tr[data-wid]'); if(!tr) return;
  const row=workRows.find(r=>String(r.id)===tr.dataset.wid); if(!row) return;
  row[inp.dataset.wk]=inp.value;
  renderWorkFoot();
  clearTimeout(workSaveTimer);
  workSaveTimer=setTimeout(()=>{
    workSaveLocal(); workPush(row);
    workStatus(workCloud?'✓ 已同步到云端':'✓ 已保存到本机');
  },500);
}
function exportWorkRows(){
  const rows=workVisible();
  if(!rows.length){ toast('当前没有记录可导出'); return; }
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const lines=[WORK_FIELDS.map(f=>q(f.t)).join(',')];
  rows.forEach(r=>lines.push(WORK_FIELDS.map(f=>q(r[f.k])).join(',')));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='工作量台账_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  workStatus('已导出 '+rows.length+' 条记录（Excel 可直接打开）');
}
function openWorkConsole(){
  $('workPanel').classList.add('show'); $('workMask').classList.add('show');
  renderWorkConsole();
}
function closeWorkConsole(){ $('workPanel').classList.remove('show'); $('workMask').classList.remove('show'); }

/* ---------- 新表格导入 + 云端数据分发 ---------- */
// 管线/支架/阀门可整体替换；gzip 后管线仅 ~0.7MB，分片上传绕开 1MB 请求限制
const DS_NAMES = ['pipeline','support','valve'];
const DS_LABEL = {pipeline:'管线', support:'支架', valve:'阀门'};
const PART_SIZE = 450000;   // 每片 base64 字符数，留足 1MB 余量
let importBusy = false, importTarget = 'pipeline';

/* --- 本机缓存（IndexedDB，可放 20MB 级数据） --- */
function idb(){
  return new Promise((res,rej)=>{
    if(!window.indexedDB) return rej(new Error('IndexedDB 不可用'));
    let done=false;
    const finish=(fn,v)=>{ if(done)return; done=true; clearTimeout(timer); fn(v); };
    const timer=setTimeout(()=>finish(rej,new Error('IndexedDB 打开超时')),3000);
    let q;
    try{ q=indexedDB.open('pipeDataCache',1); }
    catch(e){ return finish(rej,e); }
    q.onupgradeneeded=()=>{ if(!q.result.objectStoreNames.contains('ds')) q.result.createObjectStore('ds'); };
    q.onsuccess=()=>finish(res,q.result);
    q.onerror=()=>finish(rej,q.error);
    q.onblocked=()=>finish(rej,new Error('IndexedDB 被阻塞'));
  });
}
async function cacheGet(k){
  try{
    const db=await idb();
    return await new Promise((res,rej)=>{
      const r=db.transaction('ds','readonly').objectStore('ds').get(k);
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
  }catch(e){ return null; }
}
async function cachePut(k,v){
  try{
    const db=await idb();
    await new Promise((res,rej)=>{
      const t=db.transaction('ds','readwrite');
      t.objectStore('ds').put(v,k); t.oncomplete=res; t.onerror=()=>rej(t.error);
    });
  }catch(e){}
}
async function cacheDel(k){
  try{
    const db=await idb();
    await new Promise((res)=>{
      const t=db.transaction('ds','readwrite');
      t.objectStore('ds').delete(k); t.oncomplete=res; t.onerror=res;
    });
  }catch(e){}
}

/* --- gzip / base64 --- */
// 用 pako 纯 JS 实现，老版本 Android WebView 也能解压（不依赖 CompressionStream）
async function gzipBytes(str){
  if(!window.pako) throw new Error('缺少 vendor/pako.min.js');
  return window.pako.gzip(new TextEncoder().encode(str));
}
async function gunzipStr(bytes){
  if(!window.pako) throw new Error('缺少 vendor/pako.min.js');
  return new TextDecoder().decode(window.pako.ungzip(bytes));
}
function bytesToB64(u8){
  let s=''; const CH=0x8000;
  for(let i=0;i<u8.length;i+=CH) s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
  return btoa(s);
}
function b64ToBytes(s){
  const bin=atob(s), u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return u8;
}

/* --- 云端 /api/data --- */
async function dataGet(name, part){
  const u=apiUrl('/api/data', part==null?{name}:{name,part});
  if(!u) return null;
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),15000);
  try{
    const r=await fetch(u,{signal:ctl.signal});
    if(!r.ok) return null;
    return part==null ? await r.json() : await r.text();
  }finally{ clearTimeout(timer); }
}
async function dataPost(body){
  const u=apiUrl('/api/data');
  if(!u) throw new Error('未设置服务器地址');
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),10000);
  try{
    const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok || j.error) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }finally{ clearTimeout(timer); }
}
// 把「本机已更新但还没传上去」的数据补传到后台
async function flushPendingData(){
  if(!apiOrigin() || navigator.onLine===false) return;
  for(const n of DS_NAMES){
    const p=await cacheGet('pending_'+n);
    if(!p || !p.meta || !p.b64 || !p.meta.parts) continue;
    try{
      for(let i=0;i<p.meta.parts;i++){
        await dataPost({action:'part',name:n,part:i,data:p.b64.slice(i*PART_SIZE,(i+1)*PART_SIZE)});
      }
      await dataPost({action:'meta',name:n,meta:p.meta});
      await cacheDel('pending_'+n);
    }catch(e){ console.warn(DS_LABEL[n]+' 待上传数据暂无法同步：',e.message); break; }
  }
}
function applyDataset(name, ds){
  if(name==='pipeline') P=ds;
  else if(name==='support') S=ds;
  else if(name==='valve') V=ds;
}
async function loadCachedData(){
  for(const n of DS_NAMES){
    const c=await cacheGet('ds_'+n);
    if(c && c.data && c.data.rows && c.data.rows.length) applyDataset(n,c.data);
  }
}
let bootSyncAbort = false;   // 启动同步超时后禁止再改数据，避免索引与数据不一致
async function syncFromCloud(){
  if(!apiOrigin()) return false;
  let changed=false;
  // 先把本机尚未上传的新表格补传上去，让其他手机能拿到
  await flushPendingData().catch(()=>{});
  const metas = await Promise.all(DS_NAMES.map(n=>dataGet(n).catch(()=>null)));
  for(let k=0;k<DS_NAMES.length;k++){
    const n=DS_NAMES[k], r=metas[k], meta=r && r.meta;
    if(!meta || !meta.parts) continue;
    try{
      const c=await cacheGet('ds_'+n);
      if(c && c.version===meta.version && c.data){ if(!bootSyncAbort) applyDataset(n,c.data); continue; }
      let b64='';
      for(let i=0;i<meta.parts;i++){
        const t=await dataGet(n,i);
        if(t==null) throw new Error('分片 '+i+' 读取失败');
        b64+=t;
      }
      const ds=JSON.parse(await gunzipStr(b64ToBytes(b64)));
      if(!ds || !ds.rows || !ds.rows.length) throw new Error('数据内容为空');
      await cachePut('ds_'+n,{version:meta.version,data:ds});
      if(!bootSyncAbort){ applyDataset(n,ds); changed=true; }
    }catch(e){ console.warn('同步 '+DS_LABEL[n]+' 失败：',e.message); }
  }
  return changed;
}

/* --- Excel -> 列式数据（与 _export.py 的转换规则一致） --- */
function ensureXLSX(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='vendor/xlsx.full.min.js';
    s.onload=()=>window.XLSX?res():rej(new Error('表格解析库加载失败'));
    s.onerror=()=>rej(new Error('缺少 vendor/xlsx.full.min.js'));
    document.head.appendChild(s);
  });
}
function normVal(v){
  if(v==null) return '';
  if(v instanceof Date){
    const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,'0'), d=String(v.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+d;
  }
  return String(v);
}
function cleanCol(c){ return String(c==null?'':c).replace(/[\n\r]/g,' ').replace(/\s+/g,' ').trim(); }
function dedupeCols(cols){
  const seen={}, out=[];
  cols.forEach((raw,i)=>{
    let c=cleanCol(raw);
    if(!c) c='未命名'+(i+1);
    if(c in seen){ seen[c]+=1; c=c+'('+seen[c]+')'; }
    else seen[c]=0;
    out.push(c);
  });
  return out;
}
function trimRow(row){ let e=row.length; while(e>0 && row[e-1]==='') e--; return row.slice(0,e); }
function valveColName(s){
  const t=cleanCol(s).replace(/[А-Яа-яЁё]/g,'').replace(/№/g,'').replace(/\*/g,'');
  const toks=t.split(/\s+/).filter(Boolean);
  while(toks.length && !/[\u4e00-\u9fff]/.test(toks[0])) toks.shift();
  return toks.join(' ').trim() || t;
}
async function parseExcel(buf, name){
  await ensureXLSX();
  const wb=window.XLSX.read(new Uint8Array(buf),{type:'array',cellDates:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  if(!ws) throw new Error('表格里没有工作表');
  const arr=window.XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const headerIdx = name==='support' ? 1 : 0;
  // 支架表头行数可能变化（有的版本 2 行、有的 3 行），用「序号列出现第一个数字」动态定位数据起始行
  let dataIdx = headerIdx + 1;
  if(name==='support'){
    let found=-1;
    for(let i=headerIdx+1;i<Math.min(headerIdx+8,arr.length);i++){
      const first=String((arr[i]||[])[0]==null?'':(arr[i]||[])[0]).trim();
      if(/^\d+$/.test(first)){ found=i; break; }
    }
    dataIdx = found>=0 ? found : headerIdx+2;
  }
  const rawCols   = arr[headerIdx]||[];
  const cols = name==='valve'
    ? dedupeCols(rawCols.map(v=>valveColName(normVal(v))))
    : dedupeCols(rawCols.map(v=>cleanCol(normVal(v))));
  const ncol=cols.length, rows=[];
  for(let i=dataIdx;i<arr.length;i++){
    const r=arr[i]||[], vals=[];
    for(let j=0;j<ncol;j++) vals.push(normVal(r[j]==null?'':r[j]));
    if(!vals.some(v=>v!=='')) continue;
    rows.push(trimRow(vals));
  }
  if(!rows.length) throw new Error('没有读到数据行，请确认表格格式和所选功能对应');
  return {cols,rows};
}

/* --- 导入进度浮层 --- */
function showImport(msg, pct){
  const m=$('importMask'); if(!m) return;
  m.classList.add('show');
  $('importMsg').textContent=msg;
  if(pct!=null) $('importBar').style.width=Math.max(3,Math.min(100,pct))+'%';
}
function hideImport(){ const m=$('importMask'); if(m) m.classList.remove('show'); }

/* --- 导入主流程 --- */
async function importExcel(file, name){
  if(importBusy) return;
  importBusy=true;
  showImport('读取文件：'+file.name, 5);
  try{
    const buf=await file.arrayBuffer();
    showImport('解析 '+DS_LABEL[name]+'表格（大表约需十几秒）', 15);
    const ds=await parseExcel(buf,name);
    showImport('读到 '+ds.rows.length+' 行 / '+ds.cols.length+' 列，正在压缩', 38);
    const gz=await gzipBytes(JSON.stringify(ds));
    const b64=bytesToB64(gz);
    const parts=Math.ceil(b64.length/PART_SIZE);
    const meta={name,parts,rows:ds.rows.length,cols:ds.cols.length,bytes:gz.length,
      version:Date.now(),updated_at:new Date().toISOString(),
      owner_name:(localStorage.getItem('pipeUser')||'')};
    // ① 无条件先更新本机，断网也能立刻用
    await cachePut('ds_'+name,{version:meta.version,data:ds});
    await cachePut('pending_'+name,{meta,b64});
    showImport('已更新本机数据，正在尝试同步到后台', 55);
    // ② 有网才上传；失败不影响本机结果，留待自动补传
    let synced=false;
    try{
      if(apiOrigin() && navigator.onLine!==false){
        for(let i=0;i<parts;i++){
          showImport('上传分片 '+(i+1)+' / '+parts, 58+Math.round(32*(i+1)/parts));
          await dataPost({action:'part',name,part:i,data:b64.slice(i*PART_SIZE,(i+1)*PART_SIZE)});
        }
        await dataPost({action:'meta',name,meta});
        await cacheDel('pending_'+name);
        synced=true;
      }
    }catch(e){ console.warn('同步失败，数据已存本机待补传',e); }
    showImport(synced?'✓ 已更新并同步到后台，正在刷新…':'✓ 已更新本机，联网后自动同步，正在刷新…', 100);
    toast(synced?'数据已同步，所有手机将自动更新':'已更新本机，联网后自动同步');
    setTimeout(()=>location.reload(),1000);
  }catch(e){
    hideImport();
    toast('导入失败：'+e.message);
    console.error(e);
  }finally{ importBusy=false; }
}

/* --- 设置弹层 --- */
function openCfg(){
  $('cfgName').value=localStorage.getItem('pipeUser')||'';
  $('cfgApi').value=localStorage.getItem('pipeApiBase')||'';
  $('cfgPanel').classList.add('show'); $('cfgMask').classList.add('show');
  renderCfgVersion();
}
function closeCfg(){ $('cfgPanel').classList.remove('show'); $('cfgMask').classList.remove('show'); }
async function renderCfgVersion(){
  const el=$('cfgVersion'); if(!el) return;
  const lines=[];
  let pendingData=0;
  for(const n of DS_NAMES){ if(await cacheGet('pending_'+n)) pendingData++; }
  if(noteQueue.length) lines.push('<div style="color:#b45309">📝 备注：'+noteQueue.length+' 条待上传</div>');
  if(pendingData) lines.push('<div style="color:#b45309">📦 表格：'+pendingData+' 张待上传</div>');
  if(!apiOrigin()){
    el.innerHTML='⚠️ 未设置服务器地址，暂为纯本机模式（数据已保存，不会丢失）。<br>填入正式域名并联网后会自动上传。'+(lines.length?'<br>'+lines.join(''):'');
    return;
  }
  el.textContent='读取中…';
  for(const n of DS_NAMES){
    try{
      const r=await dataGet(n), m=r&&r.meta, c=await cacheGet('ds_'+n);
      if(!m) lines.push('<div>'+DS_LABEL[n]+'：云端暂无更新（使用内置数据）</div>');
      else lines.push('<div>'+DS_LABEL[n]+'：云端 '+(m.rows||0)+' 行 · '+esc(fmtDate(m.updated_at))+
        (c&&c.version===m.version?' · <b style="color:#07c160">本机已最新</b>':' · <b style="color:#e0483e">本机待更新</b>')+'</div>');
    }catch(e){ lines.push('<div>'+DS_LABEL[n]+'：读取失败</div>'); }
  }
  el.innerHTML=lines.join('');
}

/* ---------- 壁厚规格查询器 ---------- */
let wallSelDn='DN32', wallSelSch='SCH10S';
function buildWallUI(){
  // DN 网格分组：小口径 DN6-DN50 / 中 DN65-DN200 / 大 DN250-DN1000
  const small=WALL.filter(x=>parseInt(x.dn.slice(2))<=50);
  const mid=WALL.filter(x=>{const n=parseInt(x.dn.slice(2));return n>50&&n<=200;});
  const large=WALL.filter(x=>parseInt(x.dn.slice(2))>200);
  const btn=x=>`<button class="dn-btn ${x.dn===wallSelDn?'on':''}" data-dn="${x.dn}">${x.dn}</button>`;
  $('dnSmall').innerHTML=small.map(btn).join('');
  $('dnMid').innerHTML=mid.map(btn).join('');
  $('dnLarge').innerHTML=large.map(btn).join('');
  // 壁厚代码网格
  $('schGrid').innerHTML=WALL_CODES.map(c=>`<button class="sch-btn ${c===wallSelSch?'on':''}" data-sch="${c}">${c}</button>`).join('');
  updateWallResult();
}
function updateWallResult(){
  const item=WALL.find(x=>x.dn===wallSelDn);
  if(!item) return;
  const t=item.w[wallSelSch];
  $('wrDn').innerHTML=`${esc(item.dn)} <span>mm</span>`;
  $('wrOd').innerHTML=`${item.od} <span>mm</span>`;
  $('wrSch').textContent=wallSelSch;
  $('wrThk').innerHTML=t!=null?`${t} <span>mm</span>`:'<span style="font-size:13px;color:#bbb">该组合无数据</span>';
}

/* ---------- 弯头计算器（ASME B16.9 长半径 1.5D） ---------- */
function buildNpsSelect(){
  const opts=WALL.map(x=>`<option value="${x.nps}" ${x.nps==='4'?'selected':''}>${x.nps==='0.125'?'1/8':x.nps==='0.25'?'1/4':x.nps==='0.375'?'3/8':x.nps}″${x.dn?' · '+x.dn:''}</option>`).join('');
  $('elbowNps').innerHTML='<option value="">— 请选择 —</option>'+opts;
}
// 解析公称尺寸（支持 "1-1/4" "2.5" "4" "6" 等，返回英寸数值）
function parseNps(s){
  s=String(s||'').trim().replace(/[″"dD]/g,'').replace(/^NPS\s*/i,'');
  if(!s) return NaN;
  // 形如 1-1/4 / 1 1/2
  let m=s.match(/^(\d+)\s*[-\s]\s*(\d+)\/(\d+)$/);
  if(m) return parseFloat(m[1])+parseFloat(m[2])/parseFloat(m[3]);
  // 形如 1/2
  m=s.match(/^(\d+)\/(\d+)$/);
  if(m) return parseFloat(m[1])/parseFloat(m[2]);
  // 纯数字
  m=s.match(/^(\d+(?:\.\d+)?)$/);
  if(m) return parseFloat(m[1]);
  return NaN;
}
function calcElbow(){
  let inch=parseNps($('elbowManual').value);
  if(isNaN(inch)) inch=parseFloat($('elbowNps').value);
  const ang=parseFloat($('elbowAngle').value);
  if(isNaN(inch)||isNaN(ang)||inch<=0||ang<=0||ang>=180){
    $('erR').textContent='R = — mm'; $('erA').innerHTML='— <span>mm</span>'; $('erL').innerHTML='— <span>mm</span>';
    if(!isNaN(inch)&&(isNaN(ang)||ang<=0||ang>=180)) toast('请输入有效角度(0~180°)');
    return;
  }
  const R=1.5*inch*25.4;              // 长半径弯曲半径
  const rad=ang*Math.PI/180;
  const A=R*Math.tan(rad/2);          // 中心到端面
  const L=R*rad;                      // 弧长
  $('erR').textContent='R = '+R.toFixed(1)+' mm';
  $('erA').innerHTML=A.toFixed(1)+' <span>mm</span>';
  $('erL').innerHTML=L.toFixed(2)+' <span>mm</span>';
}
function resetElbow(){
  $('elbowNps').value='4'; $('elbowManual').value=''; $('elbowAngle').value='90';
  calcElbow();
}

/* ---------- 工作量 ---------- */
let workTab='daily';
const numOf=v=>{const f=parseFloat(v);return isNaN(f)?0:f;};
const dateOK=v=>{const s=String(v==null?'':v).trim();return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function fmt(n){ return Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2}); }

// 总量 tab：总合计 + 各区域（按区域列识别）
function renderWorkTotal(){
  const zone={};
  P.rows.forEach(r=>{
    const z=String(r[idx.pArea]||'').trim()||'未分';
    if(!zone[z]) zone[z]={cun:0,done:0,undone:0,cnt:0};
    const sz=numOf(r[idx.pSize]); const d=dateOK(r[idx.pWeldDate]);
    zone[z].cun+=sz; zone[z].cnt++;
    if(d) zone[z].done+=sz; else zone[z].undone+=sz;
  });
  let gt=0,gd=0,gu=0,gc=0;
  Object.values(zone).forEach(v=>{gt+=v.cun;gd+=v.done;gu+=v.undone;gc+=v.cnt;});
  const line=(label,val,unit,cls)=>`<div class="wk-line"><span class="wk-l">${label}</span><span class="wk-v ${cls||''}">${fmt(val)} <i>${unit}</i></span></div>`;
  $('wkGrand').innerHTML=
    line('十四化建总量',gt,'寸')+
    line('焊接完成',gd,'寸','green')+
    line('焊接未完成',gu,'寸','green');
  const zones=Object.keys(zone).filter(z=>z!=='未分').sort();
  $('wkAreaList').innerHTML=zones.map(z=>{
    const v=zone[z];
    const zoneNo=z.split('-').pop();
    return `<div class="wk-card area-card">
      <div class="wk-card-head"><span>📍 ${esc(z)} <span class="wk-badge">工区${esc(zoneNo)} · ${v.cnt}</span></span></div>
      <div class="wk-body">
        ${line('总量',v.cun,'寸','green')}
        <div class="wk-line"><span class="wk-l">✅ 焊接完成</span><span class="wk-v green">${fmt(v.done)} <i>寸</i></span></div>
        <div class="wk-line"><span class="wk-l red">❌ 焊接未完成</span><span class="wk-v red">${fmt(v.undone)} <i>寸</i></span></div>
      </div>
    </div>`;
  }).join('');
}

// 工作量 tab：日期范围汇总
function renderWorkDaily(from,to){
  // 默认：无日期时取最近30天（结束=最新焊接日期）
  if(!from || !to){
    const dates=P.rows.map(r=>dateOK(r[idx.pWeldDate])).filter(Boolean).sort();
    to = dates[dates.length-1] || '';
    if(to){
      const d=new Date(to+'T00:00:00'); d.setDate(d.getDate()-30);
      from=d.toISOString().slice(0,10);
    } else from=to;
  }
  $('dateFrom').value=from; $('dateTo').value=to;
  $('wkDate').textContent=to;
  const inRange=d=>{const s=dateOK(d);return !!s && s>=from && s<=to;};
  // 管道安装寸 / 2寸以下 / 丢失重焊(返修)
  let pipeCun=0,small2=0,reweld=0;
  P.rows.forEach(r=>{
    if(!inRange(r[idx.pWeldDate])) return;
    const sz=numOf(r[idx.pSize]); pipeCun+=sz;
    if(sz<=2) small2+=sz;
    const fix1=String(r[ci(P,'返修焊工1')]||'').trim();
    const fix2=String(r[ci(P,'返修焊工2')]||'').trim();
    if(fix1||fix2) reweld+=sz;
  });
  // 支架安装数 / 重量
  let supCnt=0,supW=0;
  S.rows.forEach(r=>{ if(inRange(r[idx.sInstDate])){supCnt++;supW+=numOf(r[idx.sWeight]);} });
  // 阀门安装台
  let valCnt=0;
  V.rows.forEach(r=>{ if(inRange(r[idx.vInstDate])) valCnt++; });
  const line=(label,val,unit)=>`<div class="wk-line"><span class="wk-l">${label}</span><span class="wk-v green">${fmt(val)} <i>${unit}</i></span></div>`;
  $('wkDailyStat').innerHTML=
    line('管道安装',pipeCun,'寸')+
    line('支架安装',supCnt,'个')+
    line('安装重量',supW,'kg')+
    line('阀门安装',valCnt,'台')+
    line('包含2寸以下',small2,'寸')+
    line('包含丢失重焊寸',reweld,'寸');
  // 人员：按焊工号去重（管工/焊工/普工——数据无明确分类，用焊工号唯一数）
  const welders=new Set();
  P.rows.forEach(r=>{ if(inRange(r[idx.pWeldDate])){const w=String(r[idx.pWelder]||'').trim();if(w&&w!=='0')welders.add(w);} });
  $('wkPeople').innerHTML=
    `<div class="pp-cell"><div class="pp-l">👷 管工</div><div class="pp-n">—</div></div>`+
    `<div class="pp-cell"><div class="pp-l">🔧 焊工</div><div class="pp-n">${welders.size}</div></div>`+
    `<div class="pp-cell"><div class="pp-l">👷 普工</div><div class="pp-n">—</div></div>`;
  // 按区域分组（该日期范围内有焊接的区域）
  const grp={};
  P.rows.forEach(r=>{
    if(!inRange(r[idx.pWeldDate])) return;
    const z=String(r[idx.pArea]||'').trim()||'未分';
    if(!grp[z]) grp[z]={cnt:0,cun:0};
    grp[z].cnt++; grp[z].cun+=numOf(r[idx.pSize]);
  });
  const zones=Object.keys(grp).filter(z=>z!=='未分').sort();
  $('wkGroups').innerHTML=zones.map(z=>`<div class="wk-card area-card">
    <div class="wk-card-head"><span>📍 ${esc(z)} <span class="wk-badge">工区${esc(z.split('-').pop())} · ${grp[z].cnt}</span></span></div>
    <div class="wk-body">${line('安装寸',grp[z].cun,'寸')}</div>
  </div>`).join('') || '<div class="more-tip">该日期范围内无焊接记录</div>';
}

function renderWork(){
  if(workTab==='total') renderWorkTotal();
  else renderWorkDaily();
}
function switchWorkTab(tab){
  workTab=tab;
  document.querySelectorAll('.work-tab').forEach(t=>t.classList.toggle('active',t.dataset.wtab===tab));
  $('workDaily').style.display = tab==='daily'?'block':'none';
  $('workTotal').style.display = tab==='total'?'block':'none';
  renderWork();
}

/* ---------- 详情 ---------- */
const DETAIL = {
  pipeline:{
    title:r=>`管线 ${val(r,P,'管线号')||''}`,
    groups:[
      ['基本信息',['区域','装置','图纸号','流程图号','版本号','页码','施工承包商','施工队']],
      ['管线参数',['管线号','图纸管线号','管线材料等级','压力级别','介质','管段号','介质级别','系统号','子系统号']],
      ['焊口信息',['焊缝编号','安装/F预制/S','外径1','厚度1','厚度2','母材材质1','母材材质2','焊接型式','WPS编号','焊接方法(根层)','焊接日期','焊工号根层']],
      ['检测与状态',['VT检测结果','RT检测结果','UT检测结果','PT检测结果','是否热处理','焊口状态','工厂预制','试压包号','备注']]
    ],
    iso:r=>val(r,P,'图纸号')
  },
  support:{
    title:r=>`支架 ${val(r,S,'支架编号')||''}`,
    groups:[
      ['基本信息',['区域','图号','文件编号 (管线号)','图纸状态','版本','批次','施工队','数据库状态']],
      ['支架规格',['支架编号','支架类型','支架形式','规格','数量','材质1','材质2','单重kg','总重','焊缝长度mm','唯一码']],
      ['制作与检验',['预制焊工号','焊接日期','VT委托号','VT报告','RFI编号','RFI状态','支架涂漆系统','安装日期','备注']]
    ],
    iso:r=>val(r,S,'图号')
  },
  valve:{
    title:r=>`阀门 ${val(r,V,'阀门识别代码')||''}`,
    groups:[
      ['基本信息',['单元号','图纸编号','管线号','图纸管线号','单线图页码','焊口号1','焊口号2','施工承包商','施工队']],
      ['阀门规格',['阀门名称','阀门识别代码','阀门ID代码','材料清单序号','阀门描述','阀门公称直径','阀门公称压力','电传动装置出厂编号']],
      ['安装与试压',['安装状态','法兰型阀门安装日期','焊接型阀门安装日期','螺纹型阀门安装日期','安装数量','试压包号','实际试压日期','备注']]
    ],
    iso:r=>val(r,V,'图纸编号')
  },
  thick:{
    title:r=>`管线 ${val(r,P,'管线号')||''} · 壁厚`,
    groups:[
      ['管线与壁厚',['区域','图纸号','管线号','介质','厚度1','厚度2','外径1','外径2','管段号','焊缝编号','管线材料等级','压力级别']],
      ['焊接信息',['母材材质1','母材材质2','焊接方法(根层)','焊接日期','焊工号根层','WPS编号']]
    ],
    iso:r=>val(r,P,'图纸号')
  }
};
function openDetail(page, i, fromRel){
  let ds, cfg;
  relBack = fromRel ? relBack : null; // 非关联入口进入则清除返回来源
  if(page==='support'){ds=S;cfg=DETAIL.support;}
  else if(page==='valve'){ds=V;cfg=DETAIL.valve;}
  else if(page==='thick'){ds=P;cfg=DETAIL.thick;}
  else {ds=P;cfg=DETAIL.pipeline;}
  const r=ds.rows[i];
  $('detailTitle').textContent=cfg.title(r);
  const iso=cfg.iso(r)||'';
  let html='';
  if(relBack) html+=`<button class="rel-back" id="relBackBtn">← 返回${relBack.page==='support'?'支架':'阀门'}列表</button>`;
  if(iso){
    const np=(idx.iso.P[iso]||[]).length, ns=(idx.iso.S[iso]||[]).length, nv=(idx.iso.V[iso]||[]).length;
    html+=`<div class="dsec-title">🔗 按图号关联 <span style="font-weight:400;color:#999">${esc(iso)}</span></div>
      <div class="rel-links">
        <button class="rel-btn ${np?'':'zero'}" data-rel="pipeline" data-iso="${esc(iso)}">管线 <span class="n">${np}</span></button>
        <button class="rel-btn ${ns?'':'zero'}" data-rel="support" data-iso="${esc(iso)}">支架 <span class="n">${ns}</span></button>
        <button class="rel-btn ${nv?'':'zero'}" data-rel="valve" data-iso="${esc(iso)}">阀门 <span class="n">${nv}</span></button>
      </div>`;
  }
  cfg.groups.forEach(([g,fields])=>{
    html+=`<div class="dsec-title">${g}</div>`;
    fields.forEach(f=>{
      const v=val(r,ds,f);
      html+=`<div class="dkv"><span class="k">${f}</span><span class="v ${v?'':'empty'}">${v?esc(v):'—'}</span></div>`;
    });
  });
  // 支架 / 阀门详情里也能直接写现场备注（离线先存，有网补传）
  if(page==='support' || page==='valve'){
    const no=String(page==='support' ? val(r,S,'支架编号') : val(r,V,'阀门识别代码')||'').trim();
    if(no) html+=noteBlock(page,no,'现场备注');
  }
  $('detailBody').innerHTML=html;
  $('detailBody').scrollTop=0;
  $('detailPanel').classList.add('show');
  $('detailMask').classList.add('show');
}
function closeDetail(){ $('detailPanel').classList.remove('show'); $('detailMask').classList.remove('show'); }

// 复制文本到剪贴板
function copyText(t){
  if(!t) return;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(()=>toast('已复制')).catch(()=>fallbackCopy(t));
    } else fallbackCopy(t);
  }catch(e){ fallbackCopy(t); }
}
function fallbackCopy(t){
  const ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('已复制'); }catch(e){ toast('复制失败'); }
  document.body.removeChild(ta);
}
function toast(msg){
  let t=$('_toast');
  if(!t){ t=document.createElement('div'); t.id='_toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),1500);
}

// 点击焊口：只显示本管线(本图号)范围内、该焊口的明细
function doWeldQuery(weld, rowsStr){
  // rowsStr = 卡片内精确匹配该焊口的行索引，限定在当前这条管线范围内
  const res = (rowsStr||'').split(',').filter(s=>s!=='').map(Number).filter(n=>Number.isInteger(n) && n>=0 && n<P.rows.length);
  const line = res.length ? (val(P.rows[res[0]],P,'图纸管线号')||val(P.rows[res[0]],P,'管线号')) : '';
  $('detailTitle').textContent=(line?line+' · ':'')+'焊口 '+weld+' · 明细';
  let html=`<div class="dsec-title">本管线共找到 ${res.length} 条记录</div>`;
  res.forEach(i=>{
    const r=P.rows[i];
    html+=`<div class="dsec-title" style="color:#666">${esc(val(r,P,'图纸管线号')||val(r,P,'管线号'))} · ${esc(val(r,P,'图纸号'))}</div>`;
    [['子项号',subNo(val(r,P,'图纸号'))],['焊缝编号',val(r,P,'焊缝编号')],['管段号',val(r,P,'管段号')],
     ['安装/F预制/S',val(r,P,'安装/F预制/S')],['外径1',val(r,P,'外径1')],['厚度1',val(r,P,'厚度1')],
     ['焊接日期',val(r,P,'焊接日期')],['焊工号根层',val(r,P,'焊工号根层')],['VT检测结果',val(r,P,'VT检测结果')]
    ].forEach(([k,v])=>{ html+=`<div class="dkv"><span class="k">${k}</span><span class="v ${v?'':'empty'}">${esc(v)||'—'}</span></div>`; });
  });
  $('detailBody').innerHTML=html;
  $('detailBody').scrollTop=0;
  $('detailPanel').classList.add('show'); $('detailMask').classList.add('show');
}

// 支架阶段状态：用现有列推断（原系统的到货/现场等后台状态 Excel 无对应列）
function supStage(r){
  const valid=v=>{const s=String(v==null?'':v).trim();return (s&&s!=='/'&&s!=='#N/A'&&s!=='0')?s:'';};
  const inst=valid(r[ci(S,'安装日期')]);
  const rfi=String(r[ci(S,'RFI状态')]||'');
  const weld=valid(r[ci(S,'焊接日期')]);
  const note=String(r[ci(S,'备注')]||'');
  const db=String(r[ci(S,'数据库状态')]||'');
  if(inst) return '已到现场';
  if(rfi.indexOf('无意见通过')>=0) return '已验收';
  if(note.indexOf('已预制')>=0||weld) return '已预制';
  if(note.indexOf('已下料')>=0) return '已下料';
  if(db.indexOf('成品')>=0) return '成品';
  return '未设置';
}
const STAGE_ORDER=['已到现场','已验收','已预制','已下料','成品','未设置'];
const STAGE_CLS={'已到现场':'green','已验收':'green','已预制':'blue','已下料':'orange','成品':'blue','未设置':'grey'};

// 弹出"该图号下的所有支架/阀门"列表（串联核心）
let relBack = null; // 从列表进入详情时记录来源，便于返回
let relCtx = null;  // 当前弹层上下文（iso/管线号/阶段筛选）
function showRelList(relPage, iso, lineNo){
  const isSup = relPage==='support';
  const ds = isSup ? S : V;
  const rows = idx.iso[isSup?'S':'V'][iso] || [];
  const typeName = isSup ? '支架' : '阀门';
  const line = lineNo || (rows.length ? String(isSup?(ds.rows[rows[0]][idx.sLine]):(ds.rows[rows[0]][idx.vLine])||'') : '');
  relBack = {page:relPage, iso:iso, line:line};
  relCtx = {page:relPage, iso:iso, line:line, stage:''};
  if(isSup) renderSupportRel();
  else renderValveRel();
  $('detailBody').scrollTop=0;
  $('detailPanel').classList.add('show');
  $('detailMask').classList.add('show');
}

// 支架关联弹层（截图样式）
function renderSupportRel(){
  const all = idx.iso.S[relCtx.iso] || [];
  const stageCnt={}; all.forEach(i=>{const s=supStage(S.rows[i]);stageCnt[s]=(stageCnt[s]||0)+1;});
  const recorded = all.length - (stageCnt['未设置']||0);
  $('detailTitle').innerHTML=`<span class="rt-icon">📊</span> ${esc(relCtx.line)||'—'} · 所有支架状态`;
  let html=`<div class="rel-sub">${esc(relCtx.iso)||'—'}　|　子项 ${esc(subNo(relCtx.iso))||'—'}　|　共 <b>${all.length}</b> 个支架</div>`;
  html+=`<div class="rel-stat">共 <b>${all.length}</b> 个支架，已录状态 <b>${recorded}</b> 个，未设置 <b>${stageCnt['未设置']||0}</b> 个</div>`;
  // 状态筛选胶囊（全部 + 各阶段）
  html+=`<div class="stage-filters"><button class="stage-pill ${relCtx.stage?'':'on'}" data-stage="">全部 <span>${all.length}</span></button>`;
  STAGE_ORDER.forEach(s=>{ if(stageCnt[s]) html+=`<button class="stage-pill ${relCtx.stage===s?'on':''} ${STAGE_CLS[s]||''}" data-stage="${s}">${s} <span>${stageCnt[s]}</span></button>`; });
  html+=`</div>`;
  // 列表
  const shown = relCtx.stage ? all.filter(i=>supStage(S.rows[i])===relCtx.stage) : all;
  html+=`<div class="rel-item-list sup-list">`;
  shown.forEach((i,pos)=>{
    const r=S.rows[i];
    const no=String(r[idx.sNo]||'');
    const st=supStage(r);
    const w=String(r[ci(S,'单重kg')]||'').trim();
    const team=String(r[ci(S,'施工队')]||'').trim();
    const d=String(r[ci(S,'安装日期')]||r[ci(S,'焊接日期')]||'').trim();
    let tag=(r[ci(S,'数据库状态')]==='自制'?'自制支架':r[ci(S,'数据库状态')]==='成品'?'成品支架':'支架');
    if(w&&w!=='0') tag+='-'+w+'KG';
    tag+='-'+st;
    const note=String(r[ci(S,'备注')]||'').trim(); if(note) tag+='，'+note;
    const meta=[team?('录入：'+team):'', d?d:'', '点此查该支架'].filter(Boolean).join(' · ');
    html+=`<div class="rel-item sup-item" data-open="support" data-i="${i}">
      <div class="ri-title"><span>${pos+1}. ${esc(no)||'(无编号)'}</span><span class="ri-arrow">›</span></div>
      <div class="ri-tagline"><span class="ri-tag ${STAGE_CLS[st]||'grey'}">${esc(tag)}</span></div>
      <div class="ri-meta">${esc(meta)}</div>
    </div>`;
  });
  html+=`</div>`;
  // 底部固定操作栏
  html+=`<div class="rel-foot"><button class="rf-btn rf-copy" id="relCopyAll">📋 复制全部</button><button class="rf-btn" id="relRefresh">🔄 刷新状态</button><span class="rf-count">状态库 ${S.rows.length.toLocaleString()} 条</span></div>`;
  $('detailBody').innerHTML=html;
}

// 阀门关联弹层（沿用简洁列表）
function renderValveRel(){
  const rows = idx.iso.V[relCtx.iso] || [];
  $('detailTitle').innerHTML=`<span class="rt-icon">🚪</span> ${esc(relCtx.line)||'—'} · 所有阀门状态`;
  let html=`<div class="rel-sub">${esc(relCtx.iso)||'—'}　|　共 <b>${rows.length}</b> 个阀门</div>`;
  if(!rows.length){ html+=`<div class="more-tip">该图号暂无阀门数据</div>`; }
  else{
    html+=`<div class="rel-item-list">`;
    rows.forEach((i,pos)=>{
      const r=V.rows[i];
      const code=String(r[idx.vCode]||''), name=String(r[idx.vName]||'');
      const line=String(r[idx.vLine]||''), dn=String(val(r,V,'阀门公称直径')||'');
      html+=`<div class="rel-item" data-open="valve" data-i="${i}">
        <div class="ri-title"><span>${pos+1}. 🚪 ${esc(code)||esc(name)||'(无编号)'}</span><span class="ri-arrow">›</span></div>
        <div class="ri-sub">${esc(name)||''}${dn?' · DN'+esc(dn):''}</div>
        <div class="ri-status">管线 ${esc(line)||'—'} · 点此查该阀门</div>
      </div>`;
    });
    html+=`</div>`;
  }
  $('detailBody').innerHTML=html;
}

// 关联跳转：把对应页的搜索框设为图号并查询
function jumpRel(relPage, iso){
  closeDetail();
  switchPage(relPage);
  if(relPage==='pipeline'){ $('kwInput').value=iso; doPipeQuery(); }
  else if(relPage==='support'){ $('supportKw').value=iso; doSupportQuery(); }
  else if(relPage==='valve'){ $('valveKw').value=iso; doValveQuery(); }
}

/* ---------- 快捷键盘 ---------- */
function buildKeys(){
  const keys='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('');
  $('keys').innerHTML=keys.map(k=>`<div class="key" data-k="${k}">${k}</div>`).join('');
}

/* ---------- 事件绑定 ---------- */
function bind(){
  $('tabbar').addEventListener('click',e=>{
    const t=e.target.closest('.tab-item'); if(t) switchPage(t.dataset.page);
  });
  // 工作量页子tab + 日期查询
  document.querySelectorAll('.work-tab').forEach(t=>t.addEventListener('click',()=>switchWorkTab(t.dataset.wtab)));
  $('dateQuery').addEventListener('click',()=>renderWorkDaily($('dateFrom').value,$('dateTo').value));
  // 工作台 · 数据管理控制台
  $('openWorkConsole').addEventListener('click',openWorkConsole);
  $('workClose').addEventListener('click',closeWorkConsole);
  $('workMask').addEventListener('click',closeWorkConsole);
  $('workExport').addEventListener('click',exportWorkRows);
  $('wfQuery').addEventListener('click',()=>{
    workFilter={from:$('wfFrom').value||'',to:$('wfTo').value||''};
    renderWorkConsole();
    if(!workFilter.from && !workFilter.to) workStatus('请至少选择开始或结束日期后再查询',true);
    else workStatus('已筛选：'+(workFilter.from||'不限')+' ~ '+(workFilter.to||'不限')+'，共 '+workVisible().length+' 条');
  });
  $('wfClear').addEventListener('click',()=>{
    $('wfFrom').value=''; $('wfTo').value=''; workFilter={from:'',to:''};
    renderWorkConsole(); workStatus('已清除筛选，显示全部 '+workRows.length+' 条记录');
  });
  $('wfApplyDate').addEventListener('click',()=>{
    const d=$('wfUnify').value;
    if(!d){ toast('请先选择统一日期'); return; }
    const vis=workVisible();
    if(!vis.length){ toast('当前没有可修改的记录'); return; }
    if(!confirm('把当前 '+vis.length+' 行的日期统一改为 '+d+' ？')) return;
    vis.forEach(r=>{ r.date=d; });
    workSaveLocal(); renderWorkConsole();
    vis.forEach(workPush);
    workStatus('已把 '+vis.length+' 行日期统一为 '+d);
  });
  $('workTbody').addEventListener('click',e=>{
    if(e.target.closest('#workAdd')){ addWorkRow(); return; }
    const d=e.target.closest('[data-wdel]');
    if(d) deleteWorkRow(d.dataset.wdel);
  });
  $('workTbody').addEventListener('input',onWorkEdit);
  $('workTbody').addEventListener('change',onWorkEdit);
  // 管线
  $('btnSearch').addEventListener('click',doPipeQuery);
  $('kwInput').addEventListener('keydown',e=>{ if(e.key==='Enter') doPipeQuery(); });
  $('kwInput').addEventListener('input',()=>{ if(!$('kwInput').value){ $('pipeList').innerHTML=''; $('pipeEmpty').style.display='block'; $('pipeEmptyMain').textContent='输入管线号开始查询'; } });
  $('areaSelect').addEventListener('change',doPipeQuery);
  $('btnRefresh').addEventListener('click',()=>{
    $('kwInput').value=''; $('areaSelect').value='';
    $('pipeList').innerHTML='';
    $('pipeEmpty').style.display='block';
    $('pipeEmptyMain').textContent='输入管线号开始查询';
  });
  $('btnClear').addEventListener('click',()=>{ $('kwInput').value=''; $('kwInput').focus(); });
  $('keys').addEventListener('click',e=>{
    const k=e.target.closest('.key'); if(!k) return;
    $('kwInput').value += k.dataset.k;
    $('kwInput').focus();
  });
  // 支架页（蓝色）
  $('supportSearch').addEventListener('click',doSupportQuery);
  $('supportKw').addEventListener('keydown',e=>{if(e.key==='Enter')doSupportQuery();});
  $('supportKw').addEventListener('input',()=>{ if(!$('supportKw').value){ $('supportList').innerHTML=''; $('supportEmpty').style.display='block'; } });
  $('supportPrefix').addEventListener('click',e=>{
    const b=e.target.closest('.prefix-btn'); if(!b) return;
    $('supportKw').value=b.dataset.prefix; doSupportQuery();
  });
  $('supportRefresh').addEventListener('click',()=>{
    $('supportKw').value=''; $('supportList').innerHTML=''; $('supportEmpty').style.display='block';
  });
  // 阀门页（青色）
  $('valveSearch').addEventListener('click',doValveQuery);
  $('valveKw').addEventListener('keydown',e=>{if(e.key==='Enter')doValveQuery();});
  $('valveKw').addEventListener('input',()=>{ if(!$('valveKw').value){ $('valveEmpty').style.display='block'; $('valveResult').style.display='none'; } });
  $('valvePrefix').addEventListener('click',e=>{
    const b=e.target.closest('[data-vprefix]'); if(!b) return;
    $('valveKw').value=b.dataset.vprefix; doValveQuery();
  });
  $('valveRefresh').addEventListener('click',()=>{
    $('valveKw').value=''; $('valveEmpty').style.display='block'; $('valveResult').style.display='none';
  });
  $('valveSpecKw').addEventListener('input',()=>{
    // 规格内二次搜索：基于当前查询结果 valveQueryRes
    renderValveSpec(valveQueryRes);
  });
  $('valveSpecList').addEventListener('click',e=>{
    const more=e.target.closest('[data-more]'); if(!more) return;
    const grp=valveGroups.find(g=>g.code===more.dataset.more);
    if(grp && grp.rows.length) openDetail('valve', grp.rows[0], false);
  });
  // 壁厚规格查询器
  ['dnSmall','dnMid','dnLarge'].forEach(id=>{
    $(id).addEventListener('click',e=>{
      const b=e.target.closest('[data-dn]'); if(!b) return;
      wallSelDn=b.dataset.dn; buildWallUI();
    });
  });
  $('schGrid').addEventListener('click',e=>{
    const b=e.target.closest('[data-sch]'); if(!b) return;
    wallSelSch=b.dataset.sch; buildWallUI();
  });
  // 弯头计算器
  $('elbowCalc').addEventListener('click',calcElbow);
  $('elbowReset').addEventListener('click',resetElbow);
  $('elbowNps').addEventListener('change',()=>{ $('elbowManual').value=''; calcElbow(); });
  $('elbowAngle').addEventListener('input',calcElbow);
  $('elbowManual').addEventListener('input',calcElbow);
  $('elbowAngle').addEventListener('keydown',e=>{if(e.key==='Enter')calcElbow();});
  $('elbowManual').addEventListener('keydown',e=>{if(e.key==='Enter')calcElbow();});
  // 卡片点击 -> 详情
  // 管线详细卡片内的按钮
  $('pipeList').addEventListener('click',e=>{
    const rel=e.target.closest('[data-rel]');
    if(rel){ e.stopPropagation(); showRelList(rel.dataset.rel, rel.dataset.iso, rel.dataset.line); return; }
    const cp=e.target.closest('[data-copy]');
    if(cp){ e.stopPropagation(); copyText(cp.dataset.copy); return; }
    const dw=e.target.closest('[data-drawing]');
    if(dw){ e.stopPropagation(); alert('图纸文件：'+dw.dataset.drawing+'\n\n当前为离线数据查询工具，图纸 PDF/DWG 请用图纸工具箱打开。'); return; }
    const ad=e.target.closest('[data-add]');
    if(ad){ e.stopPropagation(); alert('添加尾项：'+ad.dataset.add+'\n\n该功能需连接后台数据库，当前离线版本暂未开放。'); return; }
    const wc=e.target.closest('.weld-chip');
    if(wc){ e.stopPropagation(); doWeldQuery(wc.dataset.weld, wc.dataset.rows); return; }
    const card=e.target.closest('.pipe-card');
    if(card) openDetail('pipeline', +card.dataset.i, false);
  });
  // 支架卡片（蓝色）
  $('supportList').addEventListener('click',e=>{
    const dw=e.target.closest('[data-drawing]');
    if(dw){ e.stopPropagation(); alert('图纸文件：'+dw.dataset.drawing+'\n\n请用图纸工具箱打开。'); return; }
    // 备注区内的任何点击都不打开详情（输入框/按钮）
    const cn=e.target.closest('.cloud-note');
    if(cn){
      e.stopPropagation();
      const sv=e.target.closest('[data-save-note]');
      if(sv) saveNote(sv.dataset.saveKind||'support', sv.dataset.saveNote);
      return;
    }
    const card=e.target.closest('.support-card');
    if(card) openDetail('support', +card.dataset.i);
  });
  // 备注控制台
  $('openNoteConsole').addEventListener('click',openNoteConsole);
  $('noteClose').addEventListener('click',closeNoteConsole);
  $('noteMask').addEventListener('click',closeNoteConsole);
  $('noteRefresh').addEventListener('click',renderNoteConsole);
  $('noteExport').addEventListener('click',exportNotes);
  $('noteBody').addEventListener('click',e=>{
    const d=e.target.closest('[data-del-note]');
    if(d) deleteNote(d.dataset.delNote);
  });
  $('detailClose').addEventListener('click',closeDetail);
  $('detailMask').addEventListener('click',closeDetail);
  $('detailBody').addEventListener('click',e=>{
    // 详情里的备注区：拦截冒泡，处理保存
    const cn=e.target.closest('.cloud-note');
    if(cn){
      e.stopPropagation();
      const sv=e.target.closest('[data-save-note]');
      if(sv) saveNote(sv.dataset.saveKind||'support', sv.dataset.saveNote);
      return;
    }
    const back=e.target.closest('#relBackBtn');
    if(back){ if(relBack) showRelList(relBack.page, relBack.iso, relBack.line); return; }
    const pill=e.target.closest('.stage-pill');
    if(pill){ relCtx.stage=pill.dataset.stage; renderSupportRel(); return; }
    if(e.target.closest('#relCopyAll')){
      const all=relCtx.stage ? (idx.iso.S[relCtx.iso]||[]).filter(i=>supStage(S.rows[i])===relCtx.stage) : (idx.iso.S[relCtx.iso]||[]);
      const txt=all.map((i,k)=>`${k+1}. ${String(S.rows[i][idx.sNo]||'')}  ${supStage(S.rows[i])}`).join('\n');
      copyText(txt); return;
    }
    if(e.target.closest('#relRefresh')){ renderSupportRel(); toast('状态已刷新'); return; }
    const item=e.target.closest('.rel-item');
    if(item){ openDetail(item.dataset.open, +item.dataset.i, true); return; }
    const b=e.target.closest('.rel-btn');
    if(b){
      if(b.dataset.rel==='pipeline') jumpRel(b.dataset.rel,b.dataset.iso);
      else showRelList(b.dataset.rel, b.dataset.iso);
    }
  });
  // 设置弹层（姓名 / 服务器地址 / 数据版本）
  $('nameBtn').addEventListener('click',openCfg);
  $('cfgClose').addEventListener('click',closeCfg);
  $('cfgMask').addEventListener('click',closeCfg);
  $('cfgSave').addEventListener('click',()=>{
    localStorage.setItem('pipeUser',$('cfgName').value.trim());
    localStorage.setItem('pipeApiBase',$('cfgApi').value.trim());
    closeCfg(); toast('设置已保存，正在重新连接');
    setTimeout(()=>location.reload(),700);
  });
  $('cfgCheck').addEventListener('click',async()=>{
    if(!apiOrigin()){ toast('请先在上方填写服务器地址'); return; }
    toast('正在检查云端数据…');
    bootSyncAbort=false;
    const changed=await syncFromCloud();
    await renderCfgVersion();
    if(changed){ toast('已拉到新数据，正在刷新'); setTimeout(()=>location.reload(),900); }
    else toast('已是最新数据');
  });
  $('cfgReset').addEventListener('click',async()=>{
    if(!confirm('恢复为 APP 内置数据？本机已下载的云端数据将被清除。')) return;
    for(const n of DS_NAMES) await cacheDel('ds_'+n);
    toast('已清除本机缓存，正在刷新');
    setTimeout(()=>location.reload(),700);
  });
  // 三个页面的「导入新表格」
  document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>{
    importTarget=b.dataset.import;
    $('excelFile').value='';
    $('excelFile').click();
  }));
  $('excelFile').addEventListener('change',e=>{
    const f=e.target.files && e.target.files[0];
    if(f) importExcel(f,importTarget);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ closeDetail(); closeNoteConsole(); closeWorkConsole(); closeCfg(); }
  });
}

/* ---------- 启动 ---------- */
function init(){
  buildIndex();
  fillSelect($('areaSelect'), idx.areas, '全部');
  const uniqueLines = new Set(P.rows.map(r=>r[idx.pLine]).filter(Boolean)).size;
  if($('pipeCount')) $('pipeCount').textContent=uniqueLines.toLocaleString();
  if($('pipeCount2')) $('pipeCount2').textContent=uniqueLines.toLocaleString();
  if($('supportCount')) $('supportCount').textContent=S.rows.length.toLocaleString();
  buildKeys();
  buildSupportPrefix();
  renderSupportOverview();
  valvePrefix();
  renderValveOverview();
  buildWallUI();
  buildNpsSelect();
  calcElbow();
  bind();
  $('pageTitle').textContent='管线';
  $('topRight').style.visibility='visible';
  // 现场备注：先读本机，离线也能看和导出
  noteLoadLocal();
  // 工作台：先读本机记录，再准备区域下拉提示
  workLoadLocal();
  updateWorkBadge();
  const dl=document.createElement('datalist'); dl.id='wcAreas';
  dl.innerHTML=(idx.areas||[]).slice(0,80).map(a=>'<option value="'+esc(a)+'"></option>').join('');
  $('workPanel').appendChild(dl);
  // 云端探测（本地 file:// 自动离线降级）：可用时合并云端数据并补传待上传内容
  initCloud().then(ok=>{
    if(!ok) return;
    loadNotes().then(()=>flushNotes()).catch(()=>{});
    workInitCloud().then(()=>{ if($('workPanel').classList.contains('show')) renderWorkConsole(); }).catch(()=>{});
  }).catch(()=>{});
  // 网络恢复或定时重试：把「待上传」的备注自动推到后台
  window.addEventListener('online',()=>{
    initCloud().then(ok=>{ if(ok) loadNotes().then(()=>flushNotes()).catch(()=>{}); }).catch(()=>{});
  });
  setInterval(()=>{ if(navigator.onLine!==false) flushNotes(); },30000);
}
async function boot(){
  $('loadingMsg').textContent='正在检查云端数据更新…';
  $('loadingBar').style.width='12%';
  // 准备阶段整体限时 8 秒：无论缓存/网络是否可用，都必须进入主界面
  const prepare=(async()=>{
    try{ await loadCachedData(); }catch(e){ console.warn('本地缓存读取失败',e); }
    $('loadingBar').style.width='28%';
    try{ await syncFromCloud(); }catch(e){ console.warn('云端同步跳过',e); }
  })();
  await Promise.race([
    prepare.catch(()=>{}),
    new Promise(r=>setTimeout(()=>{ bootSyncAbort=true; r(); },8000))
  ]);
  $('loadingMsg').textContent='正在解析数据（约 23 MB），请稍候…';
  $('loadingBar').style.width='55%';
  setTimeout(()=>{
    try{ init(); $('loadingBar').style.width='100%'; $('loadingMsg').textContent='加载完成'; setTimeout(()=>{$('loading').style.display='none';},300); }
    catch(err){ $('loadingMsg').innerHTML='<span style="color:#ffd0d0">加载失败：'+esc(err.message)+'</span>'; console.error(err); }
  },50);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
