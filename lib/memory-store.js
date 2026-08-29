// lib/memory-store.js
// Персистентность долговременной памяти (memory.json) поверх MemStore из memory.js.
// Zero deps, corrupt-safe (аналогично state.json/cache.json).

const fs = require('fs');
const path = require('path');
const { MemStore } = require('./memory');

const DEFAULT_PATH = path.join(__dirname, '..', 'memory.json');
const TRANSACTION_SUFFIX = '.tmp';

class MemoryStore extends MemStore {
  constructor(opts = {}) {
    const capacity = opts.capacity ?? 800;
    super(capacity);
    this.filePath = opts.filePath || DEFAULT_PATH;
    this.saveTimeout = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.facts)) {
        const entries = data.facts.map(f => ({ text: f.text, sourceHash: f.sourceHash, created: f.created, access: f.access }));
        const added = this.import(entries);
        if (added > 0 && entries.length !== added) {
          // частичная дедупликация при загрузке — норм
        }
      }
    } catch (err) {
      // отсутствует или битый файл → пустой старт, не падаем
    }
  }

  save() {
    try {
      const facts = this._facts.map(f => ({
        text: f.text,
        sourceHash: f.sourceHash || null,
        created: f.created,
        access: f.access,
      }));
      const payload = JSON.stringify({ version: 1, saved: Date.now(), facts }, null, 2);
      const tmp = this.filePath + TRANSACTION_SUFFIX;
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, this.filePath); // atomic-ish write
      return true;
    } catch (err) {
      try { fs.unlinkSync(this.filePath + TRANSACTION_SUFFIX); } catch {}
      return false;
    }
  }

  // Debounce: не писать на каждый add — асинхронный приверженный по таймеру.
  scheduleSave(delayMs = 10000) {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => { this.saveTimeout = null; this.save(); }, delayMs);
    if (this.saveTimeout.unref) this.saveTimeout.unref();
  }

  stopTimer() {
    if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
  }
}

module.exports = { create: (opts) => new MemoryStore(opts || {}), MemoryStore, DEFAULT_PATH };