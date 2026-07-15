import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className={styles.page}>
      <div className={styles.topnav}>
        <Link href="/login" className={styles.loginLink}>Log In</Link>
      </div>

      <main className={styles.main}>
        <section className={styles.hero}>
          <Image
            src="/app-icon.png"
            alt="CrewTracker app icon"
            width={140}
            height={140}
            className={styles.heroLogo}
            priority
          />

          <div className={styles.appTitle}>CrewTracker</div>

          <h1>Ditch the paper.<br /><span>Track the crew.</span></h1>
          <p className={styles.subtitle}>
            Purpose-built time-tracking and payroll-reporting for Production Managers in the live events and AV industry.
          </p>
          <Link href="/login" className={styles.ctaButton}>Get Started</Link>
        </section>

        <section className={styles.features}>
          <div className={styles.featureCard}>
            <h3>Built for &ldquo;AV Math&rdquo;</h3>
            <p>We handle the complex stuff automatically: day rate minimums, accurate ceiling hour rounding, and OT calculations so you don&apos;t have to.</p>
          </div>
          <div className={styles.featureCard}>
            <h3>Batch Roster Controls</h3>
            <p>Clock in or out your entire roster of 50+ freelancers at once, and easily duplicate yesterday&apos;s crew list for tomorrow&apos;s work day.</p>
          </div>
          <div className={styles.featureCard}>
            <h3>Seamless Financial Exports</h3>
            <p>Generate clean PDF wrap reports for clients, CSV data dumps for accounting (QuickBooks, ADP), and simple text summaries for your crew.</p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>&copy; 2026 CrewTracker. All rights reserved.</p>
      </footer>
    </div>
  );
}
