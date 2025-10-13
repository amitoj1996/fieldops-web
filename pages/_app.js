import "../styles/ui.css";      // you already added this
import "../styles/shell.css";   // new shell styles
import AppShell from "../components/AppShell";

export default function MyApp({ Component, pageProps }) {
  return (
    <AppShell>
      <Component {...pageProps} />
    </AppShell>
  );
}
