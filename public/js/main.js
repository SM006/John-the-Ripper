import { Terminal } from './terminal.js';
import { SpeedChart, formatSpeed, animateCounter } from './charts.js';

// ── DOM References ────────────────────────────────
const $ = id => document.getElementById(id);

const statusDot    = $('statusDot');
const statusText   = $('statusText');
const hashInput    = $('hashInput');
const md5Hash      = $('md5Hash');
const sha256Hash   = $('sha256Hash');
const bcryptHash   = $('bcryptHash');
const md5Time      = $('md5Time');
const sha256Time   = $('sha256Time');
const bcryptTime   = $('bcryptTime');
const btnStop      = $('btnStop');
const btnCompare   = $('btnCompare');
const compareConfig = $('compareConfig');
const comparePw    = $('comparePassword');
const btnRunCompare = $('btnRunCompare');
const breachCount  = $('breachCount');
const terminalOutput = $('terminalOutput');
const terminalBody = $('terminalBody');
const btnClear     = $('btnClearTerminal');

// ── State ─────────────────────────────────────────
let ws = null;
let attackRunning = false;
let crackedUsers = new Set();

// ── Initialize ────────────────────────────────────
const terminal = new Terminal(terminalOutput, terminalBody);
const speedChart = new SpeedChart($('speedChart'));

// ── WebSocket Connection ──────────────────────────
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected';
  };

  ws.onclose = () => {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Disconnected';
    attackRunning = false;
    updateButtons();
    // Reconnect after 2s
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
}

connect();

// ── Message Router ────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'connected':
      break;

    case 'terminal':
      terminal.write(msg.data);
      break;

    case 'clear_terminal':
      terminal.clear();
      break;

    case 'attack_started':
      attackRunning = true;
      statusDot.className = 'status-dot running';
      statusText.textContent = `Running: ${formatAttackName(msg.attack)}`;
      updateButtons(msg.attack);

      if (msg.attack === 'dictionary' || msg.attack === 'incremental') {
        resetBreachTable();
      }
      if (msg.attack === 'hash_compare') {
        resetCompareCards();
        speedChart.reset();
      }
      break;

    case 'attack_complete':
      attackRunning = false;
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected';
      updateButtons();

      if (msg.attack === 'dictionary') {
        finalizeBreachTable();
      }
      break;

    case 'attack_stopped':
      attackRunning = false;
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Stopped';
      updateButtons();
      break;

    case 'password_cracked':
      handleCracked(msg);
      break;

    case 'speed_update':
      if (msg.attack === 'dictionary') {
        // just display in terminal
      }
      break;

    case 'hash_compare_phase':
      handleComparePhase(msg);
      break;
  }
}

// ── Hash Generator ────────────────────────────────
let hashTimeout = null;

hashInput.addEventListener('input', () => {
  clearTimeout(hashTimeout);
  const pw = hashInput.value;

  if (!pw) {
    md5Hash.textContent = sha256Hash.textContent = bcryptHash.textContent = '—';
    md5Hash.className = sha256Hash.className = bcryptHash.className = 'hash-value';
    md5Time.textContent = sha256Time.textContent = bcryptTime.textContent = '';
    return;
  }

  hashTimeout = setTimeout(async () => {
    md5Hash.textContent = sha256Hash.textContent = 'computing...';
    bcryptHash.textContent = 'computing (slow)...';

    try {
      const t0 = performance.now();
      const res = await fetch('/api/hash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json();
      const elapsed = Math.round(performance.now() - t0);

      md5Hash.textContent = data.md5;
      sha256Hash.textContent = data.sha256;
      bcryptHash.textContent = data.bcrypt;

      md5Hash.className = sha256Hash.className = bcryptHash.className = 'hash-value active';

      md5Time.textContent = '< 1ms';
      sha256Time.textContent = '< 1ms';
      bcryptTime.textContent = `${data.bcryptTime}ms`;
    } catch (err) {
      md5Hash.textContent = sha256Hash.textContent = bcryptHash.textContent = 'Error';
    }
  }, 200);
});

// ── Attack Buttons ────────────────────────────────
document.querySelectorAll('.btn-attack').forEach(btn => {
  btn.addEventListener('click', () => {
    const attack = btn.dataset.attack;

    if (attack === 'hash_compare') {
      compareConfig.classList.toggle('visible');
      return;
    }

    if (attackRunning || !ws) return;
    ws.send(JSON.stringify({ type: attack }));
  });
});

// Compare config pills
document.querySelectorAll('.pill[data-pw]').forEach(pill => {
  pill.addEventListener('click', () => {
    comparePw.value = pill.dataset.pw;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  });
});

btnRunCompare.addEventListener('click', () => {
  if (attackRunning || !ws) return;
  const pw = comparePw.value.trim() || 'password';
  ws.send(JSON.stringify({ type: 'hash_compare', password: pw }));
  compareConfig.classList.remove('visible');
});

btnStop.addEventListener('click', () => {
  if (ws) ws.send(JSON.stringify({ type: 'stop_attack' }));
});

btnClear.addEventListener('click', () => {
  terminal.clear();
});

function updateButtons(activeAttack) {
  const btns = document.querySelectorAll('.btn-attack');
  btns.forEach(btn => {
    btn.disabled = attackRunning;
    btn.classList.toggle('active', attackRunning && btn.dataset.attack === activeAttack);
  });
  btnStop.disabled = !attackRunning;
}

function formatAttackName(name) {
  const names = {
    dictionary: 'Dictionary Attack',
    incremental: 'Incremental Attack',
    hash_compare: 'Hash Comparison'
  };
  return names[name] || name;
}

// ── Breach Table ──────────────────────────────────
function resetBreachTable() {
  crackedUsers = new Set();
  breachCount.textContent = '0 / 4 cracked';

  document.querySelectorAll('#breachTable tbody tr').forEach(row => {
    row.classList.remove('cracked');
    row.querySelector('.status-cell').innerHTML = '<span class="tag tag-locked">LOCKED</span>';
    const pwCell = row.querySelector('.pw-cell');
    pwCell.textContent = '••••••••';
    pwCell.dataset.password = '';
    row.querySelector('.time-cell').textContent = '—';
  });
}

function handleCracked(msg) {
  const row = document.querySelector(`#breachTable tr[data-user="${msg.user}"]`);
  if (!row) return;

  crackedUsers.add(msg.user);

  row.classList.add('cracked');
  row.querySelector('.status-cell').innerHTML = '<span class="tag tag-cracked">CRACKED</span>';

  const pwCell = row.querySelector('.pw-cell');
  pwCell.dataset.password = msg.password;
  pwCell.textContent = msg.password;

  row.querySelector('.time-cell').textContent = msg.time + 's';

  breachCount.textContent = `${crackedUsers.size} / 4 cracked`;
}

function finalizeBreachTable() {
  // Mark un-cracked rows as secure
  document.querySelectorAll('#breachTable tbody tr').forEach(row => {
    const user = row.dataset.user;
    if (!crackedUsers.has(user)) {
      row.querySelector('.status-cell').innerHTML = '<span class="tag tag-secure">SECURE</span>';
    }
  });
}

// ── Hash Compare Phase ────────────────────────────
function resetCompareCards() {
  ['md5', 'sha256', 'bcrypt'].forEach(algo => {
    const card = $(`algo${algo.charAt(0).toUpperCase() + algo.slice(1)}`);
    // Fix casing for ids
    const cardEl = document.querySelector(`.algo-card[data-algo="${algo}"]`);
    if (cardEl) {
      cardEl.className = 'algo-card';
    }
    const speedEl = $(`speed${capitalize(algo)}`);
    const timeEl = $(`time${capitalize(algo)}`);
    const barEl = $(`bar${capitalize(algo)}`);
    const statusEl = $(`status${capitalize(algo)}`);

    if (speedEl) speedEl.textContent = '—';
    if (timeEl) timeEl.textContent = 'Waiting...';
    if (barEl) barEl.style.width = '0';
    if (statusEl) statusEl.textContent = 'Idle';
  });
}

function capitalize(s) {
  if (s === 'md5') return 'Md5';
  if (s === 'sha256') return 'Sha256';
  if (s === 'bcrypt') return 'Bcrypt';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function handleComparePhase(msg) {
  const algo = msg.phase;
  const cap = capitalize(algo);
  const cardEl = document.querySelector(`.algo-card[data-algo="${algo}"]`);
  const speedEl = $(`speed${cap}`);
  const timeEl = $(`time${cap}`);
  const barEl = $(`bar${cap}`);
  const statusEl = $(`status${cap}`);

  if (msg.status === 'running') {
    if (cardEl) cardEl.className = 'algo-card running';
    if (statusEl) statusEl.textContent = 'Cracking...';
    if (timeEl) timeEl.textContent = 'Running...';
  }

  if (msg.status === 'complete') {
    const speed = msg.speed || 0;
    const elapsed = msg.elapsed || 0;
    const isSlow = algo === 'bcrypt';

    if (cardEl) cardEl.className = `algo-card complete${isSlow ? ' slow' : ''}`;
    if (statusEl) statusEl.textContent = speed > 0 ? 'Cracked' : 'Stopped';
    if (timeEl) timeEl.textContent = `${elapsed}s`;

    // Animate speed counter
    if (speedEl && speed > 0) {
      animateCounter(speedEl, speed);
    }

    // Animate bar (relative to max speed seen)
    updateBars();

    // Update chart
    speedChart.update(algo, speed);
  }
}

function updateBars() {
  const speeds = {
    md5: parseSpeedText($('speedMd5')?.textContent),
    sha256: parseSpeedText($('speedSha256')?.textContent),
    bcrypt: parseSpeedText($('speedBcrypt')?.textContent),
  };

  const max = Math.max(...Object.values(speeds), 1);

  for (const [algo, speed] of Object.entries(speeds)) {
    const bar = $(`bar${capitalize(algo)}`);
    if (bar && speed > 0) {
      // Use log scale for bar width so bcrypt is visible
      const logMax = Math.log10(max);
      const logSpeed = Math.log10(Math.max(speed, 1));
      const pct = Math.max((logSpeed / logMax) * 100, 3);
      bar.style.width = pct + '%';
    }
  }
}

function parseSpeedText(text) {
  if (!text || text === '—') return 0;
  const m = text.match(/([\d.]+)\s*([KMG]?)/);
  if (!m) return 0;
  let v = parseFloat(m[1]);
  if (m[2] === 'K') v *= 1000;
  if (m[2] === 'M') v *= 1000000;
  if (m[2] === 'G') v *= 1000000000;
  return v;
}
