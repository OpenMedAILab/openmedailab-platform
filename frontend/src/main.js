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
    themes: [],
    projects: [],
    projectPagination: {},
    projectSearch: "",
    themeForm: emptyThemeForm(),
    importText: ""
  },
  forms: {
    login: { username: "", password: "" },
    register: { username: "", email: "", display_name: "", role_type: "student", password1: "", password2: "" },
    score: { score: 8, comment: "" },
    interest: { role: "学生", available_hours_per_week: 4, experience: "", message: "" },
    claim: { claim_type: "literature", message: "" },
    sponsor: { sponsor_type: "compute", note: "" }
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
        await loadRouteData();
      } catch (error) {
        showToast(error.message || "系统初始化失败");
      } finally {
        state.booting = false;
      }
    }

    async function loadRouteData() {
      if (state.booting) return;
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
        const [themes, projects] = await Promise.all([api.adminThemes(), api.adminProjects({ page_size: 12 })]);
        state.admin.themes = themes.results;
        state.admin.projects = projects.results;
        state.admin.projectPagination = projects.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function searchAdminProjects() {
      const data = await api.adminProjects({ q: state.admin.projectSearch, page_size: 12 });
      state.admin.projects = data.results;
      state.admin.projectPagination = data.pagination;
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
        navigate("dashboard");
      } catch (error) {
        showToast(error.message);
      }
    }

    async function register() {
      try {
        state.user = await api.register(state.forms.register);
        state.rbac = state.user.rbac;
        showToast("注册成功");
        navigate("dashboard");
      } catch (error) {
        showToast(error.message);
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

    async function archiveProject(project) {
      if (!can("manage_projects")) return;
      await api.adminDeleteProject(project.id);
      showToast("课题已归档");
      await loadAdmin();
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
      state.route = parseRoute();
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
      register,
      logout,
      toggleFollow,
      submitScore,
      submitInterest,
      submitClaim,
      submitSponsor,
      saveTheme,
      editTheme,
      deactivateTheme,
      useExampleJson,
      importJson,
      archiveProject,
      searchAdminProjects,
      displayScore,
      shortText,
      roleCountEntries,
      formatList,
      fileTypeLabel,
      stageLabel
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
            {{ item.label }}
          </button>
        </nav>
        <div class="account-area">
          <span class="role-pill">{{ roleInfo.role_label }}</span>
          <button v-if="state.user" class="text-button" type="button" @click="navigate('dashboard')">{{ state.user.profile?.display_name || state.user.username }}</button>
          <button v-if="state.user" class="ghost-button" type="button" @click="logout">退出</button>
          <template v-else>
            <button class="ghost-button" type="button" @click="navigate('login')">登录</button>
            <button class="primary-button" type="button" @click="navigate('register')">注册</button>
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
            <div class="library-hero">
              <div>
                <span class="eyebrow">医学 AI 课题库</span>
                <h1>按主题浏览真实课题，找到可以加入的医学 AI 项目。</h1>
                <p>课题、主题、文件空间和协作记录全部来自后端数据库。登录后可关注、评分、申请参与、认领任务或表达资助意向。</p>
              </div>
              <div class="hero-stats">
                <div><strong>{{ stats.total }}</strong><span>课题</span></div>
                <div><strong>{{ stats.themes }}</strong><span>主题</span></div>
                <div><strong>{{ stats.interests }}</strong><span>参与意向</span></div>
              </div>
            </div>

            <div class="toolbar">
              <label class="search-box">
                <span>搜索</span>
                <input v-model="state.filters.q" type="search" placeholder="输入疾病、模型、任务或期刊" @keyup.enter="applyFilters" />
              </label>
              <label>
                <span>阶段</span>
                <select v-model="state.filters.stage" @change="applyFilters">
                  <option value="">全部阶段</option>
                  <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                </select>
              </label>
              <label>
                <span>排序</span>
                <select v-model="state.filters.sort" @change="applyFilters">
                  <option value="recommended">综合推荐</option>
                  <option value="llm_score">初始评分</option>
                  <option value="community_score">社区评分</option>
                  <option value="follows">关注热度</option>
                  <option value="updated">最近更新</option>
                  <option value="project_no">课题编号</option>
                </select>
              </label>
              <button class="primary-button" type="button" @click="applyFilters">筛选</button>
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
                <div class="card-topline">
                  <span>{{ project.theme?.name || '未分类' }}</span>
                  <span>{{ project.stage_label }}</span>
                </div>
                <h3>{{ project.title }}</h3>
                <p>{{ shortText(project.summary || project.problem_statement, 120) }}</p>
                <div class="tag-row">
                  <span v-for="tag in project.tags.slice(0, 4)" :key="tag.id">{{ tag.name }}</span>
                </div>
                <dl class="card-metrics">
                  <div><dt>综合</dt><dd>{{ displayScore(project.composite_score) }}</dd></div>
                  <div><dt>关注</dt><dd>{{ project.follow_count || 0 }}</dd></div>
                  <div><dt>参与</dt><dd>{{ project.interest_count || 0 }}</dd></div>
                </dl>
                <div class="card-actions">
                  <button class="primary-button" type="button" @click.stop="openProjectPreview(project)">查看详情</button>
                  <button class="ghost-button" type="button" @click.stop="toggleFollow(project)">关注</button>
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
                <span class="eyebrow">主题文件空间</span>
                <h1>按主题查看课题原文、PDF 与数据说明。</h1>
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
              <article class="content-panel">
                <h2>{{ state.themeSpace.theme.name }}</h2>
                <p>{{ state.themeSpace.theme.description || state.themeSpace.theme.file_space?.storage_policy }}</p>
                <dl class="card-metrics wide">
                  <div><dt>课题数</dt><dd>{{ state.themeSpace.project_count }}</dd></div>
                  <div><dt>文件数</dt><dd>{{ state.themeSpace.document_count }}</dd></div>
                  <div><dt>访问级别</dt><dd>{{ state.themeSpace.theme.file_space?.access_level || 'public_metadata' }}</dd></div>
                </dl>
              </article>
              <article class="content-panel">
                <h2>文件分组</h2>
                <div class="file-group" v-for="(docs, type) in state.themeSpace.documents_by_type" :key="type">
                  <h3>{{ fileTypeLabel(type) }}</h3>
                  <a v-for="doc in docs" :key="doc.id" :href="doc.path" target="_blank" rel="noreferrer">{{ doc.title || doc.path }}</a>
                </div>
                <p v-if="!state.themeSpace.document_count">暂无文件记录。</p>
              </article>
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
                  <h1>主题、课题与 JSON 导入</h1>
                  <p>管理操作会写入审计记录。删除采用停用或归档，避免误删协作数据。</p>
                </div>
              </div>
              <div class="admin-grid">
                <article class="content-panel">
                  <h2>课题字段契约</h2>
                  <div class="schema-table">
                    <div v-for="field in state.schema.fields" :key="field.name">
                      <strong>{{ field.label }}</strong>
                      <code>{{ field.name }}</code>
                      <span>{{ field.type }}{{ field.required ? ' · 必填' : '' }}</span>
                    </div>
                  </div>
                </article>
                <article class="content-panel">
                  <h2>{{ state.admin.themeForm.id ? '编辑主题' : '新增主题' }}</h2>
                  <form class="stack-form" @submit.prevent="saveTheme">
                    <input v-model="state.admin.themeForm.name" type="text" placeholder="主题名称" />
                    <input v-model="state.admin.themeForm.slug" type="text" placeholder="主题 slug" />
                    <textarea v-model="state.admin.themeForm.description" placeholder="主题说明"></textarea>
                    <textarea v-model="state.admin.themeForm.file_space" placeholder="文件空间 JSON"></textarea>
                    <label class="inline-check"><input v-model="state.admin.themeForm.is_active" type="checkbox" /> 启用主题</label>
                    <button class="primary-button" type="submit">保存主题</button>
                  </form>
                </article>
                <article class="content-panel wide-panel">
                  <div class="panel-title-row">
                    <h2>JSON 导入课题</h2>
                    <button class="ghost-button" type="button" @click="useExampleJson">填入示例</button>
                  </div>
                  <textarea class="json-editor" v-model="state.admin.importText"></textarea>
                  <button class="primary-button" type="button" @click="importJson">导入或更新</button>
                </article>
              </div>
              <div class="admin-grid">
                <article class="content-panel">
                  <h2>主题列表</h2>
                  <div class="manage-row" v-for="theme in state.admin.themes" :key="theme.id">
                    <span><strong>{{ theme.name }}</strong><small>{{ theme.slug }}</small></span>
                    <div class="button-row">
                      <button class="ghost-button" type="button" @click="editTheme(theme)">编辑</button>
                      <button class="ghost-button danger" type="button" @click="deactivateTheme(theme)">停用</button>
                    </div>
                  </div>
                </article>
                <article class="content-panel">
                  <div class="panel-title-row">
                    <h2>课题管理</h2>
                    <input v-model="state.admin.projectSearch" type="search" placeholder="搜索课题" @keyup.enter="searchAdminProjects" />
                  </div>
                  <div class="manage-row" v-for="project in state.admin.projects" :key="project.id">
                    <span><strong>{{ project.title }}</strong><small>{{ project.topic_id }} · {{ stageLabel(project) }}</small></span>
                    <button class="ghost-button danger" type="button" @click="archiveProject(project)">归档</button>
                  </div>
                </article>
              </div>
            </template>
            <section v-else class="empty-state">
              <h2>当前身份没有管理权限</h2>
              <p>管理员可以增删改主题和课题，并导入 JSON。</p>
            </section>
          </section>

          <section v-else-if="activeView === 'login'" class="auth-view">
            <form class="auth-card" @submit.prevent="login">
              <h1>登录</h1>
              <input v-model="state.forms.login.username" type="text" placeholder="用户名" autocomplete="username" />
              <input v-model="state.forms.login.password" type="password" placeholder="密码" autocomplete="current-password" />
              <button class="primary-button" type="submit">登录</button>
            </form>
          </section>

          <section v-else-if="activeView === 'register'" class="auth-view">
            <form class="auth-card" @submit.prevent="register">
              <h1>注册</h1>
              <input v-model="state.forms.register.username" type="text" placeholder="用户名" autocomplete="username" />
              <input v-model="state.forms.register.email" type="email" placeholder="邮箱" />
              <input v-model="state.forms.register.display_name" type="text" placeholder="昵称" />
              <select v-model="state.forms.register.role_type">
                <option v-for="role in state.meta.profile_roles" :key="role.value" :value="role.value">{{ role.label }}</option>
              </select>
              <input v-model="state.forms.register.password1" type="password" placeholder="密码" autocomplete="new-password" />
              <input v-model="state.forms.register.password2" type="password" placeholder="确认密码" autocomplete="new-password" />
              <button class="primary-button" type="submit">创建账号</button>
            </form>
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
      access_level: "public_metadata",
      sections: ["课题原文", "参考文献", "数据说明", "实验材料", "成果文件"]
    }, null, 2),
    sort_order: 0,
    is_active: true
  };
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", params: {}, fullPath: location.hash || "#/" };
  if (parts[0] === "project" && parts[1]) return { name: "project", params: { id: parts[1] }, fullPath: location.hash };
  if (parts[0] === "space") return { name: "space", params: { slug: parts[1] || "" }, fullPath: location.hash };
  const known = new Set(["home", "projects", "dashboard", "admin", "login", "register"]);
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
    markdown: "Markdown",
    pdf: "PDF",
    html: "网页",
    dataset_meta: "数据说明",
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
