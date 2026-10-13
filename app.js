// Oberfläche des Drumpads: Kacheln, zwei Templates, Belegung, Sound-Bibliothek, Konfigurationen und Einstellungen.
import {
  BANKS, MODES, DEFAULT_MODE, LEGACY_COUNT, MAX_PADS, CODE_TO_PAD,
  bestGrid, padId, padNumber, normalizeProfile, normalizeBanks, emptyBanks,
  buildFromNames, appendNames, appendTile, removeTile, trimEmpty, stem, formatSize, isAudioFile,
} from "./logic.js";
import * as db from "./db.js";
import { Engine } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const PROFILE_PREFIX = "profil:";
const GAP = 10;

const { A: emptyA, B: emptyB } = emptyBanks();
const state = { banks: { A: emptyA, B: emptyB }, bank: "A", selected: null, edit: false, pickFor: null };
const settings = { dauerbereit: true, autoBelegen: true, obenAbstand: null };
const library = new Map(); // Dateiname -> Metadaten der gespeicherten Sounds
const keyElements = new Map();
const downKeys = new Set(); // Kennungen der gerade gedrückten Kacheln, mit Template
const pointers = new Map();
let built = { count: -1, edit: false };

/** Sichtbares Template mit Name, Kachelanzahl und Belegung. */
const bankData = () => state.banks[state.bank];
/** Belegung des sichtbaren Templates. */
const tasten = () => bankData().tasten;
/** Kennung für die Tonausgabe: Template und Kachel, damit gleiche Kacheln verschiedener Templates getrennt laufen. */
const eid = (id, bank = state.bank) => `${bank}/${id}`;
const labelOf = (id) => String(padNumber(id));

const engine = new Engine({
  createContext: () => new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }),
  getData: async (name) => {
    const record = await db.getSound(name);
    return record ? record.blob.arrayBuffer() : null;
  },
  getEntry: (key) => {
    const [bank, id] = key.split("/");
    return state.banks[bank]?.tasten[id];
  },
  onChange: (key) => {
    if (!key) return paintAll();
    const [bank, id] = key.split("/");
    if (bank === state.bank) flag(id);
  },
  onMissing: (name) => setStatus(`Datei fehlt: ${name}`),
});

function setStatus(text) {
  $("#status").textContent = text;
}

// ---------- Kacheln ----------

/** Baut die Kacheln des sichtbaren Templates neu auf. Im Bearbeiten-Modus kommt eine Kachel zum Hinzufügen dazu. */
function buildPads() {
  const pad = $("#pad");
  const count = bankData().anzahl;
  pad.replaceChildren();
  keyElements.clear();
  for (let number = 1; number <= count; number++) {
    const id = padId(number);
    const element = document.createElement("div");
    element.className = "pad-key";
    element.dataset.key = id;
    element.setAttribute("role", "button");
    element.innerHTML = '<span class="k"></span><span class="n"></span>';
    element.querySelector(".k").textContent = String(number);
    pad.append(element);
    keyElements.set(id, element);
  }
  if (state.edit) {
    const add = document.createElement("div");
    add.className = "pad-add";
    add.setAttribute("role", "button");
    add.innerHTML = '<span class="k">+</span><span class="n">Sound hinzufügen</span>';
    pad.append(add);
  } else if (count === 0) {
    const hint = document.createElement("div");
    hint.className = "pad-hint";
    hint.textContent = `Template ${state.bank} ist leer. Importiere unter „Sounds“ einen Ordner oder Dateien, oder schalte „Bearbeiten“ ein und füge mit + einen Sound hinzu.`;
    pad.append(hint);
  }
  built = { count, edit: state.edit };
  if (state.selected && padNumber(state.selected) > count) state.selected = null;
  applyGrid();
  paintAll();
}

/** Baut neu auf, wenn sich Anzahl oder Modus geändert haben, sonst wird nur neu gezeichnet. */
function refreshPads() {
  if (built.count !== bankData().anzahl || built.edit !== state.edit) buildPads();
  else paintAll();
}

function applyGrid() {
  const pad = $("#pad");
  const cells = bankData().anzahl + (state.edit || bankData().anzahl === 0 ? 1 : 0);
  const grid = bestGrid(cells, pad.clientWidth, pad.clientHeight, GAP);
  pad.style.gridTemplateColumns = `repeat(${grid.columns}, 1fr)`;
  if (grid.scroll) {
    pad.style.gridTemplateRows = "none";
    pad.style.gridAutoRows = `${grid.tile}px`;
    pad.style.overflowY = "auto";
  } else {
    pad.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
    pad.style.gridAutoRows = "";
    pad.style.overflowY = "hidden";
  }
}

function paint(id) {
  const element = keyElements.get(id);
  if (!element) return;
  const entry = tasten()[id];
  element.querySelector(".n").textContent = entry ? stem(entry.datei) : "–";
  element.classList.toggle("assigned", Boolean(entry));
  element.classList.toggle("selected", state.edit && state.selected === id);
  element.classList.toggle("down", downKeys.has(eid(id)));
  element.classList.toggle("playing", engine.isPlaying(eid(id)));
  element.classList.toggle("missing", Boolean(entry) && !library.has(entry.datei));
}

/** Aktualisiert nur die Zustände gedrückt und spielt. Hält die Arbeit im Hauptthread beim Antippen klein. */
function flag(id) {
  const element = keyElements.get(id);
  if (!element) return;
  element.classList.toggle("down", downKeys.has(eid(id)));
  element.classList.toggle("playing", engine.isPlaying(eid(id)));
}

function paintAll() {
  for (const id of keyElements.keys()) paint(id);
  paintBanks();
}

function pressKey(id) {
  const key = eid(id);
  downKeys.add(key);
  if (state.edit) {
    select(id);
    paint(id);
  } else {
    engine.press(key);
    flag(id);
  }
  return key;
}

/** Lässt die Kachel los, die beim Drücken gemeint war, auch wenn inzwischen das Template gewechselt wurde. */
function releaseKey(key) {
  downKeys.delete(key);
  if (!state.edit) engine.release(key);
  const [bank, id] = key.split("/");
  if (bank === state.bank) flag(id);
}

function bindPads() {
  const pad = $("#pad");
  pad.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".pad-add")) {
      event.preventDefault();
      openLibrary("new");
      return;
    }
    const element = event.target.closest(".pad-key");
    if (!element) return;
    event.preventDefault();
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Der Zeiger lässt sich nicht festhalten; das Loslassen wird dann am Fenster ausgewertet.
    }
    pointers.set(event.pointerId, pressKey(element.dataset.key));
  });
  const end = (event) => {
    const key = pointers.get(event.pointerId);
    if (!key) return;
    pointers.delete(event.pointerId);
    releaseKey(key);
  };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  pad.addEventListener("lostpointercapture", end);
  pad.addEventListener("contextmenu", (event) => event.preventDefault());

  // Datei auf eine Kachel ziehen, etwa am Rechner oder bei Split View.
  pad.addEventListener("dragover", (event) => event.preventDefault());
  pad.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (event.target.closest(".pad-add")) await importAndReport([file], { assignTo: "new" });
    else {
      const element = event.target.closest(".pad-key");
      if (element) await importAndReport([file], { assignTo: element.dataset.key });
    }
  });

  // Hardware-Tastatur, wirksam nur bei aktiver App.
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTyping() || $("dialog[open]")) return;
    const id = CODE_TO_PAD[event.code];
    if (!id || !keyElements.has(id)) return;
    event.preventDefault();
    if (!downKeys.has(eid(id))) pressKey(id);
  });
  window.addEventListener("keyup", (event) => {
    const id = CODE_TO_PAD[event.code];
    const key = id && [...downKeys].find((candidate) => candidate.endsWith(`/${id}`));
    if (key) releaseKey(key);
  });

  // Das Raster richtet sich nach dem tatsächlich verfügbaren Platz, auch beim Drehen des Geräts.
  if ("ResizeObserver" in window) new ResizeObserver(applyGrid).observe(pad);
  else window.addEventListener("resize", applyGrid);
}

function isTyping() {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
}

// ---------- Templates ----------

function paintBanks() {
  for (const bank of BANKS) {
    const button = $(`#bank-${bank}`);
    button.setAttribute("aria-pressed", String(state.bank === bank));
    const data = state.banks[bank];
    button.querySelector("span").textContent = data.name || (data.anzahl ? `${data.anzahl} Kacheln` : "leer");
  }
}

/** Wechselt das sichtbare Template. Laufende Sounds spielen weiter, beide Templates sind vorgeladen. */
async function switchBank(bank) {
  if (!BANKS.includes(bank) || bank === state.bank) return;
  state.bank = bank;
  refreshPads();
  updatePanel();
  await saveBanks();
}

function bindBanks() {
  for (const bank of BANKS) {
    // pointerdown statt click: der Wechsel greift sofort beim Berühren.
    $(`#bank-${bank}`).addEventListener("pointerdown", (event) => {
      event.preventDefault();
      switchBank(bank);
    });
  }
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
  const entry = id ? tasten()[id] : null;
  $("#panel-title").textContent = id ? `Kachel ${labelOf(id)} von ${bankData().anzahl}, Template ${state.bank}` : `Template ${state.bank}: ${bankData().anzahl} Kacheln`;
  $("#panel-file").textContent = entry ? entry.datei : id ? "Noch kein Sound" : "Tippe eine Kachel an, um sie zu belegen, oder + für eine neue.";
  const volume = entry ? Math.round(entry.lautstaerke * 100) : 100;
  $("#volume").value = volume;
  $("#volume-out").textContent = volume;
  $("#mode").value = entry ? entry.modus : DEFAULT_MODE;
  for (const selector of ["#btn-pick", "#btn-import-assign", "#btn-remove-tile"]) $(selector).disabled = !id;
  for (const selector of ["#volume", "#mode", "#btn-test", "#btn-clear"]) $(selector).disabled = !entry;
}

async function saveBanks() {
  try {
    await db.setKV("baenke", { ...state.banks, aktiv: state.bank });
  } catch (error) {
    setStatus(`Speichern fehlgeschlagen: ${error.message}`);
  }
}

async function assign(id, name) {
  const old = tasten()[id] ?? {};
  tasten()[id] = { datei: name, lautstaerke: old.lautstaerke ?? 1, modus: old.modus ?? DEFAULT_MODE };
  await saveBanks();
  engine.preload([name]);
  paint(id);
  updatePanel();
  setStatus(`Kachel ${labelOf(id)} belegt mit ${name}`);
}

/** Legt am Ende des sichtbaren Templates eine neue Kachel mit diesem Sound an und wählt sie aus. */
async function addTileWithSound(name) {
  const id = appendTile(bankData(), name);
  if (!id) {
    setStatus(`Mehr als ${MAX_PADS} Kacheln sind nicht möglich.`);
    return null;
  }
  state.selected = id;
  await saveBanks();
  engine.preload([name]);
  buildPads();
  updatePanel();
  setStatus(`Neue Kachel ${labelOf(id)} mit ${name}`);
  return id;
}

async function removeSelectedTile() {
  const id = state.selected;
  if (!id || padNumber(id) > bankData().anzahl) return;
  if (!confirm(`Kachel ${labelOf(id)} aus Template ${state.bank} entfernen? Die folgenden Kacheln rücken auf.`)) return;
  engine.stopWhere(`${state.bank}/`);
  removeTile(bankData(), padNumber(id));
  state.selected = null;
  await saveBanks();
  buildPads();
  updatePanel();
  setStatus(`Kachel ${labelOf(id)} entfernt. Template ${state.bank} hat ${bankData().anzahl} Kacheln.`);
}

async function trimEmptyTiles() {
  const removed = trimEmpty(bankData());
  if (!removed) {
    setStatus("Keine leeren Kacheln am Ende.");
    return;
  }
  await saveBanks();
  buildPads();
  updatePanel();
  setStatus(`${removed} leere Kacheln am Ende entfernt. Template ${state.bank} hat ${bankData().anzahl} Kacheln.`);
}

function bindPanel() {
  $("#btn-edit").addEventListener("click", () => {
    state.edit = !state.edit;
    $("#btn-edit").setAttribute("aria-pressed", String(state.edit));
    updatePanel();
    refreshPads();
  });
  $("#btn-stop").addEventListener("click", () => engine.stopAll());

  const mode = $("#mode");
  for (const [value, label] of Object.entries(MODES)) mode.add(new Option(label, value));
  mode.addEventListener("change", async () => {
    const entry = tasten()[state.selected];
    if (!entry) return;
    entry.modus = mode.value;
    await saveBanks();
  });

  $("#volume").addEventListener("input", (event) => {
    const entry = tasten()[state.selected];
    if (!entry) return;
    entry.lautstaerke = Number(event.target.value) / 100;
    $("#volume-out").textContent = event.target.value;
    engine.setVolume(eid(state.selected), entry.lautstaerke);
  });
  $("#volume").addEventListener("change", saveBanks);

  $("#btn-test").addEventListener("click", () => {
    const id = state.selected;
    if (!id || !tasten()[id]) return;
    const key = eid(id);
    engine.press(key);
    setTimeout(() => engine.release(key), 150);
  });
  $("#btn-clear").addEventListener("click", async () => {
    const id = state.selected;
    if (!id || !tasten()[id]) return;
    engine.stopPad(eid(id));
    delete tasten()[id];
    await saveBanks();
    paint(id);
    updatePanel();
  });
  $("#btn-pick").addEventListener("click", () => openLibrary(state.selected));
  $("#btn-import-assign").addEventListener("click", () => {
    $("#file-in").dataset.assign = state.selected ?? "";
    $("#file-in").click();
  });
  $("#btn-add-tile").addEventListener("click", () => openLibrary("new"));
  $("#btn-remove-tile").addEventListener("click", removeSelectedTile);
  $("#btn-trim").addEventListener("click", trimEmptyTiles);
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

/**
 * Importiert Sounds in die Bibliothek und legt je nach Einstellung Kacheln an.
 * - assignTo "new": genau eine neue Kachel mit dem ersten Sound, unabhängig von der Einstellung.
 * - assignTo eine Kachel: der erste Sound kommt auf diese Kachel.
 * - folder: Ordner. Ist die Automatik an, wird das sichtbare Template mit einer Kachel je Sound neu aufgebaut.
 * - sonst: Ist die Automatik an, bekommt jeder neue Sound eine neue Kachel am Ende.
 */
async function importAndReport(files, { assignTo = null, folder = false, folderName = "" } = {}) {
  const candidates = folder ? files.filter((file) => isAudioFile(file.name, file.type)) : files;
  const skipped = files.length - candidates.length;
  const done = [];
  const errors = [];
  for (const file of candidates) {
    try {
      await importBlob(file.name, file);
      done.push(file.name);
    } catch (error) {
      errors.push(error.message);
    }
  }
  await refreshLibrary();
  navigator.storage?.persist?.().catch(() => {});

  const parts = [];
  if (done.length) parts.push(`${done.length} importiert`);
  if (skipped) parts.push(`${skipped} Dateien ohne Audio übersprungen`);
  if (assignTo === "new") {
    if (done.length) await addTileWithSound(done[0]);
  } else if (assignTo) {
    if (done.length) await assign(assignTo, done[0]);
  } else if (settings.autoBelegen && done.length) {
    const bank = bankData();
    if (folder) {
      const used = Object.keys(bank.tasten).length;
      if (used && !confirm(`Template ${state.bank} enthält schon ${used} belegte Kacheln. Mit diesem Ordner neu aufbauen? Die bisherige Belegung von ${state.bank} geht verloren, gespeicherte Konfigurationen bleiben erhalten.`)) {
        parts.push(`Template ${state.bank} unverändert`);
      } else {
        engine.stopWhere(`${state.bank}/`);
        state.banks[state.bank] = buildFromNames(done, folderName || bank.name);
        state.selected = null;
        await saveBanks();
        engine.preload(done);
        buildPads();
        updatePanel();
        parts.push(`Template ${state.bank} mit ${state.banks[state.bank].anzahl} Kacheln aufgebaut`);
      }
    } else {
      const added = appendNames(bank, done);
      if (added.length) {
        await saveBanks();
        engine.preload(added);
        buildPads();
        updatePanel();
      }
      parts.push(added.length ? `${added.length} neue Kacheln` : "keine neuen Kacheln (Sounds liegen schon auf Kacheln)");
    }
  } else if (done.length) {
    parts.push("nur in der Bibliothek, Kacheln werden nicht automatisch angelegt");
  }
  if (errors.length) parts.push(errors.join(" "));
  if (!assignTo || errors.length) setStatus(parts.join(". ") || "Nichts importiert.");
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
    if (state.pickFor === "new") {
      $("#dlg-sounds").close();
      await addTileWithSound(name);
    } else if (state.pickFor) {
      $("#dlg-sounds").close();
      await assign(state.pickFor, name);
    } else if (settings.autoBelegen) {
      const added = appendNames(bankData(), [name]);
      if (added.length) {
        await saveBanks();
        engine.preload(added);
        buildPads();
        updatePanel();
      }
      setStatus(`Importiert: ${name}${added.length ? ", neue Kachel angelegt" : ""}`);
      renderLibrary();
    } else {
      setStatus(`Importiert: ${name}`);
      renderLibrary();
    }
  } catch (error) {
    const reason = error instanceof TypeError
      ? "Der Server erlaubt den Abruf aus dem Browser nicht oder ist nicht erreichbar. Lade die Datei stattdessen mit der Dateien-App."
      : error.message;
    setStatus(`Abruf nicht möglich: ${reason}`);
  }
}

function openLibrary(pickFor = null) {
  state.pickFor = pickFor;
  $("#sounds-title").textContent = pickFor === "new"
    ? "Neue Kachel: Sound wählen oder importieren"
    : pickFor ? `Sound für Kachel ${labelOf(pickFor)} wählen` : "Sound-Bibliothek";
  $("#import-auto").hidden = Boolean(pickFor);
  $("#btn-import").textContent = pickFor ? "Sound importieren …" : "Dateien importieren …";
  renderLibrary();
  $("#dlg-sounds").showModal();
}

function actionButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.act = label;
  button.textContent = label;
  return button;
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
  const names = [...library.keys()].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" }));
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
    for (const action of actions) li.append(actionButton(action));
    list.append(li);
  }
}

function bindLibrary() {
  $("#btn-sounds").addEventListener("click", () => openLibrary(null));
  $("#btn-import").addEventListener("click", () => {
    // Beim Wählen für eine Kachel oder eine neue Kachel kommt der erste importierte Sound dorthin.
    $("#file-in").dataset.assign = state.pickFor ?? "";
    $("#file-in").click();
  });
  $("#btn-import-dir").addEventListener("click", () => $("#dir-in").click());
  $("#auto-belegen").addEventListener("change", async (event) => {
    settings.autoBelegen = event.target.checked;
    await saveSettings();
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
    if (!files.length) return;
    if (target) $("#dlg-sounds").close();
    await importAndReport(files, { assignTo: target });
  });
  $("#dir-in").addEventListener("change", async (event) => {
    const input = event.target;
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    const folderName = files.find((file) => file.webkitRelativePath)?.webkitRelativePath.split("/")[0] ?? "";
    await importAndReport(files, { folder: true, folderName });
  });
  $("#lib-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const name = button.closest("li").dataset.name;
    if (button.dataset.act === "Wählen") {
      const target = state.pickFor;
      $("#dlg-sounds").close();
      if (target === "new") await addTileWithSound(name);
      else await assign(target, name);
    } else if (button.dataset.act === "Anhören") {
      engine.preview(name).catch(() => setStatus(`Nicht abspielbar: ${name}`));
    } else if (button.dataset.act === "Löschen") {
      if (!confirm(`„${name}“ aus der Bibliothek löschen? Kacheln, die den Sound nutzen, verlieren ihren Ton.`)) return;
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
    for (const action of ["In A laden", "In B laden", "Exportieren", "Löschen"]) li.append(actionButton(action));
    list.append(li);
  }
}

/** Lädt eine Konfiguration in eines der beiden Templates. Das andere Template und laufende Sounds bleiben unberührt. */
async function applyProfile(data, label, bank = state.bank) {
  const profile = normalizeProfile(data);
  engine.stopWhere(`${bank}/`);
  state.banks[bank] = { name: label, anzahl: profile.anzahl, tasten: profile.tasten };
  await saveBanks();
  const names = [...new Set(Object.values(profile.tasten).map((entry) => entry.datei))];
  const missing = names.filter((name) => !library.has(name));
  engine.preload(names.filter((name) => library.has(name)));
  if (bank === state.bank) buildPads();
  else paintBanks();
  updatePanel();
  let text = `Template ${bank}: „${label}“ geladen (${profile.anzahl} Kacheln)`;
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

const profileOf = (bank) => ({ anzahl: bank.anzahl, tasten: bank.tasten });

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
    await db.setKV(PROFILE_PREFIX + name, profileOf(bankData()));
    bankData().name = name;
    await saveBanks();
    paintBanks();
    input.value = "";
    setStatus(`Template ${state.bank} gespeichert als Konfiguration: ${name}`);
    await renderProfiles();
  });
  $("#profile-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const name = button.closest("li").dataset.name;
    const data = await db.getKV(PROFILE_PREFIX + name);
    const act = button.dataset.act;
    if (act === "In A laden" || act === "In B laden") {
      $("#dlg-profile").close();
      try {
        await applyProfile(data, name, act === "In A laden" ? "A" : "B");
      } catch (error) {
        setStatus(error.message);
      }
    } else if (act === "Exportieren") {
      await exportJson(name, data);
    } else if (act === "Löschen") {
      if (!confirm(`Konfiguration „${name}“ löschen?`)) return;
      await db.deleteKV(PROFILE_PREFIX + name);
      await renderProfiles();
    }
  });
  $("#btn-profile-export").addEventListener("click", () => exportJson(`Drumpad-Template-${state.bank}`, profileOf(bankData())));
  $("#btn-profile-import").addEventListener("click", () => $("#json-in").click());
  $("#json-in").addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      $("#dlg-profile").close();
      await applyProfile(data, file.name.replace(/\.json$/i, ""));
    } catch (error) {
      setStatus(error instanceof SyntaxError ? "Laden fehlgeschlagen: keine gültige JSON-Datei." : `Laden fehlgeschlagen: ${error.message}`);
    }
  });
}

// ---------- Einstellungen ----------

async function saveSettings() {
  try {
    await db.setKV("einstellungen", { ...settings });
  } catch (error) {
    setStatus(`Speichern fehlgeschlagen: ${error.message}`);
  }
}

async function setKeepAlive(on, save = true) {
  settings.dauerbereit = on;
  engine.setKeepAlive(on);
  $("#keep-alive").checked = on;
  if (save) await saveSettings();
}

/** Setzt den zusätzlichen Abstand zur Statusleiste von iPadOS. null bedeutet: automatisch. */
function applyTopGap(value) {
  const root = document.documentElement;
  if (value === null) root.style.removeProperty("--top-extra");
  else root.style.setProperty("--top-extra", `${value}px`);
  const shown = value ?? (parseFloat(getComputedStyle(root).getPropertyValue("--top-extra")) || 0);
  $("#top-gap").value = String(shown);
  $("#top-gap-out").textContent = `${shown}${value === null ? " (automatisch)" : ""}`;
  applyGrid();
}

function showDiagnostics() {
  const info = engine.diagnostics();
  const lines = Object.entries(info).map(([name, value]) => `${name}: ${value}`);
  lines.push(`Audio-Sitzung: ${navigator.audioSession ? navigator.audioSession.type : "nicht verfügbar"}`);
  lines.push(`Fenster: ${window.innerWidth} x ${window.innerHeight}, oberer Rand ${getComputedStyle($("body")).paddingTop}`);
  $("#diag").textContent = lines.join("\n");
}

function bindSettings() {
  $("#keep-alive").addEventListener("change", (event) => setKeepAlive(event.target.checked));

  $("#top-gap").addEventListener("input", (event) => {
    settings.obenAbstand = Number(event.target.value);
    applyTopGap(settings.obenAbstand);
  });
  $("#top-gap").addEventListener("change", saveSettings);
  $("#btn-top-auto").addEventListener("click", async () => {
    settings.obenAbstand = null;
    applyTopGap(null);
    await saveSettings();
  });

  $("#btn-diag").addEventListener("click", () => {
    engine.unlock();
    // Kurz warten, bis der Kontext nach dem Entsperren läuft.
    setTimeout(showDiagnostics, 300);
  });
  // Im Hintergrund das Dauersignal beenden, beim nächsten Antippen startet es wieder.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) engine.stopKeepAlive();
  });
}

// ---------- Start ----------

async function loadState() {
  let legacyCount = 0;
  try {
    const saved = await db.getKV("einstellungen");
    if (saved && typeof saved === "object") {
      if (typeof saved.dauerbereit === "boolean") settings.dauerbereit = saved.dauerbereit;
      if (typeof saved.autoBelegen === "boolean") settings.autoBelegen = saved.autoBelegen;
      if (typeof saved.obenAbstand === "number") settings.obenAbstand = saved.obenAbstand;
      // Die frühere Fassung kannte eine feste Kachelanzahl für alle Templates.
      if (Number.isInteger(saved.kacheln)) legacyCount = saved.kacheln;
    }
  } catch {
    // Ohne Speicher gelten die Voreinstellungen.
  }
  try {
    const saved = await db.getKV("baenke");
    if (saved) {
      const banks = normalizeBanks(saved, legacyCount || LEGACY_COUNT);
      state.bank = banks.aktiv;
      state.banks = { A: banks.A, B: banks.B };
    } else {
      // Erste Fassung: eine einzelne Belegung wird zu Template A.
      const legacy = await db.getKV("belegung");
      if (legacy) {
        const profile = normalizeProfile(legacy);
        state.banks.A = { name: "", anzahl: profile.anzahl, tasten: profile.tasten };
      }
    }
  } catch (error) {
    setStatus(`Speicher nicht verfügbar: ${error.message}`);
  }
}

async function init() {
  bindPads();
  bindBanks();
  bindPanel();
  bindLibrary();
  bindProfiles();
  bindSettings();
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    // Die Einstellung wird von diesem Browser nicht unterstützt.
  }
  const iosBrowser = /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iosBrowser && !navigator.standalone) $("#hint").hidden = false;

  await loadState();
  applyTopGap(settings.obenAbstand);
  $("#auto-belegen").checked = settings.autoBelegen;
  await setKeepAlive(settings.dauerbereit, false);
  buildPads();
  await refreshLibrary();
  updatePanel();
  const names = BANKS.flatMap((bank) => Object.values(state.banks[bank].tasten).map((entry) => entry.datei));
  engine.preload(names.filter((name) => library.has(name)));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Für Selbsttests im Browser.
  window.drumpad = {
    state, settings, engine, library, assign, importBlob, importAndReport, addTileWithSound, removeSelectedTile,
    trimEmptyTiles, refreshLibrary, applyProfile, switchBank, eid, tasten, bankData, db,
  };
}

init();
