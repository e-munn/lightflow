"""OSC stem server: streams stem energy data to TouchDesigner for visualization.

Reads a _stems.json file (from analyze.py) and sends time-synced OSC messages
at playback rate. Also supports syncing with an audio file for live playback.

Usage:
    python stem_server.py "Talk of the Town_stems.json"
    python stem_server.py "Talk of the Town_stems.json" --audio "~/Desktop/Talk of the Town.mp3"

OSC output (port 7000):
    /stem/bass      float 0-1
    /stem/kick      float 0-1
    /stem/snare     float 0-1
    /stem/hat       float 0-1
    /stem/vocals    float 0-1
    /stem/other     float 0-1
    /stem/centroid  float (Hz)
    /stem/time      float (seconds)
    /stem/all       float*8 (all values packed)
"""

import argparse
import json
import sys
import time
from pathlib import Path

from pythonosc import udp_client

# Channel name → OSC address mapping
CHANNEL_MAP = {
    "bass_energy": "/stem/bass",
    "kick_energy": "/stem/kick",
    "snare_energy": "/stem/snare",
    "hat_energy": "/stem/hat",
    "vocals_energy": "/stem/vocals",
    "other_energy": "/stem/other",
    "centroid": "/stem/centroid",
}


def load_stems(path: Path) -> dict:
    """Load stem analysis JSON."""
    with open(path) as f:
        data = json.load(f)
    print(f"Loaded: {data['song']} ({data['n_frames']} frames, {data['duration']:.1f}s)")
    return data


def stream_osc(data: dict, client: udp_client.SimpleUDPClient, loop: bool = False):
    """Stream stem data via OSC at the analysis FPS."""
    fps = data["fps"]
    frame_time = 1.0 / fps
    states = data["states"]
    n = len(states)

    print(f"Streaming to OSC @ {fps}fps (Ctrl+C to stop)")
    print(f"  Channels: {list(CHANNEL_MAP.keys())}")

    try:
        while True:
            t_start = time.time()

            for i, state in enumerate(states):
                frame_start = time.time()
                channels = state["channels"]
                t = state["time"]

                # Send individual channels
                for ch_name, osc_addr in CHANNEL_MAP.items():
                    if ch_name in channels:
                        client.send_message(osc_addr, float(channels[ch_name]))

                # Send time
                client.send_message("/stem/time", float(t))

                # Send packed message (all values in one)
                packed = [float(t)]
                for ch_name in CHANNEL_MAP:
                    packed.append(float(channels.get(ch_name, 0)))
                client.send_message("/stem/all", packed)

                # Print progress every second
                if i % fps == 0:
                    bars = ""
                    for ch in ["bass_energy", "kick_energy", "snare_energy", "hat_energy", "vocals_energy", "other_energy"]:
                        v = channels.get(ch, 0)
                        bar_len = int(v * 20)
                        bars += f"  {ch[:4]:4s} {'█' * bar_len}{'░' * (20 - bar_len)} {v:.2f}"
                    print(f"\r  [{t:6.1f}s / {data['duration']:.1f}s]{bars}", end="", flush=True)

                # Sleep to maintain framerate
                elapsed = time.time() - frame_start
                sleep_time = frame_time - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

            elapsed_total = time.time() - t_start
            print(f"\n  Playback complete ({elapsed_total:.1f}s)")

            if not loop:
                break
            print("  Looping...")

    except KeyboardInterrupt:
        print("\n  Stopped.")
        # Send zeros to clear visuals
        for osc_addr in CHANNEL_MAP.values():
            client.send_message(osc_addr, 0.0)
        client.send_message("/stem/time", -1.0)


def stream_with_audio(data: dict, client: udp_client.SimpleUDPClient, audio_path: Path):
    """Stream stem data synchronized with audio playback via sounddevice."""
    import sounddevice as sd
    import soundfile as sf

    audio_data, sr = sf.read(str(audio_path))
    if audio_data.ndim == 1:
        audio_data = audio_data.reshape(-1, 1)

    fps = data["fps"]
    frame_time = 1.0 / fps
    states = data["states"]
    n = len(states)
    duration = data["duration"]

    print(f"Playing audio + streaming OSC @ {fps}fps")

    # Start audio playback
    playback_start = time.time()
    sd.play(audio_data, sr)

    try:
        for i, state in enumerate(states):
            t = state["time"]
            channels = state["channels"]

            # Send OSC
            for ch_name, osc_addr in CHANNEL_MAP.items():
                if ch_name in channels:
                    client.send_message(osc_addr, float(channels[ch_name]))
            client.send_message("/stem/time", float(t))

            packed = [float(t)]
            for ch_name in CHANNEL_MAP:
                packed.append(float(channels.get(ch_name, 0)))
            client.send_message("/stem/all", packed)

            # Progress
            if i % fps == 0:
                bars = ""
                for ch in ["bass_energy", "kick_energy", "snare_energy", "hat_energy", "vocals_energy", "other_energy"]:
                    v = channels.get(ch, 0)
                    bar_len = int(v * 20)
                    bars += f"  {ch[:4]:4s} {'█' * bar_len}{'░' * (20 - bar_len)} {v:.2f}"
                print(f"\r  [{t:6.1f}s / {duration:.1f}s]{bars}", end="", flush=True)

            # Sync to audio clock
            target_time = playback_start + t + frame_time
            now = time.time()
            if target_time > now:
                time.sleep(target_time - now)

        print("\n  Playback complete.")
        sd.wait()

    except KeyboardInterrupt:
        print("\n  Stopped.")
        sd.stop()
        for osc_addr in CHANNEL_MAP.values():
            client.send_message(osc_addr, 0.0)


def main():
    parser = argparse.ArgumentParser(description="Stream stem analysis data via OSC to TouchDesigner")
    parser.add_argument("stems_json", type=str, help="Path to _stems.json file from analyze.py")
    parser.add_argument("--audio", type=str, default=None,
                        help="Audio file to play in sync (optional)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="OSC target host")
    parser.add_argument("--port", type=int, default=7000, help="OSC target port")
    parser.add_argument("--loop", action="store_true", help="Loop playback")
    args = parser.parse_args()

    stems_path = Path(args.stems_json).expanduser().resolve()
    if not stems_path.exists():
        print(f"Error: File not found: {stems_path}")
        sys.exit(1)

    data = load_stems(stems_path)
    client = udp_client.SimpleUDPClient(args.host, args.port)
    print(f"OSC → {args.host}:{args.port}")

    if args.audio:
        audio_path = Path(args.audio).expanduser().resolve()
        if not audio_path.exists():
            print(f"Error: Audio file not found: {audio_path}")
            sys.exit(1)
        stream_with_audio(data, client, audio_path)
    else:
        stream_osc(data, client, loop=args.loop)


if __name__ == "__main__":
    main()
