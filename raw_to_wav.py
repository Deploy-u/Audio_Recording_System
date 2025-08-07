#!/usr/bin/env python3
import wave
import sys

def raw_to_wav(raw_file, wav_file, channels=1, sampwidth=2, framerate=16000):
    # Read raw PCM data
    with open(raw_file, 'rb') as rf:
        pcm_data = rf.read()

    # Write WAV file
    with wave.open(wav_file, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)     # 2 bytes for PCM_16BIT
        wf.setframerate(framerate)
        wf.writeframes(pcm_data)

    print(f"Converted {raw_file} ➔ {wav_file}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python raw_to_wav.py input.raw output.wav")
        sys.exit(1)
    raw_to_wav(sys.argv[1], sys.argv[2])
