const API = '';

let projectsCache = [];
let currentProject = null;
let currentReqs = [];
let activeChatReqId = null;
let chatHistories = {}; // reqId -> [{role, text}]
let isChatLoading = false;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    const isForm = body instanceof URLSearchParams;
    opts.headers['Content-Type'] = isForm ? 'application/x-www-form-urlencoded' : 'application/json';
    opts.body = isForm ? body : JSON.stringify(body);
  }
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || '请求失败');
  }
  return res.json().catch(() => ({}));
}

function showView(name) {
  document.getElementById('view-list').classList.toggle('hidden', name !== 'list');
  document.getElementById('view-project').classList.toggle('hidden', name !== 'project');
}

function goHome() {
  currentProject = null;
  activeChatReqId = null;
  showView('list');
  loadProjects();
}

async function loadProjects() {
  try {
    projectsCache = await api('GET', '/projects');
  } catch (e) {
    toast('加载项目失败');
    projectsCache = [];
  }
  const grid = document.getElementById('projects-grid');
  if (!projectsCache.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无项目，点击上方创建</div>';
    return;
  }
  grid.innerHTML = projectsCache.map(p => `
    <div class="project-card" onclick="openProject('${p.id}')">
      <div class="flex-between" style="align-items:flex-start;margin-bottom:6px">
        <div class="title">${p.name}</div>
        <span class="tag ${p.type}">${p.type}</span>
      </div>
      <div class="meta" style="margin-bottom:4px">ID: ${p.id}</div>
      <div class="meta" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.path}</div>
    </div>
  `).join('');
}

async function createProject() {
  const name = document.getElementById('new-proj-name').value.trim();
  const type = document.getElementById('new-proj-type').value;
  const path = document.getElementById('new-proj-path').value.trim() || undefined;
  if (!name) return toast('请输入项目名称');
  let url = '/projects?name=' + encodeURIComponent(name) + '&project_type=' + encodeURIComponent(type);
  if (path) url += '&path=' + encodeURIComponent(path);
  await api('POST', url);
  toast('项目创建成功');
  document.getElementById('new-proj-name').value = '';
  document.getElementById('new-proj-path').value = '';
  loadProjects();
}

async function openProject(id) {
  const p = projectsCache.find(x => x.id === id);
  if (!p) return toast('项目未找到');
  currentProject = p;
  document.getElementById('proj-breadcrumb-name').textContent = p.name;
  document.getElementById('proj-title').innerHTML = `${p.name} <span class="tag ${p.type}">${p.type}</span>`;
  document.getElementById('proj-meta').textContent = `ID: ${p.id} · ${p.path}`;
  document.getElementById('proj-memory').value = p.memory || '';
  document.getElementById('proj-roles').value = p.agent_roles || '';
  document.getElementById('proj-claude-settings').value = p.claude_settings || '';
  currentProject.claude_settings = p.claude_settings || '';
  showView('project');
  showProjectTab('requirements');
}

async function deleteCurrentProject() {
  if (!currentProject) return;
  if (!confirm('确定删除项目 “' + currentProject.name + '” 吗？')) return;
  await api('DELETE', '/projects/' + currentProject.id);
  toast('已删除');
  goHome();
}

function showProjectTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes("'" + name + "'"));
  if (btn) btn.classList.add('active');
  document.getElementById('panel-' + name).classList.remove('hidden');
  if (name === 'requirements') loadReqs();
  if (name === 'builds') updateBuildOptions();
  if (name === 'files') {
    loadFileTree('');
    setTimeout(() => {
      if (aceEditor) aceEditor.resize();
    }, 50);
  }
  if (name === 'shared') {
    loadSharedTree('');
    setTimeout(() => {
      if (sharedAceEditor) sharedAceEditor.resize();
    }, 50);
  }
  if (name === 'terminal') {
    connectTerminal();
    renderTerminalScripts();
  } else {
    disconnectTerminal();
  }
  if (name === 'settings') loadProjectSettings();
}

async function loadReqs() {
  if (!currentProject) return;
  const tbody = document.getElementById('reqs-body');
  // Avoid replacing DOM with loading placeholder when chat is open to prevent page scroll jump
  if (!activeChatReqId) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">加载中...</td></tr>';
  }
  try {
    currentReqs = await api('GET', '/requirements/' + currentProject.id);
  } catch (e) {
    currentReqs = [];
  }
  if (!currentReqs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无需求</td></tr>';
    return;
  }
  let html = '';
  currentReqs.forEach(r => {
    html += `
      <tr class="chat-row">
        <td style="padding-left:24px">${r.id}</td>
        <td>${r.title}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${r.description || '-'}</td>
        <td><span class="tag status-${r.status}">${r.status}</span></td>
        <td style="width:90px">${r.priority}</td>
        <td class="actions" style="padding-right:24px;width:160px">
          ${r.status !== 'done' ? `<button class="btn btn-secondary" onclick="event.stopPropagation();updateReq('${r.id}', '${r.status === 'pending' ? 'in_progress' : 'done'}')">${r.status === 'pending' ? '开始' : '完成'}</button>` : '<span style="color:var(--text-muted)">已完成</span>'}
          <button class="btn btn-primary" onclick="event.stopPropagation();toggleChat('${r.id}')">工作</button>
        </td>
      </tr>
    `;
    if (activeChatReqId === r.id) {
      html += renderChatRow(r.id);
    }
  });
  tbody.innerHTML = html;
}

function renderChatRow(reqId) {
  const history = chatHistories[reqId] || [];
  let bubbles = '';
  if (!history.length) {
    bubbles = '<div class="empty" style="padding:10px 0">点击发送即可开始与 Claude 对话处理此需求</div>';
  } else {
    bubbles = history.map(h => `
      <div class="chat-bubble ${h.role === 'claude' ? 'claude' : 'user'}">
        <div class="label">${h.role === 'claude' ? 'Claude' : '你'}</div>
        <div class="text">${escapeHtml(h.text)}</div>
      </div>
    `).join('');
  }
  const loadingBubble = isChatLoading ? `
    <div class="chat-bubble claude">
      <div class="label">Claude</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  ` : '';
  return `
    <tr class="chat-panel-row">
      <td colspan="6" style="padding:0;border-bottom:none">
        <div class="chat-area" style="border-radius:0;border-left:none;border-right:none;border-bottom:none">
          <div class="chat-header">
            <strong>需求工作区</strong>
            <button class="btn btn-ghost" onclick="closeChat()">收起</button>
          </div>
          <div id="chat-history-${reqId}" class="chat-messages">
            ${bubbles}
            ${loadingBubble}
          </div>
          <div class="chat-input-wrapper">
            <textarea id="chat-input-${reqId}" class="chat-input" placeholder="输入你要告诉 Claude 的内容，按 Enter 发送"></textarea>
            <button class="btn btn-primary" onclick="sendChat('${reqId}')">发送</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadWorklog(reqId) {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/agents/worklog/${encodeURIComponent(currentProject.id)}/${encodeURIComponent(reqId)}`);
    if (Array.isArray(data)) {
      chatHistories[reqId] = data;
    }
  } catch (e) {
    // ignore load errors, start fresh
  }
}

async function saveWorklog(reqId) {
  if (!currentProject || !chatHistories[reqId]) return;
  try {
    await api('POST', `/agents/worklog/${encodeURIComponent(currentProject.id)}/${encodeURIComponent(reqId)}`, {
      history: chatHistories[reqId]
    });
  } catch (e) {
    // silent fail
  }
}

async function toggleChat(reqId) {
  const wasOpen = activeChatReqId === reqId;
  activeChatReqId = wasOpen ? null : reqId;
  if (!wasOpen) {
    await loadWorklog(reqId);
  }
  loadReqs();
  setTimeout(() => {
    const el = document.getElementById(`chat-input-${reqId}`);
    if (el) el.focus();
  }, 50);
}

function closeChat() {
  activeChatReqId = null;
  loadReqs();
}

function appendChatBubble(reqId, role, text) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (!container) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'claude' ? 'claude' : 'user'}`;
  bubble.innerHTML = `
    <div class="label">${role === 'claude' ? 'Claude' : '你'}</div>
    <div class="text">${escapeHtml(text)}</div>
  `;
  container.appendChild(bubble);
}

function appendLoadingIndicator(reqId) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (!container) return;
  const existing = document.getElementById(`chat-loading-${reqId}`);
  if (existing) return;
  const bubble = document.createElement('div');
  bubble.id = `chat-loading-${reqId}`;
  bubble.className = 'chat-bubble claude';
  bubble.innerHTML = `
    <div class="label">Claude</div>
    <div class="loading-dots"><span></span><span></span><span></span></div>
  `;
  container.appendChild(bubble);
}

function removeLoadingIndicator(reqId) {
  const el = document.getElementById(`chat-loading-${reqId}`);
  if (el) el.remove();
}

async function sendChat(reqId) {
  if (!currentProject || isChatLoading) return;
  const input = document.getElementById(`chat-input-${reqId}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return toast('请输入内容');

  if (!chatHistories[reqId]) chatHistories[reqId] = [];
  chatHistories[reqId].push({ role: 'user', text });
  input.value = '';
  isChatLoading = true;

  appendChatBubble(reqId, 'user', text);
  appendLoadingIndicator(reqId);
  scrollChatToBottom(reqId);
  await saveWorklog(reqId);

  setChatControlsEnabled(reqId, false);

  try {
    const res = await api('POST', `/agents/chat?project_id=${encodeURIComponent(currentProject.id)}&requirement_id=${encodeURIComponent(reqId)}`, {
      message: text
    });
    chatHistories[reqId].push({ role: 'claude', text: res.response || '' });
    isChatLoading = false;
    removeLoadingIndicator(reqId);
    appendChatBubble(reqId, 'claude', res.response || '');
    scrollChatToBottom(reqId);
    setChatControlsEnabled(reqId, true);
    await saveWorklog(reqId);
  } catch (e) {
    chatHistories[reqId].push({ role: 'claude', text: '出错了: ' + e.message });
    isChatLoading = false;
    removeLoadingIndicator(reqId);
    appendChatBubble(reqId, 'claude', '出错了: ' + e.message);
    scrollChatToBottom(reqId);
    setChatControlsEnabled(reqId, true);
    await saveWorklog(reqId);
    toast('Claude 响应失败');
  }
}

function scrollChatToBottom(reqId) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (container) container.scrollTop = container.scrollHeight;
}

function setChatControlsEnabled(reqId, enabled) {
  const input = document.getElementById(`chat-input-${reqId}`);
  const btn = input?.parentElement?.querySelector('button');
  if (input) {
    input.disabled = !enabled;
    input.style.opacity = enabled ? '1' : '0.5';
  }
  if (btn) {
    btn.textContent = enabled ? '发送' : '发送中...';
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.7';
  }
}

// keyboard shortcut: Enter in any chat textarea
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    const el = document.activeElement;
    if (el && el.id && el.id.startsWith('chat-input-')) {
      e.preventDefault();
      const reqId = el.id.replace('chat-input-', '');
      sendChat(reqId);
    }
  }
});

async function createReq() {
  if (!currentProject) return;
  const title = document.getElementById('req-title').value.trim();
  const description = document.getElementById('req-desc').value.trim();
  const priority = document.getElementById('req-priority').value;
  if (!title) return toast('请输入标题');
  const url = '/requirements?project_id=' + encodeURIComponent(currentProject.id)
    + '&title=' + encodeURIComponent(title)
    + '&description=' + encodeURIComponent(description)
    + '&priority=' + encodeURIComponent(priority);
  await api('POST', url);
  toast('需求添加成功');
  document.getElementById('req-title').value = '';
  document.getElementById('req-desc').value = '';
  loadReqs();
}

async function updateReq(req_id, status) {
  if (!currentProject) return;
  await api('POST', `/requirements/${currentProject.id}/${req_id}/status?status=${status}`);
  toast('状态已更新');
  loadReqs();
}

function envDictToText(env) {
  if (!env) return '';
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

function envTextToDict(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx > 0) {
      env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }
  }
  return env;
}

async function loadProjectSettings() {
  if (!currentProject) return;
  try {
    const p = await api('GET', '/projects/' + currentProject.id);
    document.getElementById('proj-memory').value = p.memory || '';
    document.getElementById('proj-roles').value = p.agent_roles || '';
    document.getElementById('proj-env').value = envDictToText(p.env || {});
    document.getElementById('proj-claude-settings').value = p.claude_settings || '';
  } catch (e) {
    toast('加载项目设置失败');
  }
}

async function saveProjectSettings() {
  if (!currentProject) return;
  const memory = document.getElementById('proj-memory').value.trim();
  const agent_roles = document.getElementById('proj-roles').value.trim();
  const env = envTextToDict(document.getElementById('proj-env').value);
  const claude_settings = document.getElementById('proj-claude-settings').value.trim();
  try {
    const p = await api('PATCH', '/projects/' + currentProject.id, { memory, agent_roles, env, claude_settings });
    currentProject.memory = p.memory;
    currentProject.agent_roles = p.agent_roles;
    currentProject.env = p.env || {};
    currentProject.claude_settings = p.claude_settings || '';
    toast('设置已保存');
  } catch (e) {
    toast('保存失败: ' + e.message);
  }
}

async function runBuild() {
  if (!currentProject) return;
  const type = document.getElementById('build-type').value;
  const cmdRaw = document.getElementById('build-cmd').value.trim();
  const cmdParts = cmdRaw ? cmdRaw.split(/\s+/) : null;
  const logEl = document.getElementById('build-log');
  logEl.classList.remove('hidden');
  logEl.textContent = '构建中...';
  try {
    let url = '';
    if (type === 'java') {
      const jdk = document.getElementById('build-jdk').value || '17';
      url = `/builds/java/${currentProject.id}?jdk_version=${encodeURIComponent(jdk)}`;
    } else {
      const tool = cmdParts ? cmdParts[0] : 'npm';
      const nodeVer = document.getElementById('build-node').value || undefined;
      url = `/builds/node/${currentProject.id}?tool=${encodeURIComponent(tool)}`;
      if (nodeVer) url += `&node_version=${encodeURIComponent(nodeVer)}`;
    }
    if (cmdParts) {
      url += cmdParts.map(c => '&command=' + encodeURIComponent(c)).join('');
    }
    const res = await api('POST', url);
    const logRes = await api('GET', '/builds/log?path=' + encodeURIComponent(res.log));
    logEl.textContent = logRes.content || '(无日志内容)';
    toast('构建成功');
  } catch (e) {
    logEl.textContent = '构建失败: ' + e.message;
    toast('构建失败');
  }
}

function applyQuickBuild() {
  const quick = document.getElementById('build-quick').value;
  if (quick) {
    document.getElementById('build-cmd').value = quick;
  }
}

function updateBuildOptions() {
  const type = document.getElementById('build-type').value;
  const quick = document.getElementById('build-quick');
  const jdk = document.getElementById('build-jdk');
  const node = document.getElementById('build-node');
  if (type === 'java') {
    jdk.style.display = '';
    node.style.display = 'none';
  } else if (type === 'node') {
    jdk.style.display = 'none';
    node.style.display = '';
  } else {
    jdk.style.display = 'none';
    node.style.display = 'none';
  }
  const javaOpts = [
    ['mvn clean install', 'mvn clean install'],
    ['mvn clean compile', 'mvn clean compile'],
    ['mvn test', 'mvn test'],
    ['mvn package -DskipTests', 'mvn package -DskipTests'],
    ['mvn clean', 'mvn clean']
  ];
  const nodeOpts = [
    ['npm install', 'npm install'],
    ['npm run build', 'npm run build'],
    ['npm run dev', 'npm run dev'],
    ['npm test', 'npm test'],
    ['pnpm install', 'pnpm install'],
    ['pnpm run build', 'pnpm run build']
  ];
  let opts;
  if (type === 'java') opts = javaOpts;
  else opts = nodeOpts;
  let html = '<option value="">-- 快捷指令 --</option>';
  opts.forEach(o => { html += `<option value="${o[0]}">${o[1]}</option>`; });
  quick.innerHTML = html;
}

// Terminal
let term = null;
let fitAddon = null;
let terminalSocket = null;

function initXTerm() {
  if (term) return;
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
    theme: {
      background: '#ffffff',
      foreground: '#1f2937',
      cursor: '#4f46e5',
      selectionBackground: '#e2e8f0',
      black: '#1f2937',
      brightBlack: '#64748b',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#f8fafc'
    },
    convertEol: true,
    scrollback: 1000
  });
  if (window.FitAddon) {
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }
  term.open(document.getElementById('terminal-container'));
  if (fitAddon) {
    fitAddon.fit();
  }
}

function connectTerminal(asUser = null) {
  if (!currentProject) return;

  // Store asUser for _doConnectTerminal to use
  window.terminalAsUser = asUser;

  // Ensure panel is visible before init so xterm can measure size
  const panel = document.getElementById('panel-terminal');
  if (panel) panel.classList.remove('hidden');

  if (!term) {
    // Small delay to let browser render the panel so xterm measures correctly
    setTimeout(() => {
      initXTerm();
      _doConnectTerminal();
    }, 50);
  } else {
    if (fitAddon) fitAddon.fit();
    _doConnectTerminal();
  }
}

function openClaudeLoginTerminal() {
  // Switch to terminal tab and connect as claudeuser
  showProjectTab('terminal');
  connectTerminal('claudeuser');
  toast('终端已以 claudeuser 身份打开，请运行: claude login');
}

function _doConnectTerminal() {
  document.getElementById('terminal-path').textContent = currentProject.path;

  if (terminalSocket) {
    terminalSocket.close();
  }

  const javaVer = document.getElementById('term-java').value || '';
  const nodeVer = document.getElementById('term-node').value || '';
  const asUser = window.terminalAsUser || '';
  const qs = [];
  if (javaVer) qs.push('java_version=' + encodeURIComponent(javaVer));
  if (asUser) qs.push('as_user=' + encodeURIComponent(asUser));

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${currentProject.id}` + (qs.length ? '?' + qs.join('&') : '');
  terminalSocket = new WebSocket(wsUrl);

  terminalSocket.onopen = () => {
    term.clear();
    if (fitAddon) fitAddon.fit();
    const dims = fitAddon ? { cols: term.cols, rows: term.rows } : { cols: 100, rows: 24 };
    // send initial resize immediately
    if (terminalSocket.readyState === WebSocket.OPEN) {
      terminalSocket.send(JSON.stringify({ type: 'resize', ...dims }));
    }
    // Switch Node version after shell startup scripts finish
    if (nodeVer) {
      setTimeout(() => {
        if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
          terminalSocket.send(`nvm use ${nodeVer}\n`);
        }
      }, 400);
    }
  };

  terminalSocket.onmessage = (event) => {
    term.write(event.data);
  };

  terminalSocket.onclose = () => {
    term.writeln('\r\n\x1b[1;31m[终端连接已关闭]\x1b[0m');
  };

  terminalSocket.onerror = () => {
    term.writeln('\r\n\x1b[1;31m[终端连接错误]\x1b[0m');
  };

  if (!term._onDataRegistered) {
    term.onData((data) => {
      if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
        terminalSocket.send(data);
      }
    });
    term._onDataRegistered = true;
  }

  // Auto-resize on window resize
  if (!window._terminalResizeHandler) {
    window._terminalResizeHandler = () => {
      if (fitAddon && term && !document.getElementById('panel-terminal').classList.contains('hidden')) {
        fitAddon.fit();
        if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
          terminalSocket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      }
    };
    window.addEventListener('resize', window._terminalResizeHandler);
  }

  setTimeout(() => term.focus(), 100);
}

function disconnectTerminal() {
  if (terminalSocket) {
    terminalSocket.close();
    terminalSocket = null;
  }
}

function renderTerminalScripts() {
  if (!currentProject) return;
  const container = document.getElementById('terminal-scripts');
  const scripts = currentProject.scripts || [];
  if (!scripts.length) {
    container.innerHTML = '<span class="meta" style="font-size:13px;color:var(--text-muted)">暂无保存的脚本</span>';
    return;
  }
  container.innerHTML = scripts.map((s, idx) => {
    const editing = s._editing;
    if (editing) {
      return `
        <div style="display:flex;align-items:center;gap:8px;background:var(--bg);padding:10px 12px;border-radius:8px;border:1px solid var(--border);width:100%">
          <input id="edit-script-name-${idx}" value="${escapeHtml(s.name)}" style="width:140px;padding:6px 10px;font-size:13px">
          <input id="edit-script-cmd-${idx}" value="${escapeHtml(s.cmd)}" style="flex:1;min-width:200px;padding:6px 10px;font-size:13px">
          <button class="btn btn-primary" onclick="saveEditTerminalScript(${idx})" style="padding:4px 10px;font-size:12px">保存</button>
          <button class="btn btn-ghost" onclick="cancelEditTerminalScript(${idx})" style="padding:4px 10px;font-size:12px">取消</button>
        </div>
      `;
    }
    return `
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);padding:10px 12px;border-radius:8px;border:1px solid var(--border);width:100%">
        <span style="font-size:13px;font-weight:600;min-width:80px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.name)}</span>
        <code style="flex:1;min-width:200px;font-size:13px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.cmd)}</code>
        <button class="btn btn-primary" onclick="runTerminalScript(${idx})" style="padding:4px 10px;font-size:12px">执行</button>
        <button class="btn btn-secondary" onclick="editTerminalScript(${idx})" style="padding:4px 10px;font-size:12px">修改</button>
        <button class="btn btn-danger" onclick="deleteTerminalScript(${idx})" style="padding:4px 8px;font-size:12px">×</button>
      </div>
    `;
  }).join('');
}

async function saveTerminalScripts(scripts) {
  if (!currentProject) return;
  try {
    const p = await api('PATCH', '/projects/' + currentProject.id, { scripts });
    currentProject.scripts = p.scripts || scripts;
  } catch (e) {
    toast('保存脚本失败');
  }
}

async function addTerminalScript() {
  if (!currentProject) return;
  const name = document.getElementById('script-name').value.trim();
  const cmd = document.getElementById('script-cmd').value.trim();
  if (!name || !cmd) return toast('请输入脚本名称和命令');
  const scripts = currentProject.scripts || [];
  scripts.push({ name, cmd });
  await saveTerminalScripts(scripts);
  document.getElementById('script-name').value = '';
  document.getElementById('script-cmd').value = '';
  renderTerminalScripts();
  toast('脚本已保存');
}

async function deleteTerminalScript(idx) {
  if (!currentProject) return;
  const scripts = (currentProject.scripts || []).filter((_, i) => i !== idx);
  await saveTerminalScripts(scripts);
  renderTerminalScripts();
}

function editTerminalScript(idx) {
  if (!currentProject) return;
  const scripts = currentProject.scripts || [];
  if (!scripts[idx]) return;
  scripts[idx] = { ...scripts[idx], _editing: true };
  renderTerminalScripts();
}

function cancelEditTerminalScript(idx) {
  if (!currentProject) return;
  const scripts = currentProject.scripts || [];
  if (!scripts[idx]) return;
  delete scripts[idx]._editing;
  renderTerminalScripts();
}

async function saveEditTerminalScript(idx) {
  if (!currentProject) return;
  const scripts = currentProject.scripts || [];
  const name = document.getElementById(`edit-script-name-${idx}`).value.trim();
  const cmd = document.getElementById(`edit-script-cmd-${idx}`).value.trim();
  if (!name || !cmd) return toast('请输入脚本名称和命令');
  scripts[idx] = { name, cmd };
  await saveTerminalScripts(scripts);
  renderTerminalScripts();
  toast('脚本已更新');
}

function runTerminalScript(idx) {
  const script = (currentProject.scripts || [])[idx];
  if (!script) return;

  // Ensure terminal panel is active
  if (document.getElementById('panel-terminal').classList.contains('hidden')) {
    showProjectTab('terminal');
  }

  const sendCmd = () => {
    if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
      terminalSocket.send(script.cmd + '\n');
      toast(`已执行: ${script.name}`);
    } else {
      toast('终端未连接，请稍后再试');
    }
  };

  if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
    sendCmd();
  } else {
    // Wait for connection to open (connectTerminal is triggered by showProjectTab)
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
        clearInterval(timer);
        sendCmd();
      } else if (attempts > 30) {
        clearInterval(timer);
        toast('终端连接超时，请刷新页面重试');
      }
    }, 100);
  }
}

document.getElementById('build-type').addEventListener('change', updateBuildOptions);

document.getElementById('term-java').addEventListener('change', () => {
  if (!document.getElementById('panel-terminal').classList.contains('hidden')) connectTerminal();
});
document.getElementById('term-node').addEventListener('change', () => {
  if (!document.getElementById('panel-terminal').classList.contains('hidden')) connectTerminal();
});

// init
updateBuildOptions();
loadProjects();
loadSshKeys();

// File editor
let fileTreeCache = []; // stores root-level items for simplicity via re-fetch
let fileTreeExpanded = new Set();
let currentFilePath = null;
let currentFileContent = null;
let aceEditor = null;
let fileAutoSaveTimer = null;
let isFileLoading = false;

function setSaveBtnState(id, state) {
  const btn = document.getElementById(id);
  if (!btn) return;
  if (state === 'saving') {
    btn.textContent = '保存中...';
    btn.className = 'btn btn-primary';
  } else if (state === 'saved') {
    btn.textContent = '已保存';
    btn.className = 'btn btn-secondary';
  }
}

function initAceEditor() {
  if (aceEditor || !window.ace) return;
  aceEditor = ace.edit('file-editor');
  aceEditor.setTheme('ace/theme/chrome');
  aceEditor.session.setOptions({
    tabSize: 2,
    useSoftTabs: true,
    wrap: true,
  });
  aceEditor.setShowPrintMargin(false);
  aceEditor.renderer.setScrollMargin(8, 8);
  aceEditor.session.on('change', () => {
    if (isFileLoading) return;
    if (fileAutoSaveTimer) clearTimeout(fileAutoSaveTimer);
    setSaveBtnState('file-save-btn', 'saving');
    fileAutoSaveTimer = setTimeout(() => saveCurrentFile(true), 800);
  });
}

function getAceModeFromFilename(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
    json: 'json',
    html: 'html', htm: 'html', xml: 'xml',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    py: 'python',
    java: 'java',
    go: 'golang',
    md: 'markdown',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    ini: 'ini', cfg: 'ini', conf: 'ini',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    sql: 'sql',
    php: 'php',
    rb: 'ruby', ruby: 'ruby',
    rs: 'rust',
    c: 'c_cpp', h: 'c_cpp',
    cpp: 'c_cpp', cc: 'c_cpp', cxx: 'c_cpp', hpp: 'c_cpp', hh: 'c_cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    scala: 'scala',
    vue: 'html',
    graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile',
    lua: 'lua',
    pl: 'perl', perl: 'perl',
    r: 'r',
    dart: 'dart',
    clj: 'clojure', cljs: 'clojure',
    ex: 'elixir', exs: 'elixir',
    hs: 'haskell',
    elm: 'elm',
    fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp',
    bat: 'batchfile', cmd: 'batchfile',
    ps1: 'powershell', psm1: 'powershell',
    tex: 'latex', latex: 'latex',
  };
  if (name.toLowerCase().includes('dockerfile')) return 'dockerfile';
  return map[ext] || 'text';
}

function setAceEditorContent(content, editable, filename) {
  initAceEditor();
  if (!aceEditor) return;
  isFileLoading = true;
  aceEditor.setValue(content || '', -1);
  isFileLoading = false;
  aceEditor.setReadOnly(!editable);
  aceEditor.clearSelection();
  aceEditor.session.setMode('ace/mode/' + getAceModeFromFilename(filename || ''));
  if (editable) {
    aceEditor.focus();
    aceEditor.setOptions({ highlightActiveLine: true, highlightGutterLine: true });
    aceEditor.renderer.$cursorLayer.element.style.display = '';
  } else {
    aceEditor.setOptions({ highlightActiveLine: false, highlightGutterLine: false });
    aceEditor.renderer.$cursorLayer.element.style.display = 'none';
  }
}

async function loadFileTree(path) {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/files/${encodeURIComponent(currentProject.id)}?path=${encodeURIComponent(path)}`);
    if (data.type === 'directory') {
      renderFileTreeItems(data.items, path);
      if (!path) {
        fileTreeCache = data.items;
      }
    }
  } catch (e) {
    toast('加载文件列表失败: ' + e.message);
  }
}

function safeBase64Id(str) {
  try {
    return btoa(encodeURIComponent(str)).replace(/=/g, '');
  } catch (e) {
    return encodeURIComponent(str).replace(/[^a-zA-Z0-9]/g, '_');
  }
}

function getFileIcon(isDir, name) {
  if (isDir) return '📁';
  if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.jsx') || name.endsWith('.tsx')) return '📜';
  if (name.endsWith('.html') || name.endsWith('.css')) return '🌐';
  if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.toml')) return '⚙️';
  if (name.endsWith('.md')) return '📝';
  if (name.endsWith('.py')) return '🐍';
  if (name.endsWith('.java')) return '☕';
  if (name.endsWith('.go')) return '🐹';
  if (name.endsWith('.dockerfile') || name.includes('Dockerfile')) return '🐳';
  return '📄';
}

function renderFileTreeItems(items, parentPath) {
  const container = document.getElementById('file-tree');
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty" style="padding:20px 0">空目录</div>';
    return;
  }

  // Render a simple flat list with path grouping for now; later can be nested.
  let html = '<div style="display:flex;flex-direction:column;gap:2px">';
  items.forEach(item => {
    const icon = getFileIcon(item.is_dir, item.name);
    const indent = 'padding-left:8px';
    if (item.is_dir) {
      const expanded = fileTreeExpanded.has(item.path);
      html += `
        <div style="${indent}">
          <div class="file-tree-item" onclick="toggleDir('${encodeURIComponent(item.path)}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text);"
            onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
            <span>${expanded ? '📂' : icon}</span>
            <span style="font-weight:500">${escapeHtml(item.name)}</span>
          </div>
          <div id="file-tree-children-${safeBase64Id(item.path)}" style="display:${expanded ? 'block' : 'none'};padding-left:12px"></div>
        </div>
      `;
      if (expanded) {
        // children will be loaded asynchronously and rendered into the div
        setTimeout(() => loadDirChildren(item.path), 0);
      }
    } else {
      html += `
        <div class="file-tree-item" onclick="openFile('${encodeURIComponent(item.path)}')" style="${indent};display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text-muted);"
          onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'"
          onmousedown="this.style.color='var(--primary)'" onmouseup="this.style.color='var(--text-muted)'">
          <span>${icon}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.name)}</span>
        </div>
      `;
    }
  });
  html += '</div>';

  if (!parentPath) {
    container.innerHTML = html;
  } else {
    const el = document.getElementById('file-tree-children-' + safeBase64Id(parentPath));
    if (el) el.innerHTML = html;
  }
}

async function loadDirChildren(path) {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/files/${encodeURIComponent(currentProject.id)}?path=${encodeURIComponent(path)}`);
    const el = document.getElementById('file-tree-children-' + safeBase64Id(path));
    if (!el) return;
    if (data.type !== 'directory' || !data.items || !data.items.length) {
      el.innerHTML = '<div style="padding:4px 8px;font-size:12px;color:var(--text-muted)">空目录</div>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:2px">';
    data.items.forEach(item => {
      const icon = getFileIcon(item.is_dir, item.name);
      const indent = 'padding-left:8px';
      if (item.is_dir) {
        const expanded = fileTreeExpanded.has(item.path);
        html += `
          <div style="${indent}">
            <div class="file-tree-item" onclick="event.stopPropagation();toggleDir('${encodeURIComponent(item.path)}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text);"
              onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
              <span>${expanded ? '📂' : icon}</span>
              <span style="font-weight:500">${escapeHtml(item.name)}</span>
            </div>
            <div id="file-tree-children-${safeBase64Id(item.path)}" style="display:${expanded ? 'block' : 'none'};padding-left:12px"></div>
          </div>
        `;
        if (expanded) {
          setTimeout(() => loadDirChildren(item.path), 0);
        }
      } else {
        html += `
          <div class="file-tree-item" onclick="event.stopPropagation();openFile('${encodeURIComponent(item.path)}')" style="${indent};display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text-muted);"
            onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'"
            onmousedown="this.style.color='var(--primary)'" onmouseup="this.style.color='var(--text-muted)'">
            <span>${icon}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.name)}</span>
          </div>
        `;
      }
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    // ignore
  }
}

async function toggleDir(path) {
  const decoded = decodeURIComponent(path);
  if (fileTreeExpanded.has(decoded)) {
    fileTreeExpanded.delete(decoded);
  } else {
    fileTreeExpanded.add(decoded);
  }
  await refreshFileTree();
}

async function refreshFileTree() {
  await loadFileTree('');
  // Re-expand opened dirs: re-trigger loadDirChildren for expanded dirs
  fileTreeExpanded.forEach(p => {
    const el = document.getElementById('file-tree-children-' + safeBase64Id(p));
    if (el) {
      el.style.display = 'block';
      loadDirChildren(p);
    }
  });
}

async function openFile(path) {
  if (!currentProject) return;
  const decoded = decodeURIComponent(path);
  currentFilePath = decoded;
  try {
    const data = await api('GET', `/files/${encodeURIComponent(currentProject.id)}?path=${encodeURIComponent(decoded)}`);
    const breadcrumb = document.getElementById('file-breadcrumb');
    const saveBtn = document.getElementById('file-save-btn');
    const meta = document.getElementById('file-meta');

    if (data.type === 'directory') {
      breadcrumb.textContent = decoded || '项目根目录';
      saveBtn.style.display = 'none';
      meta.textContent = `项目: ${currentProject.name}`;
      currentFileContent = null;
      setAceEditorContent('', false, '');
      return;
    }

    breadcrumb.textContent = decoded;
    if (!data.readable) {
      saveBtn.style.display = 'none';
      meta.textContent = `大小: ${formatBytes(data.size)} · ${data.reason || '不可读'}`;
      currentFileContent = null;
      setAceEditorContent(`无法编辑: ${data.reason || '不可读文件'}`, false, decoded);
    } else {
      saveBtn.style.display = 'inline-flex';
      setSaveBtnState('file-save-btn', 'saved');
      meta.textContent = `大小: ${formatBytes(data.size)} · 可编辑`;
      currentFileContent = data.content;
      setAceEditorContent(data.content, true, decoded);
    }
  } catch (e) {
    toast('打开文件失败: ' + e.message);
  }
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

async function saveCurrentFile(auto = false) {
  if (!currentProject || !currentFilePath) return;
  const content = aceEditor ? aceEditor.getValue() : '';
  try {
    await api('POST', `/files/${encodeURIComponent(currentProject.id)}?path=${encodeURIComponent(currentFilePath)}`, { content });
    currentFileContent = content;
    setSaveBtnState('file-save-btn', 'saved');
    if (!auto) toast('文件已保存');
  } catch (e) {
    setSaveBtnState('file-save-btn', 'saved');
    toast('保存失败: ' + e.message);
  }
}

// Shared directory editor
let sharedTreeExpanded = new Set();
let currentSharedPath = null;
let sharedAceEditor = null;
let sharedAutoSaveTimer = null;
let isSharedLoading = false;

function initSharedAceEditor() {
  if (sharedAceEditor || !window.ace) return;
  sharedAceEditor = ace.edit('shared-editor');
  sharedAceEditor.setTheme('ace/theme/chrome');
  sharedAceEditor.session.setOptions({
    tabSize: 2,
    useSoftTabs: true,
    wrap: true,
  });
  sharedAceEditor.setShowPrintMargin(false);
  sharedAceEditor.renderer.setScrollMargin(8, 8);
  sharedAceEditor.session.on('change', () => {
    if (isSharedLoading) return;
    if (sharedAutoSaveTimer) clearTimeout(sharedAutoSaveTimer);
    setSaveBtnState('shared-save-btn', 'saving');
    sharedAutoSaveTimer = setTimeout(() => saveSharedFile(true), 800);
  });
}

function setSharedAceEditorContent(content, editable, filename) {
  initSharedAceEditor();
  if (!sharedAceEditor) return;
  isSharedLoading = true;
  sharedAceEditor.setValue(content || '', -1);
  isSharedLoading = false;
  sharedAceEditor.setReadOnly(!editable);
  sharedAceEditor.clearSelection();
  sharedAceEditor.session.setMode('ace/mode/' + getAceModeFromFilename(filename || ''));
  if (editable) {
    sharedAceEditor.focus();
    sharedAceEditor.setOptions({ highlightActiveLine: true, highlightGutterLine: true });
    sharedAceEditor.renderer.$cursorLayer.element.style.display = '';
  } else {
    sharedAceEditor.setOptions({ highlightActiveLine: false, highlightGutterLine: false });
    sharedAceEditor.renderer.$cursorLayer.element.style.display = 'none';
  }
}

async function loadSharedTree(path) {
  try {
    const data = await api('GET', `/files/shared?path=${encodeURIComponent(path)}`);
    if (data.type === 'directory') {
      renderSharedTreeItems(data.items, path);
    }
  } catch (e) {
    toast('加载共享目录失败: ' + e.message);
  }
}

function renderSharedTreeItems(items, parentPath) {
  const container = document.getElementById('shared-tree');
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty" style="padding:20px 0">空目录</div>';
    return;
  }
  let html = '<div style="display:flex;flex-direction:column;gap:2px">';
  items.forEach(item => {
    const icon = getFileIcon(item.is_dir, item.name);
    const indent = 'padding-left:8px';
    if (item.is_dir) {
      const expanded = sharedTreeExpanded.has(item.path);
      html += `
        <div style="${indent}">
          <div class="file-tree-item" onclick="toggleSharedDir('${encodeURIComponent(item.path)}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text);"
            onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
            <span>${expanded ? '📂' : icon}</span>
            <span style="font-weight:500">${escapeHtml(item.name)}</span>
          </div>
          <div id="shared-tree-children-${safeBase64Id(item.path)}" style="display:${expanded ? 'block' : 'none'};padding-left:12px"></div>
        </div>
      `;
      if (expanded) {
        setTimeout(() => loadSharedDirChildren(item.path), 0);
      }
    } else {
      html += `
        <div class="file-tree-item" onclick="openSharedFile('${encodeURIComponent(item.path)}')" style="${indent};display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text-muted);"
          onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'"
          onmousedown="this.style.color='var(--primary)'" onmouseup="this.style.color='var(--text-muted)'">
          <span>${icon}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.name)}</span>
        </div>
      `;
    }
  });
  html += '</div>';
  if (!parentPath) {
    container.innerHTML = html;
  } else {
    const el = document.getElementById('shared-tree-children-' + safeBase64Id(parentPath));
    if (el) el.innerHTML = html;
  }
}

async function loadSharedDirChildren(path) {
  try {
    const data = await api('GET', `/files/shared?path=${encodeURIComponent(path)}`);
    const el = document.getElementById('shared-tree-children-' + safeBase64Id(path));
    if (!el) return;
    if (data.type !== 'directory' || !data.items || !data.items.length) {
      el.innerHTML = '<div style="padding:4px 8px;font-size:12px;color:var(--text-muted)">空目录</div>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:2px">';
    data.items.forEach(item => {
      const icon = getFileIcon(item.is_dir, item.name);
      const indent = 'padding-left:8px';
      if (item.is_dir) {
        const expanded = sharedTreeExpanded.has(item.path);
        html += `
          <div style="${indent}">
            <div class="file-tree-item" onclick="event.stopPropagation();toggleSharedDir('${encodeURIComponent(item.path)}')" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text);"
              onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
              <span>${expanded ? '📂' : icon}</span>
              <span style="font-weight:500">${escapeHtml(item.name)}</span>
            </div>
            <div id="shared-tree-children-${safeBase64Id(item.path)}" style="display:${expanded ? 'block' : 'none'};padding-left:12px"></div>
          </div>
        `;
        if (expanded) {
          setTimeout(() => loadSharedDirChildren(item.path), 0);
        }
      } else {
        html += `
          <div class="file-tree-item" onclick="event.stopPropagation();openSharedFile('${encodeURIComponent(item.path)}')" style="${indent};display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--text-muted);"
            onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'"
            onmousedown="this.style.color='var(--primary)'" onmouseup="this.style.color='var(--text-muted)'">
            <span>${icon}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.name)}</span>
          </div>
        `;
      }
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    // ignore
  }
}

async function toggleSharedDir(path) {
  const decoded = decodeURIComponent(path);
  if (sharedTreeExpanded.has(decoded)) {
    sharedTreeExpanded.delete(decoded);
  } else {
    sharedTreeExpanded.add(decoded);
  }
  await refreshSharedTree();
}

async function refreshSharedTree() {
  await loadSharedTree('');
  sharedTreeExpanded.forEach(p => {
    const el = document.getElementById('shared-tree-children-' + safeBase64Id(p));
    if (el) {
      el.style.display = 'block';
      loadSharedDirChildren(p);
    }
  });
}

async function openSharedFile(path) {
  const decoded = decodeURIComponent(path);
  currentSharedPath = decoded;
  try {
    const data = await api('GET', `/files/shared?path=${encodeURIComponent(decoded)}`);
    const breadcrumb = document.getElementById('shared-breadcrumb');
    const saveBtn = document.getElementById('shared-save-btn');
    const meta = document.getElementById('shared-meta');

    if (data.type === 'directory') {
      breadcrumb.textContent = decoded || '共享根目录';
      saveBtn.style.display = 'none';
      meta.textContent = '';
      setSharedAceEditorContent('', false, '');
      return;
    }

    breadcrumb.textContent = decoded;
    if (!data.readable) {
      saveBtn.style.display = 'none';
      meta.textContent = `大小: ${formatBytes(data.size)} · ${data.reason || '不可读'}`;
      setSharedAceEditorContent(`无法编辑: ${data.reason || '不可读文件'}`, false, decoded);
    } else {
      saveBtn.style.display = 'inline-flex';
      setSaveBtnState('shared-save-btn', 'saved');
      meta.textContent = `大小: ${formatBytes(data.size)} · 可编辑`;
      setSharedAceEditorContent(data.content, true, decoded);
    }
  } catch (e) {
    toast('打开共享文件失败: ' + e.message);
  }
}

async function saveSharedFile(auto = false) {
  if (!currentSharedPath) return;
  const content = sharedAceEditor ? sharedAceEditor.getValue() : '';
  try {
    await api('POST', `/files/shared?path=${encodeURIComponent(currentSharedPath)}`, { content });
    setSaveBtnState('shared-save-btn', 'saved');
    if (!auto) toast('共享文件已保存');
  } catch (e) {
    setSaveBtnState('shared-save-btn', 'saved');
    toast('保存失败: ' + e.message);
  }
}

// SSH & Git
let sshKeysCache = [];

async function loadSshKeys() {
  try {
    sshKeysCache = await api('GET', '/git/ssh-keys');
  } catch (e) {
    sshKeysCache = [];
  }
  renderSshKeys();
  populateGitSshSelect();
}

function populateGitSshSelect() {
  const select = document.getElementById('git-ssh-key');
  if (!select) return;
  let html = '<option value="">不使用 SSH 密钥</option>';
  sshKeysCache.forEach(k => {
    html += `<option value="${escapeHtml(k.name)}">${escapeHtml(k.name)}</option>`;
  });
  select.innerHTML = html;
}

function openSshModal() {
  document.getElementById('ssh-modal').classList.add('show');
  loadSshKeys();
}

function closeSshModal() {
  document.getElementById('ssh-modal').classList.remove('show');
}

function renderSshKeys() {
  const container = document.getElementById('ssh-keys-list');
  if (!container) return;
  if (!sshKeysCache.length) {
    container.innerHTML = '<p class="meta" style="font-size:13px">暂无 SSH 密钥，请在下方生成。</p>';
    return;
  }
  container.innerHTML = sshKeysCache.map(k => `
    <div class="key-card">
      <div class="flex-between" style="margin-bottom:6px">
        <strong style="font-size:14px">${escapeHtml(k.name)}</strong>
        <button class="btn btn-danger" onclick="deleteSshKey('${escapeHtml(k.name)}')" style="padding:4px 10px;font-size:12px">删除</button>
      </div>
      <code>${escapeHtml(k.public_key)}</code>
    </div>
  `).join('');
}

async function generateSshKey() {
  const name = document.getElementById('ssh-key-name').value.trim();
  const email = document.getElementById('ssh-key-email').value.trim() || 'ai-company@local';
  if (!name) return toast('请输入密钥名称');
  try {
    await api('POST', `/git/ssh-keys?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`);
    document.getElementById('ssh-key-name').value = '';
    document.getElementById('ssh-key-email').value = '';
    toast('SSH 密钥已生成');
    await loadSshKeys();
  } catch (e) {
    toast('生成失败: ' + e.message);
  }
}

async function deleteSshKey(name) {
  if (!confirm(`确定删除 SSH 密钥 "${name}" 吗？`)) return;
  try {
    await api('DELETE', '/git/ssh-keys/' + encodeURIComponent(name));
    toast('已删除');
    await loadSshKeys();
  } catch (e) {
    toast('删除失败: ' + e.message);
  }
}

async function syncSshKeysToSystem() {
  try {
    toast('正在同步 SSH 密钥到 ~/.ssh...');
    const result = await api('POST', '/git/ssh-keys/sync-to-system');

    let msg = '';
    if (result.synced && result.synced.length > 0) {
      msg += `已同步 ${result.synced.length} 个密钥: ${result.synced.join(', ')}`;
    }
    if (result.skipped && result.skipped.length > 0) {
      msg += (msg ? '\n' : '') + `跳过 ${result.skipped.length} 个: ${result.skipped.join(', ')}`;
    }
    if (result.errors && result.errors.length > 0) {
      msg += (msg ? '\n' : '') + `错误: ${result.errors.join(', ')}`;
    }

    if (result.synced && result.synced.length > 0) {
      toast('SSH 密钥同步成功');
    } else if (result.errors && result.errors.length > 0) {
      toast('同步失败: ' + result.errors[0]);
    } else {
      toast('没有可同步的密钥');
    }
  } catch (e) {
    toast('同步失败: ' + e.message);
  }
}

function extractRepoName(url) {
  try {
    const m = url.match(/\/([^/]+?)(?:\.git)?$/);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

async function cloneProject() {
  const url = document.getElementById('git-url').value.trim();
  let name = document.getElementById('git-name').value.trim();
  const path = document.getElementById('git-path').value.trim();
  const type = document.getElementById('git-type').value;
  const sshKey = document.getElementById('git-ssh-key').value;
  const branch = document.getElementById('git-branch').value.trim() || undefined;

  if (!url) return toast('请输入 Git 仓库地址');
  if (!name) {
    name = extractRepoName(url);
    if (!name) return toast('无法自动提取项目名称，请手动输入');
  }

  const resolvedPath = path || ('workspace/' + name);

  try {
    toast('正在启动拉取任务...');
    let cloneUrl = `/git/clone?url=${encodeURIComponent(url)}&target_path=${encodeURIComponent(resolvedPath)}`;
    if (sshKey) cloneUrl += `&ssh_key_name=${encodeURIComponent(sshKey)}`;
    if (branch) cloneUrl += `&branch=${encodeURIComponent(branch)}`;
    const startRes = await api('POST', cloneUrl);
    const jobId = startRes.job_id;

    toast('拉取中，请稍候...');
    // Poll clone status up to 120 seconds
    let status = 'running';
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const job = await api('GET', `/git/clone/${encodeURIComponent(jobId)}`);
      status = job.status;
      if (status === 'success') break;
      if (status === 'failed') throw new Error(job.error || 'git clone failed');
    }
    if (status === 'running') throw new Error('拉取超时，请稍后手动刷新项目列表');

    // Create project after clone
    let createUrl = `/projects?name=${encodeURIComponent(name)}&project_type=${encodeURIComponent(type)}&path=${encodeURIComponent(resolvedPath)}`;
    await api('POST', createUrl);

    toast('项目拉取并创建成功');
    document.getElementById('git-url').value = '';
    document.getElementById('git-name').value = '';
    document.getElementById('git-path').value = '';
    document.getElementById('git-branch').value = '';
    loadProjects();
  } catch (e) {
    toast('拉取失败: ' + e.message);
  }
}
