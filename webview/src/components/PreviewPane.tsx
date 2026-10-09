import type { PreviewResult, SandboxViewState } from '../../../src/shared/protocol';

interface PreviewPaneProps {
  preview: PreviewResult | undefined;
  previewStale: boolean;
  sandbox?: SandboxViewState;
  onShowFile: (path: string) => void;
  onBack: () => void;
}

export function PreviewPane({
  preview,
  previewStale,
  sandbox,
  onShowFile,
  onBack,
}: PreviewPaneProps) {
  return (
    <div className="wizard" style={{ margin: 0, width: '100%' }}>
      <h1>Generated source preview</h1>
      {!preview ? (
        <p className="lead">
          Preview is not available. Run Preview output to inspect proposed files.
        </p>
      ) : (
        <>
          <p className="lead">
            {preview.mode === 'on'
              ? `Sandbox profile${preview.namespace ? ` ${preview.namespace}` : ''}`
              : 'Full project'}
            {' · '}
            {preview.environment ?? sandbox?.environment ?? 'selected environment'}. Select a file
            to open its read-only preview in VS Code.
          </p>
          {preview.parity === 'source-only' && (
            <div className="notice">
              Source-only preview. It does not include the final bundle, monitoring files, wheel, or
              every managed resource under resources/lhp.
            </div>
          )}
          {previewStale && (
            <div className="notice warn" role="status">
              Project documents or generation scope changed after this preview. Run Preview source
              again before relying on these files.
            </div>
          )}
          {preview.notices.map((item, index) => (
            <div className="notice warn" key={index}>
              {item}
            </div>
          ))}
          {preview.files.length === 0 && (
            <div className="notice">No preview files were returned.</div>
          )}
          {preview.files.map((file) => (
            <button className="link-button" key={file.path} onClick={() => onShowFile(file.path)}>
              {file.path} <span className="badge">{file.kind}</span>
            </button>
          ))}
        </>
      )}
      <button className="button secondary small" onClick={() => onBack()}>
        Back to graph
      </button>
    </div>
  );
}
