import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import JoinBetaForm from "./JoinBetaForm";

export default function JoinBetaPage() {
  return (
    <div className={styles.page}>
      <div className={styles.topnav}>
        <Link href="/" className={styles.backLink}>&larr; Back to CrewTracker</Link>
      </div>

      <main className={styles.main}>
        <section className={styles.hero}>
          <Image
            src="/app-icon.png"
            alt="CrewTracker app icon"
            width={100}
            height={100}
            className={styles.heroLogo}
            priority
          />
          <h1>Join the <span>Beta</span></h1>
          <p className={styles.subtitle}>
            Tell us a bit about your team and we&apos;ll reach out about getting you set up.
          </p>
        </section>

        <section className={styles.formSection}>
          <JoinBetaForm />
        </section>
      </main>

      <footer className={styles.footer}>
        <p>&copy; 2026 CrewTracker. All rights reserved.</p>
      </footer>
    </div>
  );
}
