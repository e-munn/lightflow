"""
ML-based audio analysis using TensorFlow.

Available models:
- YAMNet: Audio event classification (521 classes including instruments, ambient sounds)
- Future: Custom models for energy prediction, section detection, etc.
"""

import numpy as np
from typing import Optional
import tensorflow as tf
import tensorflow_hub as hub

# Suppress TF warnings
tf.get_logger().setLevel('ERROR')

# Lazy-loaded models
_yamnet_model: Optional[tf.keras.Model] = None
_yamnet_classes: Optional[list] = None


def get_yamnet():
    """Load YAMNet model (lazy, cached)."""
    global _yamnet_model, _yamnet_classes

    if _yamnet_model is None:
        print("Loading YAMNet model...")
        _yamnet_model = hub.load('https://tfhub.dev/google/yamnet/1')

        # Load class names
        class_map_path = _yamnet_model.class_map_path().numpy().decode('utf-8')
        with tf.io.gfile.GFile(class_map_path) as f:
            _yamnet_classes = [line.strip().split(',')[2] for line in f.readlines()[1:]]

        print(f"YAMNet loaded with {len(_yamnet_classes)} classes")

    return _yamnet_model, _yamnet_classes


def analyze_audio_events(audio: np.ndarray, sr: int, top_k: int = 10) -> dict:
    """
    Classify audio events using YAMNet.

    Args:
        audio: Audio samples (mono, any sample rate - will be resampled)
        sr: Sample rate of input audio
        top_k: Number of top predictions to return

    Returns:
        {
            "events": [{"label": str, "score": float}, ...],
            "embeddings": np.ndarray  # 1024-dim embeddings per frame
        }
    """
    model, classes = get_yamnet()

    # YAMNet expects 16kHz mono audio
    if sr != 16000:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    # Ensure float32 in [-1, 1]
    audio = audio.astype(np.float32)
    if audio.max() > 1.0:
        audio = audio / 32768.0

    # Run inference
    scores, embeddings, spectrogram = model(audio)

    # Average scores across time
    mean_scores = scores.numpy().mean(axis=0)

    # Get top predictions
    top_indices = mean_scores.argsort()[-top_k:][::-1]
    events = [
        {"label": classes[i], "score": float(mean_scores[i])}
        for i in top_indices
    ]

    return {
        "events": events,
        "embeddings": embeddings.numpy(),
        "frame_scores": scores.numpy(),
    }


def get_instrument_presence(audio: np.ndarray, sr: int) -> dict:
    """
    Detect presence of common instruments/sounds.

    Returns dict with instrument names and confidence scores.
    """
    result = analyze_audio_events(audio, sr, top_k=50)

    # Map YAMNet classes to our categories
    instrument_keywords = {
        'bass': ['bass', 'double bass', 'bass guitar'],
        'drums': ['drum', 'snare', 'hi-hat', 'cymbal', 'percussion', 'beat'],
        'guitar': ['guitar', 'electric guitar', 'acoustic guitar'],
        'piano': ['piano', 'keyboard', 'synthesizer'],
        'vocals': ['singing', 'speech', 'voice', 'vocal'],
        'strings': ['violin', 'cello', 'string', 'orchestra'],
        'synth': ['synthesizer', 'electronic', 'synth'],
    }

    presence = {}
    for category, keywords in instrument_keywords.items():
        max_score = 0.0
        for event in result['events']:
            label_lower = event['label'].lower()
            if any(kw in label_lower for kw in keywords):
                max_score = max(max_score, event['score'])
        presence[category] = max_score

    return presence


def get_audio_embeddings(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Get 1024-dimensional audio embeddings from YAMNet.

    Useful for:
    - Similarity comparison between audio segments
    - Input features for custom ML models
    - Clustering/classification tasks

    Returns:
        np.ndarray of shape (num_frames, 1024)
    """
    result = analyze_audio_events(audio, sr, top_k=1)
    return result['embeddings']


def get_temporal_events(audio: np.ndarray, sr: int, threshold: float = 0.3) -> list:
    """
    Get time-stamped audio events above threshold.

    Returns list of {time, label, score} for significant events.
    """
    model, classes = get_yamnet()

    if sr != 16000:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    audio = audio.astype(np.float32)
    if audio.max() > 1.0:
        audio = audio / 32768.0

    scores, _, _ = model(audio)
    scores = scores.numpy()

    # YAMNet uses 0.96s frames with 0.48s hop
    frame_duration = 0.48

    events = []
    for frame_idx, frame_scores in enumerate(scores):
        top_idx = frame_scores.argmax()
        if frame_scores[top_idx] >= threshold:
            events.append({
                "time": frame_idx * frame_duration,
                "label": classes[top_idx],
                "score": float(frame_scores[top_idx])
            })

    return events
