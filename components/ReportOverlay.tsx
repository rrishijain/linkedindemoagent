"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Report reveal overlay — renders a vault markdown deliverable inside the
// console (no app switch, stays cinematic). Animates out from the core. Esc or
// the × closes it (console owns the Esc handling). Zero-dep renderer: reports
// are runner-generated markdown — headings, bullets, bold, links, hr.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// hrefs are interpolated into an attribute — escaped above, and only safe
// schemes (or relative paths / anchors) become links; anything else stays text
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i;

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text: string, href: string) =>
      SAFE_HREF.test(href.trim())
        ? `<a href="${href.trim()}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : whole
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function mdToHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length + 1, 5); // # → h2 (overlay title is h1)
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList();
      out.push("<hr/>");
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

// Obsidian vault name (folder basename) — the obsidian:// URI needs the exact
// name. Client-side, so NEXT_PUBLIC_ (inlined at build). Unset = the "open in
// Obsidian" deep link is hidden.
const OBSIDIAN_VAULT = process.env.NEXT_PUBLIC_OBSIDIAN_VAULT ?? "";

export default function ReportOverlay({
  report,
  onClose,
  action,
}: {
  report: { path: string; content: string };
  onClose: () => void;
  /** optional header action (e.g. the transcript's reset button) */
  action?: { label: string; onClick: () => void };
}) {
  const title = report.path.split("/").pop()?.replace(/\.md$/, "") ?? report.path;
  // synthetic docs (e.g. the voice transcript) aren't vault notes — no deep link
  const isVaultNote = report.path.endsWith(".md");
  const obsidianHref = `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(report.path.replace(/\.md$/, ""))}`;

  // modal plumbing — take focus on open, trap Tab inside, hand focus back on
  // close. Esc itself stays with console's global handler.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="report-overlay" onClick={onClose}>
      <div
        className="report-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-overlay-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="report-head">
          <h1 className="report-title" id="report-overlay-title">{title}</h1>
          <span className="report-path">{report.path}</span>
          {isVaultNote && OBSIDIAN_VAULT && (
            <a className="report-obsidian" href={obsidianHref}>
              open in Obsidian ↗
            </a>
          )}
          {action && (
            <button className="report-obsidian report-action" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          <button className="report-close" ref={closeRef} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="report-body" dangerouslySetInnerHTML={{ __html: mdToHtml(report.content) }} />
      </div>
    </div>
  );
}
