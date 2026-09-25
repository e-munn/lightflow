"""Local dance review worker. Every output is new and exclusively created."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback

from tracking import PrimaryTracker, BODY, describe, usable_pose


def save(path, value):
    with path.open('x') as output:
        json.dump(value, output, allow_nan=False, separators=(',', ':'))


def copy_exclusive(source, destination):
    """Copy bytes without ever replacing an earlier artifact."""
    with source.open('rb') as incoming, destination.open('xb') as outgoing:
        shutil.copyfileobj(incoming, outgoing)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--model-path')
    parser.add_argument('--model-label', default='MediaPipe Pose Landmarker Full')
    parser.add_argument('--replay-from', help='Existing run UUID; reuse its exact media bytes for a model-only comparison')
    args = parser.parse_args()
    run = Path(args.run).resolve()
    root = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs').resolve()
    if run.parent != root or not Path('/Volumes/ExtremePro').is_mount():
        raise ValueError('A new run on the mounted SanDisk is required')
    job = json.loads((run / 'job.json').read_text())
    config = json.loads((Path(__file__).parent / 'runtime.local.json').read_text())
    model_path = Path(args.model_path or config['model']).resolve()
    model_label = args.model_label
    sequence = 0

    def event(stage, message, t=None, **extra):
        nonlocal sequence
        save(run / 'events' / f'{sequence:06d}.json', {
            'id': sequence, 'wallTime': time.time(), 'stage': stage,
            'message': message, 't': t, **extra})
        sequence += 1

    try:
        event('prepare', 'Loading the local pose runtime. The first import may take a moment.')
        import av
        import numpy as np
        import mediapipe as mp
        ffmpeg = config['ffmpeg']
        if args.replay_from:
            original = (root / args.replay_from).resolve()
            if original.parent != root or original == run:
                raise ValueError('Replay source must be a different existing run')
            baseline_job = json.loads((original / 'job.json').read_text())
            if not (original / 'result.json').is_file() or any(job[k] != baseline_job[k] for k in ('sourceId', 'start', 'duration')):
                raise ValueError('Replay requires a completed run with identical source and interval')
            event('prepare', 'Copying the exact original review media into a new run; model weights are the only extraction change.', comparisonSourceRun=args.replay_from)
            copy_exclusive(original / 'preview.mp4', run / 'preview.mp4')
            copy_exclusive(original / 'audio.m4a', run / 'audio.m4a')
            copy_exclusive(original / 'waveform.json', run / 'waveform.json')
            event('audio', 'Original audio and waveform copied without re-encoding or retiming.')
        else:
            event('prepare', 'Creating a synchronized H.264/AAC review clip from the source. Originals are retained.')
            subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
                        '-ss', str(job['start']), '-i', job['sourcePath'], '-t', str(job['duration']),
                        '-map', '0:v:0', '-map', '0:a:0', '-vf', 'scale=1280:-2',
                        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-fps_mode', 'passthrough',
                        '-c:a', 'aac', '-movflags', '+faststart', str(run / 'preview.mp4')], check=True)
            event('audio', 'Extracting source audio and its waveform on the review clip timebase.')
            subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
                        '-i', str(run / 'preview.mp4'), '-vn', '-c:a', 'copy', str(run / 'audio.m4a')], check=True)
            raw = subprocess.check_output([ffmpeg, '-nostdin', '-v', 'error', '-i', str(run / 'preview.mp4'),
                                       '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'])
            samples = np.frombuffer(raw, dtype='<f4')
            peaks = [round(float(np.max(np.abs(samples[i:i + 160]))), 5) for i in range(0, len(samples), 160)]
            save(run / 'waveform.json', {'step': 0.02, 'duration': len(samples) / 8000, 'peaks': peaks})
        event('pose', f'Running {model_label}, up to 6 bodies per frame. Primary tracking uses a separate position/shape heuristic.', model=model_label, modelSha256=hashlib.sha256(model_path.read_bytes()).hexdigest())
        extraction_started = time.monotonic()
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=6,
            min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5)
        solo = job.get('trackingMode') == 'solo'
        tracker = PrimaryTracker(solo=solo)
        event('decision', 'Strict solo gate: exactly one detected body; stop association after a cut or sustained loss. Confidence is not identity accuracy.' if solo else 'Legacy group association; intended identity is unverified.', kind='policy')
        chunk, chunk_index, count, tracked = [], 0, 0, 0
        usable, single, multiple, cut_count, gated = 0, 0, 0, 0, 0
        previous_small, previous_primary, previous_t, previous_track = None, None, None, None
        last_state, last_ms, last_progress = None, -1, -1
        with av.open(str(run / 'preview.mp4')) as container, mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            stream = container.streams.video[0]
            fps = float(stream.average_rate)
            for frame in container.decode(stream):
                if (run / 'cancel.json').exists():
                    event('cancelled', 'Processing cancelled. Partial frames and all existing artifacts retained.')
                    break
                if frame.pts is None:
                    raise ValueError('Video frame has no presentation timestamp')
                t = float(frame.pts * frame.time_base)
                rgb = frame.to_ndarray(format='rgb24')
                small = rgb[::24, ::24].astype(np.float32) / 255
                cut = previous_small is not None and float(np.mean(np.abs(small - previous_small))) > 0.30
                previous_small = small
                if cut:
                    tracker.scene_cut()
                    cut_count += 1
                    event('decision', 'Large whole-frame change: possible cut. Review this boundary; solo mode stops automatic association.', t, kind='cut')
                ms = round(t * 1000)
                if ms <= last_ms:
                    raise ValueError('Non-increasing frame timestamps; cannot safely align poses')
                last_ms = ms
                result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ms)
                poses = [[[round(float(p.x), 5), round(float(p.y), 5), round(float(p.z), 5),
                           round(float(min(p.visibility, p.presence)), 4)] for p in pose] for pose in result.pose_landmarks]
                primary, track, state, reason = tracker.select(poses, t)
                single += len(poses) == 1
                multiple += len(poses) > 1
                gated += state == 'review_required'
                pose_usable = primary is not None and usable_pose(poses[primary])
                usable += pose_usable
                speed = None
                if primary is not None:
                    tracked += 1
                    points = poses[primary]
                    if previous_primary is not None and previous_track == track and not cut and t > previous_t:
                        center, scale, _, _ = describe(points)
                        old_center, old_scale, _, _ = describe(previous_primary)
                        valid = [j for j in BODY if min(points[j][3], previous_primary[j][3]) >= 0.5]
                        if valid:
                            speed = sum(sum(((points[j][d] - center[d]) / scale - (previous_primary[j][d] - old_center[d]) / old_scale) ** 2 for d in (0, 1)) ** 0.5 for j in valid) / len(valid) / (t - previous_t)
                    previous_primary, previous_t, previous_track = points, t, track
                else:
                    previous_primary = None
                if state != last_state or state == 'selected':
                    event('decision', reason, t, kind=state, track=track, candidates=len(poses))
                last_state = state
                chunk.append({'t': round(t, 6), 'index': count, 'poses': poses, 'primary': primary,
                              'track': track if primary is not None else None, 'state': state,
                              'speed': round(speed, 4) if speed is not None else None, 'cut': cut, 'poseUsable': pose_usable})
                count += 1
                if len(chunk) == 48:
                    save(run / 'frames' / f'{chunk_index:06d}.json', chunk)
                    chunk, chunk_index = [], chunk_index + 1
                if int(t) >= last_progress + 2:
                    event('progress', f'Processed {count} frames; {tracked} with a primary dancer.', t,
                          frames=count, tracked=tracked, progress=min(0.99, t / job['duration']))
                    last_progress = int(t)
            if chunk:
                save(run / 'frames' / f'{chunk_index:06d}.json', chunk)
            if (run / 'cancel.json').exists():
                return
            save(run / 'result.json', {'frames': count, 'tracked': tracked, 'fps': fps,
                 'duration': t + 1 / fps if count else 0,
                 'coverage': tracked / count if count else 0, 'poseModel': model_label,
                 'poseModelSha256': hashlib.sha256(model_path.read_bytes()).hexdigest(),
                 'comparisonSourceRun': args.replay_from, 'extractionSeconds': time.monotonic() - extraction_started,
                 'metricsVersion': 2, 'trackingMode': job.get('trackingMode', 'legacy'),
                 'usableFrames': usable, 'poseCoverage': usable / count if count else 0,
                 'singleBodyFrames': single, 'multipleBodyFrames': multiple, 'cutFlags': cut_count,
                 'reviewRequiredFrames': gated, 'identityAccuracy': None,
                 'coverageDefinition': 'Association coverage is a primary assignment, not correct identity. Pose coverage additionally requires all 12 limb/torso joints with visibility/presence >= 0.5 and inside frame.',
                 'versions': {'mediapipe': mp.__version__, 'av': av.__version__},
                 'lightingModel': None, 'primaryTracking': 'Position/shape heuristic, not person re-identification',
                 'limitations': ['Fast crossings and camera movement can confuse identity association.',
                                'Cut detection is a whole-frame-change heuristic and needs review.',
                                'Joint speed is an unfiltered diagnostic, not a lighting target.']})
            event('complete', 'Pose extraction complete. Ready for human review. No dance-to-light model has run.', frames=count, tracked=tracked, progress=1)
    except Exception as error:
        event('error', f'{type(error).__name__}: {error}')
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
