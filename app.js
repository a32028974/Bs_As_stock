// ==============================
//  STOCK – Óptica Bs As (v1)
// ==============================

// --- CONFIG ---
const API = 'https://script.google.com/macros/s/AKfycbxtrNeXKm41RjLD8eVByCHsiXd3cqH6SLkE7Cpoop8KYKq6Ly-WPJtzM8-SEUMptlsbrw/exec';
const CACHE_KEY = 'stock_cache_bsas_v1';
const CACHE_TTL_MIN = 15; // <— bajé el TTL (antes 30).
const AUTO_REFRESH_MIN = 5; // refresco silencioso en segundo plano

// Traducción de encabezados de Sheet -> claves internas
const MAP = {
  'N ANTEOJO': 'n_anteojo',
  'N° ANTEOJO': 'n_anteojo',
  'NUMERO': 'n_anteojo',
  'MARCA': 'marca',
  'MODELO': 'modelo',
  'COLOR': 'color',
  'FAMILIA': 'familia',
  'CRISTAL': 'cristal_color',
  'COLOR CRISTAL': 'cristal_color',
  'CALIBRE': 'calibre',
  'PRECIO PUBLICO': 'precio',
  'PRECIO PÚBLICO': 'precio',
  'FECHA INGRESO': 'fecha_ingreso',
  'INGRESO': 'fecha_ingreso',
  'FECHA DE VENTA': 'fecha_venta',
  'VENTA': 'fecha_venta',
  'VENDEDOR': 'vendedor',
  'CODIGO DE BARRAS': 'codigo_barras',
  'CÓDIGO DE BARRAS': 'codigo_barras',
  'OBSERVACIONES': 'observaciones',
  'ARMAZON': 'armazon',
  'ARMAZÓN': 'armazon',
  'FABRICA': 'fabrica',
  'FÁBRICA': 'fabrica',
};

// --- SHORTCUTS/HELPERS DOM ---
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Escapar HTML básico
function esc(s){
  return String(s ?? '')
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
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatDate(v){
  if (!v) return '';
  if (v instanceof Date){
    return v.toLocaleDateString('es-AR');
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isNaN(n)){
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toLocaleDateString('es-AR');
  }
  return s;
}

// --- CACHE ---
function getCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts || !obj.rows) return null;
    const ageMin = (Date.now() - obj.ts) / 60000;
    if (ageMin > CACHE_TTL_MIN) return null;
    return obj;
  } catch(e){
    return null;
  }
}
function setCache(rows){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows }));
  } catch(e){}
}

// --- ESTADO / CARGA ---
let ALL_ROWS = [];
let FETCHING = false;
let LOADING_TIMEOUT = null;

function setLoading(isLoading){
  const spinner = $('#spinner');
  if (!spinner) return;
  spinner.hidden = !isLoading;
}
function loadingFailsafe(){
  clearTimeout(LOADING_TIMEOUT);
  LOADING_TIMEOUT = setTimeout(()=>{
    setLoading(false);
  }, 30000);
}

// Normalizar encabezados
function normHeader(h){
  return String(h || '').trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[ÁÀÄ]/g,'A')
    .replace(/[ÉÈË]/g,'E')
    .replace(/[ÍÌÏ]/g,'I')
    .replace(/[ÓÒÖ]/g,'O')
    .replace(/[ÚÙÜ]/g,'U')
    .replace(/Ñ/g,'N');
}

// --- BUSQUEDA Y FILTROS ---
let searchTerm = '';
let familiaFilter = 'todas';

function tokenToRegexFrag(token){
  return String(token)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/a/gi, '[aáä]')
    .replace(/e/gi, '[eéë]')
    .replace(/i/gi, '[iíï]')
    .replace(/o/gi, '[oóö]')
    .replace(/u/gi, '[uúü]')
    .replace(/n/gi, '[nñ]')
    .replace(/c/gi, '[cç]');
}

function highlightText(str, tokensRaw){
  if (str == null || str === '') return '';
  let s = String(str);
  const toks = (tokensRaw || []).map(t => String(t).trim()).filter(Boolean);
  if (!toks.length) return esc(s);
  toks.sort((a,b) => b.length - a.length);
  for (const t of toks){
    const frag = tokenToRegexFrag(t);
    const re = new RegExp(`(${frag})`, 'gi');
    s = s.replace(re, '\u0001$1\u0002');
  }
  s = esc(s);
  s = s.replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
  return s;
}

function applyFilters(){
  const term = searchTerm.trim();
  const tokens = term ? term.split(/\s+/) : [];
  const familia = familiaFilter;

  let rows = ALL_ROWS.slice();

  if (familia && familia !== 'todas'){
    const famUpper = familia.toUpperCase();
    rows = rows.filter(r => String(r.familia || '').toUpperCase().includes(famUpper));
  }

  if (tokens.length){
    rows = rows.filter(r => {
      const str = [
        r.n_anteojo, r.marca, r.modelo, r.color,
        r.cristal_color, r.familia, r.codigo_barras,
        r.armazon, r.fabrica
      ].map(x => String(x || '').toUpperCase()).join(' ');
      return tokens.every(t => str.includes(String(t).toUpperCase()));
    });
  }

  renderRows(rows, tokens);
}

function renderRows(rows, tokens){
  const tbody = $('#tbody');
  const empty = $('#empty');
  if (!tbody || !empty) return;

  if (!rows.length){
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  const frag = document.createDocumentFragment();
  rows.forEach(r => {
    const tr = document.createElement('tr');

    const tdNum = document.createElement('td');
    tdNum.innerHTML = highlightText(r.n_anteojo ?? '', tokens);
    tdNum.className = 'col-num';

    const tdMarca = document.createElement('td');
    tdMarca.innerHTML = highlightText(r.marca ?? '', tokens);

    const tdModelo = document.createElement('td');
    tdModelo.innerHTML = highlightText(r.modelo ?? '', tokens);

    const tdColor = document.createElement('td');
    tdColor.innerHTML = highlightText(r.color ?? '', tokens);

    const tdArmazon = document.createElement('td');
    tdArmazon.innerHTML = highlightText(r.armazon ?? '', tokens);

    const tdCalibre = document.createElement('td');
    tdCalibre.innerHTML = highlightText(r.calibre ?? '', tokens);
    tdCalibre.className = 'col-calibre';

    const tdCristal = document.createElement('td');
    tdCristal.innerHTML = highlightText(r.cristal_color ?? '', tokens);

    const tdFamilia = document.createElement('td');
    tdFamilia.innerHTML = highlightText(r.familia ?? '', tokens);
    tdFamilia.className = 'col-familia';

    const tdPrecio = document.createElement('td');
    tdPrecio.textContent = formatMoney(r.precio);
    tdPrecio.className = 'col-precio';

    const tdIngreso = document.createElement('td');
    tdIngreso.textContent = formatDate(r.fecha_ingreso);
    tdIngreso.className = 'col-fecha';

    const tdVenta = document.createElement('td');
    tdVenta.textContent = formatDate(r.fecha_venta);
    tdVenta.className = 'col-fecha';

    const tdVend = document.createElement('td');
    tdVend.textContent = r.vendedor || '';
    tdVend.className = 'col-vendedor';

    const tdCod = document.createElement('td');
    tdCod.innerHTML = highlightText(r.codigo_barras ?? '', tokens);
    tdCod.className = 'col-codigo';

    const tdObs = document.createElement('td');
    tdObs.innerHTML = highlightText(r.observaciones ?? '', tokens);
    tdObs.className = 'col-obs';

    tr.append(
      tdNum, tdMarca, tdModelo, tdColor,
      tdArmazon, tdCalibre, tdCristal, tdFamilia,
      tdPrecio, tdIngreso, tdVenta, tdVend, tdCod, tdObs
    );

    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

// --- FETCH ---
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
      return nOk && infoOk;
    });

    ALL_ROWS = rows;
    setCache(rows);
    setLastSync(Date.now());
    setStatus(`Cargados ${rows.length} registros`);
    applyFilters();

  } catch(err){
    console.error(err);
    setStatus('Error al cargar datos: ' + err.message, 'var(--danger)');
  } finally {
    setLoading(false);
    clearTimeout(LOADING_TIMEOUT);
    FETCHING = false;
  }
}

// --- INIT ---
(function init(){
  const searchInput = $('#search');
  const familiaSelect = $('#familia');

  if (searchInput){
    searchInput.addEventListener('input', debounce(e=>{
      searchTerm = e.target.value || '';
      applyFilters();
    }, 200));
  }

  if (familiaSelect){
    familiaSelect.addEventListener('change', e=>{
      familiaFilter = e.target.value || 'todas';
      applyFilters();
    });
  }

  const cached = getCache();
  if (cached){
    ALL_ROWS = cached.rows || [];
    setLastSync(cached.ts);
    setStatus(`Cargados ${ALL_ROWS.length} registros (desde caché)`);
    applyFilters();
    fetchAll(); // refresco silencioso
  } else {
    fetchAll();
  }

  // Auto refresh
  setInterval(()=>{
    const cachedNow = getCache();
    if (cachedNow){ setLastSync(cachedNow.ts); }
    fetchAll();
  }, AUTO_REFRESH_MIN * 60 * 1000);
})();
