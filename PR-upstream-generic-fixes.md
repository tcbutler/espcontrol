# PR draft — branch `upstream-generic-fixes` → jtenniswood/espcontrol `main`

> Status: NOT submitted. Branch exists locally only (4 commits on top of upstream/main
> c47ddfd2). To submit: push the branch to the tcbutler/espcontrol fork and open the PR
> with the title/body below. This file is untracked — do not commit it.

**Title:** Fix generator drift and stale web bundles; add two opt-in low-flash build hooks

---

While porting EspControl to a 4 MB no-PSRAM board in my fork, I hit four things that are
device-independent, so I'm offering them upstream separately from any device work. One
commit per item, no device or manifest entries included. Happy to split this into
separate PRs if you'd prefer.

## 1. Fix `generate_device_slots.py` drift (bugfix)

On a pristine checkout of current `main`, `python3 scripts/generate_device_slots.py
--check` (part of `npm run check:fast`) fails for all five devices:

```
Generated YAML is stale: devices/guition-esp32-p4-jc1060p470/packages.yaml
Generated YAML is stale: devices/guition-esp32-p4-jc4880p443/packages.yaml
Generated YAML is stale: devices/guition-esp32-p4-jc8012p4a1/packages.yaml
Generated YAML is stale: devices/esp32-p4-86/packages.yaml
Generated YAML is stale: devices/guition-esp32-s3-4848s040/packages.yaml
```

The committed `packages.yaml` files all carry the four `screen_saver_clock_*` /
`screen_schedule_clock_*` brightness substitutions required by
`common/config/display.yaml` and `common/addon/backlight.yaml`, but the generator never
emitted them. This commit makes the generator emit exactly those lines. The committed
device YAML is unchanged — the check simply passes again.

## 2. Regenerate web bundles stale since #362 (bugfix)

#362 fixed UTF-8 handling in `src/webserver/model/card.ts` and `subpage.ts`, but the
committed artifacts built from them were not regenerated: `src/webserver/modules/
model_generated.js` — and every `docs/public/webserver/*/www.js` bundle that inlines
it — still ships the old byte-blind `decodeConfigField` / `splitSubpageConfigChunks`.
Since factory images embed the committed `www.js` (`js_include` in `builds/
*.factory.yaml`) and OTA builds load it from jsDelivr at a pinned commit of this repo
(`common/device/core_infra.yaml`), devices currently serve a web UI **without** the
#362 fix.

This is also why `python3 scripts/build.py --check` (`check:generated`, part of
`check:fast`) fails on pristine `main`. It only reports `model_generated.js` — the
`www.js` staleness is masked in check mode because the bundles are rebuilt from the
stale module on disk, and surfaces once the model is regenerated.

Regenerated with `python3 scripts/build.py model www` using the lockfile-pinned esbuild
(0.28.0). No hand edits to generated files.

## 3. Add a `NONE` artwork format (opt-in, no behavior change by default)

`artwork_image` gains a `NONE` format that registers no decoders, keeping libjpeg-turbo
and pngle out of the binary entirely. It's for low-flash devices that keep their
`artwork_image` instances for API parity but can't afford the decoders — downloads on
such a device fail gracefully through the already-existing unsupported-format runtime
path.

To make it selectable per device, `common/device/screen_cover_art.yaml` now takes the
format from a new `cover_art_image_format` substitution, emitted by
`generate_device_slots.py` with a `"AUTO"` default (same `setdefault` pattern as
`cover_art_live_image_updates`). All five existing devices get `cover_art_image_format:
"AUTO"` in their `packages.yaml`, which resolves to the same `format: AUTO` config as
before — existing builds are unchanged.

Validated with ESPHome 2026.5.3: `esphome config` on guition-esp32-s3-4848s040 passes
with both the default (`AUTO`) and `-s cover_art_image_format NONE`.

## 4. Add `ESPCONTROL_I18N_ENGLISH_ONLY` (opt-in, no behavior change by default)

The 18 generated language tables in `components/espcontrol/i18n_generated.h` cost
~140 KB of flash. Defining `ESPCONTROL_I18N_ENGLISH_ONLY` (e.g. via a build flag)
compiles them out, and `espcontrol_i18n()` simply returns the English source string.
The guard is `#ifndef`, so builds that don't define it are unaffected.

`scripts/build.py` emits the guards and the committed header is regenerated with
`python3 scripts/build.py i18n` (so `check:generated` stays green). Both guard paths
were syntax-checked standalone (`c++ -std=c++17 -fsyntax-only`, with and without the
define).

## Verification

On this branch:

- `npm run check:fast` → exit 0 (on pristine `main` it fails at the device-slots check
  and `check:generated`)
- `python3 scripts/generate_device_slots.py --check` → "Device YAML is up to date."
- `python3 scripts/build.py --check` → "All outputs are up to date."
- `esphome config` (ESPHome 2026.5.3) on guition-esp32-s3-4848s040: valid with
  `cover_art_image_format` set to `AUTO` and to `NONE`
- i18n header compiles with and without `ESPCONTROL_I18N_ENGLISH_ONLY`

As an end-to-end proof of the two opt-in hooks: combined with a device definition kept
in my fork, they let a 4 MB no-PSRAM ESP32-2432S028R ("Cheap Yellow Display") build
fit its 1.75 MB OTA app partition. None of that device is included here.
