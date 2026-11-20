const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const moment = require('moment');

const store = require('./lib/store');
const { hashSecret, verifySecret } = require('./lib/secrets');
const policy = require('./lib/policy');
const challenge = require('./lib/challenge');
const speaker = require('./lib/speaker');
const stt = require('./lib/stt');
const { t, inr, pickLang } = require('./lib/i18n');

const CFG = {
    PORT: process.env.PORT || 3000,
    DEMO_MODE: process.env.DEMO_MODE !== 'false',      // demo: OTP is returned to the UI (no SMS gateway)
    VOICE_WINDOW_MS: Number(process.env.VOICE_WINDOW_MS) || 0,  // 0 = every sensitive command needs its own voice check
    TRANSFER_VOICE_MS: 60000,                          // a transfer needs a voice check this fresh
    OTP_TTL_MS: 120000,
    MAX_VOICE_FAILS: Number(process.env.MAX_VOICE_FAILS) || 0,      // 0 = no voice lockout (default). Set e.g. MAX_VOICE_FAILS=3 to lock after 3 failures
    LOCK_MS: 300000,
    TXN_LIMIT: 200000,
};

// ==================== DATA ====================
function seed() {
    const now = Date.now(), day = 86400000;
    const tx = (n, uid, type, amount, description, mode, ago) => ({
        id: `TXN${now}${n}`, user_id: uid, type, amount, description, mode, status: 'success',
        date: new Date(now - ago * day).toISOString(),
    });
    return {
        users: [
            { id: 1, username: 'ayush', passwordHash: hashSecret('1234'), pinHash: hashSecret('4321'), name: 'Ayush Raj',
              account_number: '50100123456789', balance: 980000, branch: 'VAANI Bank Delhi', ifsc: 'VAANI0001234',
              language: 'en', phone: '9876543210', email: 'ayush@email.com', upi_id: 'ayush@VAANIbank' },
           {
    id: 2,
    username: 'ashish2604',
    passwordHash: hashSecret('ashish2604'),
    pinHash: hashSecret('5678'),
    name: 'Ashish Anand',
    account_number: '50100987654321',
    balance: 1000000,
    branch: 'VAANI Bank Mumbai',
    ifsc: 'VAANI0005678',
    language: 'hi',
    phone: '9876543211',
    email: 'ashish2604@email.com',
    upi_id: 'ashish@VAANIbank'
},
],
        transactions: [
            tx(1, 1, 'credit', 5000, 'Salary Credit', 'NEFT', 2), tx(2, 1, 'debit', 2000, 'ATM Withdrawal', 'ATM', 1),
            tx(3, 2, 'credit', 25000, 'Salary Credit', 'NEFT', 3), tx(4, 2, 'debit', 1200, 'Electricity Bill', 'UPI', 1),
        ],
        voiceprints: {},   // userId -> profile (embedding statistics only; raw audio is never stored)
        audit: [],
    };
}
const db = store.load(seed);
const persist = () => store.save(db);
const replay = require('./lib/replay').createGuard({ db, persist, cosine: speaker.cosine, nearDuplicateEnabled: speaker.BACKEND === 'ecapa' });

const maskAccount = a => (a ? 'XXXXXX' + a.slice(-4) : '');
const maskPhone = p => (p ? 'X'.repeat(Math.max(0, p.length - 4)) + p.slice(-4) : '');
const publicUser = u => ({
    id: u.id, username: u.username, name: u.name, masked_account: maskAccount(u.account_number), branch: u.branch,
    ifsc: u.ifsc, balance: u.balance, language: u.language, masked_phone: maskPhone(u.phone),
    voiceEnrolled: !!db.voiceprints[u.id],
});

// Audit trail. `detail` is private (server side only) - scores/reasons must not be shown to a
// possibly-hijacked session, because that would help an attacker tune an attack.
function audit(userId, event, ok, detail) {
    db.audit.push({ ts: new Date().toISOString(), userId, event, ok, detail });
    if (db.audit.length > 500) db.audit.splice(0, db.audit.length - 500);
    persist();
}

// ==================== APP ====================
const app = express();
app.use(express.json({ limit: '3mb' }));   // voice samples are sent as base64 WAV
app.use(express.static(path.join(__dirname, 'public')));

// Keep the development session secret stable across server restarts. An environment
// variable takes priority; otherwise a local ignored file is created on first run.
function getSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const secretFile = path.join(__dirname, '.session-secret');
    try {
        const existing = fs.readFileSync(secretFile, 'utf8').trim();
        if (existing.length >= 32) return existing;
    } catch { /* create it below */ }
    const generated = crypto.randomBytes(48).toString('hex');
    try {
        fs.writeFileSync(secretFile, generated, { flag: 'wx', mode: 0o600 });
        return generated;
    } catch {
        // Another app process may have created the file at the same time.
        try { return fs.readFileSync(secretFile, 'utf8').trim(); }
        catch { console.warn('⚠️ SESSION_SECRET is not set and .session-secret could not be saved. Sessions may reset on restart.'); return generated; }
    }
}
// Behind an HTTPS reverse proxy (Hugging Face Spaces, Render, Railway, nginx...) set TRUST_PROXY=1 and COOKIE_SECURE=true,
// otherwise the "secure" session cookie is never set.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(session({
    secret: getSessionSecret(),
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 3600000, httpOnly: true, sameSite: process.env.COOKIE_SAMESITE || 'lax', secure: process.env.COOKIE_SECURE === 'true' },
}));

function auth(req, res, next) {
    const u = db.users.find(x => x.id === req.session.userId);
    if (!u) return res.status(401).json({ success: false, message: 'Please log in' });
    req.user = u;
    next();
}

const loginFails = new Map();  // ip|username -> { n, until }
const voiceFails = new Map();  // userId -> { n, until }
const isLocked = id => (voiceFails.get(id)?.until || 0) > Date.now();
function noteVoiceFail(id) {
    if (!CFG.MAX_VOICE_FAILS) return false;                // lockout feature is off
    const f = voiceFails.get(id) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= CFG.MAX_VOICE_FAILS) { f.until = Date.now() + CFG.LOCK_MS; f.n = 0; }
    voiceFails.set(id, f);
    return f.until > Date.now();
}
// Security report (generated by `node scripts/make_report.js`). Login required: it contains scores.
app.get('/report', (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).send('Login first, then open /report');
    const fs = require('fs'), isPublic = req.query.set === 'public';
    const f = path.join(__dirname, 'reports', isPublic ? 'security_report_public.html' : 'security_report.html');
    if (isPublic && !fs.existsSync(f)) return res.status(404).type('text').send('Public-dataset report not generated yet. Keep the app running and double-click MAKE_PUBLIC_REPORT.bat in the project folder (downloads the LibriSpeech set the first time), then refresh this page.');
    // Build (or refresh with ?refresh=1) on demand. Runs only our own script; the request supplies no arguments.
    if (!isPublic && (!fs.existsSync(f) || req.query.refresh === '1')) {
        require('child_process').execFile(process.execPath, [path.join(__dirname, 'scripts', 'make_report.js')],
            { cwd: __dirname, timeout: 180000, env: process.env }, (err, out, errOut) => {
                if (err || !fs.existsSync(f)) {
                    console.warn('Report generation failed:', (errOut || err.message || '').toString().slice(0, 500));
                    return res.status(500).type('text').send('Could not build the report: ' + ((errOut || err.message || '').toString().split('\n').find(l => l.startsWith('ERROR')) || 'see server console') + '\nMake sure the ECAPA speaker service is running (START_APP.bat).');
                }
                res.set('Cache-Control', 'no-store').sendFile(f);
            });
        return;
    }
    // Graphs are built once; the "live attempts" section is rebuilt from the current audit log on EVERY page load.
    const { liveSection } = require('./lib/reportHtml'), { summarize } = require('./lib/liveStats');
    const html = fs.readFileSync(f, 'utf8').replace(/<!--LIVE_START-->[\s\S]*<!--LIVE_END-->/, () => liveSection(summarize(db.audit), speaker.THRESHOLD));
    res.set('Cache-Control', 'no-store').type('html').send(html);
});

// Polled by the report page every few seconds: only the "live attempts" part, rebuilt from the current audit log.
app.get('/report/live', (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).send('Login first');
    const { liveInner } = require('./lib/reportHtml'), { summarize } = require('./lib/liveStats');
    res.set('Cache-Control', 'no-store').type('html').send(liveInner(summarize(db.audit), speaker.THRESHOLD));
});

const voiceFresh = (req, ms) => Date.now() - (req.session.voiceAuthAt || 0) <= ms;
// Single-use voice check bound to ONE purpose ('payment' | 'enroll' | 'delete'). A verification done for a
// balance query, or for another purpose, can never be reused for it. Returns null when satisfied,
// otherwise a new challenge that the client must answer first.
// A profile made with a different speaker backend can never verify, so asking for the owner's voice would lock
// the owner out. For that case only, replacing/removing it needs the account PASSWORD instead (rate-limited).
const pwFails = new Map();
function legacyProfile(u) { const p = db.voiceprints[u.id]; return !!p && p.backend !== speaker.BACKEND; }
function passwordGate(req, res) {
    const u = req.user, f = pwFails.get(u.id);
    if (f && f.until > Date.now()) { res.json({ success: false, message: 'Too many wrong passwords. Try again in a few minutes.' }); return false; }
    const pw = String((req.body || {}).password || '');
    if (!pw) { res.json({ success: false, needsPassword: true, message: 'Enter your account password to continue.' }); return false; }
    if (!verifySecret(pw, u.passwordHash)) {
        const n = (f?.n || 0) + 1;
        pwFails.set(u.id, { n, until: n >= 5 ? Date.now() + 300000 : 0 });
        audit(u.id, 'profile_password_check', false);
        res.json({ success: false, needsPassword: true, message: 'Incorrect password.' });
        return false;
    }
    pwFails.delete(u.id);
    audit(u.id, 'profile_password_check', true, 'legacy-backend profile');
    return true;
}

function requireStepUp(req, purpose) {
    const su = req.session.stepUp;
    req.session.stepUp = null;
    if (su && su.purpose === purpose && Date.now() - su.at <= CFG.TRANSFER_VOICE_MS) return null;
    req.session.pending = { type: purpose, lang: req.user.language };
    return newChallenge(req);
}
const newChallenge = req => { const c = challenge.create(req.session); return { phrase: challenge.text(c), expiresInSec: Math.round(challenge.TTL_MS / 1000) }; };
const tx = id => db.transactions.find(x => x.id === id);

// ==================== AUTH ====================
app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const key = `${req.ip}|${String(username).toLowerCase()}`;
    const f = loginFails.get(key);
    if (f && f.until > Date.now()) return res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
    const user = db.users.find(u => u.username === username);
    if (!user || !verifySecret(password, user.passwordHash)) {
        const n = (f?.n || 0) + 1;
        loginFails.set(key, { n, until: n >= 5 ? Date.now() + 300000 : 0 });
        return res.json({ success: false });
    }
    loginFails.delete(key);
    req.session.regenerate(err => {
        if (err) return res.status(500).json({ success: false, message: 'Could not create a login session. Please restart the app and try again.' });
        req.session.userId = user.id;
        audit(user.id, 'login', true);
        // Explicit save prevents the next immediate API request racing session persistence.
        req.session.save(saveErr => {
            if (saveErr) return res.status(500).json({ success: false, message: 'Login session could not be saved. Please try again.' });
            res.json({ success: true, user: publicUser(user), speaker: { backend: speaker.BACKEND } });
        });
    });
});

app.post('/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/me', auth, (req, res) => res.json({ success: true, user: publicUser(req.user), speaker: { backend: speaker.BACKEND } }));

// ==================== ACCOUNT DATA ====================
app.get('/transactions', auth, (req, res) => {
    const list = db.transactions.filter(x => x.user_id === req.user.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    res.json({ success: true, transactions: list });
});

app.get('/security/log', auth, (req, res) => {
    const events = db.audit.filter(e => e.userId === req.user.id).slice(-15).reverse().map(({ ts, event, ok }) => ({ ts, event, ok }));
    res.json({ success: true, events });
});

// ==================== VOICE ENROLLMENT ====================
app.post('/voice/enroll/start', auth, (req, res) => {
    // Re-enrolling replaces the owner's profile, so it needs the CURRENT owner's voice (else anyone at an
    // open session could enroll their own voice and take over).
    if (legacyProfile(req.user)) {
        if (!passwordGate(req, res)) return;
    } else if (db.voiceprints[req.user.id]) {
        if (isLocked(req.user.id)) return res.json({ success: false, locked: true, message: t(req.user.language, 'locked') });
        const ch = requireStepUp(req, 'enroll');
        if (ch) return res.json({ success: false, needsVerification: true, challenge: ch });
    }
    req.session.enroll = { embs: [] };
    const phrases = Array.from({ length: speaker.MAX_ENROLL }, () => { const p = challenge.randomPhrase(); return `${p.digits} ${p.color}`; });
    res.json({ success: true, phrases, min: speaker.MIN_ENROLL, max: speaker.MAX_ENROLL, backend: speaker.BACKEND });
});

// Turns an audio/speaker-service error into a message the user can act on (no internal details).
function enrollErrorMessage(e) {
    const m = String(e && e.message || '');
    if (/too_short|too_quiet/.test(m)) return 'Too short or too quiet - speak a bit longer and closer to the mic.';
    if (/clipped_audio/.test(m)) return 'Audio is distorted (too loud). Move slightly away from the mic and try again.';
    if (/cannot_decode|invalid_samples|invalid_sample_rate|empty_audio/.test(m)) return 'The recording was not valid audio. Please record again.';
    if (/fetch failed|ECONNREFUSED|speaker_service_http_|speaker_model_unavailable/.test(m)) return 'The ECAPA speaker service is not running or not ready. Start it with START_APP.bat and try again.';
    return 'Could not process audio';
}

app.post('/voice/enroll/sample', auth, async (req, res) => {
    const en = req.session.enroll;
    if (!en) return res.json({ success: false, message: 'Start enrollment first' });
    if (en.embs.length >= speaker.MAX_ENROLL) return res.json({ success: false, message: 'Enough samples recorded' });
    try {
        en.embs.push(await speaker.embed(Buffer.from(String(req.body.audio || ''), 'base64')));
        req.session.enroll = en;
        res.json({ success: true, count: en.embs.length });
    } catch (e) {
        console.warn('Enrollment sample rejected:', e.message, e.cause ? `(${e.cause.code || e.cause.message})` : '');
        res.json({ success: false, message: enrollErrorMessage(e) });
    }
});

app.post('/voice/enroll/finish', auth, (req, res) => {
    const embs = req.session.enroll?.embs || [];
    if (embs.length < speaker.MIN_ENROLL) return res.json({ success: false, message: `Record at least ${speaker.MIN_ENROLL} samples` });
    if (!speaker.consistent(embs)) {
        audit(req.user.id, 'enroll', false, 'inconsistent samples');
        req.session.enroll = null;
        return res.json({ success: false, message: 'Samples did not match each other (background noise or different speakers). Please start again in a quiet place.' });
    }
    db.voiceprints[req.user.id] = speaker.buildProfile(embs);
    req.session.enroll = null;
    req.session.voiceAuthAt = 0;
    audit(req.user.id, 'enroll', true, `${embs.length} samples, backend ${speaker.BACKEND}`);
    res.json({ success: true, user: publicUser(req.user) });
});

app.delete('/voice/profile', auth, (req, res) => {   // removing the profile requires a fresh owner check
    if (legacyProfile(req.user)) { if (!passwordGate(req, res)) return; }
    else { const ch = requireStepUp(req, 'delete'); if (ch) return res.json({ success: false, needsVerification: true, challenge: ch }); }
    delete db.voiceprints[req.user.id];
    req.session.voiceAuthAt = 0;
    audit(req.user.id, 'profile_deleted', true);
    res.json({ success: true });
});

// ==================== VOICE COMMANDS ====================
function runIntent(user, intent, lang) {
    const mine = db.transactions.filter(x => x.user_id === user.id).sort((a, b) => b.date.localeCompare(a.date));
    switch (intent) {
        case 'greeting': return { reply: t(lang, 'greeting', { name: user.name }) };
        case 'help': return { reply: t(lang, 'help') };
        case 'info': return { reply: t(lang, 'info') };
        case 'balance': return { reply: t(lang, 'balance', { amt: inr(user.balance) }) };
        case 'account': return { reply: t(lang, 'account', { acct: maskAccount(user.account_number), branch: user.branch, ifsc: user.ifsc }) };
        case 'transactions': {
            if (!mine.length) return { reply: t(lang, 'no_txn') };
            const list = mine.slice(0, 3).map(x => `${t(lang, x.type === 'credit' ? 'rcv' : 'sent')} ₹${inr(x.amount)} - ${x.description}`).join('. ');
            return { reply: t(lang, 'txns', { list }) };
        }
        case 'statement': {
            const sum = ty => inr(mine.filter(x => x.type === ty).reduce((s, x) => s + x.amount, 0));
            return { reply: t(lang, 'statement', { count: mine.length, credits: sum('credit'), debits: sum('debit') }) };
        }
        case 'transfer': return { reply: t(lang, 'transfer_open'), action: 'open_payment' };
        default: return { reply: t(lang, 'unknown') };
    }
}

// Pipeline: understand -> sensitivity check -> (verify speaker) -> authorize -> respond
app.post('/voice', auth, (req, res) => {
    const u = req.user;
    const lang = pickLang(req.body.lang, u.language);
    const { intent, level } = policy.detect(String(req.body.message || '').slice(0, 300));
    audit(u.id, `command:${intent}`, true, `level ${level}`);

    if (level <= policy.LEVEL.BASIC) return res.json({ intent, level, ...runIntent(u, intent, lang) });

    if (!db.voiceprints[u.id]) return res.json({ intent, level, needsEnrollment: true, reply: t(lang, 'enroll_needed') });
    if (isLocked(u.id)) return res.json({ intent, level, locked: true, reply: t(lang, 'locked') });

    // Transfers are gated at /payment/initiate (fresh voice check + OTP/PIN); this only opens the form.
    if (level === policy.LEVEL.STRONG || voiceFresh(req, CFG.VOICE_WINDOW_MS)) {
        return res.json({ intent, level, ...runIntent(u, intent, lang) });
    }
    req.session.pending = { intent, lang };
    const ch = newChallenge(req);
    res.json({ intent, level, needsVerification: true, challenge: ch, reply: t(lang, 'verify_prompt', { phrase: ch.phrase }) });
});

function verifyInfraMessage(err) {
    const m = String(err || '');
    if (!m) return null;
    if (/backend_mismatch/.test(m)) return 'Your voice profile was made with a different speaker backend. Remove it and enroll your voice again.';
    if (/fetch failed|ECONNREFUSED|speaker_service_http_|speaker_model_unavailable|speaker_service_invalid_embedding/.test(m)) return 'The ECAPA speaker service is not running or not ready. Start it with START_APP.bat and try again.';
    return null;
}

// Verify: challenge phrase correct (anti-replay) AND voice matches the owner profile.
app.post('/voice/verify', auth, async (req, res) => {
    const u = req.user, s = req.session;
    const lang = pickLang(req.body.lang, s.pending?.lang, u.language);
    const profile = db.voiceprints[u.id];
    if (!profile) return res.json({ success: false, reply: t(lang, 'enroll_needed') });
    if (isLocked(u.id)) return res.json({ success: false, locked: true, reply: t(lang, 'locked') });

    const ch = s.challenge;
    if (!ch || ch.used || Date.now() > ch.exp) {
        s.challenge = null;
        return res.json({ success: false, expired: true, reply: t(lang, 'challenge_expired') });
    }
    ch.used = true;                       // single use, even if this attempt fails
    s.challenge = ch;

    const started = Date.now();
    const wav = Buffer.from(String(req.body.audio || ''), 'base64');
    let transcript = req.body.transcript;
    if (stt.enabled) { try { transcript = await stt.transcribe(wav); } catch { transcript = ''; } }  // don't trust the client
    const chk = challenge.validate(ch, transcript);
    let spk = { pass: false, score: 0 }, audioErr = null, rp = { replay: false };
    try {
        const emb = await speaker.embed(wav);
        rp = replay.check(u.id, wav, emb);            // reused / near-identical recording = replay attack
        spk = speaker.score(profile, emb);
    } catch (e) { audioErr = e.message; }

    const ok = chk.ok && spk.pass && !audioErr && !rp.replay;
    audit(u.id, 'voice_verify', ok, `challenge=${chk.ok} speaker=${spk.pass} score=${spk.score.toFixed(3)} err=${audioErr || '-'} replay=${rp.replay ? rp.reason + ':' + rp.similarity : '-'} ms=${Date.now() - started}`);
    if (rp.replay) audit(u.id, 'replay_blocked', false, `${rp.reason} similarity=${rp.similarity}`);

    if (process.env.VOICE_DEBUG === '1') {                 // LOCAL DIAGNOSIS ONLY - never leave this on: it reveals scores
        const _json = res.json.bind(res), dbg = { phrase: chk.ok, voiceMatch: spk.pass, score: +spk.score.toFixed(3), threshold: speaker.THRESHOLD, err: audioErr, replay: rp.replay ? rp.reason : null, expected: challenge.text(ch), heard: String(transcript || '').slice(0, 60) };
        console.log('[VOICE_DEBUG]', JSON.stringify(dbg));
        res.json = o => _json({ ...o, debug: dbg });
    }
    if (!ok) {
        s.pending = null;
        // Infrastructure / setup problems say nothing about the speaker's identity, so they are reported
        // clearly and do NOT count toward the voice lockout.
        const infra = verifyInfraMessage(audioErr);
        if (infra) return res.json({ success: false, serviceError: true, reply: infra });
        // Pure audio-quality problems (too short / quiet / clipped) cannot authenticate anyone and leak nothing
        // about the owner's voice: give a hint and do not count them toward the lockout.
        if (audioErr && /too_short|too_quiet|clipped_audio|cannot_decode/.test(audioErr)) {
            return res.json({ success: false, locked: false, reply: 'Voice verification failed. The recording was too short, too quiet or distorted - speak the phrase clearly, closer to the mic.' });
        }
        const locked = noteVoiceFail(u.id);
        if (rp.replay && !locked) return res.json({ success: false, locked, replay: true, reply: 'Voice verification failed. This recording was already used - speak the phrase live.' });
        return res.json({ success: false, locked, reply: t(lang, locked ? 'locked' : 'verify_failed') });
    }
    s.voiceAuthAt = Date.now();
    voiceFails.delete(u.id);
    const pending = s.pending;
    s.pending = null;
    s.stepUp = pending && pending.type ? { purpose: pending.type, at: Date.now() } : null;
    if (pending?.intent) return res.json({ success: true, intent: pending.intent, ...runIntent(u, pending.intent, pending.lang) });
    res.json({ success: true });
});

// ==================== PAYMENTS: owner voice + OTP/PIN ====================
function validatePayment(b, user) {
    const amount = Math.round(Number(b.amount) * 100) / 100;
    const mode = String(b.mode || '').toLowerCase();
    const payee = String(b.payee || '').trim().slice(0, 80);
    if (!Number.isFinite(amount) || amount <= 0) return 'Enter a valid amount';
    if (amount > CFG.TXN_LIMIT) return `Per-transaction limit is ₹${inr(CFG.TXN_LIMIT)}`;
    if (!payee) return 'Beneficiary name is required';
    if (!['upi', 'neft', 'imps'].includes(mode)) return 'Invalid payment mode';
    const upiId = String(b.upiId || '').trim(), account = String(b.account || '').trim(), ifsc = String(b.ifsc || '').trim().toUpperCase();
    if (mode === 'upi' && !/^[\w.\-]{2,}@[a-z]{2,}$/i.test(upiId)) return 'Enter a valid UPI ID (name@bank)';
    if (mode !== 'upi' && (!/^\d{9,18}$/.test(account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))) return 'Enter a valid account number and IFSC';
    if (user.balance < amount) return 'Insufficient balance';
    return { amount, mode, payee, upiId, account, ifsc, description: String(b.description || '').trim().slice(0, 120) || `Payment to ${payee}` };
}

app.post('/payment/initiate', auth, (req, res) => {
    const u = req.user, s = req.session;
    const data = validatePayment(req.body, u);
    if (typeof data === 'string') return res.json({ success: false, message: data });
    if (!db.voiceprints[u.id]) return res.json({ success: false, needsEnrollment: true, message: t(u.language, 'enroll_needed') });
    if (isLocked(u.id)) return res.json({ success: false, locked: true, message: t(u.language, 'locked') });

    const vch = requireStepUp(req, 'payment');                // step 1: owner voice, required for EVERY payment
    if (vch) return res.json({ success: false, needsVerification: true, challenge: vch });
    const code = String(crypto.randomInt(100000, 1000000));    // step 2: OTP (generated and checked on the server)
    const salt = crypto.randomBytes(8).toString('hex');
    s.payment = { data, salt, otpHash: crypto.createHash('sha256').update(code + salt).digest('hex'), exp: Date.now() + CFG.OTP_TTL_MS, attempts: 0, voiceAt: Date.now() };
    audit(u.id, 'otp_sent', true, `amount ${data.amount}`);
    if (CFG.DEMO_MODE) console.log(`📱 [demo] OTP for ${u.username}: ${code}`);
    res.json({ success: true, stage: 'otp', maskedPhone: maskPhone(u.phone), expiresInSec: CFG.OTP_TTL_MS / 1000, demoOtp: CFG.DEMO_MODE ? code : undefined });
});

app.post('/payment/confirm', auth, (req, res) => {
    const u = req.user, s = req.session, p = s.payment;
    if (!p || Date.now() > p.exp) { s.payment = null; return res.json({ success: false, message: 'Payment session expired. Please start again.' }); }
    if (!p.voiceAt || Date.now() - p.voiceAt > CFG.TRANSFER_VOICE_MS + CFG.OTP_TTL_MS) { s.payment = null; return res.json({ success: false, message: 'Voice verification expired. Please start again.' }); }
    if (++p.attempts > 3) { s.payment = null; audit(u.id, 'payment_blocked', false, 'too many code attempts'); return res.json({ success: false, message: 'Too many wrong attempts. Payment cancelled.' }); }

    const code = String(req.body.code || '');
    const okCode = req.body.method === 'pin'
        ? verifySecret(code, u.pinHash)
        : crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(code + p.salt).digest('hex')), Buffer.from(p.otpHash));
    s.payment = p;
    if (!okCode) { audit(u.id, 'payment_code', false); return res.json({ success: false, message: `Incorrect ${req.body.method === 'pin' ? 'PIN' : 'OTP'}. ${4 - p.attempts} attempt(s) left.` }); }

    const d = p.data;
    if (u.balance < d.amount) { s.payment = null; return res.json({ success: false, message: 'Insufficient balance' }); }
    u.balance = Math.round((u.balance - d.amount) * 100) / 100;
    const txn = {
        id: 'TXN' + Date.now() + crypto.randomInt(100, 999), user_id: u.id, type: 'debit', amount: d.amount, description: d.description,
        date: new Date().toISOString(), mode: d.mode.toUpperCase(), payee: d.payee, status: 'success',
        reference: d.mode === 'upi' ? d.upiId : d.account, ifsc: d.mode === 'upi' ? '' : d.ifsc,
    };
    db.transactions.push(txn);
    s.payment = null;
    s.voiceAuthAt = 0;                                          // every transfer needs a fresh voice check
    audit(u.id, 'payment', true, `${txn.id} amount ${d.amount}`);
    res.json({ success: true, newBalance: u.balance, transaction: txn });
});

app.post('/payment/cancel', auth, (req, res) => { req.session.payment = null; res.json({ success: true }); });

// ==================== RECEIPTS (built from stored data, never from client input) ====================
app.get('/transaction/:id', auth, (req, res) => {
    const x = tx(req.params.id);
    if (!x || x.user_id !== req.user.id) return res.status(404).json({ success: false });
    res.json({ success: true, transaction: x });
});

app.get('/transaction/:id/receipt', auth, (req, res) => {
    const x = tx(req.params.id), u = req.user;
    if (!x || x.user_id !== u.id) return res.status(404).json({ success: false });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${x.id}.pdf`);
    doc.pipe(res);
    doc.fontSize(25).font('Helvetica-Bold').fillColor('#003366').text('VAANI BANK', { align: 'center' });
    doc.fontSize(12).fillColor('#E31837').text('Payment Receipt (Demo)', { align: 'center' });
    const rows = [
        ['Transaction ID', x.id], ['Date & Time', moment(x.date).format('DD-MM-YYYY HH:mm:ss')],
        ['From Account', maskAccount(u.account_number)], ['From Name', u.name],
        [x.type === 'credit' ? 'Type' : 'Beneficiary', x.type === 'credit' ? 'Credit' : (x.payee || '-')],
        ['Amount', `Rs. ${inr(x.amount)}`], ['Payment Mode', x.mode || '-'], ['Reference', x.reference || '-'],
        ['IFSC', x.ifsc || 'N/A'], ['Status', String(x.status).toUpperCase()], ['Description', x.description || '-'],
        ['Amount in words', `Rupees ${numberToWords(Math.floor(x.amount))} Only`],
    ];
    const top = 130;
    doc.rect(50, top - 15, 495, rows.length * 24 + 20).stroke('#003366');
    rows.forEach(([k, v], i) => {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text(k + ':', 70, top + i * 24);
        doc.font('Helvetica').text(String(v), 250, top + i * 24, { width: 280 });
    });
    doc.fontSize(9).fillColor('#666').text(`System generated receipt - ${moment().format('DD-MM-YYYY HH:mm:ss')}`, 50, top + rows.length * 24 + 40, { align: 'center' });
    doc.fontSize(8).fillColor('#003366').text('Demo project - AI Voice Banking - Not affiliated with VANNI Bank', { align: 'center' });
    doc.end();
});

function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if (num === 0) return 'Zero';
    const below1000 = n => (n < 20 ? ones[n] : n < 100 ? tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
        : ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below1000(n % 100) : ''));
    const parts = [[Math.floor(num / 1e7), 'Crore'], [Math.floor(num % 1e7 / 1e5), 'Lakh'], [Math.floor(num % 1e5 / 1e3), 'Thousand'], [num % 1000, '']];
    return parts.filter(([n]) => n > 0).map(([n, w]) => `${below1000(n)} ${w}`.trim()).join(' ');
}

app.locals.voiceFails = voiceFails;   // exposed for tests
module.exports = app;
if (require.main === module) {
    app.listen(CFG.PORT, () => {
        console.log(`✅ Server running at http://localhost:${CFG.PORT}`);
        console.log(`🔊 Speaker verification backend: ${speaker.BACKEND} (threshold ${speaker.THRESHOLD}) | server-side STT: ${stt.enabled ? 'on' : 'off (trusting browser transcript)'}`);
        console.log('📝 Demo login - ayush / 1234  (transaction PIN 4321)');
    });
}
