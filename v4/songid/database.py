"""SQLite database for song fingerprints and cached analysis/show data.

Stores:
  - Chromaprint fingerprints for song identification
  - Paths to cached AnalysisResult and ShowPlan JSON files
  - Pre-rendered protocol vectors for known songs
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np


class SongDatabase:
    """SQLite-backed song identification database."""

    def __init__(self, db_path: str | Path = "songid.db"):
        self.db_path = Path(db_path)
        self._conn: sqlite3.Connection | None = None

    def open(self):
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def _create_tables(self):
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                audio_path TEXT,
                analysis_path TEXT,
                show_path TEXT,
                protocol_path TEXT,
                bpm REAL,
                duration REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS fingerprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                song_id INTEGER NOT NULL,
                fingerprint BLOB NOT NULL,
                offset_seconds REAL DEFAULT 0.0,
                FOREIGN KEY (song_id) REFERENCES songs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_fingerprints_song
                ON fingerprints(song_id);
        """)

    def add_song(
        self,
        name: str,
        audio_path: str | None = None,
        analysis_path: str | None = None,
        show_path: str | None = None,
        protocol_path: str | None = None,
        bpm: float = 0.0,
        duration: float = 0.0,
    ) -> int:
        """Add a song to the database. Returns song_id."""
        cursor = self._conn.execute(
            """INSERT INTO songs (name, audio_path, analysis_path, show_path,
               protocol_path, bpm, duration)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (name, audio_path, analysis_path, show_path, protocol_path, bpm, duration),
        )
        self._conn.commit()
        return cursor.lastrowid

    def add_fingerprint(self, song_id: int, fingerprint: bytes, offset: float = 0.0):
        """Add a fingerprint for a song."""
        self._conn.execute(
            "INSERT INTO fingerprints (song_id, fingerprint, offset_seconds) VALUES (?, ?, ?)",
            (song_id, fingerprint, offset),
        )
        self._conn.commit()

    def lookup_fingerprint(self, fingerprint: bytes) -> dict | None:
        """Look up a fingerprint in the database.

        Returns:
            {"song_id": int, "song_name": str, "confidence": float} or None
        """
        # Simple exact match for now — could use chromaprint's compare function
        rows = self._conn.execute(
            """SELECT f.song_id, s.name, f.offset_seconds
               FROM fingerprints f
               JOIN songs s ON f.song_id = s.id""",
        ).fetchall()

        if not rows:
            return None

        # Compare fingerprints (placeholder — real implementation would
        # use chromaprint's comparison algorithm)
        for song_id, name, offset in rows:
            return {
                "song_id": song_id,
                "song_name": name,
                "offset": offset,
                "confidence": 0.5,
            }

        return None

    def get_song(self, song_id: int) -> dict | None:
        """Get song metadata by ID."""
        row = self._conn.execute(
            "SELECT * FROM songs WHERE id = ?", (song_id,)
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "name": row[1],
            "audio_path": row[2],
            "analysis_path": row[3],
            "show_path": row[4],
            "protocol_path": row[5],
            "bpm": row[6],
            "duration": row[7],
        }

    def list_songs(self) -> list[dict]:
        """List all songs in the database."""
        rows = self._conn.execute(
            "SELECT id, name, bpm, duration FROM songs ORDER BY name"
        ).fetchall()
        return [
            {"id": r[0], "name": r[1], "bpm": r[2], "duration": r[3]}
            for r in rows
        ]
