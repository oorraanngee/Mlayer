export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10); // Using tenths of a second for cleaner display
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}
