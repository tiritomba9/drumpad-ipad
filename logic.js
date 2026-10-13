// Reine Logik ohne Browser-Schnittstellen: Tastenlayout, Modi und Prüfung von Konfigurationen.

export const KEY_IDS = [
  "div", "mul", "sub", "add", "dec", "enter",
  "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9",
];

export const LABELS = {
  div: "/", mul: "*", sub: "-", add: "+", dec: ".", enter: "Enter",
  num0: "0", num1: "1", num2: "2", num3: "3", num4: "4", num5: "5", num6: "6", num7: "7", num8: "8", num9: "9",
};

// Taste, Zeile, Spalte, Zeilen, Spalten (1-basiert). Das Raster bildet ein Numpad mit vier Spalten und fünf Zeilen nach.
export const LAYOUT = [
  ["div", 1, 1, 1, 1], ["mul", 1, 2, 1, 1], ["sub", 1, 3, 1, 1],
  ["num7", 2, 1, 1, 1], ["num8", 2, 2, 1, 1], ["num9", 2, 3, 1, 1], ["add", 2, 4, 2, 1],
  ["num4", 3, 1, 1, 1], ["num5", 3, 2, 1, 1], ["num6", 3, 3, 1, 1],
  ["num1", 4, 1, 1, 1], ["num2", 4, 2, 1, 1], ["num3", 4, 3, 1, 1], ["enter", 4, 4, 2, 1],
  ["num0", 5, 1, 1, 2], ["dec", 5, 3, 1, 1],
];

export const MODES = {
  retrigger: "Einmal abspielen (Neustart)",
  oneshot: "Einmal abspielen (überlappend)",
  toggle: "Schleife an/aus",
  hold: "Spielt, solange gedrückt",
};
export const DEFAULT_MODE = "retrigger";

// Tasten einer angeschlossenen Hardware-Tastatur, nur wirksam bei aktiver App.
export const CODE_TO_KEY = {
  Numpad0: "num0", Numpad1: "num1", Numpad2: "num2", Numpad3: "num3", Numpad4: "num4",
  Numpad5: "num5", Numpad6: "num6", Numpad7: "num7", Numpad8: "num8", Numpad9: "num9",
  NumpadDecimal: "dec", NumpadAdd: "add", NumpadSubtract: "sub", NumpadMultiply: "mul",
  NumpadDivide: "div", NumpadEnter: "enter",
};

const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus"];

/** Dateiname ohne Ordneranteil, auch bei Windows-Pfaden aus der Desktop-Version. */
export function baseName(path) {
  return String(path).split(/[\\/]/).pop();
}

/** Dateiname ohne Endung, für die Beschriftung der Pads. */
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

/**
 * Prüft eine Konfiguration und gibt nur gültige Einträge zurück. Wirft einen Error bei unlesbaren Daten.
 * Konfigurationen der Desktop-Version werden übernommen, ihre Pfade werden auf den Dateinamen gekürzt.
 */
export function normalizeProfile(data) {
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(data) || (data.tasten !== undefined && !isObject(data.tasten))) {
    throw new Error("Keine gültige Drumpad-Konfiguration.");
  }
  const tasten = {};
  for (const [id, entry] of Object.entries(data.tasten ?? {})) {
    if (!KEY_IDS.includes(id) || !isObject(entry) || !entry.datei) continue;
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
