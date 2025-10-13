import { useEffect, useState } from "react";
import "../styles/ui.css";

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

function Nav() {
  const me = useAuth();
  const roles = (me?.userRoles || []).map(r => r.toLowerCase());
  const isAdmin = roles.includes("admin");
  const who = me?.userDetails || "";

  return (
    <nav style={{display:"flex",gap:12,alignItems:"center",padding:"10px 16px",borderBottom:"1px solid #eee",
                 fontFamily:"-apple-system, system-ui, Segoe UI, Roboto", position:"sticky", top:0, background:"#fff", zIndex:10}}>
      <a href="/" style={{fontWeight:700, textDecoration:"none"}}>FieldOps</a>
      <a href="/employee">Employee</a>
      {isAdmin && <a href="/admin">Admin</a>}
      <div style={{marginLeft:"auto"}}/>
      {me ? (
        <>
          {isAdmin && <span style={{fontSize:12,background:"#222",color:"#fff",padding:"2px 6px",borderRadius:6}}>admin</span>}
          <span style={{color:"#444"}}>{who}</span>
          <a href="/.auth/logout?post_logout_redirect_uri=/" style={{textDecoration:"none"}}>Logout</a>
        </>
      ) : (
        <a href="/.auth/login/aad?post_login_redirect_uri=/after-login" style={{textDecoration:"none"}}>Login</a>
      )}
    </nav>
  );
}

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Nav />
      <Component {...pageProps} />
    </>
  );
}
