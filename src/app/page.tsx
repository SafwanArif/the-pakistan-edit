import Link from "next/link";
import LandingLogo from "./LandingLogo";

/**
 * Institutional landing page rendered as a Server Component using design tokens.
 */
export default function Home() {
  return (
    <div className="tpe-landing-shell">
      <main className="tpe-landing-main">
        <div className="tpe-landing-logo-row">
          <LandingLogo />
        </div>

        <div className="tpe-landing-copy">
          <h1 className="tpe-landing-title">
            Institutional<br />Content Engine
          </h1>
          <p className="tpe-landing-subtitle">
            The Pakistan Edit<br />Internal Dashboard
          </p>
        </div>

        <Link href="/admin" className="tpe-landing-cta">
          <span>Enter Dashboard</span>
          <span aria-hidden="true" className="tpe-landing-cta-arrow">&rarr;</span>
        </Link>
      </main>

      <footer className="tpe-landing-footer">
        Authorized Access Only
      </footer>
    </div>
  );
}
