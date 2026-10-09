import * as path from 'node:path';
import { items, record, text } from './catalog';
import { relativePath } from './paths';
import type { ProjectSnapshot, ResourceConsumer } from './shared/protocol';

export function generatedProvenance(
  root: string,
  response: unknown,
  snapshot: ProjectSnapshot,
): Record<string, ResourceConsumer[]> {
  const result: Record<string, ResourceConsumer[]> = {};
  const batch = record(response);
  for (const [pipeline, raw] of Object.entries(record(batch.pipeline_responses))) {
    const value = record(raw);
    if (value.success !== true) continue;
    if (record(batch.editor_packaging)[pipeline] !== 'source') continue;
    const output = text(value.output_location, text(batch.output_location));
    if (!output) continue;
    for (const filename of items(value.generated_filenames)) {
      if (typeof filename !== 'string' || path.extname(filename) !== '.py') continue;
      // Source-mode public filenames are exactly <flowgroup>.py. Require a
      // unique pipeline/name match; wheel runners and aggregate outputs do not
      // gain a source link merely because they share the pipeline directory.
      const matches = snapshot.flowgroups.filter(
        (group) => group.pipeline === pipeline && `${group.name}.py` === path.basename(filename),
      );
      if (matches.length !== 1) continue;
      const group = matches[0]!;
      const sources = [
        {
          label: `${pipeline} / ${group.name}`,
          source: group.source,
          pipeline,
          flowgroupId: group.id,
        },
      ];
      // Public output_location is the environment root; source-mode writers
      // place each bare flowgroup filename inside its pipeline directory.
      const absolute = path.isAbsolute(filename)
        ? filename
        : path.resolve(output, pipeline, filename);
      const relative = relativePath(root, absolute);
      if (relative && sources.length) result[relative] = sources;
    }
  }
  return result;
}
