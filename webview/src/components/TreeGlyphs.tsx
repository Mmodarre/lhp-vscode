export function PipelineGlyph() {
  return (
    <svg className="tree-glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.3 2.2v3.9a6.5 6.5 0 0 0 6.5 6.5h2.2M5.2 2.2v3.9a3.6 3.6 0 0 0 3.6 3.6H11"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m11.2 9.8 1.5-.7 1.5.7v2.4l-1.5.7-1.5-.7V9.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="m11.2 9.8 1.5.8 1.5-.8m-1.5.8v2.3"
        stroke="currentColor"
        strokeWidth=".85"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FlowgroupGlyph() {
  return (
    <svg className="tree-glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 2.1H2.4v11.8h2.1"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="5.2"
        y="2.9"
        width="8"
        height="3.3"
        rx=".8"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9.2 6.2v3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect
        x="5.2"
        y="9.8"
        width="8"
        height="3.3"
        rx=".8"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
