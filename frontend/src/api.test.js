import assert from "node:assert/strict";
import { test } from "node:test";

test("unsafe requests refresh csrf token and retry once after csrf failure", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || "GET",
      csrf: options.headers?.get("X-CSRFToken") || null
    });

    if (calls.length === 1) {
      return jsonResponse(200, { ok: true, data: { csrf_token: "stale-token" } });
    }
    if (calls.length === 2) {
      assert.equal(calls[1].csrf, "stale-token");
      return jsonResponse(403, {
        ok: false,
        error: { code: "csrf_failed", message: "CSRF check failed." }
      });
    }
    if (calls.length === 3) {
      return jsonResponse(200, { ok: true, data: { csrf_token: "fresh-token" } });
    }
    if (calls.length === 4) {
      assert.equal(calls[3].csrf, "fresh-token");
      return jsonResponse(200, { ok: true, data: { logged_out: true } });
    }

    throw new Error(`Unexpected fetch call ${calls.length}`);
  };

  const { api } = await import(`./api.js?csrf-retry=${Date.now()}`);

  const result = await api.logout();

  assert.deepEqual(result, { logged_out: true });
  assert.deepEqual(calls.map(({ url, method, csrf }) => ({ url, method, csrf })), [
    { url: "http://127.0.0.1:8000/api/csrf/", method: "GET", csrf: null },
    { url: "http://127.0.0.1:8000/api/auth/logout/", method: "POST", csrf: "stale-token" },
    { url: "http://127.0.0.1:8000/api/csrf/", method: "GET", csrf: null },
    { url: "http://127.0.0.1:8000/api/auth/logout/", method: "POST", csrf: "fresh-token" }
  ]);
});

test("logout resolves when the server session is already expired", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || "GET",
      csrf: options.headers?.get("X-CSRFToken") || null
    });

    if (calls.length === 1) {
      return jsonResponse(200, { ok: true, data: { csrf_token: "logout-token" } });
    }
    if (calls.length === 2) {
      return jsonResponse(401, {
        ok: false,
        error: { code: "auth_required", message: "Authentication required." }
      });
    }

    throw new Error(`Unexpected fetch call ${calls.length}`);
  };

  const { api } = await import(`./api.js?expired-logout=${Date.now()}`);

  const result = await api.logout();

  assert.deepEqual(result, { logged_out: true, already_logged_out: true });
  assert.deepEqual(calls.map(({ url, method, csrf }) => ({ url, method, csrf })), [
    { url: "http://127.0.0.1:8000/api/csrf/", method: "GET", csrf: null },
    { url: "http://127.0.0.1:8000/api/auth/logout/", method: "POST", csrf: "logout-token" }
  ]);
});

test("auth api does not expose email verification or email password reset methods", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };
  globalThis.fetch = async () => {
    throw new Error("No network calls expected");
  };

  const { api } = await import(`./api.js?removed-auth-email-flows=${Date.now()}`);

  assert.equal(api.requestEmailVerification, undefined);
  assert.equal(api.confirmEmailVerification, undefined);
  assert.equal(api.requestPasswordReset, undefined);
  assert.equal(api.confirmPasswordReset, undefined);
});

test("workspace lifecycle api wrappers are exposed", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };
  globalThis.fetch = async () => {
    throw new Error("No network calls expected");
  };

  const { api } = await import(`./api.js?workspace-lifecycle=${Date.now()}`);

  [
    "projectStatusCard",
    "updateMeTaskStatus",
    "createMeContribution",
    "withdrawInteraction",
    "adminOverview",
    "adminInteractions",
    "reviewAdminInteraction",
    "adminTasks",
    "createAdminTask",
    "assignAdminTask",
    "updateAdminTaskStatus",
    "adminContributions",
    "reviewAdminContribution",
    "adminCredits",
    "adminAuditLogs"
  ].forEach((method) => assert.equal(typeof api[method], "function", `${method} should be exposed`));
});

test("project lifecycle api does not expose legacy json import wrapper", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };
  globalThis.fetch = async () => {
    throw new Error("No network calls expected");
  };

  const { api } = await import(`./api.js?project-lifecycle-no-json-import=${Date.now()}`);

  assert.equal(api.adminImportProjects, undefined);
  assert.equal(typeof api.adminCreateProject, "function");
  assert.equal(typeof api.adminUpdateProject, "function");
  assert.equal(typeof api.adminProjects, "function");
});

test("project lifecycle api reuses admin project update/delete instead of redundant stage wrappers", async () => {
  globalThis.window = { OPENMEDAILAB_API_BASE: "" };
  globalThis.location = { port: "5173" };
  globalThis.fetch = async () => {
    throw new Error("No network calls expected");
  };

  const { api } = await import(`./api.js?project-lifecycle-stage-wrapper-check=${Date.now()}`);

  ["publishProject", "startProject", "pauseProject", "archiveProject"].forEach((method) => {
    assert.equal(api[method], undefined);
  });
  assert.equal(typeof api.adminUpdateProject, "function");
  assert.equal(typeof api.adminDeleteProject, "function");
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
