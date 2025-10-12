import { useEffect, useState } from "react";

export default function Home() {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.auth/me");
        const j = await res.json();
        const p = j?.clientPrincipal;
        if (p) {
          const roles = (p.userRoles || []).map(r => r.toLowerCase());
          const isAdmin = roles.includes("admin");
          window.location.replace(isAdmin ? "/admin" : "/employee");
          return;
        }
      } catch {}
      setChecked(true);
    })();
  }, []);

  if (!checked) {
    return (
      <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
        <h1>FieldOps</h1>
        <p>Checking your session…</p>
      </main>
    );
  }

  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>FieldOps</h1>
      <p>Welcome! Please sign in to use the app.</p>
      <p>
        <a href="/.auth/login/aad?post_login_redirect_uri=/after-login">Login</a>
      </p>
      <p style={{color:"#555"}}>
        Employees land on <code>/employee</code>. Admins land on <code>/admin</code>.
      </p>
    </main>
  );
}
