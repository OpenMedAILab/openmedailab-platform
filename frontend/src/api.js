const configuredBase = window.OPENMEDAILAB_API_BASE || "";
const devApiHost = location.hostname || "127.0.0.1";
export const API_BASE = configuredBase || (location.port === "5173" ? `${location.protocol || "http:"}//${devApiHost}:8000` : "");

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
  if (isCsrfFailure(response, payload) && isUnsafe && !options.skipCsrf && !options.csrfRetry) {
    csrfToken = "";
    await initCsrf();
    return request(path, { ...options, csrfRetry: true });
  }
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `请求失败：${response.status}`;
    throw new ApiError(message, response, payload);
  }
  return payload.data;
}

export async function requestForm(path, formData, options = {}) {
  const method = options.method || "POST";
  const headers = new Headers(options.headers || {});
  if (!csrfToken) {
    await initCsrf();
  }
  headers.set("X-CSRFToken", csrfToken);

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: formData
  });

  const payload = await response.json().catch(() => null);
  if (isCsrfFailure(response, payload) && !options.csrfRetry) {
    csrfToken = "";
    await initCsrf();
    return requestForm(path, formData, { ...options, csrfRetry: true });
  }
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
  changeRequiredPassword: (payload) => request("/api/auth/password/change-required/", { method: "POST", body: payload }),
  logout,
  projects: (params = {}) => request(`/api/projects/?${new URLSearchParams(cleanParams(params))}`),
  project: (id) => request(`/api/projects/${id}/`),
  projectStatusCard: (id) => request(`/api/projects/${id}/status-card/`),
  follow: (id) => request(`/api/projects/${id}/follow/`, { method: "POST", body: {} }),
  unfollow: (id) => request(`/api/projects/${id}/unfollow/`, { method: "POST", body: {} }),
  score: (id, payload) => request(`/api/projects/${id}/score/`, { method: "POST", body: payload }),
  unscore: (id) => request(`/api/projects/${id}/unscore/`, { method: "POST", body: {} }),
  interest: (id, payload) => request(`/api/projects/${id}/interest/`, { method: "POST", body: payload }),
  claim: (id, payload) => request(`/api/projects/${id}/claim/`, { method: "POST", body: payload }),
  sponsor: (id, payload) => request(`/api/projects/${id}/sponsor/`, { method: "POST", body: payload }),
  updateMeTaskStatus: (id, payload) => request(`/api/me/tasks/${id}/status/`, { method: "PATCH", body: payload }),
  createMeContribution: (payload) => request("/api/me/contributions/", { method: "POST", body: payload }),
  withdrawInteraction: (type, id, payload = {}) => request(`/api/me/interactions/${type}/${id}/withdraw/`, { method: "PATCH", body: payload }),
  adminOverview: () => request("/api/admin/overview/"),
  adminThemes: () => request("/api/admin/themes/"),
  adminCreateTheme: (payload) => request("/api/admin/themes/", { method: "POST", body: payload }),
  adminUpdateTheme: (id, payload) => request(`/api/admin/themes/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteTheme: (id) => request(`/api/admin/themes/${id}/`, { method: "DELETE", body: {} }),
  adminThemeFiles: (params = {}) => request(`/api/admin/theme-files/?${new URLSearchParams(cleanParams(params))}`),
  adminCreateThemeFile: (payload) => request("/api/admin/theme-files/", { method: "POST", body: payload }),
  adminUpdateThemeFile: (id, payload) => request(`/api/admin/theme-files/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteThemeFile: (id) => request(`/api/admin/theme-files/${id}/`, { method: "DELETE", body: {} }),
  adminFileSpace: (params = {}) => request(`/api/admin/file-space/?${new URLSearchParams(cleanParams(params))}`),
  adminReadFileSpaceFile: (params = {}) => request(`/api/admin/file-space/file/?${new URLSearchParams(cleanParams(params))}`),
  adminUpdateThemeFileSpaceRoot: (id, payload) => request(`/api/admin/themes/${id}/file-space-root/`, { method: "PATCH", body: payload }),
  adminCreateFileSpaceDirectory: (payload) => request("/api/admin/file-space/directories/", { method: "POST", body: payload }),
  adminCreateFileSpaceFile: (payload) => request("/api/admin/file-space/files/", { method: "POST", body: payload }),
  adminUpdateFileSpaceItem: (payload) => request("/api/admin/file-space/", { method: "PATCH", body: payload }),
  adminDeleteFileSpaceItem: (payload) => request("/api/admin/file-space/", { method: "DELETE", body: payload }),
  adminUploadFileSpaceFiles: (formData) => requestForm("/api/admin/file-space/upload/", formData),
  adminUsers: (params = {}) => request(`/api/admin/users/?${new URLSearchParams(cleanParams(params))}`),
  adminResetUserPassword: (uid) => request(`/api/admin/users/${encodeURIComponent(uid)}/reset-password/`, { method: "POST", body: {} }),
  adminInteractions: (params = {}) => request(`/api/admin/interactions/?${new URLSearchParams(cleanParams(params))}`),
  reviewAdminInteraction: (type, id, payload) => request(`/api/admin/interactions/${type}/${id}/status/`, { method: "PATCH", body: payload }),
  adminTasks: (params = {}) => request(`/api/admin/tasks/?${new URLSearchParams(cleanParams(params))}`),
  createAdminTask: (payload) => request("/api/admin/tasks/", { method: "POST", body: payload }),
  assignAdminTask: (id, payload) => request(`/api/admin/tasks/${id}/assign/`, { method: "POST", body: payload }),
  updateAdminTaskStatus: (id, payload) => request(`/api/admin/tasks/${id}/status/`, { method: "PATCH", body: payload }),
  adminContributions: (params = {}) => request(`/api/admin/contributions/?${new URLSearchParams(cleanParams(params))}`),
  reviewAdminContribution: (id, payload) => request(`/api/admin/contributions/${id}/review/`, { method: "PATCH", body: payload }),
  adminCredits: (params = {}) => request(`/api/admin/credits/?${new URLSearchParams(cleanParams(params))}`),
  adminAuditLogs: (params = {}) => request(`/api/admin/audit-logs/?${new URLSearchParams(cleanParams(params))}`),
  adminProjects: (params = {}) => request(`/api/admin/projects/?${new URLSearchParams(cleanParams(params))}`),
  adminProject: (id) => request(`/api/admin/projects/${id}/`),
  adminImportProjects: (payload) => request("/api/admin/projects/import-json/", { method: "POST", body: payload }),
  adminCreateProject: (payload) => request("/api/admin/projects/", { method: "POST", body: payload }),
  adminUpdateProject: (id, payload) => request(`/api/admin/projects/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteProject: (id) => request(`/api/admin/projects/${id}/`, { method: "DELETE", body: {} }),
  adminBulkArchiveProjects: (payload) => request("/api/admin/projects/bulk-archive/", { method: "POST", body: payload }),
  adminProjectDocuments: (params = {}) => request(`/api/admin/project-documents/?${new URLSearchParams(cleanParams(params))}`),
  adminUploadProjectDocuments: (formData) => requestForm("/api/admin/project-documents/upload/", formData),
  adminUpdateProjectDocument: (id, payload) => request(`/api/admin/project-documents/${id}/`, { method: "PATCH", body: payload }),
  adminDeleteProjectDocument: (id) => request(`/api/admin/project-documents/${id}/`, { method: "DELETE", body: {} })
};

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function isCsrfFailure(response, payload) {
  return response.status === 403 && payload?.error?.code === "csrf_failed";
}

async function logout() {
  try {
    return await request("/api/auth/logout/", { method: "POST", body: {} });
  } catch (error) {
    if (error instanceof ApiError && error.response?.status === 401) {
      return { logged_out: true, already_logged_out: true };
    }
    throw error;
  }
}
