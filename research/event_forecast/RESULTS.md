# Event predictor v1 — rejected for live promotion

Fresh causal 5.1-second TCN; outputs a 100 ms future acoustic-attack probability.
Training/validation used Ultra; other inputs were held out from model selection.
Same source CSVs as the scope foundation; no RPMC-L2.

| Source | Learned event F1 | Rhythm repetition F1 | Learned false accents/min |
|---|---:|---:|---:|
| Later Ultra validation | .513 | .497 | 216 |
| Forest | .577 | .515 | 180 |
| Calabria | .500 | .593 | 237 |
| Damn Right | .418 | .459 | 228 |
| McDonalds | .437 | .624 | 242 |

Threshold .25 chosen on validation F1. Event matching is one-to-one within
±40 ms. These labels are heuristic acoustic rises, not musical accent ground
truth. The relatively dense target events also allow chance matches; the
17-second wrong-history comparator exceeds the learned F1 on all three demo
songs. On those songs AP is near or below positive prevalence. The model does
not establish reliable synchronized anticipation beyond the source domain.

Changing future input leaves all earlier outputs exactly unchanged (max error
0). Causality passes, musical prediction does not. Keep this model out of the
live render path. Do not reinterpret higher recall as a better show.

Files: /Volumes/ExtremePro/Code/lightflow/research/event_forecast/run_2026-09-16_v1/
Code: train.py and EXPERIMENT.md. Two initial import attempts failed on conflicting
OpenMP runtimes before any run directory was created. Final extraction uses NumPy
only, without bypassing the OpenMP safety check. No external files were removed.

Next modeling direction: more diverse training sources, better spectral/onset
features and explicit rhythmic state, then precision-constrained validation and
fresh artist/show evaluation. The cue policy still needs reviewed lighting
sequences; predicting acoustic events cannot substitute for that supervision.
