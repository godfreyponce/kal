"use client";

export function SignOut() {
  return (
    <button
      type="button"
      className="chat-link"
      style={{ cursor: "pointer" }}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
