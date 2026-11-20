# Fixes applied — 28 Oct 2026

- Frontend API calls now explicitly use same-origin cookies.
- A 401 response no longer triggers a silent full-page reload. Enrollment and voice-profile removal show a session message instead.
- Voice enrollment checks the `/voice/enroll/start` response before opening the recording modal, avoiding errors when the session is invalid.
- Login now explicitly saves the regenerated session before returning success.
- A stable local `.session-secret` is generated automatically on first run (unless `SESSION_SECRET` is supplied in the environment), so server restarts do not invalidate sessions merely because the secret changed.
- `.session-secret` is ignored by Git.
- Smoke test isolation and an invalid test IFSC were corrected.

Validation run: `node --check server.js`, `node --check public/app.js`, and `npm test` (14/14 passing).

This remains an academic/demo banking prototype. Do not connect it to real bank accounts or use real banking credentials.

---
# Speaker-service launcher fixes — 29 Oct 2026

- `START_APP.bat` no longer starts Python through nested-quote `cmd /k` (which made Python try to run `python.exe` as a script). It calls `ml\start_speaker_service.ps1`, which starts `ml\.venv\Scripts\python.exe -u -m speaker_service.app` from the project root, keeps logs in `logs\`, reuses a healthy service, detects port 5005 conflicts, reports the real error if the service exits, warms up the model and confirms `/health`.
- Batch/PowerShell launchers now use Windows (CRLF) line endings. The speaker service is stopped when the app exits, only if this launcher started it.
- `/health` returns `ok: true` only when the ECAPA model is loaded.
- Enrollment and verification report service/audio problems clearly (service not running, too quiet, distorted, profile backend mismatch). Service problems do not count toward the voice lockout. Identity failures still return one generic message. OTP/PIN and the other security checks are unchanged.
- `node scripts/last_verify.js` prints the last voice verification results for debugging.
- ECAPA accept threshold raised from 0.30 to 0.55 (a friend's voice was accepted). Added `scripts/calibrate_samples.js` to calibrate it on data/voice_samples. Existing profiles stay valid (same embeddings); only the decision threshold changed.
- Security review fixes (29 Oct 2026):
  - No standing voice window any more (`VOICE_WINDOW_MS` default 0): every balance/transactions/account/statement command needs its own voice check. Before, one verification let anyone ask for 2 minutes.
  - Every payment needs a voice check made FOR that payment (single-use, purpose-bound). A check done for a balance query can no longer unlock a payment; `/payment/confirm` also requires it.
  - Replacing or deleting the voice profile now needs the current owner's voice (before, anyone at an open session could enroll their own voice and take over).
  - Enrollment consistency check no longer scales with the accept threshold (`ENROLL_CONSISTENCY`, 0.35 for ECAPA), so the stricter 0.55 does not make enrollment harder.
  - Tests updated/added in tests/smoke.test.js (could not be run in the review environment: needs `npm install`).
  - Profiles made with another speaker backend (e.g. old MFCC profile, now ECAPA) can never verify by voice, so Re-enroll / Remove would have locked the owner out. For that case only, they now ask for the account password (5 wrong tries -> 5 min block, audited). Profiles of the current backend still require the owner's voice.
  - Verification recording now always lasts the full 4.5 s (same as enrollment). Before, it stopped as soon as browser speech recognition ended/failed, giving clips too short to verify.
  - Audio-quality rejections (too short/quiet/clipped) no longer count toward the voice lockout.
  - Local diagnosis: start with `$env:VOICE_DEBUG="1"` to show phrase result, score and threshold in the verify window. Leave it off normally (it reveals scores).
- New: replay guard (lib/replay.js), FAR/FRR + replay security report (scripts/make_report.js, lib/metrics.js, lib/reportHtml.js, route /report), replay test in tests/smoke.test.js (not run here: needs npm install).
- Dashboard now has a "Security report" button (opens /report). /report builds the report on demand (needs the ECAPA service); `/report?refresh=1` rebuilds it.
- /report route moved after the session middleware (it was registered before it, so req.session was undefined and it always answered "Login first").
- Report no longer fails completely when data/voice_samples or the ECAPA service is missing: the accuracy section says what is missing and the live-attempts section is still built.
- Public-dataset evaluation: ml/eval/prepare_public_dataset.py (LibriSpeech from openslr.org, 4 s clips) and `scripts/make_report.js --dir data/public_samples` -> reports/security_report_public.html (open /report?set=public). Tested here only with a fake embedder and synthetic audio (no network/model in the build environment).
- START_APP_DEBUG.bat: diagnosis launcher (VOICE_DEBUG=1, MAX_VOICE_FAILS=30). The verify window then shows score, threshold, expected phrase and what the browser heard; the server console prints a [VOICE_DEBUG] line per attempt. Never use for demos/real use.
- Phrase check made more robust (from real scores: owner attempts scored 0.645/0.697 > threshold 0.55 yet were rejected = browser speech recognition mis-heard the phrase): colours "purple"/"orange" replaced by "pink"/"brown"; the browser now collects all results and alternatives (continuous recognition, stopped when the recording ends). The phrase is still random, single-use and the voice must still match.
- MAKE_REPORT.bat: one click -> starts/reuses the ECAPA service, builds the full report (cards, FAR/FRR graph, histogram, replay test, live attempts) and opens it. `MAKE_REPORT.bat public` uses the LibriSpeech set. The 18 recordings ship in samples/own_18 as a fallback (used when data/voice_samples is absent).
- Fixed: make_report.js crashed with ENOENT when the reports folder did not exist.
- MAKE_PUBLIC_REPORT.bat (= MAKE_REPORT.bat public): downloads/prepares LibriSpeech on first run, builds the public-dataset report and opens it.
- Report without a local model: ml/eval/make_scores.py + colab/ECAPA_scores.ipynb produce scores JSON; `make_report.js --scores file.json [--threshold X]` / REPORT_FROM_SCORES.bat render the same report. Tested here with a fake embedder only.
- prepare_public_dataset.py now streams the .tar.gz (no full extraction) and supports --set train-clean-100 with --speakers / --speaker-step. Tested with fake archives only.
- prepare_public_dataset.py: --folder <extracted LibriSpeech dir> (no archive needed). Tested with a fake extracted folder only.
- MAKE_TRAIN100_REPORT.bat: one click for the extracted train-clean-100 folder (default C:\Users\DELL\Downloads\train-clean-100\LibriSpeech, or pass another path); prepares 60 speakers then builds the public report.
- Report "live attempts" section: counts ALL voice checks in the audit log (newest 500 events), split into accepted / voice too low / voice matched but phrase not recognised / recording problem / replay; graph shows the last 100 scored attempts. When opened through the app (/report) this section is rebuilt on every page load. A saved HTML file is a snapshot.
- Voice lockout removed by default (MAX_VOICE_FAILS=0; opt in with MAX_VOICE_FAILS=3). Payments still need OTP/PIN; OTP attempts are still limited. tests/smoke.test.js enables it for its own lockout test.
- ECAPA threshold default 0.55 -> 0.45 from the train-clean-100 run (60 speakers, 180 owner / 10,620 impostor trials): 0.55 = FAR ~0.01%, FRR 3.3%; 0.45 = FAR 0.23%, FRR 1.1%; live owner scores on a laptop mic were 0.49-0.70. Re-enroll after this update.
- Microphone: autoGainControl on (quiet laptop mics produced "too quiet/too short" recordings). Re-enroll so profile and verification use the same capture settings.
- Report redesigned: summary cards in plain words, threshold table with counts, histogram as share of trials (owner bars were invisible next to thousands of impostor trials), honest replay result with similarity numbers, and the live section polls /report/live every 4 s.
- Verification robustness: the browser speech recognition now listens to the SAME microphone track that is recorded (newer Chrome) instead of opening the mic a second time; a live mic-level readout is shown; recordings that are too quiet or too short (same rules as the server) are caught on the client and retried up to 3 times WITHOUT using a verification attempt.
- Paper support: make_scores.py now records every trial (speaker pairs) + a reproducibility config; ml/eval/paper_export.py makes the paper files; MAKE_PAPER_FILES.bat runs both. Tested with a fake embedder only.
- GitHub/deploy: .gitignore rewritten (comments on their own lines, otherwise git ignored the patterns and would have committed data/store.json and the 85 MB model; verified with a real `git add`: 69 files, 440 KB, no data/samples/models), Dockerfile + deploy/start.sh (+ .dockerignore, HF Space README), TRUST_PROXY / COOKIE_SAMESITE env support, GitHub Actions CI, DEPLOY.md. Docker build not tested here.
