// app/plan/memory-list.tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { MemoryFactView } from "@/lib/memory";

function metaDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(iso));
}

export function MemoryList({ facts }: { facts: MemoryFactView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [undoContents, setUndoContents] = useState<string[] | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoing = useRef(false);

  function showUndo(contents: string[]) {
    setUndoContents(contents);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoContents(null), 5000);
  }

  async function remove(fact: MemoryFactView) {
    setError(null);
    try {
      const res = await fetch(`/api/memory-facts/${fact.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "delete failed");
        return;
      }
      showUndo([fact.content]);
      startTransition(() => router.refresh());
    } catch {
      setError("network error — try again");
    }
  }

  async function undo() {
    if (!undoContents || undoing.current) return;
    undoing.current = true;
    setError(null);
    if (undoTimer.current) clearTimeout(undoTimer.current); // freeze the snackbar while the re-POST is in flight
    const remaining = [...undoContents];
    try {
      while (remaining.length > 0) {
        const res = await fetch("/api/memory-facts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: remaining[0] }),
        });
        if (!res.ok) {
          showUndo(remaining); // keep the not-yet-restored remainder recoverable — re-arm the snackbar
          return;
        }
        remaining.shift();
      }
      setUndoContents(null);
      startTransition(() => router.refresh());
    } catch {
      showUndo(remaining);
      setError("network error — try again");
    } finally {
      undoing.current = false;
    }
  }

  async function add() {
    if (!draft.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/memory-facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "add failed");
        return;
      }
      setDraft("");
      setAdding(false);
      startTransition(() => router.refresh());
    } catch {
      setError("network error — try again");
    }
  }

  async function clearAll() {
    if (clearing) return;
    setClearing(true);
    setError(null);
    const deleted: string[] = [];
    try {
      for (const fact of facts) {
        const res = await fetch(`/api/memory-facts/${fact.id}`, { method: "DELETE" });
        if (res.ok) deleted.push(fact.content);
      }
    } catch {
      setError(`network error — cleared ${deleted.length} of ${facts.length} facts`);
    } finally {
      setClearing(false);
    }
    if (deleted.length > 0) {
      showUndo(deleted);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div>
      {error && <div className="gr-error">{error}</div>}
      {!adding && (
        <button className="plan-fact-add" onClick={() => setAdding(true)}>+ tell kal something</button>
      )}
      {adding && (
        <div className="plan-fact-form">
          <textarea
            className="plan-fact-input"
            rows={2}
            placeholder="e.g. I lift Mon/Wed/Fri mornings"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="plan-actions">
            <button className="btn-dark" onClick={add}>Add fact</button>
            <button className="plan-cancel" onClick={() => { setAdding(false); setDraft(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {facts.map((f) => (
        <div className="plan-fact" key={f.id}>
          <div className="plan-fact-body">
            <div className="plan-fact-tx">{f.content}</div>
            <div className="plan-fact-meta">added {metaDate(f.createdAt)}</div>
          </div>
          <button className="plan-fact-x" onClick={() => remove(f)} aria-label={`delete fact: ${f.content}`}>×</button>
        </div>
      ))}
      {facts.length === 0 && <div className="plan-fact-empty">kal has no memories yet</div>}

      {facts.length > 0 && (
        <button className="plan-clear-all" onClick={clearAll} disabled={clearing}>clear all memory</button>
      )}

      {undoContents && (
        <div className="plan-snack">
          <span>{undoContents.length > 1 ? "memory cleared" : "memory fact deleted"}</span>
          <button onClick={undo}>UNDO</button>
        </div>
      )}
    </div>
  );
}
