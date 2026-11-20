
from pathlib import Path
import numpy as np

from ml.service.speaker import SpeakerVerifier

# Converted voice samples folder
DATA_DIR = Path(
    r"C:\Users\DELL\Desktop\voice-banking-assistant\data\voice_samples\converted_16k"
)

PEOPLE = ["ashish", "ashutosh", "ayush", "dipu", "prince", "ravi"]

print("Loading speaker verification model...")
verifier = SpeakerVerifier()
print("Model loaded:", verifier.info())

# Generate embeddings for all recordings
embeddings = {}
failed = []

for person in PEOPLE:
    for number in range(1, 4):
        filename = f"{person}_voice_{number}.wav"
        path = DATA_DIR / filename

        if not path.exists():
            failed.append(filename)
            continue

        try:
            embeddings[filename] = verifier.embed_file(
                str(path), trim=True
            )
            print("Embedded:", filename)
        except Exception as error:
            print(f"FAILED: {filename}: {error}")
            failed.append(filename)

if failed:
    print("\nFiles that failed:", failed)

# Compare all recordings from the same person
same_scores = []

for person in PEOPLE:
    files = [
        f"{person}_voice_{number}.wav"
        for number in range(1, 4)
        if f"{person}_voice_{number}.wav" in embeddings
    ]

    for i in range(len(files)):
        for j in range(i + 1, len(files)):
            score = verifier.score(
                embeddings[files[i]], embeddings[files[j]]
            )
            same_scores.append(score)
            print(
                f"SAME  {files[i]} vs {files[j]}: {score:.4f}"
            )

# Compare recordings belonging to different people
different_scores = []

for i, person_a in enumerate(PEOPLE):
    for person_b in PEOPLE[i + 1:]:
        for a in range(1, 4):
            for b in range(1, 4):
                file_a = f"{person_a}_voice_{a}.wav"
                file_b = f"{person_b}_voice_{b}.wav"

                if file_a not in embeddings or file_b not in embeddings:
                    continue

                score = verifier.score(
                    embeddings[file_a], embeddings[file_b]
                )
                different_scores.append(score)

print("\n========== SUMMARY ==========")
print("Successful embeddings:", len(embeddings))
print("Failed recordings:", len(failed))

if same_scores:
    print(f"Same-person comparisons: {len(same_scores)}")
    print(f"Same-person mean: {np.mean(same_scores):.4f}")
    print(f"Same-person minimum: {np.min(same_scores):.4f}")

if different_scores:
    print(f"Different-person comparisons: {len(different_scores)}")
    print(f"Different-person mean: {np.mean(different_scores):.4f}")
    print(f"Different-person maximum: {np.max(different_scores):.4f}")

if same_scores and different_scores:
    print(
        "Observed separation:",
        f"{np.mean(same_scores) - np.mean(different_scores):.4f}"
    )
# Preliminary threshold evaluation
if same_scores and different_scores:
    threshold = (min(same_scores) + max(different_scores)) / 2

    false_rejections = sum(
        score < threshold for score in same_scores
    )
    false_acceptances = sum(
        score >= threshold for score in different_scores
    )

    print("\n========== THRESHOLD EVALUATION ==========")
    print(f"Test threshold: {threshold:.4f}")
    print(
        f"Same-person pairs rejected: "
        f"{false_rejections}/{len(same_scores)}"
    )
    print(
        f"Different-person pairs accepted: "
        f"{false_acceptances}/{len(different_scores)}"
    )