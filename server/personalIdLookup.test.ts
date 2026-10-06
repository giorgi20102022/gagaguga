import assert from "node:assert/strict";
import { after, test } from "node:test";
import axios, { AxiosError, type AxiosAdapter } from "axios";
import { runPersonalIdLookup } from "./personalIdLookup.ts";

const primaryUrl = "https://primary-lookup.test/check";
const registryUrl = "https://n8n.srv1020074.hstgr.cloud/webhook/meorenabiji";
const personalId = "01012345678";
const unavailableMessage = "პირადი ნომრის შემოწმება ვერ მოხერხდა. სცადეთ თავიდან.";
const duplicate = {
  success: false, status: "error", error: "PERSONAL_NUMBER_EXISTS",
  message: "ეს პირადი ნომერი უკვე არსებობს რეესტრში",
};
const available = { success: true, status: "success", message: "პირადი ნომერი რეესტრში არ არსებობს" };
const missing = { success: true, status: "not_found", message: "available", personalId };
const originalAdapter = axios.defaults.adapter;
const originalWebhook = process.env.PERSONAL_ID_LOOKUP_WEBHOOK;
process.env.PERSONAL_ID_LOOKUP_WEBHOOK = primaryUrl;
after(() => {
  axios.defaults.adapter = originalAdapter;
  if (originalWebhook === undefined) delete process.env.PERSONAL_ID_LOOKUP_WEBHOOK;
  else process.env.PERSONAL_ID_LOOKUP_WEBHOOK = originalWebhook;
});

function mockLookup(primary: unknown, registry: unknown = available, status = 200) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config.url!);
    if (config.url === primaryUrl) {
      return { data: await primary, status: 200, statusText: "OK", headers: {}, config };
    }
    assert.equal(config.url, registryUrl);
    assert.equal(config.method, "post");
    assert.deepEqual(JSON.parse(config.data), { personalNumber: personalId });
    assert.equal(config.timeout, 15_000);
    if (registry instanceof Error) throw registry;
    const response = { data: registry, status, statusText: "", headers: {}, config };
    if (!config.validateStatus!(status)) throw new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, undefined, response);
    return response;
  };
  axios.defaults.adapter = adapter;
  return calls;
}

test("existing beneficiary results and primary failures never call the registry", async () => {
  for (const primary of [
    { success: false, status: "already_used", message: "existing error", personalId },
    { success: true, status: "eligible", message: "existing success", personalId },
    { success: false, status: "error", message: "lookup failed", personalId },
    { success: false, status: "not_found", message: "unconfirmed miss", personalId },
  ]) {
    const calls = mockLookup(primary);
    const result = await runPersonalIdLookup(personalId);
    assert.deepEqual(result, { ...primary, portalMessage: undefined });
    assert.deepEqual(calls, [primaryUrl]);
  }
});

test("waits for the primary lookup before posting, and for the registry before success", async () => {
  let resolvePrimary!: (value: unknown) => void;
  let resolveRegistry!: (value: unknown) => void;
  const primary = new Promise((resolve) => { resolvePrimary = resolve; });
  const registry = new Promise((resolve) => { resolveRegistry = resolve; });
  const calls = mockLookup(primary, registry);
  // Axios adapters resolve their response data; mirror that for the deferred response.
  const adapter = axios.defaults.adapter as AxiosAdapter;
  axios.defaults.adapter = async (config) => {
    const response = await adapter(config);
    return { ...response, data: await response.data };
  };
  let finished = false;
  const pending = runPersonalIdLookup(personalId).then((result) => { finished = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [primaryUrl]);
  resolvePrimary(missing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [primaryUrl, registryUrl]);
  assert.equal(finished, false);
  resolveRegistry(available);
  assert.deepEqual(await pending, { ...available, personalId });
});

test("registry duplicates block continuation and preserve the Georgian message", async () => {
  for (const status of [200, 409]) {
    const calls = mockLookup(missing, duplicate, status);
    const result = await runPersonalIdLookup(personalId);
    assert.deepEqual(result, { ...duplicate, personalId });
    assert.deepEqual(calls, [primaryUrl, registryUrl]);
  }
});

test("network, timeout, invalid JSON and unexpected responses fail closed", async () => {
  for (const [payload, status] of [
    [new AxiosError("Network failure", "ERR_NETWORK"), 200],
    [new AxiosError("Timeout", "ECONNABORTED"), 200],
    ["{invalid JSON", 200], [null, 200], [[], 200], [{}, 200],
    [{ success: "true", status: "success" }, 200],
    [{ success: true, status: "error" }, 200],
    [{ ...available, error: "PERSONAL_NUMBER_EXISTS" }, 200],
    [available, 500], [duplicate, 503], [available, 400],
  ] as const) {
    mockLookup(missing, payload, status);
    const result = await runPersonalIdLookup(personalId);
    assert.equal(result.success, false);
    assert.equal(result.message, unavailableMessage);
    assert.equal(result.personalId, personalId);
  }
});

test("a failed registry check can be retried successfully", async () => {
  mockLookup(missing, new AxiosError("Network failure"));
  assert.equal((await runPersonalIdLookup(personalId)).success, false);
  const calls = mockLookup(missing);
  assert.equal((await runPersonalIdLookup(personalId)).success, true);
  assert.deepEqual(calls, [primaryUrl, registryUrl]);
});

test("registration behavior is unchanged", async () => {
  const calls = mockLookup(missing);
  assert.equal((await runPersonalIdLookup(personalId, { mode: "register" })).status, "not_found");
  assert.deepEqual(calls, [primaryUrl]);
});
