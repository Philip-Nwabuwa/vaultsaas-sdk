export class BatchBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly maxSize: number) {}

  push(item: T): T[] | null {
    this.items.push(item);
    if (this.items.length >= this.maxSize) {
      return this.flush();
    }

    return null;
  }

  flush(): T[] {
    const snapshot = [...this.items];
    this.items.length = 0;
    return snapshot;
  }

  size(): number {
    return this.items.length;
  }
}
