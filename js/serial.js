// Web Serial wrapper: frames Yaesu CAT messages on ';'

export class SerialLink extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buf = '';
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
    this.closing = false;
    this._loop = null;
  }

  get isOpen() { return !!this.writer; }

  async open(port, baudRate, { framed = true, stopBits = 1 } = {}) {
    await port.open({ baudRate, dataBits: 8, stopBits, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    this.port = port;
    this.framed = framed;
    this.closing = false;
    this.buf = '';
    this.writer = port.writable.getWriter();
    if (framed) this._loop = this._readLoop();
  }

  async _readLoop() {
    while (this.port?.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) { this.rawTap?.(value); this._ingest(this.dec.decode(value, { stream: true })); }
        }
      } catch (e) {
        if (!this.closing) this.dispatchEvent(new CustomEvent('error', { detail: e }));
      } finally {
        try { this.reader.releaseLock(); } catch {}
        this.reader = null;
      }
    }
    // readable disappeared without close(): device was unplugged
    if (!this.closing) await this._teardown();
  }

  _ingest(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf(';')) >= 0) {
      const msg = this.buf.slice(0, i).replace(/[\r\n\0]/g, '').trim();
      this.buf = this.buf.slice(i + 1);
      if (msg) this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    }
    if (this.buf.length > 1024) this.buf = '';
  }

  async write(str) {
    if (!this.writer) throw new Error('port not open');
    await this.writer.write(this.enc.encode(str));
  }

  async setSignals(sig) {
    if (this.port) await this.port.setSignals(sig);
  }

  async close() {
    if (!this.port || this.closing) return;
    this.closing = true;
    try { await this.reader?.cancel(); } catch {}
    try { await this._loop; } catch {}
    await this._teardown();
  }

  async _teardown() {
    this.closing = true;
    try { this.writer?.releaseLock(); } catch {}
    this.writer = null;
    try { await this.port?.close(); } catch {}
    this.port = null;
    this._loop = null;
    this.dispatchEvent(new Event('close'));
  }
}
