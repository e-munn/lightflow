"""Conservative primary-dancer association. No learned identity/re-identification."""
import math

CORE = (11, 12, 23, 24)
BODY = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)


def usable_pose(points):
    """All 12 major limb/torso joints visible and inside the frame."""
    return all(points[i][3] >= 0.5 and 0 <= points[i][0] <= 1 and 0 <= points[i][1] <= 1 for i in BODY)


def describe(points):
    center = [sum(points[i][d] for i in CORE) / 4 for d in (0, 1)]
    scale = max(0.04, math.dist(points[11][:2], points[23][:2]),
                math.dist(points[12][:2], points[24][:2]))
    quality = sum(points[i][3] for i in BODY) / len(BODY)
    core_quality = min(points[i][3] for i in CORE)
    return center, scale, quality, core_quality


class PrimaryTracker:
    def __init__(self, grace=1.0, solo=False):
        self.grace = grace
        self.solo = solo
        self.blocked = False
        self.last = None
        self.last_time = None
        self.track = 0

    def reset(self):
        self.last = None
        self.last_time = None

    def scene_cut(self):
        if self.solo:
            self.blocked = True
        else:
            self.reset()

    def select(self, poses, timestamp):
        if self.solo:
            if self.last_time is not None and timestamp - self.last_time > self.grace:
                self.blocked = True
            if self.blocked:
                return None, self.track, 'review_required', 'Primary lock stopped after a cut or sustained loss. Review and start a new passage; no automatic identity reassignment.'
            if len(poses) != 1:
                return None, self.track, 'multiple_bodies' if poses else 'gap', 'Solo gate requires exactly one detected body. This frame is missing data, not stillness.'
        candidates = [(i, p, describe(p)) for i, p in enumerate(poses)]
        candidates = [c for c in candidates if c[2][2] >= 0.55 and c[2][3] >= 0.5]
        if self.last is not None and timestamp - self.last_time > self.grace:
            self.reset()
        if not candidates:
            return None, self.track, 'gap', 'No reliable body; missing data, not stillness.'
        if self.last is None:
            # Horizontal center matters most; visibility breaks ties.
            i, points, desc = min(candidates, key=lambda c: abs(c[2][0][0] - 0.5) + 0.3 * (1 - c[2][2]))
            self.track += 1
            self.last, self.last_time = points, timestamp
            return i, self.track, 'selected', ('Selected the only detected body. Identity still requires visual review.' if self.solo else 'Selected a central, visible dancer; keeping this identity while association is reliable.')
        old_center, old_scale, _, _ = describe(self.last)
        matches = []
        for i, points, desc in candidates:
            center, scale, _, _ = desc
            distance = math.dist(center, old_center) / old_scale
            shape = sum(math.dist([(points[j][d] - center[d]) / scale for d in (0, 1)],
                                  [(self.last[j][d] - old_center[d]) / old_scale for d in (0, 1)])
                        for j in CORE) / len(CORE)
            score = distance + 0.25 * shape + 0.3 * abs(math.log(scale / old_scale))
            matches.append((score, i, points))
        matches.sort(key=lambda c: c[0])
        best = matches[0]
        if best[0] > 0.85 or (len(matches) > 1 and matches[1][0] - best[0] < 0.12):
            return None, self.track, 'gap', 'Identity association uncertain; holding the lock briefly instead of switching dancers.'
        self.last, self.last_time = best[2], timestamp
        return best[1], self.track, 'locked', 'Associated with the previous body position and proportions.'
