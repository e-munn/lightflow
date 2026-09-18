# Ten additional dynamic interplays

Status: all eleven recipes now have live, manually selectable routing prototypes at `/scope/interplay`. Their mode switches use the incoming signal automatically. These are hand-designed hypotheses for listening comparison, not a trained controller or measured musical winners. Implementation and evidence: `LIVE_INTERPLAYS.md`. The proposals below retain the intended behavior; the implementation note describes current limits and exact controls.

The original user-endorsed direction remains recipe 0: **Space / Grain during restrained prebuild → Snap at the intense drop**. Only that contextual preference has been supplied. The ten options below are hypotheses, not additional user approvals or universal music rules.

## Shared contract

- One primary mode at any instant; two outputs overlap only during a controlled transition. Do not permanently sum every mode.
- Continue all underlying engines so a newly selected style has current audio history.
- Use the original spec's logging, causality, reset, blackout and bounded-brightness contract. Keep gain decisions separate from mode decisions.
- Distinguish **gesture routing** (tens to hundreds of milliseconds, deliberately changes within an attack/decay) from **passage routing** (sustained evidence and longer dwell). A global one-second dwell would incorrectly prevent the gesture recipes from working. Count unintended chatter separately from their intended accent-return events.
- Onset timing may be immediate; sustained-state decisions require evidence. Use only received audio. No timer is allowed to invent an audible reply or an upcoming drop.
- Band measurements are not instrument stems. Use absolute low/high energy as well as relative shares when detecting an arrival. Keep event intensity, texture, continuity and stereo geometry separate.
- The current bank does not expose pulse regularity or all absolute band energies in its compact metrics. Derive those causal descriptors from the existing worklet bands/onset events; do not silently treat them as already implemented.
- Preserve manual selection and show the selected recipe, current mode and reason outside fullscreen. Recipe-specific knobs should be limited to two initially, with common output intensity and transition controls.

## 1. Body and bite — Weight ↔ Snap

**Intent:** a substantial low-frequency body with distinct sharp attacks.

**Switch:** Weight carries sustained low-band activity. A clear broadband onset temporarily selects Snap on the detected attack, then returns to the currently running Weight output as the onset envelope decays. If low-band body is absent, avoid manufacturing a bright Weight tail.

**Cadence / knobs:** gesture routing; accent threshold and return time.

**What to listen for:** attacks feel sharper while bass/body remains connected. Compare against fixed Weight with the same gain profile. Closely spaced attacks may legitimately hold Snap; do not treat that as a reason to alternate modes on a free-running clock.

## 2. Texture opens — Grain ↔ Air

**Intent:** a change from grainy movement to lighter, high-frequency activity.

**Switch:** Grain follows broad, continuous texture. Move toward Air when high-band absolute energy/novelty and spectral centroid rise together relative to the recent passage. Return to Grain when that emphasis subsides. An increase in high-frequency *share* caused only by disappearing bass is insufficient evidence by itself.

**Cadence / knobs:** passage routing; high-frequency contrast and transition time.

**What to listen for:** high details take the lead when the sound opens, without treating every short high tick as a section change.

## 3. Punctuation to flow — Space ↔ Sustain

**Intent:** separated notes become a continuous phrase, then break apart again.

**Switch:** Space follows isolated events and intervening gaps. After midrange activity persists through those gaps, select Sustain. Return to Space when actual gaps reappear. Timing derives from observed continuity, not a presumed instrument or genre.

**Cadence / knobs:** passage routing; continuity duration and release.

**What to listen for:** detached passages stay articulate; connected material holds light naturally. Long output release must not fabricate a continuing sound through digital silence.

## 4. Lift, impact, body — Swell → Snap → Weight

**Intent:** three different attitudes across a build, its arrival and the established body afterward.

**Switch:** sustained rising activity/brightness selects Swell. A verified onset-plus-context arrival immediately selects Snap. Once the initial arrival settles, strong continuing low-band body selects Weight. Keep Snap if repeated sharp attacks remain the dominant evidence; the final Weight phase is conditional, not mandatory after a timer.

**Cadence / knobs:** passage routing with an immediate impact transition; build sensitivity and body-settle time.

**What to listen for:** a build develops, the arrival lands, and its body occupies a different role. Reject premature Snap during a snare roll or a move to Weight when no body actually remains.

## 5. Hit versus rebound — Snap ↔ Breathe

**Intent:** contrast direct accents with a groove that moves through the spaces after them.

**Switch:** isolated/irregular sharp attacks use Snap. Once multiple observed onset intervals support a stable repeated pulse, select Breathe; its real onset-driven dip/recovery supplies the movement. Return to Snap when pulse regularity breaks or isolated punctuation returns. No autonomous beat oscillator is introduced.

**Cadence / knobs:** passage routing; regularity requirement and recovery time.

**What to listen for:** repeated rhythm begins to breathe rather than flash on every hit. Breathe still follows each detected onset; recognition of a pulse is not permission to predict an unknown next event.

## 6. Focus and opening — Circle ↔ Width

**Intent:** preserve fine direct response while letting widening stereo geometry change the light's attitude.

**Switch:** Circle remains the fallback. Select Width when sustained stereo spread or a clear widening movement departs from recent geometry; return to Circle as it narrows. Use relative change plus a minimum meaningful spread. Mono input stays on Circle for this recipe because width evidence is unavailable.

**Cadence / knobs:** passage routing; widening threshold and return softness.

**What to listen for:** the light opens with audible spatial expansion without interpreting stereo noise as a musical instruction. Compare geometry changes at equal audio energy.

## 7. Strike and reply — Snap → Air → Space

**Intent:** let an initial strike and a separate high-frequency response have different articulations.

**Switch:** Snap marks the first strong attack. If a distinct high-band event follows after it, route that reply through Air. Space handles the gaps and isolated remaining events. If no reply occurs, return directly to Space. The same broadband strike lighting up high-band filters is not automatically a second event.

**Cadence / knobs:** gesture routing; reply sensitivity and maximum reply interval.

**What to listen for:** the sequence resembles musical call-and-response because the input contains separate events, not because the controller schedules a decorative second flash. Log missed/false replies.

## 8. Smooth to abrasive — Sustain ↔ Grain

**Intent:** follow changes in the character of a continuing sound even if loudness stays similar.

**Switch:** Sustain follows a comparatively stable midrange body. Move to Grain when normalized traversal, broad spectral distribution and texture variation increase persistently. Return to Sustain when the body steadies. A single high pure tone or transient should not be labeled “rough” from traversal speed alone.

**Cadence / knobs:** passage routing; texture contrast and settling time.

**What to listen for:** a held sound becoming busier changes light character without merely becoming brighter. Use equal-level clean/rough examples to check the added measurement.

## 9. Low-end reveal — Space ↔ Weight

**Intent:** the arrival of low-frequency body changes the whole presence of the light without requiring a sharp flash.

**Switch:** Space handles sparse or thin passages. When absolute low-band energy arrives and persists relative to prior context, Weight takes over. When that body withdraws and gaps return, select Space. A soft sustained bass entrance can qualify; an isolated kick should not force a long Weight section.

**Cadence / knobs:** passage routing; body threshold and persistence.

**What to listen for:** rounded arrivals feel substantial while thin sections keep contrast. This directly tests whether some arrivals suit Weight better than the original recipe's Snap.

## 10. Attack, body, rest — Snap → Sustain → Space

**Intent:** articulate the beginning, audible continuation and end of a musical gesture differently.

**Switch:** Snap handles its strong onset. If continuous midrange body remains after that onset, select Sustain for the continuing sound. As that body falls away and gaps appear, return to Space. A new attack can interrupt the tail and re-enter Snap immediately. Skip Sustain when there is no audible body.

**Cadence / knobs:** gesture routing; body continuity requirement and tail release.

**What to listen for:** a sharp beginning followed by a natural hold, without the controller inventing an afterglow once input has stopped.

## Comparison design

The first implementation need not contain a general selector over all eleven recipes. Make the recipes manually selectable while each one routes its own limited mode set. This lets the user compare musical policies rather than tune an opaque mixture of everything.

Start with recipe 0 plus **1, 4 and 5**: they test fine attack/body articulation, larger build/drop structure and rhythmic recovery respectively. Then test texture/continuity and stereo-led recipes on passages that contain those cues. These priorities are design recommendations, not measured winners.

Use the original spec's best-fixed-style, loudness-only, shared-gain-envelope and manual-route comparisons. Record preferred recipe, exact settings, source position, detected transitions and false entries. Preserve rejected options and avoid fitting thresholds on final evaluation tracks. Only after preferences repeat on unfamiliar material should a learned controller select recipes or their parameters.
