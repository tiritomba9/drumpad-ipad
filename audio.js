// Tonausgabe über die Web Audio API. Entspricht der Klasse Engine der Desktop-Version.

export class Engine {
  /**
   * @param {object} options
   * @param {() => AudioContext} options.createContext erzeugt den Audiokontext
   * @param {(name: string) => Promise<ArrayBuffer|null>} options.getData liefert die Rohdaten eines Sounds
   * @param {(id: string) => ({datei: string, lautstaerke: number, modus: string}|undefined)} options.getEntry Belegung einer Taste
   * @param {(id: string|null) => void} options.onChange meldet geänderten Abspielstatus (null: alles)
   * @param {(name: string) => void} options.onMissing meldet einen Sound, der nicht in der Bibliothek liegt
   */
  constructor({ createContext, getData, getEntry, onChange = () => {}, onMissing = () => {} }) {
    this.createContext = createContext;
    this.getData = getData;
    this.getEntry = getEntry;
    this.onChange = onChange;
    this.onMissing = onMissing;
    this.ctx = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.voices = new Set();
    this.byPad = new Map();
    this.held = new Set();
    this.previewVoice = null;
  }

  context() {
    this.ctx ??= this.createContext();
    return this.ctx;
  }

  /** Muss synchron in einer Berührung oder einem Tastendruck laufen, sonst bleibt der Kontext auf iPadOS stumm. */
  unlock() {
    const ctx = this.context();
    if (ctx.state !== "running") ctx.resume?.();
  }

  async prepare(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.loading.has(name)) return this.loading.get(name);
    const task = (async () => {
      const data = await this.getData(name);
      if (!data) {
        this.onMissing(name);
        return null;
      }
      const buffer = await this.context().decodeAudioData(data);
      this.buffers.set(name, buffer);
      return buffer;
    })().finally(() => this.loading.delete(name));
    this.loading.set(name, task);
    return task;
  }

  /** Verwirft den dekodierten Sound, etwa nach dem Ersetzen oder Löschen der Datei. */
  invalidate(name) {
    this.buffers.delete(name);
  }

  async preload(names) {
    await Promise.all([...new Set(names)].map((name) => this.prepare(name).catch(() => null)));
  }

  isPlaying(id) {
    return this.byPad.has(id);
  }

  press(id) {
    this.unlock();
    this.held.add(id);
    const entry = this.getEntry(id);
    if (!entry) return;
    const buffer = this.buffers.get(entry.datei);
    if (buffer) {
      this.start(id, entry, buffer);
      return;
    }
    // Sound noch nicht dekodiert: laden und danach starten. Im Modus "hold" nur, wenn die Taste noch gehalten wird.
    this.prepare(entry.datei).then((loaded) => {
      if (loaded && (entry.modus !== "hold" || this.held.has(id))) this.start(id, entry, loaded);
    }).catch(() => this.onMissing(entry.datei));
  }

  release(id) {
    this.held.delete(id);
    const entry = this.getEntry(id);
    if (entry?.modus === "hold") this.stopPad(id);
  }

  start(id, entry, buffer) {
    const current = this.byPad.get(id);
    if (entry.modus === "toggle" && current) {
      this.stopPad(id);
      return;
    }
    if (entry.modus === "retrigger" && current) this.stopPad(id);
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = entry.modus === "toggle" || entry.modus === "hold";
    const gain = ctx.createGain();
    gain.gain.value = entry.lautstaerke;
    source.connect(gain);
    gain.connect(ctx.destination);
    const voice = { id, source, gain };
    this.voices.add(voice);
    this.byPad.set(id, voice);
    source.onended = () => {
      this.voices.delete(voice);
      if (this.byPad.get(id) === voice) this.byPad.delete(id);
      this.onChange(id);
    };
    source.start(0);
    this.onChange(id);
  }

  stopPad(id) {
    const voice = this.byPad.get(id);
    if (!voice) return;
    this.byPad.delete(id);
    try {
      voice.source.stop();
    } catch {
      // Die Quelle war bereits beendet.
    }
    this.onChange(id);
  }

  stopAll() {
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // Die Quelle war bereits beendet.
      }
    }
    this.byPad.clear();
    this.held.clear();
    this.onChange(null);
  }

  setVolume(id, volume) {
    const voice = this.byPad.get(id);
    if (voice) voice.gain.gain.value = volume;
  }

  /** Spielt einen Sound aus der Bibliothek einmal ab, ein laufender Probehörer wird dabei beendet. */
  async preview(name) {
    this.unlock();
    const buffer = await this.prepare(name);
    if (!buffer) return;
    try {
      this.previewVoice?.stop();
    } catch {
      // Der vorige Probehörer war bereits beendet.
    }
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    this.previewVoice = source;
  }
}
