'use client';

// Show player — plays a track's audio and fires its scene cues on the timeline.
//
// lightflow owns the clock (the <audio> element it plays IS the timebase), so
// cues land frame-accurate with no listening/alignment. Each animation frame we
// find the most-recent cue at audio.currentTime and, when it changes, hand it to
// `applyCue`. Because cues are absolute looks, applying only the current one is
// correct under play, pause, and scrub-backward alike.
//
// The hook stays decoupled from the console: the page passes `applyCue` (force-
// set a look) and `onTempo` (lock the beat clock to the show BPM on play). The
// page's own keyboard control keeps working — the operator can always grab it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Show, Cue, cueIndexAt } from '@/lib/shows';

interface ShowPlayerCallbacks {
  applyCue: (cue: Cue) => void;
  onTempo?: (bpm: number) => void;
}

export interface ShowPlayer {
  show: Show | null;
  playing: boolean;
  time: number; // seconds into the track
  play: (show: Show) => void;
  stop: () => void;
  seek: (t: number) => void;
}

export function useShowPlayer({ applyCue, onTempo }: ShowPlayerCallbacks): ShowPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const showRef = useRef<Show | null>(null);
  const lastIdxRef = useRef<number>(-2); // -2 = nothing applied yet
  const lastSecRef = useRef<number>(-1); // throttle the displayed time to whole seconds
  const rafRef = useRef<number>(0);
  // latest callbacks without re-binding the loop
  const cbRef = useRef<ShowPlayerCallbacks>({ applyCue, onTempo });
  cbRef.current = { applyCue, onTempo };

  const [show, setShow] = useState<Show | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  // drive the cue timeline off the audio clock
  const tick = useCallback(() => {
    const audio = audioRef.current;
    const sh = showRef.current;
    if (audio && sh) {
      const t = audio.currentTime;
      // cue firing runs every frame off the audio clock; the displayed time
      // only re-renders on whole-second changes to keep the console light.
      const sec = Math.floor(t);
      if (sec !== lastSecRef.current) {
        lastSecRef.current = sec;
        setTime(t);
      }
      const idx = cueIndexAt(sh, t);
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        if (idx >= 0) cbRef.current.applyCue(sh.cues[idx]);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const play = useCallback((sh: Show) => {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('ended', () => setPlaying(false));
      audio.addEventListener('pause', () => setPlaying(false));
      audio.addEventListener('play', () => setPlaying(true));
      audioRef.current = audio;
    }
    if (audio.src.split('/').pop() !== sh.audio.split('/').pop()) audio.src = sh.audio;
    showRef.current = sh;
    lastIdxRef.current = -2; // force the first cue to apply
    lastSecRef.current = -1;
    setShow(sh);
    cbRef.current.onTempo?.(sh.bpm); // lock motion to the song
    audio.currentTime = 0;
    void audio.play();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    showRef.current = null;
    lastIdxRef.current = -2;
    lastSecRef.current = -1;
    setShow(null);
    setTime(0);
  }, []);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, t);
  }, []);

  return { show, playing, time, play, stop, seek };
}
