export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Buffer each bounded UTF-8 frame once; never rescan/copy the accumulated JSON
 * for every stdout chunk. JSON may span many operating-system pipe reads. */
export class NdjsonDecoder {
  private parts: Buffer[] = [];
  private bytes = 0;
  constructor(private readonly limit = MAX_RESPONSE_BYTES) {}

  push(chunk: Buffer, receive: (line: string) => boolean): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      if (this.bytes + part.length > this.limit)
        throw new Error('LHP response exceeds the 32 MiB decoded transport budget.');
      this.parts.push(part);
      this.bytes += part.length;
      if (newline < 0) return;
      const frame = Buffer.concat(this.parts, this.bytes);
      this.parts = [];
      this.bytes = 0;
      const line = new TextDecoder('utf-8', { fatal: true }).decode(frame);
      if (line.trim() && !receive(line)) return;
      offset = newline + 1;
    }
  }

  get incomplete(): boolean {
    return this.bytes > 0;
  }
}
