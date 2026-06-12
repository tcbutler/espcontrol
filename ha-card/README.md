# EspControl Panel Card (Home Assistant)

A WYSIWYG tile editor for CYD (no-PSRAM) EspControl panels. The CYD can't
reliably serve EspControl's on-device web config UI, so the panel instead
exposes its card config as Home Assistant `text.*` entities, and this Lovelace
card edits them over HA's native API. The device's web server is never used.

## Install

1. Copy `espcontrol-panel-card.js` to your HA `config/www/` folder
   (via the File Editor add-on, Samba, or SSH). Raw file:
   https://raw.githubusercontent.com/tcbutler/espcontrol/cyd-support/ha-card/espcontrol-panel-card.js
2. **Settings → Dashboards → ⋮ (top right) → Resources → Add Resource**
   - URL: `/local/espcontrol-panel-card.js`
   - Type: **JavaScript Module**
3. Edit a dashboard → **Add Card → Manual**, and enter:
   ```yaml
   type: custom:espcontrol-panel-card
   ```
   (Optional: add `device_prefix: text.espcontrol_cyd` to pin one panel.)

## Use

For each slot, pick a card type and (where relevant) an entity, then
**Save to panel**. The panel re-renders. If a change doesn't appear within a
few seconds, restart the panel from its device page in HA.

## Requires

Panel firmware with the config entities exposed to HA — i.e. the
`sunton-esp32-2432s028r` build on the `cyd-support` branch.
