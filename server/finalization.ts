export type Context = { submissionId: string; dealerId: number; requestId: string; endpoint: string };
type Result = { success: true; submissionId: string; message: string };
export type Entry = { dealer_id: number; state: "processing" | "completed" | "uncertain"; result: Result | null; updated_at: Date };
export interface FinalizationStore {
  claim(context: Context): Promise<boolean>;
  get(id: string): Promise<Entry | undefined>;
  settle(id: string, state: "completed" | "uncertain", result?: Result): Promise<void>;
}
// A single INSERT against the primary key is the cross-process exclusion boundary.
// Never use a SELECT-then-INSERT, an expiring lock, or an in-memory fallback here.
export class PostgresFinalizationStore implements FinalizationStore {
  constructor(private db: { query: (sql: string, values?: any[]) => Promise<any> }) {}
  async claim(c: Context) {
    const r = await this.db.query(`INSERT INTO final_submissions
      (submission_id, dealer_id, state, request_id, endpoint)
      VALUES ($1, $2, 'processing', $3, $4) ON CONFLICT (submission_id) DO NOTHING RETURNING submission_id`,
    [c.submissionId, c.dealerId, c.requestId, c.endpoint]);
    return r.rows.length === 1;
  }
  async get(id: string): Promise<Entry | undefined> {
    return (await this.db.query("SELECT * FROM final_submissions WHERE submission_id = $1", [id])).rows[0];
  }
  async settle(id: string, state: "completed" | "uncertain", result?: Result) {
    await this.db.query(`UPDATE final_submissions SET state = $2, result = $3, updated_at = now()
      WHERE submission_id = $1 AND state = 'processing'`, [id, state, result ? JSON.stringify(result) : null]);
  }
}

const uncertainMessage = "გაგზავნის შედეგი დაუდასტურებელია. არ შექმნათ ახალი განაცხადი; დაუკავშირდით ადმინისტრატორს განაცხადის ID-ით.";
export class FinalizationService {
  constructor(private store: FinalizationStore,
    private dispatch: (payload: any) => Promise<{ status: number; data: any }>) {}
  private log(c: Context, outcome: string) {
    // Deliberately exclude payloads, downstream response/error objects, and credentials.
    console.info("[finalization]", JSON.stringify({ submissionId: c.submissionId,
      requestId: c.requestId, endpoint: c.endpoint, dispatchAttempt: 1, outcome }));
  }
  async status(id: string, dealerId: number) {
    const entry = await this.store.get(id);
    if (!entry || entry.dealer_id !== dealerId) return undefined;
    // A crashed process may leave processing forever. Surface reconciliation, never
    // reclaim it automatically: dispatch may have happened before the process died.
    const uncertain = entry.state === "uncertain" ||
      (entry.state === "processing" && Date.now() - new Date(entry.updated_at).getTime() > 10 * 60_000);
    return { submissionId: id, status: entry.state === "completed" ? "success" : uncertain ? "uncertain" : "pending",
      message: uncertain ? `${uncertainMessage} ID: ${id}` : entry.result?.message,
      data: entry.result, queuePosition: 0, dispatched: true };
  }
  async submit(c: Context, payload: any, afterSuccess?: () => Promise<void>) {
    this.log(c, "received");
    if (!await this.store.claim(c)) {
      const existing = await this.status(c.submissionId, c.dealerId);
      if (!existing) {
        this.log(c, "ownership_conflict");
        return { httpStatus: 409, body: { code: "SUBMISSION_ID_CONFLICT", message: "Submission ID unavailable" } };
      }
      this.log(c, `duplicate_${existing.status}`);
      if (existing.status === "success") return { httpStatus: 200, body: existing.data! };
      if (existing.status === "uncertain") return { httpStatus: 409, body: { ...existing, code: "SUBMISSION_UNCERTAIN" } };
      return { httpStatus: 202, body: { ...existing, success: false, queued: true, code: "SUBMISSION_IN_PROGRESS" } };
    }
    this.log(c, "claimed");
    try {
      this.log(c, "dispatch_requested");
      const reply = await this.dispatch({ ...payload, submissionId: c.submissionId, submission_id: c.submissionId, requestId: c.requestId, endpoint: c.endpoint, dispatchAttempt: 1 });
      const body = reply.data;
      const message = body?.message || body?.data?.message || "";
      // Preserve the existing business acknowledgement, including accepted RDA errors.
      const acknowledged = body?.success === true || message === "ყველაფერი წარმატებით დასრულდა" ||
        message.includes("სოფლის განვითარების") || message.includes("ბენეფიციარის") || message.includes("IT დეპარტამენტის");
      if (reply.status < 200 || reply.status >= 300 || body?.success === false ||
        body?.status === "error" || body?.status === "rejected" || !acknowledged) throw new Error("Unconfirmed delivery");
      const result: Result = { success: true, submissionId: c.submissionId, message: "ყველაფერი წარმატებით დასრულდა" };
      await this.store.settle(c.submissionId, "completed", result);
      this.log(c, "completed");
      // A secondary oven-code failure must never make a confirmed final submission retryable.
      try { await afterSuccess?.(); }
      catch { this.log(c, "oven_code_reconciliation_required"); }
      return { httpStatus: 200, body: result };
    } catch {
      this.log(c, "uncertain");
      await this.store.settle(c.submissionId, "uncertain");
      return { httpStatus: 409, body: { submissionId: c.submissionId, code: "SUBMISSION_UNCERTAIN", message: `${uncertainMessage} ID: ${c.submissionId}` } };
    }
  }
}
