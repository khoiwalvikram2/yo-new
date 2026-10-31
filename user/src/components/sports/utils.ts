export function formatStart(dateISO: string): { dayMon: string; time: string } {
  const d = new Date(dateISO);
  const day = d.toLocaleDateString([], { day: "2-digit", timeZone: "Asia/Kolkata" });
  const mon = d.toLocaleDateString([], { month: "short", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return { dayMon: `${day} ${mon}`, time };
}

export function getDayBadge(dateISO: string): string {
  const d = new Date(dateISO);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((eventDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short" });
}

export function getSportEmoji(_sport: string): string {
  return "🏏";
}
