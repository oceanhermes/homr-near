import React, { useMemo, useState } from 'react';
import AppNavbar from './AppNavbar';

function NavIcon({ name }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    property: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M9.5 20v-6h5v6" /></>,
    auction: <><path d="m6 8 6-6 4 4-6 6z" /><path d="m11 7 7 7" /><path d="M13 18h8" /><path d="M3 22h12" /></>,
    loan: <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M9 12h7M9 16h7" /></>,
    repayment: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /><path d="M8 12h5M11 9v6" /></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
    capital: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>,
    investments: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    applications: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    approvals: <><path d="M12 3 4 7v5c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V7z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    bids: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="18" r="2" /></>,
    monitoring: <><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    audit: <><path d="M12 3 4 7v5c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V7z" /><path d="M9 12h6M12 9v6" /></>
  };

  return (
    <svg className="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.overview}
    </svg>
  );
}

export function AppLayout({
  roleLabel,
  navItems,
  activeSection,
  onSectionChange,
  workflowLabel,
  workflowDetail,
  children
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const groupedItems = useMemo(() => navItems.reduce((groups, item) => {
    const group = item.group || 'Workspace';
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
    return groups;
  }, {}), [navItems]);

  const selectSection = (sectionId) => {
    onSectionChange(sectionId);
    setMenuOpen(false);
    requestAnimationFrame(() => document.querySelector('#dashboard-main')?.focus());
  };

  return (
    <div className="dashboard-app">
      <a className="skip-link" href="#dashboard-main">Skip to dashboard content</a>
      <AppNavbar
        roleLabel={roleLabel}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((value) => !value)}
      />

      <div className="dashboard-frame">
        <aside
          id="dashboard-sidebar"
          className={`dashboard-sidebar${menuOpen ? ' is-open' : ''}`}
          aria-label={`${roleLabel} navigation`}
        >
          <div className="dashboard-sidebar__scroll">
            {Object.entries(groupedItems).map(([group, items]) => (
              <section className="dashboard-nav-group" key={group} aria-labelledby={`nav-${group.replace(/\s+/g, '-').toLowerCase()}`}>
                <h2 id={`nav-${group.replace(/\s+/g, '-').toLowerCase()}`}>{group}</h2>
                <div className="dashboard-nav-list">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`dashboard-nav-item${activeSection === item.id ? ' is-active' : ''}`}
                      aria-current={activeSection === item.id ? 'page' : undefined}
                      onClick={() => selectSection(item.id)}
                    >
                      <NavIcon name={item.icon || item.id} />
                      <span className="dashboard-nav-item__label">{item.label}</span>
                      {item.meta && <small>{item.meta}</small>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="dashboard-sidebar__status">
            <span className="dashboard-sidebar__status-dot" aria-hidden="true" />
            <div>
              <span>Current stage</span>
              <strong>{workflowLabel}</strong>
              <p>{workflowDetail}</p>
            </div>
          </div>
        </aside>

        {menuOpen && <button className="dashboard-sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

        <main id="dashboard-main" className="dashboard-main" tabIndex="-1">
          <div key={activeSection} className="dashboard-section">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
