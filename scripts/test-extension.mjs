import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const python = process.env.LHP_TEST_PYTHON;
if (!python) throw new Error('Set LHP_TEST_PYTHON to the compatible integration interpreter.');
const workspace = path.resolve('.tmp/extension-workspace');
await rm(workspace, { recursive: true, force: true });
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await mkdir(path.join(workspace, 'pipelines'), { recursive: true });
await mkdir(path.join(workspace, 'blueprints'), { recursive: true });
await mkdir(path.join(workspace, 'config'), { recursive: true });
await writeFile(path.join(workspace, 'lhp.yaml'), 'name: extension_host_test\nversion: "1.0"\n');
await writeFile(
  path.join(workspace, 'databricks.yml'),
  'bundle:\n  name: extension_host_test\ninclude:\n  - resources/lhp/*.yml\ntargets:\n  dev:\n    mode: development\n    default: true\n',
);
await writeFile(
  path.join(workspace, 'config/pipeline_config.yaml'),
  'project_defaults:\n  serverless: true\n  channel: CURRENT\n  catalog: main\n  schema: bronze\n',
);
await writeFile(
  path.join(workspace, 'pipelines/orders.yaml'),
  'pipeline: bronze\nflowgroup: orders\nactions:\n  - name: load_orders\n    type: load\n    source:\n      type: cloudfiles\n      path: /Volumes/main/landing/orders/*.json\n      format: json\n    target: v_orders\n  - name: write_orders\n    type: write\n    source: v_orders\n    write_target:\n      type: streaming_table\n      catalog: main\n      schema: bronze\n      table: orders\n---\npipeline: bronze\nflowgroup: document_second\nactions:\n  - name: load_second\n    type: load\n    source:\n      type: cloudfiles\n      path: /Volumes/main/landing/second/*.json\n      format: json\n    target: v_second\n  - name: write_second\n    type: write\n    source: v_second\n    write_target:\n      type: streaming_table\n      catalog: main\n      schema: bronze\n      table: second\n',
);
await writeFile(
  path.join(workspace, 'blueprints/simple.yaml'),
  'name: simple_blueprint\nparameters:\n  - name: site_name\n    required: true\nflowgroups:\n  - pipeline: bronze\n    flowgroup: "%{site_name}_sample"\n    actions:\n      - name: "load_%{site_name}"\n        type: load\n        source:\n          type: cloudfiles\n          path: "/Volumes/main/landing/%{site_name}/*.json"\n          format: json\n        target: "v_%{site_name}"\n      - name: "write_%{site_name}"\n        type: write\n        source: "v_%{site_name}"\n        write_target:\n          type: streaming_table\n          catalog: main\n          schema: bronze\n          table: "%{site_name}_sample"\n',
);
await writeFile(
  path.join(workspace, 'pipelines/blueprint.yaml'),
  'use_blueprint: simple_blueprint\nparameters:\n  site_name: alpha\n',
);
await writeFile(
  path.join(workspace, '.vscode/settings.json'),
  JSON.stringify({
    'lhp.pythonPath': python,
    'lhp.pipelineConfigPath': 'config/pipeline_config.yaml',
    'lhp.autoValidate': false,
    'security.workspace.trust.enabled': false,
  }),
);
await mkdir(path.join(workspace, 'templates'), { recursive: true });
await mkdir(path.join(workspace, 'presets'), { recursive: true });
await writeFile(
  path.join(workspace, 'templates/reader.yaml'),
  'name: reader\nparameters: []\nactions: []\n',
);
await writeFile(
  path.join(workspace, 'presets/common.yaml'),
  'name: common\ndefaults:\n  readMode: stream\n',
);
const version = process.env.VSCODE_TEST_VERSION || '1.106.0';
const executable = await downloadAndUnzipVSCode(version);
const extensions = path.resolve('.vscode-test/extensions');
const userData = path.resolve('.vscode-test/user-data');
const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
// Pin the vendor's own release VSIX so tests do not depend on Marketplace search.
const yamlVsix = path.resolve('.tmp/yaml-extension/vscode-yaml-1.24.0-298.vsix');
await mkdir(path.dirname(yamlVsix), { recursive: true });
let yamlBytes;
try {
  yamlBytes = await readFile(yamlVsix);
} catch {
  const response = await fetch(
    'https://github.com/redhat-developer/vscode-yaml/releases/download/1.24.0/vscode-yaml-1.24.0-298.vsix',
  );
  if (!response.ok) throw new Error(`Could not download official YAML VSIX: ${response.status}`);
  yamlBytes = Buffer.from(await response.arrayBuffer());
  await writeFile(yamlVsix, yamlBytes);
}
if (
  createHash('sha256').update(yamlBytes).digest('hex') !==
  '0668758312a7fa6beda259ca5a6849d90c5d519df6415edbe246c135e06d7168'
)
  throw new Error('YAML VSIX checksum mismatch.');
const installed = spawnSync(
  cli,
  [
    ...cliArgs,
    '--install-extension',
    yamlVsix,
    '--force',
    '--extensions-dir',
    extensions,
    '--user-data-dir',
    userData,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (installed.status !== 0)
  throw new Error('Could not install the real Red Hat YAML test dependency.');
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: root,
  extensionTestsPath: path.resolve(
    process.env.LHP_PERF_PROJECT ? 'out/performance-tests.cjs' : 'out/extension-tests.cjs',
  ),
  launchArgs: [
    workspace,
    '--no-sandbox',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--extensions-dir',
    extensions,
    '--user-data-dir',
    userData,
  ],
  extensionTestsEnv: {
    LHP_TEST_PYTHON: python,
    ...(process.env.LHP_PERF_PROJECT ? { LHP_PERF_PROJECT: process.env.LHP_PERF_PROJECT } : {}),
  },
});
