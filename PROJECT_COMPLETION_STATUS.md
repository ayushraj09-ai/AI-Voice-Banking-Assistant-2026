# Project completion status — 28 Oct 2026

## Verified in this workspace
- Node.js syntax checks: `node --check server.js` and `node --check public/app.js` pass.
- Node smoke tests: `npm test` passes 14/14.
- Python unit tests: `python -m unittest discover -s ml/tests -v` runs 31 tests; 23 pass and 8 are skipped due to missing optional Flask/real model dependencies.
- Existing app contains owner-specific speaker matching, randomized spoken challenge phrases, single-use challenge checks, failed-verification lockout, and OTP/PIN second-factor flow. These are prototype controls, not proof of production-grade security.
- Voice enrollment session handling and session-secret stability changes are present in this package. If a prior browser session exists, log in again after starting the updated app.

## Still requires the user's Windows environment / real data
1. Run the app in the target browser and confirm login, `/me`, enroll, re-enroll and remove-profile flow. This cannot be certified by source inspection alone.
2. Install the optional Python dependencies and download the ECAPA model; run `python ml/check_env.py --load-model`.
3. Run speaker verification evaluation on a consented, speaker-disjoint real validation/test dataset and freeze the threshold before testing.
4. Integrate and evaluate a dedicated anti-spoofing model. Random phrase challenge is a replay-resistance measure, not a complete synthetic/deepfake/replay detector.
5. Verify the full voice banking and transfer flow on the user's machine. This is a demo and must not be connected to real accounts or real credentials.

## Test commands
```powershell
npm install
npm test
npm start
```
For the Python speaker pipeline, follow `START_HERE_HINGLISH.md` and `ml/README.md`.
