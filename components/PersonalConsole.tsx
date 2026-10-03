"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyNote, VaultState } from "@/lib/vault";
import styles from "./PersonalConsole.module.css";

type Priority = { text: string; done: boolean };
type Schedule = { time: string; item: string };

const emptyPriorities = (): Priority[] => Array.from({ length: 3 }, () => ({ text: "", done: false }));

function dateLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
}

export default function PersonalConsole() {
  const [state, setState] = useState<VaultState | null>(null);
  const [priorities, setPriorities] = useState<Priority[]>(emptyPriorities);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [focus, setFocus] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load your vault");
      const data = await response.json() as VaultState;
      setState(data);
      const daily: DailyNote | null = data.daily?.isToday ? data.daily : null;
      setPriorities(Array.from({ length: 3 }, (_, i) => daily?.top3[i] ?? { text: "", done: false }));
      setSchedule(daily?.schedule ?? []);
      setFocus(daily?.focus ?? "");
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your vault");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setStatus("saving");
    setError("");
    try {
      const response = await fetch("/api/personal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorities, schedule: schedule.filter((item) => item.item.trim()), focus }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save");
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
      setStatus("error");
    }
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const result = await response.json() as { answer?: string; error?: string };
      setAnswer(response.ok ? result.answer ?? "No answer returned" : result.error ?? "Could not answer");
    } catch { setAnswer("Could not reach Codex right now."); }
    finally { setAsking(false); }
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const completed = priorities.filter((item) => item.text && item.done).length;
  const active = priorities.filter((item) => item.text).length;

  return (
    <main className={styles.shell}>
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.mark}>J</span><div><strong>JARVIS</strong><small>PERSONAL COMMAND CENTER</small></div></div>
        <nav className={styles.nav} aria-label="Command center views"><a className={styles.active} href="/">Personal</a><a href="/marketing">Marketing console</a></nav>
        <span className={styles.local}><i />LOCAL · PRIVATE</span>
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <div><p className={styles.eyebrow}>YOUR DAY, IN FOCUS</p><h1>Good to see you, Rishi<span>.</span></h1><p className={styles.sub}>Choose what matters. Jarvis keeps your plan in a local file you control.</p></div>
          <div className={styles.date}><span>INDIA STANDARD TIME</span><strong>{dateLabel(today)}</strong></div>
        </section>

        <div className={styles.grid}>
          <section className={`${styles.card} ${styles.hero}`}>
            <div className={styles.cardTop}><div><span className={styles.kicker}>01 / PRIORITIES</span><h2>Top three today</h2></div><span className={styles.count}>{completed} / {active} DONE</span></div>
            <div className={styles.priorityList}>
              {priorities.map((priority, index) => (
                <div className={styles.priority} key={index}>
                  <button className={`${styles.check} ${priority.done ? styles.checked : ""}`} aria-label={`Mark priority ${index + 1} ${priority.done ? "incomplete" : "complete"}`} onClick={() => setPriorities((items) => items.map((item, i) => i === index ? { ...item, done: !item.done } : item))}>{priority.done ? "✓" : String(index + 1).padStart(2, "0")}</button>
                  <input aria-label={`Priority ${index + 1}`} placeholder={index === 0 ? "What is the most important thing today?" : "Add a priority"} value={priority.text} onChange={(event) => setPriorities((items) => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />
                </div>
              ))}
            </div>
            <label className={styles.focusLabel} htmlFor="focus">CURRENT FOCUS</label>
            <input className={styles.focusInput} id="focus" placeholder="One sentence to keep you on track" value={focus} onChange={(event) => setFocus(event.target.value)} />
            <div className={styles.actions}><button className={styles.save} onClick={() => void save()} disabled={status === "saving" || status === "loading"}>{status === "saving" ? "Saving…" : "Save today’s plan"}<span>↗</span></button><span role="status">{status === "saved" ? "Saved to your local vault" : status === "error" ? error : ""}</span></div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTop}><div><span className={styles.kicker}>02 / SCHEDULE</span><h2>Time blocks</h2></div><span className={styles.muted}>MANUAL FOR NOW</span></div>
            <p className={styles.help}>Add the events you want beside your priorities. Google Calendar sync is the next connection.</p>
            <div className={styles.scheduleList}>{schedule.map((entry, index) => <div className={styles.scheduleRow} key={index}><input aria-label={`Time ${index + 1}`} type="time" value={entry.time} onChange={(event) => setSchedule((items) => items.map((item, i) => i === index ? { ...item, time: event.target.value } : item))} /><input aria-label={`Event ${index + 1}`} placeholder="Meeting or focus block" value={entry.item} onChange={(event) => setSchedule((items) => items.map((item, i) => i === index ? { ...item, item: event.target.value } : item))} /><button aria-label={`Remove event ${index + 1}`} onClick={() => setSchedule((items) => items.filter((_, i) => i !== index))}>×</button></div>)}</div>
            <button className={styles.add} onClick={() => setSchedule((items) => [...items, { time: "09:00", item: "" }])} disabled={schedule.length >= 20}>+ Add time block</button>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTop}><div><span className={styles.kicker}>03 / CONNECTIONS</span><h2>Your workspace</h2></div></div>
            <div className={styles.connections}>
              {[["Google Calendar", "Next to connect"], ["Gmail", "Next to connect"], ["Google Tasks", "Next to connect"], ["Notion", "Planned"], ["Slack", "Planned"]].map(([name, label]) => <div key={name}><span className={styles.connectionIcon}>{name[0]}</span><span>{name}</span><em>{label}</em></div>)}
            </div>
          </section>

          <section className={`${styles.card} ${styles.brain}`}>
            <div className={styles.cardTop}><div><span className={styles.kicker}>04 / AI BRAIN</span><h2>Codex + ChatGPT</h2></div><span className={styles.pulse} /></div>
            <p>Ask Codex about today’s plan, priorities, or a decision you’re weighing.</p>
            <form className={styles.askForm} onSubmit={(event) => { event.preventDefault(); void ask(); }}><input aria-label="Ask Jarvis" placeholder="Ask Jarvis anything about today…" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} /><button disabled={asking || !question.trim()}>{asking ? "Thinking…" : "Ask ↗"}</button></form>
            {answer && <p className={styles.answer} role="status">{answer}</p>}
            <div className={styles.brainFooter}><span>CODEX BRAIN · LOCAL PLAN</span><span>{state ? "READY" : status === "loading" ? "LOADING" : "UNAVAILABLE"}</span></div>
          </section>
        </div>
        <footer className={styles.footer}>JARVIS / VERSION 01 <span>Built from ARGUS · running on this Mac</span></footer>
      </div>
    </main>
  );
}
