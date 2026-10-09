import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/bridgeClient';
import { NdjsonDecoder, MAX_RESPONSE_BYTES } from '../../src/ndjson';
import { isJsonValue } from '../../src/shared/guards';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';

describe('bounded large responses', () => {
  it('decodes fragmented Unicode and multiple frames without losing bytes', () => {
    const value = JSON.stringify({
      text: 'α漢😀',
      nodes: Array.from({ length: 20000 }, (_, i) => i),
    });
    const bytes = Buffer.from(`${value}\n{}\n`);
    const decoder = new NdjsonDecoder();
    const lines: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 7)
      decoder.push(bytes.subarray(offset, offset + 7), (line) => {
        lines.push(line);
        return true;
      });
    expect(lines).toEqual([value, '{}']);
    expect(decoder.incomplete).toBe(false);
    expect(isJsonValue(JSON.parse(value), 0, Infinity)).toBe(true);
    expect(isJsonValue(JSON.parse(value))).toBe(false); // Untrusted webview limit remains.
  });

  it('enforces bytes rather than JavaScript character count and rejects invalid UTF-8', () => {
    const decoder = new NdjsonDecoder(8);
    decoder.push(Buffer.from('😀'), () => true);
    expect(() => decoder.push(Buffer.from('😀a'), () => true)).toThrow('budget');
    expect(() => new NdjsonDecoder().push(Buffer.from([0xff, 10]), () => true)).toThrow();
    const truncated = new NdjsonDecoder();
    truncated.push(Buffer.from('{"incomplete":'), () => true);
    expect(truncated.incomplete).toBe(true);
    expect(() =>
      new NdjsonDecoder().push(Buffer.alloc(MAX_RESPONSE_BYTES + 1), () => true),
    ).toThrow('budget');
  });

  it('accepts an actual bridge result above 10,000 graph nodes and rejects mismatched IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lhp-large-transport-'));
    const file = path.join(root, 'response.py');
    const python =
      process.env.LHP_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const client = new BridgeClient(file, () => undefined);
    const previousEncoding = process.env.PYTHONIOENCODING;
    process.env.PYTHONIOENCODING = 'cp1252';
    try {
      await writeFile(
        file,
        `import json,sys\nr=json.loads(sys.stdin.readline())\nprint(json.dumps(dict(protocolVersion=${PROTOCOL_VERSION},id=r['id'],type='result',result=dict(nodes=list(range(20000)),text=r['options']['text'])),ensure_ascii=False))\n`,
      );
      const result = await client.call({
        operation: 'health',
        interpreter: python,
        options: { text: 'α漢😀' },
      });
      expect((result as { nodes: number[] }).nodes).toHaveLength(20000);
      expect((result as { text: string }).text).toBe('α漢😀');
      await writeFile(
        file,
        `import json,sys\nsys.stdin.readline()\nprint(json.dumps(dict(protocolVersion=${PROTOCOL_VERSION},id='another-request',type='result',result={})))\n`,
      );
      await expect(client.call({ operation: 'health', interpreter: python })).rejects.toMatchObject(
        { code: 'PROTOCOL_ERROR' },
      );
      await writeFile(
        file,
        "import sys\nsys.stdin.readline()\nsys.stdout.write('{')\nsys.stdout.flush()\n",
      );
      await expect(client.call({ operation: 'health', interpreter: python })).rejects.toMatchObject(
        { code: 'PROTOCOL_ERROR' },
      );
    } finally {
      if (previousEncoding === undefined) delete process.env.PYTHONIOENCODING;
      else process.env.PYTHONIOENCODING = previousEncoding;
      client.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
