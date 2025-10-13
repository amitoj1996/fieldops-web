import { useEffect, useState } from "react";

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

export default function IndexPage() {
  const me = useAuth();
  const roles = (me?.userRoles || []).map((r) => r.toLowerCase());
  const isAdmin = roles.includes("admin");
  const signedIn = !!me;

  return (
    <main style={{ padding: "24px", fontFamily: "-apple-system, system-ui, Segoe UI, Roboto" }}>
      {/* Hero / brand card */}
      <div style={heroCard}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={brandRow}>
              <div style={logoDot}>AOI</div>
              <div style={brandTitle}>AeroOptimus Innovations</div>
            </div>
            <div style={subtext}>Field operations & expense tracking — simple, fast, and reliable.</div>

            {/* Primary actions */}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!signedIn && (
                <a href="/.auth/login/aad?post_login_redirect_uri=/after-login" style={btnPrimary}>
                  Login with Microsoft
                </a>
              )}

              {signedIn && !isAdmin && (
                <>
                  <a href="/employee" style={btnPrimary}>Go to Employee portal</a>
                  <a href="/.auth/logout?post_logout_redirect_uri=/" style={btnGhost}>Logout</a>
                </>
              )}

              {signedIn && isAdmin && (
                <>
                  <a href="/admin" style={btnPrimary}>Go to Admin console</a>
                  <a href="/employee" style={btnGhost}>Employee portal</a>
                  <a href="/.auth/logout?post_logout_redirect_uri=/" style={btnGhost}>Logout</a>
                </>
              )}
            </div>
          </div>

          {signedIn && (
            <div style={signedAsPill}>Signed in as&nbsp;<strong>{me?.userDetails || me?.userId}</strong></div>
          )}
        </div>
      </div>

      {/* Help only (removed “Employees” & “Admins” tiles) */}
      <div style={{ marginTop: 16 }}>
        <div style={helpCard}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Need help?</div>
          <div style={{ color: "#475467" }}>
            Contact your admin or support desk. If you believe you should have admin access, ask an administrator to add you.
          </div>
        </div>
      </div>
    </main>
  );
}

/* --- styles --- */
const heroCard = {
  background: "#ffffff",
  border: "1px solid #EEF2F7",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
};

const brandRow = { display: "flex", alignItems: "center", gap: 10 };
const logoDot = {
  width: 36,
  height: 36,
  borderRadius: 8,
  background: "linear-gradient(135deg, #0b4d8a 0%, #1d6bbd 100%)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: 0.4,
};
const brandTitle = { fontSize: 20, fontWeight: 700, color: "#0F172A" };
const subtext = { marginTop: 4, color: "#475467" };

const btnPrimary = {
  display: "inline-block",
  textDecoration: "none",
  background: "#0b4d8a",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #0b4d8a",
  fontWeight: 600,
};

const btnGhost = {
  display: "inline-block",
  textDecoration: "none",
  background: "#fff",
  color: "#0b4d8a",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #cfe3ff",
  fontWeight: 600,
};

const signedAsPill = {
  alignSelf: "flex-start",
  background: "#F0F7FF",
  color: "#0b4d8a",
  border: "1px solid #DAE9FF",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const helpCard = {
  background: "#F8FAFF",
  border: "1px solid #EEF4FF",
  borderRadius: 10,
  padding: 12,
};
