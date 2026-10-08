import type { PreviewResult } from '../../../src/shared/protocol';

interface PreviewPaneProps {
  preview: PreviewResult | undefined;
  previewStale: boolean;
  onShowFile: (path: string) => void;
  onBack: () => void;
}

export function PreviewPane({ preview, previewStale, onShowFile, onBack }: PreviewPaneProps) {
  return (
    <div className="wizard" style={{ margin: 0, width: '100%' }}>
      <h1>Generated output preview</h1>
      {!preview ? (
        <p className="lead">
          Preview is not available. Run Preview output to inspect proposed files.
        </p>
      ) : (
        <>
          <p className="lead">
            {preview.parity === 'full'
              ? 'Full output preview'
              : 'Source-only preview: this does not include every final generated artifact.'}{' '}
            Select a file to open its read-only preview in VS Code.
          </p>
          {previewStale && (
            <div className="notice warn" role="status">
              Project documents changed after this preview. Run Preview output again before relying
              on these files.
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
