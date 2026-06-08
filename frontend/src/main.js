import { createApp, computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { api, initCsrf } from "./api.js";

const PAGE_SIZE = 9;

const state = reactive({
  booting: true,
  loading: false,
  loadingMore: false,
  toast: "",
  route: parseRoute(),
  user: null,
  rbac: null,
  meta: {
    themes: [],
    tags: [],
    project_stages: [],
    profile_roles: [],
    participation_roles: [],
    claim_types: [],
    sponsor_types: []
  },
  projects: [],
  pagination: {},
  hasMoreProjects: true,
  filters: {
    q: "",
    theme: "",
    tag: "",
    stage: "",
    has_pdf: "",
    sort: "recommended",
    page: 1,
    page_size: PAGE_SIZE
  },
  currentProject: null,
  preview: {
    open: false,
    maximized: false,
    loading: false,
    returnScroll: 0,
    returnProjectId: null
  },
  themeSpace: null,
  dashboard: null,
  schema: null,
  admin: {
    activeTab: "projects",
    themes: [],
    projects: [],
    projectPagination: {},
    projectFilters: { q: "", theme: "", page: 1, page_size: 50 },
    hasMoreProjects: false,
    loadingProjects: false,
    projectForm: emptyProjectForm(),
    themeForm: emptyThemeForm(),
    selectedThemeId: null,
    themeFiles: [],
    themeFilePagination: {},
    themeFileForm: emptyThemeFileForm(),
    users: [],
    userPagination: {},
    userFilters: { q: "", page: 1, page_size: 50 },
    loadingUsers: false,
    resettingUid: "",
    passwordResetResult: null,
    importText: ""
  },
  forms: {
    login: { username: "", password: "" },
    register: { username: "", email: "", display_name: "", role_type: "student", password1: "", password2: "" },
    passwordChange: { password1: "", password2: "" },
    score: { score: 8, comment: "" },
    interest: { role: "学生", available_hours_per_week: 4, experience: "", message: "" },
    claim: { claim_type: "literature", message: "" },
    sponsor: { sponsor_type: "compute", note: "" }
  },
  formState: {
    registerSubmitting: false,
    registerErrors: {},
    passwordChangeSubmitting: false,
    passwordChangeErrors: {}
  }
});

const App = {
  setup() {
    const activeView = computed(() => state.route.name);
    const roleInfo = computed(() => state.user?.rbac || state.rbac || { role: "guest", role_label: "访客", capabilities: {} });
    const capabilities = computed(() => roleInfo.value.capabilities || {});
    const stats = computed(() => ({
      total: state.pagination.total_count || state.projects.length,
      themes: state.meta.themes.length,
      follows: state.projects.reduce((sum, item) => sum + (item.follow_count || 0), 0),
      interests: state.projects.reduce((sum, item) => sum + (item.interest_count || 0), 0)
    }));
    const navItems = computed(() => {
      if (requiresPasswordChange()) return [];
      const items = [
        { name: "home", label: "课题库" },
        { name: "space", label: "文件空间" }
      ];
      if (state.user) items.push({ name: "dashboard", label: "我的协作" });
      if (can("view_admin_console")) items.push({ name: "admin", label: "管理" });
      return items;
    });
    const selectedTheme = computed(() => state.meta.themes.find((theme) => theme.slug === state.filters.theme) || null);
    const selectedSpaceSlug = computed(() => state.route.params.slug || selectedTheme.value?.slug || state.meta.themes[0]?.slug || "");
    const selectedAdminTheme = computed(() => state.admin.themes.find((theme) => theme.id === Number(state.admin.selectedThemeId)) || null);
    const roleCards = computed(() => roleCardsFor(capabilities.value));

    onMounted(async () => {
      window.addEventListener("hashchange", handleRouteChange);
      window.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("keydown", handleKeydown);
      await boot();
    });

    onBeforeUnmount(() => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeydown);
    });

    watch(
      () => state.route.fullPath,
      async () => {
        await loadRouteData();
      }
    );

    async function boot() {
      state.booting = true;
      try {
        await initCsrf();
        const [meta, rbac, user, schema] = await Promise.all([
          api.meta(),
          api.rbac(),
          api.me().catch(() => null),
          api.projectSchema()
        ]);
        state.meta = meta;
        state.rbac = rbac;
        state.user = user;
        state.schema = schema;
        state.admin.importText = JSON.stringify({ themes: [], projects: [schema.example] }, null, 2);
        state.booting = false;
        if (requiresPasswordChange() && state.route.name !== "password-change") {
          navigate("password-change");
          return;
        }
        await loadRouteData();
      } catch (error) {
        showToast(error.message || "系统初始化失败");
      } finally {
        state.booting = false;
      }
    }

    async function loadRouteData() {
      if (state.booting) return;
      if (requiresPasswordChange() && state.route.name !== "password-change") {
        navigate("password-change");
        return;
      }
      if (["home", "projects"].includes(state.route.name)) {
        await loadProjects({ reset: true });
      }
      if (state.route.name === "project" && state.route.params.id) {
        await loadProject(state.route.params.id);
      }
      if (state.route.name === "space") {
        await loadThemeSpace(selectedSpaceSlug.value);
      }
      if (state.route.name === "dashboard") {
        await loadDashboard();
      }
      if (state.route.name === "admin") {
        await loadAdmin();
      }
    }

    async function loadProjects({ reset = false } = {}) {
      if (reset) {
        state.filters.page = 1;
        state.projects = [];
        state.hasMoreProjects = true;
      }
      if (!state.hasMoreProjects || state.loadingMore) return;
      state.loadingMore = true;
      state.loading = reset;
      try {
        const data = await api.projects(state.filters);
        const existing = new Set(state.projects.map((item) => item.id));
        const fresh = data.results.filter((item) => !existing.has(item.id));
        state.projects = reset ? data.results : [...state.projects, ...fresh];
        state.pagination = data.pagination;
        state.hasMoreProjects = Boolean(data.pagination?.has_next);
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
        state.loadingMore = false;
      }
    }

    async function loadMoreProjects() {
      if (!state.hasMoreProjects || state.loadingMore || state.loading) return;
      state.filters.page += 1;
      await loadProjects();
    }

    async function loadProject(id, options = {}) {
      const isPreview = Boolean(options.preview);
      if (isPreview) {
        state.preview.loading = true;
      } else {
        state.loading = true;
      }
      state.currentProject = null;
      try {
        state.currentProject = await api.project(id);
        state.forms.score.score = state.currentProject.viewer_state?.score?.score || 8;
        state.forms.score.comment = state.currentProject.viewer_state?.score?.comment || "";
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
        state.preview.loading = false;
      }
    }

    async function openProjectPreview(project) {
      const projectId = project.id || project;
      state.preview.returnScroll = window.scrollY;
      state.preview.returnProjectId = projectId;
      state.preview.open = true;
      state.preview.maximized = false;
      await loadProject(projectId, { preview: true });
    }

    function closeProjectPreview() {
      const returnScroll = state.preview.returnScroll;
      const returnProjectId = state.preview.returnProjectId;
      state.preview.open = false;
      state.preview.maximized = false;
      window.requestAnimationFrame(() => {
        const card = document.querySelector(`[data-project-id="${returnProjectId}"]`);
        if (card) {
          const top = card.getBoundingClientRect().top + window.scrollY - 120;
          window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
        } else {
          window.scrollTo({ top: returnScroll, behavior: "auto" });
        }
      });
    }

    function toggleProjectPreviewSize() {
      state.preview.maximized = !state.preview.maximized;
    }

    async function loadThemeSpace(slug) {
      if (!slug) return;
      state.loading = true;
      try {
        state.themeSpace = await api.themeSpace(slug);
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadDashboard() {
      if (!state.user) {
        navigate("login");
        return;
      }
      state.loading = true;
      try {
        state.dashboard = await api.dashboard();
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadAdmin() {
      if (!can("view_admin_console")) return;
      state.loading = true;
      try {
        const themes = await api.adminThemes();
        state.admin.themes = themes.results;
        if (!state.admin.selectedThemeId && themes.results.length) {
          state.admin.selectedThemeId = themes.results[0].id;
        }
        await Promise.all([loadAdminProjects({ reset: true }), loadThemeFiles(), loadAdminUsers({ reset: true })]);
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadAdminProjects({ reset = false } = {}) {
      if (reset) {
        state.admin.projectFilters.page = 1;
        state.admin.projects = [];
      }
      state.admin.loadingProjects = true;
      try {
        const data = await api.adminProjects(state.admin.projectFilters);
        const existing = new Set(state.admin.projects.map((item) => item.id));
        const fresh = data.results.filter((item) => !existing.has(item.id));
        state.admin.projects = reset ? data.results : [...state.admin.projects, ...fresh];
        state.admin.projectPagination = data.pagination;
        state.admin.hasMoreProjects = Boolean(data.pagination?.has_next);
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingProjects = false;
      }
    }

    async function searchAdminProjects() {
      await loadAdminProjects({ reset: true });
    }

    async function loadMoreAdminProjects() {
      if (!state.admin.hasMoreProjects || state.admin.loadingProjects) return;
      state.admin.projectFilters.page += 1;
      await loadAdminProjects();
    }

    async function loadAdminUsers({ reset = false } = {}) {
      if (!can("manage_users")) return;
      if (reset) {
        state.admin.userFilters.page = 1;
        state.admin.users = [];
        state.admin.passwordResetResult = null;
      }
      state.admin.loadingUsers = true;
      try {
        const data = await api.adminUsers(state.admin.userFilters);
        state.admin.users = data.results;
        state.admin.userPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingUsers = false;
      }
    }

    async function searchAdminUsers() {
      await loadAdminUsers({ reset: true });
    }

    async function resetUserPassword(user) {
      if (!can("manage_users") || state.admin.resettingUid) return;
      const uid = user.profile?.uid;
      if (!uid) return;
      const confirmed = window.confirm(`确认将「${user.username}」恢复为系统默认密码吗？`);
      if (!confirmed) return;
      state.admin.resettingUid = uid;
      state.admin.passwordResetResult = null;
      try {
        const data = await api.adminResetUserPassword(uid);
        state.admin.passwordResetResult = data;
        await loadAdminUsers();
        showToast("已恢复为系统统一默认密码，请线下告知用户。");
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.resettingUid = "";
      }
    }

    async function copyDefaultPassword() {
      const password = state.admin.passwordResetResult?.default_password;
      if (!password) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(password);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = password;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        showToast("默认密码已复制。");
      } catch (error) {
        showToast("复制失败，请手动复制。");
      }
    }

    async function applyFilters() {
      navigate("projects");
      await loadProjects({ reset: true });
    }

    async function selectTheme(slug = "") {
      state.filters.theme = slug;
      await applyFilters();
    }

    async function selectSpace(slug) {
      navigate("space", { slug });
    }

    async function login() {
      try {
        state.user = await api.login(state.forms.login);
        state.rbac = state.user.rbac;
        showToast("登录成功");
        navigate(requiresPasswordChange() ? "password-change" : "dashboard");
      } catch (error) {
        showToast(error.message);
      }
    }

    async function changeRequiredPassword() {
      if (state.formState.passwordChangeSubmitting) return;
      state.formState.passwordChangeErrors = {};
      const form = state.forms.passwordChange;
      if (!form.password1) {
        state.formState.passwordChangeErrors = { password1: ["请输入新密码。"] };
        showToast("请输入新密码。");
        return;
      }
      if (form.password1 !== form.password2) {
        state.formState.passwordChangeErrors = { password2: ["两次输入的密码不一致。"] };
        showToast("两次输入的密码不一致。");
        return;
      }
      state.formState.passwordChangeSubmitting = true;
      try {
        await api.changeRequiredPassword(form);
        state.user = null;
        state.dashboard = null;
        state.forms.login.password = "";
        state.forms.passwordChange = { password1: "", password2: "" };
        state.rbac = await api.rbac();
        showToast("密码已修改，请使用新密码重新登录。");
        navigate("login");
      } catch (error) {
        const errors = errorsFromApi(error);
        state.formState.passwordChangeErrors = errors;
        showToast(firstErrorMessage(errors, error.message));
      } finally {
        state.formState.passwordChangeSubmitting = false;
      }
    }

    async function register() {
      if (state.formState.registerSubmitting) return;
      state.formState.registerErrors = {};
      const clientErrors = validateRegisterForm();
      if (hasAnyErrors(clientErrors)) {
        state.formState.registerErrors = clientErrors;
        showToast(firstErrorMessage(clientErrors, "请检查注册信息。"));
        return;
      }
      state.formState.registerSubmitting = true;
      try {
        state.user = await api.register(state.forms.register);
        state.rbac = state.user.rbac;
        showToast("注册成功");
        navigate("dashboard");
      } catch (error) {
        const errors = errorsFromApi(error);
        state.formState.registerErrors = errors;
        showToast(firstErrorMessage(errors, error.message));
      } finally {
        state.formState.registerSubmitting = false;
      }
    }

    async function logout() {
      await api.logout();
      state.user = null;
      state.dashboard = null;
      state.rbac = await api.rbac();
      showToast("已退出");
      navigate("home");
    }

    async function toggleFollow(project) {
      if (!ensureLogin()) return;
      try {
        if (project.viewer_state?.is_following) {
          await api.unfollow(project.id);
          project.viewer_state.is_following = false;
          showToast("已取消关注");
        } else {
          await api.follow(project.id);
          project.viewer_state = { ...(project.viewer_state || {}), is_following: true };
          showToast("已关注课题");
        }
      } catch (error) {
        showToast(error.message);
      }
    }

    async function submitScore() {
      if (!ensureLogin()) return;
      await submitInteraction(() => api.score(state.currentProject.id, state.forms.score), "评分已记录");
    }

    async function submitInterest() {
      if (!ensureLogin()) return;
      await submitInteraction(() => api.interest(state.currentProject.id, state.forms.interest), "参与意向已提交");
    }

    async function submitClaim() {
      if (!ensureLogin()) return;
      await submitInteraction(() => api.claim(state.currentProject.id, state.forms.claim), "认领意向已提交");
    }

    async function submitSponsor() {
      if (!ensureLogin()) return;
      await submitInteraction(() => api.sponsor(state.currentProject.id, state.forms.sponsor), "资助意向已记录");
    }

    async function submitInteraction(action, message) {
      try {
        await action();
        showToast(message);
        await loadProject(state.currentProject.id);
      } catch (error) {
        showToast(error.message);
      }
    }

    async function saveTheme() {
      if (!can("manage_themes")) return;
      try {
        const payload = {
          name: state.admin.themeForm.name,
          slug: state.admin.themeForm.slug,
          description: state.admin.themeForm.description,
          file_space: parseJsonOrFallback(state.admin.themeForm.file_space, {}),
          sort_order: Number(state.admin.themeForm.sort_order || 0),
          is_active: state.admin.themeForm.is_active
        };
        if (state.admin.themeForm.id) {
          await api.adminUpdateTheme(state.admin.themeForm.id, payload);
          showToast("主题已更新");
        } else {
          await api.adminCreateTheme(payload);
          showToast("主题已创建");
        }
        state.admin.themeForm = emptyThemeForm();
        await loadAdmin();
        state.meta = await api.meta();
      } catch (error) {
        showToast(error.message);
      }
    }

    function editTheme(theme) {
      state.admin.themeForm = {
        id: theme.id,
        name: theme.name,
        slug: theme.slug,
        description: theme.description || "",
        file_space: JSON.stringify(theme.file_space || {}, null, 2),
        sort_order: theme.sort_order || 0,
        is_active: theme.is_active
      };
    }

    async function deactivateTheme(theme) {
      if (!can("manage_themes")) return;
      await api.adminDeleteTheme(theme.id);
      showToast("主题已停用");
      await loadAdmin();
      state.meta = await api.meta();
    }

    function newTheme() {
      state.admin.themeForm = emptyThemeForm();
    }

    function newProject() {
      state.admin.projectForm = emptyProjectForm();
    }

    async function editProject(project) {
      if (!can("manage_projects")) return;
      try {
        const detail = await api.adminProject(project.id);
        state.admin.projectForm = projectToForm(detail);
        state.admin.activeTab = "projects";
        window.requestAnimationFrame(() => {
          document.querySelector("#admin-project-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } catch (error) {
        showToast(error.message);
      }
    }

    async function saveProject() {
      if (!can("manage_projects")) return;
      try {
        const payload = projectFormPayload(state.admin.projectForm);
        if (!payload.topic_id || !payload.title) {
          showToast("课题 ID 和标题不能为空");
          return;
        }
        if (state.admin.projectForm.id) {
          await api.adminUpdateProject(state.admin.projectForm.id, payload);
          showToast("课题已更新");
        } else {
          await api.adminCreateProject(payload);
          showToast("课题已创建");
        }
        state.admin.projectForm = emptyProjectForm();
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "课题保存失败");
      }
    }

    async function archiveProject(project) {
      if (!can("manage_projects")) return;
      const confirmed = window.confirm(`确认删除课题「${project.title}」吗？系统会做归档停用，不会物理删除历史数据。`);
      if (!confirmed) return;
      try {
        await api.adminDeleteProject(project.id);
        showToast("课题已删除并归档");
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message);
      }
    }

    async function selectAdminTheme(themeId) {
      state.admin.selectedThemeId = Number(themeId);
      state.admin.themeFileForm = emptyThemeFileForm(Number(themeId));
      await loadThemeFiles();
    }

    async function loadThemeFiles() {
      if (!can("manage_themes") || !state.admin.selectedThemeId) {
        state.admin.themeFiles = [];
        return;
      }
      try {
        const data = await api.adminThemeFiles({ theme_id: state.admin.selectedThemeId, page_size: 500 });
        state.admin.themeFiles = data.results;
        state.admin.themeFilePagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      }
    }

    function editThemeFile(file) {
      state.admin.themeFileForm = {
        id: file.id,
        theme_id: file.theme_id,
        section: file.section || "数据集文件",
        file_type: file.file_type || "other",
        title: file.title || "",
        description: file.description || "",
        path: file.path || "",
        sort_order: file.sort_order || 0,
        is_active: file.is_active
      };
    }

    function newThemeFile() {
      state.admin.themeFileForm = emptyThemeFileForm(state.admin.selectedThemeId);
    }

    async function saveThemeFile() {
      if (!can("manage_themes")) return;
      try {
        const payload = {
          theme_id: Number(state.admin.themeFileForm.theme_id || state.admin.selectedThemeId),
          section: state.admin.themeFileForm.section,
          file_type: state.admin.themeFileForm.file_type,
          title: state.admin.themeFileForm.title,
          description: state.admin.themeFileForm.description,
          path: state.admin.themeFileForm.path,
          sort_order: Number(state.admin.themeFileForm.sort_order || 0),
          is_active: state.admin.themeFileForm.is_active
        };
        if (!payload.theme_id || !payload.title || !payload.path) {
          showToast("主题、文件标题和路径不能为空");
          return;
        }
        if (state.admin.themeFileForm.id) {
          await api.adminUpdateThemeFile(state.admin.themeFileForm.id, payload);
          showToast("主题文件已更新");
        } else {
          await api.adminCreateThemeFile(payload);
          showToast("主题文件已创建");
        }
        state.admin.themeFileForm = emptyThemeFileForm(state.admin.selectedThemeId);
        await loadThemeFiles();
        if (state.themeSpace?.theme?.id === payload.theme_id) {
          await loadThemeSpace(state.themeSpace.theme.slug);
        }
      } catch (error) {
        showToast(error.message || "主题文件保存失败");
      }
    }

    async function deactivateThemeFile(file) {
      if (!can("manage_themes")) return;
      const confirmed = window.confirm(`确认停用主题文件「${file.title}」吗？`);
      if (!confirmed) return;
      try {
        await api.adminDeleteThemeFile(file.id);
        showToast("主题文件已停用");
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message);
      }
    }

    async function setAdminTab(tab) {
      state.admin.activeTab = tab;
      if (tab === "users") {
        await loadAdminUsers({ reset: true });
      }
    }

    function useExampleJson() {
      state.admin.importText = JSON.stringify({ themes: [], projects: [state.schema.example] }, null, 2);
    }

    async function importJson() {
      if (!can("import_projects")) return;
      try {
        const payload = JSON.parse(state.admin.importText);
        const result = await api.adminImportProjects(payload);
        showToast(`导入完成：新增 ${result.created_count}，更新 ${result.updated_count}`);
        await loadAdmin();
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "JSON 格式不正确");
      }
    }

    function can(capability) {
      return Boolean(capabilities.value?.[capability]);
    }

    function ensureLogin() {
      if (state.user) return true;
      showToast("请先登录后再操作");
      navigate("login");
      return false;
    }

    function navigate(name, params = {}) {
      const hash = buildHash(name, params);
      if (location.hash === hash) {
        state.route = parseRoute();
      } else {
        location.hash = hash;
      }
    }

    function handleRouteChange() {
      const previousName = state.route.name;
      state.route = parseRoute();
      if (state.route.name !== previousName) {
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      }
    }

    function handleScroll() {
      if (!["home", "projects"].includes(state.route.name)) return;
      const remaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (remaining < 420) {
        loadMoreProjects();
      }
    }

    function handleKeydown(event) {
      if (event.key === "Escape" && state.preview.open) {
        closeProjectPreview();
      }
    }

    function requiresPasswordChange() {
      return Boolean(state.user?.profile?.must_change_password);
    }

    function validateRegisterForm() {
      const form = state.forms.register;
      const errors = {};
      const email = form.email.trim();
      if (!form.username.trim()) errors.username = ["请输入用户名。"];
      if (!email) {
        errors.email = ["请输入邮箱。"];
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = ["请输入有效的邮箱地址。"];
      }
      if (!form.role_type) errors.role_type = ["请选择身份。"];
      if (!form.password1) {
        errors.password1 = ["请输入密码。"];
      } else if (form.password1.length < 8) {
        errors.password1 = ["密码至少需要 8 个字符。"];
      }
      if (!form.password2) {
        errors.password2 = ["请再次输入密码。"];
      } else if (form.password1 && form.password1 !== form.password2) {
        errors.password2 = ["两次输入的密码不一致。"];
      }
      return errors;
    }

    function errorsFromApi(error) {
      const details = error?.payload?.error?.details;
      if (!details || typeof details !== "object" || Array.isArray(details)) return {};
      return Object.fromEntries(
        Object.entries(details).map(([field, value]) => [field, normalizeErrorMessages(value)])
      );
    }

    function normalizeErrorMessages(value) {
      const values = Array.isArray(value) ? value : [value];
      return values
        .map((item) => {
          if (!item) return "";
          if (typeof item === "string") return item;
          if (item.message) return item.message;
          if (item.msg) return item.msg;
          if (item.code) return item.code;
          return String(item);
        })
        .filter(Boolean);
    }

    function hasAnyErrors(errors) {
      return Object.values(errors || {}).some((messages) => messages.length > 0);
    }

    function firstErrorMessage(errors, fallback = "请求失败") {
      for (const messages of Object.values(errors || {})) {
        if (messages?.length) return messages[0];
      }
      return fallback;
    }

    function fieldErrors(errorKey, field) {
      return state.formState[errorKey]?.[field] || [];
    }

    function hasFieldError(errorKey, field) {
      return fieldErrors(errorKey, field).length > 0;
    }

    function fieldErrorId(formName, field) {
      return `${formName}-${field}-error`;
    }

    function describedBy(formName, errorKey, field, hintId = "") {
      const ids = [];
      if (hintId) ids.push(hintId);
      if (hasFieldError(errorKey, field)) ids.push(fieldErrorId(formName, field));
      return ids.length ? ids.join(" ") : null;
    }

    function formSummaryErrors(errorKey) {
      const errors = state.formState[errorKey] || {};
      return [...(errors.__all__ || []), ...(errors.non_field_errors || [])];
    }

    function clearFieldError(errorKey, field) {
      const errors = state.formState[errorKey] || {};
      if (!errors[field]) return;
      const { [field]: _removed, ...rest } = errors;
      state.formState[errorKey] = rest;
    }

    function showToast(message) {
      state.toast = message;
      window.clearTimeout(showToast.timer);
      showToast.timer = window.setTimeout(() => {
        state.toast = "";
      }, 2600);
    }

    return {
      state,
      activeView,
      roleInfo,
      stats,
      navItems,
      selectedTheme,
      selectedSpaceSlug,
      selectedAdminTheme,
      roleCards,
      can,
      navigate,
      openProjectPreview,
      closeProjectPreview,
      toggleProjectPreviewSize,
      applyFilters,
      selectTheme,
      selectSpace,
      loadMoreProjects,
      login,
      changeRequiredPassword,
      register,
      logout,
      toggleFollow,
      submitScore,
      submitInterest,
      submitClaim,
      submitSponsor,
      saveTheme,
      newTheme,
      editTheme,
      deactivateTheme,
      newProject,
      editProject,
      saveProject,
      newThemeFile,
      editThemeFile,
      saveThemeFile,
      deactivateThemeFile,
      selectAdminTheme,
      setAdminTab,
      searchAdminUsers,
      resetUserPassword,
      copyDefaultPassword,
      useExampleJson,
      importJson,
      archiveProject,
      searchAdminProjects,
      loadMoreAdminProjects,
      displayScore,
      shortText,
      roleCountEntries,
      formatList,
      fileTypeLabel,
      stageLabel,
      fieldErrors,
      hasFieldError,
      fieldErrorId,
      describedBy,
      formSummaryErrors,
      clearFieldError
    };
  },
  template: `
    <div class="app-shell">
      <header class="topbar">
        <button class="brand" @click="navigate('home')" type="button">
          <span class="brand-mark">OM</span>
          <span>
            <strong>OpenMedAILab</strong>
            <small>医学 AI 开放课题协作平台</small>
          </span>
        </button>
        <nav class="main-nav" aria-label="主导航">
          <button
            v-for="item in navItems"
            :key="item.name"
            class="nav-item"
            :class="{ active: activeView === item.name || (item.name === 'home' && activeView === 'projects') }"
            type="button"
            @click="navigate(item.name)"
          >
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'home'">library_books</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'space'">folder_open</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'dashboard'">space_dashboard</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'admin'">settings</span>
            {{ item.label }}
          </button>
        </nav>
        <div class="account-area">
          <span class="role-pill"><span class="material-symbols-rounded" style="font-size: 14px;">badge</span> {{ roleInfo.role_label }}</span>
          <button v-if="state.user" class="text-button" type="button" @click="navigate('dashboard')"><span class="material-symbols-rounded" style="font-size: 18px;">person</span> {{ state.user.profile?.display_name || state.user.username }}</button>
          <button v-if="state.user" class="ghost-button" type="button" @click="logout"><span class="material-symbols-rounded" style="font-size: 18px;">logout</span> 退出</button>
          <template v-else>
            <button class="ghost-button" type="button" @click="navigate('login')"><span class="material-symbols-rounded" style="font-size: 18px;">login</span> 登录</button>
            <button class="primary-button" type="button" @click="navigate('register')"><span class="material-symbols-rounded" style="font-size: 18px;">person_add</span> 注册</button>
          </template>
        </div>
      </header>

      <main class="page">
        <div v-if="state.toast" class="toast">{{ state.toast }}</div>
        <section v-if="state.booting" class="empty-state">
          <div class="loader"></div>
          <h2>正在载入课题库</h2>
        </section>

        <template v-else>
          <section v-if="activeView === 'home' || activeView === 'projects'" class="library-view">
            <div class="library-hero" style="text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 100px 20px;">
              <div style="max-width: 800px;">
                <span class="eyebrow" style="background: rgba(20, 184, 166, 0.1); color: #0d9488; padding: 8px 16px; border-radius: 999px; margin-bottom: 24px; display: inline-flex;"><span class="material-symbols-rounded" style="font-size: 18px;">biotech</span> 全新一代医学 AI 课题库</span>
                <h1 style="font-size: clamp(48px, 6vw, 72px); letter-spacing: -2px; margin: 24px 0; line-height: 1.1; color: #0f172a; font-weight: 800;">
                  探索前沿医学人工智能
                </h1>
                <p style="font-size: 20px; color: #64748b; max-width: 600px; margin: 0 auto; line-height: 1.6;">
                  真实临床场景驱动，从数据到算法，寻找改变未来的医学 AI 协作机会。
                </p>
              </div>
            </div>

            <div class="toolbar" style="margin-top: -32px; border: none; box-shadow: 0 20px 40px -10px rgba(0,0,0,0.08); background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(24px); border-radius: 24px; padding: 16px 24px; z-index: 10; position: relative;">
              <label class="search-box">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;">search</span> 搜索</span>
                <input v-model="state.filters.q" type="search" placeholder="输入疾病、模型、任务或期刊" @keyup.enter="applyFilters" />
              </label>
              <label>
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;">moving</span> 阶段</span>
                <select v-model="state.filters.stage" @change="applyFilters">
                  <option value="">全部阶段</option>
                  <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                </select>
              </label>
              <label>
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;">sort</span> 排序</span>
                <select v-model="state.filters.sort" @change="applyFilters">
                  <option value="recommended">综合推荐</option>
                  <option value="llm_score">初始评分</option>
                  <option value="community_score">社区评分</option>
                  <option value="follows">关注热度</option>
                  <option value="updated">最近更新</option>
                  <option value="project_no">课题编号</option>
                </select>
              </label>
              <button class="primary-button" type="button" @click="applyFilters" style="height: 40px; margin-top: auto;"><span class="material-symbols-rounded">filter_list</span> 筛选</button>
            </div>

            <div class="theme-strip">
              <button class="theme-chip" :class="{ active: !state.filters.theme }" type="button" @click="selectTheme('')">全部主题</button>
              <button
                v-for="theme in state.meta.themes"
                :key="theme.slug"
                class="theme-chip"
                :class="{ active: state.filters.theme === theme.slug }"
                type="button"
                @click="selectTheme(theme.slug)"
              >
                {{ theme.name }}
              </button>
            </div>

            <div class="section-head">
              <div>
                <h2>{{ selectedTheme ? selectedTheme.name : '全部课题' }}</h2>
                <p>{{ selectedTheme?.description || '向下滚动会自动加载更多课题。' }}</p>
              </div>
              <button v-if="selectedTheme" class="ghost-button" type="button" @click="selectSpace(selectedTheme.slug)">查看主题文件空间</button>
            </div>

            <div class="project-grid">
              <article
                v-for="project in state.projects"
                :key="project.id"
                :data-project-id="project.id"
                class="project-card"
                role="button"
                tabindex="0"
                @click="openProjectPreview(project)"
                @keyup.enter="openProjectPreview(project)"
              >
                <div class="card-topline" style="margin-bottom: 16px;">
                  <span style="display: flex; align-items: center; gap: 6px; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; color: #475569; font-weight: 600;"><span class="material-symbols-rounded" style="font-size: 16px; color: #0ea5e9;">category</span> {{ project.theme?.name || '未分类' }}</span>
                  <span style="display: flex; align-items: center; gap: 6px; color: #14b8a6; font-weight: 600;"><span class="material-symbols-rounded" style="font-size: 16px;">moving</span> {{ project.stage_label }}</span>
                </div>
                <h3 style="font-size: 24px; letter-spacing: -0.5px; margin-bottom: 12px; color: #0f172a;">{{ project.title }}</h3>
                <p style="font-size: 15px; line-height: 1.6; color: #64748b; margin-bottom: 24px; flex-grow: 1;">{{ shortText(project.summary || project.problem_statement, 120) }}</p>
                <div class="tag-row" style="margin-bottom: 24px;">
                  <span v-for="tag in project.tags.slice(0, 3)" :key="tag.id" style="background: transparent; border: 1px solid #e2e8f0; color: #64748b; border-radius: 999px; padding: 4px 12px;">{{ tag.name }}</span>
                </div>
                <div class="card-actions" style="margin-top: auto; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                  <div style="display: flex; gap: 16px; color: #94a3b8; font-size: 14px; font-weight: 500;">
                    <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 18px;">star</span> {{ displayScore(project.composite_score) }}</span>
                    <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 18px;">group</span> {{ project.interest_count || 0 }}</span>
                  </div>
                  <button class="primary-button" type="button" @click.stop="openProjectPreview(project)" style="border-radius: 999px; padding: 8px 20px;"><span class="material-symbols-rounded" style="font-size: 18px;">arrow_forward</span> 探索课题</button>
                </div>
              </article>
            </div>

            <section v-if="!state.loading && !state.loadingMore && !state.projects.length" class="empty-state">
              <h2>没有找到匹配课题</h2>
              <p>换一个关键词或主题试试。</p>
            </section>

            <div class="load-more">
              <button v-if="state.hasMoreProjects" class="ghost-button" type="button" :disabled="state.loadingMore" @click="loadMoreProjects">
                {{ state.loadingMore ? '正在加载...' : '加载更多课题' }}
              </button>
              <span v-else>已显示全部匹配课题</span>
            </div>
          </section>

          <section v-else-if="activeView === 'project' && state.currentProject" class="detail-view">
            <button class="back-button" type="button" @click="navigate('projects')">返回课题库</button>
            <div class="detail-header">
              <div>
                <span class="eyebrow">{{ state.currentProject.theme?.name || '未分类' }} · {{ state.currentProject.stage_label }}</span>
                <h1>{{ state.currentProject.title }}</h1>
                <p>{{ state.currentProject.summary }}</p>
                <div class="tag-row">
                  <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                </div>
              </div>
              <div class="score-panel">
                <strong>{{ displayScore(state.currentProject.composite_score) }}</strong>
                <span>综合评分</span>
                <button class="primary-button" type="button" @click="toggleFollow(state.currentProject)">关注课题</button>
              </div>
            </div>

            <div class="detail-grid">
              <article class="content-panel">
                <h2>结构化课题信息</h2>
                <div class="info-list">
                  <section><h3>科学问题</h3><p>{{ state.currentProject.problem_statement || '待补充' }}</p></section>
                  <section><h3>研究目标</h3><p>{{ state.currentProject.research_goal || '待补充' }}</p></section>
                  <section><h3>技术路线</h3><p>{{ state.currentProject.technical_route || '待补充' }}</p></section>
                  <section><h3>数据需求</h3><p>{{ formatList(state.currentProject.data_requirements) }}</p></section>
                  <section><h3>评价指标</h3><p>{{ formatList(state.currentProject.evaluation_metrics) }}</p></section>
                  <section><h3>预期成果</h3><p>{{ formatList(state.currentProject.expected_outputs) }}</p></section>
                  <section><h3>合规说明</h3><p>{{ state.currentProject.compliance_notes || '第一版默认不允许上传可识别患者数据。' }}</p></section>
                </div>
              </article>

              <aside class="side-panel">
                <h2>组队情况</h2>
                <div class="role-list">
                  <div v-for="[role, count] in roleCountEntries(state.currentProject.team_status)" :key="role">
                    <span>{{ role }}</span>
                    <strong>{{ count }}</strong>
                  </div>
                </div>
                <p class="ready-text">{{ state.currentProject.team_status?.basic_ready ? '已具备基础启动团队' : '基础团队仍在招募' }}</p>
              </aside>
            </div>

            <div class="detail-grid">
              <article class="content-panel">
                <h2>课题文件</h2>
                <div class="file-list">
                  <a v-for="doc in state.currentProject.documents" :key="doc.id" :href="doc.path" target="_blank" rel="noreferrer">
                    <span>{{ fileTypeLabel(doc.doc_type) }}</span>
                    <strong>{{ doc.title || doc.path }}</strong>
                    <small>{{ doc.path }}</small>
                  </a>
                  <p v-if="!state.currentProject.documents.length">暂无文件记录。</p>
                </div>
              </article>
              <aside class="side-panel">
                <h2>参与操作</h2>
                <form class="stack-form" @submit.prevent="submitInterest">
                  <select v-model="state.forms.interest.role">
                    <option v-for="role in state.meta.participation_roles" :key="role.value" :value="role.value">{{ role.label }}</option>
                  </select>
                  <input v-model.number="state.forms.interest.available_hours_per_week" type="number" min="0" placeholder="每周可投入小时" />
                  <textarea v-model="state.forms.interest.message" placeholder="补充说明"></textarea>
                  <button class="primary-button" type="submit">申请参与</button>
                </form>
                <form class="stack-form compact-form" @submit.prevent="submitScore">
                  <input v-model.number="state.forms.score.score" type="number" min="1" max="10" />
                  <input v-model="state.forms.score.comment" type="text" placeholder="评分备注" />
                  <button class="ghost-button" type="submit">提交评分</button>
                </form>
                <div class="button-row">
                  <button class="ghost-button" type="button" @click="submitClaim">认领意向</button>
                  <button class="ghost-button" type="button" @click="submitSponsor">资助意向</button>
                </div>
              </aside>
            </div>
          </section>

          <section v-else-if="activeView === 'space'" class="space-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">主题数据文件域</span>
                <h1>一个主题对应一个数据资产空间。</h1>
                <p>这里登记数据集文件、数据字典、标注规范、伦理合规材料和模型实验资产。单个课题原文、PDF、网页不属于主题文件域。</p>
              </div>
            </div>
            <div class="theme-strip">
              <button
                v-for="theme in state.meta.themes"
                :key="theme.slug"
                class="theme-chip"
                :class="{ active: selectedSpaceSlug === theme.slug }"
                type="button"
                @click="selectSpace(theme.slug)"
              >
                {{ theme.name }}
              </button>
            </div>
            <div v-if="state.themeSpace" class="space-layout">
              <article class="content-panel space-domain-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>{{ state.themeSpace.theme.name }}</h2>
                    <p>{{ state.themeSpace.theme.description || state.themeSpace.theme.file_space?.storage_policy }}</p>
                  </div>
                </div>
                <dl class="card-metrics wide">
                  <div><dt>关联课题</dt><dd>{{ state.themeSpace.project_count }}</dd></div>
                  <div><dt>数据资产</dt><dd>{{ state.themeSpace.file_count }}</dd></div>
                  <div><dt>访问级别</dt><dd>{{ state.themeSpace.theme.file_space?.access_level || 'public_metadata' }}</dd></div>
                </dl>
                <div class="policy-box">
                  <strong>文件域策略</strong>
                  <p>{{ state.themeSpace.theme.file_space?.storage_policy || '只登记主题级数据资产元信息，不登记单个课题原文、PDF 或公开页面。' }}</p>
                  <div class="tag-row">
                    <span v-for="type in state.themeSpace.theme.file_space?.allowed_file_types || []" :key="type">{{ fileTypeLabel(type) }}</span>
                  </div>
                </div>
                <div class="domain-section" v-for="section in state.themeSpace.sections" :key="section.name">
                  <div class="domain-section-head">
                    <h3>{{ section.name }}</h3>
                    <span>{{ section.files.length }} 个文件</span>
                  </div>
                  <div class="file-list">
                    <a v-for="file in section.files" :key="file.id" :href="file.path" target="_blank" rel="noreferrer">
                      <span>{{ fileTypeLabel(file.file_type) }}</span>
                      <strong>{{ file.title }}</strong>
                      <small>{{ file.description || file.path }}</small>
                    </a>
                    <p v-if="!section.files.length">这个栏目还没有文件。</p>
                  </div>
                </div>
                <p v-if="!state.themeSpace.file_count">该主题还没有登记数据资产文件，管理员可在“管理 / 主题与文件域”中新增。</p>
              </article>
              <aside class="side-panel">
                <h2>关联课题</h2>
                <p>这些课题属于当前主题，可直接打开查看详情。</p>
                <div class="space-project-list">
                  <button
                    v-for="project in state.themeSpace.projects"
                    :key="project.id"
                    type="button"
                    class="space-project-link"
                    @click="openProjectPreview(project)"
                  >
                    <strong>{{ project.title }}</strong>
                    <span>{{ project.topic_id }} · {{ stageLabel(project) }}</span>
                  </button>
                </div>
              </aside>
            </div>
          </section>

          <section v-else-if="activeView === 'dashboard'" class="dashboard-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">我的协作</span>
                <h1>{{ state.user?.profile?.display_name || state.user?.username }}</h1>
                <p>{{ roleInfo.role_label }} · {{ state.user?.profile?.organization || '未填写机构' }}</p>
              </div>
            </div>
            <div class="role-card-grid">
              <article v-for="card in roleCards" :key="card.title" class="role-card">
                <h3>{{ card.title }}</h3>
                <p>{{ card.body }}</p>
              </article>
            </div>
            <div v-if="state.dashboard" class="dashboard-grid">
              <article class="content-panel"><h2>关注课题</h2><p>{{ state.dashboard.follows.length }} 个</p></article>
              <article class="content-panel"><h2>参与意向</h2><p>{{ state.dashboard.interests.length }} 条</p></article>
              <article class="content-panel"><h2>评分记录</h2><p>{{ state.dashboard.scores.length }} 条</p></article>
            </div>
          </section>

          <section v-else-if="activeView === 'admin'" class="admin-view">
            <template v-if="can('view_admin_console')">
              <div class="section-head">
                <div>
                  <span class="eyebrow">管理</span>
                  <h1>内容管理工作台</h1>
                  <p>主题、文件域、课题字段和导入结果都由后端 API 写入数据库。停用操作保留审计记录，不做物理删除。</p>
                </div>
              </div>

              <div class="admin-tabs" role="tablist" aria-label="管理功能">
                <button type="button" :class="{ active: state.admin.activeTab === 'projects' }" @click="setAdminTab('projects')">课题管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'themes' }" @click="setAdminTab('themes')">主题与文件域</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'users' }" @click="setAdminTab('users')">用户管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'import' }" @click="setAdminTab('import')">JSON 导入</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'schema' }" @click="setAdminTab('schema')">字段契约</button>
              </div>

              <section v-if="state.admin.activeTab === 'projects'" class="admin-workbench">
                <article class="content-panel admin-list-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>课题管理</h2>
                      <p>共 {{ state.admin.projectPagination.total_count || 0 }} 个课题，当前显示 {{ state.admin.projects.length }} 个。</p>
                    </div>
                    <button class="primary-button" type="button" @click="newProject">新增课题</button>
                  </div>
                  <div class="admin-filter-row">
                    <input v-model="state.admin.projectFilters.q" type="search" placeholder="搜索标题、课题 ID 或摘要" @keyup.enter="searchAdminProjects" />
                    <select v-model="state.admin.projectFilters.theme" @change="searchAdminProjects">
                      <option value="">全部主题</option>
                      <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.slug">{{ theme.name }}</option>
                    </select>
                    <button class="ghost-button" type="button" @click="searchAdminProjects">查询</button>
                  </div>
                  <div class="admin-table">
                    <div class="admin-table-head">
                      <span>课题</span>
                      <span>主题</span>
                      <span>阶段</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    <div class="admin-table-row" v-for="project in state.admin.projects" :key="project.id">
                      <span>
                        <strong>{{ project.title }}</strong>
                        <small>{{ project.topic_id }}</small>
                      </span>
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span>{{ stageLabel(project) }}</span>
                      <span>{{ project.is_public ? '公开' : '已停用' }}</span>
                      <span class="button-row">
                        <button class="ghost-button" type="button" @click="editProject(project)">编辑</button>
                        <button class="ghost-button danger" type="button" @click="archiveProject(project)">删除</button>
                      </span>
                    </div>
                  </div>
                  <div class="load-more compact-load-more">
                    <button v-if="state.admin.hasMoreProjects" class="ghost-button" type="button" :disabled="state.admin.loadingProjects" @click="loadMoreAdminProjects">
                      {{ state.admin.loadingProjects ? '正在加载...' : '加载更多课题' }}
                    </button>
                    <span v-else>已显示当前筛选下的全部课题</span>
                  </div>
                </article>

                <article id="admin-project-form" class="content-panel admin-form-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>{{ state.admin.projectForm.id ? '编辑课题' : '新增课题' }}</h2>
                      <p>JSON 字段会按固定契约写入数据库。</p>
                    </div>
                    <button class="ghost-button" type="button" @click="newProject">清空</button>
                  </div>
                  <form class="stack-form project-edit-form" @submit.prevent="saveProject">
                    <div class="form-grid">
                      <label><span>课题 ID</span><input v-model="state.admin.projectForm.topic_id" type="text" /></label>
                      <label><span>主题</span>
                        <select v-model="state.admin.projectForm.theme">
                          <option value="">未分类</option>
                          <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.slug">{{ theme.name }}</option>
                        </select>
                      </label>
                      <label><span>主题内编号</span><input v-model="state.admin.projectForm.project_no" type="number" min="0" /></label>
                      <label><span>阶段</span>
                        <select v-model="state.admin.projectForm.stage">
                          <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                        </select>
                      </label>
                    </div>
                    <label><span>标题</span><input v-model="state.admin.projectForm.title" type="text" /></label>
                    <label><span>摘要</span><textarea v-model="state.admin.projectForm.summary"></textarea></label>
                    <label><span>科学问题</span><textarea v-model="state.admin.projectForm.problem_statement"></textarea></label>
                    <label><span>研究目标</span><textarea v-model="state.admin.projectForm.research_goal"></textarea></label>
                    <label><span>技术路线</span><textarea v-model="state.admin.projectForm.technical_route"></textarea></label>
                    <div class="form-grid">
                      <label><span>数据需求 JSON</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.data_requirements"></textarea></label>
                      <label><span>评价指标 JSON</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.evaluation_metrics"></textarea></label>
                      <label><span>预期成果 JSON</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.expected_outputs"></textarea></label>
                      <label><span>文件列表 JSON</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.documents"></textarea></label>
                    </div>
                    <label><span>合规说明</span><textarea v-model="state.admin.projectForm.compliance_notes"></textarea></label>
                    <div class="form-grid">
                      <label><span>标签（逗号分隔）</span><input v-model="state.admin.projectForm.tags" type="text" /></label>
                      <label><span>需要角色（逗号分隔）</span><input v-model="state.admin.projectForm.needed_roles" type="text" /></label>
                      <label><span>初始评分</span><input v-model="state.admin.projectForm.llm_score" type="number" step="0.1" /></label>
                      <label><span>综合评分</span><input v-model="state.admin.projectForm.composite_score" type="number" step="0.1" /></label>
                    </div>
                    <label><span>推荐期刊</span><input v-model="state.admin.projectForm.recommended_journal" type="text" /></label>
                    <div class="form-grid">
                      <label><span>Markdown 路径</span><input v-model="state.admin.projectForm.source_md_path" type="text" /></label>
                      <label><span>PDF 路径</span><input v-model="state.admin.projectForm.source_pdf_path" type="text" /></label>
                      <label><span>公开页路径</span><input v-model="state.admin.projectForm.page_path" type="text" /></label>
                      <label><span>评分维度 JSON</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.score_dimensions"></textarea></label>
                    </div>
                    <label><span>正文 Markdown</span><textarea class="mini-json-editor" v-model="state.admin.projectForm.body_markdown"></textarea></label>
                    <div class="button-row form-actions">
                      <label class="inline-check"><input v-model="state.admin.projectForm.has_pdf" type="checkbox" /> 有 PDF</label>
                      <label class="inline-check"><input v-model="state.admin.projectForm.is_public" type="checkbox" /> 公开展示</label>
                      <button class="primary-button" type="submit">保存课题</button>
                    </div>
                  </form>
                </article>
              </section>

              <section v-else-if="state.admin.activeTab === 'themes'" class="admin-workbench">
                <article class="content-panel admin-form-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>{{ state.admin.themeForm.id ? '编辑主题' : '新增主题' }}</h2>
                      <p>主题配置和文件域策略会保存到数据库。</p>
                    </div>
                    <button class="ghost-button" type="button" @click="newTheme">清空</button>
                  </div>
                  <form class="stack-form" @submit.prevent="saveTheme">
                    <div class="form-grid">
                      <label><span>主题名称</span><input v-model="state.admin.themeForm.name" type="text" /></label>
                      <label><span>主题 slug</span><input v-model="state.admin.themeForm.slug" type="text" /></label>
                      <label><span>排序</span><input v-model="state.admin.themeForm.sort_order" type="number" /></label>
                      <label class="inline-check"><input v-model="state.admin.themeForm.is_active" type="checkbox" /> 启用主题</label>
                    </div>
                    <label><span>主题说明</span><textarea v-model="state.admin.themeForm.description"></textarea></label>
                    <label><span>文件域策略 JSON</span><textarea class="json-editor compact-json-editor" v-model="state.admin.themeForm.file_space"></textarea></label>
                    <button class="primary-button" type="submit">保存主题</button>
                  </form>

                  <h2>主题列表</h2>
                  <div class="manage-row" v-for="theme in state.admin.themes" :key="theme.id">
                    <span><strong>{{ theme.name }}</strong><small>{{ theme.slug }}</small></span>
                    <div class="button-row">
                      <button class="ghost-button" type="button" @click="editTheme(theme)">编辑</button>
                      <button class="ghost-button danger" type="button" @click="deactivateTheme(theme)">停用</button>
                    </div>
                  </div>
                </article>

                <article class="content-panel admin-list-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>主题数据文件域</h2>
                      <p>{{ selectedAdminTheme?.name || '请选择主题' }} · {{ state.admin.themeFiles.length }} 个数据资产</p>
                    </div>
                    <button class="primary-button" type="button" @click="newThemeFile">新增文件</button>
                  </div>
                  <label><span>选择主题文件域</span>
                    <select :value="state.admin.selectedThemeId" @change="selectAdminTheme($event.target.value)">
                      <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
                    </select>
                  </label>
                  <form class="stack-form theme-file-form" @submit.prevent="saveThemeFile">
                    <div class="form-grid">
                      <label><span>栏目</span><input v-model="state.admin.themeFileForm.section" type="text" /></label>
                      <label><span>文件类型</span>
                        <select v-model="state.admin.themeFileForm.file_type">
                          <option v-for="type in state.schema.theme_file_types || []" :key="type.value" :value="type.value">{{ type.label }}</option>
                        </select>
                      </label>
                      <label><span>排序</span><input v-model="state.admin.themeFileForm.sort_order" type="number" /></label>
                      <label class="inline-check"><input v-model="state.admin.themeFileForm.is_active" type="checkbox" /> 启用文件</label>
                    </div>
                    <label><span>文件标题</span><input v-model="state.admin.themeFileForm.title" type="text" /></label>
                    <label><span>文件路径或链接</span><input v-model="state.admin.themeFileForm.path" type="text" /></label>
                    <label><span>说明</span><textarea v-model="state.admin.themeFileForm.description"></textarea></label>
                    <button class="primary-button" type="submit">保存主题文件</button>
                  </form>
                  <div class="admin-table theme-file-table">
                    <div class="admin-table-head">
                      <span>文件</span>
                      <span>栏目</span>
                      <span>类型</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    <div class="admin-table-row" v-for="file in state.admin.themeFiles" :key="file.id">
                      <span>
                        <strong>{{ file.title }}</strong>
                        <small>{{ file.path }}</small>
                      </span>
                      <span>{{ file.section }}</span>
                      <span>{{ fileTypeLabel(file.file_type) }}</span>
                      <span>{{ file.is_active ? '启用' : '停用' }}</span>
                      <span class="button-row">
                        <button class="ghost-button" type="button" @click="editThemeFile(file)">编辑</button>
                        <button class="ghost-button danger" type="button" @click="deactivateThemeFile(file)">停用</button>
                      </span>
                    </div>
                  </div>
                </article>
              </section>

              <section v-else-if="state.admin.activeTab === 'users'" class="content-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>用户管理</h2>
                    <p>管理员可按 UID、用户名或邮箱查找用户，并恢复为系统统一默认密码。</p>
                  </div>
                </div>
                <div v-if="state.admin.passwordResetResult" class="form-success password-result" role="status">
                  <strong>{{ state.admin.passwordResetResult.user.username }} 的系统默认密码</strong>
                  <code>{{ state.admin.passwordResetResult.default_password }}</code>
                  <button class="ghost-button" type="button" @click="copyDefaultPassword">复制</button>
                  <span>请线下告知用户。用户登录后必须修改新密码并重新登录。</span>
                </div>
                <div class="admin-filter-row">
                  <input v-model="state.admin.userFilters.q" type="search" placeholder="搜索 UID、用户名、邮箱或昵称" @keyup.enter="searchAdminUsers" />
                  <button class="ghost-button" type="button" @click="searchAdminUsers">查询</button>
                </div>
                <div class="admin-table user-table">
                  <div class="admin-table-head">
                    <span>用户</span>
                    <span>UID</span>
                    <span>身份</span>
                    <span>状态</span>
                    <span>操作</span>
                  </div>
                  <div class="admin-table-row" v-for="user in state.admin.users" :key="user.id">
                    <span>
                      <strong>{{ user.username }}</strong>
                      <small>{{ user.email || user.profile?.contact_email || '未填写邮箱' }}</small>
                    </span>
                    <span>{{ user.profile?.uid || '-' }}</span>
                    <span>{{ user.profile?.role_type_label || '注册用户' }}</span>
                    <span>{{ user.profile?.must_change_password ? '待修改默认密码' : '正常' }}</span>
                    <span class="button-row">
                      <span v-if="user.id === state.user?.id" class="self-reset-note">当前管理员</span>
                      <button v-else class="ghost-button danger" type="button" :disabled="state.admin.resettingUid === user.profile?.uid" @click="resetUserPassword(user)">
                        {{ state.admin.resettingUid === user.profile?.uid ? '正在恢复' : '恢复为系统默认密码' }}
                      </button>
                    </span>
                  </div>
                </div>
                <p v-if="!state.admin.loadingUsers && !state.admin.users.length">没有找到匹配用户。</p>
              </section>

              <section v-else-if="state.admin.activeTab === 'import'" class="content-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>JSON 导入课题</h2>
                    <p>按字段契约导入或更新课题，主题会自动匹配或创建。</p>
                  </div>
                  <button class="ghost-button" type="button" @click="useExampleJson">填入示例</button>
                </div>
                <textarea class="json-editor" v-model="state.admin.importText"></textarea>
                <button class="primary-button" type="button" @click="importJson">导入或更新</button>
              </section>

              <section v-else class="content-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>课题字段契约</h2>
                    <p>前端表单、JSON 导入和后端保存都按这些字段对齐。</p>
                  </div>
                </div>
                <div class="schema-table schema-table-wide">
                  <div v-for="field in state.schema.fields" :key="field.name">
                    <strong>{{ field.label }}</strong>
                    <code>{{ field.name }}</code>
                    <span>{{ field.type }}{{ field.required ? ' · 必填' : '' }}</span>
                  </div>
                </div>
              </section>
            </template>
            <section v-else class="empty-state">
              <h2>当前身份没有管理权限</h2>
              <p>管理员可以增删改主题和课题，并导入 JSON。</p>
            </section>
          </section>

          <section v-else-if="activeView === 'login'" class="auth-view">
            <form class="auth-card" @submit.prevent="login">
              <h1>登录</h1>
              <label for="login-username">
                <span>用户名</span>
                <input id="login-username" v-model="state.forms.login.username" name="username" type="text" placeholder="用户名" autocomplete="username" />
              </label>
              <label for="login-password">
                <span>密码</span>
                <input id="login-password" v-model="state.forms.login.password" name="password" type="password" placeholder="密码" autocomplete="current-password" />
              </label>
              <button class="primary-button" type="submit"><span class="material-symbols-rounded" style="font-size: 18px;">login</span> 登录</button>
              <button class="text-button auth-link" type="button" @click="navigate('password-reset')">忘记密码</button>
            </form>
          </section>

          <section v-else-if="activeView === 'password-change'" class="auth-view">
            <form class="auth-card" @submit.prevent="changeRequiredPassword" novalidate>
              <h1>修改默认密码</h1>
              <p class="auth-note">当前账号使用管理员恢复的系统默认密码登录。请设置新密码，系统会自动退出，你需要用新密码重新登录后才能继续使用。</p>
              <label for="change-password1" :class="{ 'has-error': hasFieldError('passwordChangeErrors', 'password1') }">
                <span>新密码 <em aria-hidden="true">*</em></span>
                <input
                  id="change-password1"
                  v-model="state.forms.passwordChange.password1"
                  name="password1"
                  type="password"
                  autocomplete="new-password"
                  required
                  :aria-invalid="hasFieldError('passwordChangeErrors', 'password1') ? 'true' : 'false'"
                  :aria-describedby="describedBy('password-change', 'passwordChangeErrors', 'password1', 'change-password-help')"
                  @input="clearFieldError('passwordChangeErrors', 'password1')"
                />
                <small id="change-password-help" class="field-hint">至少 8 个字符，不能继续使用系统默认密码。</small>
                <div v-if="hasFieldError('passwordChangeErrors', 'password1')" :id="fieldErrorId('password-change', 'password1')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('passwordChangeErrors', 'password1')" :key="message">{{ message }}</p>
                </div>
              </label>
              <label for="change-password2" :class="{ 'has-error': hasFieldError('passwordChangeErrors', 'password2') }">
                <span>确认新密码 <em aria-hidden="true">*</em></span>
                <input
                  id="change-password2"
                  v-model="state.forms.passwordChange.password2"
                  name="password2"
                  type="password"
                  autocomplete="new-password"
                  required
                  :aria-invalid="hasFieldError('passwordChangeErrors', 'password2') ? 'true' : 'false'"
                  :aria-describedby="describedBy('password-change', 'passwordChangeErrors', 'password2')"
                  @input="clearFieldError('passwordChangeErrors', 'password2')"
                />
                <div v-if="hasFieldError('passwordChangeErrors', 'password2')" :id="fieldErrorId('password-change', 'password2')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('passwordChangeErrors', 'password2')" :key="message">{{ message }}</p>
                </div>
              </label>
              <button class="primary-button" type="submit" :disabled="state.formState.passwordChangeSubmitting">
                <span class="material-symbols-rounded" style="font-size: 18px;">lock_reset</span>
                {{ state.formState.passwordChangeSubmitting ? '正在修改' : '修改并重新登录' }}
              </button>
              <button class="text-button auth-link" type="button" @click="logout">退出登录</button>
            </form>
          </section>

          <section v-else-if="activeView === 'register'" class="auth-view">
            <form class="auth-card" @submit.prevent="register" novalidate>
              <h1>注册</h1>
              <div v-if="formSummaryErrors('registerErrors').length" class="form-error-summary" role="alert">
                <strong>注册信息需要调整</strong>
                <p v-for="message in formSummaryErrors('registerErrors')" :key="message">{{ message }}</p>
              </div>
              <label for="register-username" :class="{ 'has-error': hasFieldError('registerErrors', 'username') }">
                <span>用户名 <em aria-hidden="true">*</em></span>
                <input
                  id="register-username"
                  v-model="state.forms.register.username"
                  name="username"
                  type="text"
                  placeholder="用户名"
                  autocomplete="username"
                  required
                  :aria-invalid="hasFieldError('registerErrors', 'username') ? 'true' : 'false'"
                  :aria-describedby="describedBy('register', 'registerErrors', 'username')"
                  @input="clearFieldError('registerErrors', 'username')"
                />
                <div v-if="hasFieldError('registerErrors', 'username')" :id="fieldErrorId('register', 'username')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('registerErrors', 'username')" :key="message">{{ message }}</p>
                </div>
              </label>
              <label for="register-email" :class="{ 'has-error': hasFieldError('registerErrors', 'email') }">
                <span>邮箱 <em aria-hidden="true">*</em></span>
                <input
                  id="register-email"
                  v-model="state.forms.register.email"
                  name="email"
                  type="email"
                  placeholder="邮箱"
                  autocomplete="email"
                  required
                  :aria-invalid="hasFieldError('registerErrors', 'email') ? 'true' : 'false'"
                  :aria-describedby="describedBy('register', 'registerErrors', 'email')"
                  @input="clearFieldError('registerErrors', 'email')"
                />
                <div v-if="hasFieldError('registerErrors', 'email')" :id="fieldErrorId('register', 'email')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('registerErrors', 'email')" :key="message">{{ message }}</p>
                </div>
              </label>
              <label for="register-display-name">
                <span>昵称</span>
                <input id="register-display-name" v-model="state.forms.register.display_name" name="display_name" type="text" placeholder="昵称" autocomplete="name" />
              </label>
              <label for="register-role" :class="{ 'has-error': hasFieldError('registerErrors', 'role_type') }">
                <span>身份 <em aria-hidden="true">*</em></span>
                <select
                  id="register-role"
                  v-model="state.forms.register.role_type"
                  name="role_type"
                  required
                  :aria-invalid="hasFieldError('registerErrors', 'role_type') ? 'true' : 'false'"
                  :aria-describedby="describedBy('register', 'registerErrors', 'role_type')"
                  @change="clearFieldError('registerErrors', 'role_type')"
                >
                  <option v-for="role in state.meta.profile_roles" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
                <div v-if="hasFieldError('registerErrors', 'role_type')" :id="fieldErrorId('register', 'role_type')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('registerErrors', 'role_type')" :key="message">{{ message }}</p>
                </div>
              </label>
              <label for="register-password1" :class="{ 'has-error': hasFieldError('registerErrors', 'password1') }">
                <span>密码 <em aria-hidden="true">*</em></span>
                <input
                  id="register-password1"
                  v-model="state.forms.register.password1"
                  name="password1"
                  type="password"
                  placeholder="密码"
                  autocomplete="new-password"
                  required
                  :aria-invalid="hasFieldError('registerErrors', 'password1') ? 'true' : 'false'"
                  :aria-describedby="describedBy('register', 'registerErrors', 'password1', 'register-password-help')"
                  @input="clearFieldError('registerErrors', 'password1')"
                />
                <small id="register-password-help" class="field-hint">至少 8 个字符，建议包含字母和数字。</small>
                <div v-if="hasFieldError('registerErrors', 'password1')" :id="fieldErrorId('register', 'password1')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('registerErrors', 'password1')" :key="message">{{ message }}</p>
                </div>
              </label>
              <label for="register-password2" :class="{ 'has-error': hasFieldError('registerErrors', 'password2') }">
                <span>确认密码 <em aria-hidden="true">*</em></span>
                <input
                  id="register-password2"
                  v-model="state.forms.register.password2"
                  name="password2"
                  type="password"
                  placeholder="确认密码"
                  autocomplete="new-password"
                  required
                  :aria-invalid="hasFieldError('registerErrors', 'password2') ? 'true' : 'false'"
                  :aria-describedby="describedBy('register', 'registerErrors', 'password2')"
                  @input="clearFieldError('registerErrors', 'password2')"
                />
                <div v-if="hasFieldError('registerErrors', 'password2')" :id="fieldErrorId('register', 'password2')" class="field-error" role="alert">
                  <p v-for="message in fieldErrors('registerErrors', 'password2')" :key="message">{{ message }}</p>
                </div>
              </label>
              <button class="primary-button" type="submit" :disabled="state.formState.registerSubmitting">
                <span class="material-symbols-rounded" style="font-size: 18px;">person_add</span>
                {{ state.formState.registerSubmitting ? '正在创建' : '创建账号' }}
              </button>
            </form>
          </section>

          <section v-else-if="activeView === 'password-reset'" class="auth-view">
            <div class="auth-card">
              <h1>找回密码</h1>
              <p class="auth-note">平台不通过邮箱发送重置链接。请联系系统管理员，由管理员将你的账号恢复为系统默认密码。</p>
              <p class="auth-note">拿到系统默认密码后回到登录页登录，系统会强制要求你修改新密码；修改成功后需要重新登录。</p>
              <button class="text-button auth-link" type="button" @click="navigate('login')">返回登录</button>
            </div>
          </section>
        </template>

        <div v-if="state.preview.open" class="project-modal-backdrop" @click.self="closeProjectPreview">
          <section class="project-modal" :class="{ maximized: state.preview.maximized }" role="dialog" aria-modal="true">
            <header class="project-modal-header">
              <div>
                <span class="eyebrow">课题详情</span>
                <h2>{{ state.currentProject?.title || '正在载入课题' }}</h2>
              </div>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="toggleProjectPreviewSize">
                  {{ state.preview.maximized ? '恢复小窗' : '最大化' }}
                </button>
                <button class="ghost-button" type="button" @click="closeProjectPreview">返回列表</button>
              </div>
            </header>

            <div class="project-modal-body">
              <section v-if="state.preview.loading" class="modal-loading">
                <div class="loader"></div>
                <p>正在读取课题详情</p>
              </section>

              <template v-else-if="state.currentProject">
                <div class="detail-header modal-detail-header">
                  <div>
                    <span class="eyebrow">{{ state.currentProject.theme?.name || '未分类' }} · {{ state.currentProject.stage_label }}</span>
                    <h1>{{ state.currentProject.title }}</h1>
                    <p>{{ state.currentProject.summary }}</p>
                    <div class="tag-row">
                      <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                  <div class="score-panel">
                    <strong>{{ displayScore(state.currentProject.composite_score) }}</strong>
                    <span>综合评分</span>
                    <button class="primary-button" type="button" @click="toggleFollow(state.currentProject)">关注课题</button>
                  </div>
                </div>

                <div class="detail-grid modal-detail-grid">
                  <article class="content-panel">
                    <h2>结构化课题信息</h2>
                    <div class="info-list">
                      <section><h3>科学问题</h3><p>{{ state.currentProject.problem_statement || '待补充' }}</p></section>
                      <section><h3>研究目标</h3><p>{{ state.currentProject.research_goal || '待补充' }}</p></section>
                      <section><h3>技术路线</h3><p>{{ state.currentProject.technical_route || '待补充' }}</p></section>
                      <section><h3>数据需求</h3><p>{{ formatList(state.currentProject.data_requirements) }}</p></section>
                      <section><h3>评价指标</h3><p>{{ formatList(state.currentProject.evaluation_metrics) }}</p></section>
                      <section><h3>预期成果</h3><p>{{ formatList(state.currentProject.expected_outputs) }}</p></section>
                      <section><h3>合规说明</h3><p>{{ state.currentProject.compliance_notes || '第一版默认不允许上传可识别患者数据。' }}</p></section>
                    </div>
                  </article>

                  <aside class="side-panel">
                    <h2>组队情况</h2>
                    <div class="role-list">
                      <div v-for="[role, count] in roleCountEntries(state.currentProject.team_status)" :key="role">
                        <span>{{ role }}</span>
                        <strong>{{ count }}</strong>
                      </div>
                    </div>
                    <p class="ready-text">{{ state.currentProject.team_status?.basic_ready ? '已具备基础启动团队' : '基础团队仍在招募' }}</p>
                  </aside>
                </div>

                <div class="detail-grid modal-detail-grid">
                  <article class="content-panel">
                    <h2>课题文件</h2>
                    <div class="file-list">
                      <a v-for="doc in state.currentProject.documents" :key="doc.id" :href="doc.path" target="_blank" rel="noreferrer">
                        <span>{{ fileTypeLabel(doc.doc_type) }}</span>
                        <strong>{{ doc.title || doc.path }}</strong>
                        <small>{{ doc.path }}</small>
                      </a>
                      <p v-if="!state.currentProject.documents.length">暂无文件记录。</p>
                    </div>
                  </article>
                  <aside class="side-panel">
                    <h2>参与操作</h2>
                    <form class="stack-form" @submit.prevent="submitInterest">
                      <select v-model="state.forms.interest.role">
                        <option v-for="role in state.meta.participation_roles" :key="role.value" :value="role.value">{{ role.label }}</option>
                      </select>
                      <input v-model.number="state.forms.interest.available_hours_per_week" type="number" min="0" placeholder="每周可投入小时" />
                      <textarea v-model="state.forms.interest.message" placeholder="补充说明"></textarea>
                      <button class="primary-button" type="submit">申请参与</button>
                    </form>
                    <form class="stack-form compact-form" @submit.prevent="submitScore">
                      <input v-model.number="state.forms.score.score" type="number" min="1" max="10" />
                      <input v-model="state.forms.score.comment" type="text" placeholder="评分备注" />
                      <button class="ghost-button" type="submit">提交评分</button>
                    </form>
                    <div class="button-row">
                      <button class="ghost-button" type="button" @click="submitClaim">认领意向</button>
                      <button class="ghost-button" type="button" @click="submitSponsor">资助意向</button>
                    </div>
                  </aside>
                </div>
              </template>
            </div>
          </section>
        </div>
      </main>
    </div>
  `
};

function emptyThemeForm() {
  return {
    id: null,
    name: "",
    slug: "",
    description: "",
    file_space: JSON.stringify({
      access_level: "restricted_metadata",
      storage_policy: "主题文件域只登记与该主题相关的数据资产元信息，例如公开数据集链接、数据字典、标注规范、伦理合规材料和模型实验资产；不登记单个课题原文、PDF 或公开页面。",
      allowed_file_types: ["dataset", "data_dictionary", "annotation_guide", "ethics", "model_artifact", "dataset_meta", "link", "other"],
      sections: ["数据集文件", "数据字典", "标注规范", "伦理合规材料", "模型与实验资产"]
    }, null, 2),
    sort_order: 0,
    is_active: true
  };
}

function emptyThemeFileForm(themeId = null) {
  return {
    id: null,
    theme_id: themeId,
    section: "数据集文件",
    file_type: "dataset",
    title: "",
    description: "",
    path: "",
    sort_order: 0,
    is_active: true
  };
}

function emptyProjectForm() {
  return {
    id: null,
    topic_id: "",
    theme: "",
    project_no: "",
    title: "",
    summary: "",
    problem_statement: "",
    research_goal: "",
    technical_route: "",
    data_requirements: "{}",
    evaluation_metrics: "[]",
    expected_outputs: "[]",
    compliance_notes: "",
    body_markdown: "",
    stage: "open_recruiting",
    tags: "",
    llm_score: "",
    community_score: "",
    composite_score: "",
    recommended_journal: "",
    needed_roles: "",
    score_dimensions: "{}",
    source_md_path: "",
    source_pdf_path: "",
    page_path: "",
    documents: "[]",
    has_pdf: false,
    is_public: true
  };
}

function projectToForm(project) {
  return {
    id: project.id,
    topic_id: project.topic_id || "",
    theme: project.theme?.slug || project.theme?.name || "",
    project_no: project.project_no ?? "",
    title: project.title || "",
    summary: project.summary || "",
    problem_statement: project.problem_statement || "",
    research_goal: project.research_goal || "",
    technical_route: project.technical_route || "",
    data_requirements: JSON.stringify(project.data_requirements || {}, null, 2),
    evaluation_metrics: JSON.stringify(project.evaluation_metrics || [], null, 2),
    expected_outputs: JSON.stringify(project.expected_outputs || [], null, 2),
    compliance_notes: project.compliance_notes || "",
    body_markdown: project.body_markdown || "",
    stage: project.stage || "open_recruiting",
    tags: (project.tags || []).map((tag) => tag.name).join("，"),
    llm_score: project.llm_score ?? "",
    community_score: project.community_score ?? "",
    composite_score: project.composite_score ?? "",
    recommended_journal: project.recommended_journal || "",
    needed_roles: (project.needed_roles || []).join("，"),
    score_dimensions: JSON.stringify(project.score_dimensions || {}, null, 2),
    source_md_path: project.source_md_path || "",
    source_pdf_path: project.source_pdf_path || "",
    page_path: project.page_path || "",
    documents: JSON.stringify(project.documents || [], null, 2),
    has_pdf: Boolean(project.has_pdf),
    is_public: Boolean(project.is_public)
  };
}

function projectFormPayload(form) {
  return {
    topic_id: form.topic_id.trim(),
    theme: form.theme || "未分类",
    project_no: optionalNumber(form.project_no),
    title: form.title.trim(),
    summary: form.summary,
    problem_statement: form.problem_statement,
    research_goal: form.research_goal,
    technical_route: form.technical_route,
    data_requirements: parseJsonOrFallback(form.data_requirements, {}),
    evaluation_metrics: parseJsonOrFallback(form.evaluation_metrics, []),
    expected_outputs: parseJsonOrFallback(form.expected_outputs, []),
    compliance_notes: form.compliance_notes,
    body_markdown: form.body_markdown,
    stage: form.stage,
    tags: parseListInput(form.tags),
    llm_score: optionalNumber(form.llm_score),
    community_score: optionalNumber(form.community_score),
    composite_score: optionalNumber(form.composite_score),
    recommended_journal: form.recommended_journal,
    needed_roles: parseListInput(form.needed_roles),
    score_dimensions: parseJsonOrFallback(form.score_dimensions, {}),
    source_md_path: form.source_md_path,
    source_pdf_path: form.source_pdf_path,
    page_path: form.page_path,
    documents: parseJsonOrFallback(form.documents, []),
    has_pdf: Boolean(form.has_pdf),
    is_public: Boolean(form.is_public)
  };
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", params: {}, fullPath: location.hash || "#/" };
  if (parts[0] === "project" && parts[1]) return { name: "project", params: { id: parts[1] }, fullPath: location.hash };
  if (parts[0] === "space") return { name: "space", params: { slug: parts[1] || "" }, fullPath: location.hash };
  const known = new Set(["home", "projects", "dashboard", "admin", "login", "register", "password-reset", "password-change"]);
  return { name: known.has(parts[0]) ? parts[0] : "home", params: {}, fullPath: location.hash };
}

function buildHash(name, params = {}) {
  if (name === "project") return `#/project/${params.id}`;
  if (name === "space") return params.slug ? `#/space/${params.slug}` : "#/space";
  if (name === "home") return "#/";
  return `#/${name}`;
}

function displayScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(1);
}

function shortText(text, max = 100) {
  if (!text) return "暂无摘要。";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function roleCountEntries(teamStatus) {
  return Object.entries(teamStatus?.roles || {});
}

function formatList(value) {
  if (!value) return "待补充";
  if (Array.isArray(value)) return value.length ? value.join("、") : "待补充";
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join("、") : item}`)
      .join("；");
  }
  return String(value);
}

function fileTypeLabel(type) {
  return {
    dataset: "数据集文件",
    data_dictionary: "数据字典",
    annotation_guide: "标注规范",
    ethics: "伦理合规材料",
    model_artifact: "模型与实验资产",
    markdown: "Markdown",
    pdf: "PDF",
    html: "网页",
    dataset_meta: "数据说明",
    link: "外部链接",
    other: "其他"
  }[type] || type;
}

function stageLabel(project) {
  return project.stage_label || project.stage || "未设置";
}

function parseJsonOrFallback(text, fallback) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return fallback;
  }
}

function parseListInput(text) {
  return String(text || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roleCardsFor(capabilities) {
  const cards = [];
  if (capabilities.medical_review) cards.push({ title: "医学审核", body: "可参与临床价值判断、术语审核和数据解释。" });
  if (capabilities.technical_delivery) cards.push({ title: "技术实现", body: "可参与模型、RAG、Agent、多模态和工程实现。" });
  if (capabilities.statistical_design) cards.push({ title: "统计设计", body: "可参与样本量、终点、统计方案和结果解释。" });
  if (capabilities.funding_support) cards.push({ title: "资源支持", body: "可表达经费、算力、标注预算或专家咨询支持意向。" });
  if (capabilities.manage_projects) cards.push({ title: "内容管理", body: "可维护主题、课题、文件空间和 JSON 导入。" });
  if (!cards.length) cards.push({ title: "开放协作", body: "可关注、评分、申请参与和认领感兴趣的课题。" });
  return cards;
}

createApp(App).mount("#app");
