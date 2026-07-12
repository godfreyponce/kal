// app/plan/profile-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProfileView } from "@/lib/profile";

// Plain form (Phase 1). Phase 2 replaces the top of this section with the 3D
// figure; this form remains the underlying editor the figure's regions open.
export function ProfileForm({ profile }: { profile: ProfileView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    weightLb: String(profile.weightLb),
    goalWeightLb: profile.goalWeightLb === null ? "" : String(profile.goalWeightLb),
    heightCm: String(profile.heightCm),
    age: String(profile.age),
    sex: profile.sex,
    bodyFatPct: profile.bodyFatPct === null ? "" : String(profile.bodyFatPct),
    activityLevel: profile.activityLevel ?? "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  async function save() {
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weightLb: Number(form.weightLb),
        goalWeightLb: form.goalWeightLb === "" ? null : Number(form.goalWeightLb),
        heightCm: Number(form.heightCm),
        age: Number(form.age),
        sex: form.sex,
        bodyFatPct: form.bodyFatPct === "" ? null : Number(form.bodyFatPct),
        activityLevel: form.activityLevel || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "save failed");
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="plan-card">
      {error && <div className="gr-error">{error}</div>}
      <div className="plan-grid">
        <label>
          <span className="plan-lbl">Weight (lb)</span>
          <input className="plan-inp" inputMode="decimal" value={form.weightLb} onChange={set("weightLb")} />
        </label>
        <label>
          <span className="plan-lbl">Goal weight (lb)</span>
          <input className="plan-inp" inputMode="decimal" value={form.goalWeightLb} onChange={set("goalWeightLb")} />
        </label>
        <label>
          <span className="plan-lbl">Height (cm)</span>
          <input className="plan-inp" inputMode="numeric" value={form.heightCm} onChange={set("heightCm")} />
        </label>
        <label>
          <span className="plan-lbl">Age</span>
          <input className="plan-inp" inputMode="numeric" value={form.age} onChange={set("age")} />
        </label>
        <label>
          <span className="plan-lbl">Sex</span>
          <input className="plan-inp" value={form.sex} onChange={set("sex")} />
        </label>
        <label>
          <span className="plan-lbl">Body fat (%)</span>
          <input className="plan-inp" inputMode="decimal" value={form.bodyFatPct} onChange={set("bodyFatPct")} />
        </label>
        <label>
          <span className="plan-lbl">Activity</span>
          <input className="plan-inp" value={form.activityLevel} onChange={set("activityLevel")} />
        </label>
      </div>

      <div className="plan-targets">
        <span className="plan-lbl">Daily targets derived from the meal plan</span>
        <span className="plan-targets-v">
          {profile.targetKcal} kcal&ensp;
          <b className="mac-p">P {profile.targetProteinG}</b>&ensp;
          <b className="mac-c">C {profile.targetCarbsG}</b>&ensp;
          <b className="mac-f">F {profile.targetFatG}</b>
        </span>
      </div>

      <button className="btn-dark plan-save" onClick={save} disabled={pending}>
        {saved ? "Saved ✓" : pending ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
