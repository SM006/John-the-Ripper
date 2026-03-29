# John the Ripper — Password Auditing Demo

Live demonstration of password cracking: Dictionary Attack, Incremental Attack, and Hash Format Comparison. Includes a web dashboard with real-time terminal output and a CLI-only mode.

---

## Folder Structure

```
jhontheripper/
├── server.js                          # Web dashboard backend
├── package.json
├── public/                            # Web dashboard frontend
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── main.js
│       ├── terminal.js
│       └── charts.js
├── demo/                              # Pre-generated hash files
│   ├── shadow.txt                     # 4 users with MD5 hashes
│   ├── hash_md5.txt                   # "password" → MD5
│   ├── hash_sha256.txt                # "password" → SHA-256
│   └── hash_bcrypt.txt                # "password" → bcrypt
├── john-1.9.0-jumbo-1-win64/run/      # John the Ripper binary
│   ├── john.exe
│   └── rockyou.txt                    # 14.3M password wordlist
└── rockyou.txt                        # Wordlist (root copy)
```

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Frontend)                       │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────────┐  │
│  │ Hash Generator │  │  Attack Lab   │  │ Terminal Emulator  │  │
│  │  (REST API)    │  │  (WebSocket)  │  │ (ANSI renderer)   │  │
│  └───────┬───────┘  └───────┬───────┘  └─────────▲──────────┘  │
│          │ POST /api/hash   │ ws.send()           │ ws.onmessage│
└──────────┼──────────────────┼─────────────────────┼─────────────┘
           │                  │                     │
           ▼                  ▼                     │
┌─────────────────────────────────────────────────────────────────┐
│                   NODE.JS SERVER (server.js)                    │
│                   Express + ws (WebSocket)                      │
│                                                                 │
│  ┌──────────────┐   ┌───────────────────────────────────────┐  │
│  │ REST Handler  │   │        WebSocket Handler              │  │
│  │ /api/hash     │   │                                       │  │
│  │ (crypto +     │   │  dictionary_attack ──┐                │  │
│  │  bcryptjs)    │   │  incremental_attack ─┼──► runJohn()   │  │
│  └──────────────┘   │  hash_compare ───────┘                │  │
│                      │  stop_attack ──► process.kill()       │  │
│                      └───────────────────┬───────────────────┘  │
│                                          │                      │
│                                          ▼                      │
│                                ┌──────────────────┐             │
│                                │  child_process    │             │
│                                │  spawn('john.exe')│             │
│                                └────────┬─────────┘             │
│                                         │ stdout/stderr         │
│                                         ▼                       │
│                                Parse output → send JSON         │
│                                back over WebSocket              │
└─────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   JOHN THE RIPPER (john.exe)                    │
│                   john-1.9.0-jumbo-1-win64/run/                 │
│                                                                 │
│  Inputs:  shadow.txt (hash file), rockyou.txt (wordlist)       │
│  Outputs: stdout/stderr with cracked passwords + speed stats   │
└─────────────────────────────────────────────────────────────────┘
```

### Two Communication Channels

| Channel | Used For |
|---------|----------|
| **REST** (`POST /api/hash`) | Hash Generator — user types a password, server returns MD5/SHA-256/bcrypt hashes instantly |
| **WebSocket** (`ws://localhost:3000`) | All attack operations — bidirectional, real-time streaming of john.exe output |

### How John the Ripper is Invoked

The core is the `runJohn()` function in `server.js`. It:

1. **Cleans** the `.pot` file (john's cracked password cache) so results are fresh
2. **Spawns** `john.exe` as a child process via Node's `child_process.spawn()`
3. **Streams** both `stdout` and `stderr` in real-time — every chunk of output is parsed and forwarded over WebSocket
4. **Parses** each line with regex to extract cracked passwords (`"password         (alice)"`) and speed metrics (`"12345K p/s"`)

The CLI args differ per attack type:

| Attack | Command |
|--------|---------|
| Dictionary | `john --format=raw-md5 --wordlist=rockyou.txt shadow.txt` |
| Incremental | `john --incremental=ascii --format=raw-md5 shadow.txt` |
| Hash Compare | Runs john **3 times** sequentially (MD5, SHA-256, bcrypt) against the same password |

### WebSocket Message Protocol

**Client → Server:**

| Message | Purpose |
|---------|---------|
| `{ type: "dictionary_attack" }` | Start dictionary attack |
| `{ type: "incremental_attack" }` | Start brute-force |
| `{ type: "hash_compare", password: "..." }` | Compare hash algorithms |
| `{ type: "stop_attack" }` | Kill the running john process |

**Server → Client (streamed in real-time):**

| Message | Purpose |
|---------|---------|
| `{ type: "terminal", data: "..." }` | Raw ANSI-colored output for the terminal panel |
| `{ type: "password_cracked", user, password, time }` | Updates the breach table |
| `{ type: "speed_update", speed, attack }` | Parsed cracking speed (passwords/sec) |
| `{ type: "hash_compare_phase", phase, status, speed }` | Updates the algorithm comparison cards |
| `{ type: "attack_started" }` / `{ type: "attack_complete" }` | UI state transitions |

### Why WebSocket Instead of REST?

John the Ripper is a **long-running process** that produces output continuously. WebSocket enables:

- **Real-time terminal streaming** — output appears as john runs, not after it finishes
- **Live speed updates** — the server parses `p/s` metrics from john's output and pushes them instantly
- **Instant crack notifications** — the moment a password is found, the breach table updates
- **Process control** — the user can stop an attack mid-run; the server kills the child process immediately

### Frontend Components

| File | Role |
|------|------|
| `public/js/main.js` | WebSocket connection, message routing, DOM updates for breach table and comparison cards |
| `public/js/terminal.js` | ANSI color parser — renders john's colored terminal output in the browser |
| `public/js/charts.js` | Chart.js bar chart showing MD5 vs SHA-256 vs bcrypt speed on a logarithmic scale |

### Request Flow Example (Dictionary Attack)

```
1. User clicks "Dictionary Attack"
2. Browser sends:  ws.send({ type: "dictionary_attack" })
3. Server cleans john.pot, spawns john.exe with wordlist args
4. john.exe starts cracking, outputs to stdout/stderr
5. Server parses each line in real-time:
   ├─ Raw text      → { type: "terminal", data: "..." }        → Terminal panel
   ├─ Cracked match → { type: "password_cracked", user, pw }   → Breach table
   └─ Speed match   → { type: "speed_update", speed: 12345000 }→ Status bar
6. john.exe exits → server sends { type: "attack_complete" }
7. Browser finalizes UI (marks uncracked users as SECURE)
```

---

## Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) (v18+) — for web dashboard
- [Python 3](https://www.python.org/downloads/) — for regenerating hash files
- `pip install bcrypt` — for bcrypt hash generation

---

## Option A — Web Dashboard (Recommended)

A visual dashboard with interactive controls, live terminal, breach simulation table, and Chart.js speed comparison.

### Setup

```cmd
cd D:\E\repos\jhontheripper
npm install
```

### Run

```cmd
npm start
```

Open **http://localhost:3000** in your browser.

### Features

| Section | What it does |
|---------|-------------|
| **Hash Generator** | Type any password, see MD5 / SHA-256 / bcrypt hashes in real-time |
| **Dictionary Attack** | One-click attack using rockyou.txt against 4 user accounts |
| **Incremental Attack** | Brute-force all character combinations, stop when ready |
| **Hash Comparison** | Pick a password, attack it with MD5 → SHA-256 → bcrypt side by side |
| **Breach Table** | Passwords reveal in real-time as they crack |
| **Live Terminal** | Streams actual john.exe output with explanations |
| **Speed Chart** | Chart.js bar chart comparing algorithm cracking speeds |

### Kill the server

```cmd
npx kill-port 3000
```

---

## Option B — CLI Only (No Website)

Run John the Ripper directly from the terminal. No Node.js required. Works in both **PowerShell** and **CMD**.

### Setup

Open a terminal and navigate to the `run` folder (where `john.exe` lives):

```powershell
cd D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run
```

Delete any previous session cache:

```powershell
del john.pot
```

> **Important:** You must be inside the `run` folder for `.\john` to work. All commands below assume you are in `D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run\`.

### Demo 1 — Dictionary Attack

Compares hashes against rockyou.txt (14.3 million real leaked passwords).

```powershell
# Show the hash file
type D:\E\repos\jhontheripper\demo\shadow.txt

# Run dictionary attack
.\john --format=raw-md5 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\shadow.txt

# Show cracked passwords
.\john --show --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt

# Clear session
del john.pot
```

**Expected results:**

| User  | Password   | Result    |
|-------|------------|-----------|
| alice | password   | CRACKED   |
| bob   | abc123     | CRACKED   |
| carol | letmein    | CRACKED   |
| dave  | S3cur3P@ss | RESISTANT |

### Demo 2 — Incremental (Brute-Force) Attack

Tries every possible character combination. Let it run 15-20 seconds, then `Ctrl+C`.

```powershell
# Run brute-force attack
.\john --incremental=ascii --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt

# (wait 15-20 seconds, then press Ctrl+C)

# Show results
.\john --show --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt

# Clear session
del john.pot
```

Short/common passwords may crack, but complex ones (like dave's) survive indefinitely.

### Demo 3 — Hash Format Comparison

Same password hashed with MD5, SHA-256, and bcrypt. Crack each one to compare speeds.

```powershell
# Show all three hash files
type D:\E\repos\jhontheripper\demo\hash_md5.txt
type D:\E\repos\jhontheripper\demo\hash_sha256.txt
type D:\E\repos\jhontheripper\demo\hash_bcrypt.txt
```

**MD5** (cracks instantly):

```powershell
.\john --format=raw-md5 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_md5.txt
del john.pot
```

**SHA-256** (cracks instantly):

```powershell
.\john --format=raw-sha256 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_sha256.txt
del john.pot
```

**bcrypt** (visibly slow — let it run 20+ seconds, then `Ctrl+C`):

```powershell
.\john --format=bcrypt --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_bcrypt.txt
```

**Speed comparison:**

| Algorithm | Speed            | Time to Crack |
|-----------|------------------|---------------|
| MD5       | ~14,000,000 p/s  | < 1 second    |
| SHA-256   | ~8,000,000 p/s   | < 1 second    |
| bcrypt    | ~60 p/s          | Hours+        |

bcrypt is **~200,000x slower** to crack than MD5.

---

## Regenerating Hash Files

If you need to recreate the demo files from scratch:

```cmd
cd D:\E\repos\jhontheripper
mkdir demo
```

**shadow.txt** (4 users, MD5):

```cmd
python -c "import hashlib; f=open('demo/shadow.txt','w'); [f.write(f'{u}:{hashlib.md5(p.encode()).hexdigest()}\n') for u,p in [('alice','password'),('bob','abc123'),('carol','letmein'),('dave','S3cur3P@ss')]]; f.close()"
```

**hash_md5.txt:**

```cmd
python -c "import hashlib; open('demo/hash_md5.txt','w').write('user1:'+hashlib.md5(b'password').hexdigest()+'\n')"
```

**hash_sha256.txt:**

```cmd
python -c "import hashlib; open('demo/hash_sha256.txt','w').write('user2:'+hashlib.sha256(b'password').hexdigest()+'\n')"
```

**hash_bcrypt.txt:**

```cmd
python -c "import bcrypt; open('demo/hash_bcrypt.txt','w').write('user3:'+bcrypt.hashpw(b'password',bcrypt.gensalt(rounds=12)).decode()+'\n')"
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `john` is not recognized | Navigate to run folder: `cd D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run` |
| `Loaded 0 password hashes` | Delete john.pot: `del john.pot` |
| No hashes loaded | Check file format — each line must be `username:hash` |
| Dictionary finds nothing | Verify rockyou.txt exists in the run folder |
| Attack finishes instantly | Already cracked — run `john --show <file>` to see results |
| Website won't start | Run `npm install` first, then `npm start` |
| Port 3000 in use | Kill it: `npx kill-port 3000` |
| `Unknown incremental mode: All` | Use `--incremental=ascii` instead |

---

## Day-of Checklist

### Web Dashboard
- [ ] `npm install` completed
- [ ] `npm start` runs without errors
- [ ] Browser open at http://localhost:3000
- [ ] All 4 sections working (hash generator, dictionary, incremental, hash comparison)

### CLI Only
- [ ] CMD font set to 18pt (right-click title bar → Properties → Font)
- [ ] CMD open in `john-1.9.0-jumbo-1-win64\run`
- [ ] `john.pot` deleted
- [ ] rockyou.txt in run folder
- [ ] All hash files in demo folder
- [ ] Test-run each attack once
