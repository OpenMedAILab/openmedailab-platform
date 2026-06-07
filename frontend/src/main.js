import { createApp, computed, onMounted, reactive, watch } from "vue";
import { api, initCsrf } from "./api.js";

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
    const featuredProject = computed(() => state.projects[0] || null);
    const themeMatrix = computed(() => state.meta.themes.slice(0, 8));

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
      roleCountEntries,
      featuredProject,
      themeMatrix,
      signalWidth,
      topicInitial,
      scoreTone
    };
  },
  template: `
    <div class="app-shell">
      <div class="ambient-grid"></div>
      <div class="scanline"></div>

      <aside class="sidebar">
        <button class="brand" @click="navigate('home')" title="OpenMedAILab">
          <span class="brand-mark">
            <span class="brand-pulse"></span>
            OM
          </span>
          <span>
            <strong>OpenMedAILab</strong>
            <small>MED AI RESEARCH OS</small>
          </span>
        </button>

        <nav class="side-nav">
          <button :class="{active: activeView === 'home'}" @click="navigate('home')"><span class="nav-icon">01</span>指挥舱</button>
          <button :class="{active: activeView === 'projects'}" @click="navigate('projects')"><span class="nav-icon">02</span>课题库</button>
          <button :class="{active: activeView === 'dashboard'}" @click="navigate('dashboard')"><span class="nav-icon">03</span>工作台</button>
        </nav>

        <div class="system-chip">
          <span class="status-dot"></span>
          <strong>API ONLINE</strong>
          <small>{{ stats.total || 0 }} projects indexed</small>
        </div>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">Clinical intelligence network</p>
            <h1>{{ activeView === 'project' ? '课题任务舱' : activeView === 'projects' ? '课题信号矩阵' : activeView === 'dashboard' ? '个人协作台' : '医学 AI 协作中枢' }}</h1>
          </div>
          <div class="user-box">
            <template v-if="state.user">
              <span class="user-pill">{{ state.user.profile?.display_name || state.user.username }}</span>
              <button class="icon-button ghost" @click="logout" title="退出">OUT</button>
            </template>
            <template v-else>
              <button class="ghost" @click="navigate('login')">登录</button>
              <button @click="navigate('register')">注册</button>
            </template>
          </div>
        </header>

        <main>
          <div v-if="state.toast" class="toast">{{ state.toast }}</div>
          <div v-if="state.booting" class="loading-panel">
            <span class="loading-core"></span>
            正在同步医学 AI 课题数据...
          </div>

          <template v-else>
            <section v-if="activeView === 'home'" class="view-stack">
              <div class="command-hero">
                <div class="hero-copy">
                  <p class="eyebrow">OpenMedAILab Command Deck</p>
                  <h2>让医生、学生、工程师和资助者围绕真实医学 AI 课题快速成队。</h2>
                  <div class="hero-actions">
                    <button @click="navigate('projects')">进入课题矩阵</button>
                    <button class="ghost" @click="navigate('dashboard')">查看我的协作</button>
                  </div>
                </div>
                <div class="bio-core" aria-label="medical ai visual">
                  <div class="core-ring ring-one"></div>
                  <div class="core-ring ring-two"></div>
                  <div class="core-ring ring-three"></div>
                  <div class="neural-node n1"></div>
                  <div class="neural-node n2"></div>
                  <div class="neural-node n3"></div>
                  <div class="neural-node n4"></div>
                  <div class="core-label">
                    <strong>{{ stats.total || 0 }}</strong>
                    <span>ACTIVE TOPICS</span>
                  </div>
                </div>
              </div>

              <div class="metrics-grid holo">
                <div class="metric"><small>Project Index</small><span>{{ stats.total }}</span><em>DB synced</em></div>
                <div class="metric"><small>Research Themes</small><span>{{ stats.themes }}</span><em>clinical domains</em></div>
                <div class="metric"><small>Follow Signals</small><span>{{ stats.follows }}</span><em>from current page</em></div>
                <div class="metric"><small>Join Signals</small><span>{{ stats.interests }}</span><em>from current page</em></div>
              </div>

              <div class="home-grid">
                <section class="neural-panel">
                  <div class="section-head">
                    <div>
                      <p class="eyebrow">Theme map</p>
                      <h2>研究主题分布</h2>
                    </div>
                  </div>
                  <div class="theme-matrix">
                    <button v-for="theme in themeMatrix" :key="theme.id" @click="state.filters.theme = theme.slug; submitFilters();">
                      <span>{{ topicInitial(theme.name) }}</span>
                      <strong>{{ theme.name }}</strong>
                    </button>
                  </div>
                </section>

                <section class="feature-panel" v-if="featuredProject">
                  <p class="eyebrow">Top signal</p>
                  <h2>{{ featuredProject.title }}</h2>
                  <p>{{ shortText(featuredProject.summary, 170) }}</p>
                  <div class="signal-meter">
                    <span :style="{ width: signalWidth(featuredProject) }"></span>
                  </div>
                  <div class="feature-meta">
                    <span>{{ featuredProject.theme?.name }}</span>
                    <span>Score {{ displayScore(featuredProject.composite_score) }}</span>
                    <span>{{ featuredProject.stage_label }}</span>
                  </div>
                  <button @click="navigate('project', { id: featuredProject.id })">打开任务舱</button>
                </section>
              </div>

              <section class="section-block dark-section">
                <div class="section-head">
                  <div>
                    <p class="eyebrow">Recommended queue</p>
                    <h2>优先推进课题</h2>
                  </div>
                  <button class="ghost" @click="navigate('projects')">全部课题</button>
                </div>
                <div class="project-grid">
                  <article v-for="project in state.projects.slice(0, 6)" :key="project.id" class="project-card research-card" @click="navigate('project', { id: project.id })">
                    <div class="card-beam"></div>
                    <div class="card-top">
                      <span>{{ project.theme?.name || '未分类' }}</span>
                      <span :class="['score-badge', scoreTone(project)]">{{ displayScore(project.composite_score) }}</span>
                    </div>
                    <h3>{{ project.title }}</h3>
                    <p>{{ shortText(project.summary, 130) }}</p>
                    <div class="tag-row">
                      <span v-for="tag in project.tags.slice(0, 4)" :key="tag.id">{{ tag.name }}</span>
                    </div>
                    <div class="signal-meter compact"><span :style="{ width: signalWidth(project) }"></span></div>
                    <div class="card-metrics">
                      <span>关注 {{ project.follow_count || 0 }}</span>
                      <span>参与 {{ project.interest_count || 0 }}</span>
                      <span>{{ project.stage_label }}</span>
                    </div>
                  </article>
                </div>
              </section>
            </section>

            <section v-if="activeView === 'projects'" class="view-stack">
              <form class="filter-bar cockpit-filter" @submit.prevent="submitFilters">
                <label class="wide-field">
                  <span>检索课题信号</span>
                  <input v-model="state.filters.q" placeholder="RAG / OCT / 安全评测 / Agent" />
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
                <button type="submit">扫描</button>
              </form>

              <div class="result-line">
                <span>{{ state.pagination.total_count || 0 }} topics matched</span>
                <span v-if="state.loading" class="live-chip">SYNCING</span>
              </div>

              <div class="project-grid dense-grid">
                <article v-for="project in state.projects" :key="project.id" class="project-card research-card" @click="navigate('project', { id: project.id })">
                  <div class="card-beam"></div>
                  <div class="card-top">
                    <span>{{ project.topic_id }}</span>
                    <span>{{ project.stage_label }}</span>
                  </div>
                  <h3>{{ project.title }}</h3>
                  <p>{{ shortText(project.summary, 150) }}</p>
                  <div class="tag-row">
                    <span v-for="tag in project.tags.slice(0, 5)" :key="tag.id">{{ tag.name }}</span>
                  </div>
                  <div class="metric-strip">
                    <div><small>LLM</small><strong>{{ displayScore(project.llm_score) }}</strong></div>
                    <div><small>社区</small><strong>{{ displayScore(project.community_score) }}</strong></div>
                    <div><small>关注</small><strong>{{ project.follow_count || 0 }}</strong></div>
                    <div><small>参与</small><strong>{{ project.interest_count || 0 }}</strong></div>
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
              <div v-if="state.loading || !state.currentProject" class="loading-panel">
                <span class="loading-core"></span>
                正在读取课题任务舱...
              </div>
              <template v-else>
                <article class="detail-hero cockpit-hero">
                  <div>
                    <p class="eyebrow">{{ state.currentProject.theme?.name }} · {{ state.currentProject.topic_id }}</p>
                    <h2>{{ state.currentProject.title }}</h2>
                    <p>{{ state.currentProject.summary }}</p>
                    <div class="tag-row">
                      <span v-for="tag in state.currentProject.tags" :key="tag.id">{{ tag.name }}</span>
                    </div>
                  </div>
                  <div class="score-panel cyber-score">
                    <span>{{ displayScore(state.currentProject.composite_score) }}</span>
                    <small>综合信号</small>
                    <div class="signal-meter"><span :style="{ width: signalWidth(state.currentProject) }"></span></div>
                    <button @click="toggleFollow(state.currentProject)">
                      {{ state.currentProject.viewer_state?.is_following ? '已关注' : '关注课题' }}
                    </button>
                  </div>
                </article>

                <div class="detail-grid">
                  <section class="section-block cockpit-panel">
                    <div class="section-head">
                      <div>
                        <p class="eyebrow">Team readiness</p>
                        <h2>组队状态</h2>
                      </div>
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

                  <section class="section-block cockpit-panel">
                    <div class="section-head">
                      <div>
                        <p class="eyebrow">Evidence metrics</p>
                        <h2>核心指标</h2>
                      </div>
                    </div>
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
                    <h3>价值评分</h3>
                    <label><span>1-10 分</span><input type="number" min="1" max="10" v-model="state.forms.score.score" /></label>
                    <label><span>判断依据</span><textarea rows="3" v-model="state.forms.score.comment"></textarea></label>
                    <button type="submit">提交评分</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitInterest">
                    <h3>加入团队</h3>
                    <label><span>角色</span><select v-model="state.forms.interest.role"><option v-for="role in state.meta.participation_roles" :value="role.value">{{ role.label }}</option></select></label>
                    <label><span>每周小时</span><input type="number" min="0" v-model="state.forms.interest.available_hours_per_week" /></label>
                    <label><span>经验</span><textarea rows="3" v-model="state.forms.interest.experience"></textarea></label>
                    <button type="submit">提交参与</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitClaim">
                    <h3>认领工作</h3>
                    <label><span>方向</span><select v-model="state.forms.claim.claim_type"><option v-for="item in state.meta.claim_types" :value="item.value">{{ item.label }}</option></select></label>
                    <label><span>计划</span><textarea rows="4" v-model="state.forms.claim.message"></textarea></label>
                    <button type="submit">提交认领</button>
                  </form>

                  <form class="action-panel" @submit.prevent="submitSponsor">
                    <h3>资源支持</h3>
                    <label><span>类型</span><select v-model="state.forms.sponsor.sponsor_type"><option v-for="item in state.meta.sponsor_types" :value="item.value">{{ item.label }}</option></select></label>
                    <label><span>说明</span><textarea rows="4" v-model="state.forms.sponsor.note"></textarea></label>
                    <button type="submit">记录意向</button>
                  </form>
                </section>

                <section class="section-block manuscript-panel">
                  <div class="section-head"><h2>课题原文</h2><span>{{ state.currentProject.source_md_path }}</span></div>
                  <pre class="markdown-view">{{ state.currentProject.body_markdown || '暂无正文。' }}</pre>
                </section>
              </template>
            </section>

            <section v-if="activeView === 'dashboard'" class="view-stack">
              <div v-if="!state.user" class="auth-shell">
                <form class="auth-panel">
                  <h2>登录后进入个人协作台</h2>
                  <button type="button" @click="navigate('login')">去登录</button>
                </form>
              </div>
              <template v-else-if="state.dashboard">
                <div class="metrics-grid holo">
                  <div class="metric"><small>Follows</small><span>{{ state.dashboard.follows.length }}</span><em>跟进课题</em></div>
                  <div class="metric"><small>Interests</small><span>{{ state.dashboard.interests.length }}</span><em>参与申请</em></div>
                  <div class="metric"><small>Claims</small><span>{{ state.dashboard.claims.length }}</span><em>认领意向</em></div>
                  <div class="metric"><small>Scores</small><span>{{ state.dashboard.scores.length }}</span><em>价值评分</em></div>
                </div>
                <div class="dashboard-grid">
                  <section class="section-block cockpit-panel">
                    <h2>我的参与意向</h2>
                    <p v-for="item in state.dashboard.interests" :key="item.id" class="activity-row">
                      <span>{{ item.role_label }}</span>
                      <button class="link-button" @click="navigate('project', { id: item.project.id })">{{ item.project.title }}</button>
                    </p>
                    <p v-if="!state.dashboard.interests.length" class="empty">暂无参与意向</p>
                  </section>
                  <section class="section-block cockpit-panel">
                    <h2>我的关注课题</h2>
                    <p v-for="item in state.dashboard.follows" :key="item.id" class="activity-row">
                      <span>{{ item.project.stage_label }}</span>
                      <button class="link-button" @click="navigate('project', { id: item.project.id })">{{ item.project.title }}</button>
                    </p>
                    <p v-if="!state.dashboard.follows.length" class="empty">暂无关注课题</p>
                  </section>
                </div>
              </template>
            </section>

            <section v-if="activeView === 'login'" class="auth-shell">
              <form class="auth-panel cyber-auth" @submit.prevent="login">
                <p class="eyebrow">Secure access</p>
                <h2>登录协作中枢</h2>
                <label><span>用户名</span><input v-model="state.forms.login.username" autocomplete="username" /></label>
                <label><span>密码</span><input type="password" v-model="state.forms.login.password" autocomplete="current-password" /></label>
                <button type="submit">登录</button>
                <button type="button" class="ghost" @click="navigate('register')">创建账号</button>
              </form>
            </section>

            <section v-if="activeView === 'register'" class="auth-shell">
              <form class="auth-panel cyber-auth" @submit.prevent="register">
                <p class="eyebrow">Join network</p>
                <h2>创建协作身份</h2>
                <label><span>用户名</span><input v-model="state.forms.register.username" /></label>
                <label><span>邮箱</span><input type="email" v-model="state.forms.register.email" /></label>
                <label><span>昵称</span><input v-model="state.forms.register.display_name" /></label>
                <label><span>身份</span><select v-model="state.forms.register.role_type"><option v-for="role in state.meta.profile_roles" :value="role.value">{{ role.label }}</option></select></label>
                <label><span>密码</span><input type="password" v-model="state.forms.register.password1" /></label>
                <label><span>确认密码</span><input type="password" v-model="state.forms.register.password2" /></label>
                <button type="submit">注册</button>
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

function signalWidth(project) {
  const raw = Number(project?.composite_score || project?.llm_score || 0);
  const normalized = Math.max(8, Math.min(100, raw));
  return `${normalized}%`;
}

function topicInitial(name) {
  if (!name) return "AI";
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || name.slice(0, 1);
}

function scoreTone(project) {
  const score = Number(project?.composite_score || project?.llm_score || 0);
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cool";
}

createApp(App).mount("#app");
