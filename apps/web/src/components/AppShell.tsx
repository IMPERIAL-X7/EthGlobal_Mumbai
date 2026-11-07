import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Icon } from "./Icon";

/** Design 5B: dark sidebar (collapsible to icons, remembered per browser) + content + optional right rail. */
export function AppShell({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("leash.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [pending, setPending] = useState(0);
  const [owner, setOwner] = useState<string | null>(null);

  useEffect(() => {
    api("GET", "/me").then((m) => setOwner(m.owner.id)).catch(() => nav("/login", { replace: true }));
    const poll = () => api<any[]>("GET", "/approvals?status=pending").then((a) => setPending(a.length)).catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [nav]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("leash.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const item = (to: string, icon: string, label: string, badge?: number) => (
    <NavLink to={to} end={to === "/app"} className={({ isActive }) => `side-link ${isActive ? "on" : ""}`} title={collapsed ? label : undefined}>
      <Icon name={icon} />
      <span className="side-label">{label}</span>
      {!!badge && <span className="side-badge" aria-label={`${badge} waiting`}>{badge}</span>}
    </NavLink>
  );

  if (!owner) return null;
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${rail ? "with-rail" : ""}`}>
      <nav className="side" aria-label="App">
        <div className="side-top">
          <NavLink to="/" className="logo logo-dark side-logo">
            {collapsed ? <>l<span>.</span></> : <>leash<span>.</span></>}
          </NavLink>
          <button type="button" className="side-toggle" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
            <Icon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>
        {item("/app", "overview", "Overview")}
        {item("/app/approvals", "approvals", "Approvals", pending)}
        {item("/app/agents/new", "plus", "New agent")}
        <div className="side-bottom">
          <span className="side-who" title={owner}>
            <span className="side-dot" aria-hidden="true" />
            <span className="side-label">World ID ✓ · {owner.slice(0, 8)}</span>
          </span>
          <button
            type="button"
            className="side-link"
            onClick={async () => {
              await api("POST", "/auth/logout").catch(() => {});
              nav("/login");
            }}
            title={collapsed ? "Sign out" : undefined}
          >
            <Icon name="out" />
            <span className="side-label">Sign out</span>
          </button>
        </div>
      </nav>
      <main className="shell-main">{children}</main>
      {rail && <aside className="shell-rail">{rail}</aside>}
    </div>
  );
}
