
from pathlib import Path
import soundfile as sf
from ml.common.audio import preprocess

source_dir = Path("data/voice_samples")
output_dir = source_dir / "converted_16k"
output_dir.mkdir(exist_ok=True)

files = [
    "ashish_voice_1.wav",
    "ashish_voice_2.wav",
]

for filename in files:
    source_file = source_dir / filename
    output_file = output_dir / filename

    try:
        result = preprocess(str(source_file))

        sf.write(
            str(output_file),
            result["wave"],
            16000,
            subtype="PCM_16",
        )

        print(f"SUCCESS: {filename}")
        print(f"Duration: {result['duration_sec']:.2f} seconds")
        print(f"Audio level: {result['rms_dbfs']:.1f} dBFS")
        print("-" * 35)

    except Exception as error:
        print(f"FAILED: {filename}")
        print(f"Reason: {error}")
        print("-" * 35)
