# John the Ripper — Live Demo Guide

Password auditing tool demo: Dictionary Attack, Incremental Attack, and Hash Format Comparison.

---

## Folder Structure

```
D:\E\repos\jhontheripper\
├── john-1.9.0-jumbo-1-win64\run\
│   ├── john.exe              # main executable
│   ├── rockyou.txt           # 14.3M password wordlist
│   └── john.pot              # auto-created cracked password cache (delete before demo)
└── demo\
    ├── shadow.txt            # 4 users with MD5 hashes (dictionary attack)
    ├── hash_md5.txt          # "password" hashed with MD5
    ├── hash_sha256.txt       # "password" hashed with SHA-256
    └── hash_bcrypt.txt       # "password" hashed with bcrypt (rounds=12)
```

---

## Prerequisites

- Windows 10/11
- Python 3 (with `bcrypt` library: `pip install bcrypt`)
- John the Ripper 1.9.0-jumbo-1 (already extracted in this repo)
- rockyou.txt wordlist (already in `run/` folder)

---

## Before the Demo

Open Command Prompt and navigate to the run folder:

```cmd
cd D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run
```

Delete the pot file to clear any previous results:

```cmd
del john.pot
```

Set your CMD font to **18pt** for visibility:
Right-click title bar → Properties → Font → Size: 18

Open **3 separate CMD windows**, all in the `run` folder.

---

## Demo 1 — Dictionary Attack (Window 1)

Uses rockyou.txt (14 million real leaked passwords) to crack MD5 hashes.

**Show the hash file first:**

```cmd
type D:\E\repos\jhontheripper\demo\shadow.txt
```

**Run the attack:**

```cmd
john --format=raw-md5 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\shadow.txt
```

**Show cracked passwords:**

```cmd
john --show --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt
```

**Clear session before next attack:**

```cmd
del john.pot
```

### Expected Results

| User  | Password    | Result    |
|-------|-------------|-----------|
| alice | password    | CRACKED   |
| bob   | abc123      | CRACKED   |
| carol | letmein     | CRACKED   |
| dave  | S3cur3P@ss  | RESISTANT |

**What to say:** "Three of these four passwords cracked in under 2 seconds because they exist verbatim in the rockyou wordlist — 14 million real passwords from an actual breach. Dave's password survived only because it is not in any wordlist."

---

## Demo 2 — Incremental / Brute-Force Attack (Window 2)

Tries every possible character combination systematically. Let it run 15-20 seconds, then press `Ctrl+C`.

**Run the attack:**

```cmd
john --incremental=All --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt
```

*(Let it run 15-20 seconds, then press Ctrl+C)*

**Show results (nothing cracked):**

```cmd
john --show --format=raw-md5 D:\E\repos\jhontheripper\demo\shadow.txt
```

**Clear session:**

```cmd
del john.pot
```

**What to say:** "Unlike dictionary, incremental tries every combination — a, b, c... aa, ab, ac... It has been running for 20 seconds with no result. A complex password would take years at this rate. This is exactly why length and special characters matter."

---

## Demo 3 — Hash Format Comparison (Window 3)

Same password "password" hashed with MD5, SHA-256, and bcrypt. This is the most impactful segment.

**Show all three hash files first:**

```cmd
type D:\E\repos\jhontheripper\demo\hash_md5.txt
type D:\E\repos\jhontheripper\demo\hash_sha256.txt
type D:\E\repos\jhontheripper\demo\hash_bcrypt.txt
```

### Attack 1 — MD5 (cracks instantly)

```cmd
john --format=raw-md5 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_md5.txt
```

```cmd
del john.pot
```

### Attack 2 — SHA-256 (cracks instantly)

```cmd
john --format=raw-sha256 --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_sha256.txt
```

```cmd
del john.pot
```

### Attack 3 — bcrypt (visibly slow)

```cmd
john --format=bcrypt --wordlist=rockyou.txt D:\E\repos\jhontheripper\demo\hash_bcrypt.txt
```

*(Let it run 20+ seconds, then press Ctrl+C)*

### Speed Comparison

| Algorithm | Speed             | Time to Crack |
|-----------|-------------------|---------------|
| MD5       | ~16,000,000 pw/s  | < 1 second    |
| SHA-256   | ~10,000,000 pw/s  | < 1 second    |
| bcrypt    | ~71 pw/s          | Hours+        |

bcrypt is **~150,000x slower** to crack than MD5.

**What to say:** "Same password — 'password' — three different hashing algorithms. MD5 and SHA-256 fall in seconds. bcrypt is deliberately designed to be slow, making mass cracking computationally infeasible. This is why modern systems must never store passwords as MD5."

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `john` is not recognized | You're not in the run folder — `cd D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run` |
| `Loaded 0 password hashes` | Delete john.pot — `del john.pot` — it already cracked them |
| No hashes loaded | Check hash file format: each line must be `username:hash` |
| Dictionary attack finds nothing | Verify rockyou.txt exists in the run folder |
| Attack finishes instantly with no output | Already cracked — run `john --show <file>` to see results |

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

## Day-of Checklist

- [ ] CMD font set to 18pt
- [ ] 3 CMD windows open, all in `D:\E\repos\jhontheripper\john-1.9.0-jumbo-1-win64\run`
- [ ] `john.pot` deleted
- [ ] rockyou.txt in run folder
- [ ] All hash files in demo folder
- [ ] Test-run each attack once to confirm
