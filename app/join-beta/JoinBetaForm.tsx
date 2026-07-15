"use client";

import { useState } from "react";
import styles from "./page.module.css";

type Status = "idle" | "submitting" | "success" | "error";

export default function JoinBetaForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: data.get("name"),
      email: data.get("email"),
      company: data.get("company"),
      teamSize: data.get("teamSize"),
      adminUsers: data.get("adminUsers"),
      notes: data.get("notes"),
      company_website: data.get("company_website"),
    };

    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        setErrorMessage(responseBody.error || "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMessage("Something went wrong. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className={styles.successMessage}>
        <h2>Thanks!</h2>
        <p>We&apos;ve got your info and will be in touch about joining the CrewTracker Beta.</p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="company">Company Name</label>
        <input id="company" name="company" type="text" />
      </div>

      <div className={styles.field}>
        <label htmlFor="teamSize">Team Size (crew you track)</label>
        <input id="teamSize" name="teamSize" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="adminUsers">Admin Users Needed</label>
        <input id="adminUsers" name="adminUsers" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="notes">Anything else?</label>
        <textarea id="notes" name="notes" rows={4} />
      </div>

      {/* Honeypot: hidden from real users; bots tend to fill every field they find */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="company_website">Company Website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {status === "error" && <p className={styles.errorMessage}>{errorMessage}</p>}

      <button type="submit" className={styles.submitButton} disabled={status === "submitting"}>
        {status === "submitting" ? "Sending..." : "Request an Invite"}
      </button>
    </form>
  );
}
