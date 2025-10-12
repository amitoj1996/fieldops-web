import { useEffect } from "react";

export default function AfterLogin() {
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.auth/me");
        const j = await res.json();
        const roles = (j?.clientPrincipal?.userRoles || []).map(r => r.toLowerCase());
        const isAdmin = roles.includes("admin");
        window.location.replace(isAdmin ? "/admin" : "/employee");
      } catch {
        window.location.replace("/employee");
      }
    })();
  }, []);
  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>Signing you in…</h1>
      <p>Redirecting to your workspace.</p>
    </main>
  );
}
