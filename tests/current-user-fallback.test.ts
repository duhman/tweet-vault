import test from "node:test";
import assert from "node:assert/strict";
import {
  userIdFromSetCookie,
  resolveCurrentUser,
} from "../scripts/sync-from-bird.js";

test("reads the user id from a twid session cookie", () => {
  assert.equal(
    userIdFromSetCookie(["guest_id=v1%3A1; Path=/", "twid=u%3D12345678; Path=/; Secure"]),
    "12345678",
  );
  assert.equal(userIdFromSetCookie(['twid="u=12345678"; Path=/']), "12345678");
});

test("returns null when no authenticated twid cookie is present", () => {
  assert.equal(userIdFromSetCookie([]), null);
  assert.equal(userIdFromSetCookie(["guest_id=v1%3A1; Path=/"]), null);
  assert.equal(userIdFromSetCookie(["twid=; Max-Age=0"]), null);
});

test("keeps the library result when the lookup succeeds", async () => {
  const user = { id: "1", username: "a", name: "A" };
  const client = { getCurrentUser: async () => ({ success: true, user }) };
  const result = await resolveCurrentUser(client, async () => {
    throw new Error("fallback must not run");
  });
  assert.deepEqual(result, { success: true, user });
});

test("falls back to the session cookie id and makes later lookups use it", async () => {
  const client: any = {
    getCurrentUser: async () => ({ success: false, error: "HTTP 404" }),
  };
  const result = await resolveCurrentUser(client, async () => "12345678");
  assert.equal(result.success, true);
  assert.equal(result.user?.id, "12345678");
  assert.equal((await client.getCurrentUser()).user.id, "12345678");
});

test("reports the original failure when the fallback finds no id", async () => {
  const client = {
    getCurrentUser: async () => ({ success: false, error: "HTTP 404" }),
  };
  const result = await resolveCurrentUser(client, async () => null);
  assert.deepEqual(result, { success: false, error: "HTTP 404" });
});
