# Secure Localized Voice Banking Assistant (v2)

Upgrade of the original voice-banking demo to the design in the project presentation:
**Understand → Verify → Authorize → Respond.** A valid command is no longer enough; the system also
checks *who* is speaking.

> Demo project – not affiliated with Vaani Bank. Uses fake data; no real banking integration.

## What changed vs v1 (mapped to the slides)

| Slide | Feature | Where |
|---|---|---|
| 8 System flow | Speech → intent → sensitivity check → speaker verification → authorization | `server.js` (`/voice`, `/voice/verify`), `lib/policy.js` |
| 9 Owner-specific verification | Enroll 3–5 samples → embedding profile → compare on each sensitive request | `lib/speaker.js`, `/voice/enroll/*` |
| 10 Sensitivity-based security | 4 levels: none / session / owner voice / owner voice + OTP-PIN | `lib/policy.js` |
| 11 Anti-spoofing | Random single-use challenge ("Say 47 Blue"), 45 s expiry; speaker + phrase must both pass | `lib/challenge.js` |
| 12 Security workflow | Failed owner check → denied; transfers → fresh voice check **then** OTP/PIN | `/payment/initiate`, `/payment/confirm` |
| 7, 13 Multilingual | Intent keywords + spoken replies in English, Hindi, Tamil, Telugu, Bengali | `lib/i18n.js`, `lib/policy.js` |
| 14 Evaluation | FAR / FRR / EER / timing script; end-to-end test suite | `scripts/evaluate.js`, `tests/` |

Also fixed from v1 (these were real security holes): OTP was generated and checked **in the browser**
(now server-side, hashed, expiring, 3 attempts); API trusted a `username` in the URL (now session-based,
no IDOR); plaintext passwords (now scrypt-hashed); receipts were built from client-supplied data (now
from stored transactions, ownership-checked); chat rendered with `innerHTML` (XSS); payment inputs
weren't validated; login had no throttling; `/transaction/:id` routes the UI called did not exist.
Unused `bcrypt`/`sqlite3` dependencies were dropped; data persists to `data/store.json`.

> **GitHub / deployment:** see [DEPLOY.md](DEPLOY.md). Model used: `speechbrain/spkrec-ecapa-voxceleb` (ECAPA-TDNN, 192-dimensional speaker embeddings, cosine scoring).

## Run

```bash
npm install
npm start            # http://localhost:3000
npm test             # 14 end-to-end tests (synthetic audio)
```
Demo users: `ayush` / `1234` (PIN `4321`), `ashish2604` / `ashish2604` (PIN `5678`).
Use **Chrome or Edge** (speech recognition). Microphone access needs `localhost` or HTTPS.

Demo flow: log in → **Enroll my voice** (3–5 phrases) → say/type *"what is my balance"* → say the
phrase shown → balance is released. Try a different person, or playing a recording: it is denied.
*"Transfer money"* opens the form → voice check → OTP (shown on screen in demo mode) or PIN.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | random per start | Set a fixed value in any real deployment |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `DEMO_MODE` | `true` | `false` stops returning the OTP to the browser (needs a real SMS gateway, not included) |
| `SPEAKER_SERVICE_URL` | unset | Use ECAPA-TDNN service (below). Unset = built-in MFCC baseline |
| `SPEAKER_THRESHOLD` | 0.25 (mfcc) / 0.45 (ecapa) | Accept threshold – **calibrate it** |
| `STT_SERVICE_URL` | unset | Server-side transcription of the challenge audio (below) |

## Speaker model – read this before trusting the accuracy

* **Default backend (MFCC mean/std + distance):** zero dependencies, runs anywhere, but it is a
  *baseline*, not ECAPA-TDNN. It will be far less accurate on real voices, accents and noise.
* **ECAPA-TDNN (as in the slides):** `speaker_service/` is a small Flask service around SpeechBrain's
  `spkrec-ecapa-voxceleb`. `pip install -r speaker_service/requirements.txt && python speaker_service/app.py`,
  then set `SPEAKER_SERVICE_URL=http://127.0.0.1:5005` before `npm start`. The updated `START_APP.bat` starts and warms up this ECAPA service automatically when `ml\.venv` exists. Users must re-enroll after switching backends.
  **This service was written but not executed** in the environment where this upgrade was done (no network/GPU).
* **Thresholds are not tuned on real speech.** Record several people (≥5 clips each, 16-bit WAV),
  put them in `eval/<speaker>/*.wav`, run `npm run evaluate`, and set `SPEAKER_THRESHOLD` from the EER
  / FAR you want. The numbers for your report must come from that run.

## Anti-replay: what it does and doesn't prove

The challenge phrase is random, single-use and short-lived, so a recording of the owner saying
something else can't pass. By default the phrase is checked against the **browser's** transcript, which a
hijacked client could forge. For stronger protection set `STT_SERVICE_URL` (the Python service exposes
`/transcribe` via faster-whisper) so the server transcribes the very audio it verifies. Not covered:
real-time voice cloning / TTS deepfakes, or a live attacker who can read the phrase and imitate well –
that needs a dedicated liveness/anti-spoofing model (listed as future scope in the slides).

## Other behaviour worth knowing

* Read-only sensitive queries stay unlocked for 2 min after a successful voice check; transfers need a
  check within the last 60 s and consume it (every transfer re-verifies).
* 3 failed voice checks lock verification for 5 min; failures give one generic message (no hint whether
  the voice or the phrase was wrong). The Security Activity panel deliberately shows no scores.
* Only embedding statistics are stored – never raw audio.
* Voice enrollment is available to any logged-in session. In a real bank, enrollment must require
  stronger identity proof (OTP, branch visit); a hijacked session could otherwise enroll an attacker's voice.
* Sessions use the in-memory store and rate limits are per-process – use Redis etc. if you scale out.

## Layout
```
server.js              routes + orchestration        lib/policy.js     intents + sensitivity levels
lib/speaker.js         enroll / score / thresholds   lib/challenge.js  random phrase + validation
lib/mfcc.js, wav.js    baseline embedding, audio     lib/i18n.js       5-language replies
lib/stt.js             optional server-side STT      lib/store.js      JSON persistence
public/                UI (index.html, app.js, style.css)
speaker_service/       optional ECAPA-TDNN + Whisper service (Python)
scripts/evaluate.js    FAR / FRR / EER               tests/            node:test suite
```

## Security report (graphs) and replay detection
- `node scripts/make_report.js` (ECAPA service running, `$env:SPEAKER_SERVICE_URL="http://127.0.0.1:5005"`) writes `reports/security_report.html`: FAR/FRR vs threshold with EER, owner-vs-impostor score histogram, replay-detection test results, and recent live attempts. Open it at `http://localhost:3000/report` after logging in. `--demo` makes a clearly-labelled sample with made-up numbers.
- Replay guard (`lib/replay.js`): blocks a byte-identical recording re-sent for the same user and (ECAPA) a near-identical copy (`REPLAY_NEAR_DUP`, default 0.985). It does not stop voice cloning/TTS; the random challenge phrase and OTP/PIN cover that.

### Public-dataset evaluation (LibriSpeech)
```
ml\.venv\Scripts\python.exe ml\eval\prepare_public_dataset.py            # downloads dev-clean-2 (~126 MB), makes data\public_samples\<speaker>\1..6.wav
$env:SPEAKER_SERVICE_URL="http://127.0.0.1:5005"                          # ECAPA service running (START_APP.bat)
node scripts\make_report.js --dir data\public_samples                     # writes reports\security_report_public.html
```
Open it at `http://localhost:3000/report?set=public` after logging in. LibriSpeech is clean read speech, so it is easier than a browser microphone: use it as a sanity check, not as the only basis for the final threshold. The ECAPA model itself is already trained (VoxCeleb); this only evaluates it.

### Report without the model on your PC (Colab / Kaggle)
`colab/ECAPA_scores.ipynb` computes the scores with the same model and preprocessing (`ml/eval/make_scores.py`) and gives you `scores_public.json` / `scores_own.json`. Then: drag the JSON onto `REPORT_FROM_SCORES.bat` or `node scripts/make_report.js --scores scores_public.json [--threshold 0.5]` (the `--threshold` option shows FAR/FRR for another threshold without recomputing).

#### Bigger public test (train-clean-100)
Download `train-clean-100.tar.gz` (openslr.org/12, ~6.3 GB) with your browser, then:
`ml\.venv\Scripts\python.exe ml\eval\prepare_public_dataset.py --set train-clean-100 --archive C:\path\train-clean-100.tar.gz --speakers 60` and `MAKE_REPORT.bat public`. The archive is read as a stream (never fully extracted); every 4th speaker is used. Embedding ~360 clips on CPU takes several minutes.

If you already extracted the dataset, use the folder directly (no archive needed):
`ml\.venv\Scripts\python.exe ml\eval\prepare_public_dataset.py --set train-clean-100 --folder "C:\Users\you\Downloads\train-clean-100\LibriSpeech" --speakers 60`

| `MAX_VOICE_FAILS` | 0 (off) | Lock voice verification for 5 minutes after N failed checks (set e.g. 3 to enable) |

### Paper files (research paper)
`MAKE_PAPER_FILES.bat` (or Colab, see colab/ECAPA_scores.ipynb) runs `ml/eval/make_scores.py` and `ml/eval/paper_export.py`: per-trial scores (trials.csv), results.json, LaTeX tables, 300-dpi PNG + vector PDF graphs (FAR/FRR, DET, ROC, histogram), a draft methods paragraph, a speaker-disjoint dev/test split (threshold chosen on dev only), 95% bootstrap confidence intervals, a reproducibility config (versions, clips, seed) and speaker names replaced by S01, S02 (the mapping file is private).
