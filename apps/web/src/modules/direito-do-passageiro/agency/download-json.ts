/**
 * Hands the person a file of what is kept of a passenger (migration 0072, their right of access), as the browser
 * saves one: nothing of it leaves the person's browser but to their own disk.
 */
export function downloadJson(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
