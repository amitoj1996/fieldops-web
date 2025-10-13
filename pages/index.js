import { useEffect, useState, useMemo } from "react";

/* ---- tiny auth hook (SWA) ---- */
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

export default function Home() {
  const me = useAuth();
  const roles = useMemo(() => (me?.userRoles || []).map((r) => r.toLowerCase()), [me]);
  const isAdmin = roles.includes("admin");
  const who = me?.userDetails || "";

  const box = {
    background: "#fff",
    border: "1px solid #eef0f3",
    borderRadius: 12,
    boxShadow: "0 6px 18px rgba(16,24,40,0.06)",
  };

  return (
    <main style={{ padding: "24px", fontFamily: "-apple-system, system-ui, Segoe UI, Roboto" }}>
      {/* HERO */}
      <section
        style={{
          ...box,
          padding: "28px 28px 20px",
          background:
            "linear-gradient(180deg, rgba(240,247,255,0.9) 0%, rgba(255,255,255,1) 70%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#e9f2ff",
              border: "1px solid #d6e7ff",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              color: "#0b4d8a",
            }}
          >
            AOI
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
              AeroOptimus Innovations
            </h1>
            <div style={{ color: "#667085", fontSize: 13, marginTop: 4 }}>
              Field operations & expense tracking — simple, fast, and reliable.
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            {me ? (
              <span
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  background: "#edf5ff",
                  border: "1px solid #d6e7ff",
                  borderRadius: 999,
                  color: "#0b4d8a",
                }}
              >
                Signed in as <strong>{who}</strong>
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!me ? (
            <>
              <a
                className="btn"
                href="/.auth/login/aad?post_login_redirect_uri=/after-login"
                style={primaryBtn}
              >
                Login with Microsoft
              </a>
              <a href="/employee" style={ghostBtn}>
                Employee portal
              </a>
              <a href="/admin" style={ghostBtn}>
                Admin console
              </a>
            </>
          ) : (
            <>
              <a href="/employee" style={primaryBtn}>
                Go to Employee portal
              </a>
              {isAdmin && (
                <a href="/admin" style={secondaryBtn}>
                  Open Admin console
                </a>
              )}
              <a href="/.auth/logout?post_logout_redirect_uri=/" style={ghostBtn}>
                Logout
              </a>
            </>
          )}
        </div>
      </section>

      {/* QUICK LINKS / INFO */}
      <section
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <Card
          title="Employees"
          desc="See assigned tasks, check in/out on site, and upload receipts."
          href="/employee"
          emoji="🧑‍💼"
        />
        <Card
          title="Admins"
          desc="Create tasks, manage budgets, and review expenses."
          href="/admin"
          emoji="🛠️"
        />
        <Card
          title="Help"
          desc="Need a hand? Contact your admin or support desk."
          href="mailto:support@example.com"
          emoji="💬"
          external
        />
      </section>

      {/* WHAT'S NEW */}
      <section style={{ marginTop: 16, ...box, padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>What’s new</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#475467", fontSize: 14 }}>
          <li>Clean light theme across the app for better readability.</li>
          <li>Interactive charts in Admin → Overview (legend & axis overlap fixed).</li>
          <li>Faster modals and improved keyboard focus states.</li>
        </ul>
      </section>
    </main>
  );
}

/* --- Small components & styles --- */
function Card({ title, desc, href, emoji, external }) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "#fff",
        border: "1px solid #eef0f3",
        borderRadius: 12,
        boxShadow: "0 6px 18px rgba(16,24,40,0.06)",
        padding: 14,
        transition: "transform 120ms ease, box-shadow 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 10px 24px rgba(16,24,40,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(16,24,40,0.06)";
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 18 }} aria-hidden>
          {emoji}
        </span>
        <div style={{ fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ color: "#667085", fontSize: 13 }}>{desc}</div>
    </a>
  );
}

const primaryBtn = {
  display: "inline-block",
  textDecoration: "none",
  background: "#0b4d8a",
  color: "#fff",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #0b4d8a",
  fontWeight: 600,
};

const secondaryBtn = {
  ...primaryBtn,
  background: "#1d6bbd",
  borderColor: "#1d6bbd",
};

const ghostBtn = {
  display: "inline-block",
  textDecoration: "none",
  background: "#fff",
  color: "#0b4d8a",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cfe3ff",
  fontWeight: 600,
};

