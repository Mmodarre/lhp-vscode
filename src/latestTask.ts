/** Reject stale publication while making every caller await its latest successor. */
export class LatestTask {
  private revision = 0;
  private latest?: Promise<void>;

  async run(execute: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const revision = ++this.revision;
    const task = Promise.resolve().then(() => execute(() => revision === this.revision));
    this.latest = task;
    let pending = task;
    for (;;) {
      try {
        await pending;
      } catch (error) {
        // An obsolete lookup must not make a waiting caller miss the current
        // lookup. A failure of the latest task still reaches every waiter.
        if (pending === this.latest) throw error;
      }
      if (pending === this.latest) return;
      pending = this.latest;
    }
  }
}
