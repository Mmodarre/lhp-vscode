import { useId, useState } from 'react';

export function ProjectNotices({ notices }: { notices: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  if (notices.length === 0) return null;
  return (
    <div className="notice project-notices">
      <div className="project-notices-heading">
        <span>
          <strong>
            {notices.length} project notice{notices.length === 1 ? '' : 's'}
          </strong>
          {' · '}Details from LHP are available below.
        </span>
        <button
          className="button quiet small"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {expanded && (
        <div
          id={detailsId}
          className="project-notices-details"
          role="region"
          aria-label="Project notices"
          tabIndex={0}
        >
          <ul>
            {notices.map((notice, index) => (
              <li key={`${index}-${notice}`}>{notice}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
