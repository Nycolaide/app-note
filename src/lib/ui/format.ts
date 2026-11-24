const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

export function formatUpdated(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedDays = Math.floor((startOfToday - date.getTime()) / DAY_MS) + 1;

  if (date.getTime() >= startOfToday) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (elapsedDays === 1) return "Hier";
  if (elapsedDays < WEEK_DAYS) return capitalize(date.toLocaleDateString([], { weekday: "long" }));
  return date.toLocaleDateString();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatFull(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { dateStyle: "long", timeStyle: "short" });
}
