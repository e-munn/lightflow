"""LightFlow v2 - Real-time mic input to DMX lighting."""

import argparse

from src.engine import LightEngine


def main():
    parser = argparse.ArgumentParser(description="LightFlow v2: Mic → DMX")
    parser.add_argument("--dmx-port", type=str, default=None,
                        help="Serial port for ENTTEC DMX USB Pro (e.g. /dev/tty.usbserial-XXXX)")
    parser.add_argument("--device", type=int, default=None,
                        help="Audio input device index (run with --list-devices to see options)")
    parser.add_argument("--fps", type=int, default=40,
                        help="DMX output framerate (default: 40)")
    parser.add_argument("--sensitivity", type=float, default=1.0,
                        help="Global sensitivity multiplier (default: 1.0)")
    parser.add_argument("--list-devices", action="store_true",
                        help="List audio devices and exit")

    args = parser.parse_args()

    if args.list_devices:
        from src.audio import AudioAnalyzer
        print(AudioAnalyzer.list_devices())
        return

    engine = LightEngine(
        dmx_port=args.dmx_port,
        device=args.device,
        fps=args.fps,
    )
    engine.mapper.sensitivity = args.sensitivity
    engine.run()


if __name__ == "__main__":
    main()
