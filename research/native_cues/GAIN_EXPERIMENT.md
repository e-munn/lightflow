# Fixed-weight gain audit and train-only augmentation

The preceding goal turn made progress: native dataset, trained model, reload
verification and playable comparison are complete. Forest transfer still fails.
This experiment addresses one plausible recording nuisance without changing
targets, splits, horizon definitions, model width or the live scope response.

With forecast_v1 weights and targets fixed, test constant amplitude gains
0.25, 0.5, 1, 2 and 4. This is a sensitivity diagnostic, not a search for a
gain to apply to Forest. Analytically transform RMS and linear band powers,
recompute nonlinear amplitude, attacks and band novelty, then recompute causal
context and rhythm. Shape ratios are invariant except for the explicit silence
gate. No waveform clipping is introduced or simulated. CSV rounding remains.
Check the transform against waveform extraction before fitting augmented data.

The audit found Forest mean four-head Brier .3109/.3208/.3323/.3436/.3532 across
these gains. All remain worse than the original loudness control (.2639).
Thus recording level affects the model, but this audit does not establish it as
the complete cause or explain differences in human lighting choices.

Before the new fit: add the four non-unit gain variants ONLY to the eight
training clips. Labels and masks stay identical. Standardization uses only
these training inputs. Priors repeat identical labels equally and are unchanged.
Train fresh weights for 50 epochs; choose epoch only by original Levity
validation. Fit the same three logistic controls with augmented training data.
All reported per-clip and pooled evaluation uses the original fourteen clips,
not augmented copies. Training has five times the batches per epoch, so this is
not a matched-optimization-budget causal attribution experiment.

Compare all original controls and the 17-second wrong-history diagnostic. Also
rerun the fixed-weight gain audit on the new model to measure whether sensitivity
actually decreases. Do not change the gain of development music to improve its
score. No cue policy or live promotion follows automatically from training.
