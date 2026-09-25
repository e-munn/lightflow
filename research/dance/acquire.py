"""Acquire public research candidates into a new, exclusive SanDisk batch.

No cookies, overwrites, cleanup or deletion. All downloaded intermediates stay.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('ids', nargs='+')
    args = parser.parse_args()
    if not Path('/Volumes/ExtremePro').is_mount():
        raise RuntimeError('SanDisk must be mounted')
    batch = Path(tempfile.mkdtemp(prefix='candidates-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-', dir=ROOT))
    print(json.dumps({'batch': str(batch)}), flush=True)
    downloader = '/private/tmp/lightflow-dance-downloader/bin/yt-dlp'
    config = json.loads((Path(__file__).parent / 'runtime.local.json').read_text())
    for video_id in args.ids:
        if len(video_id) != 11 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in video_id):
            raise ValueError('Invalid YouTube ID')
        folder = batch / video_id
        folder.mkdir()
        command = [downloader, '--no-playlist', '--no-overwrites', '--keep-video', '--write-info-json',
                   '--no-cache-dir', '--no-progress', '--js-runtimes', 'node', '--merge-output-format', 'mkv',
                   '--ffmpeg-location', str(Path(config['ffmpeg']).parent),
                   '-f', 'bv*[height<=720]+ba/b[height<=720]',
                   '-o', str(folder / '%(id)s.%(ext)s'), f'https://www.youtube.com/watch?v={video_id}']
        with (folder / 'download.log').open('x') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        print(json.dumps({'id': video_id, 'exitCode': result.returncode, 'directory': str(folder)}), flush=True)
    with (batch / 'batch.json').open('x') as f:
        json.dump({'ids': args.ids, 'createdAt': datetime.now(timezone.utc).isoformat(),
                   'policy': 'Screening candidates only; no automatic training admission.'}, f)


if __name__ == '__main__':
    main()
