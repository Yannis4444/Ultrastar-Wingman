import { NavLink, useLocation } from "react-router-dom";
import "./BottomNav.css";

/** Inline 24x24 paths so the nav needs no icon dependency. */
const TABS = [
  { to: "/", label: "Home", path: "M12 3 21 11h-3v9h-5v-6h-2v6H6v-9H3Z" },
  { to: "/songs", label: "Songs", path: "M12 3v10.6A4 4 0 1 0 14 17V7h4V3Z" },
  {
    to: "/scores",
    label: "Scores",
    path: "M4 20h4V10H4Zm6 0h4V4h-4Zm6 0h4v-7h-4Z",
  },
  {
    to: "/user",
    label: "User",
    path: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z",
  },
] as const;

/** Sub-surfaces without a tab of their own light up the tab they belong to. */
const COVERS: Record<string, string[]> = {
  "/": ["/spinner"],
  "/songs": ["/usdb"],
  "/user": ["/settings"],
};

export default function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav">
      <div>
        {TABS.map(({ to, label, path }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              isActive ||
              (COVERS[to] ?? []).some((prefix) => pathname.startsWith(prefix))
                ? "active"
                : ""
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={path} />
            </svg>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
