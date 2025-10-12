export default function Home() {
  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>FieldOps</h1>
      <p>Welcome! Please sign in to use the app.</p>
      <p>
        <a href="/.auth/login/aad?post_login_redirect_uri=/employee">Login</a>
      </p>
      <p style={{color:"#555"}}>
        Admins go to <a href="/admin">/admin</a> (requires the <code>admin</code> role).
      </p>
    </main>
  );
}
