import { createApp, computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { API_BASE, api, initCsrf } from "./api.js";
import { isPointInsideProfileHoverZone } from "./profileMenu.js";
import { normalizeProjectImportFiles, parseProjectJsonImport, projectImportFileKey, projectImportUploadFile, qualityCheckProjectPayload, selectedProjectJsonFiles, sortProjectImportRows, summarizeProjectImportFiles } from "./projectJsonImport.js";
import { latestRelease, releaseHistory, sectionEntries } from "./release.js";

const PAGE_SIZE = 9;
const ADMIN_PROJECT_PAGE_SIZE = 100;
const WORKSPACE_TABS = new Set(["overview", "favorites", "interactions", "applications", "uploads", "profile"]);
const ADMIN_TABS = new Set(["overview", "interactions", "contributions", "projects", "themes", "users", "system", "backup", "audit"]);
const FOLLOWABLE_STAGE_VALUES = new Set(["open_recruiting", "team_building", "active"]);
const RECRUITING_STAGE_VALUES = new Set(["open_recruiting", "team_building"]);
const TASK_MANAGEMENT_STAGE_VALUES = ["team_building", "active", "paused"];
const RELATION_STATUS_PRIORITY = { approved: 4, pending: 3, rejected: 2, withdrawn: 1 };
const WITHDRAWABLE_PARTICIPATION_STATUSES = new Set(["pending", "approved"]);
const WITHDRAWABLE_CLAIM_STATUSES = new Set(["approved"]);
const QUICK_SPONSOR_TYPES = ["labor_fee", "compute"];
const SPONSOR_POPOVER_WIDTH = 320;
const SPONSOR_POPOVER_HEIGHT = 420;
const SPONSOR_POPOVER_GAP = 10;
const SPONSOR_POPOVER_EDGE_GAP = 12;
const SELF_RELATION_PRIORITY = ["claim", "participation", "sponsor"];
const SELF_RELATION_LABELS = {
  claim: "我已认领",
  participation: "我已参与",
  sponsor: "我已资助"
};
const RELATION_STATUS_LABELS = {
  approved: "获批",
  pending: "申请中",
  rejected: "被拒绝",
  withdrawn: "已撤回"
};

function materialSymbolLigatureReady() {
  if (typeof document === "undefined" || !document.body) return true;
  const probe = document.createElement("span");
  probe.textContent = "thumb_up";
  Object.assign(probe.style, {
    position: "absolute",
    left: "-9999px",
    top: "-9999px",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "nowrap",
    fontFamily: '"Material Symbols Rounded"',
    fontSize: "24px",
    lineHeight: "1"
  });
  document.body.appendChild(probe);
  const ready = probe.getBoundingClientRect().width < 48;
  probe.remove();
  return ready;
}

function updateMaterialSymbolReadinessClass() {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.classList.toggle("material-symbols-ready", materialSymbolLigatureReady());
}

function installMaterialSymbolReadinessWatcher() {
  if (typeof document === "undefined") return;
  const check = () => updateMaterialSymbolReadinessClass();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check, { once: true });
  } else {
    check();
  }
  document.fonts?.ready?.then(check).catch(check);
}

installMaterialSymbolReadinessWatcher();

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sponsorPopoverPositionFromTrigger(trigger, popoverSize = {}) {
  const viewportWidth = window.innerWidth || SPONSOR_POPOVER_WIDTH + SPONSOR_POPOVER_EDGE_GAP * 2;
  const viewportHeight = window.innerHeight || SPONSOR_POPOVER_HEIGHT + SPONSOR_POPOVER_EDGE_GAP * 2;
  const preferredWidth = Number(popoverSize.width) || SPONSOR_POPOVER_WIDTH;
  const preferredHeight = Number(popoverSize.height) || SPONSOR_POPOVER_HEIGHT;
  const width = Math.min(preferredWidth, Math.max(0, viewportWidth - SPONSOR_POPOVER_EDGE_GAP * 2));
  const fallbackMaxHeight = Math.max(180, viewportHeight - SPONSOR_POPOVER_EDGE_GAP * 2);
  const rect = trigger?.getBoundingClientRect?.();

  if (!rect) {
    return { x: SPONSOR_POPOVER_EDGE_GAP, y: SPONSOR_POPOVER_EDGE_GAP, maxHeight: fallbackMaxHeight };
  }

  const x = clampNumber(
    rect.left + rect.width / 2 - width / 2,
    SPONSOR_POPOVER_EDGE_GAP,
    viewportWidth - width - SPONSOR_POPOVER_EDGE_GAP
  );
  const availableBelow = Math.max(0, viewportHeight - rect.bottom - SPONSOR_POPOVER_GAP - SPONSOR_POPOVER_EDGE_GAP);
  const availableAbove = Math.max(0, rect.top - SPONSOR_POPOVER_GAP - SPONSOR_POPOVER_EDGE_GAP);
  const shouldOpenAbove = availableBelow < Math.min(preferredHeight, 240) && availableAbove > availableBelow;
  const availableHeight = Math.max(180, shouldOpenAbove ? availableAbove : availableBelow);
  const renderedHeight = Math.min(preferredHeight, availableHeight);
  const y = shouldOpenAbove
    ? clampNumber(rect.top - SPONSOR_POPOVER_GAP - renderedHeight, SPONSOR_POPOVER_EDGE_GAP, viewportHeight - renderedHeight - SPONSOR_POPOVER_EDGE_GAP)
    : clampNumber(rect.bottom + SPONSOR_POPOVER_GAP, SPONSOR_POPOVER_EDGE_GAP, viewportHeight - Math.min(180, renderedHeight) - SPONSOR_POPOVER_EDGE_GAP);

  return { x, y, maxHeight: availableHeight };
}
const SIDEBAR_QR_ENTRIES = [
  { key: "admin-contact", label: "联系管理员", image: "", icon: "support_agent" },
  { key: "community", label: "加入社区", image: "", icon: "group_add" }
];
const FAQ_ENTRIES = [
  {
    question: "这个网站是做什么的？",
    answer: "OpenMedAILab 用来汇集真实临床问题、开放课题和医学 AI 协作需求，让临床、算法、数据和工程同学能围绕同一个课题快速找到合作入口。"
  },
  {
    question: "谁可以浏览和参与课题？",
    answer: "访客可以浏览公开课题；注册登录后可以收藏、点赞、参与、申请认领项目负责人、申请认领论文第一单位或提交资助意向。不同身份会看到不同功能。"
  },
  {
    question: "我如何参与一个课题？",
    answer: "在首页选择感兴趣的课题，点击“参与”并选择论文署名意向即可加入协作。参与不需要管理员审核，但需要当前积分足够覆盖启动后的 50 分消耗。"
  },
  {
    question: "认领项目负责人和普通参与有什么区别？",
    answer: "普通参与表示愿意加入课题协作；认领项目负责人表示愿意承担组队、分工、进度、积分分配和学术诚信职责，需要管理员审核并返回审核意见。"
  },
  {
    question: "课题是怎么组队的？",
    answer: "系统会根据课题需要的医生、学生、指导者和负责人数量统计已通过成员。登录后悬停组队角色，可以查看该角色下成员姓名和微信。"
  },
  {
    question: "我可以发布自己的课题吗？",
    answer: "可以。登录后进入“个人中心”-“我的上传”，填写课题结构化字段并上传课题说明 PDF。普通用户每天最多上传 10 个课题。"
  },
  {
    question: "课题说明 PDF 有什么用？",
    answer: "课题卡片中的“查看PDF”会在新标签页打开课题说明 PDF，用来承载详细背景、研究设计、数据需求或补充说明。"
  },
  {
    question: "如何资助一个课题？",
    answer: "在课题卡片点击“资助”提交算力、token 或劳务费资助意向。资助意向需要管理员审批，审批通过后会在个人空间和管理端记录状态。"
  },
  {
    question: "主题的数据集说明在哪里看？",
    answer: "首页选中某个主题后，主题标题如果绑定了数据集说明 PDF，点击标题会在新标签页打开对应说明文件。"
  },
  {
    question: "遇到登录、课题或协作问题怎么办？",
    answer: "如果管理员上传了联系管理员或社区二维码，会显示在本页底部。扫码后可联系平台管理员或加入社区沟通。"
  }
];

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
    authorship_intents: [],
    claim_types: [],
    sponsor_types: [],
    sidebar_qr_entries: [],
    platform_stats: { registered_user_count: 0, online_user_count: 0, online_window_seconds: 300 }
  },
  projects: [],
  pagination: {},
  hasMoreProjects: true,
  filters: {
    q: "",
    theme: "",
    tag: "",
    stage: "",
    sort: "recommended",
    page: 1,
    page_size: PAGE_SIZE
  },
  dashboard: null,
  workspaceTab: "overview",
  myProjects: [],
  myProjectPagination: {},
  myProjectQuota: { daily_limit: 10, used_today: 0, remaining: 10, unlimited: false },
  loadingMyProjects: false,
  myProjectFormOpen: false,
  myProjectForm: emptyProjectForm(),
  savingMyProject: false,
  deletingMyProjectId: null,
  favoriteProjectIds: [],
  themeDatasetFilesBySlug: {},
  likedProjectIds: [],
  unlikedProjectIds: [],
  participationProjectIds: [],
  participationRequestsByProjectId: {},
  claimRequestsByProjectId: {},
  paperClaimRequestsByProjectId: {},
  sponsorRequestsByProjectId: {},
  submittingParticipationProjectIds: [],
  withdrawingParticipationProjectIds: [],
  submittingLikeProjectIds: [],
  submittingLeadClaimProjectIds: [],
  withdrawingLeadClaimProjectIds: [],
  submittingPaperClaimProjectIds: [],
  withdrawingPaperClaimProjectIds: [],
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
  projectProgress: {
    loading: false,
    project: null,
    progressText: "",
    documents: [],
    timeline: [],
    discussions: [],
    discussionPagination: {},
    discussionForm: { content: "" },
    replyDrafts: {},
    submittingDiscussion: false,
    editingDiscussionId: null,
    deletingDiscussionId: null,
    moderatingDiscussionId: null
  },
  admin: {
    activeTab: "overview",
    overview: null,
    themes: [],
    themeSortDirty: false,
    themeSortSaving: false,
    themeSortBaselineIds: [],
    projects: [],
    projectPagination: {},
    projectFilters: { q: "", theme: "", page: 1, page_size: ADMIN_PROJECT_PAGE_SIZE },
    loadingProjects: false,
    updatingProjectStageId: null,
    selectedProjectIds: [],
    bulkArchivingProjects: false,
    bulkProjectActionSubmitting: false,
    bulkProjectStage: "open_recruiting",
    projectFormOpen: false,
    projectForm: emptyProjectForm(),
    themeFormOpen: false,
    themeForm: emptyThemeForm(),
    themeFiles: [],
    themeFileForm: emptyThemeFileForm(),
    users: [],
    userPagination: {},
    userFilters: { q: "", page: 1, page_size: 50 },
    loadingUsers: false,
    resettingUid: "",
    passwordResetResult: null,
    sidebarQrs: [],
    sidebarQrUploads: {},
    loadingSidebarQrs: false,
    interactions: [],
    interactionPagination: {},
    interactionFilters: { type: "", status: "pending", q: "", page: 1, page_size: 50 },
    loadingInteractions: false,
    reviewModal: {
      open: false,
      item: null,
      status: "approved",
      review_note: "",
      context: [],
      loadingContext: false,
      contextError: "",
      error: "",
      submitting: false
    },
    taskProjects: [],
    loadingTaskProjects: false,
    taskProjectFilters: { stage: "", q: "", page_size: 100 },
    taskProjectDetail: {
      open: false,
      loading: false,
      project: null,
      interactions: [],
      contributions: []
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
    backup: {
      exporting: false,
      restoring: false,
      file: null,
      inputKey: 0,
      result: null
    },
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
    participation: { authorship_intention: "contribution", message: "" },
    leadClaim: { message: "", error: "", previous_review_comment: "" },
    paperClaim: { claimed_unit_name: "", message: "", error: "", previous_review_comment: "" },
    sponsor: { sponsor_type: "compute", sponsor_types: [], note: "", show_more_types: false, previous_review_comment: "" },
    creditTransfer: { target_uid: "", amount: 50, reason: "" },
    profile: emptyProfileForm(),
    contribution: emptyContributionForm()
  },
  contributionModal: {
    open: false,
    project: null,
    relation: null,
    submitting: false
  },
  participationModal: {
    open: false,
    project: null,
    submitting: false
  },
  leadClaimModal: {
    open: false,
    project: null,
    submitting: false
  },
  paperClaimModal: {
    open: false,
    project: null,
    submitting: false
  },
  sponsorModal: {
    open: false,
    project: null,
    submitting: false,
    x: 0,
    y: 0,
    maxHeight: SPONSOR_POPOVER_HEIGHT,
    returnFocus: null
  },
  claimReasonTooltip: {
    visible: false,
    text: "",
    x: 0,
    y: 0
  },
  contactHoverCard: {
    visible: false,
    x: 0,
    y: 0,
    title: "",
    members: []
  },
  formState: {
    registerSubmitting: false,
    registerErrors: {},
    passwordChangeSubmitting: false,
    passwordChangeErrors: {},
    creditTransferSubmitting: false
  }
});

let contactHoverHideTimer = null;

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
        { name: "faq", label: "常见问答" }
      ];
      if (state.user) {
        items.push({ name: "dashboard", label: "个人中心" });
      }
      if (can("view_admin_console")) items.push({ name: "admin", label: "管理" });
      return items;
    });
    const selectedTheme = computed(() => state.meta.themes.find((theme) => theme.slug === state.filters.theme) || null);
    const homeThemeCards = computed(() => topicThemeCards(state.meta.themes));
    const homeThemeRowThemes = computed(() => homeThemeCards.value);
    const homeThemeRowColumnCount = computed(() => homeThemeRowThemes.value.length + 1);
    const selectedThemeDatasetFile = computed(() => {
      const slug = selectedTheme.value?.slug;
      return slug ? state.themeDatasetFilesBySlug[slug] || null : null;
    });
    const selectedThemeDatasetPdfHref = computed(() => {
      const file = selectedThemeDatasetFile.value;
      return file?.detail_pdf_path ? themeFileDetailPdfHref(file) : "";
    });
    const platformStats = computed(() => state.meta.platform_stats || { registered_user_count: 0, online_user_count: 0, online_window_seconds: 300 });
    const sidebarQrEntries = computed(() => mergeSidebarQrEntries(state.meta.sidebar_qr_entries || []));
    const faqQrEntries = computed(() => sidebarQrEntries.value.filter((entry) => entry.has_image && sidebarQrImageSrc(entry)));
    const sponsorTypeOptions = computed(() => preferredSponsorTypes(state.meta.sponsor_types || []));
    const quickSponsorTypeOptions = computed(() => sponsorOptionsByValue(state.meta.sponsor_types || [], QUICK_SPONSOR_TYPES));
    const moreSponsorTypeOptions = computed(() => sponsorOptionsByValue(state.meta.sponsor_types || [], ["token"]));
    const authorshipIntentOptions = computed(() => state.meta.authorship_intents?.length ? state.meta.authorship_intents : [
      { value: "no_interest", label: "对署名没有兴趣" },
      { value: "contribution", label: "普通参与，按贡献" },
      { value: "co_first_or_corresponding", label: "主要参与，共同一作/共同通讯" },
      { value: "first_non_primary_unit", label: "主要参与，一作非一单位可" },
      { value: "first_primary_unit", label: "主要参与，一作一单位" }
    ]);
    const roleCards = computed(() => roleCardsFor(capabilities.value));
    const favoriteProjects = computed(() => (state.dashboard?.follows || []).map((item) => item.project));
    const myProjectTasks = computed(() => buildMyProjectTasks(state.dashboard));
    const myApplicationRows = computed(() => buildMyApplicationRows(state.dashboard));
    const adminInteractionRows = computed(() => buildAdminInteractionRows(state.admin.interactions));
    const workspaceOverviewCards = computed(() => {
      const dashboard = state.dashboard || {};
      const approvedCount = [
        ...(dashboard.interests || []),
        ...(dashboard.claims || []),
        ...(dashboard.sponsors || [])
      ].filter((item) => item.status === "approved").length;
      const pendingApplicationCount = myApplicationRows.value.filter((item) => item.status === "pending").length;
      return [
        { title: "关注课题", value: `${(dashboard.follows || []).length} 个`, tab: "favorites" },
        { title: "我的任务", value: `${myProjectTasks.value.length} 个`, tab: "interactions" },
        { title: "我的申请", value: `${pendingApplicationCount} 个待处理`, tab: "applications" },
        { title: "任务结果", value: `${(dashboard.contributions || []).length} 条`, tab: "interactions" },
        { title: "已通过协作", value: `${approvedCount} 条`, tab: "interactions" },
        { title: "我的上传", value: `${state.myProjectPagination.total_count || state.myProjects.length} 个`, tab: "uploads" },
        { title: "个人资料", value: state.user?.profile?.role_type_label || "去完善", tab: "profile" }
      ];
    });
    const adminOverviewCards = computed(() => [
      { title: "用户", value: state.admin.overview?.counts?.users || 0, tab: "users" },
      { title: "课题", value: state.admin.overview?.counts?.projects || 0, tab: "projects" },
      { title: "待审申请", value: state.admin.overview?.counts?.pending_interactions || 0, tab: "interactions" },
      { title: "任务结果", value: state.admin.overview?.counts?.submitted_contributions || 0, tab: "contributions" },
      { title: "主题管理", value: state.admin.overview?.counts?.themes || 0, tab: "themes" },
      { title: "系统入口", value: "二维码", tab: "system" },
      { title: "备份恢复", value: "ZIP", tab: "backup" },
      { title: "审计日志", value: state.admin.overview?.counts?.audit_logs || 0, tab: "audit" }
    ]);
    const projectProgressDocuments = computed(() => state.projectProgress.documents || []);
    const projectProgressTimelineItems = computed(() => state.projectProgress.timeline || []);
    const releaseLatest = computed(() => latestRelease(state.meta.release));
    const releaseHistoryItems = computed(() => releaseHistory(state.meta.release));
    const profilePointer = { x: 0, y: 0 };
    const jsonImportJsonFilesInput = ref(null);
    const jsonImportDirectoryInput = ref(null);
    const jsonImportMixedFilesInput = ref(null);
    const confirmDialogRef = ref(null);
    const participationModalRef = ref(null);
    const leadClaimModalRef = ref(null);
    const paperClaimModalRef = ref(null);
    const sponsorModalRef = ref(null);
    const reviewModalRef = ref(null);
    const releaseModalRef = ref(null);
    const myProjectFormRef = ref(null);
    const adminProjectFormRef = ref(null);
    const adminThemeFormRef = ref(null);
    const contributionModalRef = ref(null);
    const taskProjectDetailRef = ref(null);
    let confirmDialogResolver = null;
    let lastModalTrigger = null;
    const modalOpen = computed(() => Boolean(
      state.releaseModalOpen ||
      state.confirmDialog.open ||
      state.admin.themeFormOpen ||
      state.admin.projectFormOpen ||
      state.myProjectFormOpen ||
      state.admin.taskProjectDetail.open ||
      state.contributionModal.open ||
      state.participationModal.open ||
      state.leadClaimModal.open ||
      state.paperClaimModal.open ||
      state.sponsorModal.open ||
      state.admin.reviewModal.open
    ));

    onMounted(async () => {
      window.addEventListener("hashchange", handleRouteChange);
      window.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("keydown", handleKeydown);
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("resize", handleSponsorPopoverViewportChange);
      await boot();
    });

    onBeforeUnmount(() => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", handleSponsorPopoverViewportChange);
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

    watch(
      () => state.filters.theme,
      (slug) => {
        if (slug) loadSelectedThemeDatasetFile(slug);
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
      if (state.route.name === "dashboard") {
        await loadDashboard();
      }
      if (state.route.name === "project") {
        await loadProjectProgress();
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
      return { ...state.filters };
    }

    function sortProjectsForCurrentFilter(projects = []) {
      const rows = [...projects];
      if (state.filters.sort === "recommended") {
        return rows.sort((a, b) => (
          compareSelfRelation(a, b) ||
          projectEngagementCount(b) - projectEngagementCount(a) ||
          numericProjectField(b, "score_count") - numericProjectField(a, "score_count") ||
          numericProjectField(b, "follow_count") - numericProjectField(a, "follow_count") ||
          projectTopicSortValue(a) - projectTopicSortValue(b)
        ));
      }
      if (state.filters.sort === "updated") {
        return rows.sort((a, b) => projectUpdatedTime(b) - projectUpdatedTime(a) || projectTopicSortValue(b) - projectTopicSortValue(a));
      }
      if (state.filters.sort === "newest") {
        return rows.sort((a, b) => projectTopicSortValue(b) - projectTopicSortValue(a));
      }
      if (state.filters.sort === "likes") {
        return rows.sort((a, b) => (
          numericProjectField(b, "score_count") - numericProjectField(a, "score_count") ||
          numericProjectField(b, "follow_count") - numericProjectField(a, "follow_count") ||
          projectUpdatedTime(b) - projectUpdatedTime(a) ||
          projectTopicSortValue(a) - projectTopicSortValue(b)
        ));
      }
      if (state.filters.sort === "follows") {
        return rows.sort((a, b) => (
          numericProjectField(b, "follow_count") - numericProjectField(a, "follow_count") ||
          numericProjectField(b, "score_count") - numericProjectField(a, "score_count") ||
          projectUpdatedTime(b) - projectUpdatedTime(a) ||
          projectTopicSortValue(a) - projectTopicSortValue(b)
        ));
      }
      return rows.sort((a, b) => projectTopicSortValue(a) - projectTopicSortValue(b));
    }

    async function loadMoreProjects() {
      if (!state.hasMoreProjects || state.loadingMore || state.loading) return;
      state.filters.page += 1;
      await loadProjects();
    }

    async function loadProjectProgress() {
      const projectId = Number(state.route.params.id);
      if (!projectId) {
        navigate("home");
        return;
      }
      state.projectProgress.loading = true;
      state.loading = true;
      try {
        const [progress, discussions] = await Promise.all([
          api.projectProgress(projectId),
          api.projectDiscussions(projectId, { page_size: 50 })
        ]);
        state.projectProgress.project = progress.project;
        applyProjectViewerState(state.projectProgress.project);
        state.projectProgress.progressText = progress.progress_text || "";
        state.projectProgress.documents = progress.documents || [];
        state.projectProgress.timeline = progress.timeline || [];
        state.projectProgress.discussions = discussions.results || [];
        state.projectProgress.discussionPagination = discussions.pagination || {};
        state.projectProgress.replyDrafts = {};
      } catch (error) {
        showToast(error.message || "课题进度读取失败");
        state.projectProgress.project = null;
        state.projectProgress.documents = [];
        state.projectProgress.timeline = [];
        state.projectProgress.discussions = [];
      } finally {
        state.projectProgress.loading = false;
        state.loading = false;
      }
    }

    async function loadProjectDiscussions() {
      const projectId = state.projectProgress.project?.id || Number(state.route.params.id);
      if (!projectId) return;
      try {
        const data = await api.projectDiscussions(projectId, { page_size: 50 });
        state.projectProgress.discussions = data.results || [];
        state.projectProgress.discussionPagination = data.pagination || {};
      } catch (error) {
        showToast(error.message || "讨论区读取失败");
      }
    }

    async function submitProjectDiscussion(parent = null) {
      const projectId = state.projectProgress.project?.id || Number(state.route.params.id);
      if (!projectId) return;
      if (!ensureLogin()) return;
      const content = parent
        ? String(state.projectProgress.replyDrafts[parent.id] || "").trim()
        : String(state.projectProgress.discussionForm.content || "").trim();
      if (!content) {
        showToast("请先输入讨论内容");
        return;
      }
      state.projectProgress.submittingDiscussion = true;
      try {
        await api.createProjectDiscussion(projectId, {
          content,
          parent_id: parent?.id || null
        });
        if (parent) {
          state.projectProgress.replyDrafts[parent.id] = "";
        } else {
          state.projectProgress.discussionForm.content = "";
        }
        showToast(parent ? "回复已发布" : "讨论已发布");
        await loadProjectDiscussions();
      } catch (error) {
        showToast(error.message || "讨论发布失败");
      } finally {
        state.projectProgress.submittingDiscussion = false;
      }
    }

    async function updateProjectDiscussion(discussion) {
      if (!discussion?.id || !canManageDiscussion(discussion)) return;
      const content = window.prompt("编辑讨论内容", discussion.content || "");
      if (content === null) return;
      const normalized = String(content || "").trim();
      if (!normalized) {
        showToast("讨论内容不能为空");
        return;
      }
      state.projectProgress.editingDiscussionId = discussion.id;
      try {
        await api.updateProjectDiscussion(discussion.id, { content: normalized });
        showToast("讨论已更新");
        await loadProjectDiscussions();
      } catch (error) {
        showToast(error.message || "讨论更新失败");
      } finally {
        state.projectProgress.editingDiscussionId = null;
      }
    }

    async function deleteProjectDiscussion(discussion) {
      if (!discussion?.id || !canManageDiscussion(discussion)) return;
      const confirmed = await openConfirmDialog({
        title: "确认删除讨论",
        message: "删除后这条讨论不会在课题讨论区公开展示。",
        confirmText: "删除讨论",
        tone: "danger"
      });
      if (!confirmed) return;
      state.projectProgress.deletingDiscussionId = discussion.id;
      try {
        await api.deleteProjectDiscussion(discussion.id);
        showToast("讨论已删除");
        await loadProjectDiscussions();
      } catch (error) {
        showToast(error.message || "讨论删除失败");
      } finally {
        state.projectProgress.deletingDiscussionId = null;
      }
    }

    async function moderateProjectDiscussion(discussion, status = "hidden") {
      if (!discussion?.id || !can("manage_projects")) return;
      state.projectProgress.moderatingDiscussionId = discussion.id;
      try {
        await api.moderateProjectDiscussion(discussion.id, {
          status,
          moderation_reason: status === "hidden" ? "管理员隐藏" : ""
        });
        showToast(status === "visible" ? "讨论已恢复" : "讨论已隐藏");
        await loadProjectDiscussions();
      } catch (error) {
        showToast(error.message || "讨论处理失败");
      } finally {
        state.projectProgress.moderatingDiscussionId = null;
      }
    }

    function canManageDiscussion(discussion) {
      const uid = state.user?.profile?.uid;
      return Boolean(uid && discussion?.author?.uid === uid) || can("manage_projects");
    }

    async function loadDashboard() {
      if (!state.user) {
        navigate("login");
        return;
      }
      state.loading = true;
      try {
        const [dashboardData, myProjectData] = await Promise.all([
          api.dashboard(),
          api.meProjects({ page_size: 100 })
        ]);
        syncDashboard(dashboardData);
        syncMyProjects(myProjectData);
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
      state.claimRequestsByProjectId = claimRequestsByProject(data.claims || [], "leader");
      state.paperClaimRequestsByProjectId = claimRequestsByProject(data.claims || [], "paper_first_unit");
      state.sponsorRequestsByProjectId = sponsorRequestsByProject(data.sponsors || []);
      state.participationProjectIds = Object.values(state.participationRequestsByProjectId)
        .filter((item) => isActiveParticipationRequest(item))
        .map((item) => item.project.id);
      state.favoritesLoaded = true;
    }

    function syncMyProjects(data) {
      state.myProjects = data?.results || [];
      state.myProjectPagination = data?.pagination || {};
      state.myProjectQuota = {
        daily_limit: data?.quota?.daily_limit ?? 10,
        used_today: data?.quota?.used_today ?? 0,
        remaining: data?.quota?.remaining ?? 10,
        unlimited: Boolean(data?.quota?.unlimited)
      };
    }

    async function loadMyProjects({ reset = false } = {}) {
      if (!state.user) {
        navigate("login");
        return;
      }
      state.loadingMyProjects = true;
      try {
        const page = reset ? 1 : state.myProjectPagination.page || 1;
        const data = await api.meProjects({ page, page_size: 100 });
        syncMyProjects(data);
      } catch (error) {
        showToast(error.message || "我的上传课题读取失败");
      } finally {
        state.loadingMyProjects = false;
      }
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

    function claimRequestsByProject(claims = [], claimType = "leader") {
      const requests = {};
      claims
        .filter((item) => item.claim_type === claimType)
        .forEach((item) => {
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
        const sponsorType = item.sponsor_type || "unknown";
        const projectRequests = requests[projectId] || {};
        const current = projectRequests[sponsorType];
        if (!current || participationRequestSortValue(item) > participationRequestSortValue(current)) {
          requests[projectId] = {
            ...projectRequests,
            [sponsorType]: item
          };
        }
      });
      return requests;
    }

    function syncSponsorRequestsFromViewerState(project) {
      const projectId = project?.id;
      const viewerRequests = project?.viewer_state?.sponsor_requests;
      if (!projectId || !Array.isArray(viewerRequests)) return;
      const existingEntry = state.sponsorRequestsByProjectId[projectId];
      const existingByType = existingEntry?.sponsor_type
        ? { [existingEntry.sponsor_type]: existingEntry }
        : existingEntry || {};
      const nextByType = {};
      Object.entries(existingByType).forEach(([sponsorType, request]) => {
        if (!isActiveParticipationRequest(request)) {
          nextByType[sponsorType] = request;
        }
      });
      viewerRequests.forEach((request) => {
        const sponsorType = request?.sponsor_type;
        if (!sponsorType) return;
        nextByType[sponsorType] = {
          ...request,
          project: request.project || project
        };
      });
      const nextState = { ...state.sponsorRequestsByProjectId };
      if (Object.keys(nextByType).length) {
        nextState[projectId] = nextByType;
      } else {
        delete nextState[projectId];
      }
      state.sponsorRequestsByProjectId = nextState;
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

    function buildMyApplicationRows(dashboard) {
      if (!dashboard) return [];
      const rows = [];
      const pushRows = (collection, type, typeLabel, subtypeKey, subtypeLabelKey, messageKey = "message") => {
        for (const item of collection || []) {
          rows.push({
            ...item,
            type,
            type_label: typeLabel,
            subtype: item[subtypeKey] || "",
            subtype_label: item[subtypeLabelKey] || item[subtypeKey] || "",
            message: item[messageKey] || item.message || item.note || ""
          });
        }
      };
      pushRows(dashboard.interests, "interest", "参与申请", "role", "role_label");
      pushRows(dashboard.claims, "claim", "认领申请", "claim_type", "claim_type_label");
      pushRows(dashboard.sponsors, "sponsor", "资助意向", "sponsor_type", "sponsor_type_label", "note");
      return rows.sort((a, b) => {
        const statusDiff = applicationStatusRank(a.status) - applicationStatusRank(b.status);
        if (statusDiff) return statusDiff;
        return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
      });
    }

    function applicationStatusRank(status) {
      return { pending: 0, rejected: 1, approved: 2, withdrawn: 3 }[status] ?? 4;
    }

    function applicationTitle(row) {
      return `${row?.type_label || "申请"}${row?.subtype_label ? ` · ${row.subtype_label}` : ""}`;
    }

    function applicationReviewLine(row) {
      const parts = [];
      if (row?.review_comment) parts.push(`审核意见：${row.review_comment}`);
      if (row?.reviewed_by?.uid) parts.push(`审核人：${row.reviewed_by.uid}`);
      if (row?.reviewed_at) parts.push(`审核时间：${formatAuditTime(row.reviewed_at)}`);
      return parts.join(" · ");
    }

    function applicationMessageLine(row) {
      if (!row) return "";
      if (row.claimed_unit_name) return `拟认领第一单位：${row.claimed_unit_name}`;
      if (row.message) return row.message;
      if (row.note) return row.note;
      return topicCode(row.project);
    }

    function canWithdrawApplication(row) {
      if (!row?.id) return false;
      if (row.type === "claim") return false;
      return ["pending", "approved"].includes(row.status);
    }

    function applicationActionLabel(row) {
      if (canWithdrawApplication(row)) return row.type === "sponsor" ? "撤回资助意向" : "取消参与";
      if (row?.status === "rejected") return row.type === "sponsor" ? "重新提交资助" : "重新提交申请";
      return "查看课题";
    }

    async function handleApplicationAction(row, event = null) {
      if (!row) return;
      if (canWithdrawApplication(row)) {
        await withdrawInteraction(row.type, row);
        return;
      }
      if (row.status === "rejected") {
        if (row.type === "claim" && row.claim_type === "leader") {
          openLeadClaimModal(row.project, event, row);
          return;
        }
        if (row.type === "claim" && row.claim_type === "paper_first_unit") {
          openPaperClaimModal(row.project, event, row);
          return;
        }
        if (row.type === "sponsor") {
          await submitSponsor(row.project, event, {
            preselectedTypes: [row.sponsor_type].filter(Boolean),
            note: row.note || "",
            previousReviewComment: row.review_comment || ""
          });
          return;
        }
      }
      navigate("project", { id: row.project?.id });
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
      return (task?.relations || []).filter((relation) => relation.status === "approved" && relation.relation_type !== "sponsor");
    }

    function canSubmitProjectTask(task) {
      return task?.project?.stage === "active" && approvedTaskRelations(task).length > 0;
    }

    function taskSubmitHint(task) {
      if (canSubmitProjectTask(task)) return "";
      if (!approvedTaskRelations(task).length) {
        const nonSponsorRelations = (task?.relations || []).filter((relation) => relation.relation_type !== "sponsor");
        if (nonSponsorRelations.some((relation) => relation.status === "pending") || task?.status === "pending") {
          return "参与或认领状态待确认，获批后可提交";
        }
        if (nonSponsorRelations.some((relation) => relation.status === "rejected") || task?.status === "rejected") {
          return "参与或认领未通过，不能提交";
        }
        if (nonSponsorRelations.some((relation) => relation.status === "withdrawn") || task?.status === "withdrawn") {
          return "参与或认领已撤回，不能提交";
        }
        if (task?.relations?.some((relation) => relation.relation_type === "sponsor")) return "资助意向不产生任务结果提交权限";
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
        .map((relation) => {
          const extras = [];
          if (relation.authorship_intention_label) extras.push(`署名意向：${relation.authorship_intention_label}`);
          if (relation.review_comment) extras.push(`审核意见：${relation.review_comment}`);
          const suffix = extras.length ? ` · ${extras.join(" · ")}` : "";
          return `${relation.relation_type_label}${relation.subtype_label ? `：${relation.subtype_label}` : ""}（${relation.status_label || myTaskStatusLabel({ status: relation.status })}${suffix}）`;
        })
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
      if (tab === "uploads") {
        loadMyProjects({ reset: true });
      }
    }

    function myProjectQuotaText() {
      const quota = state.myProjectQuota || {};
      if (quota.unlimited) return "管理员账号不受每日上传数量限制。";
      return `今日已上传 ${quota.used_today || 0}/${quota.daily_limit || 10} 个，剩余 ${quota.remaining ?? 0} 个。`;
    }

    function canCreateMyProject() {
      const quota = state.myProjectQuota || {};
      return quota.unlimited || Number(quota.remaining ?? 0) > 0;
    }

    function canEditMyProject(project) {
      return project?.stage !== "archived";
    }

    function canDeleteMyProject(project) {
      return project?.stage !== "archived";
    }

    function myProjectStageEditable(project) {
      return !project?.id || ["draft", "open_recruiting"].includes(project?.stage);
    }

    function newMyProject() {
      closeMutuallyExclusiveModals("myProjectForm");
      state.myProjectForm = emptyProjectForm();
      state.myProjectFormOpen = true;
      openModalWithFocus(myProjectFormRef);
    }

    async function editMyProject(project) {
      if (!project?.id) return;
      try {
        closeMutuallyExclusiveModals("myProjectForm");
        const detail = await api.project(project.id).catch(() => null);
        state.myProjectForm = projectToForm(detail || project);
        state.myProjectFormOpen = true;
        openModalWithFocus(myProjectFormRef);
      } catch (error) {
        showToast(error.message || "课题读取失败");
      }
    }

    function closeMyProjectForm() {
      state.myProjectFormOpen = false;
      state.myProjectForm = emptyProjectForm();
      restoreLastModalTrigger();
    }

    async function saveMyProject({ publish = false } = {}) {
      if (!state.user || state.savingMyProject) return;
      try {
        const formPayload = projectFormPayload(state.myProjectForm);
        if (!formPayload.title || !formPayload.theme) {
          showToast("标题和主题不能为空");
          return;
        }
        const quality = qualityCheckProjectPayload(formPayload);
        if (quality.errors.length) {
          showToast(quality.errors.join("；"));
          return;
        }
        if (publish && quality.warnings.length) {
          const confirmed = await openConfirmDialog({
            title: "确认发布课题",
            message: `这些建议字段仍待补充：${quality.warnings.join("、")}。确认发布吗？`,
            confirmText: "继续发布"
          });
          if (!confirmed) return;
        }
        const stageEditable = myProjectStageEditable(state.myProjectForm);
        const payload = stageEditable
          ? (publish ? publishProjectPayload(formPayload) : draftProjectPayload(formPayload))
          : lockedStageProjectPayload(formPayload);
        state.savingMyProject = true;
        let savedProject = null;
        const hasPendingPdf = Boolean(state.myProjectForm.documentUpload.file);
        const wasNewProject = !state.myProjectForm.id;
        if (!wasNewProject) {
          savedProject = await api.updateProject(state.myProjectForm.id, payload);
        } else {
          if (!canCreateMyProject()) {
            showToast("今日上传课题数量已达上限");
            return;
          }
          const createdProject = await api.createProject(draftProjectPayload(formPayload));
          savedProject = publish
            ? await api.updateProject(createdProject.id, publishProjectPayload(formPayload))
            : createdProject;
          state.myProjectForm.id = savedProject.id;
        }
        const baseMessage = wasNewProject ? (publish ? "课题已创建并发布" : "课题草稿已创建") : (publish ? "课题已发布" : "课题已保存");
        if (hasPendingPdf) {
          try {
            await uploadProjectDocumentForForm(state.myProjectForm, api.uploadProjectDocuments, {
              projectId: savedProject.id,
              silent: true
            });
          } catch (error) {
            showToast(`${baseMessage}，但PDF上传失败：${error.message || "请重试"}`);
            await Promise.all([
              loadMyProjects({ reset: true }),
              loadProjects({ reset: true }).catch(() => null),
              loadDashboard().catch(() => null)
            ]);
            return;
          }
        }
        showToast(`${baseMessage}${hasPendingPdf ? "，PDF已上传" : ""}`);
        closeMyProjectForm();
        await Promise.all([
          loadMyProjects({ reset: true }),
          loadProjects({ reset: true }).catch(() => null),
          loadDashboard().catch(() => null)
        ]);
      } catch (error) {
        showToast(error.message || "课题保存失败");
      } finally {
        state.savingMyProject = false;
      }
    }

    async function deleteMyProject(project) {
      if (!project?.id || state.deletingMyProjectId) return;
      const confirmed = await openConfirmDialog({
        title: "确认删除课题",
        message: `确认删除「${project.title}」吗？删除后公开课题库不可见，但会保留审计记录。`,
        confirmText: "删除课题",
        tone: "danger"
      });
      if (!confirmed) return;
      state.deletingMyProjectId = project.id;
      try {
        await api.deleteProject(project.id);
        showToast("课题已删除");
        await Promise.all([
          loadMyProjects({ reset: true }),
          loadProjects({ reset: true }).catch(() => null),
          loadDashboard().catch(() => null)
        ]);
      } catch (error) {
        showToast(error.message || "课题删除失败");
      } finally {
        state.deletingMyProjectId = null;
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

    async function submitCreditTransfer() {
      if (!state.user || state.formState.creditTransferSubmitting) return;
      const payload = {
        target_uid: String(state.forms.creditTransfer.target_uid || "").trim(),
        amount: Number(state.forms.creditTransfer.amount || 0),
        reason: String(state.forms.creditTransfer.reason || "").trim()
      };
      if (!payload.target_uid) {
        showToast("请输入接收人的 UID");
        return;
      }
      if (payload.amount < 1 || payload.amount > 50) {
        showToast("单次转赠积分需在 1 到 50 之间");
        return;
      }
      state.formState.creditTransferSubmitting = true;
      try {
        const result = await api.transferCredits(payload);
        if (state.user.profile) {
          state.user.profile.credit_balance = result.balance;
        }
        if (state.dashboard) {
          state.dashboard.user = state.user;
          state.dashboard.credits = [result.sent, ...(state.dashboard.credits || [])].filter(Boolean).slice(0, 50);
        }
        state.forms.creditTransfer = { target_uid: "", amount: 50, reason: "" };
        showToast("积分已转赠");
      } catch (error) {
        showToast(error.message || "积分转赠失败");
      } finally {
        state.formState.creditTransferSubmitting = false;
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
      openModalWithFocus(contributionModalRef);
    }

    function closeContributionModal() {
      state.contributionModal.open = false;
      state.contributionModal.project = null;
      state.contributionModal.relation = null;
      state.forms.contribution = emptyContributionForm();
      restoreLastModalTrigger();
    }

    async function submitContribution() {
      if (!state.user) return;
      try {
        const form = state.forms.contribution;
        const payload = {
          project_id: Number(form.project_id),
          task_id: form.task_id ? Number(form.task_id) : null,
          title: form.title,
          result_type: form.result_type || "stage",
          description: form.description
        };
        if (!payload.project_id || !payload.title.trim()) {
          showToast("任务结果需要选择课题并填写标题");
          return;
        }
        if (form.documentFile && !contributionDocumentFileAllowed(form.documentFile)) {
          showToast("任务结果文档只支持 PDF 或 Markdown");
          return;
        }
        state.contributionModal.submitting = true;
        if (form.documentFile) {
          const formData = new FormData();
          formData.append("project_id", String(payload.project_id));
          if (payload.task_id) formData.append("task_id", String(payload.task_id));
          formData.append("title", payload.title);
          formData.append("result_type", payload.result_type);
          formData.append("description", payload.description || "");
          formData.append("file", form.documentFile);
          await api.createMeContributionWithFile(formData);
        } else {
          await api.createMeContribution(payload);
        }
        closeContributionModal();
        showToast("任务结果已提交");
        await loadDashboard();
      } catch (error) {
        showToast(error.message || "任务结果提交失败");
      } finally {
        state.contributionModal.submitting = false;
      }
    }

    function setContributionFile(event) {
      const file = event.target.files?.[0] || null;
      state.forms.contribution.documentFile = file;
      if (file && !contributionDocumentFileAllowed(file)) {
        showToast("任务结果文档只支持 PDF 或 Markdown");
      }
    }

    function clearContributionFile() {
      state.forms.contribution.documentFile = null;
      state.forms.contribution.inputKey += 1;
    }

    async function loadAdmin() {
      if (!can("view_admin_console")) return;
      state.loading = true;
      try {
        const [overview, themes] = await Promise.all([api.adminOverview(), api.adminThemes()]);
        state.admin.overview = overview;
        resetThemeSortState(themes.results || []);
        await loadActiveAdminTab();
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadAdminOverview() {
      if (!can("view_admin_console")) return;
      state.admin.overview = await api.adminOverview();
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
      if (state.admin.activeTab === "system") await loadSidebarQrs();
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
        const data = await fetchAllAdminProjectPages(state.admin.projectFilters);
        state.admin.projects = data.results;
        const loadedIds = new Set(state.admin.projects.map((item) => item.id));
        state.admin.selectedProjectIds = state.admin.selectedProjectIds.filter((id) => loadedIds.has(id));
        state.admin.projectPagination = data.pagination;
        state.admin.projectFilters.page = 1;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.admin.loadingProjects = false;
      }
    }

    async function searchAdminProjects() {
      await loadAdminProjects({ reset: true });
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
      if (slug) loadSelectedThemeDatasetFile(slug);
      await applyFilters();
    }

    async function loadSelectedThemeDatasetFile(slug = "") {
      const normalizedSlug = String(slug || "").trim();
      if (!normalizedSlug || Object.prototype.hasOwnProperty.call(state.themeDatasetFilesBySlug, normalizedSlug)) return;
      try {
        const data = await api.themeDatasets(normalizedSlug);
        const files = (data.sections || []).flatMap((section) => section.files || []);
        const file = files.find((item) => item.detail_pdf_path) || null;
        state.themeDatasetFilesBySlug = {
          ...state.themeDatasetFilesBySlug,
          [normalizedSlug]: file
        };
      } catch (error) {
        state.themeDatasetFilesBySlug = {
          ...state.themeDatasetFilesBySlug,
          [normalizedSlug]: null
        };
      }
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
      state.claimRequestsByProjectId = {};
      state.paperClaimRequestsByProjectId = {};
      state.sponsorRequestsByProjectId = {};
      state.myProjects = [];
      state.myProjectPagination = {};
      state.myProjectQuota = { daily_limit: 10, used_today: 0, remaining: 10, unlimited: false };
      state.myProjectFormOpen = false;
      state.myProjectForm = emptyProjectForm();
      state.submittingParticipationProjectIds = [];
      state.withdrawingParticipationProjectIds = [];
      state.submittingLikeProjectIds = [];
      state.submittingLeadClaimProjectIds = [];
      state.withdrawingLeadClaimProjectIds = [];
      state.submittingPaperClaimProjectIds = [];
      state.withdrawingPaperClaimProjectIds = [];
      state.submittingSponsorProjectIds = [];
      state.withdrawingSponsorProjectIds = [];
      closeLeadClaimModal(true);
      closePaperClaimModal(true);
      closeSponsorModal(true);
      closeReviewModal(true);
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

    function canFollowProject(project) {
      return FOLLOWABLE_STAGE_VALUES.has(projectStageValue(project));
    }

    function shouldShowFollowButton(project) {
      return canFollowProject(project) || isProjectFollowing(project);
    }

    function canRecruitProject(project) {
      return RECRUITING_STAGE_VALUES.has(projectStageValue(project));
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
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      return targets;
    }

    async function refreshProjectStatus(project) {
      const id = project?.id;
      if (!id) return;
      try {
        const data = await api.projectStatusCard(id);
        const latestProject = data.project || {};
        const latestViewerState = data.viewer_state || latestProject.viewer_state || null;
        projectTargets(id, project).forEach((item) => {
          Object.assign(item, latestProject);
          if (latestViewerState) {
            item.viewer_state = latestViewerState;
          }
          applyProjectViewerState(item);
        });
        if (state.projectProgress.project?.id === id) {
          Object.assign(state.projectProgress.project, latestProject);
          if (latestViewerState) {
            state.projectProgress.project.viewer_state = latestViewerState;
          }
          applyProjectViewerState(state.projectProgress.project);
        }
        state.projects = sortProjectsForCurrentFilter(state.projects);
      } catch (error) {
        // 下一次列表或状态卡加载会重新同步，这里不阻断主操作反馈。
      }
    }

    async function submitParticipationRequest(project) {
      if (!ensureLogin()) return;
      if (!canRecruitProject(project)) {
        showToast("当前阶段暂不接受新的参与");
        return;
      }
      if (participationRequestCanWithdraw(project)) {
        await withdrawParticipationRequest(project);
        return;
      }
      if (isParticipationRequested(project)) {
        showToast("已参与课题协作");
        return;
      }
      state.participationModal.open = true;
      state.participationModal.project = project;
      state.forms.participation = {
        authorship_intention: "contribution",
        message: ""
      };
      openModalWithFocus(participationModalRef);
    }

    function closeParticipationModal(force = false) {
      if (state.participationModal.submitting && !force) return;
      state.participationModal.open = false;
      state.participationModal.project = null;
      restoreLastModalTrigger();
    }

    async function submitParticipationModal() {
      const project = state.participationModal.project;
      if (!project?.id) return;
      if (!ensureLogin()) return;
      if (!canRecruitProject(project)) {
        showToast("当前阶段暂不接受新的参与");
        closeParticipationModal();
        return;
      }
      const role = participationRoleForCurrentUser();
      state.submittingParticipationProjectIds = addUniqueId(state.submittingParticipationProjectIds, project.id);
      state.participationModal.submitting = true;
      const optimisticRequest = {
        id: `local-${project.id}`,
        project,
        role,
        status: "approved",
        status_label: "已通过",
        authorship_intention: state.forms.participation.authorship_intention || "contribution",
        message: state.forms.participation.message || "参与开放课题协作"
      };
      markProjectInterestSubmitted(project, optimisticRequest, role);
      invalidateProjectStatusCard(project.id);
      closeParticipationModal(true);
      await nextTick();
      try {
        const request = await api.interest(project.id, {
          role,
          available_hours_per_week: Number(state.user?.profile?.available_hours_per_week || 4),
          experience: "",
          message: state.forms.participation.message || "参与开放课题协作",
          authorship_intention: state.forms.participation.authorship_intention || "contribution"
        });
        markProjectInterestSubmitted(project, request, role);
        invalidateProjectStatusCard(project.id);
        showToast("已参与课题协作");
        refreshProjectStatus(project);
      } catch (error) {
        markProjectInterestWithdrawn(project, { ...optimisticRequest, status: "withdrawn", status_label: "已撤回" });
        showToast(error.message || "参与失败");
      } finally {
        state.participationModal.submitting = false;
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
        showToast("没有可取消的参与");
        return;
      }
      state.withdrawingParticipationProjectIds = addUniqueId(state.withdrawingParticipationProjectIds, project.id);
      try {
        const withdrawn = await api.withdrawInteraction("interest", request.id, { reason: "用户主动取消参与" });
        markProjectInterestWithdrawn(project, withdrawn || request);
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        showToast("已取消参与");
        if (state.user) {
          await loadFavorites({ force: true });
        }
      } catch (error) {
        showToast(error.message || "取消参与失败");
      } finally {
        state.withdrawingParticipationProjectIds = removeId(state.withdrawingParticipationProjectIds, project.id);
      }
    }

    async function submitLeadClaim(project, event = null) {
      const action = claimAvailabilityAction(project, "leader");
      if (action === "unavailable") {
        showClaimUnavailableFeedback(event, project, "leader");
        return;
      }
      if (action === "pending") {
        showClaimUnavailableFeedback(event, project, "leader");
        return;
      }
      if (!ensureLogin()) return;
      if (action === "withdraw") {
        await withdrawLeadClaim(project);
        return;
      }
      if (isLeadClaimed(project) || isSubmittingLeadClaim(project) || isWithdrawingLeadClaim(project)) return;
      openLeadClaimModal(project, event);
    }

    function openLeadClaimModal(project, event = null, previousOverride = null) {
      closeMutuallyExclusiveModals("leadClaim");
      const previous = previousOverride || claimRequestForProject(project);
      state.forms.leadClaim = {
        message: previous?.message || "",
        error: "",
        previous_review_comment: previous?.status === "rejected" ? previous.review_comment || "" : ""
      };
      state.leadClaimModal.open = true;
      state.leadClaimModal.project = project;
      openModalWithFocus(leadClaimModalRef, event?.currentTarget || null);
    }

    function closeLeadClaimModal(force = false) {
      if (state.leadClaimModal.submitting && !force) return;
      state.leadClaimModal.open = false;
      state.leadClaimModal.project = null;
      state.forms.leadClaim.error = "";
      restoreLastModalTrigger();
    }

    async function submitLeadClaimModal() {
      const project = state.leadClaimModal.project;
      if (!project?.id) return;
      if (!ensureLogin()) return;
      const message = String(state.forms.leadClaim.message || "").trim();
      state.submittingLeadClaimProjectIds = addUniqueId(state.submittingLeadClaimProjectIds, project.id);
      state.leadClaimModal.submitting = true;
      try {
        const claim = await api.claim(project.id, { claim_type: "leader", message: message || "申请担任项目负责人" });
        markProjectLeadClaimed(project, claim);
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        showToast(claim?.status === "approved" ? "项目负责人认领已通过" : "项目负责人认领已提交审核");
        closeLeadClaimModal(true);
      } catch (error) {
        state.forms.leadClaim.error = error.message || "项目负责人认领失败";
        showToast(error.message || "项目负责人认领失败");
      } finally {
        state.leadClaimModal.submitting = false;
        state.submittingLeadClaimProjectIds = removeId(state.submittingLeadClaimProjectIds, project.id);
      }
    }

    async function withdrawLeadClaim(project) {
      if (!ensureLogin()) return;
      const request = claimRequestForProject(project);
      if (!request?.id || !isClaimApproved(request)) {
        showToast("没有可撤回的项目负责人认领");
        return;
      }
      state.withdrawingLeadClaimProjectIds = addUniqueId(state.withdrawingLeadClaimProjectIds, project.id);
      try {
        const withdrawn = await api.withdrawInteraction("claim", request.id, { reason: "用户主动撤回项目负责人认领" });
        markProjectLeadClaimWithdrawn(project, withdrawn || request);
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        showToast("已撤回项目负责人认领");
        if (state.user) {
          await loadFavorites({ force: true });
        }
      } catch (error) {
        showToast(error.message || "撤回项目负责人认领失败");
      } finally {
        state.withdrawingLeadClaimProjectIds = removeId(state.withdrawingLeadClaimProjectIds, project.id);
      }
    }

    async function submitPaperClaim(project, event = null) {
      const action = claimAvailabilityAction(project, "paper_first_unit");
      if (action === "unavailable") {
        showClaimUnavailableFeedback(event, project, "paper_first_unit");
        return;
      }
      if (action === "pending") {
        showClaimUnavailableFeedback(event, project, "paper_first_unit");
        return;
      }
      if (!ensureLogin()) return;
      if (action === "withdraw") {
        await withdrawPaperClaim(project);
        return;
      }
      if (isPaperClaimed(project) || isSubmittingPaperClaim(project) || isWithdrawingPaperClaim(project)) return;
      openPaperClaimModal(project, event);
    }

    function openPaperClaimModal(project, event = null, previousOverride = null) {
      closeMutuallyExclusiveModals("paperClaim");
      const previous = previousOverride || paperClaimRequestForProject(project);
      state.forms.paperClaim = {
        claimed_unit_name: previous?.claimed_unit_name || "",
        message: previous?.message || "",
        error: "",
        previous_review_comment: previous?.status === "rejected" ? previous.review_comment || "" : ""
      };
      state.paperClaimModal.open = true;
      state.paperClaimModal.project = project;
      openModalWithFocus(paperClaimModalRef, event?.currentTarget || null);
    }

    function closePaperClaimModal(force = false) {
      if (state.paperClaimModal.submitting && !force) return;
      state.paperClaimModal.open = false;
      state.paperClaimModal.project = null;
      state.forms.paperClaim.error = "";
      restoreLastModalTrigger();
    }

    async function submitPaperClaimModal() {
      const project = state.paperClaimModal.project;
      if (!project?.id) return;
      if (!ensureLogin()) return;
      const unitName = String(state.forms.paperClaim.claimed_unit_name || "").trim();
      if (!unitName) {
        state.forms.paperClaim.error = "请填写拟认领的论文第一单位。";
        return;
      }
      state.submittingPaperClaimProjectIds = addUniqueId(state.submittingPaperClaimProjectIds, project.id);
      state.paperClaimModal.submitting = true;
      try {
        const message = String(state.forms.paperClaim.message || "").trim();
        const claim = await api.claim(project.id, {
          claim_type: "paper_first_unit",
          claimed_unit_name: unitName,
          message: message || `申请认领论文第一单位：${unitName}`
        });
        markProjectPaperClaimed(project, claim);
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        showToast(claim?.status === "approved" ? "论文第一单位认领已通过" : "论文第一单位认领已提交审核");
        closePaperClaimModal(true);
      } catch (error) {
        state.forms.paperClaim.error = error.errors?.claimed_unit_name?.[0] || "";
        showToast(error.message || "论文第一单位认领失败");
      } finally {
        state.paperClaimModal.submitting = false;
        state.submittingPaperClaimProjectIds = removeId(state.submittingPaperClaimProjectIds, project.id);
      }
    }

    async function withdrawPaperClaim(project) {
      if (!ensureLogin()) return;
      const request = paperClaimRequestForProject(project);
      if (!request?.id || !isClaimApproved(request)) {
        showToast("没有可撤回的论文第一单位认领");
        return;
      }
      state.withdrawingPaperClaimProjectIds = addUniqueId(state.withdrawingPaperClaimProjectIds, project.id);
      try {
        const withdrawn = await api.withdrawInteraction("claim", request.id, { reason: "用户主动撤回论文第一单位认领" });
        markProjectPaperClaimWithdrawn(project, withdrawn || request);
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        showToast("已撤回论文第一单位认领");
        if (state.user) {
          await loadFavorites({ force: true });
        }
      } catch (error) {
        showToast(error.message || "撤回论文第一单位认领失败");
      } finally {
        state.withdrawingPaperClaimProjectIds = removeId(state.withdrawingPaperClaimProjectIds, project.id);
      }
    }

    function realignSponsorPopoverFromRenderedSize(trigger = state.sponsorModal.returnFocus) {
      if (!state.sponsorModal.open) return;
      const popoverRect = document.querySelector(".sponsor-popover")?.getBoundingClientRect?.();
      const renderedSize = popoverRect
        ? {
          width: popoverRect.width,
          height: popoverRect.height
        }
        : {};
      const position = sponsorPopoverPositionFromTrigger(trigger, renderedSize);
      if (
        Math.abs(state.sponsorModal.x - position.x) > 1
        || Math.abs(state.sponsorModal.y - position.y) > 1
        || Math.abs(state.sponsorModal.maxHeight - position.maxHeight) > 1
      ) {
        state.sponsorModal.x = position.x;
        state.sponsorModal.y = position.y;
        state.sponsorModal.maxHeight = position.maxHeight;
      }
    }

    function handleSponsorPopoverViewportChange() {
      realignSponsorPopoverFromRenderedSize();
    }

    async function submitSponsor(project, event = null, options = {}) {
      if (!ensureLogin()) return;
      if (!project?.id) {
        showToast("请选择要资助的课题");
        return;
      }
      if (isSubmittingSponsor(project)) return;
      if (!canRecruitProject(project) && !sponsorRequestCanWithdraw(project)) {
        showToast("当前阶段暂不接受新的资助意向");
        return;
      }
      const activeTypes = activeSponsorTypesForProject(project);
      const preselectedTypes = (options.preselectedTypes || []).filter((type) => [...QUICK_SPONSOR_TYPES, "token"].includes(type));
      const selectedTypes = [...new Set([...activeTypes, ...preselectedTypes])];
      closeMutuallyExclusiveModals("sponsor");
      state.forms.sponsor = {
        sponsor_type: selectedTypes[0] || "compute",
        sponsor_types: selectedTypes,
        note: options.note || "",
        show_more_types: selectedTypes.includes("token"),
        previous_review_comment: options.previousReviewComment || ""
      };
      const popoverPosition = sponsorPopoverPositionFromTrigger(event?.currentTarget);
      state.sponsorModal.open = true;
      state.sponsorModal.project = project;
      state.sponsorModal.returnFocus = event?.currentTarget || null;
      rememberModalTrigger(event?.currentTarget || null);
      state.sponsorModal.x = popoverPosition.x;
      state.sponsorModal.y = popoverPosition.y;
      state.sponsorModal.maxHeight = popoverPosition.maxHeight;
      nextTick(() => {
        realignSponsorPopoverFromRenderedSize(state.sponsorModal.returnFocus);
        document.querySelector(".sponsor-popover input:not(:disabled)")?.focus();
      });
    }

    function closeSponsorModal(force = false) {
      if (state.sponsorModal.submitting && !force) return;
      state.sponsorModal.open = false;
      state.sponsorModal.project = null;
      const focusTarget = state.sponsorModal.returnFocus;
      state.sponsorModal.returnFocus = null;
      if (focusTarget?.focus) {
        window.setTimeout(() => focusTarget.focus(), 0);
      }
      restoreLastModalTrigger();
    }

    async function submitSponsorModal() {
      const project = state.sponsorModal.project;
      if (!project?.id) return;
      if (!ensureLogin()) return;
      const sponsorPopoverTypes = [...QUICK_SPONSOR_TYPES, "token"];
      const selectedTypes = (state.forms.sponsor.sponsor_types || []).filter((type) => sponsorPopoverTypes.includes(type));
      const activeRequests = activeSponsorRequestsForProject(project).filter((request) => sponsorPopoverTypes.includes(request.sponsor_type));
      const activeTypes = activeRequests.map((request) => request.sponsor_type).filter(Boolean);
      const typesToAdd = selectedTypes.filter((type) => !activeTypes.includes(type));
      const requestsToWithdraw = activeRequests.filter((request) => !selectedTypes.includes(request.sponsor_type));
      if (!selectedTypes.length && !activeRequests.length) {
        showToast("请选择资助类型");
        return;
      }
      if (!canRecruitProject(project) && typesToAdd.length) {
        showToast("当前阶段暂不接受新的资助意向");
        closeSponsorModal(true);
        return;
      }
      state.submittingSponsorProjectIds = addUniqueId(state.submittingSponsorProjectIds, project.id);
      state.sponsorModal.submitting = true;
      const successes = [];
      const failures = [];
      try {
        for (const sponsorType of typesToAdd) {
          try {
            const request = await api.sponsor(project.id, { sponsor_type: sponsorType, note: state.forms.sponsor.note || "" });
            markProjectSponsorSubmitted(project, request);
            successes.push(sponsorTypeLabel(sponsorType));
          } catch (error) {
            failures.push(`${sponsorTypeLabel(sponsorType)}：${error.message || "提交失败"}`);
          }
        }
        for (const request of requestsToWithdraw) {
          try {
            const withdrawn = await api.withdrawInteraction("sponsor", request.id, { reason: `用户主动撤回${sponsorTypeLabel(request.sponsor_type)}资助意向` });
            markProjectSponsorWithdrawn(project, withdrawn || request);
            successes.push(`撤回${sponsorTypeLabel(request.sponsor_type)}`);
          } catch (error) {
            failures.push(`撤回${sponsorTypeLabel(request.sponsor_type)}：${error.message || "提交失败"}`);
          }
        }
        invalidateProjectStatusCard(project.id);
        await refreshProjectStatus(project);
        if (failures.length) {
          showToast(`${successes.join("，") || "资助"}已处理，${failures.join("，")}提交失败`);
        } else {
          showToast(successes.length ? "资助意向已记录" : "资助意向未变化");
          closeSponsorModal(true);
        }
      } catch (error) {
        showToast(error.message || "资助意向提交失败");
      } finally {
        state.sponsorModal.submitting = false;
        state.submittingSponsorProjectIds = removeId(state.submittingSponsorProjectIds, project.id);
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

    function participationRoleForCurrentUser() {
      const roleType = state.user?.profile?.role_type || "";
      if (roleType === "doctor") return "医生";
      if (roleType === "engineer") return "AI工程师";
      if (["undergrad_or_below", "master_student", "phd_student"].includes(roleType)) return "学生";
      if (roleType === "phd_or_above") return "大学老师";
      return "学生";
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
        status: request?.status || "approved",
        status_label: request?.status_label || "已通过"
      };
      state.participationRequestsByProjectId = {
        ...state.participationRequestsByProjectId,
        [id]: savedRequest
      };
      state.participationProjectIds = addUniqueId(state.participationProjectIds, id);
      const targets = new Set([project, ...state.projects.filter((item) => item.id === id)]);
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
      if (state.dashboard?.follows) {
        state.dashboard.follows.forEach((item) => {
          if (item.project?.id === id) targets.add(item.project);
        });
      }
      targets.forEach((item) => clearProjectParticipationViewerState(item));
    }

    function markProjectLeadClaimed(project, claim = null) {
      const id = project?.id || claim?.project?.id;
      if (!id) return;
      const savedClaim = {
        ...(claim || {}),
        id: claim?.id || `local-claim-${id}`,
        project: claim?.project || project,
        claim_type: claim?.claim_type || "leader",
        claim_type_label: claim?.claim_type_label || "认领项目负责人",
        status: claim?.status || "pending",
        status_label: claim?.status_label || "待处理"
      };
      state.claimRequestsByProjectId = {
        ...state.claimRequestsByProjectId,
        [id]: savedClaim
      };
      const targets = projectTargets(id, project);
      targets.forEach((item) => {
        applyProjectClaimAvailability(item, savedClaim);
        const claimTypes = new Set(item.viewer_state?.claim_types || []);
        claimTypes.add(savedClaim.claim_type);
        item.viewer_state = {
          ...(item.viewer_state || {}),
          claim_types: Array.from(claimTypes),
          relationship_labels: [
            ...new Set([
              ...(item.viewer_state?.relationship_labels || []),
              leadClaimRelationshipLabel(savedClaim)
            ])
          ]
        };
      });
      upsertDashboardApplication("claims", savedClaim, project);
    }

    function markProjectLeadClaimWithdrawn(project, claim = null) {
      const id = project?.id || claim?.project?.id;
      if (!id) return;
      const previous = claimRequestForProject(project);
      const savedClaim = {
        ...(previous || {}),
        ...(claim || {}),
        project: claim?.project || previous?.project || project,
        status: claim?.status || "withdrawn",
        status_label: claim?.status_label || "已撤回"
      };
      state.claimRequestsByProjectId = {
        ...state.claimRequestsByProjectId,
        [id]: savedClaim
      };
      if (state.dashboard?.claims) {
        state.dashboard.claims = state.dashboard.claims.map((item) => (
          item.id === savedClaim.id ? savedClaim : item
        ));
      }
      projectTargets(id, project).forEach((item) => {
        clearProjectAvailability(item, "leader");
        clearProjectLeadClaimViewerState(item);
      });
    }

    function markProjectPaperClaimed(project, claim = null) {
      const id = project?.id || claim?.project?.id;
      if (!id) return;
      const savedClaim = {
        ...(claim || {}),
        id: claim?.id || `local-paper-claim-${id}`,
        project: claim?.project || project,
        claim_type: claim?.claim_type || "paper_first_unit",
        claim_type_label: claim?.claim_type_label || "认领课题（论文第一单位）",
        status: claim?.status || "pending",
        status_label: claim?.status_label || "待处理"
      };
      state.paperClaimRequestsByProjectId = {
        ...state.paperClaimRequestsByProjectId,
        [id]: savedClaim
      };
      projectTargets(id, project).forEach((item) => {
        applyProjectClaimAvailability(item, savedClaim);
        const claimTypes = new Set(item.viewer_state?.claim_types || []);
        claimTypes.add(savedClaim.claim_type);
        item.viewer_state = {
          ...(item.viewer_state || {}),
          claim_types: Array.from(claimTypes),
          relationship_labels: [
            ...new Set([
              ...(item.viewer_state?.relationship_labels || []),
              paperClaimRelationshipLabel(savedClaim)
            ])
          ]
        };
      });
      upsertDashboardApplication("claims", savedClaim, project);
    }

    function markProjectPaperClaimWithdrawn(project, claim = null) {
      const id = project?.id || claim?.project?.id;
      if (!id) return;
      const previous = paperClaimRequestForProject(project);
      const savedClaim = {
        ...(previous || {}),
        ...(claim || {}),
        project: claim?.project || previous?.project || project,
        status: claim?.status || "withdrawn",
        status_label: claim?.status_label || "已撤回"
      };
      state.paperClaimRequestsByProjectId = {
        ...state.paperClaimRequestsByProjectId,
        [id]: savedClaim
      };
      if (state.dashboard?.claims) {
        state.dashboard.claims = state.dashboard.claims.map((item) => (
          item.id === savedClaim.id ? savedClaim : item
        ));
      }
      projectTargets(id, project).forEach((item) => {
        clearProjectAvailability(item, "paper_first_unit");
        clearProjectPaperClaimViewerState(item);
      });
    }

    function markProjectSponsorSubmitted(project, request = null) {
      const id = project?.id;
      if (!id) return;
      const sponsorType = request?.sponsor_type || state.forms.sponsor.sponsor_type || state.forms.sponsor.sponsor_types?.[0] || "compute";
      const savedRequest = {
        ...(request || {}),
        id: request?.id || `local-sponsor-${id}-${sponsorType}`,
        project: request?.project || project,
        sponsor_type: sponsorType,
        status: request?.status || "pending",
        status_label: request?.status_label || "待处理"
      };
      const current = state.sponsorRequestsByProjectId[id]?.sponsor_type
        ? { [state.sponsorRequestsByProjectId[id].sponsor_type]: state.sponsorRequestsByProjectId[id] }
        : state.sponsorRequestsByProjectId[id] || {};
      state.sponsorRequestsByProjectId = {
        ...state.sponsorRequestsByProjectId,
        [id]: {
          ...current,
          [sponsorType]: savedRequest
        }
      };
      upsertDashboardApplication("sponsors", savedRequest, project);
      if (savedRequest.status === "approved") {
        updateProjectSponsorCount(id, project, 1);
      }
      projectTargets(id, project).forEach((item) => applyProjectViewerState(item));
      state.projects = sortProjectsForCurrentFilter(state.projects);
    }

    function upsertDashboardApplication(collectionName, application, fallbackProject = null) {
      if (!state.dashboard?.[collectionName] || !application?.id) return;
      const savedApplication = {
        ...application,
        project: application.project || fallbackProject || application.project
      };
      let replaced = false;
      const rows = state.dashboard[collectionName].map((item) => {
        if (item.id !== savedApplication.id) return item;
        replaced = true;
        return {
          ...item,
          ...savedApplication,
          project: savedApplication.project || item.project
        };
      });
      state.dashboard[collectionName] = replaced ? rows : [savedApplication, ...rows];
    }

    function markProjectSponsorWithdrawn(project, request = null) {
      const id = project?.id || request?.project?.id;
      if (!id) return;
      const sponsorType = request?.sponsor_type || sponsorRequestForProject(project)?.sponsor_type;
      const previous = sponsorRequestByType(project, sponsorType) || sponsorRequestForProject(project);
      const savedRequest = {
        ...(previous || {}),
        ...(request || {}),
        project: request?.project || project,
        sponsor_type: sponsorType || previous?.sponsor_type || "compute",
        status: request?.status || "withdrawn",
        status_label: request?.status_label || "已撤回"
      };
      const current = state.sponsorRequestsByProjectId[id]?.sponsor_type
        ? { [state.sponsorRequestsByProjectId[id].sponsor_type]: state.sponsorRequestsByProjectId[id] }
        : state.sponsorRequestsByProjectId[id] || {};
      state.sponsorRequestsByProjectId = {
        ...state.sponsorRequestsByProjectId,
        [id]: {
          ...current,
          [savedRequest.sponsor_type]: savedRequest
        }
      };
      if (state.dashboard?.sponsors) {
        state.dashboard.sponsors = state.dashboard.sponsors.map((item) => (
          item.id === savedRequest.id ? savedRequest : item
        ));
      }
      if (previous?.status === "approved") {
        updateProjectSponsorCount(id, project, -1);
      }
      projectTargets(id, project).forEach((item) => applyProjectViewerState(item));
      state.projects = sortProjectsForCurrentFilter(state.projects);
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
    }

    function selfRelationTypes(project) {
      const types = [];
      const claimTypes = project?.viewer_state?.claim_types || [];
      if (claimTypes.includes("leader") || claimTypes.includes("paper_first_unit") || leadClaimCanWithdraw(project) || paperClaimCanWithdraw(project)) {
        types.push("claim");
      }
      if (isParticipationRequested(project)) {
        types.push("participation");
      }
      const sponsorTypes = project?.viewer_state?.sponsor_types || [];
      if (sponsorTypes.length || sponsorRequestCanWithdraw(project)) {
        types.push("sponsor");
      }
      return SELF_RELATION_PRIORITY.filter((type) => types.includes(type));
    }

    function selfRelationLabels(project) {
      return selfRelationTypes(project).map((type) => SELF_RELATION_LABELS[type]);
    }

    function primarySelfRelationLabel(project) {
      return selfRelationLabels(project)[0] || "";
    }

    function secondarySelfRelationLabels(project) {
      return selfRelationLabels(project).slice(1);
    }

    function hasSelfRelation(project) {
      return Boolean(primarySelfRelationLabel(project));
    }

    function selfRelationSortRank(project) {
      const type = selfRelationTypes(project)[0];
      const index = SELF_RELATION_PRIORITY.indexOf(type);
      return index >= 0 ? index : SELF_RELATION_PRIORITY.length;
    }

    function compareSelfRelation(a, b) {
      return selfRelationSortRank(a) - selfRelationSortRank(b);
    }

    function applyProjectViewerState(project) {
      if (!project) return;
      syncSponsorRequestsFromViewerState(project);
      syncProjectClaimAvailability(project);
      const participationRequest = participationRequestForProject(project);
      const claimRequest = claimRequestForProject(project);
      const paperClaimRequest = paperClaimRequestForProject(project);
      const sponsorRequests = sponsorRequestsForProject(project);
      const labels = (project.viewer_state?.relationship_labels || [])
        .filter((label) => (
          !isParticipationRelationshipLabel(label) &&
          !isLeadClaimRelationshipLabel(label) &&
          !isPaperClaimRelationshipLabel(label) &&
          !isSponsorRelationshipLabel(label)
        ));
      const claimTypes = new Set(project.viewer_state?.claim_types || []);
      const sponsorTypes = new Set(project.viewer_state?.sponsor_types || []);
      if (claimRequest?.claim_type === "leader") {
        if (isActiveClaimRequest(claimRequest)) {
          claimTypes.add("leader");
        } else {
          claimTypes.delete("leader");
        }
      }
      if (paperClaimRequest?.claim_type === "paper_first_unit") {
        if (isActiveClaimRequest(paperClaimRequest)) {
          claimTypes.add("paper_first_unit");
        } else {
          claimTypes.delete("paper_first_unit");
        }
      }
      sponsorRequests.forEach((request) => {
        if (!request?.sponsor_type) return;
        if (isActiveParticipationRequest(request)) {
          sponsorTypes.add(request.sponsor_type);
        } else {
          sponsorTypes.delete(request.sponsor_type);
        }
      });
      project.viewer_state = {
        ...(project.viewer_state || {}),
        is_following: isProjectFollowing(project),
        relationship_labels: labels,
        interest_roles: isActiveParticipationRequest(participationRequest) ? (project.viewer_state?.interest_roles || []) : [],
        claim_types: Array.from(claimTypes),
        sponsor_types: Array.from(sponsorTypes)
      };
      if (state.unlikedProjectIds.includes(project.id)) {
        const { score: _score, ...rest } = project.viewer_state;
        project.viewer_state = rest;
      } else if (isProjectLiked(project)) {
        project.viewer_state.score = project.viewer_state.score || { score: 10, comment: "点赞" };
      }
      if (isActiveParticipationRequest(participationRequest)) {
        project.viewer_state.relationship_labels = [...new Set([...project.viewer_state.relationship_labels, participationRelationshipLabel(participationRequest)])];
      }
      if (isActiveClaimRequest(claimRequest) && claimRequest.claim_type === "leader") {
        project.viewer_state.relationship_labels = [...new Set([...project.viewer_state.relationship_labels, leadClaimRelationshipLabel(claimRequest)])];
      }
      if (isActiveClaimRequest(paperClaimRequest) && paperClaimRequest.claim_type === "paper_first_unit") {
        project.viewer_state.relationship_labels = [...new Set([...project.viewer_state.relationship_labels, paperClaimRelationshipLabel(paperClaimRequest)])];
      }
      sponsorRequests
        .filter((request) => isActiveParticipationRequest(request))
        .forEach((request) => {
          project.viewer_state.relationship_labels = [...new Set([...project.viewer_state.relationship_labels, sponsorRelationshipLabel(request)])];
        });
    }

    function clearProjectParticipationViewerState(project) {
      if (!project) return;
      project.viewer_state = {
        ...(project.viewer_state || {}),
        interest_roles: [],
        relationship_labels: (project.viewer_state?.relationship_labels || [])
          .filter((label) => !isParticipationRelationshipLabel(label))
      };
    }

    function clearProjectLeadClaimViewerState(project) {
      if (!project) return;
      const claimTypes = new Set(project.viewer_state?.claim_types || []);
      claimTypes.delete("leader");
      project.viewer_state = {
        ...(project.viewer_state || {}),
        claim_types: Array.from(claimTypes),
        relationship_labels: (project.viewer_state?.relationship_labels || [])
          .filter((label) => !isLeadClaimRelationshipLabel(label))
      };
    }

    function clearProjectPaperClaimViewerState(project) {
      if (!project) return;
      const claimTypes = new Set(project.viewer_state?.claim_types || []);
      claimTypes.delete("paper_first_unit");
      project.viewer_state = {
        ...(project.viewer_state || {}),
        claim_types: Array.from(claimTypes),
        relationship_labels: (project.viewer_state?.relationship_labels || [])
          .filter((label) => !isPaperClaimRelationshipLabel(label))
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
        labels.some((label) => isParticipationRelationshipLabel(label))
      );
    }

    function isSubmittingParticipation(project) {
      return Boolean(project?.id && state.submittingParticipationProjectIds.includes(project.id));
    }

    function isWithdrawingParticipation(project) {
      return Boolean(project?.id && state.withdrawingParticipationProjectIds.includes(project.id));
    }

    function participationButtonLabel(project) {
      if (isWithdrawingParticipation(project)) return "取消中...";
      if (isSubmittingParticipation(project)) return "提交中...";
      if (participationRequestCanWithdraw(project)) return "取消参与";
      if (!canRecruitProject(project)) return "暂不招募";
      return "参与";
    }

    function canClickParticipation(project) {
      if (isSubmittingParticipation(project) || isWithdrawingParticipation(project)) return false;
      if (participationRequestCanWithdraw(project)) return true;
      return canRecruitProject(project);
    }

    function isLeadClaimed(project) {
      if (leadClaimCanWithdraw(project)) return true;
      return Boolean((project?.viewer_state?.claim_types || []).includes("leader"));
    }

    function isPaperClaimed(project) {
      if (paperClaimCanWithdraw(project)) return true;
      return Boolean((project?.viewer_state?.claim_types || []).includes("paper_first_unit"));
    }

    function isSubmittingLeadClaim(project) {
      return Boolean(project?.id && state.submittingLeadClaimProjectIds.includes(project.id));
    }

    function isWithdrawingLeadClaim(project) {
      return Boolean(project?.id && state.withdrawingLeadClaimProjectIds.includes(project.id));
    }

    function isSubmittingPaperClaim(project) {
      return Boolean(project?.id && state.submittingPaperClaimProjectIds.includes(project.id));
    }

    function isWithdrawingPaperClaim(project) {
      return Boolean(project?.id && state.withdrawingPaperClaimProjectIds.includes(project.id));
    }

    function claimAvailability(project, claimType) {
      const authoritativeAvailability = project?.claim_availability?.[claimType];
      if (authoritativeAvailability) return authoritativeAvailability;
      const request = claimType === "paper_first_unit" ? paperClaimRequestForProject(project) : claimRequestForProject(project);
      const label = claimType === "leader" ? "项目负责人认领" : "论文第一单位认领";
      if (isClaimPending(request)) {
        return {
          available: false,
          action: "pending",
          reason_code: "own_pending",
          reason: `你的${label}正在管理员审批中，审批通过后可撤回${label}。`
        };
      }
      if (isClaimApproved(request)) {
        return {
          available: false,
          action: "withdraw",
          reason_code: "own_approved",
          reason: `你的${label}已通过，可撤回${label}。`
        };
      }
      const fallbackAvailable = canRecruitProject(project) && !isClaimTypeLocallyClaimed(project, claimType);
      return {
        available: fallbackAvailable,
        action: fallbackAvailable ? "submit" : "unavailable",
        reason_code: fallbackAvailable ? "available" : "stage_not_recruiting",
        reason: claimType === "leader" ? "当前阶段暂不接受项目负责人认领。" : "当前阶段暂不接受论文第一单位认领。"
      };
    }

    function claimAvailabilityAction(project, claimType) {
      return claimAvailability(project, claimType).action || "unavailable";
    }

    function claimUnavailableReason(project, claimType) {
      const availability = claimAvailability(project, claimType);
      const label = claimType === "leader" ? "项目负责人认领" : "论文第一单位认领";
      const reasonByCode = {
        own_pending: `你的${label}正在管理员审批中，审批通过后可撤回${label}。`,
        own_approved: `你的${label}已通过，可撤回${label}。`,
        own_active: `你的${label}正在审核或已通过。`,
        login_required: `登录后可提交${label}。`,
        stage_not_recruiting: `当前阶段暂不接受${label}。`,
        slot_occupied: `该课题已有${label}申请或已通过${label}。`,
        insufficient_credits: `当前积分不足，暂不能提交${label}。`,
        data_conflict: `该课题的${label}数据存在冲突，请联系管理员处理。`
      };
      return reasonByCode[availability.reason_code] || availability.reason || `暂不能提交${label}。`;
    }

    function showClaimReasonTooltip(event, project, claimType) {
      const action = claimAvailabilityAction(project, claimType);
      if (!["pending", "unavailable"].includes(action)) {
        hideClaimReasonTooltip();
        return;
      }
      const rect = event?.currentTarget?.getBoundingClientRect?.();
      const maxX = Math.max(12, window.innerWidth - 320);
      const maxY = Math.max(12, window.innerHeight - 120);
      state.claimReasonTooltip = {
        visible: true,
        text: claimUnavailableReason(project, claimType),
        x: rect ? Math.min(maxX, Math.max(12, rect.left)) : 24,
        y: rect ? Math.min(maxY, Math.max(12, rect.bottom + 8)) : 120
      };
    }

    function hideClaimReasonTooltip() {
      state.claimReasonTooltip.visible = false;
    }

    function showClaimUnavailableFeedback(event, project, claimType) {
      showClaimReasonTooltip(event, project, claimType);
      showToast(claimUnavailableReason(project, claimType));
    }

    function claimButtonAriaDisabled(project, claimType) {
      return ["pending", "unavailable"].includes(claimAvailabilityAction(project, claimType)) ? "true" : "false";
    }

    function isClaimTypeLocallyClaimed(project, claimType) {
      if (claimType === "leader") return isLeadClaimed(project);
      if (claimType === "paper_first_unit") return isPaperClaimed(project);
      return false;
    }

    function leadClaimButtonLabel(project) {
      if (isWithdrawingLeadClaim(project)) return "撤回中...";
      if (isSubmittingLeadClaim(project)) return "提交中...";
      const action = claimAvailabilityAction(project, "leader");
      if (action === "pending") return "项目负责人审批中";
      if (action === "withdraw") return "撤回项目负责人认领";
      if (action === "unavailable") return "暂不认领";
      if (isLeadClaimed(project)) return "项目负责人审批中";
      return "认领项目负责人";
    }

    function paperClaimButtonLabel(project) {
      if (isWithdrawingPaperClaim(project)) return "撤回中...";
      if (isSubmittingPaperClaim(project)) return "提交中...";
      const action = claimAvailabilityAction(project, "paper_first_unit");
      if (action === "pending") return "第一单位认领审批中";
      if (action === "withdraw") return "撤回论文第一单位认领";
      if (action === "unavailable") return "暂不认领";
      if (isPaperClaimed(project)) return "第一单位认领审批中";
      return "认领第一单位";
    }

    function canClickLeadClaim(project) {
      if (isSubmittingLeadClaim(project) || isWithdrawingLeadClaim(project)) return false;
      return true;
    }

    function canClickPaperClaim(project) {
      if (isSubmittingPaperClaim(project) || isWithdrawingPaperClaim(project)) return false;
      return true;
    }

    function participationRequestForProject(project) {
      const id = project?.id;
      return id ? state.participationRequestsByProjectId[id] || null : null;
    }

    function participationRequestCanWithdraw(project) {
      return isActiveParticipationRequest(participationRequestForProject(project));
    }

    function claimRequestForProject(project) {
      const id = project?.id;
      return claimRequestFromAvailability(project, "leader") || (id ? state.claimRequestsByProjectId[id] || null : null);
    }

    function leadClaimCanWithdraw(project) {
      const request = claimRequestForProject(project);
      return request?.claim_type === "leader" && isClaimApproved(request);
    }

    function paperClaimRequestForProject(project) {
      const id = project?.id;
      return claimRequestFromAvailability(project, "paper_first_unit") || (id ? state.paperClaimRequestsByProjectId[id] || null : null);
    }

    function paperClaimCanWithdraw(project) {
      const request = paperClaimRequestForProject(project);
      return request?.claim_type === "paper_first_unit" && isClaimApproved(request);
    }

    function isClaimPending(request) {
      return request?.status === "pending";
    }

    function isClaimApproved(request) {
      return Boolean(request?.status && WITHDRAWABLE_CLAIM_STATUSES.has(request.status));
    }

    function isActiveClaimRequest(request) {
      return isClaimPending(request) || isClaimApproved(request);
    }

    function claimRequestFromAvailability(project, claimType) {
      const availability = project?.claim_availability?.[claimType];
      if (!project?.id || !availability?.own_interaction_id || !availability?.own_status) return null;
      const previous = claimType === "paper_first_unit"
        ? state.paperClaimRequestsByProjectId[project.id]
        : state.claimRequestsByProjectId[project.id];
      return {
        ...(previous || {}),
        id: availability.own_interaction_id,
        project,
        claim_type: claimType,
        claim_type_label: claimTypeLabel(claimType),
        status: availability.own_status,
        status_label: claimStatusLabel(availability.own_status)
      };
    }

    function hasClaimAvailability(project, claimType) {
      return Boolean(project?.claim_availability && Object.prototype.hasOwnProperty.call(project.claim_availability, claimType));
    }

    function syncProjectClaimAvailability(project) {
      if (!project?.id) return;
      ["leader", "paper_first_unit"].forEach((claimType) => {
        const request = claimRequestFromAvailability(project, claimType);
        if (!request) return;
        if (claimType === "paper_first_unit") {
          state.paperClaimRequestsByProjectId = {
            ...state.paperClaimRequestsByProjectId,
            [project.id]: request
          };
        } else {
          state.claimRequestsByProjectId = {
            ...state.claimRequestsByProjectId,
            [project.id]: request
          };
        }
      });
    }

    function applyProjectClaimAvailability(project, request) {
      if (!project?.id || !request?.claim_type || !["pending", "approved"].includes(request.status)) return;
      project.claim_availability = {
        ...(project.claim_availability || {}),
        [request.claim_type]: {
          available: false,
          action: request.status === "approved" ? "withdraw" : "pending",
          own_status: request.status,
          own_interaction_id: request.id,
          reason_code: request.status === "approved" ? "own_approved" : "own_pending",
          reason: claimAvailabilityReason(request.claim_type, request.status)
        }
      };
    }

    function clearProjectAvailability(project, claimType) {
      if (!project?.claim_availability?.[claimType]) return;
      const { [claimType]: _removed, ...rest } = project.claim_availability;
      project.claim_availability = rest;
    }

    function claimTypeLabel(claimType) {
      return claimType === "paper_first_unit" ? "认领课题（论文第一单位）" : "认领项目负责人";
    }

    function claimRelationLabel(claimType) {
      return claimType === "paper_first_unit" ? "论文第一单位认领" : "项目负责人认领";
    }

    function claimStatusLabel(status) {
      return {
        pending: "待处理",
        approved: "已通过",
        rejected: "已拒绝",
        withdrawn: "已撤回"
      }[status] || RELATION_STATUS_LABELS[status] || status;
    }

    function claimAvailabilityReason(claimType, status) {
      const label = claimRelationLabel(claimType);
      if (status === "approved") return `你的${label}已通过，可撤回${label}。`;
      return `你的${label}正在管理员审批中，审批通过后可撤回${label}。`;
    }

    function isActiveParticipationRequest(request) {
      return Boolean(request?.status && WITHDRAWABLE_PARTICIPATION_STATUSES.has(request.status));
    }

    function participationRelationshipLabel(request) {
      return `参与：${request?.status_label || "已通过"}`;
    }

    function isParticipationRelationshipLabel(label) {
      const value = String(label || "");
      return value.includes("申请参与") || value.startsWith("参与：");
    }

    function leadClaimRelationshipLabel(request) {
      return `${request?.claim_type_label || "认领项目负责人"}（${request?.status_label || "已通过"}）`;
    }

    function isLeadClaimRelationshipLabel(label) {
      const value = String(label || "");
      return value.includes("认领项目负责人") || value.includes("项目负责人");
    }

    function paperClaimRelationshipLabel(request) {
      return `${request?.claim_type_label || "认领课题（论文第一单位）"}（${request?.status_label || "待处理"}）`;
    }

    function isPaperClaimRelationshipLabel(label) {
      const value = String(label || "");
      return value.includes("论文第一单位") || value.includes("第一单位");
    }

    function sponsorRelationshipLabel(request) {
      return `资助：${request?.sponsor_type_label || sponsorTypeLabel(request?.sponsor_type)}（${request?.status_label || "待处理"}）`;
    }

    function isSponsorRelationshipLabel(label) {
      return String(label || "").startsWith("资助：");
    }

    function sponsorRequestForProject(project) {
      return activeSponsorRequestsForProject(project)[0] || sponsorRequestsForProject(project)[0] || null;
    }

    function sponsorRequestByType(project, sponsorType) {
      const id = project?.id;
      if (!id || !sponsorType) return null;
      const entry = state.sponsorRequestsByProjectId[id];
      if (!entry) return null;
      if (entry.sponsor_type) {
        return entry.sponsor_type === sponsorType ? entry : null;
      }
      return entry[sponsorType] || null;
    }

    function sponsorRequestsForProject(project) {
      const id = project?.id;
      const entry = id ? state.sponsorRequestsByProjectId[id] : null;
      if (!entry) return [];
      if (entry.sponsor_type) return [entry];
      return Object.values(entry).filter(Boolean);
    }

    function activeSponsorRequestsForProject(project) {
      return sponsorRequestsForProject(project).filter((request) => isActiveParticipationRequest(request));
    }

    function quickActiveSponsorRequestsForProject(project) {
      return activeSponsorRequestsForProject(project).filter((request) => QUICK_SPONSOR_TYPES.includes(request.sponsor_type));
    }

    function activeSponsorTypesForProject(project) {
      return activeSponsorRequestsForProject(project)
        .map((request) => request.sponsor_type)
        .filter(Boolean);
    }

    function sponsorRequestStatusLabel(project, sponsorType) {
      const request = sponsorRequestByType(project, sponsorType);
      return isActiveParticipationRequest(request) ? request.status_label || "待处理" : "";
    }

    function sponsorTypeLabel(value) {
      return (state.meta.sponsor_types || []).find((item) => item.value === value)?.label || sponsorTypeFallbackLabel(value);
    }

    function sponsorRequestCanWithdraw(project) {
      return activeSponsorRequestsForProject(project).length > 0;
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
      if (sponsorRequestCanWithdraw(project)) return "管理资助";
      if (!canRecruitProject(project)) return "暂不资助";
      return "资助";
    }

    function interactionButtonActive(type, project) {
      if (type === "like") return isProjectLiked(project);
      if (type === "follow") return isProjectFollowing(project);
      if (type === "participation") return participationRequestCanWithdraw(project);
      if (type === "lead") return isLeadClaimed(project);
      if (type === "paper") return isPaperClaimed(project);
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
          sort_order: Number(state.admin.themeForm.sort_order || 0),
          is_active: state.admin.themeForm.is_active
        };
        const wasEditing = Boolean(state.admin.themeForm.id);
        let savedTheme = null;
        if (state.admin.themeForm.id) {
          savedTheme = await api.adminUpdateTheme(state.admin.themeForm.id, payload);
        } else {
          savedTheme = await api.adminCreateTheme(payload);
        }
        state.admin.themeForm.id = savedTheme.id;
        state.admin.themeFileForm.theme_id = savedTheme.id;
        if (themeDatasetFormTouched(state.admin.themeFileForm)) {
          if (!String(state.admin.themeFileForm.title || "").trim()) {
            state.admin.themeFileForm.title = `${savedTheme.name} 数据集说明`;
          }
          const savedFile = await saveThemeFile({ reset: false, silent: true });
          if (!savedFile) return;
          if (state.admin.themeFileForm.detailPdfUpload.file) {
            await uploadThemeFileDetailPdf({ fileId: savedFile.id, silent: true });
          }
        }
        showToast(wasEditing ? "主题已保存" : "主题已创建");
        closeThemeForm();
        await loadAdmin();
        state.meta = await api.meta();
      } catch (error) {
        showToast(error.message);
      }
    }

    function adminThemeDatasetFile(theme) {
      if (!theme?.id) return null;
      return state.admin.themeFiles.find((file) => file.theme_id === theme.id && file.is_active) || null;
    }

    function resetThemeSortState(themes = []) {
      state.admin.themes = [...themes];
      state.admin.themeSortBaselineIds = state.admin.themes.map((theme) => theme.id);
      state.admin.themeSortDirty = false;
    }

    function moveThemeSort(theme, direction) {
      if (!theme?.id || state.admin.themeSortSaving) return;
      const index = state.admin.themes.findIndex((item) => item.id === theme.id);
      if (index < 0) return;
      let targetIndex = index;
      if (direction === "up") targetIndex = Math.max(0, index - 1);
      if (direction === "down") targetIndex = Math.min(state.admin.themes.length - 1, index + 1);
      if (direction === "top") targetIndex = 0;
      if (direction === "bottom") targetIndex = state.admin.themes.length - 1;
      if (targetIndex === index) return;
      const rows = [...state.admin.themes];
      const [moved] = rows.splice(index, 1);
      rows.splice(targetIndex, 0, moved);
      state.admin.themes = rows;
      state.admin.themeSortDirty = !sameThemeOrder(rows.map((item) => item.id), state.admin.themeSortBaselineIds);
    }

    function restoreThemeSort() {
      const rank = new Map(state.admin.themeSortBaselineIds.map((id, index) => [id, index]));
      state.admin.themes = [...state.admin.themes].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
      state.admin.themeSortDirty = false;
    }

    async function saveThemeSort() {
      if (!can("manage_themes") || !state.admin.themeSortDirty || state.admin.themeSortSaving) return;
      state.admin.themeSortSaving = true;
      try {
        const data = await api.adminReorderThemes({ theme_ids: state.admin.themes.map((theme) => theme.id) });
        resetThemeSortState(data.themes || state.admin.themes);
        state.meta = await api.meta();
        showToast("主题排序已保存");
      } catch (error) {
        showToast(error.message || "主题排序保存失败");
      } finally {
        state.admin.themeSortSaving = false;
      }
    }

    function sameThemeOrder(left = [], right = []) {
      return left.length === right.length && left.every((id, index) => id === right[index]);
    }

    async function editTheme(theme) {
      if (!can("manage_themes")) return;
      closeMutuallyExclusiveModals("themeForm");
      if (!state.admin.themeFiles.length) {
        await loadThemeFiles();
      }
      const datasetFile = adminThemeDatasetFile(theme);
      state.admin.themeForm = {
        id: theme.id,
        name: theme.name,
        slug: theme.slug,
        description: theme.description || "",
        sort_order: theme.sort_order || 0,
        is_active: theme.is_active
      };
      state.admin.themeFileForm = datasetFile
        ? themeFileFormFromFile(datasetFile)
        : {
            ...emptyThemeFileForm(theme.id),
            title: `${theme.name} 数据集说明`,
            description: ""
          };
      state.admin.themeFormOpen = true;
      openModalWithFocus(adminThemeFormRef);
    }

    async function deactivateTheme(theme) {
      if (!can("manage_themes")) return;
      const nextActive = !theme.is_active;
      try {
        await api.adminUpdateTheme(theme.id, { is_active: nextActive });
        showToast(nextActive ? "主题已启用" : "主题已停用");
        await loadAdmin();
        state.meta = await api.meta();
      } catch (error) {
        showToast(error.message || "主题状态更新失败");
      }
    }

    async function deleteTheme(theme) {
      if (!can("manage_themes")) return;
      const confirmed = await openConfirmDialog({
        title: "确认物理删除主题",
        message: `确认物理删除「${theme.name}」吗？该操作会删除主题和数据集说明 PDF 记录，并让关联课题失去主题分类，不能撤回。`,
        confirmText: "物理删除",
        cancelText: "取消",
        tone: "danger"
      });
      if (!confirmed) return;
      try {
        await api.adminDeleteTheme(theme.id);
        showToast("主题已物理删除");
        await loadAdmin();
        state.meta = await api.meta();
      } catch (error) {
        showToast(error.message || "主题物理删除失败");
      }
    }

    function newTheme() {
      closeMutuallyExclusiveModals("themeForm");
      state.admin.themeForm = emptyThemeForm();
      state.admin.themeFileForm = emptyThemeFileForm();
      state.admin.themeFormOpen = true;
      openModalWithFocus(adminThemeFormRef);
    }

    function closeThemeForm() {
      state.admin.themeFormOpen = false;
      state.admin.themeForm = emptyThemeForm();
      state.admin.themeFileForm = emptyThemeFileForm();
      restoreLastModalTrigger();
    }

    function newProject() {
      closeMutuallyExclusiveModals("projectForm");
      state.admin.projectForm = emptyProjectForm();
      state.admin.projectFormOpen = true;
      openModalWithFocus(adminProjectFormRef);
    }

    function closeProjectForm() {
      state.admin.projectFormOpen = false;
      state.admin.projectForm = emptyProjectForm();
      restoreLastModalTrigger();
    }

    async function editProject(project) {
      if (!can("manage_projects")) return;
      try {
        closeMutuallyExclusiveModals("projectForm");
        const detail = await api.adminProject(project.id);
        state.admin.projectForm = projectToForm(detail);
        state.admin.activeTab = "projects";
        state.admin.projectFormOpen = true;
        openModalWithFocus(adminProjectFormRef);
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

    function setProjectProgressDocumentFile(event) {
      const file = event.target.files?.[0] || null;
      state.admin.projectForm.progressDocumentUpload.file = file;
      if (file && !state.admin.projectForm.progressDocumentUpload.title) {
        state.admin.projectForm.progressDocumentUpload.title = file.name.replace(/\.[^.]+$/, "");
      }
    }

    function setMyProjectDocumentFile(event) {
      const file = event.target.files?.[0] || null;
      state.myProjectForm.documentUpload.file = file;
      if (file && !state.myProjectForm.documentUpload.title) {
        state.myProjectForm.documentUpload.title = file.name.replace(/\.[^.]+$/, "");
      }
    }

    async function uploadProjectDocument() {
      if (!can("manage_projects")) return;
      await uploadProjectDocumentForForm(state.admin.projectForm, api.adminUploadProjectDocuments, {
        successMessage: "课题 PDF 已上传",
        afterUpload: async () => {
          await Promise.all([
            loadAdminProjects({ reset: true }).catch(() => null),
            loadProjects({ reset: true }).catch(() => null)
          ]);
        }
      });
    }

    async function uploadProjectProgressDocument() {
      if (!can("manage_projects")) return;
      await uploadProjectDocumentForForm(state.admin.projectForm, api.adminUploadProjectDocuments, {
        uploadKey: "progressDocumentUpload",
        documentKind: "progress",
        successMessage: "进度 PDF 已上传",
        defaultDescription: "项目进度文档",
        afterUpload: async () => {
          await Promise.all([
            loadAdminProjects({ reset: true }).catch(() => null),
            loadProjects({ reset: true }).catch(() => null)
          ]);
          if (state.route.name === "project" && Number(state.route.params?.id) === Number(state.admin.projectForm.id)) {
            await loadProjectProgress(state.admin.projectForm.id).catch(() => null);
          }
        }
      });
    }

    async function uploadProjectDocumentForForm(form, uploadMethod, options = {}) {
      const uploadKey = options.uploadKey || "documentUpload";
      const upload = form[uploadKey];
      const documentKind = options.documentKind || "detail";
      const projectId = options.projectId || form.id;
      if (!projectId) {
        showToast("请先保存课题，再上传文档");
        return;
      }
      if (!upload.file) {
        showToast("请选择要上传的 PDF");
        return;
      }
      if (!String(upload.file.name || "").toLowerCase().endsWith(".pdf")) {
        showToast("课题详情只支持 PDF");
        return;
      }
      upload.uploading = true;
      try {
        const formData = new FormData();
        formData.append("project_id", String(projectId));
        formData.append("document_kind", options.documentKind || "detail");
        formData.append("doc_type", "pdf");
        formData.append("title", upload.title.trim());
        formData.append("description", upload.description.trim() || options.defaultDescription || (documentKind === "progress" ? "项目进度文档" : "课题 PDF 详情"));
        formData.append("files", upload.file);
        const data = await uploadMethod(formData);
        form.documents = data.documents || data.saved || [];
        form[uploadKey] = { ...emptyProjectDocumentUpload(documentKind), inputKey: upload.inputKey + 1 };
        if (!options.silent) {
          showToast(options.successMessage || "课题 PDF 已上传");
        }
        if (options.afterUpload) {
          await options.afterUpload(data);
        }
        return data;
      } catch (error) {
        if (!options.silent) {
          showToast(error.message || "课题 PDF 上传失败");
          return null;
        }
        throw error;
      } finally {
        upload.uploading = false;
      }
    }

    async function deleteProjectDocument(document) {
      if (!can("manage_projects")) return;
      await deleteProjectDocumentForForm(document, state.admin.projectForm, api.adminDeleteProjectDocument, {
        successMessage: "课题文档已删除"
      });
    }

    async function deleteMyProjectDocument(document) {
      if (!state.user) return;
      await deleteProjectDocumentForForm(document, state.myProjectForm, api.deleteProjectDocument, {
        successMessage: "课题文档已删除",
        afterDelete: async () => {
          await Promise.all([
            loadMyProjects({ reset: true }).catch(() => null),
            loadProjects({ reset: true }).catch(() => null),
            loadDashboard().catch(() => null)
          ]);
        }
      });
    }

    async function deleteProjectDocumentForForm(document, form, deleteMethod, options = {}) {
      const confirmed = await openConfirmDialog({
        title: "确认删除文档",
        message: `确认删除「${document.title || document.path}」吗？`,
        confirmText: "删除文档"
      });
      if (!confirmed) return;
      try {
        const data = await deleteMethod(document.id);
        form.documents = data.documents || [];
        showToast(options.successMessage || "课题文档已删除");
        if (options.afterDelete) {
          await options.afterDelete(data);
        }
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
      await bulkUpdateSelectedProjects({ action: "archive", successVerb: "归档", failureMessage: "批量归档课题失败" });
    }

    async function bulkPublishSelectedProjects(isPublic) {
      await bulkUpdateSelectedProjects({
        action: "set_public",
        is_public: Boolean(isPublic),
        successVerb: isPublic ? "公开" : "取消公开",
        failureMessage: isPublic ? "批量公开课题失败" : "批量取消公开课题失败"
      });
    }

    async function bulkSetSelectedProjectStage() {
      await bulkUpdateSelectedProjects({
        action: "set_stage",
        stage: state.admin.bulkProjectStage,
        successVerb: "设置阶段",
        failureMessage: "批量设置课题阶段失败"
      });
    }

    async function bulkDeleteSelectedProjects() {
      if (!can("manage_projects") || !state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting) return;
      const count = state.admin.selectedProjectIds.length;
      const confirmed = await openConfirmDialog({
        title: "确认批量物理删除课题",
        message: `确认物理删除选中的 ${count} 个课题吗？该操作会删除课题、互动关系、任务结果和课题 PDF 记录，不能撤回。`,
        confirmText: "批量物理删除",
        tone: "danger"
      });
      if (!confirmed) return;
      await bulkUpdateSelectedProjects({ action: "delete", successVerb: "删除", failureMessage: "批量物理删除课题失败" });
    }

    async function bulkUpdateSelectedProjects(options) {
      if (!can("manage_projects") || !state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting) return;
      const ids = [...state.admin.selectedProjectIds];
      state.admin.bulkArchivingProjects = options.action === "archive";
      state.admin.bulkProjectActionSubmitting = true;
      try {
        const result = await api.adminBulkProjectAction({
          ids,
          action: options.action,
          stage: options.stage,
          is_public: options.is_public
        });
        const affectedCount = result.affected_count || 0;
        const missingCount = result.missing_ids?.length || 0;
        state.admin.selectedProjectIds = [];
        showToast(
          missingCount
            ? `已${options.successVerb} ${affectedCount} 个课题，${missingCount} 个课题不存在或已不可用`
            : `已${options.successVerb} ${affectedCount} 个课题`
        );
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || options.failureMessage || "批量操作课题失败");
      } finally {
        state.admin.bulkProjectActionSubmitting = false;
        state.admin.bulkArchivingProjects = false;
      }
    }

    async function archiveProject(project) {
      if (!can("manage_projects")) return;
      if (!project?.id || project.stage === "archived") return;
      try {
        await api.adminUpdateProject(project.id, { stage: "archived", is_public: false });
        showToast("课题已归档");
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "课题归档失败");
      }
    }

    async function deleteAdminProject(project) {
      if (!can("manage_projects")) return;
      const confirmed = await openConfirmDialog({
        title: "确认物理删除课题",
        message: `确认物理删除「${project.title}」吗？该操作会删除课题、互动关系、任务结果和课题 PDF 记录，不能撤回。`,
        confirmText: "物理删除",
        tone: "danger"
      });
      if (!confirmed) return;
      try {
        await api.adminDeleteProject(project.id);
        showToast("课题已物理删除");
        await loadAdminProjects({ reset: true });
        await loadProjects({ reset: true });
      } catch (error) {
        showToast(error.message || "课题物理删除失败");
      }
    }

    async function loadThemeFiles() {
      if (!can("manage_themes")) {
        state.admin.themeFiles = [];
        return;
      }
      try {
        const data = await api.adminThemeFiles({ active: "1", page_size: 500 });
        state.admin.themeFiles = data.results;
      } catch (error) {
        showToast(error.message);
      }
    }

    async function saveThemeFile(options = {}) {
      if (!can("manage_themes")) return;
      const { reset = true, silent = false } = options;
      try {
        const payload = {
          theme_id: Number(state.admin.themeFileForm.theme_id),
          section: state.admin.themeFileForm.section,
          file_type: state.admin.themeFileForm.file_type,
          title: state.admin.themeFileForm.title,
          description: state.admin.themeFileForm.description,
          path: state.admin.themeFileForm.path,
          detail_pdf_title: state.admin.themeFileForm.detail_pdf_title,
          detail_pdf_path: state.admin.themeFileForm.detail_pdf_path,
          sort_order: Number(state.admin.themeFileForm.sort_order || 0),
          is_active: state.admin.themeFileForm.is_active
        };
        if (!payload.theme_id || !payload.title) {
          showToast("主题和数据集名称不能为空");
          return;
        }
        let savedFile = null;
        if (state.admin.themeFileForm.id) {
          savedFile = await api.adminUpdateThemeFile(state.admin.themeFileForm.id, payload);
          if (!silent) showToast("数据集说明已更新");
        } else {
          savedFile = await api.adminCreateThemeFile(payload);
          if (!silent) showToast("数据集说明已创建");
        }
        state.admin.themeFileForm = reset
          ? emptyThemeFileForm()
          : themeFileFormFromFile(savedFile, state.admin.themeFileForm.detailPdfUpload);
        await loadThemeFiles();
        return savedFile;
      } catch (error) {
        if (!silent) showToast(error.message || "数据集说明保存失败");
        else throw error;
        return null;
      }
    }

    function setThemeFileDetailPdfFile(event) {
      const file = event.target.files?.[0] || null;
      state.admin.themeFileForm.detailPdfUpload.file = file;
      if (file && !state.admin.themeFileForm.detailPdfUpload.title) {
        state.admin.themeFileForm.detailPdfUpload.title = file.name.replace(/\.[^.]+$/, "");
      }
    }

    async function uploadThemeFileDetailPdf(options = {}) {
      if (!can("manage_themes")) return;
      const { fileId: explicitFileId = null, silent = false } = options;
      const form = state.admin.themeFileForm;
      const upload = form.detailPdfUpload;
      if (!upload.file) {
        if (!silent) showToast("请选择 PDF 文件");
        return;
      }
      if (!String(upload.file.name || "").toLowerCase().endsWith(".pdf")) {
        if (!silent) showToast("数据集说明只支持 PDF");
        return;
      }
      upload.uploading = true;
      try {
        let fileId = explicitFileId || form.id;
        if (!fileId) {
          const savedFile = await saveThemeFile({ reset: false, silent: true });
          fileId = savedFile?.id;
          if (!fileId) return;
        }
        const formData = new FormData();
        formData.append("title", upload.title.trim() || upload.file.name.replace(/\.[^.]+$/, ""));
        formData.append("file", upload.file);
        const updatedFile = await api.adminUploadThemeFileDetailPdf(fileId, formData);
        state.admin.themeFileForm = themeFileFormFromFile(
          updatedFile,
          { ...emptyThemeFileDetailPdfUpload(), inputKey: upload.inputKey + 1 }
        );
        await loadThemeFiles();
        if (!silent) showToast("数据集说明 PDF 已上传");
        return updatedFile;
      } catch (error) {
        if (!silent) showToast(error.message || "数据集说明 PDF 上传失败");
        else throw error;
      } finally {
        upload.uploading = false;
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

    async function fetchAllAdminProjectPages(params = {}) {
      const rows = [];
      let page = 1;
      let hasNext = true;
      let pagination = null;
      const requestParams = {
        ...params,
        page_size: params.page_size || ADMIN_PROJECT_PAGE_SIZE
      };
      while (hasNext) {
        const data = await api.adminProjects({ ...requestParams, page });
        rows.push(...(data.results || []));
        pagination = data.pagination || pagination;
        hasNext = Boolean(pagination?.has_next);
        page += 1;
      }
      return {
        results: rows,
        pagination: {
          ...(pagination || {}),
          page: 1,
          page_size: rows.length || requestParams.page_size,
          total_pages: 1,
          total_count: pagination?.total_count ?? rows.length,
          has_next: false,
          has_previous: false
        }
      };
    }

    async function fetchAllAdminProjects(params = {}) {
      const data = await fetchAllAdminProjectPages(params);
      return data.results;
    }

    async function openTaskProjectDetail(project) {
      closeMutuallyExclusiveModals("taskProjectDetail");
      state.admin.taskProjectDetail.open = true;
      state.admin.taskProjectDetail.loading = true;
      state.admin.taskProjectDetail.project = project;
      state.admin.taskProjectDetail.interactions = [];
      state.admin.taskProjectDetail.contributions = [];
      openModalWithFocus(taskProjectDetailRef);
      try {
        const detail = await api.adminProject(project.id);
        const [interactions, contributions] = await Promise.all([
          fetchProjectApprovedInteractions(detail),
          fetchProjectContributions(detail)
        ]);
        state.admin.taskProjectDetail.project = detail;
        state.admin.taskProjectDetail.interactions = interactions;
        state.admin.taskProjectDetail.contributions = contributions;
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
      restoreLastModalTrigger();
    }

    async function fetchProjectApprovedInteractions(project) {
      const card = await api.projectStatusCard(project.id);
      return (card.uid_groups?.groups || [])
        .filter((group) => ["interest", "claim", "sponsor"].includes(group.type) && group.status === "approved")
        .map((group) => ({
          label: group.type === "sponsor" ? "已获批资助" : group.label,
          items: (group.uids || []).map((uid) => ({
            id: `${group.key}-${uid}`,
            type: group.type,
            user: { uid },
            subtype_label: group.subtype_label || (group.type === "sponsor" ? "资助" : ""),
            status_label: group.status_label || "已通过"
          }))
        }));
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
      if (rows.some((item) => Array.isArray(item.items))) {
        return rows;
      }
      const groups = new Map();
      for (const item of rows) {
        const label = item.type_label || "协作";
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(item);
      }
      return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
    }

    function buildAdminInteractionRows(rows = []) {
      const result = [];
      const sponsorGroups = new Map();
      for (const item of rows || []) {
        if (item.type !== "sponsor") {
          result.push(item);
          continue;
        }
        const key = `sponsor-${item.project?.id || "unknown"}-${item.user?.uid || "unknown"}`;
        if (!sponsorGroups.has(key)) {
          sponsorGroups.set(key, {
            key,
            type: "sponsor_group",
            isSponsorGroup: true,
            project: item.project,
            user: item.user,
            items: [],
            status: item.status,
            status_label: item.status_label
          });
          result.push(sponsorGroups.get(key));
        }
        const group = sponsorGroups.get(key);
        group.items.push(item);
        if (item.status === "pending") {
          group.status = "pending";
          group.status_label = "含待处理";
        }
      }
      sponsorGroups.forEach((group) => {
        group.items.sort((a, b) => applicationStatusRank(a.status) - applicationStatusRank(b.status) || String(a.subtype_label || "").localeCompare(String(b.subtype_label || "")));
      });
      return result;
    }

    function adminInteractionSummary(item) {
      if (!item) return "";
      if (item.type === "claim" && item.detail?.claimed_unit_name) return `拟认领第一单位：${item.detail.claimed_unit_name}`;
      return item.message || topicCode(item.project);
    }

    function adminSponsorGroupSummary(group) {
      return (group?.items || []).map((item) => `${item.subtype_label}（${item.status_label}）`).join("、");
    }

    function reviewContextRowsForItem(item, rows = []) {
      if (!item) return [];
      return (rows || [])
        .filter((row) => {
          if (!row || row.type !== item.type || row.project?.id !== item.project?.id) return false;
          if (item.type === "claim") return row.subtype === item.subtype;
          if (item.type === "sponsor") return row.user?.uid === item.user?.uid;
          return true;
        })
        .sort((a, b) => applicationStatusRank(a.status) - applicationStatusRank(b.status) || String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
    }

    function reviewContextSummary() {
      const rows = state.admin.reviewModal.context || [];
      if (!rows.length) return "暂未找到同课题同类型历史记录。";
      const counts = rows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {});
      return `同课题上下文：待处理 ${counts.pending || 0}，已通过 ${counts.approved || 0}，已拒绝 ${counts.rejected || 0}，已撤回 ${counts.withdrawn || 0}`;
    }

    function reviewContextLine(row) {
      if (!row) return "";
      const uid = row.user?.uid || "未知用户";
      const subtype = row.subtype_label || row.type_label || "申请";
      const status = row.status_label || claimStatusLabel(row.status);
      const review = row.review_comment ? ` · ${row.review_comment}` : "";
      return `${uid} · ${subtype} · ${status}${review}`;
    }

    async function loadReviewContext(item) {
      if (!item?.type || !item?.project) return;
      state.admin.reviewModal.loadingContext = true;
      try {
        const data = await api.adminInteractions({
          type: item.type,
          project: topicCode(item.project),
          page_size: 100
        });
        if (state.admin.reviewModal.item?.id === item.id && state.admin.reviewModal.item?.type === item.type) {
          state.admin.reviewModal.context = reviewContextRowsForItem(item, data.results || []);
        }
      } catch (error) {
        if (state.admin.reviewModal.item?.id === item.id && state.admin.reviewModal.item?.type === item.type) {
          state.admin.reviewModal.contextError = error.message || "审批上下文加载失败";
        }
      } finally {
        if (state.admin.reviewModal.item?.id === item.id && state.admin.reviewModal.item?.type === item.type) {
          state.admin.reviewModal.loadingContext = false;
        }
      }
    }

    function reviewModalTitle() {
      const action = state.admin.reviewModal.status === "approved" ? "通过申请" : "拒绝申请";
      const item = state.admin.reviewModal.item;
      return `${action}：${item?.subtype_label || item?.type_label || "协作申请"}`;
    }

    function reviewModalDescription() {
      const item = state.admin.reviewModal.item;
      if (!item) return "";
      return `${item.user?.uid || "未知用户"} · ${topicCode(item.project)} · ${item.project?.title || "未命名课题"}`;
    }

    function reviewPresetReasons() {
      const item = state.admin.reviewModal.item;
      if (state.admin.reviewModal.status === "approved") {
        return ["申请信息完整，予以通过", "资助资源确认，予以通过"];
      }
      if (item?.type === "claim") {
        return ["申请说明不足，请补充职责承担计划", "该课题已有同类型认领，请重新选择课题"];
      }
      return ["资助资源说明不足，请补充额度或周期", "当前课题阶段暂不适合接收该资助"];
    }

    function applyReviewPreset(reason) {
      state.admin.reviewModal.review_note = reason;
      state.admin.reviewModal.error = "";
    }

    function openReviewModal(item, status, event = null) {
      if (!can("review_interactions")) return;
      if (!canReviewInteraction(item)) {
        showToast("只有待处理申请可以审核");
        return;
      }
      closeMutuallyExclusiveModals("reviewModal");
      state.admin.reviewModal.open = true;
      state.admin.reviewModal.item = item;
      state.admin.reviewModal.status = status;
      state.admin.reviewModal.review_note = status === "approved" ? "审核通过" : "";
      state.admin.reviewModal.context = reviewContextRowsForItem(item, state.admin.interactions);
      state.admin.reviewModal.loadingContext = false;
      state.admin.reviewModal.contextError = "";
      state.admin.reviewModal.error = "";
      state.admin.reviewModal.submitting = false;
      openModalWithFocus(reviewModalRef, event?.currentTarget || null);
      loadReviewContext(item);
    }

    function closeReviewModal(force = false) {
      if (state.admin.reviewModal.submitting && !force) return;
      state.admin.reviewModal.open = false;
      state.admin.reviewModal.item = null;
      state.admin.reviewModal.review_note = "";
      state.admin.reviewModal.context = [];
      state.admin.reviewModal.loadingContext = false;
      state.admin.reviewModal.contextError = "";
      state.admin.reviewModal.error = "";
      state.admin.reviewModal.submitting = false;
      restoreLastModalTrigger();
    }

    async function submitReviewModal() {
      const item = state.admin.reviewModal.item;
      const status = state.admin.reviewModal.status;
      if (!item?.id) return;
      const reviewNote = String(state.admin.reviewModal.review_note || "").trim();
      if (status === "rejected" && !reviewNote) {
        state.admin.reviewModal.error = "拒绝申请时必须填写审核意见。";
        return;
      }
      state.admin.reviewModal.submitting = true;
      try {
        await api.reviewAdminInteraction(item.type, item.id, { status, review_note: reviewNote });
        invalidateProjectStatusCard(item.project?.id);
        closeReviewModal(true);
        showToast(status === "approved" ? "申请已通过" : "申请已拒绝");
        await Promise.all([loadAdminInteractions({ reset: true }), loadDashboard().catch(() => null)]);
      } catch (error) {
        state.admin.reviewModal.error = error.errors?.review_note?.[0] || error.message || "审核失败";
        showToast(error.message || "审核失败");
      } finally {
        state.admin.reviewModal.submitting = false;
      }
    }

    function reviewInteraction(item, status, event = null) {
      openReviewModal(item, status, event);
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
      if (next !== "themeForm" && state.admin.themeFormOpen) {
        closeThemeForm();
      }
      if (next !== "myProjectForm" && state.myProjectFormOpen) {
        closeMyProjectForm();
      }
      if (next !== "leadClaim" && state.leadClaimModal.open) {
        closeLeadClaimModal(true);
      }
      if (next !== "paperClaim" && state.paperClaimModal.open) {
        closePaperClaimModal(true);
      }
      if (next !== "sponsor" && state.sponsorModal.open) {
        closeSponsorModal(true);
      }
      if (next !== "reviewModal" && state.admin.reviewModal.open) {
        closeReviewModal(true);
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

    async function exportContentBackup() {
      if (!can("manage_projects") || !can("manage_themes")) return;
      state.admin.backup.exporting = true;
      try {
        const { blob, filename } = await api.adminExportContentBackup();
        downloadBlob(blob, filename || "openmedailab-content-backup.zip");
        showToast("备份 ZIP 已开始下载");
      } catch (error) {
        showToast(error.message || "备份导出失败");
      } finally {
        state.admin.backup.exporting = false;
      }
    }

    function setContentBackupFile(event) {
      const file = event.target.files?.[0] || null;
      if (file && !String(file.name || "").toLowerCase().endsWith(".zip")) {
        state.admin.backup.file = null;
        state.admin.backup.inputKey += 1;
        showToast("请选择 zip 备份文件");
        return;
      }
      state.admin.backup.file = file;
      state.admin.backup.result = null;
    }

    async function restoreContentBackup() {
      if (!can("manage_projects") || !can("manage_themes")) return;
      const file = state.admin.backup.file;
      if (!file) {
        showToast("请先选择备份 ZIP");
        return;
      }
      const confirmed = await openConfirmDialog({
        title: "确认恢复备份",
        message: `确认恢复「${file.name}」吗？同编号课题和同 slug 主题会被备份内容更新。`,
        confirmText: "开始恢复",
        tone: "danger"
      });
      if (!confirmed) return;
      state.admin.backup.restoring = true;
      try {
        const formData = new FormData();
        formData.append("file", file);
        const result = await api.adminRestoreContentBackup(formData);
        state.admin.backup.result = result;
        state.admin.backup.file = null;
        state.admin.backup.inputKey += 1;
        showToast("备份恢复完成");
        await Promise.all([
          loadAdminOverview().catch(() => null),
          loadAdminThemes().catch(() => null),
          loadAdminProjects({ reset: true }).catch(() => null),
          loadProjects({ reset: true }).catch(() => null)
        ]);
      } catch (error) {
        showToast(error.message || "备份恢复失败");
      } finally {
        state.admin.backup.restoring = false;
      }
    }

    async function loadSidebarQrs() {
      state.admin.loadingSidebarQrs = true;
      try {
        const data = await api.sidebarQrs();
        state.admin.sidebarQrs = data.entries || [];
        state.meta.sidebar_qr_entries = data.entries || [];
      } catch (error) {
        showToast(error.message || "二维码配置读取失败");
      } finally {
        state.admin.loadingSidebarQrs = false;
      }
    }

    function sidebarQrUploadState(key) {
      if (!state.admin.sidebarQrUploads[key]) {
        state.admin.sidebarQrUploads[key] = {
          file: null,
          inputKey: 0,
          uploading: false
        };
      }
      return state.admin.sidebarQrUploads[key];
    }

    function setSidebarQrUploadFile(entry, event) {
      const upload = sidebarQrUploadState(entry.key);
      upload.file = event.target.files?.[0] || null;
    }

    async function uploadSidebarQr(entry) {
      if (!can("view_admin_console")) return;
      const upload = sidebarQrUploadState(entry.key);
      if (!upload.file) {
        showToast("请选择二维码图片");
        return;
      }
      upload.uploading = true;
      try {
        const formData = new FormData();
        formData.append("file", upload.file);
        const data = await api.adminUploadSidebarQr(entry.key, formData);
        syncSidebarQrEntry(data.entry);
        upload.file = null;
        upload.inputKey += 1;
        showToast(`${entry.label}二维码已更新`);
      } catch (error) {
        showToast(error.message || "二维码上传失败");
      } finally {
        upload.uploading = false;
      }
    }

    function syncSidebarQrEntry(entry) {
      if (!entry) return;
      state.admin.sidebarQrs = replaceSidebarQrEntry(state.admin.sidebarQrs, entry);
      state.meta.sidebar_qr_entries = replaceSidebarQrEntry(state.meta.sidebar_qr_entries, entry);
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
      downloadBlob(blob, "openmedailab-project-template.json");
      showToast("JSON 模板已下载");
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function chooseJsonImportDirectory() {
      if (state.admin.jsonImport.applying) return;
      if (typeof window.showDirectoryPicker === "function") {
        try {
          const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
          const directoryFiles = await filesFromDirectoryHandle(directoryHandle);
          await processJsonImportFiles(directoryFiles);
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      const input = jsonImportDirectoryInput.value;
      if (!directoryInputSupportsFolders(input)) {
        showToast("当前浏览器不支持目录选择，已改为选择目录内 JSON/PDF 文件");
        chooseJsonImportMixedFiles();
        return;
      }
      input.value = "";
      input.click();
    }

    function directoryInputSupportsFolders(input) {
      const inputPrototype = typeof HTMLInputElement === "undefined" ? null : HTMLInputElement.prototype;
      return Boolean(input && ("webkitdirectory" in input || (inputPrototype && "webkitdirectory" in inputPrototype)));
    }

    function chooseJsonImportMixedFiles() {
      if (state.admin.jsonImport.applying) return;
      const input = jsonImportMixedFilesInput.value;
      if (!input) {
        showToast("当前浏览器无法打开文件选择器");
        return;
      }
      input.value = "";
      input.click();
    }

    function chooseJsonImportJsonFiles() {
      if (state.admin.jsonImport.applying) return;
      const input = jsonImportJsonFilesInput.value;
      if (!input) {
        showToast("当前浏览器无法打开文件选择器");
        return;
      }
      input.value = "";
      input.click();
    }

    async function handleJsonFiles(event) {
      await processJsonImportFiles(event.target.files || []);
      event.target.value = "";
    }

    async function processJsonImportFiles(rawFiles) {
      const selectedFiles = normalizeProjectImportFiles(rawFiles);
      if (!selectedFiles.length) {
        showToast("未选择文件或当前浏览器不支持目录选择，请使用选择目录内 JSON/PDF 文件");
        return;
      }
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
    }

    async function filesFromDirectoryHandle(directoryHandle, parentPath = "") {
      const files = [];
      for await (const [name, handle] of directoryHandle.entries()) {
        const relativePath = parentPath ? `${parentPath}/${name}` : name;
        if (handle.kind === "directory") {
          files.push(...(await filesFromDirectoryHandle(handle, relativePath)));
          continue;
        }
        if (handle.kind !== "file") continue;
        const file = await handle.getFile();
        files.push({
          file,
          name: file.name || name,
          relativePath,
          text: () => file.text()
        });
      }
      return files;
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
        resetThemeSortState(themes.results || []);
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
          formData.append("files", projectImportUploadFile(row.documentFile));
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
      resetThemeSortState([...state.admin.themes, theme]);
      return theme;
    }

    function openConfirmDialog(options = {}) {
      if (confirmDialogResolver) {
        confirmDialogResolver(false);
      }
      rememberModalTrigger();
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
        focusFirstModalControl(confirmDialogRef);
      });
    }

    function resolveConfirmDialog(result) {
      state.confirmDialog.open = false;
      const resolver = confirmDialogResolver;
      confirmDialogResolver = null;
      if (resolver) resolver(Boolean(result));
      restoreLastModalTrigger();
    }

    function rememberModalTrigger(trigger = null) {
      const candidate = trigger || document.activeElement;
      lastModalTrigger = candidate && typeof candidate.focus === "function" ? candidate : null;
    }

    function restoreLastModalTrigger() {
      const target = lastModalTrigger;
      lastModalTrigger = null;
      if (target && document.contains(target) && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    }

    function modalElement(modalRef) {
      return modalRef?.value || modalRef || null;
    }

    function modalFocusableControls(modalRef) {
      const modal = modalElement(modalRef);
      if (!modal?.querySelectorAll) return [];
      return Array.from(modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.disabled && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
    }

    function focusFirstModalControl(modalRef) {
      nextTick(() => {
        const controls = modalFocusableControls(modalRef);
        (controls[0] || modalElement(modalRef))?.focus?.({ preventScroll: true });
      });
    }

    function openModalWithFocus(modalRef, trigger = null) {
      rememberModalTrigger(trigger);
      focusFirstModalControl(modalRef);
    }

    function trapModalFocus(event, modalRef) {
      if (event.key !== "Tab") return;
      const controls = modalFocusableControls(modalRef);
      if (!controls.length) {
        event.preventDefault();
        modalElement(modalRef)?.focus?.({ preventScroll: true });
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
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
      if (state.leadClaimModal.open) {
        closeLeadClaimModal(true);
      }
      if (state.paperClaimModal.open) {
        closePaperClaimModal(true);
      }
      if (state.sponsorModal.open) {
        closeSponsorModal(true);
      }
      if (state.admin.reviewModal.open) {
        closeReviewModal(true);
      }
      if (state.admin.taskProjectDetail.open) {
        closeTaskProjectDetail();
      }
      if (state.admin.projectFormOpen) {
        closeProjectForm();
      }
      if (state.admin.themeFormOpen) {
        closeThemeForm();
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
      if (event.key === "Escape" && state.myProjectFormOpen) {
        closeMyProjectForm();
        return;
      }
      if (event.key === "Escape" && state.admin.themeFormOpen) {
        closeThemeForm();
        return;
      }
      if (event.key === "Escape" && state.admin.taskProjectDetail.open) {
        closeTaskProjectDetail();
        return;
      }
      if (event.key === "Escape" && state.releaseModalOpen) {
        closeReleaseModal();
        return;
      }
      if (event.key === "Escape" && state.leadClaimModal.open) {
        closeLeadClaimModal();
        return;
      }
      if (event.key === "Escape" && state.paperClaimModal.open) {
        closePaperClaimModal();
        return;
      }
      if (event.key === "Escape" && state.sponsorModal.open) {
        closeSponsorModal();
        return;
      }
      if (event.key === "Escape" && state.admin.reviewModal.open) {
        closeReviewModal();
        return;
      }
      if (event.key === "Escape" && state.claimReasonTooltip.visible) {
        hideClaimReasonTooltip();
        return;
      }
      if (event.key === "Escape" && state.profileMenuOpen) {
        closeProfileMenu();
        return;
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

    function openProfileMenuFromTrigger(event) {
      window.clearTimeout(openProfileMenu.closeTimer);
      state.profileMenuOpen = true;
      event?.currentTarget?.blur();
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
      openModalWithFocus(releaseModalRef);
    }

    function closeReleaseModal() {
      state.releaseModalOpen = false;
      restoreLastModalTrigger();
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
      homeThemeCards,
      homeThemeRowColumnCount,
      homeThemeRowThemes,
      selectedThemeDatasetPdfHref,
      platformStats,
      sidebarQrEntries,
      faqQrEntries,
      sponsorTypeOptions,
      quickSponsorTypeOptions,
      moreSponsorTypeOptions,
      authorshipIntentOptions,
      sidebarQrImageSrc,
      sidebarQrAlt,
      FAQ_ENTRIES,
      roleCards,
      favoriteProjects,
      myProjectTasks,
      myApplicationRows,
      adminInteractionRows,
      workspaceOverviewCards,
      adminOverviewCards,
      projectProgressDocuments,
      projectProgressTimelineItems,
      releaseLatest,
      releaseHistoryItems,
      jsonImportJsonFilesInput,
      jsonImportDirectoryInput,
      jsonImportMixedFilesInput,
      confirmDialogRef,
      participationModalRef,
      leadClaimModalRef,
      paperClaimModalRef,
      sponsorModalRef,
      reviewModalRef,
      releaseModalRef,
      myProjectFormRef,
      adminProjectFormRef,
      adminThemeFormRef,
      contributionModalRef,
      taskProjectDetailRef,
      trapModalFocus,
      can,
      navigate,
      applyFilters,
      selectTheme,
      topicThemeCardStyle,
      loadMoreProjects,
      loadProjectProgress,
      loadProjectDiscussions,
      submitProjectDiscussion,
      updateProjectDiscussion,
      deleteProjectDiscussion,
      moderateProjectDiscussion,
      canManageDiscussion,
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
      projectSummaryText,
      projectCardTitle,
      projectCreatorContact,
      contactName,
      contactWechatText,
      teamContactMembers,
      showProjectCreatorContactCard,
      showTeamContactCard,
      scheduleHideContactHoverCard,
      cancelContactHoverCardHide,
      hideContactHoverCard,
      canReviewInteraction,
      openProfileMenu,
      openProfileMenuFromTrigger,
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
      submitParticipationRequest,
      handleParticipationAction,
      closeParticipationModal,
      submitParticipationModal,
      withdrawParticipationRequest,
      isParticipationRequested,
      isSubmittingParticipation,
      isWithdrawingParticipation,
      participationButtonLabel,
      canClickParticipation,
      submitLeadClaim,
      closeLeadClaimModal,
      submitLeadClaimModal,
      leadClaimButtonLabel,
      canClickLeadClaim,
      claimButtonAriaDisabled,
      showClaimReasonTooltip,
      hideClaimReasonTooltip,
      submitPaperClaim,
      closePaperClaimModal,
      submitPaperClaimModal,
      paperClaimButtonLabel,
      canClickPaperClaim,
      submitSponsor,
      closeSponsorModal,
      submitSponsorModal,
      withdrawSponsorRequest,
      sponsorButtonLabel,
      interactionButtonActive,
      canClickSponsor,
      activeSponsorTypesForProject,
      activeSponsorRequestsForProject,
      quickActiveSponsorRequestsForProject,
      sponsorRequestStatusLabel,
      selfRelationLabels,
      primarySelfRelationLabel,
      secondarySelfRelationLabels,
      hasSelfRelation,
      withdrawInteraction,
      taskProgressLabel,
      taskParticipantUids,
      setWorkspaceTab,
      loadMyProjects,
      myProjectQuotaText,
      canCreateMyProject,
      canEditMyProject,
      canDeleteMyProject,
      myProjectStageEditable,
      newMyProject,
      editMyProject,
      closeMyProjectForm,
      saveMyProject,
      deleteMyProject,
      saveProfile,
      submitCreditTransfer,
      startMyTask,
      applicationTitle,
      applicationReviewLine,
      applicationMessageLine,
      applicationActionLabel,
      handleApplicationAction,
      openContributionModal,
      closeContributionModal,
      submitContribution,
      setContributionFile,
      clearContributionFile,
      myTaskStatusLabel,
      taskRelationSummary,
      canSubmitProjectTask,
      taskSubmitHint,
      contributionStatusText,
      contributionFileHref,
      contributionFileName,
      saveTheme,
      newTheme,
      editTheme,
      closeThemeForm,
      moveThemeSort,
      restoreThemeSort,
      saveThemeSort,
      deactivateTheme,
      deleteTheme,
      adminThemeDatasetFile,
      newProject,
      editProject,
      closeProjectForm,
      saveProject,
      setProjectDocumentFile,
      setProjectProgressDocumentFile,
      uploadProjectDocument,
      uploadProjectProgressDocument,
      deleteProjectDocument,
      setMyProjectDocumentFile,
      deleteMyProjectDocument,
      isAdminProjectSelected,
      areAllVisibleAdminProjectsSelected,
      toggleAdminProjectSelection,
      toggleVisibleAdminProjectsSelection,
      bulkArchiveSelectedProjects,
      bulkPublishSelectedProjects,
      bulkSetSelectedProjectStage,
      bulkDeleteSelectedProjects,
      prepareTaskForProject,
      setThemeFileDetailPdfFile,
      formatFileSize,
      setAdminTab,
      loadSidebarQrs,
      sidebarQrUploadState,
      setSidebarQrUploadFile,
      uploadSidebarQr,
      searchAdminUsers,
      resetUserPassword,
      copyDefaultPassword,
      loadAdminInteractions,
      openReviewModal,
      closeReviewModal,
      submitReviewModal,
      reviewInteraction,
      adminInteractionSummary,
      adminSponsorGroupSummary,
      reviewModalTitle,
      reviewModalDescription,
      reviewContextSummary,
      reviewContextLine,
      reviewPresetReasons,
      applyReviewPreset,
      adminProjectVisibilityLabel,
      updateAdminProjectStage,
      loadAdminTasks,
      saveAdminTask,
      assignTaskToUid,
      updateTaskStatus,
      loadAdminContributions,
      loadAdminTaskProjects,
      openTaskProjectDetail,
      closeTaskProjectDetail,
      updateTaskProjectStage,
      approvedInteractionGroupsFor,
      loadAdminCredits,
      loadAdminAuditLogs,
      exportContentBackup,
      setContentBackupFile,
      restoreContentBackup,
      auditActionLabel,
      auditActorLabel,
      auditTargetLabel,
      auditSummary,
      formatAuditTime,
      claimStatusLabel,
      clearJsonImport,
      downloadJsonTemplate,
      chooseJsonImportJsonFiles,
      chooseJsonImportDirectory,
      chooseJsonImportMixedFiles,
      handleJsonFiles,
      refreshJsonImportRow,
      refreshAllJsonImportRows,
      openJsonImportPreview,
      closeJsonImportPreview,
      applyJsonImport,
      archiveProject,
      deleteAdminProject,
      searchAdminProjects,
      displayScore,
      topicCode,
      shortText,
      roleCountEntries,
      visibleProjectRoleGroups,
      projectRecruitmentText,
      requiredTeamRoles,
      projectFundingLabel,
      projectFundingReady,
      projectStageTone,
      projectStartupLabel,
      projectStartupText,
      projectStartupReady,
      projectDocuments,
      primaryProjectDocument,
      projectPdfHref,
      projectProgressDocumentsFor,
      projectDetailHref,
      hasPrimaryProjectPdf,
      projectCreatorLabel,
      documentDisplayTitle,
      documentHref,
      themeFileDetailPdfHref,
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
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'home'" aria-hidden="true">library_books</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'faq'" aria-hidden="true">help</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'dashboard'" aria-hidden="true">space_dashboard</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'favorites'" aria-hidden="true">bookmark</span>
            <span class="material-symbols-rounded" style="font-size: 20px;" v-if="item.name === 'admin'" aria-hidden="true">settings</span>
            {{ item.label }}
          </button>
        </nav>
        <div class="account-area">
          <button class="version-button" type="button" @click="openReleaseModal">v{{ state.meta.release?.version || '0.0.0' }}</button>
          <span class="site-micro-stats" aria-label="平台统计">注册 {{ platformStats.registered_user_count || 0 }} · 在线 {{ platformStats.online_user_count || 0 }}</span>
          <div
            v-if="state.user"
            class="profile-menu"
            :class="{ open: state.profileMenuOpen }"
            @mouseenter="openProfileMenu"
            @mouseleave="scheduleCloseProfileMenu"
            @focusin="openProfileMenu"
          >
            <button class="text-button profile-trigger" type="button" @click="openProfileMenuFromTrigger($event)" aria-haspopup="dialog" :aria-expanded="state.profileMenuOpen ? 'true' : 'false'">
              <span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">person</span>
              <span>{{ state.user.profile?.display_name || state.user.username }}</span>
            </button>
            <div class="profile-popover" role="dialog" aria-label="个人信息" @mouseenter="openProfileMenu">
              <strong>{{ state.user.profile?.display_name || state.user.username }}</strong>
              <small>{{ state.user.profile?.uid || '未分配 UID' }} · {{ state.user.profile?.role_type_label || roleInfo.role_label }}</small>
              <dl>
                <div><dt>机构</dt><dd>{{ state.user.profile?.organization || '未填写机构' }}</dd></div>
                <div><dt>邮箱</dt><dd>{{ state.user.email || state.user.profile?.contact_email || '未填写邮箱' }}</dd></div>
                <div><dt>积分</dt><dd>{{ state.user.profile?.credit_balance ?? 0 }}</dd></div>
              </dl>
              <div class="profile-actions">
                <button class="ghost-button" type="button" @click="state.workspaceTab = 'overview'; navigate('dashboard'); closeProfileMenu(); $event.currentTarget.blur()">个人中心</button>
                <button class="ghost-button" type="button" @click="state.workspaceTab = 'favorites'; navigate('dashboard'); closeProfileMenu(); $event.currentTarget.blur()">我的关注</button>
                <button class="ghost-button danger profile-logout" type="button" @click="logout(); closeProfileMenu(); $event.currentTarget.blur()"><span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">logout</span> 退出</button>
              </div>
            </div>
          </div>
          <template v-else>
            <button class="ghost-button" type="button" @click="navigate('login')"><span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">login</span> 登录</button>
            <button class="primary-button" type="button" @click="navigate('register')"><span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">person_add</span> 注册</button>
          </template>
        </div>
      </header>

      <main class="page">
        <div v-if="state.toast" class="toast" role="status" aria-live="polite" aria-atomic="true">{{ state.toast }}</div>
        <div
          v-if="state.claimReasonTooltip.visible"
          class="claim-reason-tooltip"
          data-testid="claim-reason-tooltip"
          :style="{ left: state.claimReasonTooltip.x + 'px', top: state.claimReasonTooltip.y + 'px' }"
          role="tooltip"
        >
          {{ state.claimReasonTooltip.text }}
        </div>
        <div
          v-if="state.contactHoverCard.visible"
          class="contact-hover-card floating-contact-card"
          data-testid="floating-contact-card"
          :style="{ left: state.contactHoverCard.x + 'px', top: state.contactHoverCard.y + 'px' }"
          role="tooltip"
          @mouseenter="cancelContactHoverCardHide"
          @mouseleave="hideContactHoverCard"
        >
          <strong>{{ state.contactHoverCard.title }}</strong>
          <template v-if="state.contactHoverCard.members.length">
            <span v-for="member in state.contactHoverCard.members" :key="member.uid || member.name" class="contact-member-row">
              <b>{{ contactName(member) }}</b>
              <small>{{ contactWechatText(member) }}</small>
            </span>
          </template>
          <small v-else>暂无可展示联系人</small>
        </div>
        <section v-if="state.booting" class="empty-state">
          <div class="loader"></div>
          <h2>正在载入课题库</h2>
        </section>

        <template v-else>
          <section v-if="activeView === 'home' || activeView === 'projects'" class="library-view">
            <div class="toolbar">
              <label class="search-box">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;" aria-hidden="true">search</span> 搜索</span>
                <input v-model="state.filters.q" type="search" placeholder="输入疾病、模型、任务或期刊" @keyup.enter="applyFilters" />
              </label>
              <label class="filter-group optional-mobile">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;" aria-hidden="true">category</span> 主题</span>
                <select v-model="state.filters.theme" @change="applyFilters">
                  <option value="">不限主题</option>
                  <option v-for="theme in state.meta.themes" :key="theme.slug" :value="theme.slug">{{ theme.name }}</option>
                </select>
              </label>
              <label class="filter-group optional-mobile">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;" aria-hidden="true">moving</span> 阶段</span>
                <select v-model="state.filters.stage" @change="applyFilters">
                  <option value="">全部阶段</option>
                  <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                </select>
              </label>
              <label class="filter-group optional-mobile">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 16px;" aria-hidden="true">sort</span> 排序</span>
                <select v-model="state.filters.sort" @change="applyFilters">
                  <option value="recommended">默认</option>
                  <option value="project_id">编号顺序</option>
                  <option value="newest">最新编号</option>
                  <option value="updated">最近更新</option>
                  <option value="follows">关注热度</option>
                  <option value="likes">点赞</option>
                </select>
              </label>
              <button class="primary-button" type="button" @click="applyFilters"><span class="material-symbols-rounded" aria-hidden="true">filter_list</span> 筛选</button>
            </div>

            <div class="theme-strip topic-theme-strip single-row" :style="{ '--home-theme-columns': homeThemeRowColumnCount }">
              <button
                class="theme-chip topic-theme-card theme-action-card all-projects-theme-trigger"
                :class="{ active: !state.filters.theme }"
                :style="topicThemeCardStyle()"
                type="button"
                @click="selectTheme('')"
              >
                <span>不限主题</span>
              </button>
              <button
                v-for="theme in homeThemeRowThemes"
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
              <div v-if="selectedTheme" class="selected-theme-heading">
                <h2>
                  <a
                    v-if="selectedThemeDatasetPdfHref"
                    class="theme-dataset-link"
                    :href="selectedThemeDatasetPdfHref"
                    target="_blank"
                    rel="noopener"
                    title="点击查看该主题的数据集说明文件"
                  >{{ selectedTheme.name }}</a>
                  <span v-else>{{ selectedTheme.name }}</span>
                </h2>
                <p v-if="selectedTheme.description">{{ selectedTheme.description }}</p>
              </div>
              <div v-else></div>
              <div class="section-head-actions">
                <dl class="inline-stats" aria-label="课题库统计">
                  <div><dt>课题</dt><dd>{{ stats.total }}</dd></div>
                  <div><dt>主题</dt><dd>{{ stats.themes }}</dd></div>
                  <div><dt>关注</dt><dd>{{ stats.follows }}</dd></div>
                </dl>
              </div>
            </div>

            <div class="project-grid">
              <article
                v-for="project in state.projects"
                :key="project.id"
                :data-project-id="project.id"
                data-testid="project-card"
                :class="['project-card project-list-card project-catalog-card', { 'project-card--self-related': hasSelfRelation(project) }]"
              >
                <span class="project-card-hover-strip" data-testid="project-status-strip" aria-hidden="true"></span>
                <span v-if="primarySelfRelationLabel(project)" class="self-relation-corner" data-testid="relation-corner-ribbon">{{ primarySelfRelationLabel(project) }}</span>
                <div :class="['project-card-headline', { 'project-card-headline--self-related': primarySelfRelationLabel(project) }]">
                  <div class="project-card-meta" data-testid="project-meta-row">
                    <span v-for="label in secondarySelfRelationLabels(project)" :key="label" class="self-relation-inline-chip" data-testid="my-relation-chip">{{ label }}</span>
                    <span data-testid="project-topic-chip">{{ topicCode(project) }}</span>
                    <span>{{ project.theme?.name || '未分类' }}</span>
                    <span class="project-stage-chip" :class="projectStageTone(project)">{{ project.stage_label }}</span>
                    <span class="project-funding-chip" :class="{ funded: projectFundingReady(project) }">{{ projectFundingLabel(project) }}</span>
                  </div>
                  <div class="project-card-side">
                    <dl class="project-card-counts" aria-label="课题互动统计">
                      <div><dt>点赞</dt><dd>{{ project.score_count || 0 }}</dd></div>
                      <div><dt>关注</dt><dd>{{ project.follow_count || 0 }}</dd></div>
                    </dl>
                    <span
                      class="project-card-uploader contact-hover-trigger"
                      tabindex="0"
                      @mouseenter="showProjectCreatorContactCard($event, project)"
                      @focus="showProjectCreatorContactCard($event, project)"
                      @mouseleave="scheduleHideContactHoverCard"
                      @blur="scheduleHideContactHoverCard"
                    >
                      {{ projectCreatorLabel(project) }}
                    </span>
                  </div>
                </div>
                <div class="project-card-body" data-testid="project-card-body">
                  <h3>
                    <a class="project-title-link" data-testid="project-title-link" :href="projectDetailHref(project)" @click.prevent="navigate('project', { id: project.id })">{{ projectCardTitle(project) }}</a>
                  </h3>
                  <div class="project-expanded-detail">
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
                <div class="project-card-bottom project-status-summary">
                  <div class="project-status-row">
                    <strong>招募</strong><span>{{ projectRecruitmentText(project) }}</span>
                  </div>
                  <div class="project-status-row project-role-groups compact">
                    <strong>组队</strong>
                    <div class="project-role-chip-row">
                      <span
                        v-for="role in requiredTeamRoles(project.team_status)"
                        :key="role.key"
                        class="team-role-chip contact-hover-trigger"
                        :class="{ ready: role.ready, overfilled: role.overfilled }"
                        tabindex="0"
                        @mouseenter="showTeamContactCard($event, role, project)"
                        @focus="showTeamContactCard($event, role, project)"
                        @mouseleave="scheduleHideContactHoverCard"
                        @blur="scheduleHideContactHoverCard"
                      >
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
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">thumb_up</span>
                      <span>{{ likeButtonLabel(project) }}</span>
                    </button>
                    <button v-if="shouldShowFollowButton(project)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(project), 'interaction-active': interactionButtonActive('follow', project) }" type="button" @click.stop="toggleFollow(project)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">star</span>
                      <span>{{ followButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', project) }" type="button" :disabled="!canClickParticipation(project)" @click.stop="handleParticipationAction(project)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">groups</span>
                      <span>{{ participationButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('lead', project), 'is-disabled': !canClickLeadClaim(project) }" type="button" :aria-disabled="claimButtonAriaDisabled(project, 'leader')" @mouseenter="showClaimReasonTooltip($event, project, 'leader')" @focus="showClaimReasonTooltip($event, project, 'leader')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitLeadClaim(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">supervisor_account</span>
                      <span>{{ leadClaimButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('paper', project), 'is-disabled': !canClickPaperClaim(project) }" type="button" :aria-disabled="claimButtonAriaDisabled(project, 'paper_first_unit')" @mouseenter="showClaimReasonTooltip($event, project, 'paper_first_unit')" @focus="showClaimReasonTooltip($event, project, 'paper_first_unit')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitPaperClaim(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">workspace_premium</span>
                      <span>{{ paperClaimButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button sponsor-action-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', project) }" type="button" :disabled="!canClickSponsor(project)" aria-controls="sponsor-popover" :aria-expanded="state.sponsorModal.open && state.sponsorModal.project?.id === project.id ? 'true' : 'false'" @click.stop="submitSponsor(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">volunteer_activism</span>
                      <span>{{ sponsorButtonLabel(project) }}</span>
                    </button>
                  </div>
                  <div v-if="hasPrimaryProjectPdf(project)" class="project-pdf-actions">
                    <a
                      class="ghost-button pdf-view-link"
                      :href="documentHref(primaryProjectDocument(project))"
                      target="_blank"
                      rel="noopener"
                      @click.stop
                    >
                      查看PDF
                    </a>
                    <a
                      class="ghost-button pdf-download-link"
                      :href="documentHref(primaryProjectDocument(project))"
                      download
                      @click.stop
                    >
                      下载PDF
                    </a>
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

          <section v-else-if="activeView === 'faq'" class="faq-view">
            <div class="section-head faq-head">
              <div>
                <span class="eyebrow">常见问答</span>
                <h1>协作前先看这里</h1>
                <p>这里整理了浏览课题、参与组队、发布课题和资助协作时最常见的问题。</p>
              </div>
            </div>
            <div class="faq-list" aria-label="常见问答列表">
              <article v-for="(item, index) in FAQ_ENTRIES" :key="item.question" class="content-panel faq-item">
                <span class="faq-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <div>
                  <h2>{{ item.question }}</h2>
                  <p>{{ item.answer }}</p>
                </div>
              </article>
            </div>
            <section v-if="faqQrEntries.length" class="faq-qr-section" aria-label="联系与社区二维码">
              <div class="panel-title-row compact-title-row">
                <div>
                  <h2>联系与社区</h2>
                  <p>扫码联系平台管理员或加入社区沟通。</p>
                </div>
              </div>
              <div class="faq-qr-grid">
                <article v-for="entry in faqQrEntries" :key="entry.key" class="faq-qr-card">
                  <header>
                    <span class="material-symbols-rounded" aria-hidden="true">{{ entry.icon }}</span>
                    <strong>{{ entry.label }}</strong>
                  </header>
                  <img :src="sidebarQrImageSrc(entry)" :alt="sidebarQrAlt(entry)" />
                </article>
              </div>
            </section>
          </section>

          <section v-else-if="activeView === 'project'" class="project-progress-page">
            <div v-if="state.projectProgress.loading" class="empty-state">
              <div class="loader"></div>
              <h2>正在读取课题进度</h2>
            </div>
            <template v-else-if="state.projectProgress.project">
              <div class="section-head project-progress-head">
                <div>
                  <span class="eyebrow">{{ topicCode(state.projectProgress.project) }} · {{ state.projectProgress.project.theme?.name || '未分类' }}</span>
                  <h1>{{ state.projectProgress.project.title }}</h1>
                  <p>{{ projectSummaryText(state.projectProgress.project) }}</p>
                </div>
                <div class="section-head-actions">
                  <button class="ghost-button" type="button" @click="navigate('home')">返回课题库</button>
                  <a v-if="hasPrimaryProjectPdf(state.projectProgress.project)" class="ghost-button" :href="projectPdfHref(state.projectProgress.project)" target="_blank" rel="noopener">查看PDF</a>
                  <a v-if="hasPrimaryProjectPdf(state.projectProgress.project)" class="ghost-button" :href="projectPdfHref(state.projectProgress.project)" download>下载PDF</a>
                </div>
              </div>

              <div class="project-progress-actions project-interaction-actions">
                <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('like', state.projectProgress.project) }" type="button" :disabled="isSubmittingLike(state.projectProgress.project)" @click="submitLike(state.projectProgress.project)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">thumb_up</span>
                  <span>{{ likeButtonLabel(state.projectProgress.project) }}</span>
                </button>
                <button v-if="shouldShowFollowButton(state.projectProgress.project)" class="ghost-button interaction-button follow-button" :class="{ active: isProjectFollowing(state.projectProgress.project), 'interaction-active': interactionButtonActive('follow', state.projectProgress.project) }" type="button" @click="toggleFollow(state.projectProgress.project)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">star</span>
                  <span>{{ followButtonLabel(state.projectProgress.project) }}</span>
                </button>
                <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', state.projectProgress.project) }" type="button" :disabled="!canClickParticipation(state.projectProgress.project)" @click="handleParticipationAction(state.projectProgress.project)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">groups</span>
                  <span>{{ participationButtonLabel(state.projectProgress.project) }}</span>
                </button>
                <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('lead', state.projectProgress.project), 'is-disabled': !canClickLeadClaim(state.projectProgress.project) }" type="button" :aria-disabled="claimButtonAriaDisabled(state.projectProgress.project, 'leader')" @mouseenter="showClaimReasonTooltip($event, state.projectProgress.project, 'leader')" @focus="showClaimReasonTooltip($event, state.projectProgress.project, 'leader')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click="submitLeadClaim(state.projectProgress.project, $event)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">supervisor_account</span>
                  <span>{{ leadClaimButtonLabel(state.projectProgress.project) }}</span>
                </button>
                <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('paper', state.projectProgress.project), 'is-disabled': !canClickPaperClaim(state.projectProgress.project) }" type="button" :aria-disabled="claimButtonAriaDisabled(state.projectProgress.project, 'paper_first_unit')" @mouseenter="showClaimReasonTooltip($event, state.projectProgress.project, 'paper_first_unit')" @focus="showClaimReasonTooltip($event, state.projectProgress.project, 'paper_first_unit')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click="submitPaperClaim(state.projectProgress.project, $event)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">workspace_premium</span>
                  <span>{{ paperClaimButtonLabel(state.projectProgress.project) }}</span>
                </button>
                <button class="ghost-button interaction-button sponsor-action-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', state.projectProgress.project) }" type="button" :disabled="!canClickSponsor(state.projectProgress.project)" aria-controls="sponsor-popover" :aria-expanded="state.sponsorModal.open && state.sponsorModal.project?.id === state.projectProgress.project.id ? 'true' : 'false'" @click="submitSponsor(state.projectProgress.project, $event)">
                  <span class="material-symbols-rounded interaction-icon" aria-hidden="true">volunteer_activism</span>
                  <span>{{ sponsorButtonLabel(state.projectProgress.project) }}</span>
                </button>
              </div>

              <div class="project-progress-layout">
                <article class="content-panel project-progress-summary">
                  <div class="project-card-meta">
                    <span>{{ state.projectProgress.project.stage_label }}</span>
                    <span>{{ projectFundingLabel(state.projectProgress.project) }}</span>
                    <span>{{ projectStartupLabel(state.projectProgress.project) }}</span>
                  </div>
                  <h2>课题进展</h2>
                  <p>{{ state.projectProgress.progressText || '暂无公开进度说明。' }}</p>
                  <div class="project-role-chip-row">
                    <span v-for="role in requiredTeamRoles(state.projectProgress.project.team_status)" :key="role.key" :class="{ ready: role.ready, overfilled: role.overfilled }">
                      {{ role.label }} {{ role.count }}/{{ role.required }}
                    </span>
                  </div>
                </article>

                <article class="content-panel project-progress-documents">
                  <div class="panel-title-row compact-title-row">
                    <div>
                      <h2>项目进度文档</h2>
                      <p>这里保留每次上传的项目进度 PDF，主 PDF 不会被覆盖。</p>
                    </div>
                  </div>
                  <div v-if="projectProgressDocuments.length" class="project-document-admin-list">
                    <article class="project-document-admin-row" v-for="document in projectProgressDocuments" :key="document.id">
                      <span class="material-symbols-rounded" aria-hidden="true">picture_as_pdf</span>
                      <div>
                        <strong>{{ documentDisplayTitle(document) }}</strong>
                        <small>{{ document.description || '项目进度文档' }}</small>
                        <small>{{ formatAuditTime(document.created_at) }}</small>
                      </div>
                      <a class="ghost-button" :href="documentHref(document)" target="_blank" rel="noopener">查看</a>
                      <a class="ghost-button" :href="documentHref(document)" download>下载</a>
                    </article>
                  </div>
                  <p v-else class="muted-inline">暂无项目进度文档。</p>
                </article>
              </div>

              <article class="content-panel project-progress-timeline">
                <div class="panel-title-row compact-title-row">
                  <div>
                    <h2>进度时间线</h2>
                    <p>阶段变化、进度说明和进度文档会在这里汇总。</p>
                  </div>
                </div>
                <ol v-if="projectProgressTimelineItems.length" class="timeline-list">
                  <li v-for="entry in projectProgressTimelineItems" :key="entry.id">
                    <time>{{ formatAuditTime(entry.occurred_at) }}</time>
                    <div>
                      <strong>{{ entry.title }}</strong>
                      <p>{{ entry.description || entry.entry_type_label }}</p>
                      <a v-if="entry.document" class="ghost-button" :href="documentHref(entry.document)" target="_blank" rel="noopener">查看文档</a>
                    </div>
                  </li>
                </ol>
                <p v-else class="muted-inline">暂无公开进度时间线。</p>
              </article>

              <article class="content-panel project-discussion-section">
                <div class="panel-title-row compact-title-row">
                  <div>
                    <h2>讨论区</h2>
                    <p>所有登录用户都可以基于本课题讨论任何事情；公开展示只显示 UID。</p>
                  </div>
                </div>
                <form v-if="state.user" class="discussion-form" @submit.prevent="submitProjectDiscussion()">
                  <textarea v-model="state.projectProgress.discussionForm.content" maxlength="2000" placeholder="写下你的问题、建议或协作信息"></textarea>
                  <button class="primary-button" type="submit" :disabled="state.projectProgress.submittingDiscussion">
                    {{ state.projectProgress.submittingDiscussion ? '发布中...' : '发布讨论' }}
                  </button>
                </form>
                <p v-else class="muted-inline">登录后参与讨论</p>

                <div class="project-discussion-list">
                  <article v-for="discussion in state.projectProgress.discussions" :key="discussion.id" class="project-discussion-item">
                    <header>
                      <strong>{{ discussion.author?.uid || '已注销用户' }}</strong>
                      <time>{{ formatAuditTime(discussion.created_at) }}</time>
                    </header>
                    <p>{{ discussion.content }}</p>
                    <div class="button-row">
                      <button v-if="canManageDiscussion(discussion)" class="ghost-button" type="button" @click="updateProjectDiscussion(discussion)">编辑</button>
                      <button v-if="canManageDiscussion(discussion)" class="ghost-button danger" type="button" @click="deleteProjectDiscussion(discussion)">删除</button>
                      <button v-if="can('manage_projects')" class="ghost-button danger" type="button" @click="moderateProjectDiscussion(discussion, 'hidden')">隐藏</button>
                    </div>
                    <div v-if="discussion.replies?.length" class="project-discussion-replies">
                      <article v-for="reply in discussion.replies" :key="reply.id" class="project-discussion-reply">
                        <header><strong>{{ reply.author?.uid || '已注销用户' }}</strong><time>{{ formatAuditTime(reply.created_at) }}</time></header>
                        <p>{{ reply.content }}</p>
                        <div class="button-row">
                          <button v-if="canManageDiscussion(reply)" class="ghost-button" type="button" @click="updateProjectDiscussion(reply)">编辑</button>
                          <button v-if="canManageDiscussion(reply)" class="ghost-button danger" type="button" @click="deleteProjectDiscussion(reply)">删除</button>
                        </div>
                      </article>
                    </div>
                    <form v-if="state.user" class="discussion-reply-form" @submit.prevent="submitProjectDiscussion(discussion)">
                      <input v-model="state.projectProgress.replyDrafts[discussion.id]" type="text" maxlength="2000" placeholder="回复这条讨论" />
                      <button class="ghost-button" type="submit" :disabled="state.projectProgress.submittingDiscussion">回复</button>
                    </form>
                  </article>
                  <p v-if="!state.projectProgress.discussions.length" class="muted-inline">暂无讨论。</p>
                </div>
              </article>
            </template>
            <section v-else class="empty-state">
              <h2>课题不可访问</h2>
              <p>课题可能未公开或已归档。</p>
              <button class="primary-button" type="button" @click="navigate('home')">返回课题库</button>
            </section>
          </section>

          <section v-else-if="activeView === 'dashboard'" class="dashboard-view">
            <div class="section-head">
              <div>
                <span class="eyebrow">个人中心</span>
                <h1>{{ state.user?.profile?.display_name || state.user?.username }}</h1>
                <p>{{ state.user?.profile?.uid || '未分配 UID' }} · {{ roleInfo.role_label }} · {{ state.user?.profile?.organization || '未填写机构' }}</p>
              </div>
            </div>
            <div class="workspace-tabs" role="tablist" aria-label="个人中心">
              <button type="button" :class="{ active: state.workspaceTab === 'overview' }" @click="setWorkspaceTab('overview')">总览</button>
              <button type="button" :class="{ active: state.workspaceTab === 'favorites' }" @click="setWorkspaceTab('favorites')">我的关注</button>
              <button type="button" :class="{ active: state.workspaceTab === 'interactions' }" @click="setWorkspaceTab('interactions')">我的任务</button>
              <button type="button" :class="{ active: state.workspaceTab === 'applications' }" @click="setWorkspaceTab('applications')">我的申请</button>
              <button type="button" :class="{ active: state.workspaceTab === 'uploads' }" @click="setWorkspaceTab('uploads')">我的上传</button>
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
                <div class="credit-overview-grid">
                  <article class="content-panel credit-balance-panel">
                    <div>
                      <h2>当前积分</h2>
                      <p>{{ state.user?.profile?.credit_balance ?? 0 }}</p>
                      <small>参与课题需 50 分</small>
                    </div>
                  </article>
                  <article class="content-panel credit-transfer-panel">
                    <div class="panel-title-row compact-title-row">
                      <div>
                        <h2>积分转赠</h2>
                        <p>单次最多 50 分，够一次课题参与名额。</p>
                      </div>
                    </div>
                    <form class="stacked-form" @submit.prevent="submitCreditTransfer">
                      <div class="form-grid two-columns">
                        <label><span>接收人 UID</span><input v-model="state.forms.creditTransfer.target_uid" type="text" placeholder="例如 U00000001" /></label>
                        <label><span>积分数量</span><input v-model.number="state.forms.creditTransfer.amount" type="number" min="1" max="50" /></label>
                      </div>
                      <label><span>备注</span><input v-model="state.forms.creditTransfer.reason" type="text" maxlength="200" placeholder="可选" /></label>
                      <button class="primary-button" type="submit" :disabled="state.formState.creditTransferSubmitting">
                        {{ state.formState.creditTransferSubmitting ? '转赠中' : '确认转赠' }}
                      </button>
                    </form>
                  </article>
                  <article class="content-panel credit-ledger-panel">
                    <div class="panel-title-row compact-title-row">
                      <div>
                        <h2>最近积分流水</h2>
                        <p>注册、完善资料、参与扣除、结题返还和转赠都会记录在这里。</p>
                      </div>
                    </div>
                    <div v-if="state.dashboard.credits?.length" class="credit-ledger-list">
                      <div v-for="entry in state.dashboard.credits.slice(0, 8)" :key="entry.id" class="credit-ledger-row">
                        <span>
                          <strong>{{ entry.action_type_label }}</strong>
                          <small>{{ entry.reason || formatAuditTime(entry.created_at) }}</small>
                        </span>
                        <strong :class="{ positive: entry.amount > 0, negative: entry.amount < 0 }">{{ entry.amount > 0 ? '+' : '' }}{{ entry.amount }}</strong>
                      </div>
                    </div>
                    <p v-else class="muted-inline">暂无积分流水。</p>
                  </article>
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
                      <a v-if="hasPrimaryProjectPdf(project)" class="ghost-button" :href="projectPdfHref(project)" target="_blank" rel="noopener">查看PDF</a>
                      <button v-else class="ghost-button" type="button" disabled>暂无PDF</button>
                      <button class="ghost-button danger" type="button" @click="toggleFollow(project)">取消关注</button>
                    </div>
                  </article>
                </div>
                <section v-else class="empty-state favorites-empty">
                  <h2>还没有关注课题</h2>
                  <p>在课题列表中点击关注后，会集中显示在这里。</p>
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
                      <a v-if="hasPrimaryProjectPdf(task.project)" class="ghost-button" :href="projectPdfHref(task.project)" target="_blank" rel="noopener">查看PDF</a>
                      <button v-else class="ghost-button" type="button" disabled>暂无PDF</button>
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
                  <p>参与、认领或资助课题后，会在这里看到课题状态和你的任务进展。</p>
                  <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
                </section>
	              </section>

              <section v-else-if="state.workspaceTab === 'applications'" class="workspace-panel">
                <article class="content-panel">
                  <div class="panel-title-row compact-title-row">
                    <div>
                      <h2>我的申请</h2>
                      <p>集中查看参与、认领和资助的申请进度，审核意见会在这里保留。</p>
                    </div>
                  </div>
                  <div v-if="myApplicationRows.length" class="application-list" data-testid="my-application-list">
                    <article class="application-card" v-for="row in myApplicationRows" :key="row.type + '-' + row.id" data-testid="my-application-card">
                      <div>
                        <div class="my-task-title-row">
                          <span class="eyebrow">{{ applicationTitle(row) }}</span>
                          <span class="status-chip strong">{{ row.status_label || claimStatusLabel(row.status) }}</span>
                        </div>
                        <h3>{{ row.project?.title || '未命名课题' }}</h3>
                        <p>{{ applicationMessageLine(row) }}</p>
                        <small>{{ topicCode(row.project) }} · {{ row.project?.theme?.name || '未分类' }} · {{ formatAuditTime(row.updated_at || row.created_at) }}</small>
                        <p v-if="applicationReviewLine(row)" class="application-review-note">{{ applicationReviewLine(row) }}</p>
                      </div>
                      <div class="my-task-actions">
                        <a class="ghost-button" :href="projectDetailHref(row.project)" @click.prevent="navigate('project', { id: row.project?.id })">查看课题</a>
                        <button class="primary-button" type="button" @click="handleApplicationAction(row, $event)">{{ applicationActionLabel(row) }}</button>
                      </div>
                    </article>
                  </div>
                  <section v-else class="empty-state favorites-empty">
                    <h2>还没有申请记录</h2>
                    <p>参与、认领项目负责人、认领第一单位或提交资助意向后，会在这里看到处理进展。</p>
                    <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
                  </section>
                </article>
              </section>

              <section v-else-if="state.workspaceTab === 'uploads'" class="workspace-panel">
                <article class="content-panel user-project-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>我的上传</h2>
                      <p>{{ myProjectQuotaText() }}</p>
                    </div>
                    <button class="primary-button" type="button" :disabled="!canCreateMyProject()" @click="newMyProject">新增课题</button>
                  </div>
                  <div v-if="state.myProjects.length" class="workspace-list user-project-list">
                    <article class="workspace-row user-project-row" v-for="project in state.myProjects" :key="project.id">
                      <span>
                        <strong>{{ project.title }}</strong>
                        <small>{{ topicCode(project) }} · {{ project.theme?.name || '未分类' }}</small>
                      </span>
                      <span>
                        <strong>{{ project.stage_label }}</strong>
                        <small>{{ adminProjectVisibilityLabel(project) }}</small>
                      </span>
                      <span>
                        <strong>{{ hasPrimaryProjectPdf(project) ? '已上传 PDF' : '未上传 PDF' }}</strong>
                        <small v-if="hasPrimaryProjectPdf(project)">{{ documentDisplayTitle(primaryProjectDocument(project)) }}</small>
                        <small v-else>可在编辑中上传课题说明</small>
                      </span>
                      <div class="button-row">
                        <button v-if="canEditMyProject(project)" class="ghost-button" type="button" @click="editMyProject(project)">编辑</button>
                        <span v-else class="status-chip">阶段由管理员维护</span>
                        <a
                          v-if="hasPrimaryProjectPdf(project)"
                          class="ghost-button"
                          :href="documentHref(primaryProjectDocument(project))"
                          target="_blank"
                          rel="noopener"
                        >
                          查看PDF
                        </a>
                        <a
                          v-if="hasPrimaryProjectPdf(project)"
                          class="ghost-button"
                          :href="documentHref(primaryProjectDocument(project))"
                          download
                        >
                          下载PDF
                        </a>
                        <button v-if="canDeleteMyProject(project)" class="ghost-button danger" type="button" :disabled="state.deletingMyProjectId === project.id" @click="deleteMyProject(project)">
                          {{ state.deletingMyProjectId === project.id ? '删除中' : '删除' }}
                        </button>
                      </div>
                    </article>
                  </div>
                  <section v-else class="empty-state favorites-empty">
                    <h2>还没有上传课题</h2>
                    <p>可以保存为草稿，也可以确认完整后发布到课题库。普通用户每天最多上传 10 个课题。</p>
                    <button class="primary-button" type="button" :disabled="!canCreateMyProject()" @click="newMyProject">新增课题</button>
                  </section>
                  <p v-if="state.loadingMyProjects" class="muted-inline">正在读取我的上传...</p>
                </article>
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
                <span class="project-card-hover-strip" aria-hidden="true"></span>
                <div class="project-list-main">
                  <div class="project-card-top">
                    <div class="project-card-meta">
                      <span>{{ topicCode(project) }}</span>
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span class="project-stage-chip" :class="projectStageTone(project)">{{ project.stage_label }}</span>
                      <span class="project-funding-chip" :class="{ funded: projectFundingReady(project) }">{{ projectFundingLabel(project) }}</span>
                    </div>
                    <div class="project-card-side">
                      <dl class="project-card-counts" aria-label="课题互动统计">
                        <div><dt>点赞</dt><dd>{{ project.score_count || 0 }}</dd></div>
                        <div><dt>关注</dt><dd>{{ project.follow_count || 0 }}</dd></div>
                      </dl>
                      <span
                        class="project-card-uploader contact-hover-trigger"
                        tabindex="0"
                        @mouseenter="showProjectCreatorContactCard($event, project)"
                        @focus="showProjectCreatorContactCard($event, project)"
                        @mouseleave="scheduleHideContactHoverCard"
                        @blur="scheduleHideContactHoverCard"
                      >
                        {{ projectCreatorLabel(project) }}
                      </span>
                    </div>
                  </div>
                  <h3>
                    <a v-if="hasPrimaryProjectPdf(project)" class="project-title-link" :href="projectPdfHref(project)" target="_blank" rel="noopener">{{ projectCardTitle(project) }}</a>
                    <span v-else class="project-title-link disabled">{{ projectCardTitle(project) }}</span>
                  </h3>
                  <div class="project-expanded-detail">
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
                      <span
                        v-for="role in requiredTeamRoles(project.team_status)"
                        :key="role.key"
                        class="team-role-chip contact-hover-trigger"
                        :class="{ ready: role.ready, overfilled: role.overfilled }"
                        tabindex="0"
                        @mouseenter="showTeamContactCard($event, role, project)"
                        @focus="showTeamContactCard($event, role, project)"
                        @mouseleave="scheduleHideContactHoverCard"
                        @blur="scheduleHideContactHoverCard"
                      >
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
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">thumb_up</span>
                      <span>{{ likeButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button follow-button active" :class="{ 'interaction-active': interactionButtonActive('follow', project) }" type="button" @click.stop="toggleFollow(project)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">star</span>
                      <span>{{ followButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button" :class="{ 'interaction-active': interactionButtonActive('participation', project) }" type="button" :disabled="!canClickParticipation(project)" @click.stop="handleParticipationAction(project)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">groups</span>
                      <span>{{ participationButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('lead', project), 'is-disabled': !canClickLeadClaim(project) }" type="button" :aria-disabled="claimButtonAriaDisabled(project, 'leader')" @mouseenter="showClaimReasonTooltip($event, project, 'leader')" @focus="showClaimReasonTooltip($event, project, 'leader')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitLeadClaim(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">supervisor_account</span>
                      <span>{{ leadClaimButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button claim-action-button" :class="{ 'interaction-active': interactionButtonActive('paper', project), 'is-disabled': !canClickPaperClaim(project) }" type="button" :aria-disabled="claimButtonAriaDisabled(project, 'paper_first_unit')" @mouseenter="showClaimReasonTooltip($event, project, 'paper_first_unit')" @focus="showClaimReasonTooltip($event, project, 'paper_first_unit')" @mouseleave="hideClaimReasonTooltip" @blur="hideClaimReasonTooltip" @click.stop="submitPaperClaim(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">workspace_premium</span>
                      <span>{{ paperClaimButtonLabel(project) }}</span>
                    </button>
                    <button class="ghost-button interaction-button sponsor-action-button" :class="{ 'interaction-active': interactionButtonActive('sponsor', project) }" type="button" :disabled="!canClickSponsor(project)" aria-controls="sponsor-popover" :aria-expanded="state.sponsorModal.open && state.sponsorModal.project?.id === project.id ? 'true' : 'false'" @click.stop="submitSponsor(project, $event)">
                      <span class="material-symbols-rounded interaction-icon" aria-hidden="true">volunteer_activism</span>
                      <span>{{ sponsorButtonLabel(project) }}</span>
                    </button>
                  </div>
                  <div v-if="hasPrimaryProjectPdf(project)" class="project-pdf-actions">
                    <a
                      class="ghost-button pdf-view-link"
                      :href="documentHref(primaryProjectDocument(project))"
                      target="_blank"
                      rel="noopener"
                      @click.stop
                    >
                      查看PDF
                    </a>
                    <a
                      class="ghost-button pdf-download-link"
                      :href="documentHref(primaryProjectDocument(project))"
                      download
                      @click.stop
                    >
                      下载PDF
                    </a>
                  </div>
                </div>
              </article>
            </div>
            <section v-else class="empty-state favorites-empty">
              <h2>还没有关注课题</h2>
              <p>在课题列表中点击关注后，会集中显示在这里。</p>
              <button class="primary-button" type="button" @click="navigate('projects')">去课题库</button>
            </section>
          </section>

          <section v-else-if="activeView === 'admin'" class="admin-view">
            <template v-if="can('view_admin_console')">
              <div class="section-head">
                <div>
                  <span class="eyebrow">管理</span>
                  <h1>内容管理工作台</h1>
                  <p>主题、课题字段、PDF 文档和导入结果都由后端 API 写入数据库。归档保留数据，删除会物理移除课题。</p>
                </div>
              </div>

              <div class="admin-tabs" role="tablist" aria-label="管理功能">
                <button type="button" :class="{ active: state.admin.activeTab === 'overview' }" @click="setAdminTab('overview')">总览</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'interactions' }" @click="setAdminTab('interactions')">申请审批</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'contributions' }" @click="setAdminTab('contributions')">任务管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'projects' }" @click="setAdminTab('projects')">课题管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'themes' }" @click="setAdminTab('themes')">主题管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'users' }" @click="setAdminTab('users')">用户管理</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'system' }" @click="setAdminTab('system')">系统入口</button>
                <button type="button" :class="{ active: state.admin.activeTab === 'backup' }" @click="setAdminTab('backup')">备份恢复</button>
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
                    <h2>申请审批</h2>
                    <p>普通参与自动通过；论文第一单位、项目负责人和资助意向由管理员审批，审核意见会返回给申请人。</p>
                  </div>
                </div>
                <div class="collaboration-grid single-column">
                  <article class="content-panel">
                    <div class="panel-title-row compact-title-row">
                      <div>
                        <h3>协作申请审批</h3>
                        <p>处理需要审核的认领申请和资助意向。</p>
                      </div>
                    </div>
                    <div class="admin-filter-row">
                      <select v-model="state.admin.interactionFilters.type" @change="loadAdminInteractions({ reset: true })">
                        <option value="">全部待审批</option>
                        <option value="claim">认领申请</option>
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
                      <div class="admin-table-row" v-for="item in adminInteractionRows" :key="item.key || item.type + '-' + item.id" :class="{ 'sponsor-intent-group': item.isSponsorGroup }" :data-testid="item.isSponsorGroup ? 'admin-sponsor-group' : null">
                        <template v-if="item.isSponsorGroup">
                          <span><strong>{{ item.project.title }}</strong><small>{{ adminSponsorGroupSummary(item) }}</small></span>
                          <span>{{ item.user.uid }}</span>
                          <span>资助意向 · {{ item.items.length }} 项</span>
                          <span>{{ item.status_label }}</span>
                          <span class="sponsor-intent-items">
                            <span v-for="child in item.items" :key="child.id" class="sponsor-intent-item">
                              <strong>{{ child.subtype_label }}</strong>
                              <small>{{ child.status_label }}{{ child.review_comment ? ' · ' + child.review_comment : '' }}</small>
                              <span class="button-row" v-if="canReviewInteraction(child)">
                                <button class="ghost-button" type="button" @click="reviewInteraction(child, 'approved', $event)">通过</button>
                                <button class="ghost-button danger" type="button" @click="reviewInteraction(child, 'rejected', $event)">拒绝</button>
                              </span>
                            </span>
                          </span>
                        </template>
                        <template v-else>
                          <span><strong>{{ item.project.title }}</strong><small>{{ adminInteractionSummary(item) }}</small></span>
                          <span>{{ item.user.uid }}</span>
                          <span>{{ item.type_label }} · {{ item.subtype_label }}</span>
                          <span>{{ item.status_label }}</span>
                          <span class="button-row">
                            <template v-if="canReviewInteraction(item)">
                              <button class="ghost-button" type="button" @click="reviewInteraction(item, 'approved', $event)">通过</button>
                              <button class="ghost-button danger" type="button" @click="reviewInteraction(item, 'rejected', $event)">拒绝</button>
                            </template>
                            <small v-else>已处理</small>
                          </span>
                        </template>
                      </div>
                    </div>
                    <p v-if="!state.admin.loadingInteractions && !state.admin.interactions.length">没有匹配的协作意向。</p>
                  </article>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'contributions'" class="content-panel">
                <div class="panel-title-row">
                  <div><h2>任务管理</h2><p>按课题查看已获批人员 UID、提交内容和结果文档。</p></div>
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

              <section v-else-if="state.admin.activeTab === 'system'" class="content-panel sidebar-qr-admin-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>系统入口</h2>
                    <p>管理员可上传或更新常见问答底部二维码，未上传的二维码不会公开展示。</p>
                  </div>
                  <button class="ghost-button" type="button" :disabled="state.admin.loadingSidebarQrs" @click="loadSidebarQrs">
                    {{ state.admin.loadingSidebarQrs ? '正在刷新...' : '刷新' }}
                  </button>
                </div>
                <div class="sidebar-qr-admin-grid">
                  <article v-for="entry in sidebarQrEntries" :key="entry.key" class="sidebar-qr-admin-card">
                    <header>
                      <span class="material-symbols-rounded" aria-hidden="true">{{ entry.icon }}</span>
                      <div>
                        <h3>{{ entry.label }}</h3>
                        <p>{{ entry.has_image ? '已上传二维码' : '二维码待更新' }}</p>
                      </div>
                    </header>
                    <div v-if="sidebarQrImageSrc(entry)" class="sidebar-qr-admin-preview">
                      <img :src="sidebarQrImageSrc(entry)" :alt="sidebarQrAlt(entry)" />
                    </div>
                    <div v-else class="sidebar-qr-admin-placeholder">二维码待更新</div>
                    <small v-if="entry.updated_at">更新于 {{ formatAuditTime(entry.updated_at) }}</small>
                    <label class="file-picker compact-file-picker">
                      <span>{{ sidebarQrUploadState(entry.key).file ? sidebarQrUploadState(entry.key).file.name : '选择二维码图片' }}</span>
                      <input
                        :key="sidebarQrUploadState(entry.key).inputKey"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                        @change="setSidebarQrUploadFile(entry, $event)"
                      />
                    </label>
                    <button
                      class="primary-button"
                      type="button"
                      :disabled="sidebarQrUploadState(entry.key).uploading || !sidebarQrUploadState(entry.key).file"
                      @click="uploadSidebarQr(entry)"
                    >
                      {{ sidebarQrUploadState(entry.key).uploading ? '上传中...' : '上传/更新二维码' }}
                    </button>
                  </article>
                </div>
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

              <section v-else-if="state.admin.activeTab === 'backup'" class="content-panel backup-panel">
                <div class="panel-title-row">
                  <div>
                    <h2>备份恢复</h2>
                    <p>导出或恢复主题、课题、标签、数据集说明 PDF 和课题 PDF 文档。用户账号、协作记录和审计日志不会被恢复包覆盖。</p>
                  </div>
                </div>
                <div class="backup-action-grid">
                  <article class="backup-card">
                    <h3>一键导出</h3>
                    <p>生成 ZIP 备份包，包含数据库业务内容清单和对应 PDF 文件。</p>
                    <button class="primary-button" type="button" :disabled="state.admin.backup.exporting" @click="exportContentBackup">
                      {{ state.admin.backup.exporting ? '正在导出...' : '下载备份 ZIP' }}
                    </button>
                  </article>
                  <article class="backup-card">
                    <h3>上传恢复</h3>
                    <p>同 slug 的主题、同编号的课题会更新；不存在的内容会新增。</p>
                    <label class="file-picker compact-file-picker">
                      <span>{{ state.admin.backup.file ? state.admin.backup.file.name : '选择备份 ZIP' }}</span>
                      <input :key="state.admin.backup.inputKey" type="file" accept=".zip,application/zip" @change="setContentBackupFile" />
                    </label>
                    <button class="ghost-button danger" type="button" :disabled="state.admin.backup.restoring || !state.admin.backup.file" @click="restoreContentBackup">
                      {{ state.admin.backup.restoring ? '正在恢复...' : '上传并恢复' }}
                    </button>
                  </article>
                </div>
                <div v-if="state.admin.backup.result" class="backup-result">
                  <strong>最近恢复结果</strong>
                  <span>主题 {{ state.admin.backup.result.themes || 0 }}</span>
                  <span>课题 {{ state.admin.backup.result.projects || 0 }}</span>
                  <span>标签 {{ state.admin.backup.result.tags || 0 }}</span>
                  <span>数据集说明 {{ state.admin.backup.result.theme_files || 0 }}</span>
                  <span>课题文档 {{ state.admin.backup.result.project_documents || 0 }}</span>
                  <span>项目进度 {{ state.admin.backup.result.project_progress_entries || 0 }}</span>
                  <span>文件 {{ state.admin.backup.result.files || 0 }}</span>
                </div>
              </section>

              <section v-else-if="state.admin.activeTab === 'projects'" class="admin-workbench project-management-workbench">
                <article class="content-panel admin-list-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>课题管理</h2>
                      <p>共 {{ state.admin.projectPagination.total_count || 0 }} 个课题，当前显示 {{ state.admin.projects.length }} 个。</p>
                    </div>
                    <button class="primary-button" type="button" @click="newProject">新增课题</button>
                  </div>
                  <div class="admin-project-toolbar">
                    <div class="bulk-selection-status">
                      <strong>批量操作</strong>
                      <span>已选 {{ state.admin.selectedProjectIds.length }} 项</span>
                    </div>
                    <div class="button-row admin-bulk-actions">
                      <button
                        class="ghost-button"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting"
                        @click="bulkArchiveSelectedProjects"
                      >
                        {{ state.admin.bulkArchivingProjects ? '正在归档...' : '批量归档(' + state.admin.selectedProjectIds.length + ')' }}
                      </button>
                      <button
                        class="ghost-button"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting"
                        @click="bulkPublishSelectedProjects(true)"
                      >批量公开</button>
                      <button
                        class="ghost-button"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting"
                        @click="bulkPublishSelectedProjects(false)"
                      >取消公开</button>
                      <select
                        class="admin-stage-select"
                        v-model="state.admin.bulkProjectStage"
                        :disabled="state.admin.bulkProjectActionSubmitting"
                        aria-label="批量设置课题阶段"
                      >
                        <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                      </select>
                      <button
                        class="ghost-button"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting"
                        @click="bulkSetSelectedProjectStage"
                      >批量设置状态</button>
                      <button
                        class="ghost-button danger"
                        type="button"
                        :disabled="!state.admin.selectedProjectIds.length || state.admin.bulkProjectActionSubmitting"
                        @click="bulkDeleteSelectedProjects"
                      >批量删除</button>
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
                        <button class="ghost-button" type="button" :disabled="project.stage === 'archived'" @click="archiveProject(project)">归档</button>
                        <button class="ghost-button danger" type="button" @click="deleteAdminProject(project)">删除</button>
                      </span>
                    </div>
                  </div>
                  <div class="load-more compact-load-more">
                    <span>{{ state.admin.loadingProjects ? '正在加载全部课题...' : '已显示全部筛选结果' }}</span>
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
                    <button class="file-picker json-import-picker" type="button" @click="chooseJsonImportJsonFiles">
                      <span>导入单个课题 JSON</span>
                      <small>可选择一个或多个 .json 文件</small>
                    </button>
                    <button class="file-picker json-import-picker" type="button" @click="chooseJsonImportDirectory">
                      <span>导入课题目录</span>
                      <small>自动匹配同名 .json 与 .pdf</small>
                    </button>
                    <button class="file-picker json-import-picker" type="button" @click="chooseJsonImportMixedFiles">
                      <span>选择目录内 JSON/PDF 文件</span>
                      <small>Linux 文件夹选择不可用时，打开目录后框选 .json 与同名 .pdf 文件</small>
                    </button>
                    <input ref="jsonImportJsonFilesInput" class="visually-hidden-file-input" type="file" accept=".json,application/json" multiple @change="handleJsonFiles" />
                    <input ref="jsonImportMixedFilesInput" class="visually-hidden-file-input" type="file" accept=".json,application/json,.pdf,application/pdf" multiple @change="handleJsonFiles" />
                    <input ref="jsonImportDirectoryInput" class="visually-hidden-file-input" type="file" accept=".json,application/json,.pdf,application/pdf" webkitdirectory multiple @change="handleJsonFiles" />
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
                  <p v-else>尚未选择 JSON 文件。单个文件导入只写入结构化字段；目录导入会自动把同名 PDF 作为课题说明文件一起上传。</p>
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
                  <section ref="adminProjectFormRef" class="project-form-dialog" role="dialog" aria-modal="true" aria-label="课题表单" tabindex="-1" @keydown="trapModalFocus($event, adminProjectFormRef)">
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
                            <h3>课题 PDF</h3>
                            <p>每个课题保留一份主 PDF。重新上传会替换当前主 PDF。</p>
                          </div>
                          <span v-if="primaryProjectDocument(state.admin.projectForm)" class="status-chip">已上传</span>
                        </div>
                        <template v-if="state.admin.projectForm.id">
                          <div v-if="primaryProjectDocument(state.admin.projectForm)" class="project-document-admin-list">
                            <article class="project-document-admin-row">
                              <span class="material-symbols-rounded" aria-hidden="true">picture_as_pdf</span>
                              <div>
                                <strong>{{ documentDisplayTitle(primaryProjectDocument(state.admin.projectForm)) }}</strong>
                                <small>{{ primaryProjectDocument(state.admin.projectForm).description || '课题 PDF 详情' }}</small>
                                <small>{{ primaryProjectDocument(state.admin.projectForm).path }}</small>
                              </div>
                              <a class="ghost-button" :href="documentHref(primaryProjectDocument(state.admin.projectForm))" target="_blank" rel="noopener">查看</a>
                              <a class="ghost-button" :href="documentHref(primaryProjectDocument(state.admin.projectForm))" download>下载</a>
                              <button class="ghost-button danger" type="button" @click="deleteProjectDocument(primaryProjectDocument(state.admin.projectForm))">删除</button>
                            </article>
                          </div>
                          <p v-else class="muted-inline">这个课题还没有上传 PDF。</p>
                          <div class="project-document-upload">
                            <label><span>PDF 标题</span><input v-model="state.admin.projectForm.documentUpload.title" type="text" placeholder="例如：课题介绍" /></label>
                            <label class="document-description-field"><span>内容说明</span><textarea v-model="state.admin.projectForm.documentUpload.description" placeholder="可留空，默认使用课题 PDF 详情"></textarea></label>
                            <label class="file-picker compact-file-picker">
                              <span>选择 PDF</span>
                              <input :key="state.admin.projectForm.documentUpload.inputKey" type="file" accept="application/pdf,.pdf" @change="setProjectDocumentFile" />
                            </label>
                            <button class="primary-button" type="button" :disabled="state.admin.projectForm.documentUpload.uploading" @click="uploadProjectDocument">
                              {{ state.admin.projectForm.documentUpload.uploading ? '正在上传...' : '上传/替换PDF' }}
                            </button>
                          </div>
                        </template>
                        <p v-else class="muted-inline">请先保存课题草稿，再回到编辑弹窗上传 PDF。</p>
                      </section>
                      <section class="project-document-manager">
                        <div class="panel-title-row compact-title-row">
                          <div>
                            <h3>项目进度文档</h3>
                            <p>按日期保留多份进度 PDF，上传后会自动进入课题进度时间线。</p>
                          </div>
                          <span v-if="projectProgressDocumentsFor(state.admin.projectForm).length" class="status-chip">{{ projectProgressDocumentsFor(state.admin.projectForm).length }} 份</span>
                        </div>
                        <template v-if="state.admin.projectForm.id">
                          <div v-if="projectProgressDocumentsFor(state.admin.projectForm).length" class="project-document-admin-list">
                            <article class="project-document-admin-row" v-for="document in projectProgressDocumentsFor(state.admin.projectForm)" :key="document.id">
                              <span class="material-symbols-rounded" aria-hidden="true">description</span>
                              <div>
                                <strong>{{ documentDisplayTitle(document) }}</strong>
                                <small>{{ document.description || '项目进度文档' }}</small>
                                <small>{{ document.created_at ? formatAuditTime(document.created_at) : document.path }}</small>
                              </div>
                              <a class="ghost-button" :href="documentHref(document)" target="_blank" rel="noopener">查看</a>
                              <a class="ghost-button" :href="documentHref(document)" download>下载</a>
                              <button class="ghost-button danger" type="button" @click="deleteProjectDocument(document)">删除</button>
                            </article>
                          </div>
                          <p v-else class="muted-inline">还没有上传项目进度文档。</p>
                          <div class="project-document-upload">
                            <label><span>进度标题</span><input v-model="state.admin.projectForm.progressDocumentUpload.title" type="text" placeholder="例如：第 1 周进度" /></label>
                            <label class="document-description-field"><span>进度说明</span><textarea v-model="state.admin.projectForm.progressDocumentUpload.description" placeholder="可留空，默认使用项目进度文档"></textarea></label>
                            <label class="file-picker compact-file-picker">
                              <span>{{ state.admin.projectForm.progressDocumentUpload.file ? state.admin.projectForm.progressDocumentUpload.file.name : '选择进度 PDF' }}</span>
                              <input :key="state.admin.projectForm.progressDocumentUpload.inputKey" type="file" accept="application/pdf,.pdf" @change="setProjectProgressDocumentFile" />
                            </label>
                            <button class="primary-button" type="button" :disabled="state.admin.projectForm.progressDocumentUpload.uploading" @click="uploadProjectProgressDocument">
                              {{ state.admin.projectForm.progressDocumentUpload.uploading ? '正在上传...' : '上传进度PDF' }}
                            </button>
                          </div>
                        </template>
                        <p v-else class="muted-inline">请先保存课题草稿，再回到编辑弹窗上传项目进度文档。</p>
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

              <section v-else-if="state.admin.activeTab === 'themes'" class="admin-workbench theme-management-workbench">
                <article class="content-panel admin-list-panel">
                  <div class="panel-title-row">
                    <div>
                      <h2>主题管理</h2>
                      <p>主题配置、首页筛选和数据集说明 PDF 都在这里统一维护。</p>
                    </div>
                    <button class="primary-button" type="button" @click="newTheme">新增主题</button>
                  </div>
                  <div class="theme-sort-actions">
                    <span>{{ state.admin.themeSortDirty ? '排序未保存' : '排序已同步' }}</span>
                    <button class="ghost-button" type="button" :disabled="!state.admin.themeSortDirty || state.admin.themeSortSaving" @click="restoreThemeSort">还原排序</button>
                    <button class="primary-button" type="button" :disabled="!state.admin.themeSortDirty || state.admin.themeSortSaving" @click="saveThemeSort">
                      {{ state.admin.themeSortSaving ? '保存中...' : '保存排序' }}
                    </button>
                  </div>
                  <div class="admin-table theme-admin-table">
                    <div class="admin-table-head">
                      <span>主题</span>
                      <span>说明 PDF</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    <div class="admin-table-row" v-for="theme in state.admin.themes" :key="theme.id">
                      <span>
                        <strong>{{ theme.name }}</strong>
                        <small>{{ theme.slug }} · 排序 {{ theme.sort_order || 0 }}</small>
                        <small>{{ theme.description || '未填写主题说明' }}</small>
                      </span>
                      <span>
                        <strong>{{ adminThemeDatasetFile(theme)?.detail_pdf_title || '未上传' }}</strong>
                        <small>{{ adminThemeDatasetFile(theme)?.title || '编辑主题后上传数据集说明 PDF' }}</small>
                      </span>
                      <span>{{ theme.is_active ? '启用' : '停用' }}</span>
                      <span class="button-row">
                        <button class="icon-button" type="button" title="上移" @click="moveThemeSort(theme, 'up')"><span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_up</span></button>
                        <button class="icon-button" type="button" title="下移" @click="moveThemeSort(theme, 'down')"><span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_down</span></button>
                        <button class="icon-button" type="button" title="置顶" @click="moveThemeSort(theme, 'top')"><span class="material-symbols-rounded" aria-hidden="true">vertical_align_top</span></button>
                        <button class="icon-button" type="button" title="置底" @click="moveThemeSort(theme, 'bottom')"><span class="material-symbols-rounded" aria-hidden="true">vertical_align_bottom</span></button>
                        <button class="ghost-button" type="button" @click="editTheme(theme)">编辑</button>
                        <a v-if="adminThemeDatasetFile(theme)?.detail_pdf_path" class="ghost-button" :href="themeFileDetailPdfHref(adminThemeDatasetFile(theme))" download>下载PDF</a>
                        <button class="ghost-button" type="button" @click="deactivateTheme(theme)">{{ theme.is_active ? '停用' : '启用' }}</button>
                        <button class="ghost-button danger" type="button" @click="deleteTheme(theme)">删除</button>
                      </span>
                    </div>
                  </div>
                </article>

                <div v-if="state.admin.themeFormOpen" class="project-form-modal" @click.self="closeThemeForm">
                  <section ref="adminThemeFormRef" class="project-form-dialog" role="dialog" aria-modal="true" aria-label="主题表单" tabindex="-1" @keydown="trapModalFocus($event, adminThemeFormRef)">
                    <header class="project-form-dialog-header">
                      <div>
                        <span class="eyebrow">主题管理</span>
                        <h2>{{ state.admin.themeForm.id ? '编辑主题' : '新增主题' }}</h2>
                        <p>一个主题只维护一份数据集说明 PDF，可在这里上传或替换。</p>
                      </div>
                      <div class="modal-actions">
                        <button class="ghost-button" type="button" @click="newTheme">重置表单</button>
                        <button class="ghost-button" type="button" @click="closeThemeForm">关闭</button>
                      </div>
                    </header>
                    <form class="stack-form project-edit-form project-form-dialog-body" @submit.prevent="saveTheme">
                      <div class="form-grid">
                        <label><span>主题名称</span><input v-model="state.admin.themeForm.name" type="text" /></label>
                        <label><span>主题 slug</span><input v-model="state.admin.themeForm.slug" type="text" /></label>
                        <label><span>排序</span><input v-model="state.admin.themeForm.sort_order" type="number" /></label>
                        <label class="inline-check"><input v-model="state.admin.themeForm.is_active" type="checkbox" /> 启用主题</label>
                      </div>
                      <label><span>主题说明</span><textarea v-model="state.admin.themeForm.description"></textarea></label>
                      <section class="project-document-manager">
                        <div class="panel-title-row compact-title-row">
                          <div>
                            <h3>数据集说明 PDF</h3>
                            <p>用于介绍该主题关联数据集的来源、特点和限制。</p>
                          </div>
                          <span v-if="state.admin.themeFileForm.detail_pdf_path" class="status-chip">已上传</span>
                        </div>
                        <div v-if="state.admin.themeFileForm.detail_pdf_path" class="project-document-admin-list">
                          <article class="project-document-admin-row">
                            <span class="material-symbols-rounded" aria-hidden="true">picture_as_pdf</span>
                            <div>
                              <strong>{{ state.admin.themeFileForm.detail_pdf_title || state.admin.themeFileForm.title || '数据集说明 PDF' }}</strong>
                              <small>{{ state.admin.themeFileForm.description || '数据集说明文件' }}</small>
                              <small>{{ state.admin.themeFileForm.detail_pdf_path }}</small>
                            </div>
                            <a class="ghost-button" :href="themeFileDetailPdfHref(state.admin.themeFileForm)" download>下载</a>
                          </article>
                        </div>
                        <p v-else class="muted-inline">这个主题还没有上传数据集说明 PDF。</p>
                        <div class="project-document-upload">
                          <label><span>数据集名称</span><input v-model="state.admin.themeFileForm.title" type="text" placeholder="例如：视网膜影像数据集" /></label>
                          <label class="document-description-field"><span>数据集说明</span><textarea v-model="state.admin.themeFileForm.description" placeholder="简要说明数据集来源、规模、特点和限制"></textarea></label>
                          <label class="file-picker compact-file-picker">
                            <span>选择 PDF</span>
                            <input :key="state.admin.themeFileForm.detailPdfUpload.inputKey" type="file" accept="application/pdf,.pdf" @change="setThemeFileDetailPdfFile" />
                          </label>
                          <label><span>PDF 标题</span><input v-model="state.admin.themeFileForm.detailPdfUpload.title" type="text" placeholder="默认使用文件名" /></label>
                        </div>
                      </section>
                      <div class="button-row form-actions">
                        <button class="ghost-button" type="button" @click="closeThemeForm">取消</button>
                        <button class="primary-button" type="submit" :disabled="state.admin.themeFileForm.detailPdfUpload.uploading">{{ state.admin.themeFileForm.detailPdfUpload.uploading ? '正在上传...' : '保存主题' }}</button>
                      </div>
                    </form>
                  </section>
                </div>
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

            </template>
            <section v-else class="empty-state">
              <h2>当前身份没有管理权限</h2>
              <p>管理员可以维护主题、课题、PDF 文档和 JSON 模板导入。</p>
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
              <button class="primary-button" type="submit"><span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">login</span> 登录</button>
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
                <span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">lock_reset</span>
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
                <span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">person_add</span>
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

        <div v-if="state.participationModal.open" class="form-modal-backdrop" @click.self="closeParticipationModal">
          <section ref="participationModalRef" class="form-modal compact-form-modal" role="dialog" aria-modal="true" aria-label="参与课题" tabindex="-1" @keydown="trapModalFocus($event, participationModalRef)">
            <header class="modal-header">
              <div>
                <span class="eyebrow">参与课题</span>
                <h2>{{ state.participationModal.project?.title || '课题协作' }}</h2>
              </div>
              <button class="ghost-button" type="button" @click="closeParticipationModal">关闭</button>
            </header>
            <form class="stacked-form" @submit.prevent="submitParticipationModal">
              <label>
                <span>如有论文产出，论文署名意向</span>
                <select v-model="state.forms.participation.authorship_intention" required>
                  <option v-for="item in authorshipIntentOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
              </label>
              <label>
                <span>补充说明</span>
                <textarea v-model="state.forms.participation.message" rows="3" placeholder="可简单说明希望参与的工作方向"></textarea>
              </label>
              <p class="form-note">课题会根据署名意向分配不同工作量，最终署名按照项目结束时的贡献大小排名。参与课题需要 50 积分。</p>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeParticipationModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.participationModal.submitting">
                  {{ state.participationModal.submitting ? '正在提交' : '确认参与' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.leadClaimModal.open" class="form-modal-backdrop" @click.self="closeLeadClaimModal">
          <section ref="leadClaimModalRef" class="form-modal compact-form-modal" role="dialog" aria-modal="true" aria-label="认领项目负责人" tabindex="-1" @keydown="trapModalFocus($event, leadClaimModalRef)">
            <header class="modal-header">
              <div>
                <span class="eyebrow">认领项目负责人</span>
                <h2>{{ state.leadClaimModal.project?.title || '项目负责人认领' }}</h2>
              </div>
              <button class="ghost-button" type="button" @click="closeLeadClaimModal">关闭</button>
            </header>
            <form class="stacked-form" @submit.prevent="submitLeadClaimModal">
              <p v-if="state.forms.leadClaim.previous_review_comment" class="form-note warning-note">上次审核意见：{{ state.forms.leadClaim.previous_review_comment }}</p>
              <label>
                <span>负责人职责说明</span>
                <textarea v-model="state.forms.leadClaim.message" rows="4" maxlength="600" placeholder="可说明组队计划、分工协调、进度管理、积分分配和学术诚信监督安排"></textarea>
              </label>
              <p v-if="state.forms.leadClaim.error" class="form-error">{{ state.forms.leadClaim.error }}</p>
              <p class="form-note">项目负责人需要承担组队、协调分工、积分分配、项目进度管理及对外发布、确保学术诚信等职责。提交后由管理员审核，审核意见会返回给你。</p>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeLeadClaimModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.leadClaimModal.submitting">
                  {{ state.leadClaimModal.submitting ? '正在提交' : '提交审核' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.paperClaimModal.open" class="form-modal-backdrop" @click.self="closePaperClaimModal">
          <section ref="paperClaimModalRef" class="form-modal compact-form-modal" role="dialog" aria-modal="true" aria-label="认领课题（论文第一单位）" tabindex="-1" @keydown="trapModalFocus($event, paperClaimModalRef)">
            <header class="modal-header">
              <div>
                <span class="eyebrow">认领课题（论文第一单位）</span>
                <h2>{{ state.paperClaimModal.project?.title || '论文第一单位认领' }}</h2>
              </div>
              <button class="ghost-button" type="button" @click="closePaperClaimModal">关闭</button>
            </header>
            <form class="stacked-form" @submit.prevent="submitPaperClaimModal">
              <p v-if="state.forms.paperClaim.previous_review_comment" class="form-note warning-note">上次审核意见：{{ state.forms.paperClaim.previous_review_comment }}</p>
              <label>
                <span>拟认领第一单位</span>
                <input v-model="state.forms.paperClaim.claimed_unit_name" type="text" maxlength="100" aria-required="true" placeholder="中山大学附属第一医院" />
              </label>
              <label>
                <span>申请说明</span>
                <textarea v-model="state.forms.paperClaim.message" rows="3" maxlength="500" placeholder="可补充第一单位认领依据、已有资源或协作承诺"></textarea>
              </label>
              <p v-if="state.forms.paperClaim.error" class="form-error">{{ state.forms.paperClaim.error }}</p>
              <p class="form-note">请填写论文第一单位的完整机构名称，提交后由管理员审核，审核意见会返回给你。待审核不代表已获得第一单位资格；最终署名仍按项目结束时的贡献和平台规则确认。</p>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closePaperClaimModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.paperClaimModal.submitting">
                  {{ state.paperClaimModal.submitting ? '正在提交' : '提交审核' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.sponsorModal.open" class="form-modal-backdrop sponsor-popover-backdrop" @click.self="closeSponsorModal">
          <section id="sponsor-popover" ref="sponsorModalRef" class="sponsor-popover" data-testid="sponsor-popover" :style="{ left: state.sponsorModal.x + 'px', top: state.sponsorModal.y + 'px', maxHeight: state.sponsorModal.maxHeight + 'px' }" role="dialog" aria-modal="true" aria-label="选择资助类型" tabindex="-1" @keydown="trapModalFocus($event, sponsorModalRef)">
            <header class="modal-header">
              <div>
                <span class="eyebrow">选择资助类型</span>
                <h2>{{ state.sponsorModal.project?.title || '课题资助' }}</h2>
              </div>
              <button class="ghost-button" type="button" @click="closeSponsorModal">关闭</button>
            </header>
            <form class="stacked-form sponsor-popover-form" @submit.prevent="submitSponsorModal">
              <p v-if="state.forms.sponsor.previous_review_comment" class="warning-note">上次审核意见：{{ state.forms.sponsor.previous_review_comment }}</p>
              <div class="sponsor-checkbox-row">
                <label v-for="item in quickSponsorTypeOptions" :key="item.value" class="checkbox-chip">
                  <input v-model="state.forms.sponsor.sponsor_types" type="checkbox" :value="item.value" :disabled="!canRecruitProject(state.sponsorModal.project) && !activeSponsorTypesForProject(state.sponsorModal.project).includes(item.value)" />
                  <span>{{ item.label }}<small v-if="sponsorRequestStatusLabel(state.sponsorModal.project, item.value)"> · {{ sponsorRequestStatusLabel(state.sponsorModal.project, item.value) }}</small></span>
                </label>
              </div>
              <button class="text-button sponsor-more-toggle" type="button" @click="state.forms.sponsor.show_more_types = !state.forms.sponsor.show_more_types">
                {{ state.forms.sponsor.show_more_types ? '收起更多资助类型' : '更多资助类型' }}
              </button>
              <div v-if="state.forms.sponsor.show_more_types" class="sponsor-checkbox-row sponsor-extra-options">
                <label v-for="item in moreSponsorTypeOptions" :key="item.value" class="checkbox-chip">
                  <input v-model="state.forms.sponsor.sponsor_types" type="checkbox" :value="item.value" :disabled="!canRecruitProject(state.sponsorModal.project) && !activeSponsorTypesForProject(state.sponsorModal.project).includes(item.value)" />
                  <span>{{ item.label }}<small v-if="sponsorRequestStatusLabel(state.sponsorModal.project, item.value)"> · {{ sponsorRequestStatusLabel(state.sponsorModal.project, item.value) }}</small></span>
                </label>
              </div>
              <label>
                <span>说明</span>
                <textarea v-model="state.forms.sponsor.note" rows="2" placeholder="可补充资源、额度或联系方式"></textarea>
              </label>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeSponsorModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.sponsorModal.submitting || (!state.forms.sponsor.sponsor_types.length && !activeSponsorRequestsForProject(state.sponsorModal.project).length)">
                  {{ state.sponsorModal.submitting ? '正在提交' : '提交资助意向' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.admin.reviewModal.open" class="review-modal-backdrop" @click.self="closeReviewModal">
          <section ref="reviewModalRef" class="review-modal" data-testid="admin-review-modal" role="dialog" aria-modal="true" :aria-label="reviewModalTitle()" tabindex="-1" @keydown="trapModalFocus($event, reviewModalRef)">
            <header class="modal-header">
              <div>
                <span class="eyebrow">申请审批</span>
                <h2>{{ reviewModalTitle() }}</h2>
                <p>{{ reviewModalDescription() }}</p>
              </div>
              <button class="ghost-button" type="button" @click="closeReviewModal">关闭</button>
            </header>
            <form class="stacked-form" @submit.prevent="submitReviewModal">
              <div class="review-modal-grid">
                <section>
                  <strong>申请内容</strong>
                  <p>{{ adminInteractionSummary(state.admin.reviewModal.item) }}</p>
                </section>
                <section>
                  <strong>当前状态</strong>
                  <p>{{ state.admin.reviewModal.item?.status_label || '待处理' }}</p>
                </section>
              </div>
              <section class="review-context-panel">
                <strong>审批上下文</strong>
                <p v-if="state.admin.reviewModal.loadingContext">正在加载同课题历史记录...</p>
                <p v-else>{{ reviewContextSummary() }}</p>
                <p v-if="state.admin.reviewModal.contextError" class="form-error">{{ state.admin.reviewModal.contextError }}</p>
                <ul v-if="state.admin.reviewModal.context.length" class="review-context-list">
                  <li v-for="row in state.admin.reviewModal.context.slice(0, 5)" :key="row.type + '-' + row.id">{{ reviewContextLine(row) }}</li>
                </ul>
              </section>
              <div class="button-row review-preset-row">
                <button v-for="reason in reviewPresetReasons()" :key="reason" class="ghost-button" type="button" @click="applyReviewPreset(reason)">{{ reason }}</button>
              </div>
              <label>
                <span>{{ state.admin.reviewModal.status === 'rejected' ? '拒绝原因 / 审核意见' : '审核意见' }}</span>
                <textarea v-model="state.admin.reviewModal.review_note" rows="4" maxlength="500" :placeholder="state.admin.reviewModal.status === 'rejected' ? '请说明拒绝原因，方便申请人修正后重新提交' : '可填写通过说明，默认审核通过'"></textarea>
              </label>
              <p v-if="state.admin.reviewModal.error" class="form-error">{{ state.admin.reviewModal.error }}</p>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeReviewModal">取消</button>
                <button class="primary-button" type="submit" :disabled="state.admin.reviewModal.submitting">
                  {{ state.admin.reviewModal.submitting ? '提交中' : (state.admin.reviewModal.status === 'approved' ? '确认通过' : '确认拒绝') }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.releaseModalOpen" class="release-modal-backdrop" @click.self="closeReleaseModal">
          <section ref="releaseModalRef" class="release-modal" role="dialog" aria-modal="true" aria-label="更新日志" tabindex="-1" @keydown="trapModalFocus($event, releaseModalRef)">
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
                  <span class="material-symbols-rounded" style="font-size: 18px;" aria-hidden="true">{{ isReleaseVersionExpanded(item.version) ? 'expand_less' : 'expand_more' }}</span>
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

        <div v-if="state.myProjectFormOpen" class="project-form-modal user-project-form-modal" @click.self="closeMyProjectForm">
          <section ref="myProjectFormRef" class="project-form-dialog user-project-form-dialog" role="dialog" aria-modal="true" aria-label="我的课题表单" tabindex="-1" @keydown="trapModalFocus($event, myProjectFormRef)">
            <header class="project-form-dialog-header">
              <div>
                <span class="eyebrow">我的上传</span>
                <h2>{{ state.myProjectForm.id ? '编辑课题' : '新增课题' }}</h2>
                <p>可保存为草稿，或确认内容完整后发布到课题库。{{ myProjectQuotaText() }}</p>
              </div>
              <div class="modal-actions">
                <button class="ghost-button" type="button" @click="closeMyProjectForm">关闭</button>
              </div>
            </header>
            <form class="stack-form project-edit-form project-form-dialog-body" @submit.prevent="saveMyProject()">
              <div class="form-grid">
                <label><span>主题</span>
                  <select v-model="state.myProjectForm.theme">
                    <option value="">请选择主题</option>
                    <option v-for="theme in state.meta.themes" :key="theme.id" :value="theme.slug">{{ theme.name }}</option>
                  </select>
                </label>
                <label v-if="myProjectStageEditable(state.myProjectForm)"><span>阶段</span>
                  <select v-model="state.myProjectForm.stage">
                    <option value="draft">草稿</option>
                    <option value="open_recruiting">开放招募</option>
                  </select>
                </label>
                <label v-else><span>阶段</span>
                  <div class="readonly-field">{{ state.myProjectForm.stage_label || state.myProjectForm.stage || '管理员维护' }}</div>
                </label>
              </div>
              <label><span>Title（中文）</span><input v-model="state.myProjectForm.title" type="text" /></label>
              <label><span>Title（英文，选填）</span><input v-model="state.myProjectForm.title_en" type="text" /></label>
              <label><span>摘要</span><textarea v-model="state.myProjectForm.summary" placeholder="用一段话概括课题要解决的问题、核心方法和预期价值"></textarea></label>
              <div class="form-grid">
                <label><span>科学问题（选填，250字以内）</span><textarea v-model="state.myProjectForm.problem_statement" maxlength="250"></textarea></label>
                <label><span>临床终点（选填，250字以内）</span><textarea v-model="state.myProjectForm.clinical_endpoint" maxlength="250"></textarea></label>
                <label><span>已有基础（选填，250字以内）</span><textarea v-model="state.myProjectForm.existing_foundation" maxlength="250"></textarea></label>
                <label><span>标签（逗号分隔）</span><input v-model="state.myProjectForm.tags" type="text" /></label>
              </div>
              <section class="project-document-manager">
                <div class="panel-title-row compact-title-row">
                  <div>
                    <h3>课题 PDF</h3>
                    <p>每个课题保留一份主 PDF。重新上传会替换当前主 PDF。</p>
                  </div>
                  <span v-if="primaryProjectDocument(state.myProjectForm)" class="status-chip">已上传</span>
                </div>
                <div v-if="primaryProjectDocument(state.myProjectForm)" class="project-document-admin-list">
                  <article class="project-document-admin-row">
                    <span class="material-symbols-rounded" aria-hidden="true">picture_as_pdf</span>
                    <div>
                      <strong>{{ documentDisplayTitle(primaryProjectDocument(state.myProjectForm)) }}</strong>
                      <small>{{ primaryProjectDocument(state.myProjectForm).description || '课题 PDF 详情' }}</small>
                      <small>{{ primaryProjectDocument(state.myProjectForm).path }}</small>
                    </div>
                    <a class="ghost-button" :href="documentHref(primaryProjectDocument(state.myProjectForm))" target="_blank" rel="noopener">查看</a>
                    <a class="ghost-button" :href="documentHref(primaryProjectDocument(state.myProjectForm))" download>下载</a>
                    <button v-if="state.myProjectForm.id" class="ghost-button danger" type="button" @click="deleteMyProjectDocument(primaryProjectDocument(state.myProjectForm))">删除</button>
                  </article>
                </div>
                <p v-else class="muted-inline">可在这里选择 PDF，保存课题时自动上传。</p>
                <div class="project-document-upload">
                  <label><span>PDF 标题</span><input v-model="state.myProjectForm.documentUpload.title" type="text" placeholder="例如：课题介绍" /></label>
                  <label class="document-description-field"><span>内容说明</span><textarea v-model="state.myProjectForm.documentUpload.description" placeholder="可留空，默认使用课题 PDF 详情"></textarea></label>
                  <label class="file-picker compact-file-picker">
                    <span>{{ state.myProjectForm.documentUpload.file ? state.myProjectForm.documentUpload.file.name : '选择 PDF' }}</span>
                    <input :key="state.myProjectForm.documentUpload.inputKey" type="file" accept="application/pdf,.pdf" @change="setMyProjectDocumentFile" />
                  </label>
                  <span class="muted-inline pdf-save-hint">选择后点击下方保存/发布，PDF 会随课题一起上传或替换。</span>
                </div>
              </section>
              <div class="button-row form-actions">
                <button class="ghost-button" type="submit" :disabled="state.savingMyProject">{{ myProjectStageEditable(state.myProjectForm) ? '保存草稿' : '保存修改' }}</button>
                <button v-if="myProjectStageEditable(state.myProjectForm)" class="primary-button" type="button" :disabled="state.savingMyProject" @click="saveMyProject({ publish: true })">
                  {{ state.savingMyProject ? '保存中' : '发布课题' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div v-if="state.contributionModal.open" class="project-form-modal task-result-modal" @click.self="closeContributionModal">
          <section ref="contributionModalRef" class="project-form-dialog task-result-dialog" role="dialog" aria-modal="true" aria-label="提交任务结果" tabindex="-1" @keydown="trapModalFocus($event, contributionModalRef)">
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
              <div class="project-document-upload contribution-document-upload">
                <label class="file-picker compact-file-picker">
                  <span>{{ state.forms.contribution.documentFile ? state.forms.contribution.documentFile.name : '结果文档（PDF/Markdown，可选）' }}</span>
                  <input :key="state.forms.contribution.inputKey" type="file" accept="application/pdf,.pdf,text/markdown,.md,.markdown" @change="setContributionFile" />
                </label>
                <button v-if="state.forms.contribution.documentFile" class="ghost-button" type="button" @click="clearContributionFile">移除文档</button>
                <small v-if="state.forms.contribution.documentFile">{{ formatFileSize(state.forms.contribution.documentFile.size) }}</small>
              </div>
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
          <section ref="taskProjectDetailRef" class="project-form-dialog task-detail-dialog" role="dialog" aria-modal="true" aria-label="任务管理详情" tabindex="-1" @keydown="trapModalFocus($event, taskProjectDetailRef)">
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
                        <small>{{ item.subtype_label ? item.subtype_label + ' · ' : '' }}{{ item.status_label }}</small>
                      </span>
                    </div>
                  </div>
                  <p v-else>暂无已获批人员。</p>
                </section>

                <section class="task-detail-section">
                  <h3>已提交结果</h3>
                  <div v-if="state.admin.taskProjectDetail.contributions.length" class="admin-table contribution-review-table contribution-result-table">
                    <div class="admin-table-head"><span>结果</span><span>提交 UID</span><span>状态</span><span>文档</span></div>
                    <div class="admin-table-row" v-for="item in state.admin.taskProjectDetail.contributions" :key="item.id">
                      <span><strong>{{ item.title }}</strong><small>{{ contributionStatusText(item) }} · {{ item.description || '暂无说明' }}</small></span>
                      <span>{{ item.user.uid }}</span>
                      <span>{{ item.status_label }}</span>
                      <span>
                        <a v-if="item.file_path" class="ghost-button" :href="contributionFileHref(item)" target="_blank" rel="noopener">查看文档</a>
                        <small v-else class="muted-inline">未上传文档</small>
                        <small v-if="item.file_path">{{ contributionFileName(item) }}</small>
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
          <section ref="confirmDialogRef" class="confirm-modal" :class="'confirm-modal--' + state.confirmDialog.tone" role="dialog" aria-modal="true" aria-label="确认操作" tabindex="-1" @keydown="trapModalFocus($event, confirmDialogRef)">
            <h2>{{ state.confirmDialog.title }}</h2>
            <p>{{ state.confirmDialog.message }}</p>
            <div class="button-row">
              <button class="ghost-button" type="button" @click="resolveConfirmDialog(false)">{{ state.confirmDialog.cancelText }}</button>
              <button class="primary-button" type="button" @click="resolveConfirmDialog(true)">{{ state.confirmDialog.confirmText }}</button>
            </div>
          </section>
        </div>

      </main>
    </div>
  `
};

function mergeSidebarQrEntries(entries = []) {
  return SIDEBAR_QR_ENTRIES.map((base) => {
    const saved = entries.find((entry) => entry.key === base.key) || {};
    return {
      ...base,
      ...saved,
      label: saved.label || base.label,
      icon: saved.icon || base.icon,
      image: saved.image || base.image || "",
      has_image: Boolean(saved.has_image && saved.image)
    };
  });
}

function replaceSidebarQrEntry(entries = [], entry) {
  const merged = mergeSidebarQrEntries(entries);
  return merged.map((item) => (item.key === entry.key ? { ...item, ...entry } : item));
}

function sidebarQrImageSrc(entry) {
  const image = String(entry?.image || "").trim();
  if (!image) return "";
  if (/^https?:\/\//i.test(image)) return image;
  const normalized = image.startsWith("/") ? image : `/${image}`;
  return `${API_BASE}${normalized}`;
}

function sidebarQrAlt(entry) {
  return `${entry?.label || "系统入口"}二维码`;
}

function emptyThemeForm() {
  return {
    id: null,
    name: "",
    slug: "",
    description: "",
    sort_order: 0,
    is_active: true
  };
}

function emptyThemeFileForm(themeId = null) {
  return {
    id: null,
    theme_id: themeId,
    section: "数据集说明文件",
    file_type: "dataset_meta",
    title: "",
    description: "",
    path: "",
    detail_pdf_title: "",
    detail_pdf_path: "",
    sort_order: 0,
    is_active: true,
    detailPdfUpload: emptyThemeFileDetailPdfUpload()
  };
}

function themeFileFormFromFile(file, detailPdfUpload = emptyThemeFileDetailPdfUpload()) {
  return {
    id: file.id,
    theme_id: file.theme_id,
    section: file.section || "数据集说明文件",
    file_type: file.file_type || "dataset_meta",
    title: file.title || "",
    description: file.description || "",
    path: file.path || "",
    detail_pdf_title: file.detail_pdf_title || "",
    detail_pdf_path: file.detail_pdf_path || "",
    sort_order: file.sort_order || 0,
    is_active: file.is_active,
    detailPdfUpload
  };
}

function emptyThemeFileDetailPdfUpload() {
  return {
    title: "",
    file: null,
    uploading: false,
    inputKey: 0
  };
}

function themeDatasetFormTouched(form = {}) {
  const upload = form.detailPdfUpload || {};
  return Boolean(
    form.id ||
    String(form.title || "").trim() ||
    String(form.description || "").trim() ||
    String(form.detail_pdf_title || "").trim() ||
    String(form.detail_pdf_path || "").trim() ||
    upload.file
  );
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
    documentFile: null,
    inputKey: 0
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
    stage_label: "草稿",
    tags: "",
    is_public: false,
    documents: [],
    documentUpload: emptyProjectDocumentUpload(),
    progressDocumentUpload: emptyProjectDocumentUpload("progress")
  };
}

function emptyProjectDocumentUpload(documentKind = "detail") {
  return {
    document_kind: documentKind,
    doc_type: "pdf",
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
    stage_label: project.stage_label || "",
    tags: (project.tags || []).map((tag) => tag.name).join("，"),
    is_public: Boolean(project.is_public),
    documents: project.documents || [],
    documentUpload: emptyProjectDocumentUpload(),
    progressDocumentUpload: emptyProjectDocumentUpload("progress")
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
  if (parts[0] === "project" && parts[1]) {
    return { name: "project", params: { id: parts[1] }, fullPath: location.hash };
  }
  const known = new Set(["home", "projects", "faq", "dashboard", "favorites", "admin", "login", "register", "password-reset", "password-change"]);
  return { name: known.has(parts[0]) ? parts[0] : "home", params: {}, fullPath: location.hash };
}

function buildHash(name, params = {}) {
  if (name === "home") return "#/";
  if (name === "project") return params.id ? `#/project/${params.id}` : "#/";
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

function projectEngagementCount(project) {
  return numericProjectField(project, "score_count") + numericProjectField(project, "follow_count");
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
  { slug: "yindaojing", name: "阴道镜", keywords: ["yindaojing", "阴道镜", "colposcopy"] },
  { slug: "amd", name: "AMD", keywords: ["amd", "年龄相关性黄斑变性", "age-related macular degeneration"] }
];
const TOPIC_LOGO_RULES = [
  { file: "AntiVEGF_img.png", keywords: ["vegf", "anti-vegf", "antivegf", "抗vegf"] },
  { file: "ROP.png", keywords: ["rop", "早产儿视网膜病变"] },
  { file: "Yindaojing.png", keywords: ["yindaojing", "阴道镜", "colposcopy"] }
];

function topicThemeCards(themes = []) {
  return [...themes].sort((a, b) => {
    const presetA = FEATURED_TOPIC_THEMES.findIndex((preset) => topicThemeMatchesPreset(a, preset));
    const presetB = FEATURED_TOPIC_THEMES.findIndex((preset) => topicThemeMatchesPreset(b, preset));
    const rankA = presetA === -1 ? 100 : presetA;
    const rankB = presetB === -1 ? 100 : presetB;
    return rankA - rankB || Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans");
  });
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

function projectCardTitle(project) {
  const title = String(project?.title || "未命名课题").trim() || "未命名课题";
  return `${topicCode(project)}: ${title}`;
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
    ProjectInterest: "参与",
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
    const matched = matchedRequiredTeamRole(teamStatus, role, backendRequiredRoles);
    const count = matched ? Number(matched.count || 0) : projectRoleCount(teamStatus, role, backendRequiredRoles);
    const required = Number(matched?.required || role.required || 1);
    const overfilled = Boolean(matched?.overfilled) || count > required;
    return {
      ...role,
      label: matched?.label || role.label,
      count,
      required,
      ready: Boolean(matched?.ready) || count >= required,
      overfilled,
      status: matched?.status || (overfilled ? "overfilled" : count >= required ? "ready" : "missing")
    };
  });
}

function projectRoleCount(teamStatus, role, backendRequiredRoles) {
  const matchedRequiredRole = matchedRequiredTeamRole(teamStatus, role, backendRequiredRoles);
  if (matchedRequiredRole) return Number(matchedRequiredRole.count || 0);
  const aliases = roleAliases(role);
  const matchedVisibleGroup = (teamStatus?.visible_role_groups || []).find((item) => aliases.includes(item.role_type) || aliases.includes(item.label));
  if (matchedVisibleGroup) return Number(matchedVisibleGroup.count || 0);
  const matchedRole = roleCountEntries(teamStatus).find(([key]) => aliases.includes(key));
  return matchedRole ? Number(matchedRole[1] || 0) : 0;
}

function matchedRequiredTeamRole(teamStatus, role, backendRequiredRoles = []) {
  const roles = backendRequiredRoles.length ? backendRequiredRoles : (Array.isArray(teamStatus?.required_roles) ? teamStatus.required_roles : []);
  const aliases = roleAliases(role);
  return roles.find((item) => aliases.includes(item.key) || aliases.includes(item.label));
}

function roleAliases(role) {
  const aliases = {
    doctor: ["doctor", "医生", "医生（医学指导）"],
    student: ["student", "学生", "学生（实验）"],
    ai_phd_or_above: ["ai_phd_or_above", "mentor", "大学老师", "博士毕业及以上", "博士毕业及以上（指导）"],
    leader: ["leader", "Leader", "项目负责人", "Leader（项目负责人）"]
  }[role.key] || [role.key];
  return aliases;
}

function preferredSponsorTypes(types = []) {
  const preferred = ["compute", "token", "labor_fee"];
  const byValue = new Map((types || []).map((item) => [item.value, item]));
  return preferred.map((value) => byValue.get(value)).filter(Boolean);
}

function sponsorOptionsByValue(types = [], values = []) {
  const byValue = new Map((types || []).map((item) => [item.value, item]));
  return values.map((value) => byValue.get(value) || { value, label: sponsorTypeFallbackLabel(value) });
}

function sponsorTypeFallbackLabel(value) {
  return {
    labor_fee: "资助劳务费",
    compute: "资助算力",
    token: "资助 token"
  }[value] || value;
}

function projectSponsorCount(project) {
  return Number(project?.team_status?.sponsor_count ?? 0);
}

function projectFundingReady(project) {
  return projectSponsorCount(project) > 0;
}

function projectFundingLabel(project) {
  return projectFundingReady(project) ? "已获资助" : "待资助";
}

function projectStageValue(project) {
  return project?.stage || "";
}

function projectStageTone(project) {
  return {
    open_recruiting: "stage-open",
    team_building: "stage-team-building",
    active: "stage-active",
    paused: "stage-paused",
    archived: "stage-archived",
    draft: "stage-draft"
  }[projectStageValue(project)] || "stage-default";
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
  if (projectStartupReady(project)) return "最低团队已满足，并已获资助，具备管理员推进判断条件";
  const missing = [];
  if (!projectTeamReady(project)) missing.push("成员未达最低要求");
  if (!projectFundingReady(project)) missing.push("待资助");
  return `待启动：${missing.join("，")}`;
}

function projectDocuments(project) {
  return Array.isArray(project?.documents) ? project.documents.filter((document) => document.path) : [];
}

function projectProgressDocumentsFor(project) {
  return projectDocuments(project).filter((document) => document.document_kind === "progress");
}

function primaryProjectDocument(project) {
  const direct = project?.detail_document;
  if (direct?.path) return direct;
  return projectDocuments(project).find((document) => document.document_kind === "detail" && document.doc_type === "pdf")
    || projectDocuments(project).find((document) => document.doc_type === "pdf")
    || null;
}

function hasPrimaryProjectPdf(project) {
  return Boolean(primaryProjectDocument(project)?.path);
}

function projectPdfHref(project) {
  const document = primaryProjectDocument(project);
  return document?.path ? documentHref(document) : "";
}

function projectDetailHref(project) {
  return project?.id ? `#/project/${project.id}` : "#/";
}

function projectCreatorLabel(project) {
  const contact = projectCreatorContact(project);
  const label = contact?.name || contact?.uid;
  return label ? `创建者：${label}` : "创建者：系统导入";
}

function projectCreatorContact(project) {
  return project?.created_by_display || project?.created_by || null;
}

function contactHoverPosition(event) {
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  if (!rect || typeof window === "undefined") return { x: 12, y: 12 };
  const cardWidth = Math.min(300, Math.max(240, window.innerWidth - 24));
  const cardHeight = Math.min(320, Math.max(160, window.innerHeight - 24));
  const maxX = Math.max(12, window.innerWidth - cardWidth - 12);
  const maxY = Math.max(12, window.innerHeight - cardHeight - 12);
  return {
    x: Math.round(Math.min(maxX, Math.max(12, rect.left))),
    y: Math.round(Math.min(maxY, Math.max(12, rect.bottom + 8)))
  };
}

function showContactHoverCard(event, title, members = []) {
  cancelContactHoverCardHide();
  const position = contactHoverPosition(event);
  state.contactHoverCard = {
    visible: true,
    x: position.x,
    y: position.y,
    title,
    members: members.filter(Boolean)
  };
}

function showProjectCreatorContactCard(event, project) {
  const contact = projectCreatorContact(project);
  if (!contact) return;
  showContactHoverCard(event, "创建者", [contact]);
}

function showTeamContactCard(event, role, project) {
  if (!state.user) return;
  const members = teamContactMembers(project, role);
  showContactHoverCard(event, role?.label || "组队成员", members);
}

function cancelContactHoverCardHide() {
  if (contactHoverHideTimer) {
    window.clearTimeout(contactHoverHideTimer);
    contactHoverHideTimer = null;
  }
}

function hideContactHoverCard() {
  cancelContactHoverCardHide();
  state.contactHoverCard.visible = false;
}

function scheduleHideContactHoverCard() {
  cancelContactHoverCardHide();
  contactHoverHideTimer = window.setTimeout(() => {
    state.contactHoverCard.visible = false;
    contactHoverHideTimer = null;
  }, 120);
}

function contactName(contact) {
  return contact?.name || contact?.uid || "未命名用户";
}

function contactWechatText(contact) {
  if (contact?.wechat_visible && contact?.wechat) return `微信：${contact.wechat}`;
  return state.user ? "未填写微信" : "登录后可查看微信";
}

function teamContactGroup(project, role) {
  const groups = Array.isArray(project?.team_contact_groups) ? project.team_contact_groups : [];
  return groups.find((item) => item.key === role?.key) || { members: [] };
}

function teamContactMembers(project, role) {
  return teamContactGroup(project, role).members || [];
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

function contributionFileHref(contribution) {
  const path = String(contribution?.file_path || "").trim();
  if (!path || /^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function contributionFileName(contribution) {
  const path = String(contribution?.file_path || "").trim();
  if (!path) return "";
  return path.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || path;
}

function contributionDocumentFileAllowed(file) {
  const name = String(file?.name || "").toLowerCase();
  return [".pdf", ".md", ".markdown"].some((suffix) => name.endsWith(suffix));
}

function themeFileDetailPdfHref(file) {
  const path = String(file?.detail_pdf_path || "").trim();
  if (!path || /^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
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

function lockedStageProjectPayload(payload) {
  const data = { ...payload };
  delete data.stage;
  delete data.is_public;
  return data;
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
  if (capabilities.manage_projects) cards.push({ title: "内容管理", body: "可维护主题、课题、PDF 文档和 JSON 模板导入。" });
  if (!cards.length) cards.push({ title: "开放协作", body: "可关注、点赞、参与和认领开放课题。" });
  return cards;
}

createApp(App).mount("#app");
