import { createApp, computed, onMounted, reactive, watch } from "vue";
import { api, initCsrf } from "./api.js";
import "./styles.css";

const state = reactive({
  booting: true,
  loading: false,
  toast: "",
  route: parseRoute(),
  user: null,
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
  filters: {
    q: "",
    theme: "",
    tag: "",
    stage: "",
    has_pdf: "",
    sort: "recommended",
    page: 1,
    page_size: 12
  },
  currentProject: null,
  dashboard: null,
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
    const currentProjectId = computed(() => state.route.params.id);
    const stats = computed(() => {
      const total = state.pagination.total_count || state.projects.length;
      const follows = state.projects.reduce((sum, item) => sum + (item.follow_count || 0), 0);
      const interests = state.projects.reduce((sum, item) => sum + (item.interest_count || 0), 0);
      return { total, follows, interests, themes: state.meta.themes.length };
    });

    onMounted(async () => {
      window.addEventListener("hashchange", handleRouteChange);
      await boot();
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
        const [meta, user] = await Promise.all([api.meta(), api.me().catch(() => null)]);
        state.meta = meta;
        state.user = user;
        await loadRouteData();
      } catch (error) {
        showToast(error.message || "系统初始化失败");
      } finally {
        state.booting = false;
      }
    }

    async function loadRouteData() {
      if (state.booting) return;
      if (state.route.name === "projects" || state.route.name === "home") {
        await loadProjects();
      }
      if (state.route.name === "project" && currentProjectId.value) {
        await loadProject(currentProjectId.value);
      }
      if (state.route.name === "dashboard") {
        await loadDashboard();
      }
    }

    async function loadProjects() {
      state.loading = true;
      try {
        const data = await api.projects(state.filters);
        state.projects = data.results;
        state.pagination = data.pagination;
      } catch (error) {
        showToast(error.message);
      } finally {
        state.loading = false;
      }
    }

    async function loadProject(id) {
      state.loading = true;
      state.currentProject = null;
      try {
        state.currentProject = await api.project(id);
        state.forms.score.score = state.currentProject.viewer_state?.score?.score || 8;
        state.forms.score.comment = state.currentProject.viewer_state?.score?.comment || "";
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

    async function submitFilters() {
      state.filters.page = 1;
      navigate("projects");
      await loadProjects();
    }

    async function pageTo(page) {
      state.filters.page = page;
      await loadProjects();
    }

    async function login() {
      try {
        state.user = await api.login(state.forms.login);
        showToast("登录成功");
        navigate("dashboard");
      } catch (error) {
        showToast(error.message);
      }
    }

    async function register() {
      try {
        state.user = await api.register(state.forms.register);
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
      stats,
      navigate,
      submitFilters,
      pageTo,
      login,
      register,
      logout,
      toggleFollow,
      submitScore,
      submitInterest,
      submitClaim,
      submitSponsor,
      displayScore,
      shortText,
      stageLabel,
      roleCountEntries
    };
  },
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" @click="navigate('home')">
          <span class="brand-mark">OM</span>
          <span>
            <strong>OpenMedAILab</strong>
            <small>医学 AI 科研协作</small>
          </span>
        </button>
        <nav class="side-nav">
          <button :class="{active: activeView === 'home'}" @click="navigate('home')">总览</button>
          <button :class="{active: activeView === 'projects'}" @click="navigate('projects')">课题库</button>
          <button :class="{active: activeView === 'dashboard'}" @click="navigate('dashboard')">工作台</button>
        </nav>
        <div class="sidebar-note">
          <strong>前后端分离版</strong>
          <span>所有数据来自 Django JSON API。</span>
        </div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">Open research operations</p>
            <h1>{{ activeView === 'project' ? '课题详情' : activeView === 'projects' ? '课题库' : activeView === 'dashboard' ? '我的工作台' : '协作总览' }}</h1>
          </div>
          <div class="user-box">
            <template v-if="state.user">
              <span>{{ state.user.profile?.display_name || state.user.username }}</span>
              <button class="ghost" @click="logout">退出</button>
            </template>
            <template v-else>
              <button class="ghost" @click="navigate('login')">登录</button>
              <button @click="navigate('register')">注册</button>
            </template>
          </div>
        </header>

        <main>
          <div v-if="state.toast" class="toast">{{ state.toast }}</div>
          <div v-if="state.booting" class="loading-panel">正在连接系统接口...</div>

          <template v-else>
            <section v-if="activeView === 'home'" class="view-stack">
              <div class="hero-band">
                <div>
                  <p class="eyebrow">MVP collaboration loop</p>
                  <h2>把开放医学 AI 课题变成可跟踪、可组队、可推进的项目池。</h2>
                  <p>浏览课题、筛选方向、提交参与意向、记录资助与认领，管理员在后台沉淀真实互动数据。</p>
                </div>
                <button @click="navigate('projects')">进入课题库</button>
              </div>

              <div class="metrics-grid">
                <div class="metric"><span>{{ stats.total }}</span><small>课题</small></div>
                <div class="metric"><span>{{ stats.themes }}</span><small>主题</small></div>
                <div class="metric"><span>{{ stats.follows }}</span><small>近期关注</small></div>
                <div class="metric"><span>{{ stats.interests }}</span><small>参与意向</small></div>
              </div>

              <section class="section-block">
                <div class="section-head">
                  <h2>推荐课题</h2>
                  <button class="ghost" @click="navigate('projects')">查看全部</button>
                </div>
                <div class="project-grid">
                  <article v-for="project in state.projects.slice(0, 6)" :key="project.id" class="project-card" @click="navigate('project', { id: project.id })">
                    <div class="card-top">
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span>{{ project.stage_label }}</span>
                    </div>
                    <h3>{{ project.title }}</h3>
                    <p>{{ shortText(project.summary, 118) }}</p>
                    <div class="tag-row">
                      <span v-for="tag in project.tags.slice(0, 4)" :key="tag.id">{{ tag.name }}</span>
                    </div>
                    <div class="card-metrics">
                      <span>综合 {{ displayScore(project.composite_score) }}</span>
                      <span>关注 {{ project.follow_count || 0 }}</span>
                      <span>参与 {{ project.interest_count || 0 }}</span>
                    </div>
                  </article>
                </div>
              </section>
            </section>

            <section v-if="activeView === 'projects'" class="view-stack">
              <form class="filter-bar" @submit.prevent="submitFilters">
                <label>
                  <span>搜索</span>
                  <input v-model="state.filters.q" placeholder="RAG / OCT / 安全评测" />
                </label>
                <label>
                  <span>主题</span>
                  <select v-model="state.filters.theme">
                    <option value="">全部主题</option>
                    <option v-for="theme in state.meta.themes" :key="theme.slug" :value="theme.slug">{{ theme.name }}</option>
                  </select>
                </label>
                <label>
                  <span>标签</span>
                  <select v-model="state.filters.tag">
                    <option value="">全部标签</option>
                    <option v-for="tag in state.meta.tags" :key="tag.slug" :value="tag.slug">{{ tag.name }}</option>
                  </select>
                </label>
                <label>
                  <span>阶段</span>
                  <select v-model="state.filters.stage">
                    <option value="">全部阶段</option>
                    <option v-for="stage in state.meta.project_stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
                  </select>
                </label>
                <label>
                  <span>排序</span>
                  <select v-model="state.filters.sort">
                    <option value="recommended">综合推荐</option>
                    <option value="llm_score">初始评分</option>
                    <option value="community_score">社区评分</option>
                    <option value="follows">关注数</option>
                    <option value="updated">最近更新</option>
                    <option value="project_no">课题编号</option>
                  </select>
                </label>
                <button type="submit">筛选</button>
              </form>

              <div class="result-line">
                <span>共 {{ state.pagination.total_count || 0 }} 个匹配课题</span>
                <span v-if="state.loading">正在刷新...</span>
              </div>

              <div class="project-grid">
                <article v-for="project in state.projects" :key="project.id" class="project-card" @click="navigate('project', { id: project.id })">
                  <div class="card-top">
                    <span>{{ project.topic_id }}</span>
                    <span>{{ project.stage_label }}</span>
                  </div>
                  <h3>{{ project.title }}</h3>
                  <p>{{ shortText(project.summary, 142) }}</p>
                  <div class="tag-row">
                    <span v-for="tag in project.tags.slice(0, 5)" :key="tag.id">{{ tag.name }}</span>
                  </div>
                  <div class="card-metrics">
                    <span>初评 {{ displayScore(project.llm_score) }}</span>
                    <span>社区 {{ displayScore(project.community_score) }}</span>
                    <span>关注 {{ project.follow_count || 0 }}</span>
                    <span>参与 {{ project.interest_count || 0 }}</span>
                  </div>
                </article>
              </div>

              <div class="pagination" v-if="state.pagination.total_pages > 1">
                <button class="ghost" :disabled="!state.pagination.has_previous" @click="pageTo(state.pagination.page - 1)">上一页</button>
                <span>{{ state.pagination.page }} / {{ state.pagination.total_pages }}</span>
                <button class="ghost" :disabled="!state.pagination.has_next" @click="pageTo(state.pagination.page + 1)">下一页</button>
              </div>
            </section>

            <section v-if="activeView === 'project'" class="view-stack">
              <div v-if="state.loading || !state.currentProject" class="loading-panel">正在读取课题详情...</div>
              <template v-else>
                <article class="detail-hero">
                  <div>
                    <p class="eyebrow">{{ state.currentProject.theme?.name }} · {{ state.currentProject.topic_id }}</p>
                    <h2>{{ state.currentProject.title }}</h2>
                    <p>{{ state.currentProject.summary }}</p>
                    <div class="tag-row">
                      <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                  <div class="score-panel">
                    <span>{{ displayScore(state.currentProject.composite_score) }}</span>
                    <small>综合评分</small>
                    <button @click="toggleFollow(state.currentProject)">
                      {{ state.currentProject.viewer_state?.is_following ? '已关注' : '关注课题' }}
                    </button>
                  </div>
                </article>

                <div class="detail-grid">
                  <section class="section-block">
                    <div class="section-head">
                      <h2>组队状态</h2>
                      <span :class="['status-pill', state.currentProject.team_status.basic_ready ? 'ready' : '']">
                        {{ state.currentProject.team_status.basic_ready ? '基础团队已具备' : '继续招募' }}
                      </span>
                    </div>
                    <div class="team-grid">
                      <div v-for="[role, count] in roleCountEntries(state.currentProject.team_status.roles)" :key="role">
                        <strong>{{ count }}</strong>
                        <span>{{ role }}</span>
                      </div>
                      <div>
                        <strong>{{ state.currentProject.team_status.sponsor_count }}</strong>
                        <span>资助意向</span>
                      </div>
                    </div>
                  </section>

                  <section class="section-block">
                    <h2>核心指标</h2>
                    <dl class="fact-list">
                      <div><dt>阶段</dt><dd>{{ state.currentProject.stage_label }}</dd></div>
                      <div><dt>推荐期刊</dt><dd>{{ state.currentProject.recommended_journal || '-' }}</dd></div>
                      <div><dt>初始评分</dt><dd>{{ displayScore(state.currentProject.llm_score) }}</dd></div>
                      <div><dt>社区评分</dt><dd>{{ displayScore(state.currentProject.community_score) }}</dd></div>
                    </dl>
                  </section>
                </div>

                <section class="interaction-grid">
                  <form class="action-panel" @submit.prevent="submitScore">
                    <h3>评分</h3>
                    <label><span>1-10 分</span><input type="number" min="1" max="10" v-model="state.forms.score.score" /></label>
                    <label><span>短评</span><textarea rows="3" v-model="state.forms.score.comment"></textarea></label>
                    <button type="submit">提交评分</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitInterest">
                    <h3>参与意向</h3>
                    <label><span>角色</span><select v-model="state.forms.interest.role"><option v-for="role in state.meta.participation_roles" :value="role.value">{{ role.label }}</option></select></label>
                    <label><span>每周小时</span><input type="number" min="0" v-model="state.forms.interest.available_hours_per_week" /></label>
                    <label><span>经验</span><textarea rows="3" v-model="state.forms.interest.experience"></textarea></label>
                    <button type="submit">提交参与</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitClaim">
                    <h3>认领意向</h3>
                    <label><span>方向</span><select v-model="state.forms.claim.claim_type"><option v-for="item in state.meta.claim_types" :value="item.value">{{ item.label }}</option></select></label>
                    <label><span>计划</span><textarea rows="4" v-model="state.forms.claim.message"></textarea></label>
                    <button type="submit">提交认领</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitSponsor">
                    <h3>资助意向</h3>
                    <label><span>类型</span><select v-model="state.forms.sponsor.sponsor_type"><option v-for="item in state.meta.sponsor_types" :value="item.value">{{ item.label }}</option></select></label>
                    <label><span>说明</span><textarea rows="4" v-model="state.forms.sponsor.note"></textarea></label>
                    <button type="submit">记录意向</button>
                  </form>
                </section>

                <section class="section-block">
                  <div class="section-head"><h2>课题原文</h2><span>{{ state.currentProject.source_md_path }}</span></div>
                  <pre class="markdown-view">{{ state.currentProject.body_markdown || '暂无正文。' }}</pre>
                </section>
              </template>
            </section>

            <section v-if="activeView === 'dashboard'" class="view-stack">
              <div v-if="!state.user" class="auth-shell">
                <h2>请先登录</h2>
                <button @click="navigate('login')">去登录</button>
              </div>
              <template v-else-if="state.dashboard">
                <div class="metrics-grid">
                  <div class="metric"><span>{{ state.dashboard.follows.length }}</span><small>关注</small></div>
                  <div class="metric"><span>{{ state.dashboard.interests.length }}</span><small>参与</small></div>
                  <div class="metric"><span>{{ state.dashboard.claims.length }}</span><small>认领</small></div>
                  <div class="metric"><span>{{ state.dashboard.scores.length }}</span><small>评分</small></div>
                </div>
                <div class="dashboard-grid">
                  <section class="section-block">
                    <h2>我的参与意向</h2>
                    <p v-for="item in state.dashboard.interests" :key="item.id" class="activity-row">
                      <span>{{ item.role_label }}</span>
                      <button class="link-button" @click="navigate('project', { id: item.project.id })">{{ item.project.title }}</button>
                    </p>
                    <p v-if="!state.dashboard.interests.length" class="empty">还没有提交参与意向。</p>
                  </section>
                  <section class="section-block">
                    <h2>我的关注课题</h2>
                    <p v-for="item in state.dashboard.follows" :key="item.id" class="activity-row">
                      <span>{{ item.project.stage_label }}</span>
                      <button class="link-button" @click="navigate('project', { id: item.project.id })">{{ item.project.title }}</button>
                    </p>
                    <p v-if="!state.dashboard.follows.length" class="empty">还没有关注课题。</p>
                  </section>
                </div>
              </template>
            </section>

            <section v-if="activeView === 'login'" class="auth-shell">
              <form class="auth-panel" @submit.prevent="login">
                <h2>登录</h2>
                <label><span>用户名</span><input v-model="state.forms.login.username" autocomplete="username" /></label>
                <label><span>密码</span><input type="password" v-model="state.forms.login.password" autocomplete="current-password" /></label>
                <button type="submit">登录系统</button>
                <button type="button" class="ghost" @click="navigate('register')">创建账号</button>
              </form>
            </section>

            <section v-if="activeView === 'register'" class="auth-shell">
              <form class="auth-panel" @submit.prevent="register">
                <h2>注册</h2>
                <label><span>用户名</span><input v-model="state.forms.register.username" /></label>
                <label><span>邮箱</span><input type="email" v-model="state.forms.register.email" /></label>
                <label><span>昵称</span><input v-model="state.forms.register.display_name" /></label>
                <label><span>身份</span><select v-model="state.forms.register.role_type"><option v-for="role in state.meta.profile_roles" :value="role.value">{{ role.label }}</option></select></label>
                <label><span>密码</span><input type="password" v-model="state.forms.register.password1" /></label>
                <label><span>确认密码</span><input type="password" v-model="state.forms.register.password2" /></label>
                <button type="submit">注册并进入工作台</button>
              </form>
            </section>
          </template>
        </main>
      </section>
    </div>
  `
};

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", params: {}, fullPath: location.hash || "#/" };
  if (parts[0] === "projects" && parts[1]) return { name: "project", params: { id: parts[1] }, fullPath: location.hash };
  if (parts[0] === "projects") return { name: "projects", params: {}, fullPath: location.hash };
  if (parts[0] === "dashboard") return { name: "dashboard", params: {}, fullPath: location.hash };
  if (parts[0] === "login") return { name: "login", params: {}, fullPath: location.hash };
  if (parts[0] === "register") return { name: "register", params: {}, fullPath: location.hash };
  return { name: "home", params: {}, fullPath: location.hash };
}

function buildHash(name, params = {}) {
  if (name === "home") return "#/";
  if (name === "project") return `#/projects/${params.id}`;
  return `#/${name}`;
}

function handleRouteChange() {
  state.route = parseRoute();
}

function displayScore(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(1);
}

function shortText(text, length) {
  if (!text) return "";
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function stageLabel(project) {
  return project?.stage_label || project?.stage || "-";
}

function roleCountEntries(roles) {
  return Object.entries(roles || {});
}

createApp(App).mount("#app");
