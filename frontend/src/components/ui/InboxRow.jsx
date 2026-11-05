import React from 'react';
import DataLabelChip from './DataLabelChip';

export function InboxRow({
  statusDotColor = 'var(--primary)',
  title,
  subtitle,
  dataType = 'onchain',
  customRight,
  shortcutHint,
  onClick,
  isSelected = false
}) {
  return (
    <div onClick={onClick} className={`inbox-row${isSelected ? ' is-selected' : ''}${onClick ? ' is-clickable' : ''}`}>
      <div className="inbox-row__main">
        {statusDotColor && (
          <span className="inbox-row__dot" style={{ backgroundColor: statusDotColor }} />
        )}
        <div className="inbox-row__copy">
          <div className="inbox-row__title">
            <span>{title}</span>
            {shortcutHint && (
              <span className="inbox-row__shortcut">
                {shortcutHint}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="inbox-row__subtitle">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      <div className="inbox-row__aside">
        {customRight}
        {dataType && <DataLabelChip type={dataType} />}
      </div>
    </div>
  );
}

export default InboxRow;
