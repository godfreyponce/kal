// app/plan/collapsible-section.tsx
"use client";

import { useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  meta,
  animationDelay,
  children,
}: {
  title: string;
  meta: string;
  animationDelay: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="plan-kick plan-kick-btn anim"
        style={{ animationDelay }}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        <span className="plan-kick-end">
          <small>{meta}</small>
          <span className="plan-chev" aria-hidden="true">▾</span>
        </span>
      </button>
      <div hidden={!open}>{children}</div>
    </>
  );
}
