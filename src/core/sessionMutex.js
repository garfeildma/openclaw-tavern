export class SessionMutex {
  constructor() {
    this.chains = new Map();
  }

  async run(sessionId, fn) {
    const previous = this.chains.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);

    this.chains.set(sessionId, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.chains.get(sessionId) === tail) {
        this.chains.delete(sessionId);
      }
    }
  }
}
