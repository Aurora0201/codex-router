export class SessionActivityRegistry {
  private readonly counts = new Map<string, number>();

  begin(routingKey: string): () => void {
    this.counts.set(routingKey, (this.counts.get(routingKey) ?? 0) + 1);
    return () => {
      const next = (this.counts.get(routingKey) ?? 1) - 1;
      if (next <= 0) this.counts.delete(routingKey);
      else this.counts.set(routingKey, next);
    };
  }

  count(routingKey: string): number {
    return this.counts.get(routingKey) ?? 0;
  }
}
