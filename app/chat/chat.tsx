"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fileToScaledJpeg } from "@/app/image-scale";

type Remaining = { kcal: number; proteinG: number; carbsG: number; fatG: number };
type Card = { label: string; title: string; detail: string };
type Photo = { base64: string; mediaType: "image/jpeg"; preview: string };

type Item =
  | { id: string; kind: "user"; text: string; imageUrl?: string }
  | { id: string; kind: "ai"; text: string; error?: boolean }
  | { id: string; kind: "card"; card: Card; writeBatchId: string | null; undone?: boolean }
  | { id: string; kind: "rstrip"; remaining: Remaining };

const n = (x: number) => Math.round(x).toLocaleString("en-US");

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Chat({ model }: { model: string }) {
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [costUsd, setCostUsd] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [costKnown, setCostKnown] = useState(true);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const nid = () => `${counter.current++}`;

  useEffect(() => setSessionId(crypto.randomUUID()), []);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  useEffect(() => {
    if (!attachOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!composerRef.current?.contains(e.target as Node)) setAttachOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAttachOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [attachOpen]);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    setAttachOpen(false);
    if (!f) return;
    try {
      const scaled = await fileToScaledJpeg(f);
      setPhoto({ ...scaled, preview: `data:image/jpeg;base64,${scaled.base64}` });
    } catch {
      setItems((p) => [
        ...p,
        { id: nid(), kind: "ai", text: "Couldn't read that photo, try a different one.", error: true },
      ]);
    }
  }

  function newSession() {
    setItems([]);
    setSessionId(crypto.randomUUID());
    setPhoto(null);
    setAttachOpen(false);
    setCostUsd(0);
    setTokens(0);
    setCostKnown(true);
  }

  async function undo(itemId: string, batchId: string) {
    await fetch("/api/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writeBatchId: batchId }),
    }).catch(() => {});
    setItems((p) => p.map((it) => (it.id === itemId && it.kind === "card" ? { ...it, undone: true } : it)));
  }

  async function send() {
    const text = input.trim();
    if ((!text && !photo) || sending || !sessionId) return;
    setAttachOpen(false);
    const sentPhoto = photo;
    setInput("");
    setPhoto(null);
    setItems((p) => [...p, { id: nid(), kind: "user", text, imageUrl: sentPhoto?.preview }]);
    setSending(true);

    let aiId: string | null = null; // current streaming bubble; reset by any non-text event
    const appendText = (delta: string) => {
      if (aiId === null) {
        aiId = nid();
        const id = aiId;
        setItems((p) => [...p, { id, kind: "ai", text: "" }]);
      }
      const id = aiId;
      setItems((p) => p.map((it) => (it.id === id && it.kind === "ai" ? { ...it, text: it.text + delta } : it)));
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: text,
          imageBase64: sentPhoto?.base64,
          mediaType: sentPhoto?.mediaType,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith("data:")) continue;
          const evt = JSON.parse(chunk.slice(5).trim());

          if (evt.type === "text") {
            appendText(evt.text);
          } else if (evt.type === "tool_result") {
            aiId = null; // next text starts a fresh bubble
            if (evt.remaining) {
              setItems((p) => [...p, { id: nid(), kind: "rstrip", remaining: evt.remaining }]);
            }
            if (evt.card) {
              setItems((p) => [
                ...p,
                { id: nid(), kind: "card", card: evt.card, writeBatchId: evt.writeBatchId ?? null },
              ]);
            }
          } else if (evt.type === "usage") {
            setTokens((t) => t + (evt.tokens?.input ?? 0) + (evt.tokens?.output ?? 0));
            if (evt.costUsd == null) setCostKnown(false);
            else setCostUsd((c) => c + evt.costUsd);
          } else if (evt.type === "error") {
            aiId = null;
            setItems((p) => [...p, { id: nid(), kind: "ai", text: evt.message, error: true }]);
          }
          // tool_use and done need no rendering
        }
      }
    } catch (e) {
      setItems((p) => [
        ...p,
        { id: nid(), kind: "ai", text: e instanceof Error ? e.message : "Something went wrong.", error: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="chat">
      <header className="chat-head anim">
        <Link href="/" className="home">‹ Today</Link>
        <div style={{ textAlign: "center" }}>
          <h1>Kal</h1>
          <div className="sub"><span>Ephemeral</span><span>not saved</span></div>
        </div>
        <button className="newbtn" onClick={newSession}>+ New</button>
      </header>

      <div className="chat-meta anim" style={{ animationDelay: "0.04s" }}>
        <span className="cm-model">{model}</span>
        <span className="cm-cost">
          <span className="cm-c">{costKnown ? `$${costUsd.toFixed(4)}` : "cost n/a"}</span>
          <span className="cm-t">{tokens.toLocaleString("en-US")} tok</span>
        </span>
      </div>

      <div className={`chat-thread${attachOpen ? " dim" : ""}`} ref={threadRef}>
        {items.length === 0 && (
          <div className="chat-empty anim">
            <div className="big">Ask Kal</div>
            Log meals, check what's left, or record a weigh-in.
          </div>
        )}

        {items.map((it) => {
          if (it.kind === "user")
            return it.imageUrl ? (
              <div key={it.id} className="bub-user photo-bubble anim">
                <img className="photo-img" src={it.imageUrl} alt="Attached photo" />
                {it.text && <div className="cap">{it.text}</div>}
              </div>
            ) : (
              <div key={it.id} className="bub-user anim">{it.text}</div>
            );
          if (it.kind === "ai")
            return (
              <div key={it.id} className={`bub-ai anim${it.error ? " err" : ""}`}>
                {it.text || <span className="typing"><i /><i /><i /></span>}
              </div>
            );
          if (it.kind === "rstrip")
            return (
              <div key={it.id} className="rstrip anim">
                <div className="kicker">Remaining today</div>
                <div className="grid">
                  <div className="stat"><b>{n(it.remaining.kcal)}</b><small>kcal</small></div>
                  <div className="stat"><b>{n(it.remaining.proteinG)}</b><small>prot</small></div>
                  <div className="stat"><b>{n(it.remaining.carbsG)}</b><small>carb</small></div>
                  <div className="stat"><b>{n(it.remaining.fatG)}</b><small>fat</small></div>
                </div>
              </div>
            );
          // card
          return (
            <div key={it.id} className={`tool-card anim${it.undone ? " undone" : ""}`}>
              <div className="tc-top">
                <span className="chip"><span className="d" />{it.undone ? "Undone" : it.card.label}</span>
              </div>
              <div className="tc-title">{it.card.title}</div>
              {it.card.detail && <div className="tc-detail">{it.card.detail}</div>}
              {it.writeBatchId && (
                <div className="tc-foot">
                  <button className="tc-undo" disabled={it.undone} onClick={() => undo(it.id, it.writeBatchId!)}>
                    {it.undone ? "Undone" : "Undo"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFilePicked} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onFilePicked} />

      <div
        className={`composer anim${attachOpen ? " has-pop" : ""}`}
        style={{ animationDelay: "0.24s" }}
        ref={composerRef}
      >
        {attachOpen && (
          <div className="attach-pop">
            <button type="button" disabled={sending} onClick={() => cameraRef.current?.click()}>
              <span className="ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </span>
              Take photo
            </button>
            <button type="button" disabled={sending} onClick={() => libraryRef.current?.click()}>
              <span className="ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
              </span>
              Photo library
            </button>
          </div>
        )}

        {photo && (
          <div className="pending-row">
            <div className="pending-chip">
              <img src={photo.preview} alt="Attached photo" />
              <button type="button" className="rm" aria-label="Remove photo" onClick={() => setPhoto(null)}>✕</button>
            </div>
          </div>
        )}

        <div className="composer-row">
          <button
            type="button"
            className={`plusbtn${attachOpen ? " active" : ""}`}
            aria-label="Attach photo"
            aria-haspopup="menu"
            aria-expanded={attachOpen}
            onClick={() => setAttachOpen((o) => !o)}
            disabled={sending}
          >
            +
          </button>
          <div className="composer-box">
            <input
              placeholder={photo ? "Add a caption…" : "Message Kal…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={sending}
            />
            <button className="send" onClick={send} disabled={sending || (input.trim() === "" && !photo)} aria-label="Send">
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
