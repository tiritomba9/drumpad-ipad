// Oberfläche des Drumpads: Pads, Belegung, Sound-Bibliothek und Konfigurationen.
import {
  KEY_IDS, LAYOUT, LABELS, MODES, DEFAULT_MODE, CODE_TO_KEY,
  normalizeProfile, stem, formatSize, isAudioFile,
} from "./logic.js";
import * as db from "./db.js";
import { Engine } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const PROFILE_PREFIX = "profil:";

const state = { tasten: {}, selected: null, edit: false, pickFor: null };
const library = new Map(); // Dateiname -> Metadaten der gespeicherten Sounds
const keyElements = new Map();
const downKeys = new Set();
const pointers = new Map();

const engine = new Engine({
  createContext: () => new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }),
  getData: async (name) => {
    const record = await db.getSound(name);
    return record ? record.blob.arrayBuffer() : null;
  },
  getEntry: (id) => state.tasten[id],
  onChange: (id) => (id ? paint(id) : paintAll()),
  onMissing: (name) => setStatus(`Datei fehlt: ${name}`),
});

function setStatus(text) {
  $("#status").textContent = text;
}

// ---------- Pads ----------

function buildPads() {
  const pad = $("#pad");
  for (const [id, row, col, rowSpan, colSpan] of LAYOUT) {
    const element = document.createElement("div");
    element.className = "pad-key";
    element.dataset.key = id;
    element.setAttribute("role", "button");
    element.style.gridArea = `${row} / ${col} / span ${rowSpan} / span ${colSpan}`;
    element.innerHTML = '<span class="k"></span><span class="n"></span>';
    pad.append(element);
    keyElements.set(id, element);
  }
}

function paint(id) {
  const element = keyElements.get(id);
  if (!element) return;
  const entry = state.tasten[id];
  element.querySelector(".k").textContent = LABELS[id];
  element.querySelector(".n").textContent = entry ? stem(entry.datei) : "–";
  element.classList.toggle("assigned", Boolean(entry));
  element.classList.toggle("selected", state.edit && state.selected === id);
  element.classList.toggle("down", downKeys.has(id));
  element.classList.toggle("playing", engine.isPlaying(id));
  element.classList.toggle("missing", Boolean(entry) && !library.has(entry.datei));
}

function paintAll() {
  for (const id of KEY_IDS) paint(id);
}

function pressKey(id) {
  downKeys.add(id);
  if (state.edit) select(id);
  else engine.press(id);
  paint(id);
}

function releaseKey(id) {
  downKeys.delete(id);
  if (!state.edit) engine.release(id);
  paint(id);
}

function bindPads() {
  const pad = $("#pad");
  pad.addEventListener("pointerdown", (event) => {
    const element = event.target.closest(".pad-key");
    if (!element) return;
    event.preventDefault();
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Der Zeiger lässt sich nicht festhalten; das Loslassen wird dann am Fenster ausgewertet.
    }
    pointers.set(event.pointerId, element.dataset.key);
    pressKey(element.dataset.key);
  });
  const end = (event) => {
    const id = pointers.get(event.pointerId);
    if (!id) return;
    pointers.delete(event.pointerId);
    releaseKey(id);
  };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  pad.addEventListener("lostpointercapture", end);
  pad.addEventListener("contextmenu", (event) => event.preventDefault());

  // Datei auf ein Pad ziehen, etwa am Rechner oder bei Split View.
  pad.addEventListener("dragover", (event) => event.preventDefault());
  pad.addEventListener("drop", async (event) => {
    event.preventDefault();
    const element = event.target.closest(".pad-key");
    const file = event.dataTransfer?.files?.[0];
    if (!element || !file) return;
    await importAndReport([file], element.dataset.key);
  });

  // Hardware-Tastatur mit Numpad, wirksam nur bei aktiver App.
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTyping() || $("dialog[open]")) return;
    const id = CODE_TO_KEY[event.code];
    if (!id) return;
    event.preventDefault();
    if (!downKeys.has(id)) pressKey(id);
  });
  window.addEventListener("keyup", (event) => {
    const id = CODE_TO_KEY[event.code];
    if (id && downKeys.has(id)) releaseKey(id);
  });
}

function isTyping() {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
}

// ---------- Belegung ----------

function select(id) {
  const previous = state.selected;
  state.selected = id;
  if (previous) paint(previous);
  updatePanel();
  paint(id);
}

function updatePanel() {
  const panel = $("#panel");
  panel.hidden = !state.edit;
  if (!state.edit) return;
  const id = state.selected;
  const entry = id ? state.tasten[id] : null;
  $("#panel-title").textContent = id ? `Taste: ${LABELS[id]}` : "Taste wählen";
  $("#panel-file").textContent = entry ? entry.datei : id ? "Noch kein Sound" : "Tippe ein Pad an, um es zu belegen.";
  const volume = entry ? Math.round(entry.lautstaerke * 100) : 100;
  $("#volume").value = volume;
  $("#volume-out").textContent = volume;
  $("#mode").value = entry ? entry.modus : DEFAULT_MODE;
  for (const selector of ["#btn-pick", "#btn-import-assign"]) $(selector).disabled = !id;
  for (const selector of ["#volume", "#mode", "#btn-test", "#btn-clear"]) $(selector).disabled = !entry;
}

async function saveCurrent() {
  try {
    await db.setKV("belegung", { tasten: state.tasten });
  } catch (error) {
    setStatus(`Speichern fehlgeschlagen: ${error.message}`);
  }
}

async function assign(id, name) {
  const old = state.tasten[id] ?? {};
  state.tasten[id] = { datei: name, lautstaerke: old.lautstaerke ?? 1, modus: old.modus ?? DEFAULT_MODE };
  await saveCurrent();
  engine.preload([name]);
  paint(id);
  updatePanel();
  setStatus(`${LABELS[id]} belegt mit ${name}`);
}

function bindPanel() {
  $("#btn-edit").addEventListener("click", () => {
    state.edit = !state.edit;
    $("#btn-edit").setAttribute("aria-pressed", String(state.edit));
    updatePanel();
    paintAll();
  });
  $("#btn-stop").addEventListener("click", () => engine.stopAll());

  const mode = $("#mode");
  for (const [value, label] of Object.entries(MODES)) mode.add(new Option(label, value));
  mode.addEventListener("change", async () => {
    const entry = state.tasten[state.selected];
    if (!entry) return;
    entry.modus = mode.value;
    await saveCurrent();
  });

  $("#volume").addEventListener("input", (event) => {
    const entry = state.tasten[state.selected];
    if (!entry) return;
    entry.lautstaerke = Number(event.target.value) / 100;
    $("#volume-out").textContent = event.target.value;
    engine.setVolume(state.selected, entry.lautstaerke);
  });
  $("#volume").addEventListener("change", saveCurrent);

  $("#btn-test").addEventListener("click", () => {
    const id = state.selected;
    if (!id || !state.tasten[id]) return;
    engine.press(id);
    setTimeout(() => engine.release(id), 150);
  });
  $("#btn-clear").addEventListener("click", async () => {
    const id = state.selected;
    if (!id || !state.tasten[id]) return;
    engine.stopPad(id);
    delete state.tasten[id];
    await saveCurrent();
    paint(id);
    updatePanel();
  });
  $("#btn-pick").addEventListener("click", () => openLibrary(state.selected));
  $("#btn-import-assign").addEventListener("click", () => {
    $("#file-in").dataset.assign = state.selected ?? "";
    $("#file-in").click();
  });
}

// ---------- Sound-Bibliothek ----------

async function refreshLibrary() {
  library.clear();
  try {
    for (const record of await db.listSounds()) {
      library.set(record.name, { name: record.name, size: record.size, quelle: record.quelle, url: record.url });
    }
  } catch (error) {
    setStatus(`Speicher nicht verfügbar: ${error.message}`);
  }
  paintAll();
}

/** Speichert einen Sound in der Bibliothek, nachdem er sich dekodieren ließ. */
async function importBlob(name, blob, extra = {}) {
  if (!isAudioFile(name, blob.type)) {
    throw new Error(`${name}: keine Audiodatei (erlaubt: wav, mp3, m4a, aac, flac, ogg).`);
  }
  const data = await blob.arrayBuffer();
  try {
    await engine.context().decodeAudioData(data.slice(0));
  } catch {
    throw new Error(`${name}: Format wird auf diesem Gerät nicht gelesen.`);
  }
  await db.putSound({
    name,
    blob: new Blob([data], { type: blob.type || "audio/mpeg" }),
    size: data.byteLength,
    quelle: "lokal",
    added: Date.now(),
    ...extra,
  });
  engine.invalidate(name);
}

async function importAndReport(files, assignTo = null) {
  const done = [];
  const errors = [];
  for (const file of files) {
    try {
      await importBlob(file.name, file);
      done.push(file.name);
    } catch (error) {
      errors.push(error.message);
    }
  }
  await refreshLibrary();
  if (done.length && assignTo) await assign(assignTo, done[0]);
  navigator.storage?.persist?.().catch(() => {});
  const parts = [];
  if (done.length) parts.push(`${done.length} importiert`);
  if (errors.length) parts.push(errors.join(" "));
  setStatus(parts.join(". ") || "Nichts importiert.");
  if ($("#dlg-sounds").open) renderLibrary();
}

async function importFromUrl() {
  const input = $("#url-in");
  const text = input.value.trim();
  if (!text) return;
  let url;
  try {
    url = new URL(text);
  } catch {
    setStatus("Ungültige Adresse.");
    return;
  }
  setStatus("Lade …");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Server antwortet mit ${response.status}.`);
    const blob = await response.blob();
    const name = decodeURIComponent(url.pathname.split("/").pop() || "sound") || "sound";
    await importBlob(name, blob, { quelle: "url", url: url.href });
    await refreshLibrary();
    input.value = "";
    setStatus(`Importiert: ${name}`);
    renderLibrary();
  } catch (error) {
    const reason = error instanceof TypeError
      ? "Der Server erlaubt den Abruf aus dem Browser nicht oder ist nicht erreichbar. Lade die Datei stattdessen mit der Dateien-App."
      : error.message;
    setStatus(`Abruf nicht möglich: ${reason}`);
  }
}

function openLibrary(pickFor = null) {
  state.pickFor = pickFor;
  $("#sounds-title").textContent = pickFor ? `Sound für Taste ${LABELS[pickFor]} wählen` : "Sound-Bibliothek";
  renderLibrary();
  $("#dlg-sounds").showModal();
}

function renderLibrary() {
  const list = $("#lib-list");
  list.replaceChildren();
  if (!library.size) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Noch keine Sounds. Importiere Dateien aus der Dateien-App oder lade sie von einer Adresse.";
    list.append(li);
    return;
  }
  const names = [...library.keys()].sort((a, b) => a.localeCompare(b, "de"));
  for (const name of names) {
    const meta = library.get(name);
    const li = document.createElement("li");
    li.dataset.name = name;
    const label = document.createElement("span");
    label.className = "nm";
    label.textContent = name;
    const info = document.createElement("span");
    info.className = "meta";
    info.textContent = `${formatSize(meta.size)} · ${meta.quelle === "url" ? "Adresse" : "Datei"}`;
    li.append(label, info);
    const actions = state.pickFor ? ["Wählen", "Anhören", "Löschen"] : ["Anhören", "Löschen"];
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = action;
      button.textContent = action;
      li.append(button);
    }
    list.append(li);
  }
}

function bindLibrary() {
  $("#btn-sounds").addEventListener("click", () => openLibrary(null));
  $("#btn-import").addEventListener("click", () => {
    $("#file-in").dataset.assign = "";
    $("#file-in").click();
  });
  $("#btn-url").addEventListener("click", importFromUrl);
  $("#url-in").addEventListener("keydown", (event) => {
    if (event.key === "Enter") importFromUrl();
  });
  $("#file-in").addEventListener("change", async (event) => {
    const input = event.target;
    const files = [...input.files];
    const target = input.dataset.assign || null;
    input.value = "";
    if (files.length) await importAndReport(files, target);
  });
  $("#lib-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const name = button.closest("li").dataset.name;
    if (button.dataset.act === "Wählen") {
      const id = state.pickFor;
      $("#dlg-sounds").close();
      await assign(id, name);
    } else if (button.dataset.act === "Anhören") {
      engine.preview(name).catch(() => setStatus(`Nicht abspielbar: ${name}`));
    } else if (button.dataset.act === "Löschen") {
      if (!confirm(`„${name}“ aus der Bibliothek löschen? Pads, die den Sound nutzen, verlieren ihren Ton.`)) return;
      await db.deleteSound(name);
      engine.invalidate(name);
      await refreshLibrary();
      renderLibrary();
    }
  });
}

// ---------- Konfigurationen ----------

async function listProfiles() {
  const keys = await db.listKVKeys();
  return keys.filter((key) => String(key).startsWith(PROFILE_PREFIX)).map((key) => String(key).slice(PROFILE_PREFIX.length)).sort((a, b) => a.localeCompare(b, "de"));
}

async function renderProfiles() {
  const list = $("#profile-list");
  list.replaceChildren();
  let names = [];
  try {
    names = await listProfiles();
  } catch (error) {
    setStatus(`Speicher nicht verfügbar: ${error.message}`);
  }
  if (!names.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Noch keine gespeicherte Konfiguration.";
    list.append(li);
    return;
  }
  for (const name of names) {
    const li = document.createElement("li");
    li.dataset.name = name;
    const label = document.createElement("span");
    label.className = "nm";
    label.textContent = name;
    li.append(label);
    for (const action of ["Laden", "Exportieren", "Löschen"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = action;
      button.textContent = action;
      li.append(button);
    }
    list.append(li);
  }
}

async function applyProfile(data, label) {
  const profile = normalizeProfile(data);
  engine.stopAll();
  state.tasten = profile.tasten;
  await saveCurrent();
  const names = [...new Set(Object.values(profile.tasten).map((entry) => entry.datei))];
  const missing = names.filter((name) => !library.has(name));
  engine.preload(names.filter((name) => library.has(name)));
  updatePanel();
  paintAll();
  let text = `Konfiguration geladen: ${label}`;
  if (missing.length) text += ` – Datei fehlt: ${missing.join(", ")}`;
  setStatus(text);
}

async function exportJson(name, data) {
  const file = new File([JSON.stringify(data, null, 2)], `${name}.json`, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function bindProfiles() {
  $("#btn-profile").addEventListener("click", async () => {
    await renderProfiles();
    $("#dlg-profile").showModal();
  });
  $("#btn-profile-save").addEventListener("click", async () => {
    const input = $("#profile-name");
    const name = input.value.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) {
      setStatus("Bitte einen Namen eingeben.");
      return;
    }
    await db.setKV(PROFILE_PREFIX + name, { tasten: state.tasten });
    input.value = "";
    setStatus(`Konfiguration gespeichert: ${name}`);
    await renderProfiles();
  });
  $("#profile-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const name = button.closest("li").dataset.name;
    const data = await db.getKV(PROFILE_PREFIX + name);
    if (button.dataset.act === "Laden") {
      $("#dlg-profile").close();
      try {
        await applyProfile(data, name);
      } catch (error) {
        setStatus(error.message);
      }
    } else if (button.dataset.act === "Exportieren") {
      await exportJson(name, data);
    } else if (button.dataset.act === "Löschen") {
      if (!confirm(`Konfiguration „${name}“ löschen?`)) return;
      await db.deleteKV(PROFILE_PREFIX + name);
      await renderProfiles();
    }
  });
  $("#btn-profile-export").addEventListener("click", () => exportJson("Drumpad-Belegung", { tasten: state.tasten }));
  $("#btn-profile-import").addEventListener("click", () => $("#json-in").click());
  $("#json-in").addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      $("#dlg-profile").close();
      await applyProfile(data, file.name);
    } catch (error) {
      setStatus(error instanceof SyntaxError ? "Laden fehlgeschlagen: keine gültige JSON-Datei." : `Laden fehlgeschlagen: ${error.message}`);
    }
  });
}

// ---------- Start ----------

async function init() {
  buildPads();
  bindPads();
  bindPanel();
  bindLibrary();
  bindProfiles();
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    // Die Einstellung wird von diesem Browser nicht unterstützt.
  }
  const iosBrowser = /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iosBrowser && !navigator.standalone) $("#hint").hidden = false;

  try {
    const saved = await db.getKV("belegung");
    if (saved) state.tasten = normalizeProfile(saved).tasten;
  } catch (error) {
    setStatus(`Speicher nicht verfügbar: ${error.message}`);
  }
  await refreshLibrary();
  updatePanel();
  engine.preload(Object.values(state.tasten).map((entry) => entry.datei).filter((name) => library.has(name)));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Für Selbsttests im Browser.
  window.drumpad = { state, engine, library, assign, importBlob, refreshLibrary, applyProfile, db };
}

init();
