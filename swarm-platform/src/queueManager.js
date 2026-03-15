export class QueueManager {
  constructor() {
    this.items = [];
  }

  enqueue(item) {
    this.items.push({ ...item, enqueuedAt: Date.now() });
    this.items.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
  }

  dequeue() {
    return this.items.shift();
  }

  get depth() {
    return this.items.length;
  }

  clearExpired(maxAgeMs = 300000) {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.items.length;
    this.items = this.items.filter((i) => i.enqueuedAt > cutoff);
    return before - this.items.length;
  }
}
