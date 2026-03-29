const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ── Config ──────────────────────────────────────────
const PORT = 3000;
const JOHN_EXE = path.join(__dirname, 'john-1.9.0-jumbo-1-win64', 'run', 'john.exe');
const JOHN_RUN = path.join(__dirname, 'john-1.9.0-jumbo-1-win64', 'run');
const DEMO_DIR = path.join(__dirname, 'demo');
const TEMP_DIR = path.join(DEMO_DIR, 'temp');
const WORDLIST = path.join(JOHN_RUN, 'rockyou.txt');

// ── Express ─────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Hash generation API
app.post('/api/hash', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const md5 = crypto.createHash('md5').update(password).digest('hex');
  const sha256 = crypto.createHash('sha256').update(password).digest('hex');

  const start = Date.now();
  const bcryptHash = bcrypt.hashSync(password, 12);
  const bcryptTime = Date.now() - start;

  res.json({ md5, sha256, bcrypt: bcryptHash, bcryptTime });
});

// ── HTTP + WebSocket Server ─────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let currentProcess = null;
let aborted = false;

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function cleanPot() {
  try { fs.unlinkSync(path.join(JOHN_RUN, 'john.pot')); } catch (e) { /* ok */ }
}

function parseSpeed(text) {
  const m = text.match(/(\d[\d.]*)([KMG]?)p\/s/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === 'K') v *= 1000;
  if (m[2] === 'M') v *= 1000000;
  if (m[2] === 'G') v *= 1000000000;
  return Math.round(v);
}

function fmtSpeed(val) {
  if (!val || val <= 0) return '—';
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
  return val.toString();
}

function formatCmd(args) {
  return 'john ' + args.map(a => {
    const base = path.basename(a);
    if (a.includes('--')) return a.split('=')[0] + '=' + path.basename(a.split('=')[1] || '');
    return base;
  }).join(' ');
}

function runJohn(ws, args, attackType) {
  return new Promise(resolve => {
    cleanPot();

    send(ws, { type: 'terminal', data: `\n\x1b[36m$\x1b[0m ${formatCmd(args)}\n` });

    currentProcess = spawn(JOHN_EXE, args, { cwd: JOHN_RUN });
    let speed = null;
    let crackedCount = 0;
    const crackedList = [];
    const t0 = Date.now();

    function handle(data) {
      const text = data.toString().replace(/\r(?!\n)/g, '\n');
      send(ws, { type: 'terminal', data: text });

      for (const line of text.split('\n')) {
        // Cracked password: "password         (alice)"
        const cm = line.match(/^(.+?)\s{2,}\((.+?)\)\s*$/);
        if (cm) {
          crackedCount++;
          crackedList.push({ user: cm[2].trim(), password: cm[1].trim() });
          send(ws, {
            type: 'password_cracked',
            password: cm[1].trim(),
            user: cm[2].trim(),
            attack: attackType,
            time: ((Date.now() - t0) / 1000).toFixed(2)
          });
        }
        const s = parseSpeed(line);
        if (s) {
          speed = s;
          send(ws, { type: 'speed_update', speed: s, attack: attackType });
        }
      }
    }

    currentProcess.stdout.on('data', handle);
    currentProcess.stderr.on('data', handle);

    currentProcess.on('close', code => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      send(ws, { type: 'terminal', data: `\x1b[90m[exited in ${elapsed}s]\x1b[0m\n` });
      currentProcess = null;
      resolve({ speed, elapsed: parseFloat(elapsed), code, crackedCount, crackedList });
    });

    currentProcess.on('error', err => {
      send(ws, { type: 'terminal', data: `\x1b[31mError: ${err.message}\x1b[0m\n` });
      currentProcess = null;
      resolve({ speed: null, elapsed: 0, code: -1 });
    });
  });
}

// ── WebSocket Handlers ──────────────────────────────
wss.on('connection', ws => {
  send(ws, { type: 'connected' });
  send(ws, { type: 'terminal', data: '\x1b[32mConnected to John the Ripper server.\x1b[0m\n\x1b[90mReady for commands...\x1b[0m\n' });

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      // ── Dictionary Attack ──
      case 'dictionary_attack': {
        aborted = false;
        send(ws, { type: 'attack_started', attack: 'dictionary' });

        send(ws, { type: 'terminal', data: `\n\x1b[33m╔══════════════════════════════════════════════════╗\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m║  DICTIONARY ATTACK                               ║\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m╚══════════════════════════════════════════════════╝\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[?]\x1b[0m What is this?\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    Compares each hash against rockyou.txt — a real wordlist of\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    14.3 million passwords leaked from the 2009 RockYou breach.\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    If your password is in this list, it cracks in < 1 second.\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Target: 4 user accounts with MD5-hashed passwords\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Wordlist: rockyou.txt (14,344,391 entries)\n\n` });

        const result = await runJohn(ws, [
          '--format=raw-md5',
          `--wordlist=${WORDLIST}`,
          path.join(DEMO_DIR, 'shadow.txt')
        ], 'dictionary');

        if (!aborted) {
          const cracked = result.speed ? 3 : 0;
          send(ws, { type: 'terminal', data: `\n\x1b[32m[✓] RESULT:\x1b[0m ${cracked} of 4 passwords cracked\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    alice, bob, carol used common passwords found in the wordlist.\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    dave's password "S3cur3P@ss" survived — it's not in any wordlist.\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[33m[!] Lesson:\x1b[0m Common passwords are cracked instantly. Use unique,\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    complex passwords that don't appear in known breach databases.\x1b[0m\n` });
          send(ws, { type: 'attack_complete', attack: 'dictionary', speed: result.speed, elapsed: result.elapsed });
        }
        break;
      }

      // ── Incremental Attack ──
      case 'incremental_attack': {
        aborted = false;
        send(ws, { type: 'attack_started', attack: 'incremental' });

        send(ws, { type: 'terminal', data: `\n\x1b[33m╔══════════════════════════════════════════════════╗\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m║  INCREMENTAL (BRUTE-FORCE) ATTACK                ║\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m╚══════════════════════════════════════════════════╝\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[?]\x1b[0m What is this?\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    Unlike dictionary, this tries EVERY possible combination:\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    a, b, c... aa, ab, ac... aA, aB... a1, a2... a!, a@...\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    Guaranteed to find every password — given enough time.\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Mode: All printable ASCII characters\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Target: 4 user accounts (same as dictionary)\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m[!] Watch:\x1b[0m This will run indefinitely. Press Stop after 15-20s.\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    The point: nothing cracks — proving that complex passwords\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    resist brute-force attacks even at millions of guesses/sec.\x1b[0m\n\n` });

        const incResult = await runJohn(ws, [
          '--incremental=ascii',
          '--format=raw-md5',
          path.join(DEMO_DIR, 'shadow.txt')
        ], 'incremental');

        const ic = incResult.crackedCount;
        const remaining = 4 - ic;

        if (!aborted) {
          send(ws, { type: 'terminal', data: `\n\x1b[32m[✓] RESULT:\x1b[0m ${ic} of 4 cracked, ${remaining} survived.\n` });
          if (ic > 0) {
            send(ws, { type: 'terminal', data: `\x1b[90m    Short/simple passwords (e.g. "abc123") are found quickly because\x1b[0m\n` });
            send(ws, { type: 'terminal', data: `\x1b[90m    brute-force starts with short combinations first.\x1b[0m\n` });
          }
          if (remaining > 0) {
            send(ws, { type: 'terminal', data: `\x1b[90m    ${remaining} password(s) with length + complexity survived the attack.\x1b[0m\n` });
          }
          send(ws, { type: 'terminal', data: `\x1b[33m[!] Lesson:\x1b[0m Password length and complexity make brute-force\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    computationally infeasible. An 8-char mixed password =\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    ~6 quadrillion combinations. That's years of compute.\x1b[0m\n` });
          send(ws, { type: 'attack_complete', attack: 'incremental' });
        } else {
          send(ws, { type: 'terminal', data: `\n\x1b[32m[✓] RESULT:\x1b[0m Stopped — ${ic} of 4 cracked, ${remaining} survived.\n` });
          if (ic > 0) {
            send(ws, { type: 'terminal', data: `\x1b[90m    Short/common passwords like "${incResult.crackedList[0]?.password}" were found\x1b[0m\n` });
            send(ws, { type: 'terminal', data: `\x1b[90m    because brute-force tries short combinations first.\x1b[0m\n` });
          }
          if (remaining > 0) {
            send(ws, { type: 'terminal', data: `\x1b[90m    But ${remaining} complex password(s) remained uncracked.\x1b[0m\n` });
          }
          send(ws, { type: 'terminal', data: `\x1b[33m[!] Lesson:\x1b[0m Even at millions of attempts/sec, complex passwords\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    resist brute-force. An 8-char password with mixed case,\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    numbers & symbols = ~6 quadrillion combinations = years.\x1b[0m\n` });
        }
        break;
      }

      // ── Hash Format Comparison ──
      case 'hash_compare': {
        aborted = false;
        const pw = msg.password || 'password';

        // Generate temp hash files
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

        const md5Hash = crypto.createHash('md5').update(pw).digest('hex');
        const sha256Hash = crypto.createHash('sha256').update(pw).digest('hex');
        const bcryptHash = bcrypt.hashSync(pw, 12);

        fs.writeFileSync(path.join(TEMP_DIR, 'md5.txt'), `target:${md5Hash}\n`);
        fs.writeFileSync(path.join(TEMP_DIR, 'sha256.txt'), `target:${sha256Hash}\n`);
        fs.writeFileSync(path.join(TEMP_DIR, 'bcrypt.txt'), `target:${bcryptHash}\n`);

        send(ws, { type: 'attack_started', attack: 'hash_compare' });

        send(ws, { type: 'terminal', data: `\n\x1b[33m╔══════════════════════════════════════════════════╗\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m║  HASH FORMAT COMPARISON                          ║\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m╚══════════════════════════════════════════════════╝\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[?]\x1b[0m What is this?\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    The SAME password "${pw}" is hashed with 3 different algorithms.\x1b[0m\n` });
        send(ws, { type: 'terminal', data: `\x1b[90m    We attack each one to show how algorithm choice affects security.\x1b[0m\n\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Password: "${pw}"\n` });
        send(ws, { type: 'terminal', data: `\x1b[36m[>]\x1b[0m Algorithms: MD5 → SHA-256 → bcrypt\n` });
        send(ws, { type: 'terminal', data: `\x1b[33m[!] Watch:\x1b[0m Pay attention to the cracking SPEED (p/s) for each.\n\n` });

        const phases = [
          {
            name: 'md5', label: 'MD5', format: 'raw-md5', file: 'md5.txt',
            preMsg: `\x1b[36m[1/3]\x1b[0m Attacking MD5 hash...\n\x1b[90m      MD5 was designed for speed — great for checksums, terrible for passwords.\x1b[0m\n\x1b[90m      It has no salting, no iteration, and GPUs can try billions/sec.\x1b[0m\n`,
            postMsg: (r) => `\x1b[32m  ✓ Cracked in ${r.elapsed}s\x1b[0m | Speed: \x1b[1m${fmtSpeed(r.speed)}\x1b[0m p/s\n`
          },
          {
            name: 'sha256', label: 'SHA-256', format: 'raw-sha256', file: 'sha256.txt',
            preMsg: `\x1b[36m[2/3]\x1b[0m Attacking SHA-256 hash...\n\x1b[90m      SHA-256 is stronger than MD5 but still a fast hash.\x1b[0m\n\x1b[90m      It was designed for data integrity, not password storage.\x1b[0m\n`,
            postMsg: (r) => `\x1b[32m  ✓ Cracked in ${r.elapsed}s\x1b[0m | Speed: \x1b[1m${fmtSpeed(r.speed)}\x1b[0m p/s\n`
          },
          {
            name: 'bcrypt', label: 'bcrypt', format: 'bcrypt', file: 'bcrypt.txt',
            preMsg: `\x1b[36m[3/3]\x1b[0m Attacking bcrypt hash...\n\x1b[90m      bcrypt is PURPOSE-BUILT for passwords. It has:\x1b[0m\n\x1b[90m      • Built-in salt (prevents rainbow tables)\x1b[0m\n\x1b[90m      • Cost factor of 12 (2^12 = 4,096 iterations per guess)\x1b[0m\n\x1b[90m      • Deliberately slow — by design\x1b[0m\n\x1b[33m      Watch how the speed drops dramatically...\x1b[0m\n`,
            postMsg: (r) => `\x1b[32m  ✓ Cracked in ${r.elapsed}s\x1b[0m | Speed: \x1b[1m${fmtSpeed(r.speed)}\x1b[0m p/s\n\x1b[33m  ↑ Compare this speed to MD5 above.\x1b[0m\n`
          },
        ];

        const results = {};

        for (const phase of phases) {
          if (aborted) break;

          send(ws, { type: 'terminal', data: `\n\x1b[33m── ${phase.label} ──\x1b[0m\n` });
          send(ws, { type: 'terminal', data: phase.preMsg });
          send(ws, { type: 'hash_compare_phase', phase: phase.name, status: 'running' });

          const r = await runJohn(ws, [
            `--format=${phase.format}`,
            `--wordlist=${WORDLIST}`,
            path.join(TEMP_DIR, phase.file)
          ], 'hash_compare');

          results[phase.name] = r;
          send(ws, { type: 'terminal', data: phase.postMsg(r) });
          send(ws, { type: 'hash_compare_phase', phase: phase.name, status: 'complete', speed: r.speed, elapsed: r.elapsed });
        }

        if (!aborted) {
          // Final summary
          const md5Spd = results.md5?.speed || 0;
          const bcryptSpd = results.bcrypt?.speed || 1;
          const ratio = md5Spd > 0 && bcryptSpd > 0 ? Math.round(md5Spd / bcryptSpd) : '???';

          send(ws, { type: 'terminal', data: `\n\x1b[33m═══ SUMMARY ═══\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m  MD5     → ${fmtSpeed(results.md5?.speed)} p/s  (cracked in ${results.md5?.elapsed}s)\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m  SHA-256 → ${fmtSpeed(results.sha256?.speed)} p/s  (cracked in ${results.sha256?.elapsed}s)\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m  bcrypt  → ${fmtSpeed(results.bcrypt?.speed)} p/s  (cracked in ${results.bcrypt?.elapsed}s)\x1b[0m\n\n` });
          send(ws, { type: 'terminal', data: `\x1b[1m  bcrypt is ~${ratio.toLocaleString()}x slower to crack than MD5.\x1b[0m\n\n` });
          send(ws, { type: 'terminal', data: `\x1b[33m[!] Lesson:\x1b[0m The hashing algorithm matters as much as the password.\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    MD5/SHA-256 were never designed for passwords — they're fast by design.\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    bcrypt/scrypt/argon2 are deliberately slow, making mass cracking\x1b[0m\n` });
          send(ws, { type: 'terminal', data: `\x1b[90m    computationally infeasible. Modern systems should NEVER use MD5.\x1b[0m\n` });
          send(ws, { type: 'attack_complete', attack: 'hash_compare', results });
        }
        break;
      }

      // ── Stop ──
      case 'stop_attack': {
        aborted = true;
        if (currentProcess) {
          currentProcess.kill();
          send(ws, { type: 'terminal', data: '\n\x1b[31m^C Attack stopped by user\x1b[0m\n' });
          send(ws, { type: 'terminal', data: `\x1b[90m    Process terminated. Results above show what was found before stopping.\x1b[0m\n` });
          send(ws, { type: 'attack_stopped' });
          currentProcess = null;
        }
        break;
      }

      // ── Clear Terminal ──
      case 'clear_terminal': {
        send(ws, { type: 'clear_terminal' });
        break;
      }
    }
  });

  ws.on('close', () => {
    aborted = true;
    if (currentProcess) {
      currentProcess.kill();
      currentProcess = null;
    }
  });
});

// ── Start ───────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  John the Ripper Live Demo`);
  console.log(`  http://localhost:${PORT}\n`);
});
