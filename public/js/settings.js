// ============================================================
// MJPT — Settings Page
// Uses bottom sheet UI instead of prompt() dialogs.
// ============================================================

import { db } from "/js/firebase.js";
import {
  doc, getDoc, setDoc, getDocs, collection
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import { $, showToast, BRISTOL, STOOL_COLORS, VOLUMES } from "/js/utils.js";


// ── DEFAULTS ──
const DEFAULTS = {
  mike: {
    name:     "Ryan",
    reminder: { time: "20:00", frequency: "daily", days: [] },
    preset:   { bristolType: 4, color: "brown", symptoms: ["none"] }
  },
  jenna: {
    name:     "Cia",
    reminder: { time: "20:00", frequency: "daily", days: [] },
    preset:   { bristolType: 4, color: "brown", symptoms: ["none"] }
  }
};

let settings       = structuredClone(DEFAULTS);
let activeSheet    = null; // "mike" | "jenna"


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  renderSettings();
  bindActions();
});


// ── LOAD ──
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "config", "settings"));
    if (snap.exists()) {
      const data = snap.data();
      settings.mike  = { ...DEFAULTS.mike,  ...data.mike  };
      settings.jenna = { ...DEFAULTS.jenna, ...data.jenna };
    }

    // Telegram link status from users collection
    const mikeSnap  = await getDoc(doc(db, "users", "mike"));
    const jennaSnap = await getDoc(doc(db, "users", "jenna"));

    if (mikeSnap.exists()) {
      settings.mike.telegramLinked   = true;
      settings.mike.telegramUsername = mikeSnap.data().telegramUsername || null;
    }
    if (jennaSnap.exists()) {
      settings.jenna.telegramLinked   = true;
      settings.jenna.telegramUsername = jennaSnap.data().telegramUsername || null;
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}


// ── RENDER ──
function renderSettings() {
  // Names
  el("mikeNameDisplay").textContent  = settings.mike?.name  || "Ryan";
  el("jennaNameDisplay").textContent = settings.jenna?.name || "Cia";

  // Reminders
  el("mikeReminderDisplay").textContent  = formatReminder(settings.mike?.reminder,  "Melbourne");
  el("jennaReminderDisplay").textContent = formatReminder(settings.jenna?.reminder, "WITA");

  // Presets
  if (settings.mike?.preset)  el("mikePresetDisplay").textContent  = formatPreset(settings.mike.preset);
  if (settings.jenna?.preset) el("jennaPresetDisplay").textContent = formatPreset(settings.jenna.preset);

  // Telegram
  const mikeLinked  = settings.mike?.telegramLinked;
  const jennaLinked = settings.jenna?.telegramLinked;

  el("mikeTelegramDisplay").textContent  = mikeLinked  ? `@${settings.mike.telegramUsername  || "linked"}` : "Not linked — use /start in bot";
  el("jennaTelegramDisplay").textContent = jennaLinked ? `@${settings.jenna.telegramUsername || "linked"}` : "Not linked — use /start in bot";

  const mikeStatus  = document.getElementById("mikeTelegramStatus");
  const jennaStatus = document.getElementById("jennaTelegramStatus");
  if (mikeStatus)  { mikeStatus.textContent  = mikeLinked  ? "Linked" : "—"; mikeStatus.style.color  = mikeLinked  ? "var(--color-good)" : "var(--color-ink-faint)"; }
  if (jennaStatus) { jennaStatus.textContent = jennaLinked ? "Linked" : "—"; jennaStatus.style.color = jennaLinked ? "var(--color-good)" : "var(--color-ink-faint)"; }
}

function el(id) {
  return document.getElementById(id) || { textContent: "" };
}

function formatReminder(r, tz) {
  if (!r) return `Daily · 8:00 PM · ${tz}`;
  const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hour     = parseInt((r.time || "20:00").split(":")[0]);
  const ampm     = hour >= 12 ? "PM" : "AM";
  const h12      = hour % 12 || 12;
  const timeStr  = `${h12}:00 ${ampm}`;
  if (r.frequency === "custom" && r.days?.length) {
    return `${r.days.map(d => dayNames[d]).join("/")} · ${timeStr} · ${tz}`;
  }
  if (r.frequency === "weekly") return `Weekly (Mon) · ${timeStr} · ${tz}`;
  return `Daily · ${timeStr} · ${tz}`;
}

function formatPreset(preset) {
  const b        = BRISTOL[preset.bristolType];
  const bristol  = b?.label || `Type ${preset.bristolType}`;
  const color    = STOOL_COLORS[preset.color]?.label || "Brown";
  const volume   = VOLUMES[preset.volume]?.label || "Normal";
  return `${bristol} · ${volume} · ${color}`;
}


// ── BIND ACTIONS ──
function bindActions() {
  safe("editMikeName",     () => editName("mike"));
  safe("editJennaName",    () => editName("jenna"));
  safe("editMikeReminder", () => openReminderSheet("mike"));
  safe("editJennaReminder",() => openReminderSheet("jenna"));
  safe("editMikePreset",   () => openPresetSheet("mike"));
  safe("editJennaPreset",  () => openPresetSheet("jenna"));
}

function safe(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", fn);
}


// ── EDIT NAME ──
async function editName(user) {
  const current = settings[user]?.name || (user === "mike" ? "Ryan" : "Cia");
  const name    = prompt(`Enter display name for ${current}:`, current);
  if (!name || name.trim() === current) return;
  settings[user].name = name.trim();
  await saveSettings();
  renderSettings();
  showToast("Name updated");
}


// ── REMINDER SHEET ──
function openReminderSheet(user) {
  activeSheet = user;
  const r     = settings[user]?.reminder || { time: "20:00", frequency: "daily", days: [] };

  // Set title
  document.getElementById("sheetTitle").textContent = `${settings[user]?.name || user}'s Reminder`;

  // Set frequency
  document.getElementById("sheetFrequency").value = r.frequency || "daily";

  // Set hour — extract just the hour part from stored time
  const storedHour = (r.time || "20:00").split(":")[0].padStart(2, "0");
  document.getElementById("sheetTime").value = storedHour;

  // Set custom days
  document.querySelectorAll(".day-btn").forEach(btn => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle("active", (r.days || []).includes(day));
  });

  // Show/hide custom days
  onFrequencyChange();

  // Open sheet
  document.getElementById("reminderSheet").classList.add("open");
}

// Exposed to HTML onclick
window.onFrequencyChange = function() {
  const freq = document.getElementById("sheetFrequency").value;
  const wrap = document.getElementById("customDaysWrap");
  wrap.classList.toggle("visible", freq === "custom");
};

window.toggleDay = function(btn) {
  btn.classList.toggle("active");
};

window.closeSheetOutside = function(e) {
  if (e.target.id === "reminderSheet") document.getElementById("reminderSheet").classList.remove("open");
  if (e.target.id === "presetSheet")   document.getElementById("presetSheet").classList.remove("open");
};

window.saveReminder = async function() {
  if (!activeSheet) return;

  const frequency = document.getElementById("sheetFrequency").value;
  const hour      = document.getElementById("sheetTime").value;
  const time      = `${hour.padStart(2,"0")}:00`; // always store as HH:00
  const days      = frequency === "custom"
    ? [...document.querySelectorAll(".day-btn.active")].map(b => parseInt(b.dataset.day))
    : frequency === "weekly" ? [1] : [];

  settings[activeSheet].reminder = { frequency, time, days };
  await saveSettings();
  renderSettings();

  document.getElementById("reminderSheet").classList.remove("open");
  showToast("Reminder updated");
};


// ── EDIT PRESET (bottom sheet) ──
let activePresetUser = null;

function openPresetSheet(user) {
  activePresetUser = user;
  const name    = settings[user]?.name || user;
  const current = settings[user]?.preset || { bristolType: 4, color: "brown", volume: "normal" };

  document.getElementById("presetSheetTitle").textContent = `${name}'s Quick Log Preset`;

  // Set bristol buttons
  document.querySelectorAll("[data-bristol]").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.bristol) === parseInt(current.bristolType));
  });

  // Set color and volume selects
  document.getElementById("presetColor").value  = current.color  || "brown";
  document.getElementById("presetVolume").value = current.volume || "normal";

  document.getElementById("presetSheet").classList.add("open");
}

window.selectBristol = function(btn) {
  document.querySelectorAll("[data-bristol]").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
};

window.savePreset = async function() {
  if (!activePresetUser) return;

  const selectedBtn = document.querySelector("[data-bristol].active");
  if (!selectedBtn) { showToast("Select a Bristol type"); return; }

  const bristolType = parseInt(selectedBtn.dataset.bristol);
  const color       = document.getElementById("presetColor").value;
  const volume      = document.getElementById("presetVolume").value;

  settings[activePresetUser].preset = { bristolType, color, volume, symptoms: ["none"] };
  await saveSettings();
  renderSettings();
  document.getElementById("presetSheet").classList.remove("open");
  showToast("Preset updated");
};


// ── SAVE ──
async function saveSettings() {
  try {
    await setDoc(doc(db, "config", "settings"), {
      mike:  settings.mike,
      jenna: settings.jenna
    }, { merge: true });
  } catch (err) {
    console.error("Failed to save:", err);
    showToast("Failed to save — check connection");
  }
}
