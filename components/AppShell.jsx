import { useEffect, useMemo, useState } from "react";

/* ---------- Auth (SWA) ---------- */
function useAuth() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.auth/me");
        const j = await res.json();
        setMe(j?.clientPrincipal || null);
      } catch {
        setMe(null);
      }
    })();
  }, []);
  return me;
}

/* ---------- Icons (inline, tiny) ---------- */
const I = {
  menu: (p) => (<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...p}><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>),
  home: (p) => (<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...p}><path d="M3 10.5 12 3l9 7.5V21H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="2" fill="none"/></svg>),
  user: (p) => (<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...p}><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M4 21c1.5-4 6-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" strokeWidth="2"/></svg>),
  admin:(p) => (<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...p}><path d="M12 3l8 4v5c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V7z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none"/></svg>),
  list: (p) => (<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>),
  logout:(p) => (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...p}><path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M13 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" stroke="currentColor" strokeWidth="2"/></svg>),
  login:(p) => (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...p}><path d="M8 7l-5 5 5 5M3 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M11 21h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-7" stroke="currentColor" strokeWidth="2"/></svg>),
};

/* ---------- Small helpers ---------- */
function usePath() {
  const [path, setPath] = useState("");
  useEffect(() => {
    setPath(window.location?.pathname || "/");
  }, []);
  return path;
}
function NavItem({ href, icon:Icon, children, active, collapsed }) {
  return (
    <a href={href} className={`fo-nav-item ${active ? "active": ""} ${collapsed ? "collapsed": ""}`}>
      <span className="fo-nav-icon"><Icon /></span>
      <span className="fo-nav-text">{children}</span>
    </a>
  );
}

/* ---------- The Shell ---------- */
export default function AppShell({ children }) {
  const me = useAuth();
  const path = usePath();
  const roles = (me?.userRoles || []).map(r => r.toLowerCase());
  const isAdmin = roles.includes("admin");
  const who = me?.userDetails || "";

  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // collapse on small screens by default
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const update = () => setOpen(!mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const collapsed = !open;

  const nav = useMemo(() => ([
    { href: "/",        icon: I.home,  text: "Home",     show: true },
    { href: "/employee",icon: I.user,  text: "Employee", show: true },
    { href: "/admin",   icon: I.admin, text: "Admin",    show: isAdmin },
  ].filter(x => x.show)), [isAdmin]);

  const onHamburger = () => {
    if (window.matchMedia("(max-width: 1024px)").matches) {
      setMobileOpen(v => !v);
    } else {
      setOpen(v => !v);
    }
  };

  return (
    <div className={`fo-shell ${collapsed ? "collapsed": ""} ${mobileOpen ? "mobile-open": ""}`}>
      {/* Sidebar */}
      <aside className="fo-sidebar" aria-label="Main">
        <div className="fo-brand">
          <a href="/" className="fo-logo" aria-label="FieldOps">FO</a>
          <span className="fo-brand-name">FieldOps</span>
        </div>
        <nav className="fo-nav">
          {nav.map(link => (
            <NavItem
              key={link.href}
              href={link.href}
              icon={link.icon}
              active={path === link.href || (link.href !== "/" && path.startsWith(link.href))}
              collapsed={collapsed}
            >
              {link.text}
            </NavItem>
          ))}
        </nav>
        <div className="fo-spacer" />
        <div className={`fo-auth ${collapsed ? "collapsed": ""}`}>
          {me ? (
            <>
              <div className="fo-user">
                <div className="fo-avatar" aria-hidden="true">{(who || "?").slice(0,1).toUpperCase()}</div>
                <div className="fo-user-lines">
                  <div className="fo-user-name" title={who}>{who || "—"}</div>
                  {isAdmin && <div className="fo-user-role">admin</div>}
                </div>
              </div>
              <a className="fo-logout" href="/.auth/logout?post_logout_redirect_uri=/">
                <I.logout /> <span>Logout</span>
              </a>
            </>
          ) : (
            <a className="fo-login" href="/.auth/login/aad?post_login_redirect_uri=/after-login">
              <I.login /> <span>Login</span>
            </a>
          )}
        </div>
      </aside>

      {/* Mobile scrim */}
      <div className="fo-scrim" onClick={() => setMobileOpen(false)} />

      {/* Main area */}
      <div className="fo-main">
        <header className="fo-topbar">
          <button className="fo-icon-btn" aria-label="Toggle navigation" onClick={onHamburger}>
            <I.menu />
          </button>
          <div className="fo-topbar-title" role="heading" aria-level={1}>
            {path === "/admin" ? "Admin" : path === "/employee" ? "Employee" : "Dashboard"}
          </div>
          <div className="fo-topbar-right">
            <input className="fo-search" placeholder="Search (coming soon)" aria-label="Search" />
          </div>
        </header>

        <main className="fo-content" id="content">
          {children}
        </main>
      </div>
    </div>
  );
}
