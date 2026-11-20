# Stage 2B status and honest completion checklist

## Present in this package

- Stage 2A shared audio preprocessing used by evaluation and the speaker service.
- Flask speaker service with lazy model loading and explicit 400/413/503 responses.
- Unit tests for audio preprocessing, metrics, trials and mocked service behavior.
- ECAPA speaker evaluation, threshold calibration and plotting scripts.
- Dataset/trial preparation helpers and Windows environment checker.

## Not yet verified/completed

1. Real ECAPA inference on the target Windows machine (model weights download required).
2. Successful FLAC decode with `soundfile` in the target environment.
3. Actual LibriSpeech/VoxCeleb evaluation with real audio files.
4. Real validation-calibrated threshold and held-out test metrics.
5. Anti-spoof detector model integration/training and evaluation.
6. Node `npm test` on the target machine after dependencies install.

## Suggested sequence

1. Run `ml/verify_stage2a_windows.ps1`.
2. Run `python ml/check_env.py --load-model`.
3. Follow `ml/data/DATASETS.md` and use only datasets whose terms you accept.
4. Generate validation and test trials with disjoint speakers; use `--forbid-speakers-from` for leakage protection.
5. Run `ml/eval/eval_speaker.py` on validation, calibrate threshold, then evaluate test using the frozen threshold.
6. Only after speaker pipeline is reproducible should anti-spoof model integration/training begin.

**Do not report numerical metrics until the scripts actually produce them from real datasets.**
