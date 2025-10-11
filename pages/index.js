import Link from "next/link";

export default function Home() {
  return (
    <main style={{padding:"2rem", fontFamily:"-apple-system, system-ui, Segoe UI, Roboto"}}>
      <h1>FieldOps</h1>
      <ul style={{marginTop:16, lineHeight:1.8}}>
        <li><Link href="/employee">Employee portal → upload receipt</Link></li>
        <li><Link href="/admin">Admin portal → tasks & limits</Link></li>
      </ul>
    </main>
  );
}
