import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { terminateProcessTree } from './processTree';
import { isJsonValue, isRecord } from './shared/guards';
import { NdjsonDecoder } from './ndjson';
import {
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeOperation,
  type JsonObject,
  type JsonValue,
  type DocumentOverlay,
} from './shared/protocol';

export interface BridgeCall {
  operation: BridgeOperation;
  interpreter: string;
  projectRoot?: string;
  environment?: string;
  documents?: DocumentOverlay[];
  options?: JsonObject;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: JsonObject) => void;
}
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
/** One isolated request per Python process avoids stale module/project state.
 * shell=false and a fixed bundled entrypoint prevent command interpolation. */
export class BridgeClient {
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  constructor(
    private readonly script: string,
    private readonly log: (message: string) => void,
  ) {}
  async call(call: BridgeCall): Promise<JsonValue> {
    if (call.signal?.aborted) throw new BridgeError('CANCELLED', 'Operation cancelled.');
    const id = randomUUID();
    const request: BridgeRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id,
      operation: call.operation,
      projectRoot: call.projectRoot,
      environment: call.environment,
      documents: call.documents,
      options: call.options,
    };
    return new Promise((resolve, reject) => {
      const child = spawn(call.interpreter, ['-u', this.script], {
        cwd: call.operation === 'init' ? undefined : call.projectRoot,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, PYTHONUNBUFFERED: '1', LHP_NO_CACHE: '1', LHP_TELEMETRY: 'off' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.children.add(child);
      let settled = false;
      const decoder = new NdjsonDecoder();
      let stderr = '';
      const finish = (error?: Error, result?: JsonValue): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        call.signal?.removeEventListener('abort', abort);
        void terminateProcessTree(child).then(
          () => {
            this.children.delete(child);
            if (error) reject(error);
            else resolve(result ?? null);
          },
          (shutdown) => {
            this.children.delete(child);
            reject(
              new BridgeError(
                'PROCESS_SHUTDOWN',
                shutdown instanceof Error ? shutdown.message : 'Python process tree did not close.',
              ),
            );
          },
        );
      };
      const abort = (): void => finish(new BridgeError('CANCELLED', 'Operation cancelled.'));
      const timeout = setTimeout(
        () =>
          finish(
            new BridgeError(
              'TIMEOUT',
              'LHP operation timed out. Check the selected interpreter and project.',
            ),
          ),
        call.timeoutMs ?? 180000,
      );
      call.signal?.addEventListener('abort', abort, { once: true });
      if (call.signal?.aborted) abort();
      child.on('error', (error) =>
        finish(new BridgeError('PYTHON_START', `Could not start Python: ${error.message}`)),
      );
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        stderr = (stderr + data).slice(-8192);
      });
      child.stdout.on('data', (data: Buffer) => {
        if (settled) return;
        try {
          decoder.push(data, (line) => {
            const envelope: unknown = JSON.parse(line);
            if (
              !isRecord(envelope) ||
              envelope.protocolVersion !== PROTOCOL_VERSION ||
              envelope.id !== id
            )
              throw new Error('Mismatched response.');
            // Responses are already byte-bounded. The webview request array cap
            // is unrelated to canonical project graph size (often >10k nodes).
            if (envelope.type === 'result' && isJsonValue(envelope.result, 0, Infinity))
              finish(undefined, envelope.result);
            else if (
              envelope.type === 'event' &&
              isRecord(envelope.event) &&
              isJsonValue(envelope.event, 0, Infinity)
            )
              call.onEvent?.(envelope.event as JsonObject);
            else if (
              envelope.type === 'error' &&
              typeof envelope.code === 'string' &&
              typeof envelope.message === 'string'
            )
              finish(new BridgeError(envelope.code, envelope.message));
            else throw new Error('Unexpected response envelope.');
            return !settled;
          });
        } catch (error) {
          const limited = error instanceof Error && error.message.includes('transport budget');
          finish(
            new BridgeError(
              limited ? 'PROTOCOL_LIMIT' : 'PROTOCOL_ERROR',
              limited ? error.message : 'Python returned an invalid structured response.',
            ),
          );
        }
      });
      child.on('close', (code) => {
        if (!settled) {
          // Python tracebacks can contain configuration; keep them out of the UI/log.
          this.log(
            `Bridge ${call.operation} exited ${code ?? 'unknown'} before a result (${stderr.length} stderr characters).`,
          );
          finish(
            new BridgeError(
              decoder.incomplete ? 'PROTOCOL_ERROR' : 'PYTHON_EXIT',
              decoder.incomplete
                ? 'Python returned an incomplete structured response.'
                : 'Python exited before completing the operation. Verify the compatible LHP installation.',
            ),
          );
        }
      });
      child.stdin.on('error', (error) =>
        finish(
          new BridgeError('PYTHON_INPUT', `Could not send request to Python: ${error.message}`),
        ),
      );
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
  dispose(): void {
    for (const child of this.children)
      void terminateProcessTree(child).catch((error) =>
        this.log(error instanceof Error ? error.message : 'Python shutdown failed.'),
      );
    this.children.clear();
  }
}
