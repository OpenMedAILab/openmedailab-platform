import { createApp, computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { API_BASE, api, initCsrf } from "./api.js";
import { isPointInsideProfileHoverZone } from "./profileMenu.js";
import { parseProjectJsonImport, projectImportFileKey, qualityCheckProjectPayload, selectedProjectJsonFiles, sortProjectImportRows, summarizeProjectImportFiles } from "./projectJsonImport.js";
import { latestRelease, releaseHistory, sectionEntries } from "./release.js";

const PAGE_SIZE = 9;
const WORKSPACE_TABS = new Set(["overview", "favorites", "interactions", "profile"]);
const ADMIN_TABS = new Set(["overview", "interactions", "contributions", "projects", "themes", "users", "audit"]);
const FOLLOWABLE_STAGE_VALUES = new Set(["open_recruiting", "team_building", "active"]);
const RECRUITING_STAGE_VALUES = new Set(["open_recruiting", "team_building"]);
const TASK_MANAGEMENT_STAGE_VALUES = ["team_building", "active", "paused"];
const RELATION_STATUS_PRIORITY = { approved: 4, pending: 3, rejected: 2, withdrawn: 1 };
const WITHDRAWABLE_PARTICIPATION_STATUSES = new Set(["pending", "approved"]);
const RELATION_STATUS_LABELS = {
  approved: "获批",
  pending: "申请中",
  rejected: "被拒绝",
  withdrawn: "已撤回"
};

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
    sort: "follows",
    page: 1,
    page_size: PAGE_SIZE
  },
  currentProject: null,
  currentProjectThemeSpace: null,
  projectThemeSpaces: {},
  expandedProjectIds: [],
  preview: {
    open: false,
    maximized: false,
    loading: false,
    returnScroll: 0,
    returnProjectId: null
  },
  themeSpace: null,
  dashboard: null,
  workspaceTab: "overview",
  favoriteProjectIds: [],
  likedProjectIds: [],
  unlikedProjectIds: [],
  participationProjectIds: [],
  participationRequestsByProjectId: {},
  sponsorRequestsByProjectId: {},
  submittingParticipationProjectIds: [],
  withdrawingParticipationProjectIds: [],
  submittingLikeProjectIds: [],
  submittingSponsorProjectIds: [],
  withdrawingSponsorProjectIds: [],
  favoritesLoaded: false,
  profileMenuOpen: false,
  releaseModalOpen: false,
  confirmDialog: {
    open: false,
    title: "",
    message: "",
    confirmText: "确认",
    cancelText: "取消",
    tone: "default"
  },
  expandedReleaseVersions: [],
  schema: null,
  admin: {
    activeTab: "overview",
    overview: null,
    themes: [],
    projects: [],
    projectPagination: {},
    projectFilters: { q: "", theme: "", page: 1, page_size: 25 },
    hasMoreProjects: false,
    loadingProjects: false,
    updatingProjectStageId: null,
    selectedProjectIds: [],
    bulkArchivingProjects: false,
    projectFormOpen: false,
    projectForm: emptyProjectForm(),
    themeForm: emptyThemeForm(),
    selectedThemeId: null,
    themeFiles: [],
    themeFilePagination: {},
    themeFileForm: emptyThemeFileForm(),
    fileManager: {
      loading: false,
      rootSaving: false,
      currentPath: "",
      rootPath: "",
      baseRoot: "",
      breadcrumbs: [],
      entries: [],
      selected: null,
      editorOpen: false,
      editorPath: "",
      editorName: "",
      editorContent: "",
      serverDirectory: "",
      newDirectoryName: "",
      newFileName: "",
      uploading: false
    },
    users: [],
    userPagination: {},
    userFilters: { q: "", page: 1, page_size: 50 },
    loadingUsers: false,
    resettingUid: "",
    passwordResetResult: null,
    interactions: [],
    interactionPagination: {},
    interactionFilters: { type: "", status: "pending", q: "", page: 1, page_size: 50 },
    loadingInteractions: false,
    taskProjects: [],
    loadingTaskProjects: false,
    taskProjectFilters: { stage: "", q: "", page_size: 100 },
    taskProjectDetail: {
      open: false,
      loading: false,
      project: null,
      interactions: [],
      contributions: [],
      reviewDrafts: {}
    },
    tasks: [],
    taskPagination: {},
    taskFilters: { status: "", q: "", page: 1, page_size: 50 },
    taskForm: emptyTaskForm(),
    loadingTasks: false,
    contributions: [],
    contributionPagination: {},
    contributionFilters: { status: "", user: "", project: "", page: 1, page_size: 50 },
    loadingContributions: false,
    credits: [],
    creditPagination: {},
    creditFilters: { uid: "", action_type: "", page: 1, page_size: 50 },
    auditLogs: [],
    auditPagination: {},
    auditFilters: { action: "", target_type: "", page: 1, page_size: 50 },
    loadingAuditLogs: false,
    jsonImport: {
      rows: [],
      applying: false,
      fileCount: 0,
      autoNumber: true,
      selection: {
        totalFileCount: 0,
        jsonFileCount: 0,
        matchedPdfCount: 0,
        ignoredFileCount: 0
      },
      previewOpen: false
    }
  },
  forms: {
    login: { username: "", password: "" },
    register: { username: "", email: "", display_name: "", role_type: "undergrad_or_below", password1: "", password2: "" },
    passwordChange: { password1: "", password2: "" },
    score: { score: 8, comment: "" },
    interest: { role: "学生", available_hours_per_week: 4, experience: "", message: "" },
    claim: { claim_type: "leader", message: "" },
    sponsor: { sponsor_type: "compute", note: "" },
    profile: emptyProfileForm(),
    contribution: emptyContributionForm()
  },
  contributionModal: {
    open: false,
    project: null,
    relation: null,
    submitting: false
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
        { name: "home", label: "首页" },
        { name: "space", label: "文件空间" }
      ];
      if (state.user) {
        items.push({ name: "dashboard", label: "我的空间" });
      }
      if (can("view_admin_console")) items.push({ name: "admin", label: "管理" });
      return items;
    });
    const selectedTheme = computed(() => state.meta.themes.find((theme) => theme.slug === state.filters.theme) || null);
    const selectedSpaceSlug = computed(() => state.route.params.slug || selectedTheme.value?.slug || state.meta.themes[0]?.slug || "");
    const selectedAdminTheme = computed(() => state.admin.themes.find((theme) => theme.id === Number(state.admin.selectedThemeId)) || null);
    const homeThemeCards = computed(() => topicThemeCards(state.meta.themes));
    const roleCards = computed(() => roleCardsFor(capabilities.value));
    const favoriteProjects = computed(() => (state.dashboard?.follows || []).map((item) => item.project));
    const myProjectTasks = computed(() => buildMyProjectTasks(state.dashboard));
    const workspaceOverviewCards = computed(() => {
      const dashboard = state.dashboard || {};
      const approvedCount = [
        ...(dashboard.interests || []),
        ...(dashboard.claims || []),
        ...(dashboard.sponsors || [])
      ].filter((item) => item.status === "approved").length;
      return [
        { title: "关注课题", value: `${(dashboard.follows || []).length} 个`, tab: "favorites" },
        { title: "我的任务", value: `${myProjectTasks.value.length} 个`, tab: "interactions" },
        { title: "任务结果", value: `${(dashboard.contributions || []).length} 条`, tab: "interactions" },
        { title: "已通过协作", value: `${approvedCount} 条`, tab: "interactions" }
      ];
    });
    const adminOverviewCards = computed(() => [
      { title: "用户", value: state.admin.overview?.counts?.users || 0, tab: "users" },
      { title: "课题", value: state.admin.overview?.counts?.projects || 0, tab: "projects" },
      { title: "任务审批", value: state.admin.overview?.counts?.pending_interactions || 0, tab: "interactions" },
      { title: "任务结果", value: state.admin.overview?.counts?.submitted_contributions || 0, tab: "contributions" },
      { title: "主题文件空间", value: state.admin.overview?.counts?.themes || 0, tab: "themes" },
      { title: "审计日志", value: state.admin.overview?.counts?.audit_logs || 0, tab: "audit" }
    ]);
    const releaseLatest = computed(() => latestRelease(state.meta.release));
    const releaseHistoryItems = computed(() => releaseHistory(state.meta.release));
    const profilePointer = { x: 0, y: 0 };
    let confirmDialogResolver = null;
    const modalOpen = computed(() => Boolean(
      state.preview.open ||
      state.releaseModalOpen ||
      state.confirmDialog.open ||
      state.admin.projectFormOpen ||
      state.admin.taskProjectDetail.open ||
      state.contributionModal.open ||
      state.admin.fileManager.editorOpen
    ));

    onMounted(async () => {
      window.addEventListener("hashchange", handleRouteChange);
      window.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("keydown", handleKeydown);
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      await boot();
    });

    onBeforeUnmount(() => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pointermove", handlePointerMove);
      document.body.classList.remove("modal-open");
    });

    watch(
      modalOpen,
      (open) => {
        document.body.classList.toggle("modal-open", open);
      },
      { immediate: true }
    );

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
      if (state.route.name === "favorites") {
        await loadFavorites({ force: true });
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
        if (state.user && !state.favoritesLoaded) {
          await loadFavorites();
        }
        const data = await api.projects(projectListRequestParams());
        const existing = new Set(state.projects.map((item) => item.id));
        const fresh = data.results.filter((item) => !existing.has(item.id));
        state.projects = sortProjectsForCurrentFilter(reset ? data.results : [...state.projects, ...fresh]);
        applyViewerProjectState();
        state.pagination = data.pagination;
        state.hasMoreProjects = Boolean(data.pagination?.has_next);
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
        state.loadingMore = false;
      }
    }

    function projectListRequestParams() {
      const params = { ...state.filters };
      if (params.sort === "likes") {
        params.sort = "follows";
      }
      return params;
    }

    function sortProjectsForCurrentFilter(projects = []) {
      const rows = [...projects];
      if (state.filters.sort === "updated") {
        return rows.sort((a, b) => projectUpdatedTime(b) - projectUpdatedTime(a));
      }
      if (state.filters.sort === "likes") {
        return rows.sort((a, b) => (
          numericProjectField(b, "score_count") - numericProjectField(a, "score_count") ||
          numericProjectField(b, "follow_count") - numericProjectField(a, "follow_count") ||
          projectUpdatedTime(b) - projectUpdatedTime(a) ||
          projectTopicSortValue(a) - projectTopicSortValue(b)
        ));
      }
      return rows.sort((a, b) => (
        numericProjectField(b, "follow_count") - numericProjectField(a, "follow_count") ||
        numericProjectField(b, "score_count") - numericProjectField(a, "score_count") ||
        projectUpdatedTime(b) - projectUpdatedTime(a) ||
        projectTopicSortValue(a) - projectTopicSortValue(b)
      ));
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
      state.currentProjectThemeSpace = null;
      try {
        state.currentProject = await api.project(id);
        if (state.user && !state.favoritesLoaded) {
          await loadFavorites();
        }
        applyProjectViewerState(state.currentProject);
        state.forms.score.score = state.currentProject.viewer_state?.score?.score || 8;
        state.forms.score.comment = state.currentProject.viewer_state?.score?.comment || "";
        await loadProjectThemeSpace(state.currentProject.theme?.slug);
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

    async function loadProjectThemeSpace(slug) {
      state.currentProjectThemeSpace = null;
      if (!slug) return;
      if (state.projectThemeSpaces[slug]) {
        state.currentProjectThemeSpace = state.projectThemeSpaces[slug];
        return;
      }
      try {
        const data = await api.themeSpace(slug);
        state.projectThemeSpaces[slug] = data;
        state.currentProjectThemeSpace = data;
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadDashboard() {
      if (!state.user) {
        navigate("login");
        return;
      }
      state.loading = true;
      try {
        syncDashboard(await api.dashboard());
        syncProfileForm();
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadFavorites({ force = false } = {}) {
      if (!state.user) {
        navigate("login");
        return;
      }
      if (state.favoritesLoaded && !force) return;
      const data = await api.dashboard();
      syncDashboard(data);
      applyViewerProjectState();
    }

    function syncDashboard(data) {
      state.dashboard = data;
      state.favoriteProjectIds = (data.follows || []).map((item) => item.project.id);
      state.likedProjectIds = (data.scores || [])
        .map((item) => item.project.id)
        .filter((id) => !state.unlikedProjectIds.includes(id));
      state.participationRequestsByProjectId = participationRequestsByProject(data.interests || []);
      state.sponsorRequestsByProjectId = sponsorRequestsByProject(data.sponsors || []);
      state.participationProjectIds = Object.values(state.participationRequestsByProjectId)
        .filter((item) => isActiveParticipationRequest(item))
        .map((item) => item.project.id);
      state.favoritesLoaded = true;
    }

    function participationRequestsByProject(interests = []) {
      const requests = {};
      interests.forEach((item) => {
        const projectId = item.project?.id;
        if (!projectId) return;
        const current = requests[projectId];
        if (!current || participationRequestSortValue(item) > participationRequestSortValue(current)) {
          requests[projectId] = item;
        }
      });
      return requests;
    }

    function sponsorRequestsByProject(sponsors = []) {
      const requests = {};
      sponsors.forEach((item) => {
        const projectId = item.project?.id;
        if (!projectId) return;
        const current = requests[projectId];
        if (!current || participationRequestSortValue(item) > participationRequestSortValue(current)) {
          requests[projectId] = item;
        }
      });
      return requests;
    }

    function participationRequestSortValue(request) {
      const priority = RELATION_STATUS_PRIORITY[request?.status] || 0;
      const updatedAt = new Date(request?.updated_at || request?.created_at || 0).getTime();
      return priority * 10000000000000 + (Number.isFinite(updatedAt) ? updatedAt : 0);
    }

    function syncProfileForm() {
      const profile = state.user?.profile;
      if (!profile) return;
      state.forms.profile = {
        display_name: profile.display_name || "",
        real_name: profile.real_name || "",
        role_type: profile.role_type || "undergrad_or_below",
        organization: profile.organization || "",
        title: profile.title || "",
        research_interests: profile.research_interests || "",
        skills: profile.skills || "",
        available_hours_per_week: profile.available_hours_per_week || 0,
        contact_email: profile.contact_email || state.user.email || "",
        contact_wechat: profile.contact_wechat || "",
        bio: profile.bio || ""
      };
    }

    function buildMyProjectTasks(dashboard) {
      if (!dashboard) return [];
      const groups = new Map();
      const ensureGroup = (project) => {
        if (!project?.id) return null;
        if (!groups.has(project.id)) {
          groups.set(project.id, { project, relations: [], contributions: [] });
        }
        return groups.get(project.id);
      };
      const addRelation = (collection, type, typeLabel, subtypeKey, subtypeLabelKey) => {
        for (const item of collection || []) {
          const group = ensureGroup(item.project);
          if (!group) continue;
          group.relations.push({
            ...item,
            relation_type: type,
            relation_type_label: typeLabel,
            subtype_label: item[subtypeLabelKey] || item[subtypeKey] || ""
          });
        }
      };
      addRelation(dashboard.interests, "interest", "参与", "role", "role_label");
      addRelation(dashboard.claims, "claim", "认领", "claim_type", "claim_type_label");
      addRelation(dashboard.sponsors, "sponsor", "资助", "sponsor_type", "sponsor_type_label");
      for (const contribution of dashboard.contributions || []) {
        const group = ensureGroup(contribution.project);
        if (group) group.contributions.push(contribution);
      }
      return Array.from(groups.values())
        .map((group) => ({ ...group, status: bestTaskRelationStatus(group.relations) }))
        .sort((a, b) => {
          const priorityDiff = (RELATION_STATUS_PRIORITY[b.status] || 0) - (RELATION_STATUS_PRIORITY[a.status] || 0);
          if (priorityDiff) return priorityDiff;
          return Number(a.project.topic_id || 0) - Number(b.project.topic_id || 0);
        });
    }

    function bestTaskRelationStatus(relations = []) {
      let best = "";
      for (const relation of relations) {
        if ((RELATION_STATUS_PRIORITY[relation.status] || 0) > (RELATION_STATUS_PRIORITY[best] || 0)) {
          best = relation.status;
        }
      }
      return best || "none";
    }

    function myTaskStatusLabel(task) {
      return RELATION_STATUS_LABELS[task?.status] || (task?.relations?.length ? "状态待确认" : "暂无申请");
    }

    function approvedTaskRelations(task) {
      return (task?.relations || []).filter((relation) => relation.status === "approved");
    }

    function canSubmitProjectTask(task) {
      return task?.project?.stage === "active" && approvedTaskRelations(task).length > 0;
    }

    function taskSubmitHint(task) {
      if (canSubmitProjectTask(task)) return "";
      if (!approvedTaskRelations(task).length) {
        if (task?.status === "pending") return "申请审核中，获批后可提交";
        if (task?.status === "rejected") return "申请未通过，不能提交";
        if (task?.status === "withdrawn") return "申请已撤回，不能提交";
        return "获批后可提交";
      }
      const stage = task?.project?.stage;
      if (stage === "team_building") return "组队中，进入进行中后可提交";
      if (stage === "paused") return "课题暂停中，暂不可提交";
      if (stage === "archived") return "课题已归档，不能提交";
      return "当前阶段暂不可提交";
    }

    function taskRelationSummary(task) {
      const relations = task?.relations || [];
      if (!relations.length) return "暂无申请记录";
      return relations
        .map((relation) => `${relation.relation_type_label}${relation.subtype_label ? `：${relation.subtype_label}` : ""}（${relation.status_label || myTaskStatusLabel({ status: relation.status })}）`)
        .join("；");
    }

    function contributionStatusText(contribution) {
      const typeLabel = contribution.result_type_label || (contribution.result_type === "final" ? "最终结果" : "阶段性成果");
      return `${typeLabel} · ${contribution.status_label || "已提交"}`;
    }

    function setWorkspaceTab(tab) {
      if (!WORKSPACE_TABS.has(tab)) {
        state.workspaceTab = "overview";
        return;
      }
      state.workspaceTab = tab;
      if (tab === "favorites") {
        loadFavorites({ force: true });
      }
    }

    async function saveProfile() {
      if (!state.user) return;
      try {
        state.user = await api.profile(state.forms.profile);
        state.rbac = state.user.rbac;
        syncProfileForm();
        showToast("个人资料已更新");
      } catch (error) {
        showToast(error.message || "个人资料保存失败");
      }
    }

    async function startMyTask(task) {
      try {
        await api.updateMeTaskStatus(task.id, { status: "in_progress" });
        showToast("任务已标记为进行中");
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }

    function prepareContribution(task = null) {
      const projectTask = task?.project ? { project: task.project, relations: [{ status: "approved" }] } : task;
      openContributionModal(projectTask || { project: state.currentProject, relations: [{ status: "approved" }] });
      if (state.route.name !== "dashboard") {
        navigate("dashboard");
      }
    }

    function openContributionModal(task) {
      if (!canSubmitProjectTask(task)) {
        showToast(taskSubmitHint(task));
        return;
      }
      closeMutuallyExclusiveModals("contribution");
      const relation = approvedTaskRelations(task)[0] || null;
      state.contributionModal.open = true;
      state.contributionModal.project = task.project;
      state.contributionModal.relation = relation;
      state.forms.contribution = emptyContributionForm(null, task.project);
    }

    function closeContributionModal() {
      state.contributionModal.open = false;
      state.contributionModal.project = null;
      state.contributionModal.relation = null;
      state.forms.contribution = emptyContributionForm();
    }

    async function submitContribution() {
      if (!state.user) return;
      try {
        const payload = {
          project_id: Number(state.forms.contribution.project_id),
          task_id: state.forms.contribution.task_id ? Number(state.forms.contribution.task_id) : null,
          title: state.forms.contribution.title,
          result_type: state.forms.contribution.result_type || "stage",
          description: state.forms.contribution.description,
          file_path: state.forms.contribution.file_path
        };
        if (!payload.project_id || !payload.title.trim()) {
          showToast("任务结果需要选择课题并填写标题");
          return;
        }
        state.contributionModal.submitting = true;
        await api.createMeContribution(payload);
        closeContributionModal();
        showToast("任务结果已提交，等待管理员审核");
        await loadDashboard();
      } catch (error) {
        showToast(error.message || "任务结果提交失败");
      } finally {
        state.contributionModal.submitting = false;
      }
    }

    async function loadAdmin() {
      if (!can("view_admin_console")) return;
      state.loading = true;
      try {
        const [overview, themes] = await Promise.all([api.adminOverview(), api.adminThemes()]);
        state.admin.overview = overview;
        state.admin.themes = themes.results;
        if (!state.admin.selectedThemeId && themes.results.length) {
          state.admin.selectedThemeId = themes.results[0].id;
        }
        await loadActiveAdminTab();
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadActiveAdminTab() {
      if (!ADMIN_TABS.has(state.admin.activeTab)) {
        state.admin.activeTab = "overview";
      }
      if (state.admin.activeTab === "overview") return;
      if (state.admin.activeTab === "projects") await loadAdminProjects({ reset: true });
      if (state.admin.activeTab === "themes") await loadThemeFiles();
      if (state.admin.activeTab === "users") await loadAdminUsers({ reset: true });
      if (state.admin.activeTab === "interactions") {
        await loadAdminInteractions({ reset: true });
      }
      if (state.admin.activeTab === "contributions") await loadAdminTaskProjects({ reset: true });
      if (state.admin.activeTab === "audit") await loadAdminAuditLogs({ reset: true });
    }

    async function loadAdminProjects({ reset = false } = {}) {
      if (reset) {
        state.admin.projectFilters.page = 1;
        state.admin.projects = [];
        state.admin.selectedProjectIds = [];
      }
      state.admin.loadingProjects = true;
      try {
        const data = await api.adminProjects(state.admin.projectFilters);
        const existing = new Set(state.admin.projects.map((item) => item.id));
        const fresh = data.results.filter((item) => !existing.has(item.id));
        state.admin.projects = reset ? data.results : [...state.admin.projects, ...fresh];
        const loadedIds = new Set(state.admin.projects.map((item) => item.id));
        state.admin.selectedProjectIds = state.admin.selectedProjectIds.filter((id) => loadedIds.has(id));
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
      const confirmed = await openConfirmDialog({
        title: "确认恢复默认密码",
        message: `确认将「${user.username}」恢复为系统默认密码吗？`,
        confirmText: "恢复默认密码"
      });
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
      if (state.preview.open) {
        state.preview.open = false;
        state.preview.maximized = false;
      }
      navigate("space", { slug });
    }

    async function login() {
      try {
        state.user = await api.login(state.forms.login);
        state.rbac = state.user.rbac;
        resetUserProjectState();
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
        resetUserProjectState();
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
        resetUserProjectState();
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
      resetUserProjectState();
      state.profileMenuOpen = false;
      state.rbac = await api.rbac();
      showToast("已退出");
      navigate("home");
    }

    function resetUserProjectState() {
      state.dashboard = null;
      state.favoriteProjectIds = [];
      state.likedProjectIds = [];
      state.unlikedProjectIds = [];
      state.participationProjectIds = [];
      state.participationRequestsByProjectId = {};
      state.sponsorRequestsByProjectId = {};
      state.submittingParticipationProjectIds = [];
      state.withdrawingParticipationProjectIds = [];
      state.submittingLikeProjectIds = [];
      state.submittingSponsorProjectIds = [];
      state.withdrawingSponsorProjectIds = [];
      state.favoritesLoaded = false;
    }

    async function toggleFollow(project) {
      if (!ensureLogin()) return;
      const wasFollowing = isProjectFollowing(project);
      if (!wasFollowing && !canFollowProject(project)) {
        showToast("当前阶段暂不可关注");
        return;
      }
      try {
        if (wasFollowing) {
          await api.unfollow(project.id);
          setProjectFollowing(project, false);
          showToast("已取消关注");
        } else {
          await api.follow(project.id);
          setProjectFollowing(project, true);
          showToast("已关注课题");
        }
      } catch (error) {
        showToast(error.message);
      }
    }

    function invalidateProjectStatusCard() {
      return null;
    }

    function projectStageValue(project) {
      return project?.stage || "";
    }

    function canFollowProject(project) {
      return FOLLOWABLE_STAGE_VALUES.has(projectStageValue(project));
    }

    function shouldShowFollowButton(project) {
      return canFollowProject(project) || isProjectFollowing(project);
    }

    function canRecruitProject(project) {
      return RECRUITING_STAGE_VALUES.has(projectStageValue(project));
    }

    function isProjectExpanded(project) {
      return state.expandedProjectIds.includes(project?.id);
    }

    function toggleProjectExpansion(project) {
      const id = project?.id;
      if (!id) return;
      state.expandedProjectIds = isProjectExpanded(project)
        ? state.expandedProjectIds.filter((item) => item !== id)
        : [...state.expandedProjectIds, id];
    }

    function projectSummaryText(project) {
      return project?.summary || project?.problem_statement || "这个课题还没有填写摘要。";
    }

    function canReviewInteraction(item) {
      return item?.status === "pending";
    }

    function taskProgressLabel(task) {
      const value = Number(task?.progress_percent ?? 0);
      return `${Number.isFinite(value) ? value : 0}%`;
    }

    function taskParticipantUids(task) {
      const uids = task?.participant_uids?.length ? task.participant_uids : [task?.assignee_uid];
      return uids.filter(Boolean);
    }

    function isProjectFollowing(project) {
      if (!project) return false;
      return Boolean(project.viewer_state?.is_following || state.favoriteProjectIds.includes(project.id));
    }

    function followButtonLabel(project) {
      return isProjectFollowing(project) ? "取消关注" : "关注";
    }

    function applyProjectFollowState(project = null) {
      if (project) {
        applyProjectViewerState(project);
        return;
      }
      applyViewerProjectState();
    }

    function setProjectFollowing(project, following) {
      const id = project.id;
      const previous = isProjectFollowing(project);
      state.favoriteProjectIds = following
        ? Array.from(new Set([...state.favoriteProjectIds, id]))
        : state.favoriteProjectIds.filter((item) => item !== id);
      const targets = new Set([project, ...state.projects.filter((item) => item.id === id)]);
      if (state.currentProject?.id === id) {
        targets.add(state.currentProject);
      }
      targets.forEach((item) => updateProjectInstance(item, following, previous));
      if (state.dashboard) {
        if (following && !state.dashboard.follows.some((item) => item.project.id === id)) {
          state.dashboard.follows = [{ id: `local-${id}`, project, created_at: new Date().toISOString() }, ...state.dashboard.follows];
        }
        if (!following) {
          state.dashboard.follows = state.dashboard.follows.filter((item) => item.project.id !== id);
        }
      }
      state.projects = sortProjectsForCurrentFilter(state.projects);
    }

    function updateProjectInstance(project, following, previous) {
      project.viewer_state = { ...(project.viewer_state || {}), is_following: following };
      if (following !== previous && typeof project.follow_count === "number") {
        project.follow_count = Math.max(0, project.follow_count + (following ? 1 : -1));
      }
      invalidateProjectStatusCard(project.id);
    }

    async function submitLike(project) {
      if (!ensureLogin()) return;
      if (isSubmittingLike(project)) return;
      if (isProjectLiked(project)) {
        state.submittingLikeProjectIds = addUniqueId(state.submittingLikeProjectIds, project.id);
        try {
          await api.unscore(project.id);
          markProjectUnliked(project);
          invalidateProjectStatusCard(project.id);
          showToast("已取消点赞");
        } catch (error) {
          showToast(error.message || "取消点赞失败");
        } finally {
          state.submittingLikeProjectIds = removeId(state.submittingLikeProjectIds, project.id);
        }
        return;
      }
      state.submittingLikeProjectIds = addUniqueId(state.submittingLikeProjectIds, project.id);
      try {
        await api.score(project.id, { score: 10, comment: "点赞" });
        markProjectLiked(project);
        invalidateProjectStatusCard(project.id);
        showToast("已点赞");
      } catch (error) {
        showToast(error.message || "点赞失败");
      } finally {
        state.submittingLikeProjectIds = removeId(state.submittingLikeProjectIds, project.id);
      }
    }

    function markProjectLiked(project) {
      const id = project?.id;
      if (!id) return;
      state.unlikedProjectIds = removeId(state.unlikedProjectIds, id);
      state.likedProjectIds = addUniqueId(state.likedProjectIds, id);
      const targets = new Set([project, ...state.projects.filter((item) => item.id === id)]);
      if (state.currentProject?.id === id) {
        targets.add(state.currentProject);
      }
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      targets.forEach((item) => {
        const alreadyLiked = Boolean(item.viewer_state?.score);
        item.viewer_state = {
          ...(item.viewer_state || {}),
          score: { score: 10, comment: "点赞" }
        };
        if (!alreadyLiked && typeof item.score_count === "number") {
          item.score_count += 1;
        }
      });
      state.projects = sortProjectsForCurrentFilter(state.projects);
    }

    function markProjectUnliked(project) {
      const id = project?.id;
      if (!id) return;
      const wasLikedByState = state.likedProjectIds.includes(id);
      state.unlikedProjectIds = addUniqueId(state.unlikedProjectIds, id);
      state.likedProjectIds = removeId(state.likedProjectIds, id);
      const targets = projectTargets(id, project);
      targets.forEach((item) => {
        const wasLiked = Boolean(item.viewer_state?.score || wasLikedByState);
        if (item.viewer_state?.score) {
          const { score: _score, ...rest } = item.viewer_state;
          item.viewer_state = rest;
        }
        if (wasLiked && typeof item.score_count === "number") {
          item.score_count = Math.max(0, item.score_count - 1);
        }
      });
      if (state.dashboard?.scores) {
        state.dashboard.scores = state.dashboard.scores.filter((item) => item.project?.id !== id);
      }
      state.projects = sortProjectsForCurrentFilter(state.projects);
    }

    function projectTargets(id, project = null) {
      const targets = new Set([...(project ? [project] : []), ...state.projects.filter((item) => item.id === id)]);
      if (state.currentProject?.id === id) {
        targets.add(state.currentProject);
      }
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      return targets;
    }

    async function submitInterest() {
      if (!ensureLogin()) return;
      if (!canRecruitProject(state.currentProject)) {
        showToast("当前阶段暂不接受新的参与申请");
        return;
      }
      await submitInteraction(() => api.interest(state.currentProject.id, state.forms.interest), "申请参与已提交");
    }

    async function submitParticipationRequest(project) {
      if (!ensureLogin()) return;
      if (!canRecruitProject(project)) {
        showToast("当前阶段暂不接受新的参与申请");
        return;
      }
      if (participationRequestCanWithdraw(project)) {
        await withdrawParticipationRequest(project);
        return;
      }
      if (isParticipationRequested(project)) {
        showToast("申请参与已提交");
        return;
      }
      const role = participationRoleForCurrentUser();
      state.submittingParticipationProjectIds = addUniqueId(state.submittingParticipationProjectIds, project.id);
      try {
        const request = await api.interest(project.id, {
          role,
          available_hours_per_week: Number(state.user?.profile?.available_hours_per_week || 4),
          experience: "",
          message: "申请参与开放课题协作"
        });
        markProjectInterestSubmitted(project, request, role);
        invalidateProjectStatusCard(project.id);
        showToast("申请参与已提交");
      } catch (error) {
        showToast(error.message || "申请参与失败");
      } finally {
        state.submittingParticipationProjectIds = removeId(state.submittingParticipationProjectIds, project.id);
      }
    }

    async function handleParticipationAction(project) {
      if (participationRequestCanWithdraw(project)) {
        await withdrawParticipationRequest(project);
        return;
      }
      await submitParticipationRequest(project);
    }

    async function withdrawParticipationRequest(project) {
      if (!ensureLogin()) return;
      const request = participationRequestForProject(project);
      if (!request?.id || !isActiveParticipationRequest(request)) {
        showToast("没有可撤回的申请");
        return;
      }
      const confirmed = await openConfirmDialog({
        title: "撤回申请参与",
        message: `确认撤回「${project.title}」的申请参与吗？`,
        confirmText: "撤回申请",
        tone: "danger"
      });
      if (!confirmed) return;
      state.withdrawingParticipationProjectIds = addUniqueId(state.withdrawingParticipationProjectIds, project.id);
      try {
        const withdrawn = await api.withdrawInteraction("interest", request.id, { reason: "用户主动撤回申请参与" });
        markProjectInterestWithdrawn(project, withdrawn || request);
        invalidateProjectStatusCard(project.id);
        showToast("已撤回申请");
        if (state.user) {
          await loadFavorites({ force: true });
        }
      } catch (error) {
        showToast(error.message || "撤回申请失败");
      } finally {
        state.withdrawingParticipationProjectIds = removeId(state.withdrawingParticipationProjectIds, project.id);
      }
    }

    async function submitClaim() {
      await submitLeadClaim(state.currentProject);
    }

    async function submitLeadClaim(project) {
      if (!ensureLogin()) return;
      if (!canRecruitProject(project)) {
        showToast("当前阶段暂不接受新的 Lead 申请");
        return;
      }
      try {
        await api.claim(project.id, { claim_type: "leader", message: "申请担任项目负责人" });
        invalidateProjectStatusCard(project.id);
        showToast("Lead 申请已提交");
        if (state.currentProject?.id === project.id) {
          await loadProject(project.id, { preview: state.preview.open });
        } else {
          await loadProjects({ reset: true });
        }
      } catch (error) {
        showToast(error.message || "Lead 申请失败");
      }
    }

    async function submitSponsor(project = state.currentProject) {
      if (!ensureLogin()) return;
      const targetProject = project?.id ? project : state.currentProject;
      if (!targetProject?.id) {
        showToast("请选择要资助的课题");
        return;
      }
      if (sponsorRequestCanWithdraw(targetProject)) {
        await withdrawSponsorRequest(targetProject);
        return;
      }
      if (isSubmittingSponsor(targetProject)) return;
      if (!canRecruitProject(targetProject)) {
        showToast("当前阶段暂不接受新的资助意向");
        return;
      }
      state.submittingSponsorProjectIds = addUniqueId(state.submittingSponsorProjectIds, targetProject.id);
      try {
        const request = await api.sponsor(targetProject.id, state.forms.sponsor);
        markProjectSponsorSubmitted(targetProject, request);
        invalidateProjectStatusCard(targetProject.id);
        showToast("资助意向已记录");
        if (state.currentProject?.id === targetProject.id) {
          await loadProject(targetProject.id, { preview: state.preview.open });
        } else {
          await loadProjects({ reset: true });
        }
      } catch (error) {
        showToast(error.message || "资助意向提交失败");
      } finally {
        state.submittingSponsorProjectIds = removeId(state.submittingSponsorProjectIds, targetProject.id);
      }
    }

    async function withdrawSponsorRequest(project) {
      if (!ensureLogin()) return;
      const request = sponsorRequestForProject(project);
      if (!request?.id || !isActiveParticipationRequest(request)) {
        showToast("没有可撤回的资助意向");
        return;
      }
      state.withdrawingSponsorProjectIds = addUniqueId(state.withdrawingSponsorProjectIds, project.id);
      try {
        const withdrawn = await api.withdrawInteraction("sponsor", request.id, { reason: "用户主动撤回资助意向" });
        markProjectSponsorWithdrawn(project, withdrawn || request);
        invalidateProjectStatusCard(project.id);
        showToast("已撤回资助");
        if (state.user) {
          await loadFavorites({ force: true });
        }
      } catch (error) {
        showToast(error.message || "撤回资助失败");
      } finally {
        state.withdrawingSponsorProjectIds = removeId(state.withdrawingSponsorProjectIds, project.id);
      }
    }

    async function withdrawInteraction(type, item) {
      if (!ensureLogin()) return;
      try {
        await api.withdrawInteraction(type, item.id, { reason: "用户主动撤回" });
        invalidateProjectStatusCard(item.project?.id);
        showToast("已撤回");
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }

    async function submitInteraction(action, message) {
      const projectId = state.currentProject?.id;
      try {
        await action();
        invalidateProjectStatusCard(projectId);
        showToast(message);
        await loadProject(projectId);
      } catch (error) {
        showToast(error.message);
      }
    }

    function participationRoleForCurrentUser() {
      const roleType = state.user?.profile?.role_type || "";
      if (roleType === "doctor") return "医生";
      if (roleType === "engineer") return "AI工程师";
      if (["undergrad_or_below", "master_student", "phd_student"].includes(roleType)) return "学生";
      return "其他";
    }

    function markProjectInterestSubmitted(project, request = null, fallbackRole = "") {
      const id = project?.id;
      if (!id) return;
      const role = request?.role || fallbackRole;
      const savedRequest = {
        ...(request || {}),
        id: request?.id || `local-${id}`,
        project: request?.project || project,
        role,
        status: request?.status || "pending",
        status_label: request?.status_label || "待处理"
      };
      state.participationRequestsByProjectId = {
        ...state.participationRequestsByProjectId,
        [id]: savedRequest
      };
      state.participationProjectIds = addUniqueId(state.participationProjectIds, id);
      const targets = new Set([project, ...state.projects.filter((item) => item.id === id)]);
      if (state.currentProject?.id === id) {
        targets.add(state.currentProject);
      }
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      targets.forEach((item) => {
        const roles = new Set(item.viewer_state?.interest_roles || []);
        const alreadySubmitted = roles.has(role);
        roles.add(role);
        item.viewer_state = {
          ...(item.viewer_state || {}),
          interest_roles: Array.from(roles),
          relationship_labels: [...new Set([...(item.viewer_state?.relationship_labels || []), participationRelationshipLabel(savedRequest)])]
        };
        if (!alreadySubmitted && typeof item.interest_count === "number") {
          item.interest_count += 1;
        }
      });
    }

    function markProjectInterestWithdrawn(project, request = null) {
      const id = project?.id || request?.project?.id;
      if (!id) return;
      const savedRequest = {
        ...(participationRequestForProject(project) || {}),
        ...(request || {}),
        project: request?.project || project,
        status: request?.status || "withdrawn",
        status_label: request?.status_label || "已撤回"
      };
      state.participationRequestsByProjectId = {
        ...state.participationRequestsByProjectId,
        [id]: savedRequest
      };
      state.participationProjectIds = removeId(state.participationProjectIds, id);
      const targets = new Set([project, ...state.projects.filter((item) => item.id === id)]);
      if (state.currentProject?.id === id) {
        targets.add(state.currentProject);
      }
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      targets.forEach((item) => clearProjectParticipationViewerState(item));
    }

    function markProjectSponsorSubmitted(project, request = null) {
      const id = project?.id;
      if (!id) return;
      const savedRequest = {
        ...(request || {}),
        id: request?.id || `local-sponsor-${id}`,
        project: request?.project || project,
        status: request?.status || "pending",
        status_label: request?.status_label || "待处理"
      };
      state.sponsorRequestsByProjectId = {
        ...state.sponsorRequestsByProjectId,
        [id]: savedRequest
      };
      if (state.dashboard?.sponsors && !state.dashboard.sponsors.some((item) => item.id === savedRequest.id)) {
        state.dashboard.sponsors = [{ ...savedRequest, project }, ...state.dashboard.sponsors];
      }
      if (savedRequest.status === "approved") {
        updateProjectSponsorCount(id, project, 1);
      }
    }

    function markProjectSponsorWithdrawn(project, request = null) {
      const id = project?.id || request?.project?.id;
      if (!id) return;
      const previous = sponsorRequestForProject(project);
      const savedRequest = {
        ...(previous || {}),
        ...(request || {}),
        project: request?.project || project,
        status: request?.status || "withdrawn",
        status_label: request?.status_label || "已撤回"
      };
      state.sponsorRequestsByProjectId = {
        ...state.sponsorRequestsByProjectId,
        [id]: savedRequest
      };
      if (state.dashboard?.sponsors) {
        state.dashboard.sponsors = state.dashboard.sponsors.map((item) => (
          item.id === savedRequest.id ? savedRequest : item
        ));
      }
      if (previous?.status === "approved") {
        updateProjectSponsorCount(id, project, -1);
      }
    }

    function updateProjectSponsorCount(id, project, delta) {
      projectTargets(id, project).forEach((item) => {
        item.team_status = {
          ...(item.team_status || {}),
          sponsor_count: Math.max(0, Number(item.team_status?.sponsor_count || 0) + delta)
        };
      });
    }

    function applyViewerProjectState() {
      state.projects.forEach((item) => applyProjectViewerState(item));
      if (state.currentProject) applyProjectViewerState(state.currentProject);
    }

    function applyProjectViewerState(project) {
      if (!project) return;
      const request = participationRequestForProject(project);
      const labels = (project.viewer_state?.relationship_labels || [])
        .filter((label) => !String(label).includes("申请参与"));
      project.viewer_state = {
        ...(project.viewer_state || {}),
        is_following: isProjectFollowing(project),
        relationship_labels: labels,
        interest_roles: isActiveParticipationRequest(request) ? (project.viewer_state?.interest_roles || []) : []
      };
      if (state.unlikedProjectIds.includes(project.id)) {
        const { score: _score, ...rest } = project.viewer_state;
        project.viewer_state = rest;
      } else if (isProjectLiked(project)) {
        project.viewer_state.score = project.viewer_state.score || { score: 10, comment: "点赞" };
      }
      if (isActiveParticipationRequest(request)) {
        project.viewer_state.relationship_labels = [...new Set([...labels, participationRelationshipLabel(request)])];
      }
    }

    function clearProjectParticipationViewerState(project) {
      if (!project) return;
      project.viewer_state = {
        ...(project.viewer_state || {}),
        interest_roles: [],
        relationship_labels: (project.viewer_state?.relationship_labels || [])
          .filter((label) => !String(label).includes("申请参与"))
      };
    }

    function isProjectLiked(project) {
      if (!project) return false;
      return Boolean(project.viewer_state?.score || state.likedProjectIds.includes(project.id));
    }

    function isSubmittingLike(project) {
      return Boolean(project?.id && state.submittingLikeProjectIds.includes(project.id));
    }

    function likeButtonLabel(project) {
      if (isSubmittingLike(project)) return "提交中...";
      return isProjectLiked(project) ? "取消点赞" : "点赞";
    }

    function isParticipationRequested(project) {
      if (!project) return false;
      const request = participationRequestForProject(project);
      if (request) return isActiveParticipationRequest(request);
      const labels = project.viewer_state?.relationship_labels || [];
      return Boolean(
        state.participationProjectIds.includes(project.id) ||
        (project.viewer_state?.interest_roles || []).length ||
        labels.some((label) => String(label).includes("申请参与"))
      );
    }

    function isSubmittingParticipation(project) {
      return Boolean(project?.id && state.submittingParticipationProjectIds.includes(project.id));
    }

    function isWithdrawingParticipation(project) {
      return Boolean(project?.id && state.withdrawingParticipationProjectIds.includes(project.id));
    }

    function participationButtonLabel(project) {
      if (isWithdrawingParticipation(project)) return "撤回中...";
      if (isSubmittingParticipation(project)) return "提交中...";
      if (participationRequestCanWithdraw(project)) return "撤回申请";
      if (!canRecruitProject(project)) return "暂不招募";
      return "申请参与";
    }

    function canClickParticipation(project) {
      if (isSubmittingParticipation(project) || isWithdrawingParticipation(project)) return false;
      if (participationRequestCanWithdraw(project)) return true;
      return canRecruitProject(project);
    }

    function participationRequestForProject(project) {
      const id = project?.id;
      return id ? state.participationRequestsByProjectId[id] || null : null;
    }

    function participationRequestCanWithdraw(project) {
      return isActiveParticipationRequest(participationRequestForProject(project));
    }

    function isActiveParticipationRequest(request) {
      return Boolean(request?.status && WITHDRAWABLE_PARTICIPATION_STATUSES.has(request.status));
    }

    function participationRelationshipLabel(request) {
      return `申请参与：${request?.status_label || "待处理"}`;
    }

    function sponsorRequestForProject(project) {
      const id = project?.id;
      return id ? state.sponsorRequestsByProjectId[id] || null : null;
    }

    function sponsorRequestCanWithdraw(project) {
      return isActiveParticipationRequest(sponsorRequestForProject(project));
    }

    function isSubmittingSponsor(project) {
      return Boolean(project?.id && state.submittingSponsorProjectIds.includes(project.id));
    }

    function isWithdrawingSponsor(project) {
      return Boolean(project?.id && state.withdrawingSponsorProjectIds.includes(project.id));
    }

    function sponsorButtonLabel(project) {
      if (isWithdrawingSponsor(project)) return "撤回中...";
      if (isSubmittingSponsor(project)) return "提交中...";
      if (sponsorRequestCanWithdraw(project)) return "撤回资助";
      if (!canRecruitProject(project)) return "暂不资助";
      return "资助";
    }

    function interactionButtonActive(type, project) {
      if (type === "like") return isProjectLiked(project);
      if (type === "follow") return isProjectFollowing(project);
      if (type === "participation") return participationRequestCanWithdraw(project);
      if (type === "sponsor") return sponsorRequestCanWithdraw(project);
      return false;
    }

    function canClickSponsor(project) {
      if (isSubmittingSponsor(project) || isWithdrawingSponsor(project)) return false;
      if (sponsorRequestCanWithdraw(project)) return true;
      return canRecruitProject(project);
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
      closeMutuallyExclusiveModals("projectForm");
      state.admin.projectForm = emptyProjectForm();
      state.admin.projectFormOpen = true;
    }

    function closeProjectForm() {
      state.admin.projectFormOpen = false;
      state.admin.projectForm = emptyProjectForm();
    }

    async function editProject(project) {
      if (!can("manage_projects")) return;
      try {
        closeMutuallyExclusiveModals("projectForm");
        const detail = await api.adminProject(project.id);
        state.admin.projectForm = projectToForm(detail);
        state.admin.activeTab = "projects";
        state.admin.projectFormOpen = true;
      } catch (error) {
        showToast(error.message);
      }
    }

    async function saveProject({ publish = false } = {}) {
      if (!can("manage_projects")) return;
      try {
        const formPayload = projectFormPayload(state.admin.projectForm);
        if (!formPayload.title || !formPayload.theme) {
          showToast("标题和主题不能为空");
          return;
        }
        const quality = qualityCheckProjectPayload(formPayload);
        if (quality.errors.length) {
          showToast(quality.errors.join("；"));
          return;
        }
        if (publish) {
          if (quality.warnings.length) {
            const confirmed = await openConfirmDialog({
              title: "确认发布课题",
              message: `这些建议字段仍待补充：${quality.warnings.join("、")}。确认发布吗？`,
              confirmText: "继续发布"
            });
            if (!confirmed) return;
          }
        }
        const draftPayload = draftProjectPayload(formPayload);
        const publishPayload = publishProjectPayload(formPayload);
        if (state.admin.projectForm.id) {
          await api.adminUpdateProject(state.admin.projectForm.id, publish ? publishPayload : draftPayload);
          showToast(publish ? "课题已发布" : "课题已更新");
        } else {
          const createdProject = await api.adminCreateProject(draftPayload);
          if (publish) {
            await api.adminUpdateProject(createdProject.id, publishPayload);
          }
          showToast(publish ? "课题已创建并发布" : "课题草稿已创建");
        }
        closeProjectForm();
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "课题保存失败");
      }
    }

    function setProjectDocumentFile(event) {
      const file = event.target.files?.[0] || null;
      state.admin.projectForm.documentUpload.file = file;
      if (file && !state.admin.projectForm.documentUpload.title) {
        state.admin.projectForm.documentUpload.title = file.name.replace(/\.[^.]+$/, "");
      }
    }

    async function uploadProjectDocument() {
      if (!can("manage_projects")) return;
      const form = state.admin.projectForm;
      const upload = form.documentUpload;
      if (!form.id) {
        showToast("请先保存课题，再上传文档");
        return;
      }
      if (!upload.file) {
        showToast("请选择要上传的文档");
        return;
      }
      if (!upload.description.trim()) {
        showToast("请填写文档内容说明");
        return;
      }
      upload.uploading = true;
      try {
        const formData = new FormData();
        formData.append("project_id", String(form.id));
        formData.append("doc_type", upload.doc_type || "other");
        formData.append("title", upload.title.trim());
        formData.append("description", upload.description.trim());
        formData.append("files", upload.file);
        const data = await api.adminUploadProjectDocuments(formData);
        form.documents = data.documents || data.saved || [];
        form.documentUpload = { ...emptyProjectDocumentUpload(), inputKey: upload.inputKey + 1 };
        showToast("课题文档已上传");
      } catch (error) {
        showToast(error.message || "课题文档上传失败");
      } finally {
        upload.uploading = false;
      }
    }

    async function deleteProjectDocument(document) {
      if (!can("manage_projects")) return;
      const confirmed = await openConfirmDialog({
        title: "确认删除文档",
        message: `确认删除「${document.title || document.path}」吗？`,
        confirmText: "删除文档"
      });
      if (!confirmed) return;
      try {
        const data = await api.adminDeleteProjectDocument(document.id);
        state.admin.projectForm.documents = data.documents || [];
        showToast("课题文档已删除");
      } catch (error) {
        showToast(error.message || "课题文档删除失败");
      }
    }

    function isAdminProjectSelected(project) {
      return state.admin.selectedProjectIds.includes(project?.id);
    }

    function areAllVisibleAdminProjectsSelected() {
      const visibleIds = state.admin.projects.map((project) => project.id);
      return visibleIds.length > 0 && visibleIds.every((id) => state.admin.selectedProjectIds.includes(id));
    }

    function toggleAdminProjectSelection(project) {
      if (!project?.id) return;
      const selected = new Set(state.admin.selectedProjectIds);
      if (selected.has(project.id)) {
        selected.delete(project.id);
      } else {
        selected.add(project.id);
      }
      state.admin.selectedProjectIds = Array.from(selected).sort((a, b) => a - b);
    }

    function toggleVisibleAdminProjectsSelection(event) {
      const visibleIds = state.admin.projects.map((project) => project.id);
      const selected = new Set(state.admin.selectedProjectIds);
      if (event.target.checked) {
        visibleIds.forEach((id) => selected.add(id));
      } else {
        visibleIds.forEach((id) => selected.delete(id));
      }
      state.admin.selectedProjectIds = Array.from(selected).sort((a, b) => a - b);
    }

    async function bulkArchiveSelectedProjects() {
      if (!can("manage_projects") || !state.admin.selectedProjectIds.length || state.admin.bulkArchivingProjects) return;
      const ids = [...state.admin.selectedProjectIds];
      const confirmed = await openConfirmDialog({
        title: "确认批量删除课题",
        message: `确认删除已选的 ${ids.length} 个课题吗？系统会批量归档停用，不会物理删除历史数据。`,
        confirmText: "批量删除",
        tone: "danger"
      });
      if (!confirmed) return;
      state.admin.bulkArchivingProjects = true;
      try {
        const result = await api.adminBulkArchiveProjects({ ids });
        const archivedCount = result.archived_count || 0;
        const missingCount = result.missing_ids?.length || 0;
        state.admin.selectedProjectIds = [];
        showToast(missingCount ? `已删除 ${archivedCount} 个课题，${missingCount} 个课题不存在或已不可用` : `已删除 ${archivedCount} 个课题`);
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "批量删除课题失败");
      } finally {
        state.admin.bulkArchivingProjects = false;
      }
    }

    async function archiveProject(project) {
      if (!can("manage_projects")) return;
      const confirmed = await openConfirmDialog({
        title: "确认归档课题",
        message: `确认删除课题「${project.title}」吗？系统会做归档停用，不会物理删除历史数据。`,
        confirmText: "归档课题"
      });
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
      const theme = state.admin.themes.find((item) => item.id === Number(themeId));
      state.admin.fileManager.serverDirectory = theme?.file_space?.server_directory || theme?.slug || "";
      state.admin.fileManager.currentPath = "";
      await loadThemeFiles();
      await loadAdminFileSpace("");
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
      const confirmed = await openConfirmDialog({
        title: "确认停用主题文件",
        message: `确认停用主题文件「${file.title}」吗？`,
        confirmText: "停用文件"
      });
      if (!confirmed) return;
      try {
        await api.adminDeleteThemeFile(file.id);
        showToast("主题文件已停用");
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadAdminFileSpace(path = state.admin.fileManager.currentPath || "") {
      if (!can("manage_themes") || !state.admin.selectedThemeId) {
        state.admin.fileManager.entries = [];
        return;
      }
      state.admin.fileManager.loading = true;
      try {
        const data = await api.adminFileSpace({ theme_id: state.admin.selectedThemeId, path });
        state.admin.fileManager.currentPath = data.relative_path || "";
        state.admin.fileManager.rootPath = data.root_path || "";
        state.admin.fileManager.baseRoot = data.base_root || "";
        state.admin.fileManager.breadcrumbs = data.breadcrumbs || [];
        state.admin.fileManager.entries = data.entries || [];
        state.admin.fileManager.selected = null;
        const theme = data.theme || selectedAdminTheme.value;
        state.admin.fileManager.serverDirectory = theme?.file_space?.server_directory || state.admin.fileManager.rootPath || "";
      } catch (error) {
        showToast(error.message || "文件空间读取失败");
      } finally {
        state.admin.fileManager.loading = false;
      }
    }

    async function saveFileSpaceRoot() {
      if (!can("manage_themes") || !state.admin.selectedThemeId) return;
      state.admin.fileManager.rootSaving = true;
      try {
        const data = await api.adminUpdateThemeFileSpaceRoot(state.admin.selectedThemeId, {
          server_directory: state.admin.fileManager.serverDirectory
        });
        const index = state.admin.themes.findIndex((theme) => theme.id === Number(state.admin.selectedThemeId));
        if (index >= 0) state.admin.themes[index] = data.theme;
        showToast("文件空间目录已保存");
        await loadAdminFileSpace("");
      } catch (error) {
        showToast(error.message || "文件空间目录保存失败");
      } finally {
        state.admin.fileManager.rootSaving = false;
      }
    }

    function selectFileSpaceEntry(entry) {
      state.admin.fileManager.selected = entry;
    }

    function openFileSpaceEntry(entry) {
      selectFileSpaceEntry(entry);
      if (entry.type === "directory") {
        loadAdminFileSpace(entry.path);
      } else {
        openFileSpaceEditor(entry);
      }
    }

    async function openFileSpaceEditor(entry = state.admin.fileManager.selected) {
      if (!entry || entry.type !== "file") return;
      try {
        const data = await api.adminReadFileSpaceFile({ theme_id: state.admin.selectedThemeId, path: entry.path });
        state.admin.fileManager.editorOpen = true;
        state.admin.fileManager.editorPath = entry.path;
        state.admin.fileManager.editorName = data.entry?.name || entry.name;
        state.admin.fileManager.editorContent = data.content || "";
      } catch (error) {
        showToast(error.message || "文件无法在线编辑");
      }
    }

    function closeFileSpaceEditor() {
      state.admin.fileManager.editorOpen = false;
      state.admin.fileManager.editorPath = "";
      state.admin.fileManager.editorName = "";
      state.admin.fileManager.editorContent = "";
    }

    async function saveFileSpaceEditor() {
      try {
        await api.adminUpdateFileSpaceItem({
          theme_id: state.admin.selectedThemeId,
          path: state.admin.fileManager.editorPath,
          new_name: state.admin.fileManager.editorName,
          content: state.admin.fileManager.editorContent
        });
        showToast("文件已保存");
        closeFileSpaceEditor();
        await loadAdminFileSpace();
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message || "文件保存失败");
      }
    }

    async function createFileSpaceDirectory() {
      const name = state.admin.fileManager.newDirectoryName.trim();
      if (!name) {
        showToast("请输入目录名称");
        return;
      }
      try {
        await api.adminCreateFileSpaceDirectory({
          theme_id: state.admin.selectedThemeId,
          path: state.admin.fileManager.currentPath,
          name
        });
        state.admin.fileManager.newDirectoryName = "";
        showToast("目录已创建");
        await loadAdminFileSpace();
      } catch (error) {
        showToast(error.message || "目录创建失败");
      }
    }

    async function createFileSpaceFile() {
      const name = state.admin.fileManager.newFileName.trim();
      if (!name) {
        showToast("请输入文件名称");
        return;
      }
      try {
        await api.adminCreateFileSpaceFile({
          theme_id: state.admin.selectedThemeId,
          path: state.admin.fileManager.currentPath,
          name,
          content: ""
        });
        state.admin.fileManager.newFileName = "";
        showToast("文件已创建");
        await loadAdminFileSpace();
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message || "文件创建失败");
      }
    }

    async function deleteFileSpaceEntry(entry = state.admin.fileManager.selected) {
      if (!entry) return;
      const confirmed = await openConfirmDialog({
        title: "确认删除",
        message: `确认删除「${entry.name}」吗？该操作会删除服务器文件或目录。`,
        confirmText: "删除",
        tone: "danger"
      });
      if (!confirmed) return;
      try {
        await api.adminDeleteFileSpaceItem({ theme_id: state.admin.selectedThemeId, path: entry.path });
        showToast("已删除");
        await loadAdminFileSpace();
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message || "删除失败");
      }
    }

    async function handleFileSpaceUpload(event) {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      if (!files.length || !state.admin.selectedThemeId) return;
      state.admin.fileManager.uploading = true;
      try {
        const formData = new FormData();
        formData.append("theme_id", String(state.admin.selectedThemeId));
        formData.append("path", state.admin.fileManager.currentPath || "");
        files.forEach((file) => {
          formData.append("files", file);
          formData.append("relative_paths", file.webkitRelativePath || file.name);
        });
        await api.adminUploadFileSpaceFiles(formData);
        showToast(`已上传 ${files.length} 个文件`);
        await loadAdminFileSpace();
        await loadThemeFiles();
      } catch (error) {
        showToast(error.message || "上传失败");
      } finally {
        state.admin.fileManager.uploading = false;
      }
    }

    function formatFileSize(size) {
      if (size === null || size === undefined) return "";
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / 1024 / 1024).toFixed(1)} MB`;
    }

    async function loadAdminInteractions({ reset = false } = {}) {
      if (!can("review_interactions")) return;
      if (reset) state.admin.interactionFilters.page = 1;
      state.admin.loadingInteractions = true;
      try {
        const data = await api.adminInteractions(state.admin.interactionFilters);
        state.admin.interactions = data.results;
        state.admin.interactionPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingInteractions = false;
      }
    }

    async function loadAdminTaskProjects({ reset = false } = {}) {
      if (!can("manage_projects")) return;
      state.admin.loadingTaskProjects = true;
      try {
        const filters = state.admin.taskProjectFilters;
        const baseParams = { q: filters.q, page_size: filters.page_size || 100 };
        let rows = [];
        if (filters.stage) {
          rows = await fetchAllAdminProjects({ ...baseParams, stage: filters.stage });
        } else {
          const grouped = await Promise.all(
            TASK_MANAGEMENT_STAGE_VALUES.map((stage) => fetchAllAdminProjects({ ...baseParams, stage }))
          );
          rows = grouped.flat();
        }
        const unique = new Map();
        for (const project of rows) unique.set(project.id, project);
        state.admin.taskProjects = Array.from(unique.values()).sort((a, b) => {
          const updated = String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
          return updated || Number(a.topic_id || 0) - Number(b.topic_id || 0);
        });
      } catch (error) {
        showToast(error.message || "任务管理课题读取失败");
      } finally {
        state.admin.loadingTaskProjects = false;
      }
    }

    async function fetchAllAdminProjects(params = {}) {
      const rows = [];
      let page = 1;
      let hasNext = true;
      while (hasNext) {
        const data = await api.adminProjects({ ...params, page });
        rows.push(...(data.results || []));
        hasNext = Boolean(data.pagination?.has_next);
        page += 1;
      }
      return rows;
    }

    async function openTaskProjectDetail(project) {
      closeMutuallyExclusiveModals("taskProjectDetail");
      state.admin.taskProjectDetail.open = true;
      state.admin.taskProjectDetail.loading = true;
      state.admin.taskProjectDetail.project = project;
      state.admin.taskProjectDetail.interactions = [];
      state.admin.taskProjectDetail.contributions = [];
      state.admin.taskProjectDetail.reviewDrafts = {};
      try {
        const detail = await api.adminProject(project.id);
        const [interactions, contributions] = await Promise.all([
          fetchProjectApprovedInteractions(detail),
          fetchProjectContributions(detail)
        ]);
        state.admin.taskProjectDetail.project = detail;
        state.admin.taskProjectDetail.interactions = interactions;
        state.admin.taskProjectDetail.contributions = contributions;
        state.admin.taskProjectDetail.reviewDrafts = Object.fromEntries(
          contributions.map((item) => [item.id, { review_comment: item.review_comment || "" }])
        );
      } catch (error) {
        showToast(error.message || "任务详情读取失败");
      } finally {
        state.admin.taskProjectDetail.loading = false;
      }
    }

    function closeTaskProjectDetail() {
      state.admin.taskProjectDetail.open = false;
      state.admin.taskProjectDetail.loading = false;
      state.admin.taskProjectDetail.project = null;
      state.admin.taskProjectDetail.interactions = [];
      state.admin.taskProjectDetail.contributions = [];
      state.admin.taskProjectDetail.reviewDrafts = {};
    }

    async function fetchProjectApprovedInteractions(project) {
      const rows = [];
      let page = 1;
      let hasNext = true;
      while (hasNext) {
        const data = await api.adminInteractions({ status: "approved", project: project.topic_id, page, page_size: 100 });
        rows.push(...(data.results || []));
        hasNext = Boolean(data.pagination?.has_next);
        page += 1;
      }
      return rows.filter((item) => item.project?.id === project.id);
    }

    async function fetchProjectContributions(project) {
      const rows = [];
      let page = 1;
      let hasNext = true;
      while (hasNext) {
        const data = await api.adminContributions({ project: project.topic_id, page, page_size: 100 });
        rows.push(...(data.results || []));
        hasNext = Boolean(data.pagination?.has_next);
        page += 1;
      }
      return rows.filter((item) => item.project?.id === project.id);
    }

    function approvedInteractionGroupsFor(rows = []) {
      const groups = new Map();
      for (const item of rows) {
        const label = item.type_label || "协作";
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(item);
      }
      return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
    }

    async function reviewInteraction(item, status) {
      if (!can("review_interactions")) return;
      if (!canReviewInteraction(item)) {
        showToast("只有待处理申请可以审核");
        return;
      }
      try {
        await api.reviewAdminInteraction(item.type, item.id, { status, review_note: status === "approved" ? "管理员通过" : "管理员处理" });
        invalidateProjectStatusCard(item.project?.id);
        showToast(status === "approved" ? "协作意向已通过" : "协作意向已更新");
        await Promise.all([loadAdminInteractions({ reset: true }), loadDashboard().catch(() => null)]);
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadAdminTasks({ reset = false } = {}) {
      if (!can("manage_tasks")) return;
      if (reset) state.admin.taskFilters.page = 1;
      state.admin.loadingTasks = true;
      try {
        const data = await api.adminTasks(state.admin.taskFilters);
        state.admin.tasks = data.results;
        state.admin.taskPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingTasks = false;
      }
    }

    async function saveAdminTask() {
      if (!can("manage_tasks")) return;
      try {
        const form = state.admin.taskForm;
        const payload = {
          project_id: Number(form.project_id),
          title: form.title,
          description: form.description,
          task_type: form.task_type,
          required_role: form.required_role,
          difficulty: Number(form.difficulty || 1),
          assignee_uid: form.assignee_uid,
          credit_reward: Number(form.credit_reward || 0)
        };
        if (!payload.project_id || !payload.title.trim()) {
          showToast("任务需要选择课题并填写标题");
          return;
        }
        await api.createAdminTask(payload);
        state.admin.taskForm = emptyTaskForm();
        showToast("任务已创建");
        await loadAdminTasks({ reset: true });
      } catch (error) {
        showToast(error.message || "任务保存失败");
      }
    }

    function prepareTaskForProject(project) {
      state.admin.taskForm = emptyTaskForm(project);
      state.admin.activeTab = "tasks";
      loadAdminTasks({ reset: true });
    }

    async function assignTaskToUid(task) {
      const uid = window.prompt("请输入要分配的用户 UID", task.assignee_uid || taskParticipantUids(task)[0] || "");
      if (!uid) return;
      try {
        await api.assignAdminTask(task.id, { uid: uid.trim() });
        showToast("任务已分配");
        await loadAdminTasks({ reset: true });
      } catch (error) {
        showToast(error.message);
      }
    }

    async function updateTaskStatus(task, status) {
      try {
        await api.updateAdminTaskStatus(task.id, { status });
        showToast("任务状态已更新");
        await loadAdminTasks({ reset: true });
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadAdminContributions({ reset = false } = {}) {
      if (!can("review_contributions")) return;
      if (reset) state.admin.contributionFilters.page = 1;
      state.admin.loadingContributions = true;
      try {
        const data = await api.adminContributions(state.admin.contributionFilters);
        state.admin.contributions = data.results;
        state.admin.contributionPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingContributions = false;
      }
    }

    async function updateTaskProjectStage(project, stage) {
      if (!can("manage_projects")) return;
      const payload = { stage };
      if (stage === "archived") {
        payload.is_public = false;
      }
      try {
        await api.adminUpdateProject(project.id, payload);
        invalidateProjectStatusCard(project.id);
        showToast(stage === "active" ? "课题已进入进行中" : stage === "archived" ? "课题已结题归档" : "课题阶段已更新");
        await Promise.all([
          loadAdminTaskProjects({ reset: true }),
          loadProjects({ reset: true }).catch(() => null)
        ]);
        if (state.admin.taskProjectDetail.open && state.admin.taskProjectDetail.project?.id === project.id) {
          await openTaskProjectDetail({ ...project, stage });
        }
      } catch (error) {
        showToast(error.message || "课题阶段更新失败");
      }
    }

    function adminProjectVisibilityLabel(project) {
      if (project.stage === "archived") return "归档/未公开";
      if (project.stage === "draft") return "草稿/未公开";
      return project.is_public ? "公开" : "未公开";
    }

    async function updateAdminProjectStage(project, stage, event = null) {
      if (!can("manage_projects")) return;
      const previousStage = project.stage;
      if (!stage || stage === previousStage) return;
      if (stage === "archived") {
        const confirmed = await openConfirmDialog({
          title: "确认归档课题",
          message: `确认将「${project.title}」归档吗？归档后公开课题库不可见，但会保留数据和审计记录。`,
          confirmText: "归档",
          tone: "danger"
        });
        if (!confirmed) {
          if (event?.target) event.target.value = previousStage;
          return;
        }
      }
      const payload = { stage };
      if (["draft", "archived"].includes(stage)) {
        payload.is_public = false;
      }
      state.admin.updatingProjectStageId = project.id;
      try {
        await api.adminUpdateProject(project.id, payload);
        invalidateProjectStatusCard(project.id);
        showToast(stage === "archived" ? "课题已归档" : "课题阶段已更新");
        await Promise.all([
          loadAdminProjects({ reset: true }),
          loadAdminTaskProjects({ reset: true }).catch(() => null),
          loadProjects({ reset: true }).catch(() => null)
        ]);
      } catch (error) {
        if (event?.target) event.target.value = previousStage;
        showToast(error.message || "课题阶段更新失败");
      } finally {
        state.admin.updatingProjectStageId = null;
      }
    }

    function closeMutuallyExclusiveModals(next = "") {
      if (next !== "contribution" && state.contributionModal.open) {
        closeContributionModal();
      }
      if (next !== "taskProjectDetail" && state.admin.taskProjectDetail.open) {
        closeTaskProjectDetail();
      }
      if (next !== "projectForm" && state.admin.projectFormOpen) {
        closeProjectForm();
      }
      if (state.preview.open) {
        closeProjectPreview();
      }
    }

    async function reviewContribution(contribution, status, options = {}) {
      try {
        const draft = state.admin.taskProjectDetail.reviewDrafts[contribution.id] || {};
        if (options.closeProject) {
          const confirmed = await openConfirmDialog({
            title: "通过并结题归档",
            message: `确认将「${contribution.project?.title || state.admin.taskProjectDetail.project?.title || "该课题"}」结题归档吗？归档后公开课题库不可见，但会保留数据库和审计记录。`,
            confirmText: "通过并结题",
            tone: "danger"
          });
          if (!confirmed) return;
        }
        await api.reviewAdminContribution(contribution.id, {
          status,
          review_comment: draft.review_comment || "",
          grant_reward: false
        });
        if (options.closeProject) {
          await api.adminUpdateProject(contribution.project.id, { stage: "archived", is_public: false });
        }
        showToast(options.closeProject ? "任务结果已通过，课题已结题归档" : status === "approved" ? "任务结果已通过" : "任务结果状态已更新");
        if (state.admin.taskProjectDetail.open && state.admin.taskProjectDetail.project) {
          await openTaskProjectDetail(state.admin.taskProjectDetail.project);
        } else {
          await loadAdminTaskProjects({ reset: true });
        }
        await loadProjects({ reset: true }).catch(() => null);
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadAdminCredits({ reset = false } = {}) {
      if (!can("manage_credits")) return;
      if (reset) state.admin.creditFilters.page = 1;
      try {
        const data = await api.adminCredits(state.admin.creditFilters);
        state.admin.credits = data.results;
        state.admin.creditPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      }
    }

    async function loadAdminAuditLogs({ reset = false } = {}) {
      if (!can("view_audit_logs")) return;
      if (reset) state.admin.auditFilters.page = 1;
      state.admin.loadingAuditLogs = true;
      try {
        const data = await api.adminAuditLogs(state.admin.auditFilters);
        state.admin.auditLogs = data.results;
        state.admin.auditPagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingAuditLogs = false;
      }
    }

    async function setAdminTab(tab) {
      if (!ADMIN_TABS.has(tab)) {
        state.admin.activeTab = "overview";
        return;
      }
      state.admin.activeTab = tab;
      await loadActiveAdminTab();
    }

    function clearJsonImport() {
      state.admin.jsonImport.rows = [];
      state.admin.jsonImport.fileCount = 0;
      state.admin.jsonImport.selection = emptyJsonImportSelection();
      state.admin.jsonImport.previewOpen = false;
      showToast("JSON 导入提示已清除");
    }

    function downloadJsonTemplate() {
      const template = state.schema?.json_template || "";
      if (!template) {
        showToast("模板暂未加载");
        return;
      }
      const blob = new Blob([template], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "openmedailab-project-template.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("JSON 模板已下载");
    }

    async function handleJsonFiles(event) {
      const selectedFiles = Array.from(event.target.files || []);
      const selection = summarizeProjectImportFiles(selectedFiles);
      const files = selectedProjectJsonFiles(selectedFiles);
      const pdfFilesByKey = new Map(
        selectedFiles
          .filter((file) => String(file.name || "").toLowerCase().endsWith(".pdf"))
          .map((file) => [projectImportFileKey(file), file])
      );
      state.admin.jsonImport.selection = selection;
      state.admin.jsonImport.fileCount = files.length;
      state.admin.jsonImport.rows = [];
      state.admin.jsonImport.previewOpen = false;
      if (!files.length) {
        showToast("没有找到可导入的课题 JSON");
        event.target.value = "";
        return;
      }
      const rows = [];
      for (const file of files) {
        rows.push(...(await buildJsonImportRows(file, pdfFilesByKey)));
      }
      const sortedRows = sortProjectImportRows(rows);
      if (!state.admin.jsonImport.autoNumber) {
        markDuplicateJsonImportRows(sortedRows);
      }
      state.admin.jsonImport.rows = sortedRows;
      state.admin.jsonImport.previewOpen = true;
      event.target.value = "";
    }

    async function buildJsonImportRows(file, pdfFilesByKey = new Map()) {
      const sourcePath = file.webkitRelativePath || file.name;
      const text = await file.text();
      let parsedRows = [];
      try {
        parsedRows = parseProjectJsonImport(text, sourcePath);
      } catch (error) {
        parsedRows = [
          {
            templateVersion: "json-v1",
            payload: { topic_id: "", theme: "", title: "" },
            errors: [error.message || "JSON 解析失败"],
            warnings: []
          }
        ];
      }
      const documentFile = parsedRows.length === 1 ? pdfFilesByKey.get(projectImportFileKey(file)) || null : null;
      const rows = parsedRows.map((parsed, index) => ({
        id: `${sourcePath}-${index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        fileName: file.name,
        sourcePath: parsed.sourcePath || `${sourcePath}#${index + 1}`,
        documentFile,
        documentFileName: documentFile?.name || "",
        ...parsed,
        parseErrors: parsed.errors.filter((error) => !qualityCheckProjectPayload(parsed.payload).errors.includes(error)),
        batchErrors: [],
        existingProjectId: null,
        actionLabel: parsed.errors.length ? "需修复" : "创建草稿"
      }));
      for (const row of rows) {
        await refreshJsonImportRow(row);
      }
      return rows;
    }

    async function refreshJsonImportRow(row) {
      row.errors = [...(row.parseErrors || []), ...(row.batchErrors || []), ...qualityCheckProjectPayload(row.payload).errors];
      row.payload.stage = "draft";
      row.payload.is_public = false;
      row.existingProjectId = null;
      row.actionLabel = row.errors.length ? "需修复" : state.admin.jsonImport.autoNumber ? "自动编号创建草稿" : "创建草稿";
      if (row.errors.length) return;
      if (state.admin.jsonImport.autoNumber) {
        row.warnings = qualityCheckProjectPayload(row.payload).warnings;
        return;
      }
      try {
        const duplicates = await findJsonImportDuplicates(row.payload);
        const existing = duplicates.find((item) => Number(item.topic_id) === Number(row.payload.topic_id));
        const warnings = duplicateWarningsForImport(row.payload, duplicates);
        row.warnings = [...new Set([...qualityCheckProjectPayload(row.payload).warnings, ...warnings])];
        if (existing) {
          row.existingProjectId = existing.id;
          row.actionLabel = existing.is_public || existing.stage !== "draft" ? "更新为草稿（暂不公开）" : "更新已有草稿";
        }
      } catch (error) {
        row.errors = [...row.errors, error.message || "重复检测失败"];
        row.actionLabel = "需修复";
      }
    }

    function markDuplicateJsonImportRows(rows) {
      rows.forEach((row) => {
        row.batchErrors = [];
      });
      const seen = new Map();
      for (const row of rows) {
        const key = String(row.payload.topic_id || "");
        if (!key) continue;
        if (!seen.has(key)) {
          seen.set(key, row);
          continue;
        }
        row.batchErrors = [...(row.batchErrors || []), `本次导入中 id ${key} 重复`];
        row.errors = [...(row.errors || []), `本次导入中 id ${key} 重复`];
        const first = seen.get(key);
        first.batchErrors = [...(first.batchErrors || []), `本次导入中 id ${key} 重复`];
        first.errors = [...(first.errors || []), `本次导入中 id ${key} 重复`];
        row.actionLabel = "需修复";
        first.actionLabel = "需修复";
      }
    }

    async function refreshAllJsonImportRows() {
      state.admin.jsonImport.rows = sortProjectImportRows(state.admin.jsonImport.rows);
      if (!state.admin.jsonImport.autoNumber) {
        markDuplicateJsonImportRows(state.admin.jsonImport.rows);
      }
      for (const row of state.admin.jsonImport.rows) {
        await refreshJsonImportRow(row);
      }
    }

    function openJsonImportPreview() {
      if (!state.admin.jsonImport.rows.length) {
        showToast("请先选择 JSON 文件");
        return;
      }
      state.admin.jsonImport.previewOpen = true;
    }

    function closeJsonImportPreview() {
      if (state.admin.jsonImport.applying) return;
      state.admin.jsonImport.previewOpen = false;
    }

    async function applyJsonImport() {
      if (!can("manage_projects")) return;
      await refreshAllJsonImportRows();
      const rows = state.admin.jsonImport.rows.filter((row) => !row.errors.length);
      if (!rows.length) {
        showToast("没有可提交的 JSON 课题");
        return;
      }
      state.admin.jsonImport.applying = true;
      try {
        const data = await api.adminImportProjects({
          projects: rows.map((row) => draftProjectPayload(row.payload, { autoNumber: state.admin.jsonImport.autoNumber })),
          publish: false,
          auto_number: state.admin.jsonImport.autoNumber
        });
        const resultByRow = new Map((data.results || []).map((item) => [item.row, item]));
        rows.forEach((row, index) => {
          const result = resultByRow.get(index + 1);
          if (!result) return;
          row.actionLabel = result.action === "updated" ? "已更新为草稿" : `已创建 ${result.project?.topic_code || "草稿"}`;
          row.payload.topic_id = result.project?.topic_id || row.payload.topic_id;
        });
        const documentResult = await uploadJsonImportDocuments(rows, resultByRow);
        const created = data.created_count || 0;
        const updated = data.updated_count || 0;
        const failed = Math.max(0, rows.length - created - updated);
        const documentMessage = documentResult.total ? `；PDF 绑定 ${documentResult.bound}/${documentResult.total}` : "";
        showToast(`JSON 导入完成：新增 ${created}，更新 ${updated}，失败 ${failed}${documentMessage}`);
        if (!failed) {
          state.admin.jsonImport.previewOpen = false;
        }
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
        const [meta, themes] = await Promise.all([api.meta(), api.adminThemes()]);
        state.meta = meta;
        state.admin.themes = themes.results;
      } catch (error) {
        rows.forEach((row) => {
          row.errors = [...row.errors, error.message || "提交失败"];
          row.actionLabel = "提交失败";
        });
        showToast(error.message || "JSON 导入失败");
      } finally {
        state.admin.jsonImport.applying = false;
      }
    }

    async function uploadJsonImportDocuments(rows, resultByRow) {
      const items = rows
        .map((row, index) => ({ row, result: resultByRow.get(index + 1) }))
        .filter((item) => item.row.documentFile && item.result?.project?.id);
      const stats = { total: items.length, bound: 0, failed: 0 };
      await runWithConcurrency(items, 4, async ({ row, result }) => {
        try {
          const formData = new FormData();
          formData.append("project_id", String(result.project.id));
          formData.append("doc_type", "pdf");
          formData.append("title", "项目详细说明");
          formData.append("description", "完整课题方案 PDF");
          formData.append("files", row.documentFile);
          await api.adminUploadProjectDocuments(formData);
          stats.bound += 1;
          row.actionLabel = `${row.actionLabel} · PDF已绑定`;
        } catch (error) {
          stats.failed += 1;
          row.warnings = [...(row.warnings || []), `PDF绑定失败：${error.message || "上传失败"}`];
          row.actionLabel = `${row.actionLabel} · PDF绑定失败`;
        }
      });
      return stats;
    }

    async function runWithConcurrency(items, limit, worker) {
      const queue = [...items];
      const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
          const item = queue.shift();
          await worker(item);
        }
      });
      await Promise.all(workers);
    }

    async function ensureThemeForProject(themeName) {
      const name = String(themeName || "").trim();
      if (!name) throw new Error("主题不能为空");
      const existing = state.admin.themes.find((theme) => theme.name === name || theme.slug === name);
      if (existing) return existing;
      const confirmed = await openConfirmDialog({
        title: "确认创建新主题",
        message: `主题「${name}」不存在，是否创建为新主题？`,
        confirmText: "创建主题"
      });
      if (!confirmed) throw new Error(`未确认创建主题「${name}」`);
      const confirmedName = window.prompt("请确认主题名称", name);
      if (!confirmedName?.trim()) throw new Error("主题名称不能为空");
      const slug = window.prompt("主题 slug（可留空自动生成）", uniqueSlugHint(confirmedName));
      const description = window.prompt("主题说明", "由 JSON 导入确认创建") || "";
      const theme = await api.adminCreateTheme({ name: confirmedName.trim(), slug: String(slug || "").trim(), description });
      state.admin.themes = [...state.admin.themes, theme];
      return theme;
    }

    function openConfirmDialog(options = {}) {
      if (confirmDialogResolver) {
        confirmDialogResolver(false);
      }
      state.confirmDialog = {
        open: true,
        title: options.title || "确认操作",
        message: options.message || "",
        confirmText: options.confirmText || "确认",
        cancelText: options.cancelText || "取消",
        tone: options.tone || "default"
      };
      return new Promise((resolve) => {
        confirmDialogResolver = resolve;
      });
    }

    function resolveConfirmDialog(result) {
      state.confirmDialog.open = false;
      const resolver = confirmDialogResolver;
      confirmDialogResolver = null;
      if (resolver) resolver(Boolean(result));
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
        closeRouteScopedOverlays();
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      }
    }

    function closeRouteScopedOverlays() {
      if (state.confirmDialog.open) {
        resolveConfirmDialog(false);
      }
      if (state.contributionModal.open) {
        closeContributionModal();
      }
      if (state.admin.taskProjectDetail.open) {
        closeTaskProjectDetail();
      }
      if (state.admin.projectFormOpen) {
        closeProjectForm();
      }
      if (state.preview.open) {
        closeProjectPreview();
      }
      if (state.releaseModalOpen) {
        closeReleaseModal();
      }
      if (state.profileMenuOpen) {
        closeProfileMenu();
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
      if (event.key === "Escape" && state.confirmDialog.open) {
        resolveConfirmDialog(false);
        return;
      }
      if (event.key === "Escape" && state.contributionModal.open) {
        closeContributionModal();
        return;
      }
      if (event.key === "Escape" && state.admin.taskProjectDetail.open) {
        closeTaskProjectDetail();
        return;
      }
      if (event.key === "Escape" && state.preview.open) {
        closeProjectPreview();
        return;
      }
      if (event.key === "Escape" && state.releaseModalOpen) {
        closeReleaseModal();
        return;
      }
      if (event.key === "Escape" && state.profileMenuOpen) {
        closeProfileMenu();
      }
    }

    function handlePointerMove(event) {
      profilePointer.x = event.clientX;
      profilePointer.y = event.clientY;
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

    function openProfileMenu() {
      window.clearTimeout(openProfileMenu.closeTimer);
      state.profileMenuOpen = true;
    }

    function scheduleCloseProfileMenu() {
      window.clearTimeout(openProfileMenu.closeTimer);
      openProfileMenu.closeTimer = window.setTimeout(() => {
        if (isPointerInProfileHoverZone()) return;
        state.profileMenuOpen = false;
      }, 520);
    }

    function isPointerInProfileHoverZone() {
      const menuRect = document.querySelector(".profile-menu")?.getBoundingClientRect();
      const popoverRect = document.querySelector(".profile-popover")?.getBoundingClientRect();
      return isPointInsideProfileHoverZone(profilePointer, menuRect, popoverRect);
    }

    function closeProfileMenu() {
      window.clearTimeout(openProfileMenu.closeTimer);
      state.profileMenuOpen = false;
    }

    function openReleaseModal() {
      state.releaseModalOpen = true;
    }

    function closeReleaseModal() {
      state.releaseModalOpen = false;
    }

    function toggleReleaseVersion(version) {
      state.expandedReleaseVersions = state.expandedReleaseVersions.includes(version)
        ? state.expandedReleaseVersions.filter((item) => item !== version)
        : [...state.expandedReleaseVersions, version];
    }

    function isReleaseVersionExpanded(version) {
      return state.expandedReleaseVersions.includes(version);
    }

    function releaseSectionLabel(section) {
      return {
        Added: "新增",
        Changed: "调整",
        Fixed: "修复"
      }[section] || section;
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
      homeThemeCards,
      roleCards,
      favoriteProjects,
      myProjectTasks,
      workspaceOverviewCards,
      adminOverviewCards,
      releaseLatest,
      releaseHistoryItems,
      can,
      navigate,
      openProjectPreview,
      closeProjectPreview,
      toggleProjectPreviewSize,
      applyFilters,
      selectTheme,
      topicThemeCardStyle,
      selectSpace,
      loadMoreProjects,
      login,
      changeRequiredPassword,
      register,
      logout,
      toggleFollow,
      isProjectFollowing,
      followButtonLabel,
      canFollowProject,
      shouldShowFollowButton,
      canRecruitProject,
      isProjectExpanded,
      toggleProjectExpansion,
      projectSummaryText,
      canReviewInteraction,
      openProfileMenu,
      scheduleCloseProfileMenu,
      closeProfileMenu,
      openReleaseModal,
      closeReleaseModal,
      toggleReleaseVersion,
      isReleaseVersionExpanded,
      releaseSectionLabel,
      sectionEntries,
      submitLike,
      isProjectLiked,
      isSubmittingLike,
      likeButtonLabel,
      submitInterest,
      submitParticipationRequest,
      handleParticipationAction,
      withdrawParticipationRequest,
      isParticipationRequested,
      isSubmittingParticipation,
      isWithdrawingParticipation,
      participationButtonLabel,
      canClickParticipation,
      submitClaim,
      submitLeadClaim,
      submitSponsor,
      withdrawSponsorRequest,
      sponsorButtonLabel,
      interactionButtonActive,
      canClickSponsor,
      withdrawInteraction,
      taskProgressLabel,
      taskParticipantUids,
      setWorkspaceTab,
      saveProfile,
      startMyTask,
      prepareContribution,
      openContributionModal,
      closeContributionModal,
      submitContribution,
      myTaskStatusLabel,
      taskRelationSummary,
      canSubmitProjectTask,
      taskSubmitHint,
      contributionStatusText,
      saveTheme,
      newTheme,
      editTheme,
      deactivateTheme,
      newProject,
      editProject,
      closeProjectForm,
      saveProject,
      setProjectDocumentFile,
      uploadProjectDocument,
      deleteProjectDocument,
      isAdminProjectSelected,
      areAllVisibleAdminProjectsSelected,
      toggleAdminProjectSelection,
      toggleVisibleAdminProjectsSelection,
      bulkArchiveSelectedProjects,
      prepareTaskForProject,
      newThemeFile,
      editThemeFile,
      saveThemeFile,
      deactivateThemeFile,
      selectAdminTheme,
      loadAdminFileSpace,
      saveFileSpaceRoot,
      selectFileSpaceEntry,
      openFileSpaceEntry,
      openFileSpaceEditor,
      closeFileSpaceEditor,
      saveFileSpaceEditor,
      createFileSpaceDirectory,
      createFileSpaceFile,
      deleteFileSpaceEntry,
      handleFileSpaceUpload,
      formatFileSize,
      setAdminTab,
      searchAdminUsers,
      resetUserPassword,
      copyDefaultPassword,
      loadAdminInteractions,
      reviewInteraction,
      adminProjectVisibilityLabel,
      updateAdminProjectStage,
      loadAdminTasks,
      saveAdminTask,
      assignTaskToUid,
      updateTaskStatus,
      loadAdminContributions,
      reviewContribution,
      loadAdminTaskProjects,
      openTaskProjectDetail,
      closeTaskProjectDetail,
      updateTaskProjectStage,
      approvedInteractionGroupsFor,
      loadAdminCredits,
      loadAdminAuditLogs,
      auditActionLabel,
      auditActorLabel,
      auditTargetLabel,
      auditSummary,
      formatAuditTime,
      clearJsonImport,
      downloadJsonTemplate,
      handleJsonFiles,
      refreshJsonImportRow,
      refreshAllJsonImportRows,
      openJsonImportPreview,
      closeJsonImportPreview,
      applyJsonImport,
      archiveProject,
      searchAdminProjects,
      loadMoreAdminProjects,
      displayScore,
      topicCode,
      shortText,
      roleCountEntries,
      visibleProjectRoleGroups,
      projectRecruitmentText,
      requiredTeamRoles,
      projectFundingLabel,
      projectFundingReady,
      projectStartupLabel,
      projectStartupText,
      projectStartupReady,
      fileTypeLabel,
      projectDetailHref,
      projectDocuments,
      documentIcon,
      documentDisplayTitle,
      documentHref,
      documentTooltip,
      stageLabel,
      fieldErrors,
      hasFieldError,
      fieldErrorId,
      describedBy,
      formSummaryErrors,
      clearFieldError,
      resolveConfirmDialog
    };
  },
  template: `
    <div class="app-shell">
      <header class="topbar">
        <button class="brand" @click="navigate('home')" type="button">
          <img class="brand-mark" src="/openmedailab-logo.png" alt="OpenMedAILab" />
          <span>
            <strong>OpenMedAILab</strong>
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
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'favorites'">bookmark</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'admin'">settings</span>
            {{ item.label }}
          </button>
        </nav>
        <div class="account-area">
          <button class="version-button" type="button" @click="openReleaseModal">v{{ state.meta.release?.version || '0.0.0' }}</button>
          <div
            v-if="state.user"
            class="profile-menu"
            :class="{ open: state.profileMenuOpen }"
            @mouseenter="openProfileMenu"
            @mouseleave="scheduleCloseProfileMenu"
            @focusin="openProfileMenu"
          >
            <button class="text-button profile-trigger" type="button" @click="navigate('dashboard'); closeProfileMenu(); $event.currentTarget.blur()">
              <span class="material-symbols-rounded" style="font-size: 18px;">person</span>
              <span>{{ state.user.profile?.display_name || state.user.username }}</span>
            </button>
            <div class="profile-popover" role="dialog" aria-label="个人信息" @mouseenter="openProfileMenu">
              <strong>{{ state.user.profile?.display_name || state.user.username }}</strong>
              <small>{{ state.user.profile?.uid || '未分配 UID' }} · {{ state.user.profile?.role_type_label || roleInfo.role_label }}</small>
              <dl>
                <div><dt>机构</dt><dd>{{ state.user.profile?.organization || '未填写机构' }}</dd></div>
                <div><dt>邮箱</dt><dd>{{ state.user.email || state.user.profile?.contact_email || '未填写邮箱' }}</dd></div>
                <div><dt>积分</dt><dd>{{ state.user.profile?.credit_balance ?? 0 }}</dd></div>
                <div><dt>声誉</dt><dd>{{ state.user.profile?.reputation_score ?? 0 }}</dd></div>
              </dl>
              <div class="profile-actions">
                <button class="ghost-button" type="button" @click="state.workspaceTab = 'overview'; navigate('dashboard'); closeProfileMenu(); $event.currentTarget.blur()">我的空间</button>
                <button class="ghost-button" type="button" @click="state.workspaceTab = 'favorites'; navigate('dashboard'); closeProfileMenu(); $event.currentTarget.blur()">我的关注</button>
                <button class="ghost-button danger profile-logout" type="button" @click="logout(); closeProfileMenu(); $event.currentTarget.blur()"><span class="material-symbols-rounded" style="font-size: 18px;">logout</span> 退出</button>
              </div>
            </div>
          </div>
          <template v-else>
            <button class="ghost-button" type="button" @click="navigate('login')"><span class="material-symbols-rounded" style="font-size: 18px;">login</span> 登录</button>
            <button class="primary-button" type="button" @click="navigate('register')"><span class="material-symbols-rounded" style="font-size: 18px;">person_add</span> 注册</button>
          </template>
        </div>
      </header>

      <main class="page">
        <div v-if="state.toast && !state.preview.open" class="toast">{{ state.toast }}</div>
        <section v-if="state.booting" class="empty-state">
          <div class="loader"></div>
          <h2>正在载入课题库</h2>
        </section>

        <template v-else>
          <section v-if="activeView === 'home' || activeView === 'projects'" class="library-view">
            <div class="toolbar">
              <label class="search-box">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;">search</span> 搜索</span>
                <input v-model="state.filters.q" type="search" placeholder="输入疾病、模型、任务或期刊" @keyup.enter="applyFilters" />
              </label>
              <label>
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;">category</span> 主题</span>
                <select v-model="state.filters.theme" @change="applyFilters">
                  <option value="">不限主题</option>
                  <option v-for="theme in state.meta.themes" :key="theme.slug" :value="theme.slug">{{ theme.name }}</option>
                </select>
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
                  <option value="follows">关注热度</option>
                  <option value="updated">最新</option>
                  <option value="likes">点赞</option>
                </select>
              </label>
              <button class="primary-button" type="button" @click="applyFilters"><span class="material-symbols-rounded">filter_list</span> 筛选</button>
            </div>

            <div class="theme-strip topic-theme-strip">
              <button
                class="theme-chip topic-theme-card"
                :class="{ active: !state.filters.theme }"
                :style="topicThemeCardStyle()"
                type="button"
                @click="selectTheme('')"
              >
                <span>全部课题</span>
              </button>
              <button
                v-for="theme in homeThemeCards"
                :key="theme.slug"
                class="theme-chip topic-theme-card"
                :class="{ active: state.filters.theme === theme.slug }"
                :style="topicThemeCardStyle(theme)"
                type="button"
                @click="selectTheme(theme.slug)"
              >
                <span>{{ theme.name }}</span>
              </button>
            </div>

            <div class="section-head">
              <div v-if="selectedTheme">
                <h2>{{ selectedTheme.name }}</h2>
                <p v-if="selectedTheme.description">{{ selectedTheme.description }}</p>
              </div>
              <div v-else></div>
              <div class="section-head-actions">
                <dl class="inline-stats" aria-label="课题库统计">
                  <div><dt>课题</dt><dd>{{ stats.total }}</dd></div>
                  <div><dt>主题</dt><dd>{{ stats.themes }}</dd></div>
                  <div><dt>关注</dt><dd>{{ stats.follows }}</dd></div>
                </dl>
                <button v-if="selectedTheme" class="ghost-button" type="button" @click="selectSpace(selectedTheme.slug)">查看主题文件空间</button>
              </div>
            </div>

            <div class="project-grid">
              <article
                v-for="project in state.projects"
                :key="project.id"
                :data-project-id="project.id"
                class="project-card project-list-card"
              >
                <div class="project-list-main">
                  <div class="project-card-top">
                    <div class="project-card-meta">
                      <span>{{ topicCode(project) }}</span>
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span>{{ project.stage_label }}</span>
                      <span :class="{ ready: projectFundingReady(project) }">{{ projectFundingLabel(project) }}</span>
                    </div>
                    <dl class="project-card-counts" aria-label="课题互动统计">
                      <div><dt>点赞</dt><dd>{{ project.score_count || 0 }}</dd></div>
                      <div><dt>关注</dt><dd>{{ project.follow_count || 0 }}</dd></div>
                    </dl>
                  </div>
                  <h3>
                    <a class="project-title-link" :href="projectDetailHref(project)">{{ project.title }}</a>
                  </h3>
                  <div class="project-summary-collapsed">
                    <button class="text-button" type="button" @click.stop="toggleProjectExpansion(project)">
                      {{ isProjectExpanded(project) ? '收起摘要和详情' : '展开摘要和详情' }}
                    </button>
                  </div>
                  <div v-if="isProjectExpanded(project)" class="project-expanded-detail">
                    <section>
                      <h4>摘要</h4>
                      <p>{{ projectSummaryText(project) }}</p>
                    </section>
                    <div class="project-key-fields">
                      <div v-if="project.problem_statement"><dt>科学问题</dt><dd>{{ project.problem_statement }}</dd></div>
                      <div v-if="project.clinical_endpoint"><dt>临床终点</dt><dd>{{ project.clinical_endpoint }}</dd></div>
                      <div v-if="project.existing_foundation"><dt>已有基础</dt><dd>{{ project.existing_foundation }}</dd></div>
                    </div>
                    <div v-if="project.tags.length" class="tag-row">
                      <span v-for="tag in project.tags.slice(0, 5)" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                </div>
                <div class="project-card-bottom project-status-strip">
                  <div class="project-status-row">
                    <strong>招募</strong><span>{{ projectRecruitmentText(project) }}</span>
                  </div>
                  <div class="project-status-row project-role-groups compact">
                    <strong>组队</strong>
                    <div class="project-role-chip-row">
                      <span v-for="role in requiredTeamRoles(project.team_status)" :key="role.key" :class="{ ready: role.ready }">
                        {{ role.label }} {{ role.count }}/{{ role.required }}
                      </span>
                    </div>
                  </div>
                  <div class="project-status-row project-startup-status" :class="{ ready: projectStartupReady(project) }">
                    <strong>启动</strong><span>{{ projectStartupText(project) }}</span>
                  </div>
                </div>
                <div class="project-card-footer">
                  <div class="card-actions project-interaction-actions">
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', project) }" type="button" :disabled="isSubmittingLike(project)" @click.stop="submitLike(project)">
                      {{ likeButtonLabel(project) }}
                    </button>
                    <button v-if="shouldShowFollowButton(project)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(project), 'interaction-active': interactionButtonActive('follow', project) }" type="button" @click.stop="toggleFollow(project)">
                      {{ followButtonLabel(project) }}
                    </button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', project) }" type="button" :disabled="!canClickParticipation(project)" @click.stop="handleParticipationAction(project)">
                      {{ participationButtonLabel(project) }}
                    </button>
                    <button class="ghost-button" type="button" @click.stop="submitLeadClaim(project)">
                      Lead
                    </button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', project) }" type="button" :disabled="!canClickSponsor(project)" @click.stop="submitSponsor(project)">
                      {{ sponsorButtonLabel(project) }}
                    </button>
                  </div>
                </div>
              </article>
            </div>

            <section v-if="!state.loading && !state.loadingMore && !state.projects.length" class="empty-state">
              <h2>没有找到匹配课题</h2>
              <p>换一个关键词或主题试试。</p>
            </section>

            <div class="load-more">
              <span class="scroll-hint">向下滚动会自动加载更多课题。</span>
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
                <p v-if="state.currentProject.title_en" class="english-title">{{ state.currentProject.title_en }}</p>
                <p>{{ state.currentProject.summary || state.currentProject.problem_statement || '待补充摘要。' }}</p>
                <div class="tag-row">
                  <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                </div>
              </div>
            </div>

            <div class="project-action-bar">
              <div class="project-action-meta">
                <span><strong>{{ topicCode(state.currentProject) }}</strong><small>课题编号</small></span>
                <span><strong>{{ state.currentProject.stage_label }}</strong><small>当前状态</small></span>
                <span :class="{ ready: projectFundingReady(state.currentProject) }"><strong>{{ projectFundingLabel(state.currentProject) }}</strong><small>资助情况</small></span>
                <span :class="{ ready: projectStartupReady(state.currentProject) }"><strong>{{ projectStartupLabel(state.currentProject) }}</strong><small>启动情况</small></span>
                <span><strong>{{ state.currentProject.score_count || 0 }}</strong><small>点赞</small></span>
                <span><strong>{{ state.currentProject.follow_count || 0 }}</strong><small>关注</small></span>
              </div>
              <div class="project-action-buttons">
                <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', state.currentProject) }" type="button" :disabled="isSubmittingLike(state.currentProject)" @click="submitLike(state.currentProject)">
                  {{ likeButtonLabel(state.currentProject) }}
                </button>
                <button v-if="shouldShowFollowButton(state.currentProject)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(state.currentProject), 'interaction-active': interactionButtonActive('follow', state.currentProject) }" type="button" @click="toggleFollow(state.currentProject)">
                  {{ followButtonLabel(state.currentProject) }}
                </button>
                <button class="primary-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', state.currentProject) }" type="button" :disabled="!canClickParticipation(state.currentProject)" @click="handleParticipationAction(state.currentProject)">
                  {{ participationButtonLabel(state.currentProject) }}
                </button>
                <button v-if="canRecruitProject(state.currentProject)" class="ghost-button" type="button" @click="submitLeadClaim(state.currentProject)">Lead</button>
                <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', state.currentProject) }" type="button" :disabled="!canClickSponsor(state.currentProject)" @click="submitSponsor(state.currentProject)">{{ sponsorButtonLabel(state.currentProject) }}</button>
              </div>
            </div>

            <div class="detail-stack">
              <article class="content-panel">
                <h2>课题介绍</h2>
                <div class="info-list">
                  <section><h3>摘要</h3><p>{{ state.currentProject.summary || state.currentProject.problem_statement || '待补充' }}</p></section>
                  <section><h3>科学问题</h3><p>{{ state.currentProject.problem_statement || '待补充' }}</p></section>
                  <section><h3>临床终点</h3><p>{{ state.currentProject.clinical_endpoint || '待补充' }}</p></section>
                  <section><h3>已有基础</h3><p>{{ state.currentProject.existing_foundation || '待补充' }}</p></section>
                  <section><h3>需要招募</h3><p>{{ projectRecruitmentText(state.currentProject) }}</p></section>
                  <section v-if="state.currentProject.project_progress"><h3>项目进度</h3><p>{{ state.currentProject.project_progress }}</p></section>
                  <section v-if="state.currentProject.target_venue"><h3>目标期刊/会议</h3><p>{{ state.currentProject.target_venue }}</p></section>
                </div>
                <section v-if="projectDocuments(state.currentProject).length" class="project-document-strip">
                  <div class="domain-section-head">
                    <h3>课题详细文档</h3>
                    <span>{{ projectDocuments(state.currentProject).length }} 份</span>
                  </div>
                  <div class="project-document-icons">
                    <a
                      v-for="document in projectDocuments(state.currentProject)"
                      :key="document.id"
                      class="project-document-icon"
                      :href="documentHref(document)"
                      :title="documentTooltip(document)"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span class="material-symbols-rounded">{{ documentIcon(document) }}</span>
                      <strong>{{ documentDisplayTitle(document) }}</strong>
                      <small>{{ document.description || document.doc_type_label }}</small>
                    </a>
                  </div>
                </section>
              </article>

              <article class="content-panel project-team-panel">
                <h2>组队情况</h2>
                <div class="role-list">
                  <div v-for="role in requiredTeamRoles(state.currentProject.team_status)" :key="role.key" :class="{ ready: role.ready }">
                    <span>{{ role.label }}</span>
                    <strong>{{ role.count }}/{{ role.required }}</strong>
                  </div>
                </div>
                <p class="ready-text" :class="{ pending: !projectStartupReady(state.currentProject) }">{{ projectStartupText(state.currentProject) }}</p>
              </article>

              <article class="content-panel">
                <h2>主题文件空间</h2>
                <div v-if="state.currentProjectThemeSpace?.sections?.length" class="theme-file-sections">
                  <div class="domain-section" v-for="section in state.currentProjectThemeSpace.sections" :key="section.name">
                    <div class="domain-section-head">
                      <h3>{{ section.name }}</h3>
                      <span>{{ section.files.length }} 个文件</span>
                    </div>
                    <div class="file-list">
                      <a v-for="file in section.files.slice(0, 8)" :key="file.id" :href="file.path" target="_blank" rel="noreferrer">
                        <span>{{ file.file_type_label || fileTypeLabel(file.file_type) }}</span>
                        <strong>{{ file.title }}</strong>
                        <small>{{ file.description || file.path }}</small>
                      </a>
                      <p v-if="!section.files.length">这个栏目还没有文件。</p>
                    </div>
                  </div>
                  <button v-if="state.currentProject.theme?.slug" class="ghost-button" type="button" @click="selectSpace(state.currentProject.theme.slug)">查看主题文件空间</button>
                </div>
                <p v-else>{{ state.currentProject.theme?.slug ? '该主题还没有登记数据资产文件。' : '该课题暂无所属主题，无法关联主题文件空间。' }}</p>
              </article>
            </div>
          </section>

          <section v-else-if="activeView === 'space'" class="space-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">主题数据文件空间</span>
                <h1>文件空间</h1>
              </div>
            </div>
            <div class="theme-strip">
              <button
                v-for="theme in homeThemeCards"
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
                <div class="space-domain-hero">
                  <div>
                    <h2>{{ state.themeSpace.theme.name }}</h2>
                    <p>{{ state.themeSpace.theme.description || state.themeSpace.theme.file_space?.storage_policy }}</p>
                  </div>
                  <div class="space-access-card">
                    <span>访问级别</span>
                    <strong>{{ state.themeSpace.theme.file_space?.access_level || 'public_metadata' }}</strong>
                  </div>
                </div>
                <dl class="space-summary-row">
                  <div><dt>关联课题</dt><dd>{{ state.themeSpace.project_count }}</dd></div>
                  <div><dt>登记文件</dt><dd>{{ state.themeSpace.file_count }}</dd></div>
                  <div><dt>文件类型</dt><dd>{{ state.themeSpace.theme.file_space?.allowed_file_types?.length || 0 }}</dd></div>
                </dl>
                <div class="space-domain-grid">
                  <section class="policy-box">
                    <strong>文件空间策略</strong>
                    <p>{{ state.themeSpace.theme.file_space?.storage_policy || '只登记主题级数据资产元信息。' }}</p>
                  </section>
                  <section class="space-type-panel">
                    <strong>允许登记的资产类型</strong>
                    <div class="tag-row compact-tags">
                      <span v-for="type in state.themeSpace.theme.file_space?.allowed_file_types || []" :key="type">{{ fileTypeLabel(type) }}</span>
                      <span v-if="!state.themeSpace.theme.file_space?.allowed_file_types?.length">暂未配置</span>
                    </div>
                  </section>
                </div>
                <div v-if="!state.themeSpace.file_count" class="space-empty-callout">
                  <span class="material-symbols-rounded" style="font-size: 28px;">folder_open</span>
                  <div>
                    <strong>当前主题还没有登记数据资产文件</strong>
                  </div>
                </div>
                <div class="space-section-grid">
                  <div class="domain-section" v-for="section in state.themeSpace.sections" :key="section.name">
                    <div class="domain-section-head">
                      <h3>{{ section.name }}</h3>
                      <span>{{ section.files.length }} 个文件</span>
                    </div>
                    <div class="file-list compact-file-list">
                      <a v-for="file in section.files" :key="file.id" :href="file.path" target="_blank" rel="noreferrer">
                        <span>{{ fileTypeLabel(file.file_type) }}</span>
                        <strong>{{ file.title }}</strong>
                        <small>{{ file.description || file.path }}</small>
                      </a>
                      <p v-if="!section.files.length">待登记 {{ section.name }}。</p>
                    </div>
                  </div>
                </div>
              </article>
              <aside class="side-panel space-side-panel">
                <div class="side-panel-head">
                  <div>
                    <h2>关联课题</h2>
                    <p>属于当前主题的课题，可直接打开查看详情。</p>
                  </div>
                  <strong>{{ state.themeSpace.project_count }}</strong>
                </div>
                <div class="space-project-list">
                  <button
                    v-for="project in state.themeSpace.projects"
                    :key="project.id"
                    type="button"
                    class="space-project-link"
                    @click="openProjectPreview(project)"
                  >
                    <strong>{{ project.title }}</strong>
                    <span>{{ topicCode(project) }} · {{ stageLabel(project) }}</span>
                  </button>
                </div>
              </aside>
            </div>
          </section>

          <section v-else-if="activeView === 'dashboard'" class="dashboard-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">我的空间</span>
                <h1>{{ state.user?.profile?.display_name || state.user?.username }}</h1>
                <p>{{ state.user?.profile?.uid || '未分配 UID' }} · {{ roleInfo.role_label }} · {{ state.user?.profile?.organization || '未填写机构' }}</p>
              </div>
            </div>
            <div class="workspace-tabs" role="tablist" aria-label="我的空间">
              <button type="button" :class="{ active: state.workspaceTab === 'overview' }" @click="setWorkspaceTab('overview')">总览</button>
              <button type="button" :class="{ active: state.workspaceTab === 'favorites' }" @click="setWorkspaceTab('favorites')">我的关注</button>
              <button type="button" :class="{ active: state.workspaceTab === 'interactions' }" @click="setWorkspaceTab('interactions')">我的任务</button>
              <button type="button" :class="{ active: state.workspaceTab === 'profile' }" @click="setWorkspaceTab('profile')">个人资料</button>
            </div>

            <template v-if="state.dashboard">
              <section v-if="state.workspaceTab === 'overview'" class="workspace-panel">
                <div class="dashboard-grid admin-overview-grid workspace-overview-grid">
                  <button
                    v-for="card in workspaceOverviewCards"
                    :key="card.title"
                    class="content-panel admin-overview-card workspace-overview-card"
                    type="button"
                    @click="setWorkspaceTab(card.tab)"
                  >
                    <h2>{{ card.title }}</h2>
                    <p>{{ card.value }}</p>
                  </button>
                </div>
                <div class="role-card-grid">
                  <article v-for="card in roleCards" :key="card.title" class="role-card">
                    <h3>{{ card.title }}</h3>
                    <p>{{ card.body }}</p>
                  </article>
                </div>
              </section>

              <section v-else-if="state.workspaceTab === 'favorites'" class="workspace-panel">
                <div v-if="favoriteProjects.length" class="workspace-list">
                  <article class="workspace-row" v-for="project in favoriteProjects" :key="project.id">
                    <span><strong>{{ project.title }}</strong><small>{{ topicCode(project) }} · {{ project.stage_label }}</small></span>
                    <span>{{ project.theme?.name || '未分类' }}</span>
                    <div class="button-row">
                      <button class="ghost-button" type="button" @click="openProjectPreview(project)">查看</button>
                      <button class="ghost-button danger" type="button" @click="toggleFollow(project)">取消关注</button>
                    </div>
                  </article>
                </div>
                <section v-else class="empty-state favorites-empty">
                  <h2>还没有关注课题</h2>
                  <p>在课题列表或详情页点击关注后，会集中显示在这里。</p>
                  <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
                </section>
              </section>

              <section v-else-if="state.workspaceTab === 'interactions'" class="workspace-panel">
                <div v-if="myProjectTasks.length" class="my-task-list">
                  <article class="my-task-card" v-for="task in myProjectTasks" :key="task.project.id">
                    <div class="my-task-main">
                      <div class="my-task-title-row">
                        <span class="eyebrow">课题情况</span>
                        <span class="status-chip">{{ task.project.stage_label }}</span>
                        <span class="status-chip strong">{{ myTaskStatusLabel(task) }}</span>
                      </div>
                      <h2>{{ task.project.title }}</h2>
                      <p>{{ shortText(task.project.problem_statement, 100) }}</p>
                      <small>{{ topicCode(task.project) }} · {{ task.project.theme?.name || '未分类' }}</small>
                      <div class="relation-summary">{{ taskRelationSummary(task) }}</div>
                      <div v-if="task.contributions.length" class="task-result-strip">
                        <span v-for="item in task.contributions" :key="item.id">
                          <strong>{{ item.title }}</strong>
                          <small>{{ contributionStatusText(item) }}{{ item.review_comment ? ' · ' + item.review_comment : '' }}</small>
                        </span>
                      </div>
                      <p v-else class="muted-inline">暂无任务结果记录。</p>
                    </div>
                    <div class="my-task-actions">
                      <button class="ghost-button" type="button" @click="openProjectPreview(task.project)">查看课题</button>
                      <button
                        class="primary-button"
                        type="button"
                        :disabled="!canSubmitProjectTask(task)"
                        @click="openContributionModal(task)"
                      >
                        提交任务结果
                      </button>
                      <small v-if="!canSubmitProjectTask(task)">{{ taskSubmitHint(task) }}</small>
                    </div>
                  </article>
                </div>
                <section v-else class="empty-state favorites-empty">
                  <h2>还没有任务</h2>
                  <p>申请参与、认领或资助课题后，会在这里看到课题状态和你的任务进展。</p>
                  <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
                </section>
              </section>

              <section v-else class="workspace-panel">
                <article class="content-panel">
                  <h2>个人资料</h2>
                  <form class="stack-form" @submit.prevent="saveProfile">
                    <div class="form-grid">
                      <label><span>昵称</span><input v-model="state.forms.profile.display_name" type="text" /></label>
                      <label><span>真实姓名</span><input v-model="state.forms.profile.real_name" type="text" /></label>
                      <label><span>身份</span>
                        <select v-model="state.forms.profile.role_type">
                          <option v-for="role in state.meta.profile_roles" :key="role.value" :value="role.value">{{ role.label }}</option>
                        </select>
                      </label>
                      <label><span>机构</span><input v-model="state.forms.profile.organization" type="text" /></label>
                    </div>
                    <div class="form-grid">
                      <label><span>职称/年级</span><input v-model="state.forms.profile.title" type="text" /></label>
                      <label><span>联系邮箱</span><input v-model="state.forms.profile.contact_email" type="email" /></label>
                      <label><span>微信</span><input v-model="state.forms.profile.contact_wechat" type="text" /></label>
                      <label><span>每周可投入小时</span><input v-model.number="state.forms.profile.available_hours_per_week" type="number" min="0" /></label>
                    </div>
                    <label><span>研究兴趣</span><textarea v-model="state.forms.profile.research_interests"></textarea></label>
                    <label><span>技能</span><textarea v-model="state.forms.profile.skills"></textarea></label>
                    <label><span>简介</span><textarea v-model="state.forms.profile.bio"></textarea></label>
                    <button class="primary-button" type="submit">保存资料</button>
                  </form>
                </article>
              </section>
            </template>
          </section>

          <section v-else-if="activeView === 'favorites'" class="favorites-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">我的关注</span>
                <h1>关注课题</h1>
                <p>集中查看和管理你关注的课题。</p>
              </div>
            </div>
            <div v-if="favoriteProjects.length" class="project-grid favorite-project-grid">
              <article
                v-for="project in favoriteProjects"
                :key="project.id"
                :data-project-id="project.id"
                class="project-card project-list-card"
              >
                <div class="project-list-main">
                  <div class="project-card-top">
                    <div class="project-card-meta">
                      <span>{{ topicCode(project) }}</span>
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span>{{ project.stage_label }}</span>
                      <span :class="{ ready: projectFundingReady(project) }">{{ projectFundingLabel(project) }}</span>
                    </div>
                    <dl class="project-card-counts" aria-label="课题互动统计">
                      <div><dt>点赞</dt><dd>{{ project.score_count || 0 }}</dd></div>
                      <div><dt>关注</dt><dd>{{ project.follow_count || 0 }}</dd></div>
                    </dl>
                  </div>
                  <h3>
                    <a class="project-title-link" :href="projectDetailHref(project)">{{ project.title }}</a>
                  </h3>
                  <div class="project-summary-collapsed">
                    <button class="text-button" type="button" @click.stop="toggleProjectExpansion(project)">
                      {{ isProjectExpanded(project) ? '收起摘要和详情' : '展开摘要和详情' }}
                    </button>
                  </div>
                  <div v-if="isProjectExpanded(project)" class="project-expanded-detail">
                    <section>
                      <h4>摘要</h4>
                      <p>{{ projectSummaryText(project) }}</p>
                    </section>
                    <div class="project-key-fields">
                      <div v-if="project.problem_statement"><dt>科学问题</dt><dd>{{ project.problem_statement }}</dd></div>
                      <div v-if="project.clinical_endpoint"><dt>临床终点</dt><dd>{{ project.clinical_endpoint }}</dd></div>
                      <div v-if="project.existing_foundation"><dt>已有基础</dt><dd>{{ project.existing_foundation }}</dd></div>
                    </div>
                    <div v-if="project.tags.length" class="tag-row">
                      <span v-for="tag in project.tags.slice(0, 5)" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                </div>
                <div class="project-card-bottom project-status-strip">
                  <div class="project-status-row">
                    <strong>招募</strong><span>{{ projectRecruitmentText(project) }}</span>
                  </div>
                  <div class="project-status-row project-role-groups compact">
                    <strong>组队</strong>
                    <div class="project-role-chip-row">
                      <span v-for="role in requiredTeamRoles(project.team_status)" :key="role.key" :class="{ ready: role.ready }">
                        {{ role.label }} {{ role.count }}/{{ role.required }}
                      </span>
                    </div>
                  </div>
                  <div class="project-status-row project-startup-status" :class="{ ready: projectStartupReady(project) }">
                    <strong>启动</strong><span>{{ projectStartupText(project) }}</span>
                  </div>
                </div>
                <div class="project-card-footer">
                  <div class="card-actions project-interaction-actions">
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', project) }" type="button" :disabled="isSubmittingLike(project)" @click.stop="submitLike(project)">{{ likeButtonLabel(project) }}</button>
                    <button class="ghost-button interaction-button follow-button active" :class="{ 'interaction-active': interactionButtonActive('follow', project) }" type="button" @click.stop="toggleFollow(project)">{{ followButtonLabel(project) }}</button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', project) }" type="button" :disabled="!canClickParticipation(project)" @click.stop="handleParticipationAction(project)">{{ participationButtonLabel(project) }}</button>
                    <button class="ghost-button" type="button" @click.stop="submitLeadClaim(project)">Lead</button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', project) }" type="button" :disabled="!canClickSponsor(project)" @click.stop="submitSponsor(project)">{{ sponsorButtonLabel(project) }}</button>
                  </div>
                </div>
              </article>
            </div>
            <section v-else class="empty-state favorites-empty">
              <h2>还没有关注课题</h2>
              <p>在课题列表或详情页点击关注后，会集中显示在这里。</p>
              <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
            </section>
          </section>

          <section v-else-if="activeView === 'admin'" class="admin-view">
            <template v-if="can('view_admin_console')">
              <div class="section-head">
                <div>
                  <span class="eyebrow">管理</span>
                  <h1>内容管理工作台</h1>
                  <p>主题、文件空间、课题字段和导入结果都由后端 API 写入数据库。停用操作保留审计记录，不做物理删除。</p>
                </div>
              </div>

              <div class="admin-tabs" role="tablist" aria-label="管理功能">
                <button type="button" :class="{ active: state.admin.activeTab === 'overview' }" @click="setAdminTab('overview')">总览</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'interactions' }" @click="setAdminTab('interactions')">任务审批</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'contributions' }" @click="setAdminTab('contributions')">任务管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'projects' }" @click="setAdminTab('projects')">课题管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'themes' }" @click="setAdminTab('themes')">主题与文件空间</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'users' }" @click="setAdminTab('users')">用户管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'audit' }" @click="setAdminTab('audit')">审计日志</button>
              </div>

              <section v-if="state.admin.activeTab === 'overview'" class="workspace-panel">
                <div class="dashboard-grid admin-overview-grid">
                  <button
                    v-for="card in adminOverviewCards"
                    :key="card.tab"
                    class="content-panel admin-overview-card"
                    type="button"
                    @click="setAdminTab(card.tab)"
                  >
                    <h2>{{ card.title }}</h2>
                    <p>{{ card.value }}</p>
                  </button>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'interactions'" class="workspace-panel collaboration-management">
                <div class="collaboration-management-head">
                  <div>
                    <h2>任务审批</h2>
                    <p>审核用户提交的参与、认领和资助申请。审核通过后，开放招募课题会自动进入组队中。</p>
                  </div>
                </div>
                <div class="collaboration-grid single-column">
                  <article class="content-panel">
                    <div class="panel-title-row compact-title-row">
                      <div>
                        <h3>申请审批</h3>
                        <p>处理待审核申请，状态变更会写入审计日志。</p>
                      </div>
                    </div>
                    <div class="admin-filter-row">
                      <select v-model="state.admin.interactionFilters.type" @change="loadAdminInteractions({ reset: true })">
                        <option value="">全部类型</option>
                        <option value="interest">申请参与</option>
                        <option value="claim">认领意向</option>
                        <option value="sponsor">资助意向</option>
                      </select>
                      <select v-model="state.admin.interactionFilters.status" @change="loadAdminInteractions({ reset: true })">
                        <option value="">全部状态</option>
                        <option value="pending">待处理</option>
                        <option value="approved">已通过</option>
                        <option value="rejected">已拒绝</option>
                        <option value="withdrawn">已撤回</option>
                      </select>
                      <input v-model="state.admin.interactionFilters.q" type="search" placeholder="搜索课题、用户或 UID" @keyup.enter="loadAdminInteractions({ reset: true })" />
                      <button class="ghost-button" type="button" @click="loadAdminInteractions({ reset: true })">查询</button>
                    </div>
                    <div class="admin-table interaction-table">
                      <div class="admin-table-head">
                        <span>申请</span><span>用户 UID</span><span>类型</span><span>状态</span><span>操作</span>
                      </div>
                      <div class="admin-table-row" v-for="item in state.admin.interactions" :key="item.type + '-' + item.id">
                        <span><strong>{{ item.project.title }}</strong><small>{{ item.message || topicCode(item.project) }}</small></span>
                        <span>{{ item.user.uid }}</span>
                        <span>{{ item.type_label }} · {{ item.subtype_label }}</span>
                        <span>{{ item.status_label }}</span>
                        <span class="button-row">
                          <template v-if="canReviewInteraction(item)">
                            <button class="ghost-button" type="button" @click="reviewInteraction(item, 'approved')">通过</button>
                            <button class="ghost-button danger" type="button" @click="reviewInteraction(item, 'rejected')">拒绝</button>
                          </template>
                          <small v-else>已处理</small>
                        </span>
                      </div>
                    </div>
                    <p v-if="!state.admin.loadingInteractions && !state.admin.interactions.length">没有匹配的协作申请。</p>
                  </article>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'contributions'" class="content-panel">
                <div class="panel-title-row">
                  <div><h2>任务管理</h2><p>按课题查看已获批人员 UID 和任务结果，在详情弹窗中完成审核与结题。</p></div>
                </div>
                <div class="admin-filter-row">
                  <input v-model="state.admin.taskProjectFilters.q" type="search" placeholder="搜索课题、课题编号或摘要" @keyup.enter="loadAdminTaskProjects({ reset: true })" />
                  <select v-model="state.admin.taskProjectFilters.stage" @change="loadAdminTaskProjects({ reset: true })">
                    <option value="">组队中 / 进行中 / 暂停</option>
                    <option value="open_recruiting">开放招募</option>
                    <option value="team_building">组队中</option>
                    <option value="active">进行中</option>
                    <option value="paused">暂停</option>
                    <option value="archived">归档</option>
                  </select>
                  <button class="ghost-button" type="button" @click="loadAdminTaskProjects({ reset: true })">查询</button>
                </div>
                <div class="admin-table task-project-table">
                  <div class="admin-table-head"><span>课题名称</span><span>主题</span><span>课题状态</span><span>课题编号</span><span>操作</span></div>
                  <div class="admin-table-row" v-for="project in state.admin.taskProjects" :key="project.id">
                    <span><strong>{{ project.title }}</strong><small>{{ shortText(project.problem_statement, 100) }}</small></span>
                    <span>{{ project.theme?.name || '未分类' }}</span>
                    <span>{{ project.stage_label }}</span>
                    <span>{{ topicCode(project) }}</span>
                    <span class="button-row">
                      <button class="primary-button" type="button" @click="openTaskProjectDetail(project)">查看任务详情</button>
                    </span>
                  </div>
                </div>
                <p v-if="!state.admin.loadingTaskProjects && !state.admin.taskProjects.length">暂无匹配的任务课题。</p>
                <p v-if="state.admin.loadingTaskProjects">正在读取任务课题...</p>
              </section>

              <section v-else-if="state.admin.activeTab === 'audit'" class="content-panel">
                <div class="panel-title-row"><div><h2>审计日志</h2><p>关键管理动作和用户提交动作都会写入这里。</p></div></div>
                <div class="admin-filter-row">
                  <input v-model="state.admin.auditFilters.action" type="search" placeholder="动作" @keyup.enter="loadAdminAuditLogs({ reset: true })" />
                  <input v-model="state.admin.auditFilters.target_type" type="search" placeholder="对象类型" @keyup.enter="loadAdminAuditLogs({ reset: true })" />
                  <button class="ghost-button" type="button" @click="loadAdminAuditLogs({ reset: true })">查询</button>
                </div>
                <div class="admin-table audit-table">
                  <div class="admin-table-head"><span>动作</span><span>操作者</span><span>对象</span><span>时间</span><span>摘要</span></div>
                  <div class="admin-table-row audit-table-row" v-for="entry in state.admin.auditLogs" :key="entry.id">
                    <span class="audit-action"><strong>{{ auditActionLabel(entry) }}</strong><small>{{ entry.action }}</small></span>
                    <span class="audit-actor"><strong>{{ auditActorLabel(entry) }}</strong><small>{{ entry.actor?.username || '' }}</small></span>
                    <span class="audit-target"><strong>{{ auditTargetLabel(entry) }}</strong><small>{{ entry.target_type }} #{{ entry.target_id }}</small></span>
                    <span class="audit-time">{{ formatAuditTime(entry.created_at) }}</span>
                    <span class="audit-summary">{{ auditSummary(entry) }}</span>
                  </div>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'projects'" class="admin-workbench project-management-workbench">
                <article class="content-panel admin-list-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>课题管理</h2>
                      <p>共 {{ state.admin.projectPagination.total_count || 0 }} 个课题，当前显示 {{ state.admin.projects.length }} 个。</p>
                    </div>
                    <div class="button-row admin-bulk-actions">
                      <button
                        class="ghost-button danger"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkArchivingProjects"
                        @click="bulkArchiveSelectedProjects"
                      >
                        {{ state.admin.bulkArchivingProjects ? '正在删除...' : '批量删除(' + state.admin.selectedProjectIds.length + ')' }}
                      </button>
                      <button class="primary-button" type="button" @click="newProject">新增课题</button>
                    </div>
                  </div>
                  <div class="admin-filter-row">
                    <input v-model="state.admin.projectFilters.q" type="search" placeholder="搜索标题、课题编号或摘要" @keyup.enter="searchAdminProjects" />
                    <select v-model="state.admin.projectFilters.theme" @change="searchAdminProjects">
                      <option value="">不限主题</option>
                      <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.slug">{{ theme.name }}</option>
                    </select>
                    <button class="ghost-button" type="button" @click="searchAdminProjects">查询</button>
                  </div>
                  <div class="admin-table project-admin-table">
                    <div class="admin-table-head">
                      <span class="admin-select-cell">
                        <input
                          type="checkbox"
                          aria-label="选择当前页全部课题"
                          :checked="areAllVisibleAdminProjectsSelected()"
                          :disabled="!state.admin.projects.length"
                          @change="toggleVisibleAdminProjectsSelection"
                        />
                      </span>
                      <span>课题</span>
                      <span>主题</span>
                      <span>阶段</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    <div class="admin-table-row" v-for="project in state.admin.projects" :key="project.id">
                      <span class="admin-select-cell">
                        <input
                          type="checkbox"
                          :aria-label="'选择课题 ' + topicCode(project)"
                          :checked="isAdminProjectSelected(project)"
                          @change="toggleAdminProjectSelection(project)"
                        />
                      </span>
                      <span>
                        <strong>{{ project.title }}</strong>
                        <small>{{ topicCode(project) }}</small>
                      </span>
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span>
                        <select
                          class="admin-stage-select"
                          :value="project.stage"
                          :disabled="state.admin.updatingProjectStageId === project.id"
                          @click.stop
                          @change="updateAdminProjectStage(project, $event.target.value, $event)"
                        >
                          <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                        </select>
                      </span>
                      <span>{{ adminProjectVisibilityLabel(project) }}</span>
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
                    <span v-else>已显示当前筛选结果</span>
                  </div>
                </article>

                <article class="content-panel markdown-import-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>JSON 导入</h2>
                      <p>只能选择 JSON 文件或课题目录；默认按数据库已有最大课题编号继续自动编号，JSON 内编号仅用于排序参考。</p>
                    </div>
                    <button class="ghost-button" type="button" @click="downloadJsonTemplate">下载 JSON 模板</button>
                  </div>
                  <div class="markdown-import-actions">
                    <label class="file-picker json-import-picker">
                      <span>选择 JSON 文件</span>
                      <small>只读取 .json 文件</small>
                      <input type="file" accept=".json,application/json" multiple @change="handleJsonFiles" />
                    </label>
                    <label class="file-picker json-import-picker">
                      <span>选择课题目录</span>
                      <small>只处理课题 JSON 和同名 PDF，其他文件忽略</small>
                      <input type="file" accept=".json,application/json" webkitdirectory directory multiple @change="handleJsonFiles" />
                    </label>
                    <button class="primary-button" type="button" :disabled="state.admin.jsonImport.applying || !state.admin.jsonImport.rows.length" @click="openJsonImportPreview">
                      预览并确认
                    </button>
                    <button class="ghost-button" type="button" :disabled="state.admin.jsonImport.applying || (!state.admin.jsonImport.rows.length && !state.admin.jsonImport.fileCount)" @click="clearJsonImport">
                      清除导入提示
                    </button>
                  </div>
                  <div v-if="state.admin.jsonImport.selection.totalFileCount" class="json-import-selection-summary">
                    <strong>实际处理 {{ state.admin.jsonImport.selection.jsonFileCount }} 个 JSON</strong>
                    <span>匹配 {{ state.admin.jsonImport.selection.matchedPdfCount }} 个同名 PDF</span>
                    <span>忽略 {{ state.admin.jsonImport.selection.ignoredFileCount }} 个其他文件</span>
                    <span>导入后自动从当前最大课题编号继续编号</span>
                    <small>浏览器原始选择 {{ state.admin.jsonImport.selection.totalFileCount }} 个文件；导入时不会处理无关文件。</small>
                  </div>
                  <p v-if="state.admin.jsonImport.rows.length">已解析 {{ state.admin.jsonImport.rows.length }} 条课题记录，其中 {{ state.admin.jsonImport.rows.filter((row) => !row.errors.length).length }} 条可导入。</p>
                  <p v-else>尚未选择 JSON 文件。JSON 文件可为单个对象、对象数组或包含 projects 数组的对象。</p>
                </article>

                <article class="content-panel schema-helper-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>字段契约与 JSON 模板</h2>
                      <p>系统内表单、JSON 导入和后端保存都按这些字段对齐。</p>
                    </div>
                  </div>
                  <details>
                    <summary>查看 JSON 模板</summary>
                    <pre class="markdown-template-preview">{{ state.schema.json_template }}</pre>
                  </details>
                  <div class="schema-table schema-table-wide">
                    <div v-for="field in state.schema.fields" :key="field.name">
                      <strong>{{ field.label }}</strong>
                      <code>{{ field.name }}</code>
                      <span>{{ field.type }}{{ field.required ? ' · 必填' : '' }}</span>
                    </div>
                  </div>
                </article>

                <div v-if="state.admin.projectFormOpen" class="project-form-modal" @click.self="closeProjectForm">
                  <section class="project-form-dialog" role="dialog" aria-modal="true" aria-label="课题表单">
                    <header class="project-form-dialog-header">
                      <div>
                        <span class="eyebrow">课题管理</span>
                        <h2>{{ state.admin.projectForm.id ? '编辑课题' : '新增课题' }}</h2>
                        <p>默认保存为草稿且不公开。确认内容完整后，再发布到用户课题库。</p>
                      </div>
                      <div class="modal-actions">
                        <button class="ghost-button" type="button" @click="newProject">重置表单</button>
                        <button class="ghost-button" type="button" @click="closeProjectForm">关闭</button>
                      </div>
                    </header>
                    <form class="stack-form project-edit-form project-form-dialog-body" @submit.prevent="saveProject()">
                      <div class="form-grid">
                        <label><span>主题</span>
                          <select v-model="state.admin.projectForm.theme">
                            <option value="">请选择主题</option>
                            <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.slug">{{ theme.name }}</option>
                          </select>
                        </label>
                        <label><span>阶段</span>
                          <select v-model="state.admin.projectForm.stage">
                            <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                          </select>
                        </label>
                      </div>
                      <label><span>Title（中文）</span><input v-model="state.admin.projectForm.title" type="text" /></label>
                      <label><span>Title（英文，选填）</span><input v-model="state.admin.projectForm.title_en" type="text" /></label>
                      <label><span>摘要</span><textarea v-model="state.admin.projectForm.summary" placeholder="用一段话概括课题要解决的问题、核心方法和预期价值"></textarea></label>
                      <div class="form-grid">
                        <label><span>科学问题（选填，250字以内）</span><textarea v-model="state.admin.projectForm.problem_statement" maxlength="250"></textarea></label>
                        <label><span>临床终点（选填，250字以内）</span><textarea v-model="state.admin.projectForm.clinical_endpoint" maxlength="250"></textarea></label>
                        <label><span>已有基础（选填，250字以内）</span><textarea v-model="state.admin.projectForm.existing_foundation" maxlength="250"></textarea></label>
                      </div>
                      <div class="form-grid">
                        <label><span>标签（逗号分隔）</span><input v-model="state.admin.projectForm.tags" type="text" /></label>
                      </div>
                      <section class="project-document-manager">
                        <div class="panel-title-row compact-title-row">
                          <div>
                            <h3>课题详细文档</h3>
                            <p>每份文档都需要填写内容说明，例如“课题介绍”或“数据集说明”。</p>
                          </div>
                          <span v-if="state.admin.projectForm.id" class="status-chip">{{ state.admin.projectForm.documents.length }} 份</span>
                        </div>
                        <template v-if="state.admin.projectForm.id">
                          <div v-if="state.admin.projectForm.documents.length" class="project-document-admin-list">
                            <article v-for="document in state.admin.projectForm.documents" :key="document.id" class="project-document-admin-row">
                              <span class="material-symbols-rounded">{{ documentIcon(document) }}</span>
                              <div>
                                <strong>{{ documentDisplayTitle(document) }}</strong>
                                <small>{{ document.description || '未填写内容说明' }}</small>
                                <small>{{ document.doc_type_label || fileTypeLabel(document.doc_type) }} · {{ document.path }}</small>
                              </div>
                              <a class="ghost-button" :href="documentHref(document)" target="_blank" rel="noreferrer">打开</a>
                              <button class="ghost-button danger" type="button" @click="deleteProjectDocument(document)">删除</button>
                            </article>
                          </div>
                          <p v-else class="muted-inline">这个课题还没有上传详细文档。</p>
                          <div class="project-document-upload">
                            <label><span>文档类型</span>
                              <select v-model="state.admin.projectForm.documentUpload.doc_type">
                                <option value="markdown">Markdown</option>
                                <option value="pdf">PDF</option>
                                <option value="html">HTML</option>
                                <option value="other">其他</option>
                              </select>
                            </label>
                            <label><span>文档标题</span><input v-model="state.admin.projectForm.documentUpload.title" type="text" placeholder="例如：课题介绍" /></label>
                            <label class="document-description-field"><span>内容说明</span><textarea v-model="state.admin.projectForm.documentUpload.description" placeholder="例如：课题介绍、数据集说明"></textarea></label>
                            <label class="file-picker compact-file-picker">
                              <span>选择文档</span>
                              <input :key="state.admin.projectForm.documentUpload.inputKey" type="file" @change="setProjectDocumentFile" />
                            </label>
                            <button class="primary-button" type="button" :disabled="state.admin.projectForm.documentUpload.uploading" @click="uploadProjectDocument">
                              {{ state.admin.projectForm.documentUpload.uploading ? '正在上传...' : '上传文档' }}
                            </button>
                          </div>
                        </template>
                        <p v-else class="muted-inline">请先保存课题草稿，再回到编辑弹窗上传详细文档。</p>
                      </section>
                      <div class="button-row form-actions">
                        <label class="inline-check"><input v-model="state.admin.projectForm.is_public" type="checkbox" /> 公开展示</label>
                        <button class="ghost-button" type="submit">保存草稿</button>
                        <button class="primary-button" type="button" @click="saveProject({ publish: true })">发布课题</button>
                      </div>
                    </form>
                  </section>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'themes'" class="admin-workbench">
                <article class="content-panel admin-form-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>{{ state.admin.themeForm.id ? '编辑主题' : '新增主题' }}</h2>
                      <p>主题配置和文件空间策略会保存到数据库。</p>
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
                    <label><span>文件空间策略 JSON</span><textarea class="json-editor compact-json-editor" v-model="state.admin.themeForm.file_space"></textarea></label>
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
                      <h2>文件空间管理</h2>
                      <p>{{ selectedAdminTheme?.name || '请选择主题' }}</p>
                    </div>
                  </div>
                  <label><span>选择主题</span>
                    <select :value="state.admin.selectedThemeId" @change="selectAdminTheme($event.target.value)">
                      <option v-for="theme in state.admin.themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
                    </select>
                  </label>
                  <div class="file-manager">
                    <div class="file-manager-root">
                      <label>
                        <span>服务器目录</span>
                        <input v-model="state.admin.fileManager.serverDirectory" type="text" :placeholder="state.admin.fileManager.baseRoot || '文件空间根目录'" />
                      </label>
                      <button class="primary-button" type="button" :disabled="state.admin.fileManager.rootSaving" @click="saveFileSpaceRoot">
                        {{ state.admin.fileManager.rootSaving ? '保存中' : '保存目录' }}
                      </button>
                    </div>
                    <small class="field-hint">目录必须位于后端配置的文件空间根目录下：{{ state.admin.fileManager.baseRoot || '读取中' }}</small>
                    <div class="file-manager-toolbar">
                      <div class="breadcrumb-row">
                        <button
                          v-for="crumb in state.admin.fileManager.breadcrumbs"
                          :key="crumb.path || 'root'"
                          class="text-button"
                          type="button"
                          @click="loadAdminFileSpace(crumb.path)"
                        >
                          {{ crumb.name }}
                        </button>
                      </div>
                      <button class="ghost-button" type="button" :disabled="state.admin.fileManager.loading" @click="loadAdminFileSpace()">刷新</button>
                    </div>
                    <div class="file-manager-actions">
                      <label>
                        <span>新目录</span>
                        <input v-model="state.admin.fileManager.newDirectoryName" type="text" placeholder="目录名" @keyup.enter="createFileSpaceDirectory" />
                      </label>
                      <button class="ghost-button" type="button" @click="createFileSpaceDirectory">新建目录</button>
                      <label>
                        <span>新文件</span>
                        <input v-model="state.admin.fileManager.newFileName" type="text" placeholder="例如 data-note.md" @keyup.enter="createFileSpaceFile" />
                      </label>
                      <button class="ghost-button" type="button" @click="createFileSpaceFile">新建文件</button>
                      <label class="file-picker compact-picker">
                        <span>{{ state.admin.fileManager.uploading ? '上传中' : '上传文件' }}</span>
                        <input type="file" multiple :disabled="state.admin.fileManager.uploading" @change="handleFileSpaceUpload" />
                      </label>
                      <label class="file-picker compact-picker">
                        <span>{{ state.admin.fileManager.uploading ? '上传中' : '上传目录' }}</span>
                        <input type="file" webkitdirectory directory multiple :disabled="state.admin.fileManager.uploading" @change="handleFileSpaceUpload" />
                      </label>
                    </div>
                    <div class="file-manager-layout">
                      <div class="file-browser" :class="{ loading: state.admin.fileManager.loading }">
                        <button
                          v-for="entry in state.admin.fileManager.entries"
                          :key="entry.path"
                          class="file-row"
                          :class="{ selected: state.admin.fileManager.selected?.path === entry.path }"
                          type="button"
                          @click="selectFileSpaceEntry(entry)"
                          @dblclick="openFileSpaceEntry(entry)"
                        >
                          <span class="material-symbols-rounded">{{ entry.type === 'directory' ? 'folder' : 'draft' }}</span>
                          <strong>{{ entry.name }}</strong>
                          <small>{{ entry.type === 'directory' ? '目录' : formatFileSize(entry.size) }}</small>
                        </button>
                        <p v-if="!state.admin.fileManager.loading && !state.admin.fileManager.entries.length">当前目录为空。</p>
                      </div>
                      <aside class="file-inspector">
                        <template v-if="state.admin.fileManager.selected">
                          <span class="eyebrow">{{ state.admin.fileManager.selected.type === 'directory' ? '目录' : '文件' }}</span>
                          <h3>{{ state.admin.fileManager.selected.name }}</h3>
                          <p>{{ state.admin.fileManager.selected.path || '根目录' }}</p>
                          <dl>
                            <div><dt>大小</dt><dd>{{ formatFileSize(state.admin.fileManager.selected.size) || '-' }}</dd></div>
                            <div><dt>修改时间</dt><dd>{{ state.admin.fileManager.selected.modified_at }}</dd></div>
                          </dl>
                          <div class="button-row">
                            <button v-if="state.admin.fileManager.selected.type === 'directory'" class="primary-button" type="button" @click="openFileSpaceEntry(state.admin.fileManager.selected)">打开</button>
                            <button v-else class="primary-button" type="button" @click="openFileSpaceEditor(state.admin.fileManager.selected)">编辑</button>
                            <a v-if="state.admin.fileManager.selected.public_path" class="ghost-button" :href="state.admin.fileManager.selected.public_path" target="_blank" rel="noreferrer">查看</a>
                            <button class="ghost-button danger" type="button" @click="deleteFileSpaceEntry(state.admin.fileManager.selected)">删除</button>
                          </div>
                        </template>
                        <p v-else>选择一个文件或目录查看操作。</p>
                      </aside>
                    </div>
                  </div>

                  <details class="registered-files-panel">
                    <summary>登记文件记录（{{ state.admin.themeFiles.length }}）</summary>
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
                      <div class="button-row">
                        <button class="ghost-button" type="button" @click="newThemeFile">新增登记</button>
                        <button class="primary-button" type="submit">保存登记</button>
                      </div>
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
                  </details>
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

              <div v-if="state.admin.fileManager.editorOpen" class="project-form-modal file-editor-modal" @click.self="closeFileSpaceEditor">
                <section class="project-form-dialog file-editor-dialog" role="dialog" aria-modal="true" aria-label="文件编辑器">
                  <header class="project-form-dialog-header">
                    <div>
                      <span class="eyebrow">文件空间</span>
                      <h2>编辑文件</h2>
                    </div>
                    <div class="modal-actions">
                      <button class="ghost-button" type="button" @click="closeFileSpaceEditor">关闭</button>
                      <button class="primary-button" type="button" @click="saveFileSpaceEditor">保存</button>
                    </div>
                  </header>
                  <div class="project-form-dialog-body file-editor-body">
                    <label><span>文件名</span><input v-model="state.admin.fileManager.editorName" type="text" /></label>
                    <label><span>内容</span><textarea v-model="state.admin.fileManager.editorContent"></textarea></label>
                  </div>
                </section>
              </div>

            </template>
            <section v-else class="empty-state">
              <h2>当前身份没有管理权限</h2>
              <p>管理员可以维护主题、课题、文件空间和 JSON 模板导入。</p>
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

        <div v-if="state.releaseModalOpen" class="release-modal-backdrop" @click.self="closeReleaseModal">
          <section class="release-modal" role="dialog" aria-modal="true" aria-label="更新日志">
            <header class="release-modal-header">
              <div>
                <span class="eyebrow">系统版本</span>
                <h2>v{{ state.meta.release?.version || '0.0.0' }}</h2>
              </div>
              <button class="ghost-button" type="button" @click="closeReleaseModal">关闭</button>
            </header>
            <div v-if="releaseLatest" class="release-current">
              <h3>最新版本 {{ releaseLatest.version }}</h3>
              <small>{{ releaseLatest.date }}</small>
              <div class="release-section" v-for="[section, items] in sectionEntries(releaseLatest.sections)" :key="section">
                <strong>{{ releaseSectionLabel(section) }}</strong>
                <ul>
                  <li v-for="item in items" :key="item">{{ item }}</li>
                </ul>
              </div>
            </div>
            <div v-if="releaseHistoryItems.length" class="release-history">
              <h3>历史版本</h3>
              <div class="release-history-item" v-for="item in releaseHistoryItems" :key="item.version">
                <button class="text-button release-history-trigger" type="button" @click="toggleReleaseVersion(item.version)">
                  v{{ item.version }} · {{ item.date }}
                  <span class="material-symbols-rounded" style="font-size: 18px;">{{ isReleaseVersionExpanded(item.version) ? 'expand_less' : 'expand_more' }}</span>
                </button>
                <div v-if="isReleaseVersionExpanded(item.version)" class="release-history-detail">
                  <div class="release-section" v-for="[section, items] in sectionEntries(item.sections)" :key="section">
                    <strong>{{ releaseSectionLabel(section) }}</strong>
                    <ul>
                      <li v-for="entry in items" :key="entry">{{ entry }}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-if="state.contributionModal.open" class="project-form-modal task-result-modal" @click.self="closeContributionModal">
          <section class="project-form-dialog task-result-dialog" role="dialog" aria-modal="true" aria-label="提交任务结果">
            <header class="project-form-dialog-header">
              <div>
                <span class="eyebrow">我的任务</span>
                <h2>提交任务结果</h2>
                <p>{{ state.contributionModal.project?.title }} · {{ state.contributionModal.project?.stage_label }}</p>
              </div>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeContributionModal">关闭</button>
              </div>
            </header>
            <form class="stack-form project-form-dialog-body" @submit.prevent="submitContribution">
              <div class="task-context-box">
                <strong>{{ topicCode(state.contributionModal.project) }}</strong>
                <span>{{ state.contributionModal.relation?.relation_type_label || '已获批' }}{{ state.contributionModal.relation?.subtype_label ? ' · ' + state.contributionModal.relation.subtype_label : '' }}</span>
              </div>
              <div class="form-grid">
                <label><span>结果标题</span><input v-model="state.forms.contribution.title" type="text" /></label>
                <label><span>结果类型</span>
                  <select v-model="state.forms.contribution.result_type">
                    <option value="stage">阶段性成果</option>
                    <option value="final">最终结果</option>
                  </select>
                </label>
              </div>
              <label><span>说明</span><textarea v-model="state.forms.contribution.description"></textarea></label>
              <label><span>文件路径或链接</span><input v-model="state.forms.contribution.file_path" type="text" /></label>
              <div class="button-row form-actions">
                <button class="ghost-button" type="button" @click="closeContributionModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.contributionModal.submitting">
                  {{ state.contributionModal.submitting ? '正在提交' : '提交任务结果' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.admin.taskProjectDetail.open" class="project-form-modal task-detail-modal" @click.self="closeTaskProjectDetail">
          <section class="project-form-dialog task-detail-dialog" role="dialog" aria-modal="true" aria-label="任务管理详情">
            <header class="project-form-dialog-header">
              <div>
                <span class="eyebrow">任务管理</span>
                <h2>{{ state.admin.taskProjectDetail.project?.title || '任务详情' }}</h2>
                <p>{{ topicCode(state.admin.taskProjectDetail.project) }} · {{ state.admin.taskProjectDetail.project?.stage_label }}</p>
              </div>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeTaskProjectDetail">关闭</button>
              </div>
            </header>
            <div class="project-form-dialog-body task-detail-body">
              <section v-if="state.admin.taskProjectDetail.loading" class="modal-loading">
                <div class="loader"></div>
                <p>正在读取任务详情</p>
              </section>
              <template v-else-if="state.admin.taskProjectDetail.project">
                <div class="task-detail-summary">
                  <div>
                    <strong>{{ state.admin.taskProjectDetail.project.title }}</strong>
                    <small>{{ state.admin.taskProjectDetail.project.theme?.name || '未分类' }} · {{ state.admin.taskProjectDetail.project.stage_label }}</small>
                    <p>{{ shortText(state.admin.taskProjectDetail.project.problem_statement, 100) }}</p>
                  </div>
                  <div class="button-row">
                    <button v-if="state.admin.taskProjectDetail.project.stage !== 'active' && state.admin.taskProjectDetail.project.stage !== 'archived'" class="ghost-button" type="button" @click="updateTaskProjectStage(state.admin.taskProjectDetail.project, 'active')">进入进行中</button>
                    <button v-if="state.admin.taskProjectDetail.project.stage !== 'paused' && state.admin.taskProjectDetail.project.stage !== 'archived'" class="ghost-button" type="button" @click="updateTaskProjectStage(state.admin.taskProjectDetail.project, 'paused')">暂停</button>
                    <button v-if="state.admin.taskProjectDetail.project.stage !== 'archived'" class="ghost-button danger" type="button" @click="updateTaskProjectStage(state.admin.taskProjectDetail.project, 'archived')">结题归档</button>
                  </div>
                </div>

                <section class="task-detail-section">
                  <h3>已获批人员</h3>
                  <div v-if="state.admin.taskProjectDetail.interactions.length" class="member-status-list task-member-list">
                    <div v-for="group in approvedInteractionGroupsFor(state.admin.taskProjectDetail.interactions)" :key="group.label">
                      <strong>{{ group.label }}</strong>
                      <span v-for="item in group.items" :key="item.type + '-' + item.id">
                        <strong>{{ item.user.uid }}</strong>
                        <small>{{ item.subtype_label }} · {{ item.status_label }}</small>
                      </span>
                    </div>
                  </div>
                  <p v-else>暂无已获批人员。</p>
                </section>

                <section class="task-detail-section">
                  <h3>已提交结果</h3>
                  <div v-if="state.admin.taskProjectDetail.contributions.length" class="admin-table contribution-review-table">
                    <div class="admin-table-head"><span>结果</span><span>提交 UID</span><span>状态</span><span>评语</span><span>操作</span></div>
                    <div class="admin-table-row" v-for="item in state.admin.taskProjectDetail.contributions" :key="item.id">
                      <span><strong>{{ item.title }}</strong><small>{{ contributionStatusText(item) }} · {{ item.file_path || item.description || '无文件路径' }}</small></span>
                      <span>{{ item.user.uid }}</span>
                      <span>{{ item.status_label }}</span>
                      <span><textarea v-model="state.admin.taskProjectDetail.reviewDrafts[item.id].review_comment" placeholder="填写审核评语"></textarea></span>
                      <span class="button-row">
                        <button class="ghost-button" type="button" @click="reviewContribution(item, 'approved')">通过</button>
                        <button v-if="item.result_type === 'final'" class="ghost-button" type="button" @click="reviewContribution(item, 'approved', { closeProject: true })">通过并结题</button>
                        <button class="ghost-button danger" type="button" @click="reviewContribution(item, 'rejected')">拒绝</button>
                      </span>
                    </div>
                  </div>
                  <p v-else>暂无任务结果记录。</p>
                </section>
              </template>
            </div>
          </section>
        </div>

        <div v-if="state.admin.jsonImport.previewOpen" class="project-form-modal json-import-preview-modal" @click.self="closeJsonImportPreview">
          <section class="project-form-dialog json-import-preview-dialog" role="dialog" aria-modal="true" aria-label="JSON 导入预览">
            <header class="project-form-dialog-header">
              <div>
                <span class="eyebrow">导入确认</span>
                <h2>待导入课题</h2>
                <p>共 {{ state.admin.jsonImport.rows.length }} 条，{{ state.admin.jsonImport.rows.filter((row) => !row.errors.length).length }} 条可写入数据库；最终课题编号由后端按现有最大编号递增生成。</p>
              </div>
              <div class="modal-actions">
                <button class="ghost-button" type="button" :disabled="state.admin.jsonImport.applying" @click="closeJsonImportPreview">关闭</button>
              </div>
            </header>
            <div class="json-import-preview-body">
              <div class="markdown-import-list json-import-preview-list">
                <div v-for="row in state.admin.jsonImport.rows" :key="row.id" class="markdown-import-row json-import-preview-row" :class="{ blocked: row.errors.length }">
                  <div>
                    <strong>{{ row.payload.title || row.fileName }}</strong>
                    <small>{{ row.sourcePath }}</small>
                    <small v-if="row.documentFileName">PDF：{{ row.documentFileName }}</small>
                  </div>
                  <div class="inline-row-field readonly-row-field"><span>源编号</span><strong>{{ topicCode(row.payload.topic_id) }}</strong></div>
                  <label class="inline-row-field"><span>Title（中文）</span><input v-model="row.payload.title" type="text" /></label>
                  <label class="inline-row-field"><span>Title（英文）</span><input v-model="row.payload.title_en" type="text" /></label>
                  <label class="inline-row-field"><span>主题</span><input v-model="row.payload.theme" type="text" /></label>
                  <label class="inline-row-field"><span>科学问题</span><input v-model="row.payload.problem_statement" type="text" maxlength="250" /></label>
                  <label class="inline-row-field"><span>临床终点</span><input v-model="row.payload.clinical_endpoint" type="text" maxlength="250" /></label>
                  <label class="inline-row-field"><span>已有基础</span><input v-model="row.payload.existing_foundation" type="text" maxlength="250" /></label>
                  <span>{{ row.actionLabel }}</span>
                  <span class="markdown-import-notes">
                    <template v-if="row.errors.length">错误：{{ row.errors.join('；') }}</template>
                    <template v-else-if="row.warnings.length">待补充：{{ row.warnings.join('、') }}</template>
                    <template v-else>字段完整</template>
                  </span>
                  <button class="ghost-button" type="button" :disabled="state.admin.jsonImport.applying" @click="refreshAllJsonImportRows">重新检测</button>
                </div>
              </div>
            </div>
            <div class="json-import-preview-footer">
              <button class="ghost-button" type="button" :disabled="state.admin.jsonImport.applying" @click="closeJsonImportPreview">取消</button>
              <button class="primary-button" type="button" :disabled="state.admin.jsonImport.applying || !state.admin.jsonImport.rows.some((row) => !row.errors.length)" @click="applyJsonImport">
                {{ state.admin.jsonImport.applying ? '正在导入' : '确认导入可写入项' }}
              </button>
            </div>
          </section>
        </div>

        <div v-if="state.confirmDialog.open" class="confirm-modal-backdrop" @click.self="resolveConfirmDialog(false)">
          <section class="confirm-modal" :class="'confirm-modal--' + state.confirmDialog.tone" role="dialog" aria-modal="true" aria-label="确认操作">
            <h2>{{ state.confirmDialog.title }}</h2>
            <p>{{ state.confirmDialog.message }}</p>
            <div class="button-row">
              <button class="ghost-button" type="button" @click="resolveConfirmDialog(false)">{{ state.confirmDialog.cancelText }}</button>
              <button class="primary-button" type="button" @click="resolveConfirmDialog(true)">{{ state.confirmDialog.confirmText }}</button>
            </div>
          </section>
        </div>

        <div v-if="state.preview.open" class="project-modal-backdrop" @click.self="closeProjectPreview">
          <section class="project-modal" :class="{ maximized: state.preview.maximized }" role="dialog" aria-modal="true">
            <div v-if="state.toast" class="toast modal-toast">{{ state.toast }}</div>
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
                    <p v-if="state.currentProject.title_en" class="english-title">{{ state.currentProject.title_en }}</p>
                    <p>{{ state.currentProject.summary || state.currentProject.problem_statement || '待补充摘要。' }}</p>
                    <div class="tag-row">
                      <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                </div>

                <div class="project-action-bar modal-project-action-bar">
                  <div class="project-action-meta">
                    <span><strong>{{ topicCode(state.currentProject) }}</strong><small>课题编号</small></span>
                    <span><strong>{{ state.currentProject.stage_label }}</strong><small>当前状态</small></span>
                    <span :class="{ ready: projectFundingReady(state.currentProject) }"><strong>{{ projectFundingLabel(state.currentProject) }}</strong><small>资助情况</small></span>
                    <span :class="{ ready: projectStartupReady(state.currentProject) }"><strong>{{ projectStartupLabel(state.currentProject) }}</strong><small>启动情况</small></span>
                    <span><strong>{{ state.currentProject.score_count || 0 }}</strong><small>点赞</small></span>
                    <span><strong>{{ state.currentProject.follow_count || 0 }}</strong><small>关注</small></span>
                  </div>
                  <div class="project-action-buttons">
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', state.currentProject) }" type="button" :disabled="isSubmittingLike(state.currentProject)" @click="submitLike(state.currentProject)">
                      {{ likeButtonLabel(state.currentProject) }}
                    </button>
                    <button v-if="shouldShowFollowButton(state.currentProject)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(state.currentProject), 'interaction-active': interactionButtonActive('follow', state.currentProject) }" type="button" @click="toggleFollow(state.currentProject)">
                      {{ followButtonLabel(state.currentProject) }}
                    </button>
                    <button class="primary-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', state.currentProject) }" type="button" :disabled="!canClickParticipation(state.currentProject)" @click="handleParticipationAction(state.currentProject)">
                      {{ participationButtonLabel(state.currentProject) }}
                    </button>
                    <button v-if="canRecruitProject(state.currentProject)" class="ghost-button" type="button" @click="submitLeadClaim(state.currentProject)">Lead</button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', state.currentProject) }" type="button" :disabled="!canClickSponsor(state.currentProject)" @click="submitSponsor(state.currentProject)">{{ sponsorButtonLabel(state.currentProject) }}</button>
                  </div>
                </div>

                <div class="detail-stack modal-detail-stack">
                  <article class="content-panel">
                    <h2>课题介绍</h2>
                    <div class="info-list">
                      <section><h3>摘要</h3><p>{{ state.currentProject.summary || state.currentProject.problem_statement || '待补充' }}</p></section>
                      <section><h3>科学问题</h3><p>{{ state.currentProject.problem_statement || '待补充' }}</p></section>
                      <section><h3>临床终点</h3><p>{{ state.currentProject.clinical_endpoint || '待补充' }}</p></section>
                      <section><h3>已有基础</h3><p>{{ state.currentProject.existing_foundation || '待补充' }}</p></section>
                      <section><h3>需要招募</h3><p>{{ projectRecruitmentText(state.currentProject) }}</p></section>
                      <section v-if="state.currentProject.project_progress"><h3>项目进度</h3><p>{{ state.currentProject.project_progress }}</p></section>
                      <section v-if="state.currentProject.target_venue"><h3>目标期刊/会议</h3><p>{{ state.currentProject.target_venue }}</p></section>
                    </div>
                    <section v-if="projectDocuments(state.currentProject).length" class="project-document-strip">
                      <div class="domain-section-head">
                        <h3>课题详细文档</h3>
                        <span>{{ projectDocuments(state.currentProject).length }} 份</span>
                      </div>
                      <div class="project-document-icons">
                        <a
                          v-for="document in projectDocuments(state.currentProject)"
                          :key="document.id"
                          class="project-document-icon"
                          :href="documentHref(document)"
                          :title="documentTooltip(document)"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span class="material-symbols-rounded">{{ documentIcon(document) }}</span>
                          <strong>{{ documentDisplayTitle(document) }}</strong>
                          <small>{{ document.description || document.doc_type_label }}</small>
                        </a>
                      </div>
                    </section>
                  </article>

                  <article class="content-panel project-team-panel">
                    <h2>组队情况</h2>
                    <div class="role-list">
                      <div v-for="role in requiredTeamRoles(state.currentProject.team_status)" :key="role.key" :class="{ ready: role.ready }">
                        <span>{{ role.label }}</span>
                        <strong>{{ role.count }}/{{ role.required }}</strong>
                      </div>
                    </div>
                    <p class="ready-text" :class="{ pending: !projectStartupReady(state.currentProject) }">{{ projectStartupText(state.currentProject) }}</p>
                  </article>

                  <article class="content-panel">
                    <h2>主题文件空间</h2>
                    <div v-if="state.currentProjectThemeSpace?.sections?.length" class="theme-file-sections">
                      <div class="domain-section" v-for="section in state.currentProjectThemeSpace.sections" :key="section.name">
                        <div class="domain-section-head">
                          <h3>{{ section.name }}</h3>
                          <span>{{ section.files.length }} 个文件</span>
                        </div>
                        <div class="file-list">
                          <a v-for="file in section.files.slice(0, 8)" :key="file.id" :href="file.path" target="_blank" rel="noreferrer">
                            <span>{{ file.file_type_label || fileTypeLabel(file.file_type) }}</span>
                            <strong>{{ file.title }}</strong>
                            <small>{{ file.description || file.path }}</small>
                          </a>
                          <p v-if="!section.files.length">这个栏目还没有文件。</p>
                        </div>
                      </div>
                      <button v-if="state.currentProject.theme?.slug" class="ghost-button" type="button" @click="selectSpace(state.currentProject.theme.slug)">查看主题文件空间</button>
                    </div>
                    <p v-else>{{ state.currentProject.theme?.slug ? '该主题还没有登记数据资产文件。' : '该课题暂无所属主题，无法关联主题文件空间。' }}</p>
                  </article>
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
      storage_policy: "主题文件空间只登记与该主题相关的数据资产元信息。",
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

function emptyProfileForm() {
  return {
    display_name: "",
    real_name: "",
    role_type: "undergrad_or_below",
    organization: "",
    title: "",
    research_interests: "",
    skills: "",
    available_hours_per_week: 0,
    contact_email: "",
    contact_wechat: "",
    bio: ""
  };
}

function emptyContributionForm(task = null, project = null) {
  return {
    project_id: project?.id || task?.project?.id || "",
    task_id: task?.id || "",
    title: task ? `${task.title} 交付` : "",
    result_type: "stage",
    description: "",
    file_path: ""
  };
}

function emptyTaskForm(project = null) {
  return {
    project_id: project?.id || "",
    title: "",
    description: "",
    task_type: "",
    required_role: "",
    difficulty: 1,
    assignee_uid: "",
    credit_reward: 0
  };
}

function emptyProjectForm() {
  return {
    id: null,
    topic_id: "",
    theme: "",
    title: "",
    title_en: "",
    summary: "",
    problem_statement: "",
    clinical_endpoint: "",
    existing_foundation: "",
    stage: "draft",
    tags: "",
    is_public: false,
    documents: [],
    documentUpload: emptyProjectDocumentUpload()
  };
}

function emptyProjectDocumentUpload() {
  return {
    doc_type: "markdown",
    title: "",
    description: "",
    file: null,
    uploading: false,
    inputKey: 0
  };
}

function emptyJsonImportSelection() {
  return {
    totalFileCount: 0,
    jsonFileCount: 0,
    matchedPdfCount: 0,
    ignoredFileCount: 0
  };
}

function projectToForm(project) {
  return {
    id: project.id,
    topic_id: project.topic_id || "",
    theme: project.theme?.slug || project.theme?.name || "",
    title: project.title || "",
    title_en: project.title_en || "",
    summary: project.summary || "",
    problem_statement: project.problem_statement || "",
    clinical_endpoint: project.clinical_endpoint || "",
    existing_foundation: project.existing_foundation || "",
    stage: project.stage || "open_recruiting",
    tags: (project.tags || []).map((tag) => tag.name).join("，"),
    is_public: Boolean(project.is_public),
    documents: project.documents || [],
    documentUpload: emptyProjectDocumentUpload()
  };
}

function projectFormPayload(form) {
  return {
    theme: form.theme,
    title: form.title.trim(),
    title_en: form.title_en.trim(),
    summary: form.summary.trim(),
    problem_statement: form.problem_statement,
    clinical_endpoint: form.clinical_endpoint,
    existing_foundation: form.existing_foundation,
    stage: form.stage,
    tags: parseListInput(form.tags),
    is_public: Boolean(form.is_public)
  };
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", params: {}, fullPath: location.hash || "#/" };
  if (parts[0] === "project" && parts[1]) return { name: "project", params: { id: parts[1] }, fullPath: location.hash };
  if (parts[0] === "space") return { name: "space", params: { slug: parts[1] || "" }, fullPath: location.hash };
  const known = new Set(["home", "projects", "dashboard", "favorites", "admin", "login", "register", "password-reset", "password-change"]);
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

function numericProjectField(project, field) {
  const value = Number(project?.[field] || 0);
  return Number.isFinite(value) ? value : 0;
}

function projectUpdatedTime(project) {
  const value = new Date(project?.updated_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function projectTopicSortValue(project) {
  const raw = project?.topic_id || project?.topic_code || "";
  const match = String(raw).match(/\d+/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function addUniqueId(ids, id) {
  if (!id) return ids;
  return Array.from(new Set([...ids, id]));
}

function removeId(ids, id) {
  return ids.filter((item) => item !== id);
}

const DEFAULT_TOPIC_LOGO = "/topic_logos/MedicalAIPlatform.png";
const FEATURED_TOPIC_THEMES = [
  { slug: "anti-vegf", name: "AntiVEGF", keywords: ["vegf", "anti-vegf", "antivegf", "抗vegf"] },
  { slug: "rop", name: "ROP", keywords: ["rop", "早产儿视网膜病变"] },
  { slug: "yindaojing", name: "阴道镜", keywords: ["yindaojing", "阴道镜", "colposcopy"] }
];
const TOPIC_LOGO_RULES = [
  { file: "AntiVEGF_img.png", keywords: ["vegf", "anti-vegf", "antivegf", "抗vegf"] },
  { file: "ROP.png", keywords: ["rop", "早产儿视网膜病变"] },
  { file: "Yindaojing.png", keywords: ["yindaojing", "阴道镜", "colposcopy"] }
];

function topicThemeCards(themes = []) {
  const usedSlugs = new Set();
  const featuredCards = FEATURED_TOPIC_THEMES.map((preset) => {
    const matchedTheme = themes.find((theme) => !usedSlugs.has(theme.slug) && topicThemeMatchesPreset(theme, preset));
    if (matchedTheme) {
      usedSlugs.add(matchedTheme.slug);
      return matchedTheme;
    }
    return {
      slug: preset.slug,
      name: preset.name,
      synthetic: true
    };
  });
  const remainingThemes = themes.filter((theme) => !usedSlugs.has(theme.slug));
  return [...featuredCards, ...remainingThemes];
}

function topicThemeMatchesPreset(theme, preset) {
  const key = `${theme?.slug || ""} ${theme?.name || ""}`.toLowerCase();
  return preset.keywords.some((keyword) => key.includes(keyword.toLowerCase()));
}

function topicThemeCardStyle(theme = null) {
  const logoUrl = topicThemeLogoUrl(theme);
  return {
    backgroundImage: `linear-gradient(90deg, rgba(9, 38, 44, 0.78), rgba(9, 38, 44, 0.28)), url("${logoUrl}")`
  };
}

function topicThemeLogoUrl(theme = null) {
  const key = `${theme?.slug || ""} ${theme?.name || ""}`.toLowerCase();
  const matched = TOPIC_LOGO_RULES.find((rule) => rule.keywords.some((keyword) => key.includes(keyword.toLowerCase())));
  return matched ? `/topic_logos/${matched.file}` : DEFAULT_TOPIC_LOGO;
}

function topicCode(projectOrValue) {
  const value = typeof projectOrValue === "object" && projectOrValue !== null
    ? projectOrValue.topic_code || projectOrValue.topic_id
    : projectOrValue;
  if (typeof value === "string" && /^T\d{4}$/i.test(value.trim())) {
    return value.trim().toUpperCase();
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return "自动生成";
  if (number > 9999) return "编号超限";
  return `T${String(number).padStart(4, "0")}`;
}

function shortText(text, max = 100) {
  if (!text) return "暂无摘要。";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function auditActionLabel(entry) {
  return entry?.action_label || entry?.action || "未知动作";
}

function auditActorLabel(entry) {
  return entry?.actor?.uid || "系统";
}

function auditTargetLabel(entry) {
  if (!entry) return "-";
  const labels = {
    ProjectInterest: "申请参与",
    ProjectClaimIntent: "认领意向",
    SponsorIntent: "资助意向",
    ProjectTask: "任务",
    Contribution: "贡献",
    CreditLedger: "积分流水",
    User: "用户",
    Project: "课题",
    Theme: "主题",
    ThemeFile: "主题文件"
  };
  return `${labels[entry.target_type] || entry.target_type || "对象"} #${entry.target_id || "-"}`;
}

function auditSummary(entry) {
  return entry?.summary || "暂无摘要";
}

function formatAuditTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function roleCountEntries(teamStatus) {
  return Object.entries(teamStatus?.roles || {});
}

function visibleProjectRoleGroups(project) {
  return (project?.team_status?.visible_role_groups || []).filter((item) => Number(item.count) > 0);
}

const DEFAULT_PROJECT_RECRUITMENT_ROLES = [
  { key: "doctor", label: "医生", required: 1 },
  { key: "student", label: "学生", required: 1 },
  { key: "ai_phd_or_above", label: "AI博士及以上", required: 1 },
  { key: "leader", label: "项目负责人", required: 1 }
];

function projectRecruitmentText(project) {
  const explicitText = String(project?.team_requirements || "").trim();
  if (explicitText) return explicitText;
  return DEFAULT_PROJECT_RECRUITMENT_ROLES.map((role) => `${role.label} ${role.required}`).join("，");
}

function requiredTeamRoles(teamStatus) {
  const backendRequiredRoles = Array.isArray(teamStatus?.required_roles) ? teamStatus.required_roles : [];
  return DEFAULT_PROJECT_RECRUITMENT_ROLES.map((role) => {
    const count = projectRoleCount(teamStatus, role, backendRequiredRoles);
    return {
      ...role,
      count,
      ready: count >= role.required
    };
  });
}

function projectRoleCount(teamStatus, role, backendRequiredRoles) {
  const aliases = {
    doctor: ["doctor", "医生", "医生（医学指导）"],
    student: ["student", "学生", "学生（实验）"],
    ai_phd_or_above: ["ai_phd_or_above", "mentor", "大学老师", "博士毕业及以上", "博士毕业及以上（指导）"],
    leader: ["leader", "Leader", "项目负责人", "Leader（项目负责人）"]
  }[role.key] || [role.key];
  const matchedRequiredRole = backendRequiredRoles.find((item) => aliases.includes(item.key) || aliases.includes(item.label));
  if (matchedRequiredRole) return Number(matchedRequiredRole.count || 0);
  const matchedVisibleGroup = (teamStatus?.visible_role_groups || []).find((item) => aliases.includes(item.role_type) || aliases.includes(item.label));
  if (matchedVisibleGroup) return Number(matchedVisibleGroup.count || 0);
  const matchedRole = roleCountEntries(teamStatus).find(([key]) => aliases.includes(key));
  return matchedRole ? Number(matchedRole[1] || 0) : 0;
}

function projectSponsorCount(project) {
  return Number(project?.team_status?.sponsor_count ?? project?.sponsor_count ?? 0);
}

function projectFundingReady(project) {
  return projectSponsorCount(project) > 0;
}

function projectFundingLabel(project) {
  return projectFundingReady(project) ? "已获资助" : "待资助";
}

function projectTeamReady(project) {
  return requiredTeamRoles(project?.team_status).every((role) => role.ready);
}

function projectStartupReady(project) {
  return projectTeamReady(project) && projectFundingReady(project);
}

function projectStartupLabel(project) {
  if (projectStageValue(project) === "active") return "已启动";
  return projectStartupReady(project) ? "可启动" : "待启动";
}

function projectStartupText(project) {
  if (projectStartupReady(project)) return "最低团队已满足，并已获资助，达到自动启动条件";
  const missing = [];
  if (!projectTeamReady(project)) missing.push("成员未达最低要求");
  if (!projectFundingReady(project)) missing.push("待资助");
  return `待启动：${missing.join("，")}`;
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

function projectDetailHref(project) {
  return buildHash("project", { id: project?.id || "" });
}

function projectDocuments(project) {
  return Array.isArray(project?.documents) ? project.documents.filter((document) => document.path) : [];
}

function documentIcon(document) {
  const type = document?.doc_type || "";
  if (type === "pdf") return "picture_as_pdf";
  if (type === "html") return "language";
  if (type === "markdown") return "article";
  return "description";
}

function documentDisplayTitle(document) {
  return document?.title || document?.description || document?.path || "课题文档";
}

function documentHref(document) {
  const path = String(document?.path || "").trim();
  if (!path || /^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function documentTooltip(document) {
  const label = document?.doc_type_label || fileTypeLabel(document?.doc_type);
  const description = document?.description || "暂无内容说明";
  return `${label}：${description}`;
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

function draftProjectPayload(payload, options = {}) {
  const data = {
    ...payload,
    stage: "draft",
    is_public: false
  };
  if (options.autoNumber) {
    delete data.topic_id;
    delete data.id;
  }
  return data;
}

function publishProjectPayload(payload) {
  return {
    ...payload,
    stage: payload.stage && payload.stage !== "draft" ? payload.stage : "open_recruiting",
    is_public: true
  };
}

function uniqueSlugHint(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function findJsonImportDuplicates(payload) {
  const queries = [];
  if (payload.topic_id) queries.push({ topic_id: payload.topic_id, page_size: 3 });
  if (payload.title) queries.push({ q: payload.title, page_size: 3 });
  const byId = new Map();
  for (const query of queries) {
    const data = await api.adminProjects(query);
    for (const project of data.results || []) {
      byId.set(project.id, project);
    }
  }
  return Array.from(byId.values());
}

function duplicateWarningsForImport(payload, duplicates) {
  const warnings = [];
  const topicMatch = duplicates.find((project) => Number(project.topic_id) === Number(payload.topic_id));
  if (topicMatch) {
    warnings.push("同一课题编号将更新已有课题");
    if (topicMatch.is_public || topicMatch.stage !== "draft") {
      warnings.push("已有课题将更新为草稿并暂不公开");
    }
  }
  if (payload.title && duplicates.some((project) => project.title === payload.title && Number(project.topic_id) !== Number(payload.topic_id))) {
    warnings.push("标题可能重复");
  }
  return warnings;
}

function parseDocumentLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [docType = "other", title = "", path = ""] = line.split("|").map((part) => part.trim());
      return {
        doc_type: docType || "other",
        title,
        path
      };
    })
    .filter((item) => item.title || item.path);
}

function formatDocumentLines(documents) {
  if (!Array.isArray(documents)) return "";
  return documents
    .map((document) => [document.doc_type || "other", document.title || "", document.path || ""].join("|"))
    .filter((line) => line.replace(/\|/g, "").trim())
    .join("\n");
}

function parseListInput(text) {
  return String(text || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function roleCardsFor(capabilities) {
  const cards = [];
  if (capabilities.medical_review) cards.push({ title: "医学审核", body: "可参与临床价值判断、术语审核和数据解释。" });
  if (capabilities.technical_delivery) cards.push({ title: "技术实现", body: "可参与模型、RAG、Agent、多模态和工程实现。" });
  if (capabilities.statistical_design) cards.push({ title: "统计设计", body: "可参与样本量、终点、统计方案和结果解释。" });
  if (capabilities.funding_support) cards.push({ title: "资源支持", body: "可表达经费、算力、标注预算或专家咨询支持意向。" });
  if (capabilities.manage_projects) cards.push({ title: "内容管理", body: "可维护主题、课题、文件空间和 JSON 模板导入。" });
  if (!cards.length) cards.push({ title: "开放协作", body: "可关注、点赞、申请参与和认领开放课题。" });
  return cards;
}

createApp(App).mount("#app");
