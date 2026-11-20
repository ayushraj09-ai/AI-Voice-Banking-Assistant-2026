# GitHub and deployment

## 1. Upload to GitHub (Windows PowerShell)
1. Create an EMPTY repository on github.com (no README, no .gitignore, no licence).
2. In the project folder:
```
git init
git add .
git status
```
Check the list: it must NOT show `data/`, `samples/`, `ml/.venv`, `ml/models`, `.session-secret`, `reports/` or any `.wav` file
(`.gitignore` excludes them; they hold the database, password/PIN hashes, enrolled voice profiles and recordings of real people).
About 70 small files (< 1 MB) should be listed.
```
git commit -m "Voice banking assistant with ECAPA speaker verification"
git branch -M main
git remote add origin https://github.com/<your-username>/voice-banking-assistant.git
git push -u origin main
```
First time only: `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.
Run `npm test` before pushing; the CI workflow (`.github/workflows/ci.yml`) runs the same tests on every push.
Add a LICENSE of your choice. Datasets and models are not included: LibriSpeech is CC BY 4.0 (openslr.org/12), the ECAPA model
`speechbrain/spkrec-ecapa-voxceleb` is downloaded automatically (check its model card for the licence).

## 2. Deploying - what the app needs
- **HTTPS**: browsers only allow microphone access on https:// (or localhost).
- **Python + PyTorch** (CPU is enough, ~2 GB RAM) next to Node. Static hosts (Vercel, Netlify, GitHub Pages) cannot run this app.
- **A writable folder** for `data/store.json` (users, voice profiles, audit log). Free hosts often reset it on restart: users are
  re-created and voices must be enrolled again.

### Option A - live demo from your own PC (easiest, 2 minutes)
```
winget install Cloudflare.cloudflared
.\START_APP.bat
cloudflared tunnel --url http://localhost:3000
```
It prints an `https://....trycloudflare.com` address; open it on any device. Your PC must stay on while people use it.

### Option B - Docker (any host that runs containers; Hugging Face Spaces "Docker" CPU is a good free fit)
```
docker build -t voice-banking .
docker run -p 7860:7860 -e SESSION_SECRET=<long-random-string> -v voice-data:/data voice-banking
```
Then open http://localhost:7860. For Hugging Face Spaces: create a Space with SDK = Docker, push this repository to it, use
`deploy/HF_SPACE_README.md` as the Space's `README.md`, add `SESSION_SECRET` under Settings -> Secrets, and open the direct
`https://<user>-<space>.hf.space` address (not the page that embeds it in a frame) or set `COOKIE_SAMESITE=none`.
**The Dockerfile has not been built or run by the author of these files; expect to fix small things on the first build.**

## 3. Before making it public
- It is a DEMO with fake banking data. Never enter real account data.
- Set `SESSION_SECRET`. Change the demo users/passwords in `seed()` (server.js); the README lists the defaults.
- `DEMO_MODE` shows the OTP in the UI (no SMS gateway), so anybody who passes the voice check also gets the OTP. Fine for a demo only.
- Voice lockout is off by default; for a public site set `MAX_VOICE_FAILS=5`.
- Voice recordings and embeddings are biometric data: say so on the page, get consent, and offer the "Remove voice profile" button.
- Do not enable `VOICE_DEBUG` (it reveals scores).
