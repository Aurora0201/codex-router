export class AccountOperationLock {
  private readonly pending = new Map<string, Promise<unknown>>();

  async drain(): Promise<void> {
    // Owners stop producing before draining. A task may still enqueue its
    // final cleanup while we wait for the current snapshot.
    while (this.pending.size > 0) await Promise.allSettled([...this.pending.values()]);
  }

  run<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.pending.set(accountId, next);
    void next.finally(() => {
      if (this.pending.get(accountId) === next) this.pending.delete(accountId);
    }).catch(() => undefined);
    return next;
  }
}
