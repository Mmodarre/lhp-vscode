import { useState, type FormEvent } from 'react';

export interface FlowgroupValues {
  name: string;
  pipeline: string;
  targetPath: string;
}

export function FlowgroupWizard({
  pipelines,
  busy,
  onCancel,
  onCreate,
}: {
  pipelines: string[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (values: FlowgroupValues) => void;
}) {
  const [name, setName] = useState('');
  const [pipeline, setPipeline] = useState(pipelines[0] ?? '');
  const [targetPath, setTargetPath] = useState('');
  const pathValid =
    !!targetPath &&
    !targetPath.startsWith('/') &&
    !targetPath.includes('\\') &&
    !targetPath.split('/').includes('..') &&
    /\.ya?ml$/i.test(targetPath);
  const canCreate = !!name.trim() && !!pipeline.trim() && pathValid && !busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canCreate)
      onCreate({ name: name.trim(), pipeline: pipeline.trim(), targetPath: targetPath.trim() });
  };
  return (
    <form className="wizard" aria-label="Create flowgroup" onSubmit={submit}>
      <p className="eyebrow">Start a pipeline</p>
      <h1>New flowgroup</h1>
      <p className="lead">
        Create an authored YAML flowgroup, then add load, transform, write and test actions in its
        graph. A pipeline appears when its first flowgroup is created.
      </p>
      <div className="wizard-grid">
        <div className="field">
          <label className="field-label" htmlFor="flowgroup-name">
            Flowgroup name *
          </label>
          <input
            id="flowgroup-name"
            className="input"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="flowgroup-pipeline">
            Pipeline name *
          </label>
          <input
            id="flowgroup-pipeline"
            className="input"
            value={pipeline}
            onChange={(event) => setPipeline(event.target.value)}
            list="flowgroup-pipelines"
            required
          />
          <datalist id="flowgroup-pipelines">
            {pipelines.map((item) => (
              <option value={item} key={item} />
            ))}
          </datalist>
          <span className="field-help">Use an existing pipeline or enter a new name.</span>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="flowgroup-path">
          New YAML path *
        </label>
        <input
          id="flowgroup-path"
          className="input mono"
          value={targetPath}
          onChange={(event) => setTargetPath(event.target.value)}
          placeholder="pipelines/bronze/orders.yaml"
          aria-invalid={!!targetPath && !pathValid}
          required
        />
        <span className="field-help">
          Project-relative .yaml or .yml path. An existing file will never be replaced.
        </span>
        {!!targetPath && !pathValid && (
          <span className="field-error" role="alert">
            Enter a project-relative YAML path without “..” or backslashes.
          </span>
        )}
      </div>
      <div className="wizard-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canCreate}>
          Create flowgroup
        </button>
      </div>
    </form>
  );
}
