import { NavLink } from 'react-router-dom';

export interface TabItem {
  to: string;
  label: string;
  end?: boolean;
}

// Generic nav-tabs strip driven by React Router's own active-match logic
// (NavLink), so the seller/admin dashboards don't hand-roll "is this the
// current route" checks per page.
export function Tabs({ items }: { items: TabItem[] }) {
  return (
    <nav className="ui-tabs" aria-label="Section">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `ui-tabs__link${isActive ? ' ui-tabs__link--active' : ''}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
