**Lightflow: iPhone music-to-light competition**

Research date: September 18, 2026. Storefront: United States.

**Finding: the basic product already exists, and context-sensitive musical lighting is already a competitive category.** SonicHue Sync, iLightShow, and Light DJ deserve direct comparison before we package Lightflow for TestFlight. The opportunity is to demonstrate better musical judgment, not merely add Spotify, frequency bands, adjustable envelopes, or automatic mode changes.

This is documentary research, not a hands-on review. App Store listings and developer documentation establish what vendors advertise and support; they do not establish actual timing, detection accuracy, or artistic quality. No competitor was installed, purchased, or auditioned during this research.

I examined ten relevant product families, with the two main Light DJ editions counted together. This is a targeted comparison, not an exhaustive census. Current version, release date, upfront price, minimum OS, and US rating counts were retrieved directly from Apple's public Lookup API and saved in [the metadata snapshot](app_store_snapshot_2026-09-18.json). Some indexed App Store pages lag that metadata. In-app prices below come from the US listings and may include legacy offers; confirm the applicable tier in the app.

**Closest products**

| Product | Documented music input | Relevant overlap | Listed US pricing |
| --- | --- | --- | --- |
| [SonicHue Sync](https://apps.apple.com/us/app/sonichue-sync/id6759938225) | Microphone; additional MIDI performance tools | Automatic section-dependent effects and shaped brightness; extensive response controls | Free download; Pro lists $3.99/month or $19.99/year; separate Live tier |
| [iLightShow](https://apps.apple.com/us/app/ilightshow-for-philips-hue/id1247273887) | Spotify Premium, Apple Music, microphone | Advanced effects for energy, percussion, and drops; different capabilities by input | Free download; FX+ lists $4.99/month or $29.99/year |
| [Light DJ](https://apps.apple.com/us/app/light-dj-entertainment-effects/id1026353238) | Microphone for music visualization/automatic tempo | Automatic musical response plus extensive performance effects | $7.99/month, $39.99/year, or $119.99 permanent upgrade; [Pro edition](https://apps.apple.com/us/app/light-dj-pro-for-smart-lights/id963524356) also $119.99 |
| [Philips Hue](https://apps.apple.com/us/app/philips-hue/id1055281310) | Official Spotify account integration | Built-in music synchronization; essential convenience benchmark | Free app; compatible Hue hardware required |

**SonicHue is the closest documented match to our current direction.** Its release history describes automatic recognition of quieter sections, builds, peaks, drops, and breakdowns, with section-specific brightness behavior and transitions aligned to beats. That overlaps directly with our proposed restrained texture before a build and sharper response at the arrival. Its March 25 release notes explicitly removed Spotify integration because of API restrictions. Do not describe it as a currently verified Spotify-account integration. These are vendor claims; their musical reliability remains untested. [App Store description and release history](https://apps.apple.com/us/app/sonichue-sync/id6759938225).

Its guide documents waveform, rate, spread, and decay controls; beat-based sequences; minimum/maximum brightness; sensitivity; and a latency offset. Those are useful references for our response-shaping work. They also mean adjustable envelopes alone are not a differentiator. [SonicHue user guide](https://www.sonichue.app/how-to-use).

**iLightShow has a particularly important split between known tracks and live input.** Its Spotify documentation supports Premium accounts through Spotify Connect, including playback on another device using the same account. It excludes long mixes, podcasts, and imported local tracks. That matters for our hour-long live-show material. [Spotify documentation](https://ilightshow.net/music/spotify/).

FX+ advertises reactions to percussion, mood, energy, and drops. Its separate microphone documentation, updated March 17, 2026, explicitly limits microphone input to standard effects. A microphone used to calibrate synchronization with a streaming service is different from selecting microphone as the music source. We must test those modes separately. [Effect modes](https://ilightshow.net/effects/effect-modes/), [microphone input](https://ilightshow.net/music/microphone/), [calibration and controls](https://ilightshow.net/effects/generic-options/).

**Light DJ is another direct musical competitor.** The developer describes stronger activity in intense passages and more flowing behavior in softer passages. It also offers more than 100 configurable effects. Its separate Studio product lets people author and replay lighting performances against songs. That is an interesting precedent for collecting our own explicit timing/brightness demonstrations; it does not establish permission to use other people's recordings as training data. [Developer overview](https://lightdjapp.com/).

Light DJ's support documentation warns that microphone use can affect some external playback routes. The actual iPhone, speaker, and route combination needs testing before promising simultaneous playback and listening. [Developer support](https://lightdjapp.com/support).

**Official Hue already answers the original Spotify question.** Hue's integration accepts free or paid Spotify accounts and requires a Bridge and color-capable lights. It works with headphones as well as speakers. It is the first benchmark for someone whose entire need is Spotify-driven Hue lights. It does not by itself establish an arbitrary live-input solution. [Hue + Spotify](https://www.philips-hue.com/en-us/explore-hue/works-with/spotify).

**Other relevant App Store products**

| Product | Documented capability | Relevance to Lightflow | Price / qualification |
| --- | --- | --- | --- |
| [Soundstorm for Hue](https://apps.apple.com/us/app/soundstorm-for-hue/id1230217709) | Bass/mid/treble triggers, selectable lights, pulse and fade behavior, brightness limits | Direct baseline for frequency bands plus envelopes | $2.99; [developer controls](https://scottdodson.dev/hue/soundstorm/) |
| [iConnectHue](https://apps.apple.com/us/app/iconnecthue-for-philips-hue/id639343132) | Discotainment uses microphone, beat detection/prediction, and volume-driven lightness | Especially relevant to our electronic-music material | $3.99 base plus upgrades/membership; [feature documentation](https://iconnecthue.com/features/) specifies strongest beat prediction for regular electronic/pop music |
| [hueDynamic](https://apps.apple.com/us/app/huedynamic-for-philips-hue/id1405195207) | Sound-to-light disco, adjustable intensity/strobe/color, broad Hue controls | Useful general-purpose competitor; no musical superiority established | Free download with purchases |
| [Hue Essentials](https://apps.apple.com/us/app/hue-essentials/id1462943921) | Dance Sensation and Hue Entertainment effects | Another established music-effects option | Free download with purchases; precise iOS music-input route not established in this review |
| [Hue Disco](https://apps.apple.com/us/app/hue-disco/id581258186) | Classic microphone-driven lighting effects | Older basic sound-to-light baseline | $4.99; Apple's latest release metadata is February 2021; current hardware behavior untested |
| [HomeDisco 2](https://apps.apple.com/us/app/homedisco-2-ai-light-sync/id6538716037) | Advertises AI beat sync and prompted scenes for HomeKit lights | Even AI positioning is already present | Free download with purchases; requires iOS 26; no published model evaluation found in reviewed material |

Absence of a documented feature is not proof that a competitor lacks it. Likewise, a listing that says “AI” does not establish a trained music-to-light model or human-level direction.

**Maintenance and market evidence**

The live Apple metadata gives SonicHue version 1.2.9, updated September 15, 2026; iLightShow 3.2.4, August 20; Light DJ 12.0.4, September 9; and iConnectHue 5.17.3, September 17. These are active products, not just abandoned listings. SonicHue has only six US ratings versus iLightShow's 7,180. Rating volume indicates different amounts of public feedback, not comparative artistic quality. Hue's 114,551 ratings cover its entire smart-home app, not specifically music sync. Exact metadata and source URL are in [the saved Apple snapshot](app_store_snapshot_2026-09-18.json).

Outside the iPhone shortlist, [Conductør](https://conductor.lighting/) advertises a desktop/local audio engine with separate frequency bands and an AI director adjusting lighting parameters periodically. Its disclosed split between fast reactive processing and slower direction resembles a plausible architecture for Lightflow. This is an adjacent early-access product, not a verified iOS App Store entry, and its latency/quality claims have not been measured here.

**What this changes for our project**

The defensible hypothesis is narrower: *Lightflow can make one brightness channel preserve fine musical texture while making better choices about accent, hold, space, build, and release on unfamiliar live input, with little setup.* This is our proposed evaluation target, not an established advantage.

Our scope foundation remains useful as a detailed reference signal. Training a model to reproduce that signal alone would not demonstrate an improvement over these products. We need evidence that context changes the output beneficially: sustained sounds should sustain, rests should retain space, a build should develop, and an arrival should have earned contrast. More presets cannot establish that.

We should also separate sound access from artistic intelligence. Account-linked playback, microphone listening, and MIDI triggering are distinct inputs. A competitor working with Spotify does not demonstrate that a new app can read Spotify's raw audio or obtain the same analysis access. Spotify removed several analysis endpoints for new integrations in 2024, while leaving specified existing integrations unaffected at that time. [Spotify API change announcement](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api). Before implementing an account-linked route, check current platform access and terms for that exact use.

**Recommended comparison before TestFlight packaging**

1. Audition SonicHue first, iLightShow second, and Light DJ third, with official Hue as the built-in reference. This order reflects documented overlap, not a measured ranking.
2. Use the same Hue hardware and room. First compare a single light with a fixed color where supported, keeping brightness ranges reasonably comparable. Then allow each product its normal multi-light presentation in a separate round. Mark any setting an app cannot match.
3. Use our preferred electronic excerpt plus unfamiliar material: quiet texture, sustained bass, isolated percussion, vocal/acoustic passages, half-time or irregular rhythm, a build/drop, and silence with room noise. Keep the repeatedly tuned excerpt labeled development material.
4. Run two comparisons: microphone against microphone, then each product's best supported input. Include iLightShow standard mode in the former and FX+ in the latter. Otherwise we may confuse better input access with better live analysis.
5. Record timing and listener preference separately. Judge accent placement, held texture, preserved rests, section contrast, false flashes, and unwanted flicker. Capture audio and actual light output together when measuring delay; software frame time is not input-to-light latency.
6. Randomize playback order and allow “tie” or “different strengths.” Repeat across excerpts before choosing a winner. Record failures and the settings used rather than selecting only impressive clips.

If an existing app already achieves the desired experience, use it as the reference and reconsider how much custom product is needed. If Lightflow wins consistently on a specific musical property, make that the purpose of the first TestFlight build. This research supplies the shortlist and comparison design; hardware trials and any claim of superiority remain outstanding.
