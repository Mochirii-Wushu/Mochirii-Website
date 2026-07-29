import Link from "next/link";

export function ProtectedAccessUnavailable() {
  return (
    <main className="page-main" id="main">
      <div className="container">
        <section
          className="glass-card glass-card--strong glass-pad center-stack"
          aria-labelledby="protected-access-unavailable-heading"
          data-protected-access-unavailable
        >
          <p className="kicker">Guild Access</p>
          <h1 className="display-title" id="protected-access-unavailable-heading">
            This guild page is temporarily unavailable
          </h1>
          <p className="lede">We couldn&apos;t verify access right now. Please try again shortly.</p>
          <div className="hero-cta-row">
            <Link className="hero-cta hero-cta--primary" href="/">
              Return Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
