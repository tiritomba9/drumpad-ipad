// Reine Logik ohne Browser-Schnittstellen: Kacheln, Raster, Modi, Templates und Prüfung von Konfigurationen.

export const MAX_PADS = 200;
export const BANKS = ["A", "B", "C"];
/** Kachelanzahl der ersten Fassung, wird nur noch zum Übernehmen alter Daten gebraucht. */
export const LEGACY_COUNT = 24;

export const MODES = {
  retrigger: "Einmal abspielen (Neustart)",
  oneshot: "Einmal abspielen (überlappend)",
  toggle: "Schleife an/aus",
  hold: "Spielt, solange gedrückt",
};
export const DEFAULT_MODE = "retrigger";

export const padId = (number) => `pad${number}`;

export function isPadId(id) {
  const match = /^pad([1-9]\d{0,2})$/.exec(String(id));
  return Boolean(match) && Number(match[1]) <= MAX_PADS;
}

export function padNumber(id) {
  return Number(String(id).slice(3));
}

/**
 * Wählt Spalten und Zeilen für eine Kachelanzahl so, dass die Kacheln möglichst groß werden. Ist der Platz für die
 * Mindestgröße zu klein, wird ein Raster mit fester Zeilenhöhe gewählt, das sich scrollen lässt.
 * @returns {{columns: number, rows: number, scroll: boolean, tile: number}}
 */
export function bestGrid(count, width, height, gap = 10, minTile = 92) {
  if (count <= 0 || width <= 0 || height <= 0) return { columns: 1, rows: 1, scroll: false, tile: minTile };
  let best = null;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const tileWidth = (width - gap * (columns - 1)) / columns;
    const tileHeight = (height - gap * (rows - 1)) / rows;
    const tile = Math.min(tileWidth, tileHeight);
    const empty = columns * rows - count;
    // Größte kleinste Kachelseite gewinnt, bei Gleichstand weniger leere Felder.
    if (!best || tile > best.tile + 0.5 || (Math.abs(tile - best.tile) <= 0.5 && empty < best.empty)) {
      best = { columns, rows, tile, empty };
    }
  }
  if (best.tile >= minTile) return { columns: best.columns, rows: best.rows, scroll: false, tile: best.tile };
  const columns = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
  return { columns, rows: Math.ceil(count / columns), scroll: true, tile: minTile };
}

// Reihenfolge der Tasten der Windows-Version. Sie entspricht den Kacheln 1 bis 16: Numpad 1 bis 9, 0, Punkt, Enter, plus, minus, mal, geteilt.
const LEGACY_ORDER = [
  "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9", "num0",
  "dec", "enter", "add", "sub", "mul", "div",
];

/** Wandelt eine Tasten-Kennung der Windows-Version in eine Kachel um. Kacheln bleiben unverändert, Unbekanntes ergibt null. */
export function toPadId(id) {
  if (isPadId(id)) return id;
  const index = LEGACY_ORDER.indexOf(id);
  return index < 0 ? null : padId(index + 1);
}

// Tasten einer angeschlossenen Hardware-Tastatur, nur wirksam bei aktiver App. Zifferntasten gelten für Tastaturen ohne Numpad.
export const CODE_TO_PAD = {
  Numpad1: "pad1", Numpad2: "pad2", Numpad3: "pad3", Numpad4: "pad4", Numpad5: "pad5",
  Numpad6: "pad6", Numpad7: "pad7", Numpad8: "pad8", Numpad9: "pad9", Numpad0: "pad10",
  NumpadDecimal: "pad11", NumpadEnter: "pad12", NumpadAdd: "pad13", NumpadSubtract: "pad14",
  NumpadMultiply: "pad15", NumpadDivide: "pad16",
  Digit1: "pad1", Digit2: "pad2", Digit3: "pad3", Digit4: "pad4", Digit5: "pad5",
  Digit6: "pad6", Digit7: "pad7", Digit8: "pad8", Digit9: "pad9", Digit0: "pad10",
};

const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus"];

/** Dateiname ohne Ordneranteil, auch bei Windows-Pfaden aus der Desktop-Version. */
export function baseName(path) {
  return String(path).split(/[\\/]/).pop();
}

/** Dateiname ohne Endung, für die Beschriftung der Kacheln. */
export function stem(name) {
  const index = String(name).lastIndexOf(".");
  return index > 0 ? String(name).slice(0, index) : String(name);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isAudioFile(name, type = "") {
  const extension = String(name).split(".").pop().toLowerCase();
  return AUDIO_EXTENSIONS.includes(extension) || String(type).startsWith("audio/");
}

/** Sortiert Dateinamen natürlich: "Sound 2" kommt vor "Sound 10", Groß- und Kleinschreibung zählt nicht. */
export function sortNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" }));
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_PADS;

/**
 * Prüft eine Konfiguration und gibt nur gültige Einträge zurück. Wirft einen Error bei unlesbaren Daten.
 * Konfigurationen der Windows-Version und früherer Fassungen mit Tastennamen werden übernommen, ihre Pfade werden auf den
 * Dateinamen gekürzt und die Tasten auf Kacheln verteilt. Fehlt die Anzahl, ergibt sie sich aus der höchsten belegten
 * Kachel, bei Konfigurationen mit Tastennamen mindestens 16 wie beim Numpad.
 */
export function normalizeProfile(data) {
  if (!isObject(data) || (data.tasten !== undefined && !isObject(data.tasten))) {
    throw new Error("Keine gültige Drumpad-Konfiguration.");
  }
  const tasten = {};
  let highest = 0;
  let legacyKeys = false;
  for (const [key, entry] of Object.entries(data.tasten ?? {})) {
    const id = toPadId(key);
    if (!id || !isObject(entry) || !entry.datei) continue;
    if (!isPadId(key)) legacyKeys = true;
    let volume = Number(entry.lautstaerke ?? 1);
    if (!Number.isFinite(volume)) volume = 1;
    tasten[id] = {
      datei: baseName(entry.datei),
      lautstaerke: Math.min(1, Math.max(0, volume)),
      modus: Object.hasOwn(MODES, entry.modus) ? entry.modus : DEFAULT_MODE,
    };
    highest = Math.max(highest, padNumber(id));
  }
  const fallback = legacyKeys || data.global !== undefined ? Math.max(16, highest) : highest;
  const anzahl = isCount(data.anzahl) ? Math.max(data.anzahl, highest) : fallback;
  return { anzahl, tasten };
}

export function emptyBank() {
  return { name: "", anzahl: 0, tasten: {} };
}

export function emptyBanks() {
  return { aktiv: "A", ...Object.fromEntries(BANKS.map((bank) => [bank, emptyBank()])) };
}

/**
 * Prüft den gespeicherten Zustand der beiden Templates. Fehlerhafte Teile werden durch leere ersetzt.
 * Daten der früheren Fassung ohne eigene Anzahl erhalten mindestens `legacyCount` Kacheln.
 */
export function normalizeBanks(data, legacyCount = 0) {
  const result = emptyBanks();
  if (!isObject(data)) return result;
  for (const bank of BANKS) {
    const part = data[bank];
    if (!isObject(part)) continue;
    try {
      const profile = normalizeProfile(part);
      const anzahl = isCount(part.anzahl) ? profile.anzahl : Math.min(MAX_PADS, Math.max(profile.anzahl, legacyCount));
      result[bank] = { name: typeof part.name === "string" ? part.name : "", anzahl, tasten: profile.tasten };
    } catch {
      // Beschädigter Teil, das Template bleibt leer.
    }
  }
  if (BANKS.includes(data.aktiv)) result.aktiv = data.aktiv;
  return result;
}

// ---------- Änderungen an einem Template (ohne Nebenwirkungen auf das Original) ----------

/** Baut ein Template aus einer Liste von Sounds neu auf: eine Kachel je Sound, in natürlicher Reihenfolge. */
export function buildFromNames(names, name = "") {
  const sorted = sortNames([...new Set(names)]).slice(0, MAX_PADS);
  const tasten = {};
  sorted.forEach((datei, index) => {
    tasten[padId(index + 1)] = { datei, lautstaerke: 1, modus: DEFAULT_MODE };
  });
  return { name, anzahl: sorted.length, tasten };
}

/** Hängt neue Kacheln für Sounds an, die noch auf keiner Kachel liegen. Gibt die Namen der neu belegten Sounds zurück. */
export function appendNames(bank, names) {
  const used = new Set(Object.values(bank.tasten).map((entry) => entry.datei));
  const added = [];
  for (const datei of sortNames([...new Set(names)])) {
    if (used.has(datei) || bank.anzahl >= MAX_PADS) continue;
    bank.anzahl += 1;
    bank.tasten[padId(bank.anzahl)] = { datei, lautstaerke: 1, modus: DEFAULT_MODE };
    added.push(datei);
  }
  return added;
}

/** Fügt eine Kachel mit diesem Sound am Ende an, auch wenn der Sound schon auf einer anderen Kachel liegt. Gibt die Kachel zurück oder null. */
export function appendTile(bank, datei) {
  if (bank.anzahl >= MAX_PADS) return null;
  bank.anzahl += 1;
  const id = padId(bank.anzahl);
  bank.tasten[id] = { datei, lautstaerke: 1, modus: DEFAULT_MODE };
  return id;
}

/** Entfernt eine Kachel, die folgenden rücken auf. */
export function removeTile(bank, number) {
  if (number < 1 || number > bank.anzahl) return;
  for (let index = number; index < bank.anzahl; index++) {
    const next = bank.tasten[padId(index + 1)];
    if (next) bank.tasten[padId(index)] = next;
    else delete bank.tasten[padId(index)];
  }
  delete bank.tasten[padId(bank.anzahl)];
  bank.anzahl -= 1;
}

/** Entfernt leere Kacheln am Ende. Gibt die Zahl der entfernten Kacheln zurück. */
export function trimEmpty(bank) {
  let removed = 0;
  while (bank.anzahl > 0 && !bank.tasten[padId(bank.anzahl)]) {
    bank.anzahl -= 1;
    removed += 1;
  }
  return removed;
}
