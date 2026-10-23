// Shared by both dashboards. Retained across retries, reloads, and step remounts.
// Fail closed if durable browser storage is unavailable: a retry must not get a new ID.
const key = (dealerId: number) => `iron:final-application:v1:${dealerId}`;
export function applicationId(dealerId: number): string {
  const existing = sessionStorage.getItem(key(dealerId));
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key(dealerId), id);
  return id;
}
export function completeApplication(dealerId: number, id: string) {
  if (sessionStorage.getItem(key(dealerId)) === id) sessionStorage.removeItem(key(dealerId));
}
