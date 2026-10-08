import * as vscode from 'vscode';
import { BridgeError } from './bridgeClient';
import type { OperationStatus } from './shared/protocol';

/** Serialises process lifetime, including cancellation shutdown, across all operations. */
export class OperationQueue {
  private operation?: {
    controller: AbortController;
    operation: OperationStatus['operation'];
    completion: Promise<void>;
  };
  private shutdownFailed = false;
  constructor(private readonly publish: (status: OperationStatus) => void) {}
  get running(): boolean {
    return !!this.operation;
  }
  get kind(): OperationStatus['operation'] | undefined {
    return this.operation?.operation;
  }
  cancel(): void {
    this.operation?.controller.abort();
  }
  async run<T>(
    operation: OperationStatus['operation'],
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.shutdownFailed)
      throw new Error(
        'The previous Python process could not be stopped. Restart VS Code after stopping it before running another operation.',
      );
    while (this.operation) {
      const previous = this.operation;
      if (previous.operation === 'snapshot' || previous.controller.signal.aborted) {
        previous.controller.abort();
        await previous.completion;
        if (this.shutdownFailed) throw new Error('The previous Python process did not close.');
      } else
        throw new Error('An LHP operation is already running. Cancel it before starting another.');
    }
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const current = { controller: new AbortController(), operation, completion };
    this.operation = current;
    let failed = false;
    this.publish({ operation, running: true, message: `LHP ${operation}…` });
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `LHP ${operation}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const disposable = token.onCancellationRequested(() => current.controller.abort());
          try {
            return await task(current.controller.signal);
          } finally {
            disposable.dispose();
          }
        },
      );
    } catch (error) {
      failed = !current.controller.signal.aborted;
      if (error instanceof BridgeError && error.code === 'PROCESS_SHUTDOWN') {
        this.shutdownFailed = true;
        throw error;
      }
      if (!current.controller.signal.aborted) throw error;
      return undefined;
    } finally {
      if (this.operation === current) {
        this.operation = undefined;
        this.publish({
          operation,
          running: false,
          message: this.shutdownFailed
            ? 'Python shutdown failed.'
            : current.controller.signal.aborted
              ? 'Operation cancelled.'
              : failed
                ? 'Operation failed.'
                : 'Ready.',
        });
      }
      complete();
    }
  }
}
