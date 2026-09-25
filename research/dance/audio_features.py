"""Causal audio features shared numerically with public/dance-audio.mjs.

16 kHz mono; trailing 512 samples; 320-sample hops. No centered STFT, clip-wide
audio normalization, future frames, beat-grid lookahead, or video at inference.
"""
import numpy as np

RATE, WINDOW, HOP = 16000, 512, 320
EDGES = (0, 80, 160, 320, 640, 1280, 2560, 5120, 8001)
LAGS = (0, 1, 2, 4, 8, 16, 32, 64)
BASE_NAMES = [f'log_power_{a}_{b}' for a, b in zip(EDGES[:-1], EDGES[1:])] + ['log_rms', 'flux', 'centroid', 'zcr']
NAMES = [f'{n}_lag{lag}' for lag in LAGS for n in BASE_NAMES]


def extract(samples):
    samples = np.asarray(samples, dtype=np.float64)
    if samples.ndim != 1 or not np.isfinite(samples).all():
        raise ValueError('Finite mono audio required')
    hann = .5 - .5 * np.cos(2*np.pi*np.arange(WINDOW)/(WINDOW-1))
    freq = np.fft.rfftfreq(WINDOW, 1/RATE)
    bands = [(freq >= a) & (freq < b) for a,b in zip(EDGES[:-1],EDGES[1:])]
    rows, rms_values, previous = [], [], np.zeros(8)
    for end in range(HOP, len(samples)+1, HOP):
        frame = np.zeros(WINDOW)
        tail = samples[max(0, end-WINDOW):end]
        frame[-len(tail):] = tail
        power = abs(np.fft.rfft(frame*hann))**2 / WINDOW**2
        band = np.array([np.log1p(10000*np.sum(power[m])) for m in bands])
        rms = np.sqrt(np.mean(frame**2))
        flux = np.maximum(0,band-previous).mean()
        centroid = np.sum(freq*power)/max(1e-12,power.sum())/(RATE/2)
        zcr = np.count_nonzero((frame[:-1]>=0) != (frame[1:]>=0))/(WINDOW-1)
        rows.append(np.r_[band,np.log1p(100*rms),flux,centroid,zcr])
        rms_values.append(rms)
        previous = band
    if not rows:
        return np.empty((0,len(NAMES))), np.empty(0), np.empty(0)
    base = np.asarray(rows)
    x = np.concatenate([base[np.maximum(0,np.arange(len(base))-lag)] for lag in LAGS],axis=1)
    return x, np.arange(1,len(x)+1)*HOP/RATE, np.asarray(rms_values)


def fit_ridge(x,y,alpha):
    mean, std = x.mean(axis=0), np.maximum(.05,x.std(axis=0))
    z = np.clip((x-mean)/std,-8,8)
    offset = y.mean(axis=0)
    weights = np.linalg.solve(z.T@z+np.eye(z.shape[1])*alpha*len(z),z.T@(y-offset))
    return {'mean':mean,'std':std,'weights':weights,'offset':offset,'alpha':alpha}


def predict(model,x):
    return np.clip((np.clip((x-model['mean'])/model['std'],-8,8)@model['weights'])+model['offset'],0,1)


def brightness(y):
    # Explicit authored target, frozen before evaluation. Held extension remains lit.
    # arms, legs, center travel, extension, deceleration, holding
    return np.clip(.10+.45*y[...,3]+.25*y[...,4]+.10*y[...,0]+.10*y[...,1],0,1)
