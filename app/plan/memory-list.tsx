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
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showUndo(content: string) {
    setUndoContent(content);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoContent(null), 5000);
  }

  async function remove(fact: MemoryFactView) {
    const res = await fetch(`/api/memory-facts/${fact.id}`, { method: "DELETE" });
    if (res.ok) {
      showUndo(fact.content);
      startTransition(() => router.refresh());
    }
  }

  async function undo() {
    if (!undoContent) return;
    await fetch("/api/memory-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: undoContent }),
    });
    setUndoContent(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    startTransition(() => router.refresh());
  }

  async function add() {
    if (!draft.trim()) return;
    const res = await fetch("/api/memory-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (res.ok) {
      setDraft("");
      setAdding(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div>
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

      {undoContent && (
        <div className="plan-snack">
          <span>memory fact deleted</span>
          <button onClick={undo}>UNDO</button>
        </div>
      )}
    </div>
  );
}
