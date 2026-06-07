const configuredBase = window.OPENMEDAILAB_API_BASE || "";
export const API_BASE = configuredBase || (location.port === "5173" ? "http://127.0.0.1:8000" : "");

let csrfToken = "";

export class ApiError extends Error {
  constructor(message, response, payload) {
    super(message);
    this.name = "ApiError";
    this.response = response;
    this.payload = payload;
  }
}

export async function initCsrf() {
  const payload = await request("/api/csrf/", { skipCsrf: true });
  csrfToken = payload.csrf_token;
  return csrfToken;
}

export async function request(path, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  const isUnsafe = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isUnsafe && !options.skipCsrf) {
    if (!csrfToken) {
      await initCsrf();
    }
    headers.set("X-CSRFToken", csrfToken);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `请求失败：${response.status}`;
    throw new ApiError(message, response, payload);
  }
  return payload.data;
}

export const api = {
  meta: () => request("/api/meta/"),
  rbac: () => request("/api/rbac/"),
  projectSchema: () => request("/api/project-schema/"),
  themeSpace: (slug) => request(`/api/themes/${encodeURIComponent(slug)}/space/`),
  me: () => request("/api/me/"),
  dashboard: () => request("/api/me/dashboard/"),
  profile: (payload) => request("/api/me/profile/", { method: "PATCH", body: payload }),
  login: (payload) => request("/api/auth/login/", { method: "POST", body: payload }),
  register: (payload) => request("/api/auth/register/", { method: "POST", body: payload }),
  logout: () => request("/api/auth/logout/", { method: "POST", body: {} }),
  projects: (params = {}) => request(`/api/projects/?${new URLSearchParams(cleanParams(params))}`),
  project: (id) => request(`/api/projects/${id}/`),
  follow: (id) => request(`/api/projects/${id}/follow/`, { method: "POST", body: {} }),
  unfollow: (id) => request(`/api/projects/${id}/unfollow/`, { method: "POST", body: {} }),
  score: (id, payload) => request(`/api/projects/${id}/score/`, { method: "POST", body: payload }),
  interest: (id, payload) => request(`/api/projects/${id}/interest/`, { method: "POST", body: payload }),
  claim: (id, payload) => request(`/api/projects/${id}/claim/`, { method: "POST", body: payload }),
  sponsor: (id, payload) => request(`/api/projects/${id}/sponsor/`, { method: "POST", body: payload }),
  adminThemes: () => request("/api/admin/themes/"),
  adminCreateTheme: (payload) => request("/api/admin/themes/", { method: "POST", body: payload }),
  adminUpdateTheme: (id, payload) => request(`/api/admin/themes/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteTheme: (id) => request(`/api/admin/themes/${id}/`, { method: "DELETE", body: {} }),
  adminThemeFiles: (params = {}) => request(`/api/admin/theme-files/?${new URLSearchParams(cleanParams(params))}`),
  adminCreateThemeFile: (payload) => request("/api/admin/theme-files/", { method: "POST", body: payload }),
  adminUpdateThemeFile: (id, payload) => request(`/api/admin/theme-files/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteThemeFile: (id) => request(`/api/admin/theme-files/${id}/`, { method: "DELETE", body: {} }),
  adminProjects: (params = {}) => request(`/api/admin/projects/?${new URLSearchParams(cleanParams(params))}`),
  adminProject: (id) => request(`/api/admin/projects/${id}/`),
  adminCreateProject: (payload) => request("/api/admin/projects/", { method: "POST", body: payload }),
  adminUpdateProject: (id, payload) => request(`/api/admin/projects/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteProject: (id) => request(`/api/admin/projects/${id}/`, { method: "DELETE", body: {} }),
  adminImportProjects: (payload) => request("/api/admin/projects/import-json/", { method: "POST", body: payload })
};

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}
