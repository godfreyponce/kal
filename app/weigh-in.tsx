"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { WeighIn as WeighInData } from "@/lib/today";

export function WeighIn({
  date,
  latestWeighIn,
}: {
  date: string;
  latestWeighIn: WeighInData | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const weightLb = Number(value);
    if (!Number.isFinite(weightLb) || weightLb <= 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/weigh-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightLb, date }),
      });
      if (!res.ok) throw new Error(await res.text());
      setValue("");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="weigh">
      <div className="wl">
        <div className="kicker">Weekly weigh-in</div>
        <b>
          {latestWeighIn ? (
            <>
              Last {latestWeighIn.weightLb.toFixed(1)} <span>lb&nbsp;&nbsp;{latestWeighIn.date}</span>
            </>
          ) : (
            <span>No weigh-ins yet</span>
          )}
        </b>
      </div>
      <form onSubmit={submit}>
        <input
          type="text"
          inputMode="decimal"
          placeholder="161.4"
          aria-label="Weight in pounds"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn-dark" disabled={saving || isPending || value === ""}>
          Log
        </button>
      </form>
    </div>
  );
}
