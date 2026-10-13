// Reine Logik ohne Browser-Schnittstellen: Kacheln, Raster, Modi, Templates und Prüfung von Konfigurationen.

export const MAX_PADS = 36;
export const COUNTS = [12, 16, 20, 24, 30, 36];
export const DEFAULT_COUNT = 24;
export const PAD_IDS = Array.from({ length: MAX_PADS }, (_, index) => `pad${index + 1}`);
export const BANKS = ["A", "B"];

// Spalten und Zeilen im Querformat. Im Hochformat sind beide vertauscht.
const GRIDS = { 12: [4, 3], 16: [4, 4], 20: [5, 4], 24: [6, 4], 30: [6, 5], 36: [6, 6] };

export const MODES = {
  retrigger: "Einmal abspielen (Neustart)",
  oneshot: "Einmal abspielen (überlappend)",
  toggle: "Schleife an/aus",
  hold: "Spielt, solange gedrückt",
};
export const DEFAULT_MODE = "retrigger";

/** Spalten und Zeilen für eine Kachelanzahl. Unbekannte Anzahlen fallen auf die Standardanzahl zurück. */
export function gridFor(count, portrait) {
  const [columns, rows] = GRIDS[count] ?? GRIDS[DEFAULT_COUNT];
  return portrait ? [rows, columns] : [columns, rows];
}

export function padNumber(id) {
  return Number(String(id).slice(3));
}

// Reihenfolge der Tasten der Windows-Version. Sie entspricht den Kacheln 1 bis 16: Numpad 1 bis 9, 0, Punkt, Enter, plus, minus, mal, geteilt.
const LEGACY_ORDER = [
  "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9", "num0",
  "dec", "enter", "add", "sub", "mul", "div",
];

/** Wandelt eine Tasten-Kennung der Windows-Version in eine Kachel um. Kacheln bleiben unverändert, Unbekanntes ergibt null. */
export function toPadId(id) {
  if (PAD_IDS.includes(id)) return id;
  const index = LEGACY_ORDER.indexOf(id);
  return index < 0 ? null : `pad${index + 1}`;
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

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Prüft eine Konfiguration und gibt nur gültige Einträge zurück. Wirft einen Error bei unlesbaren Daten.
 * Konfigurationen der Windows-Version und frühere Fassungen mit Tastennamen werden übernommen, ihre Pfade werden auf den
 * Dateinamen gekürzt und die Tasten auf Kacheln verteilt.
 */
export function normalizeProfile(data) {
  if (!isObject(data) || (data.tasten !== undefined && !isObject(data.tasten))) {
    throw new Error("Keine gültige Drumpad-Konfiguration.");
  }
  const tasten = {};
  for (const [key, entry] of Object.entries(data.tasten ?? {})) {
    const id = toPadId(key);
    if (!id || !isObject(entry) || !entry.datei) continue;
    let volume = Number(entry.lautstaerke ?? 1);
    if (!Number.isFinite(volume)) volume = 1;
    tasten[id] = {
      datei: baseName(entry.datei),
      lautstaerke: Math.min(1, Math.max(0, volume)),
      modus: Object.hasOwn(MODES, entry.modus) ? entry.modus : DEFAULT_MODE,
    };
  }
  return { tasten };
}

export function emptyBanks() {
  return { aktiv: "A", A: { name: "", tasten: {} }, B: { name: "", tasten: {} } };
}

/** Prüft den gespeicherten Zustand der beiden Templates. Fehlerhafte Teile werden durch leere ersetzt. */
export function normalizeBanks(data) {
  const result = emptyBanks();
  if (!isObject(data)) return result;
  for (const bank of BANKS) {
    const part = data[bank];
    if (!isObject(part)) continue;
    try {
      result[bank] = { name: typeof part.name === "string" ? part.name : "", tasten: normalizeProfile(part).tasten };
    } catch {
      // Beschädigter Teil, das Template bleibt leer.
    }
  }
  if (BANKS.includes(data.aktiv)) result.aktiv = data.aktiv;
  return result;
}
