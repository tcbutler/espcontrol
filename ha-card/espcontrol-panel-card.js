/* =============================================================================
 * EspControl Panel Card — a WYSIWYG editor for CYD (no-PSRAM) panels.
 * =============================================================================
 * The CYD can't reliably serve EspControl's on-device web config UI (its
 * ~47KB heap crashes the httpd under load). Instead, the panel exposes its
 * card config as Home Assistant `text.*` entities, and this Lovelace card
 * edits them over HA's rock-solid native API. Pick a card type and an entity
 * per slot, hit Save, and the panel re-renders — the device web server is
 * never involved.
 *
 * Install:
 *   1. Copy this file to <config>/www/espcontrol-panel-card.js
 *   2. Settings → Dashboards → ⋮ → Resources → Add
 *        URL: /local/espcontrol-panel-card.js   Type: JavaScript Module
 *   3. Add to a dashboard:  type: custom:espcontrol-panel-card
 *      (optionally set  device_prefix: text.espcontrol_cyd  to pin one panel)
 * =============================================================================
 */

// Card types and their encodings, mirrored from common/config/card_contract.json.
// Field order: entity;label;icon;icon_on;sensor;unit;type;precision;options
const CARD_TYPES = [
  { key: "none",             label: "— empty —",        domains: [],                          default: "" },
  { key: "switch",           label: "Switch / Toggle",  domains: ["light","switch","input_boolean","fan"], default: ";;Auto;Auto;;;;;" },
  { key: "light_brightness", label: "Light (dimmer)",   domains: ["light"],                   default: ";;Lightbulb Outline;Lightbulb;;;light_brightness;;" },
  { key: "light_switch",     label: "Light (on/off)",   domains: ["light"],                   default: ";;Lightbulb Outline;Lightbulb;;;light_switch;;" },
  { key: "light_temperature",label: "Light (colour temp)", domains: ["light"],                default: ";;Lightbulb;Auto;;2000-6500;light_temperature;;" },
  { key: "sensor",           label: "Sensor (read-only)", domains: ["sensor","binary_sensor"], default: ";;Auto;Auto;;;sensor;;" },
  { key: "climate",          label: "Climate / Thermostat", domains: ["climate"],             default: ";Climate;Thermostat;Auto;;;climate;;" },
  { key: "media",            label: "Media player",     domains: ["media_player"],            default: ";;Auto;Auto;play_pause;;media;;" },
  { key: "cover",            label: "Cover / Blind",    domains: ["cover"],                   default: ";;Blinds;Blinds Open;;;cover;;" },
  { key: "garage",           label: "Garage door",      domains: ["cover"],                   default: ";;Garage;Garage Open;;;garage;;" },
  { key: "lock",             label: "Lock",             domains: ["lock"],                    default: ";;Lock;Lock Open;;;lock;;" },
  { key: "action",           label: "Scene / Script / Action", domains: ["scene","script","automation","button","input_button","vacuum"], default: ";;Flash;Auto;scene.turn_on;;action;;" },
  { key: "fan_switch",       label: "Fan (on/off)",     domains: ["fan"],                     default: ";;Fan Off;Fan;;;fan_switch;;" },
  { key: "fan_speed",        label: "Fan (speed)",      domains: ["fan"],                     default: ";;Fan Speed 2;Auto;;;fan_speed;;" },
  { key: "cover_presence",   label: "Presence / Motion", domains: ["binary_sensor","sensor"], default: ";;Motion Sensor Off;Motion Sensor;;;presence;;active_color" },
  { key: "door_window",      label: "Door / Window",    domains: ["binary_sensor","sensor"],  default: ";;Door;Door Open;;;door_window;door;active_color" },
  { key: "weather",          label: "Weather (now)",    domains: ["weather"],                 default: ";;Auto;Auto;;;weather;;" },
  { key: "weather_forecast", label: "Weather (tomorrow)", domains: ["weather"],               default: ";;Auto;Auto;;;weather;tomorrow;" },
  { key: "clock",            label: "Clock",            domains: [],                          default: ";;Auto;Auto;;;clock;;" },
  { key: "calendar",         label: "Date",             domains: [],                          default: "sensor.date;;Auto;Auto;;;calendar;;" },
];

const FIELDS = ["entity","label","icon","icon_on","sensor","unit","type","precision","options"];

// Decode a stored config string back into {typeKey, entity, label}.
function decodeConfig(value) {
  if (!value) return { typeKey: "none", entity: "", label: "" };
  const parts = value.split(";");
  const entity = parts[0] || "";
  const label = parts[1] || "";
  const type = parts[6] || "";
  // Match on type code first; a switch/toggle has an empty type with an entity.
  let typeKey = "none";
  if (type) {
    const byType = CARD_TYPES.find((c) => c.default.split(";")[6] === type);
    typeKey = byType ? byType.key : "none";
  } else if (entity) {
    typeKey = "switch";
  }
  return { typeKey, entity, label };
}

// Build a config string from a slot's choices.
function encodeConfig(typeKey, entity, label) {
  const type = CARD_TYPES.find((c) => c.key === typeKey);
  if (!type || type.key === "none") return "";
  const parts = type.default.split(";");
  while (parts.length < FIELDS.length) parts.push("");
  if (entity) parts[0] = entity;
  if (label) parts[1] = label;
  return parts.join(";");
}

class EspControlPanelCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
  }

  getCardSize() { return 6; }

  // Find the panel's config entities. Either pinned via device_prefix, or
  // auto-discovered from any text.*_button_N_config entities.
  _discover() {
    const states = this._hass.states;
    let prefix = this._config.device_prefix;
    const slotRe = /^(text\..+)_button_(\d+)_config$/;
    if (!prefix) {
      for (const id of Object.keys(states)) {
        const m = id.match(slotRe);
        if (m) { prefix = m[1]; break; }
      }
    }
    if (!prefix) return null;
    const slots = [];
    for (const id of Object.keys(states)) {
      const m = id.match(slotRe);
      if (m && `${m[1]}` === `${prefix}`) slots.push(parseInt(m[2], 10));
    }
    slots.sort((a, b) => a - b);
    const orderId = `${prefix}_button_order`;
    return { prefix, slots, orderId, hasOrder: orderId in states };
  }

  _build() {
    const info = this._discover();
    const root = this;
    root.innerHTML = "";

    const card = document.createElement("ha-card");
    card.header = this._config.title || "EspControl Panel Setup";
    const body = document.createElement("div");
    body.style.padding = "0 16px 16px";

    if (!info) {
      body.innerHTML =
        `<p>No EspControl panel found. Make sure the device's config text
         entities are exposed to Home Assistant (e.g. <code>text.&lt;device&gt;_button_1_config</code>).</p>`;
      card.appendChild(body);
      root.appendChild(card);
      return;
    }
    this._info = info;
    this._built = true;

    const note = document.createElement("p");
    note.style.cssText = "color:var(--secondary-text-color);font-size:0.9em;margin:4px 0 12px";
    note.textContent = `Panel: ${info.prefix} — ${info.slots.length} slots. Pick what each tile shows, then Save.`;
    body.appendChild(note);

    // Entities sorted once for the pickers.
    this._entityList = Object.keys(this._hass.states).sort();

    this._rows = [];
    for (const n of info.slots) {
      const current = decodeConfig(this._hass.states[`${info.prefix}_button_${n}_config`]?.state || "");
      body.appendChild(this._buildRow(n, current));
    }

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:12px";
    const saveBtn = document.createElement("mwc-button");
    saveBtn.raised = true;
    saveBtn.label = "Save to panel";
    saveBtn.addEventListener("click", () => this._save());
    const status = document.createElement("span");
    status.style.cssText = "color:var(--secondary-text-color);font-size:0.9em";
    this._status = status;
    actions.appendChild(saveBtn);
    actions.appendChild(status);
    body.appendChild(actions);

    card.appendChild(body);
    root.appendChild(card);
  }

  _buildRow(n, current) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:48px 1fr 1fr;gap:8px;align-items:center;margin-bottom:8px";

    const tag = document.createElement("div");
    tag.textContent = `Slot ${n}`;
    tag.style.cssText = "font-weight:600;color:var(--primary-text-color)";
    row.appendChild(tag);

    // Card-type select
    const typeSel = document.createElement("select");
    typeSel.style.cssText = "padding:6px;border-radius:6px";
    for (const t of CARD_TYPES) {
      const o = document.createElement("option");
      o.value = t.key; o.textContent = t.label;
      if (t.key === current.typeKey) o.selected = true;
      typeSel.appendChild(o);
    }
    row.appendChild(typeSel);

    // Entity select (filtered by the chosen type's domains)
    const entSel = document.createElement("select");
    entSel.style.cssText = "padding:6px;border-radius:6px";
    row.appendChild(entSel);

    // Label input (optional)
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Label (optional)";
    labelInput.value = current.label || "";
    labelInput.style.cssText = "padding:6px;border-radius:6px;grid-column:2 / span 2;display:none";

    const populateEntities = () => {
      const t = CARD_TYPES.find((c) => c.key === typeSel.value);
      entSel.innerHTML = "";
      if (!t || t.domains.length === 0) {
        entSel.style.display = "none";
        labelInput.style.display = "block";
        return;
      }
      entSel.style.display = "block";
      labelInput.style.display = "none";
      const blank = document.createElement("option");
      blank.value = ""; blank.textContent = "— choose entity —";
      entSel.appendChild(blank);
      for (const id of this._entityList) {
        if (!t.domains.includes(id.split(".")[0])) continue;
        const o = document.createElement("option");
        const name = this._hass.states[id].attributes.friendly_name || id;
        o.value = id; o.textContent = `${name} (${id})`;
        if (id === current.entity) o.selected = true;
        entSel.appendChild(o);
      }
    };
    typeSel.addEventListener("change", populateEntities);
    populateEntities();

    row.appendChild(labelInput);
    this._rows.push({ n, typeSel, entSel, labelInput });
    return row;
  }

  async _save() {
    const info = this._info;
    this._status.textContent = "Saving…";
    const order = [];
    try {
      for (const r of this._rows) {
        const entity = r.entSel.style.display !== "none" ? r.entSel.value : "";
        const value = encodeConfig(r.typeSel.value, entity, r.labelInput.value.trim());
        await this._hass.callService("text", "set_value", {
          entity_id: `${info.prefix}_button_${r.n}_config`,
          value,
        });
        if (value) order.push(r.n);
      }
      if (info.hasOrder) {
        // Writing the order last triggers the device's grid rebuild.
        await this._hass.callService("text", "set_value", {
          entity_id: info.orderId,
          value: order.join(","),
        });
      }
      this._status.textContent = `Saved ${order.length} tile(s). Panel updating…`;
    } catch (e) {
      this._status.textContent = `Error: ${e.message || e}`;
    }
  }
}

customElements.define("espcontrol-panel-card", EspControlPanelCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "espcontrol-panel-card",
  name: "EspControl Panel Card",
  description: "WYSIWYG tile editor for EspControl CYD panels (configures via HA, no device web server).",
});
console.info("%c EspControl Panel Card loaded", "color:#f5c518;font-weight:bold");
