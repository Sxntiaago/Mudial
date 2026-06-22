
// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const API_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
const POLL_MS  = 60000;

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL STATE – live API data
// ═══════════════════════════════════════════════════════════════════
let allMatches  = [];
let groupMap    = {};   // "Group A" -> [match,...]
let groupOrder  = [];   // ["Group A","Group B",...]
let autoEnabled = true;
let pollTimer   = null;

// ═══════════════════════════════════════════════════════════════════
//  BRACKET STATE  (the mundial.html pattern)
//  bracketState[round][matchIdx] = { t1,t2, g1,g2, pen1,pen2, locked }
//  round 0 = R32 (32 → 16, because 2026 has 24 teams so needs 8 byes → simplify as R32)
//  We use 5 rounds: R32(16 matches), R16(8), QF(4), SF(2), F(1)
// ═══════════════════════════════════════════════════════════════════
const ROUND_COUNT = [16, 8, 4, 2, 1];
const ROUND_NAMES = ['Ronda de 32', 'Octavos de Final', 'Cuartos de Final', 'Semifinales', 'Final'];

let bracketState = buildEmptyBracket();
function buildEmptyBracket() {
  return ROUND_COUNT.map(n =>
    Array.from({length: n}, () => ({ t1:'', t2:'', g1:'', g2:'', pen1:'', pen2:'', apiLocked: false }))
  );
}

// FIFA 2026 R32 pairings: [group1, pos1, group2, pos2]
// Official bracket (Groups A-L, 12 groups, top-2 each = 24 + 8 best-3rd)
// Simplified pairing using the confirmed 2026 bracket structure:
// 1A vs 2B, 1C vs 2D, 1E vs 2F, 1G vs 2H, 1I vs 2J, 1K vs 2L,
// 1B vs 2A, 1D vs 2C, 1F vs 2E, 1H vs 2G, 1J vs 2I, 1L vs 2K,
// then 4 best-3rd slots (shown as wildcards)
// Organización visual basada en la llave oficial mostrada en la imagen.
// Los terceros se colocan como marcadores hasta implementar la matriz oficial FIFA.
const R32_PAIRINGS = [
  ['Group E',1,'3rd-1',0],
  ['Group A',2,'Group B',2],
  ['Group F',1,'Group C',2],
  ['Group D',1,'3rd-2',0],
  ['Group G',1,'3rd-3',0],
  ['Group A',1,'3rd-4',0],
  ['Group H',1,'Group I',2],
  ['Group B',1,'3rd-5',0],

  ['Group J',1,'3rd-6',0],
  ['Group F',2,'Group I',1],
  ['Group C',1,'3rd-7',0],
  ['Group D',2,'Group E',2],
  ['Group K',1,'3rd-8',0],
  ['Group G',2,'Group H',2],
  ['Group L',1,'Group J',2],
  ['Group K',2,'Group L',2],
];

// ═══════════════════════════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════════════════════════
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('visible'));
  document.getElementById('section-' + id).classList.add('visible');
  document.querySelectorAll('nav button').forEach((b, i) =>
    b.classList.toggle('active', ['groups','bracket'][i] === id)
  );
  if (id === 'bracket') renderBracket();
}

// ═══════════════════════════════════════════════════════════════════
//  FETCH + PARSE
// ═══════════════════════════════════════════════════════════════════
async function fetchData() {
  try {
    const res = await fetch(API_URL + '?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    processData(data.matches);
    hideError();
  } catch(e) {
    setStatus('error', 'Sin conexión · mostrando últimos datos');
    showError('No se pudo conectar a la API. Se muestran los últimos datos descargados.');
  }
}

function processData(matches) {
  allMatches = matches;
  groupMap   = {};
  groupOrder = [];

  matches.forEach(m => {
    if (m.group) {
      if (!groupMap[m.group]) { groupMap[m.group] = []; groupOrder.push(m.group); }
      groupMap[m.group].push(m);
    }
  });
  groupOrder = [...new Set(groupOrder)].sort();

  // sync API knockout results into bracketState (lock=true so user can't override)
  syncAPIKnockouts(matches);

  renderGroups();
  if (document.getElementById('section-bracket').classList.contains('visible')) renderBracket();

  const now = new Date();
  document.getElementById('last-update').textContent =
    'Actualizado: ' + now.toLocaleTimeString('es-CO', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

// Pull API knockout scores into bracketState without overwriting user edits on non-played matches
function syncAPIKnockouts(matches) {
  const koMatches = matches.filter(m => !m.group && m.score && m.score.ft);
  // map by round name keywords
  const roundKeywords = [
    ['Ronda de 32', ['Round of 32','round of 32']],
    ['Octavos de Final', ['Round of 16','round of 16']],
    ['Cuartos de Final', ['Quarterfinal','Quarter-final','quarter']],
    ['Semifinales', ['Semifinal','semi']],
    ['Final', ['Final']],
  ];
  koMatches.forEach(m => {
    const rnd = m.round || '';
    let roundIdx = -1;
    roundKeywords.forEach(([name, kws], ri) => {
      if (kws.some(k => rnd.toLowerCase().includes(k.toLowerCase()))) roundIdx = ri;
    });
    if (roundIdx < 0) return;
    const slots = bracketState[roundIdx];
    // find slot by team name
    const slot = slots.find(s =>
      (s.t1 === m.team1 && s.t2 === m.team2) ||
      (s.t1 === m.team2 && s.t2 === m.team1)
    );
    if (slot) {
      const reversed = slot.t1 === m.team2;
      slot.g1 = String(reversed ? m.score.ft[1] : m.score.ft[0]);
      slot.g2 = String(reversed ? m.score.ft[0] : m.score.ft[1]);
      if (m.score.pen) {
        slot.pen1 = String(reversed ? m.score.pen[1] : m.score.pen[0]);
        slot.pen2 = String(reversed ? m.score.pen[0] : m.score.pen[1]);
      }
      slot.apiLocked = true;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
//  STATUS / POLL
// ═══════════════════════════════════════════════════════════════════
function setStatus(type, msg) {
  document.getElementById('status-dot').className = 'dot ' + (type === 'ok' ? 'ok' : type === 'live' ? 'live' : '');
  document.getElementById('status-text').textContent = msg || (type === 'ok' ? 'Datos actualizados' : 'Conectando…');
}
function showError(msg) { const b=document.getElementById('error-banner'); b.textContent='⚠ '+msg; b.style.display='block'; }
function hideError()    { document.getElementById('error-banner').style.display='none'; }

function startPoll() { if(pollTimer) clearInterval(pollTimer); pollTimer = setInterval(fetchData, POLL_MS); }
function stopPoll()  { if(pollTimer) { clearInterval(pollTimer); pollTimer=null; } }

function toggleAuto() {
  autoEnabled = !autoEnabled;
  const btn = document.getElementById('auto-toggle');
  if (autoEnabled) {
    startPoll(); btn.textContent = '⏸ Auto-actualizar'; btn.className = 'on'; fetchData();
  } else {
    stopPoll(); btn.textContent = '▶ Auto-actualizar'; btn.className = '';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  MATCH HELPERS
// ═══════════════════════════════════════════════════════════════════
function matchIsFinished(m) { return !!(m.score && m.score.ft); }
function matchIsLive(m)     { return !!(m.score && m.score.ht && !m.score.ft); }
function getScoreFT(m)      { return matchIsFinished(m) ? m.score.ft : null; }
function matchStatusLabel(m) {
  if (matchIsFinished(m)) return { label:'FT', cls:'ft' };
  if (matchIsLive(m))     return { label:'EN VIVO', cls:'live' };
  const d = new Date(m.date + 'T00:00:00');
  return { label: d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'}), cls:'' };
}

// ═══════════════════════════════════════════════════════════════════
//  STANDINGS
// ═══════════════════════════════════════════════════════════════════
function calcStandings(groupName) {
  const matches = groupMap[groupName] || [];
  const teamSet = new Set();
  matches.forEach(m => { teamSet.add(m.team1); teamSet.add(m.team2); });
  const stats = {};
  teamSet.forEach(t => { stats[t] = { name:t, pj:0, pts:0, gf:0, gc:0, dg:0 }; });
  matches.forEach(m => {
    const ft = getScoreFT(m); if (!ft) return;
    const [g1,g2] = ft;
    const s1=stats[m.team1], s2=stats[m.team2];
    s1.pj++; s2.pj++;
    s1.gf+=g1; s1.gc+=g2; s1.dg+=g1-g2;
    s2.gf+=g2; s2.gc+=g1; s2.dg+=g2-g1;
    if (g1>g2) s1.pts+=3; else if (g2>g1) s2.pts+=3; else { s1.pts+=1; s2.pts+=1; }
  });
  return Object.values(stats).sort((a,b) => b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || a.name.localeCompare(b.name));
}

function getGroupTopN(groupName, n) {
  return calcStandings(groupName).slice(0, n).map(t => t.name);
}

// Compute best 3rd-placed teams across all groups (for the 4 wildcard R32 slots → 8 teams)
function getBest3rdTeams() {
  const thirds = [];
  groupOrder.forEach(g => {
    const st = calcStandings(g);
    if (st.length >= 3) thirds.push({ ...st[2], group: g });
  });
  thirds.sort((a,b) => b.pts-a.pts || b.dg-a.dg || b.gf-a.gf || a.name.localeCompare(b.name));
  return thirds.slice(0, 8).map(t => t.name);
}

// ═══════════════════════════════════════════════════════════════════
//  BRACKET STATE LOGIC  (ported from mundial.html)
// ═══════════════════════════════════════════════════════════════════
function getBracketWinner(m) {
  const g1 = parseInt(m.g1), g2 = parseInt(m.g2);
  const p1 = parseInt(m.pen1), p2 = parseInt(m.pen2);
  if (!m.t1 || !m.t2) return '';
  if (m.g1==='' || m.g2==='') return '';
  if (isNaN(g1) || isNaN(g2)) return '';
  if (g1 > g2) return m.t1;
  if (g2 > g1) return m.t2;
  // draw → check penalties
  if (!isNaN(p1) && !isNaN(p2) && m.pen1!=='' && m.pen2!=='') {
    if (p1 > p2) return m.t1;
    if (p2 > p1) return m.t2;
  }
  return '';
}

function propagateWinners() {
  // For each round r, winners feed into round r+1
  for (let r = 0; r < ROUND_COUNT.length - 1; r++) {
    const srcMatches  = bracketState[r];
    const dstMatches  = bracketState[r + 1];
    const dstCount    = ROUND_COUNT[r + 1];
    for (let d = 0; d < dstCount; d++) {
      const m1 = srcMatches[d * 2];
      const m2 = srcMatches[d * 2 + 1];
      const w1 = m1 ? getBracketWinner(m1) : '';
      const w2 = m2 ? getBracketWinner(m2) : '';
      const dst = dstMatches[d];
      if (!dst) continue;
      // only update if winner changed (clear scores when team changes)
      if (dst.t1 !== w1) { dst.t1 = w1; dst.g1=''; dst.g2=''; dst.pen1=''; dst.pen2=''; dst.apiLocked=false; }
      if (dst.t2 !== w2) { dst.t2 = w2; dst.g1=''; dst.g2=''; dst.pen1=''; dst.pen2=''; dst.apiLocked=false; }
    }
  }
}

// Sync R32 slots from group standings (called every render)
function syncR32FromGroups() {
  const best3 = getBest3rdTeams();
  let b3idx = 0;

  R32_PAIRINGS.forEach(([g1key, pos1, g2key, pos2], i) => {
    const slot = bracketState[0][i];
    let t1 = '', t2 = '';

    if (g1key.startsWith('3rd-')) {
      t1 = best3[b3idx] || '3º clasificado';
      b3idx++;
    } else {
      const top = getGroupTopN(g1key, 2);
      t1 = pos1 === 1 ? (top[0] || `1º ${g1key}`) : (top[1] || `2º ${g1key}`);
    }

    if (g2key.startsWith('3rd-')) {
      t2 = best3[b3idx] || '3º clasificado';
      b3idx++;
    } else {
      const top = getGroupTopN(g2key, 2);
      t2 = pos2 === 1 ? (top[0] || `1º ${g2key}`) : (top[1] || `2º ${g2key}`);
    }

    // If team identity changed, wipe scores (unless API-locked)
    if (!slot.apiLocked) {
      if (slot.t1 !== t1) { slot.t1 = t1; slot.g1=''; slot.g2=''; slot.pen1=''; slot.pen2=''; }
      if (slot.t2 !== t2) { slot.t2 = t2; slot.g1=''; slot.g2=''; slot.pen1=''; slot.pen2=''; }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER GROUPS
// ═══════════════════════════════════════════════════════════════════
function renderGroups() {
  const container = document.getElementById('groups-container');
  let hasLive = false;

  const html = groupOrder.map(gName => {
    const matches   = groupMap[gName] || [];
    const standings = calcStandings(gName);
    const live      = matches.some(matchIsLive);
    if (live) hasLive = true;

    const standingsHTML = standings.map((t, idx) => {
      let rowCls = '';
      if (idx < 2) rowCls = 'qualify';
      else if (idx === 2) rowCls = 'best3rd';
      return `
      <tr class="${rowCls}">
        <td><span class="pos">${idx+1}</span>${t.name}</td>
        <td>${t.pj}</td>
        <td class="pts">${t.pts}</td>
        <td>${t.dg >= 0 ? '+'+t.dg : t.dg}</td>
        <td>${t.gf}</td>
        <td>${t.gc}</td>
      </tr>`;
    }).join('');

    const matchesHTML = matches.map(m => {
      const ft  = getScoreFT(m);
      const cls = matchIsLive(m) ? 'is-live' : matchIsFinished(m) ? 'finished' : '';
      const st  = matchStatusLabel(m);
      return `
      <div class="match-row ${cls}">
        <span class="tname">${m.team1}</span>
        <span class="score-display">${ft ? ft[0] : '–'}</span>
        <span class="score-sep">:</span>
        <span class="score-display">${ft ? ft[1] : '–'}</span>
        <span class="tname right">${m.team2}</span>
        <span class="match-status ${st.cls}">${st.label}</span>
      </div>`;
    }).join('');

    return `
    <div class="group-card">
      <div class="group-header">
        <h2>${gName}</h2>
        <span class="live-badge ${live ? 'show' : ''}">En Vivo</span>
      </div>
      <table class="standings">
        <thead><tr><th>Equipo</th><th>PJ</th><th>Pts</th><th>DG</th><th>GF</th><th>GC</th></tr></thead>
        <tbody>${standingsHTML}</tbody>
      </table>
      <div class="matches-label">Partidos</div>
      <div class="matches-list">${matchesHTML}</div>
    </div>`;
  }).join('');

  container.innerHTML = html;

  const groupMatches  = allMatches.filter(m => m.group);
  const played        = groupMatches.filter(matchIsFinished).length;
  document.getElementById('groups-count').textContent =
    `${played} / ${groupMatches.length} partidos de grupos jugados`;

  setStatus(hasLive ? 'live' : 'ok', hasLive ? 'Partidos en curso' : 'Datos actualizados');
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER BRACKET
// ═══════════════════════════════════════════════════════════════════
function renderBracket() {
  syncR32FromGroups();
  propagateWinners();

  const container = document.getElementById('bracket-container');
  let html = '';

  for (let r = 0; r < ROUND_COUNT.length; r++) {
    const matches    = bracketState[r];
    const isFinal    = r === ROUND_COUNT.length - 1;
    const matchesHTML = matches.map((m, mIdx) => buildBracketMatchHTML(r, mIdx, m)).join('');
    html += `
    <div class="round ${isFinal ? 'final-round' : ''}">
      <div class="round-title">${ROUND_NAMES[r]}</div>
      <div class="round-matches">${matchesHTML}</div>
      ${isFinal ? buildChampionHTML() : ''}
    </div>`;
  }

  container.innerHTML = html;
}

function buildBracketMatchHTML(r, mIdx, m) {
  const isPending = !m.t1 || !m.t2;
  const g1v = m.g1 !== '' ? m.g1 : '';
  const g2v = m.g2 !== '' ? m.g2 : '';
  const winner  = getBracketWinner(m);
  const isDraw  = !isPending && g1v!=='' && g2v!=='' && !isNaN(parseInt(g1v)) && parseInt(g1v)===parseInt(g2v);
  const isLive  = false; // bracket matches don't have live state from API yet

  // name classes
  const isTbd1 = !m.t1 || m.t1.includes('º ') || m.t1.includes('clasificado');
  const isTbd2 = !m.t2 || m.t2.includes('º ') || m.t2.includes('clasificado');
  const t1cls  = winner===m.t1 && winner ? 'winner-name' : isTbd1 ? 'tbd' : '';
  const t2cls  = winner===m.t2 && winner ? 'winner-name' : isTbd2 ? 'tbd' : '';
  const row1win = winner === m.t1 && winner !== '';
  const row2win = winner === m.t2 && winner !== '';

  const dis = isPending || m.apiLocked ? 'disabled' : '';

  // score cell: if API-locked show static display, otherwise input
  function scoreCell(val, side) {
    if (m.apiLocked) {
      return `<span class="bm-score ${val==='' ? 'tbd-score' : ''}">${val !== '' ? val : '–'}</span>`;
    }
    return `<input type="number" class="bm-input" min="0" max="99" value="${val}" ${dis}
      oninput="setBracketScore(${r},${mIdx},'${side}',this.value)" placeholder="–">`;
  }

  // penalty row: show when draw AND not API-locked (or API-locked with pen data)
  let penHTML = '';
  if (isDraw) {
    if (m.apiLocked && (m.pen1 !== '' || m.pen2 !== '')) {
      penHTML = `<div class="bm-penalty-row">
        <span class="bm-pen-label">Penales:</span>
        <span style="font-weight:700;font-size:0.8rem">${m.pen1}</span>
        <span>–</span>
        <span style="font-weight:700;font-size:0.8rem">${m.pen2}</span>
      </div>`;
    } else if (!m.apiLocked) {
      penHTML = `<div class="bm-penalty-row">
        <span class="bm-pen-label">Pen:</span>
        <input type="number" class="pen-input" min="0" max="99" value="${m.pen1}"
          oninput="setBracketScore(${r},${mIdx},'pen1',this.value)" placeholder="–">
        <span>–</span>
        <input type="number" class="pen-input" min="0" max="99" value="${m.pen2}"
          oninput="setBracketScore(${r},${mIdx},'pen2',this.value)" placeholder="–">
      </div>`;
    }
  }

  const liveBadge = isLive ? `<span class="bm-live-label">EN VIVO</span>` : '';

  return `
  <div class="bracket-match ${isLive ? 'is-live' : ''}">
    ${liveBadge}
    <div class="bm-team ${row1win ? 'winner' : ''}">
      <span class="bm-name ${t1cls}">${m.t1 || 'Por definir'}</span>
      ${scoreCell(g1v, 'g1')}
    </div>
    <div class="bm-team ${row2win ? 'winner' : ''}">
      <span class="bm-name ${t2cls}">${m.t2 || 'Por definir'}</span>
      ${scoreCell(g2v, 'g2')}
    </div>
    ${penHTML}
  </div>`;
}

function buildChampionHTML() {
  const fin   = bracketState[ROUND_COUNT.length - 1][0];
  const champ = getBracketWinner(fin);
  return `
  <div class="champion-display">
    <div class="champion-trophy">🏆</div>
    <div class="champion-label">Campeón del Mundo</div>
    <div class="champion-name">${champ || '—'}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  BRACKET INPUT HANDLERS
// ═══════════════════════════════════════════════════════════════════
function setBracketScore(r, mIdx, side, val) {
  bracketState[r][mIdx][side] = val;
  // re-render (fast – just the bracket DOM)
  renderBracket();
}

function resetBracket() {
  if (!confirm('¿Limpiar todos los marcadores de las llaves?\n(Los equipos clasificados desde grupos se mantienen)')) return;
  bracketState = buildEmptyBracket();
  renderBracket();
}

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════
async function init() {
  await fetchData();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('auto-toggle').className = 'on';
  startPoll();
}

init();

