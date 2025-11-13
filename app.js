// ==============================
//  STOCK – Óptica Bs As (v1)
// ==============================

// --- CONFIG ---
const API = 'https://script.google.com/macros/s/AKfycbxtrNeXKm41RjLD8eVByCHsiXd3cqH6SLkE7Cpoop8KYKq6Ly-WPJtzM8-SEUMptlsbrw/exec';
const CACHE_KEY = 'stock_bsas_cache_v1';
const CACHE_TTL_MIN = 30; // minutos
const AUTO_REFRESH_MIN = 5; // refresco silencioso en segundo plano

// Traducción de encabezados de Sheet -> claves internas
const MAP = {
  'N ANTEOJO': 'n_anteojo',
  'N° ANTEOJO': 'n_anteojo',
  'NUMERO': 'n_anteojo',
  'N ANTEOJOS': 'n_anteojo',
  'MARCA': 'marca',
  'MODELO': 'modelo',
  'COLOR': 'color',
  'ARMAZON': 'armazon',
  'ARMAZÓN': 'armazon',
  'FAMILIA': 'familia',
  'CRISTAL': 'cristal_color',
  'CRISTAL / COLOR': 'cristal_color',
  'COLOR CRISTAL': 'cristal_color',
  'CALIBRE': 'calibre',
  'PRECIO PUBLICO': 'precio',
  'PRECIO PÚBLICO': 'precio',
  'PRECIO PUBLICO (LISTA)': 'precio',
  'FECHA INGRESO': 'fecha_ingreso',
  'INGRESO': 'fecha_ingreso',
  'FECHA DE VENTA': 'fecha_venta',
  'VENTA': 'fecha_venta',
  'VENDEDOR': 'vendedor',
  'CODIGO DE BARRAS': 'codigo_barras',
  'CÓDIGO DE BARRAS': 'codigo_barras',
  'OBSERVACIONES': 'observaciones',
  'FABRICA': 'fabrica',
  'FÁBRICA': 'fabrica',
};

// --- SHORTCUTS/HELPERS DOM ---
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- UTILIDADES ---
function onlyDigits(s){ return String(s||'').replace(/\D+/g,''); }

function normHeader(h){
  return String(h||'')
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase();
}

function norm(s){
  return String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();
}

function esc(s){
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function setStatus(msg, color){
  const el = $('#status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = color || 'var(--accent)';
}

function setLastSync(ts){
  const el = $('#lastSync'); if (!el) return;
  el.textContent = ts ? `Actualizado: ${new Date(ts).toLocaleString('es-AR')}` : '';
}

function debounce(fn, ms=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// --- FORMATEOS ---
function formatMoney(v){
  if (v == null || v === '') return '';
  const num = Number(String(v).replace(/\./g,'').replace(',', '.'));
  if (Number.isNaN(num)) return v;
  return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function toDate(s){
  if (!s) return null;
  if (s instanceof Date) return s;
  if (typeof s === 'number') { const d = new Date(s); return isNaN(d) ? null : d; }
  const str = String(s).trim();

  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m){
    const d=parseInt(m[1],10),mo=parseInt(m[2],10)-1,yy=m[3].length===2?2000+parseInt(m[3],10):parseInt(m[3],10);
    return new Date(yy,mo,d);
  }

  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m){
    const yy=parseInt(m[1],10),mo=parseInt(m[2],10)-1,d=parseInt(m[3],10);
    return new Date(yy,mo,d);
  }

  const d2 = new Date(str); return isNaN(d2) ? null : d2;
}

function formatShortDate(s){ const d = toDate(s); return d ? d.toLocaleDateString('es-AR') : ''; }

// --- RESALTADO TOLERANTE A TILDES ---
function tokenToRegexFrag(t){
  return esc(t)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/a/gi, '[aáàäâã]')
    .replace(/e/gi, '[eéèêë]')
    .replace(/i/gi, '[iíïìî]')
    .replace(/o/gi, '[oóòôöõ]')
    .replace(/u/gi, '[uúùûü]')
    .replace(/n/gi, '[nñ]')
    .replace(/c/gi, '[cç]');
}

function highlightText(str, tokensRaw){
  if (str == null || str === '') return '';
  let s = String(str);
  const toks = (tokensRaw||[]).map(t=>String(t).trim()).filter(Boolean);
  if (!toks.length) return esc(s);
  toks.sort((a,b)=>b.length-a.length);
  for (const t of toks){
    const frag = tokenToRegexFrag(t);
    const re = new RegExp(`(${frag})`, 'gi');
    s = s.replace(re, '\u0001$1\u0002');
  }
  s = esc(s).replace(/\u0001/g, '<span class="hl">').replace(/\u0002/g, '</span>');
  return s;
}

// --- SPINNER ---
let LOADING = 0;
function setLoading(on){
  const sp = $('#spinner'); if (!sp) return;
  LOADING = Math.max(0, LOADING + (on ? 1 : -1));
  const show = LOADING > 0;
  sp.hidden = !show;
  if (show) sp.classList.add('show'); else sp.classList.remove('show');
}
function hideSpinnerNow(){ LOADING=0; const sp=$('#spinner'); if(sp){ sp.hidden=true; sp.classList.remove('show'); } }
function loadingFailsafe(){ setTimeout(()=>hideSpinnerNow(), 12000); }

// --- ESTADO GLOBAL ---
let DATA = [];
let sortKey = 'n_anteojo';
let sortDir = 'asc';

// --- INDEX DE BÚSQUEDA ---
function buildIndex(arr){
  arr.forEach(r=>{
    r.__q = norm([
      r.n_anteojo, r.marca, r.modelo, r.color,
      r.familia, r.cristal_color, r.calibre, r.codigo_barras, r.vendedor
    ].join(' '));
  });
}

// --- RENDER ---
function render(rows, tokensRaw){
  const tbody = $('#tbody');
  tbody.innerHTML = '';

  if (!rows.length){
    $('#empty').hidden = false;
    $('#count').textContent = '0 resultados';
    hideSpinnerNow();
    return;
  }

  $('#empty').hidden = true;
  $('#count').textContent = `${rows.length} resultado${rows.length!==1?'s':''}`;

  const frag = document.createDocumentFragment();
  for (const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${highlightText(r.n_anteojo, tokensRaw)}</td>
      <td>${highlightText(r.marca, tokensRaw)}</td>
      <td>${highlightText(r.modelo, tokensRaw)}</td>
      <td>${highlightText(r.color, tokensRaw)}</td>
      <td>${highlightText(r.familia, tokensRaw)}</td>
      <td>${highlightText(r.cristal_color, tokensRaw)}</td>
      <td>${highlightText(r.calibre, tokensRaw)}</td>
      <td>${highlightText(formatMoney(r.precio), tokensRaw)}</td>
      <td>${highlightText(formatShortDate(r.fecha_ingreso), tokensRaw)}</td>
      <td>${highlightText(formatShortDate(r.fecha_venta), tokensRaw)}</td>
      <td>${highlightText(r.vendedor, tokensRaw)}</td>
      <td>${highlightText(r.codigo_barras, tokensRaw)}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  hideSpinnerNow();
}

// --- ORDEN ---
function sortRows(rows, key, dir='asc'){
  const mult = dir==='asc' ? 1 : -1;
  return [...rows].sort((a,b)=>{
    if (key==='n_anteojo' || key==='calibre' || key==='precio'){
      const na = Number(a[key]) || 0;
      const nb = Number(b[key]) || 0;
      return (na - nb) * mult;
    }
    if (key==='fecha_ingreso' || key==='fecha_venta'){
      const da = toDate(a[key]); const ta = da ? da.getTime() : 0;
      const db = toDate(b[key]); const tb = db ? db.getTime() : 0;
      return (ta - tb) * mult;
    }
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    if (va<vb) return -1*mult;
    if (va>vb) return  1*mult;
    return 0;
  });
}

function updateSortIndicators(){
  $$('#tabla thead th').forEach(th=>{
    th.classList.remove('active','asc','desc');
  });
  const th = $(`#tabla thead th[data-sort="${sortKey}"]`);
  if (th){
    th.classList.add('active', sortDir==='asc'?'asc':'desc');
  }
}

// --- FILTRO / BUSCADOR ---
function getFilterTokensAndState(){
  const qraw   = $('#q').value.trim();
  const fam    = $('#familia').value;
  const estado = $('#estadoVenta').value;

  const parts = qraw ? (qraw.match(/"[^"]+"|\S+/g) || []) : [];
  const exactNums = [];
  const freeTokens = [];
  const highlightTokens = [];

  for (const p of parts){
    const s = p.trim();
    let m = s.match(/^[#@](\d+)$/);
    if (m){ exactNums.push(m[1]); highlightTokens.push(m[1]); continue; }
    m = s.match(/^"(\d+)"$/);
    if (m){ exactNums.push(m[1]); highlightTokens.push(m[1]); continue; }
    freeTokens.push(s);
    highlightTokens.push(s.replace(/^["']|["']$/g,''));
  }

  return { fam, estado, exactNums, freeTokens, highlightTokens };
}

function applyFilters(baseRows, { fam, estado, exactNums, freeTokens }){
  let rows = baseRows;

  if (exactNums.length){
    rows = rows.filter(r=>{
      const n = onlyDigits(r.n_anteojo);
      return exactNums.every(x => onlyDigits(x) === n);
    });
  }

  if (freeTokens.length){
    const tokens = freeTokens.map(norm).filter(Boolean);
    rows = rows.filter(r=> tokens.every(t => (r.__q||'').includes(t)));
  }

  if (fam){ rows = rows.filter(r => (r.familia||'').toUpperCase() === fam); }
  if (estado){
    if (estado==='DISPONIBLE') rows = rows.filter(r => !r.fecha_venta);
    if (estado==='VENDIDO')    rows = rows.filter(r => !!r.fecha_venta);
  }
  return rows;
}

function filterRows(){
  hideSpinnerNow();
  const state = getFilterTokensAndState();
  let rows = applyFilters(DATA, state);
  rows = sortRows(rows, sortKey, sortDir);
  render(rows, state.highlightTokens);
  updateSortIndicators();
}

// --- CACHE ---
function getCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const ageMin = (Date.now() - obj.ts) / 60000;
    if (ageMin > CACHE_TTL_MIN) return null;
    return obj;
  }catch{ return null; }
}
function setCache(data){
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
}
function clearCacheAndReload(){
  localStorage.removeItem(CACHE_KEY);
  fetchAll();
}

// --- FETCH ---
let FETCHING = false;
async function fetchAll(){
  if (FETCHING) return;
  FETCHING = true;

  setLoading(true);
  setStatus('Cargando…');
  loadingFailsafe();

  try{
    const res = await fetch(`${API}?todos=true`, { method:'GET' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    let rows = [];

    if (json && Array.isArray(json.rows)) {
      const headers = (json.headers || []).map(h => String(h||'').trim());
      const dynamicMap = {};
      headers.forEach(h=>{
        const k = normHeader(h);
        if (MAP[k]) dynamicMap[h] = MAP[k];
      });

      rows = json.rows.map(r=>{
        const rec = (r && typeof r === 'object' && !Array.isArray(r)) ? r
                 : (Array.isArray(r) ? Object.fromEntries(headers.map((h,i)=>[h, r[i]])) : {});
        const o = {};
        for (const h of Object.keys(rec)){
          const key = dynamicMap[h] || MAP[normHeader(h)];
          if (key) o[key] = rec[h];
        }
        return o;
      });

    } else if (Array.isArray(json)) {
      rows = json;
    } else {
      throw new Error('Formato de respuesta inesperado');
    }

    rows = rows.filter(r => {
      const nOk = /\d/.test(String(r.n_anteojo || '').trim());
      const infoOk = (r.marca || r.modelo || r.color || r.codigo_barras);
      return nOk || infoOk;
    });

    DATA = rows;
    buildIndex(DATA);
    setCache(DATA);
    setLastSync(Date.now());
    setStatus('Listo', 'var(--accent)');

  }catch(e){
    console.error('fetchAll error:', e);
    setStatus('Error al cargar. Uso copia local si existe.', 'var(--danger)');
    const cached = getCache();
    if (cached){
      DATA = cached.data;
      buildIndex(DATA);
      setLastSync(cached.ts);
    } else {
      DATA = [];
    }
  }finally{
    FETCHING = false;
    setLoading(false);
    filterRows();
  }
}

// --- EXPORTAR A PDF ---
function buildHtmlTable(rows){
  const th = `
    <tr>
      <th style="text-align:left;">N°</th>
      <th style="text-align:left;">Marca</th>
      <th style="text-align:left;">Modelo</th>
      <th style="text-align:left;">Color</th>
      <th style="text-align:left;">Familia</th>
      <th style="text-align:right;">Calibre</th>
      <th style="text-align:right;">Precio</th>
      <th style="text-align:left;">Ingreso</th>
      <th style="text-align:left;">Venta</th>
      <th style="text-align:left;">Vendedor</th>
    </tr>`;
  const trs = rows.map(r => `
    <tr>
      <td>${esc(r.n_anteojo||'')}</td>
      <td>${esc(r.marca||'')}</td>
      <td>${esc(r.modelo||'')}</td>
      <td>${esc(r.color||'')}</td>
      <td>${esc(r.familia||'')}</td>
      <td style="text-align:right;">${esc(r.calibre||'')}</td>
      <td style="text-align:right;">${esc(formatMoney(r.precio)||'')}</td>
      <td>${esc(formatShortDate(r.fecha_ingreso)||'')}</td>
      <td>${esc(formatShortDate(r.fecha_venta)||'')}</td>
      <td>${esc(r.vendedor||'')}</td>
    </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead style="background:#f3f4f6;">${th}</thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function exportPdfFor(estadoFijo){
  const state = getFilterTokensAndState();
  state.estado = estadoFijo; // override
  let rows = applyFilters(DATA, state);
  rows = sortRows(rows, sortKey, sortDir);

  const titulo = estadoFijo==='VENDIDO' ? 'Listado de VENDIDOS' : 'Listado de DISPONIBLES';
  const fecha = new Date().toLocaleString('es-AR');

  const html = `
<!doctype html><html><head>
<meta charset="utf-8">
<title>${titulo}</title>
<style>
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin:24px; color:#111827; }
  h1{ margin:0 0 6px 0; font-size:18px; }
  .muted{ color:#6b7280; font-size:12px; margin-bottom:14px; }
  table{ width:100%; border-collapse:collapse; }
  th,td{ border-bottom:1px solid #e5e7eb; padding:6px 8px; }
  thead th{ background:#f8fafc; }
  @media print{ @page { size:A4; margin:14mm; } }
</style>
</head><body>
  <h1>${titulo}</h1>
  <div class="muted">${fecha} — ${rows.length} resultado${rows.length!==1?'s':''}</div>
  ${buildHtmlTable(rows)}
  <script>window.onload=()=>{ window.print(); setTimeout(()=>window.close(), 500); };</script>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.open('text/html');
  w.document.write(html);
  w.document.close();
}

// --- INIT / EVENTOS ---
function attachEvents(){
  $('#q').addEventListener('input', debounce(filterRows, 180));
  $('#familia').addEventListener('change', filterRows);
  $('#estadoVenta').addEventListener('change', filterRows);

  $('#clearBtn').addEventListener('click', ()=>{
    $('#q').value = '';
    $('#familia').value = '';
    $('#estadoVenta').value = '';
    filterRows();
  });

  $('#reloadBtn').addEventListener('click', ()=> fetchAll());
  const forceBtn = $('#forceBtn');
  if (forceBtn) forceBtn.addEventListener('click', ()=> clearCacheAndReload());

  const expV = $('#expVendidosBtn');
  const expD = $('#expDisponiblesBtn');
  if (expV) expV.addEventListener('click', ()=> exportPdfFor('VENDIDO'));
  if (expD) expD.addEventListener('click', ()=> exportPdfFor('DISPONIBLE'));

  $$('#tabla thead th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.getAttribute('data-sort');
      if (sortKey === key) {
        sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      filterRows();
    });
  });
}

// Autostart
(function start(){
  attachEvents();

  const cached = getCache();
  if (cached){
    DATA = cached.data;
    buildIndex(DATA);
    setLastSync(cached.ts);
    filterRows();
    fetchAll(); // refresco silencioso
  } else {
    fetchAll();
  }

  setInterval(()=>{
    const cachedNow = getCache();
    if (cachedNow){ setLastSync(cachedNow.ts); }
    fetchAll();
  }, AUTO_REFRESH_MIN * 60 * 1000);
})();
