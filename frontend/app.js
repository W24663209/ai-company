const API = '';

let projectsCache = [];
let currentProject = null;
let currentReqs = [];
let activeChatReqId = null;
let chatHistories = {}; // reqId -> [{role, text}]
let chatLoadingState = {}; // reqId -> boolean
let chatFiles = {}; // reqId -> [File]
let currentCodeChanges = {}; // reqId -> {diff: string, files: []}

// Load and display code changes for the requirement
async function loadCodeChangesForReq(reqId) {
  if (!currentProject) return;
  try {
    const result = await api('GET', `/git/diff?project_id=${currentProject.id}`);
    if (result && result.has_changes) {
      currentCodeChanges[reqId] = result;
    } else {
      delete currentCodeChanges[reqId];
    }
    // Re-render to show changes
    if (activeChatReqId === reqId) {
      loadReqs();
    }
  } catch (e) {
    console.log('No code changes or error:', e);
    delete currentCodeChanges[reqId];
  }
}

// Clear code changes display
function clearCodeChanges(reqId) {
  delete currentCodeChanges[reqId];
  loadReqs();
}

// Audio notification for Claude completion
function playCompletionSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Pleasant chime sound (C5-E5-G5)
    oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    console.log('Audio notification not available:', e);
  }
}

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
  if (name === 'terminal') {
    connectTerminal();
    renderTerminalScripts();
  } else {
    disconnectTerminal();
  }
  if (name === 'env') loadEnvironmentConfig();
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
    // Sort by created_at descending (newest first)
    currentReqs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
        <td style="padding-left:24px;width:60px">${r.id}</td>
        <td style="width:25%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td style="width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.description || '-'}</td>
        <td style="width:80px"><span class="tag status-${r.status}">${r.status}</span></td>
        <td style="width:70px">${r.priority}</td>
        <td class="actions" style="padding-right:24px;width:180px;text-align:right">
          <div style="display:flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end">
            ${r.status !== 'done' ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:12px" onclick="event.stopPropagation();updateReq('${r.id}', '${r.status === 'pending' ? 'in_progress' : 'done'}')">${r.status === 'pending' ? '开始' : '完成'}</button>` : '<span style="color:var(--text-muted);font-size:12px">已完成</span>'}
            <button class="btn btn-primary" style="padding:4px 10px;font-size:12px" onclick="event.stopPropagation();toggleChat('${r.id}')">工作</button>
          </div>
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
    bubbles = '<div class="empty" style="padding:10px 0">点击发送即可开始与 Claude 对话处理此需求，或使用"协作消息"与其他项目沟通</div>';
  } else {
    bubbles = history.map(h => {
      if (h.isCollab) {
        return `
          <div class="chat-bubble collaboration">
            <div class="label">${h.role === 'claude' ? '协作消息' : '发送协作'}</div>
            <div class="text">${escapeHtml(h.text)}</div>
          </div>
        `;
      }
      const label = h.role === 'claude' ? 'Claude' : '你';
      return `
        <div class="chat-bubble ${h.role === 'claude' ? 'claude' : 'user'}">
          <div class="label">${label}</div>
          <div class="text">${escapeHtml(h.text)}</div>
        </div>
      `;
    }).join('');
  }
  const loadingBubble = chatLoadingState[reqId] ? `
    <div class="chat-bubble claude">
      <div class="label">Claude</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  ` : '';

  // Build code changes display
  const codeChanges = currentCodeChanges[reqId];
  const codeChangesPanel = codeChanges ? `
    <div id="code-changes-${reqId}" style="border-top:1px solid var(--border);background:#f8fafc;">
      <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#e2e8f0;">
        <strong style="font-size:13px;color:#475569">📄 当前代码修改 (${codeChanges.files.length} 个文件)</strong>
        <button class="btn btn-ghost" onclick="clearCodeChanges('${reqId}')" style="padding:2px 8px;font-size:12px">隐藏</button>
      </div>
      <pre style="margin:0;padding:12px;font-size:11px;line-height:1.4;max-height:150px;overflow:auto;background:#fff;font-family:monospace;color:#334155">${escapeHtml(codeChanges.stat || '无统计信息')}</pre>
    </div>
  ` : '';

  return `
    <tr class="chat-panel-row">
      <td colspan="6" style="padding:0;border-bottom:none">
        <div class="chat-area" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;width:100%;position:relative;" id="chat-area-${reqId}" ondragover="handleChatDragOver(event, '${reqId}')" ondragleave="handleChatDragLeave(event, '${reqId}')" ondrop="handleChatDrop(event, '${reqId}')">
          <div class="chat-header">
            <strong>💻 开发工作区</strong>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-secondary" onclick="showCollaborationModal('${reqId}')" style="font-size:12px;padding:4px 10px">协作消息</button>
              <button class="btn btn-ghost" onclick="closeChat()">收起</button>
            </div>
          </div>

          ${currentProject?.agent_roles ? `
          <div style="padding:10px 16px;background:#fef3c7;border-bottom:1px solid #f59e0b;font-size:12px;color:#92400e;max-height:80px;overflow-y:auto;"
               title="在 设置 标签页可以修改智能体工作职责">
            <strong>🎭 智能体工作职责:</strong>
            <div style="margin-top:4px;white-space:pre-wrap;">${escapeHtml(currentProject.agent_roles)}</div>
          </div>
          ` : ''}

          <!-- Active Agents Panel -->
          <div id="active-agents-${reqId}" style="border-bottom:1px solid var(--border);background:#f0fdf4;max-height:100px;overflow-y:auto;display:none;">
            <div style="padding:6px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#dcfce7;">
              <strong style="font-size:12px;color:#166534">🎭 在线智能体</strong>
              <div style="display:flex;gap:4px;">
                <button class="btn btn-ghost" onclick="registerDefaultAgents()" style="padding:2px 6px;font-size:11px;">初始化</button>
                <button class="btn btn-ghost" onclick="refreshAgentPresence('${reqId}')" style="padding:2px 6px;font-size:11px;">刷新</button>
              </div>
            </div>
            <div id="active-agents-list-${reqId}" style="padding:6px 12px;display:flex;flex-wrap:wrap;gap:6px;">
            </div>
          </div>

          <!-- Agent Messages Panel -->
          <div id="agent-messages-${reqId}" style="border-bottom:1px solid var(--border);background:#fafafa;max-height:200px;overflow-y:auto;">
            <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#f1f5f9;">
              <strong style="font-size:12px;color:#475569">🤖 智能体工作消息</strong>
              <span class="meta" style="font-size:11px" id="agent-msg-count-${reqId}">加载中...</span>
            </div>
            <div id="agent-messages-list-${reqId}" style="padding:8px 12px;">
              <p class="meta" style="font-size:12px;color:var(--text-muted)">暂无智能体消息</p>
            </div>
          </div>

          <div id="chat-history-${reqId}" class="chat-messages" onscroll="handleChatScroll('${reqId}')">
            ${bubbles}
            ${loadingBubble}
          </div>
          <!-- Scroll to bottom button -->
          <button id="scroll-to-bottom-btn-${reqId}" onclick="scrollChatToBottom('${reqId}', true)" style="display:none;position:absolute;right:20px;bottom:140px;z-index:100;padding:8px 12px;background:#3b82f6;color:#fff;border:none;border-radius:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-size:12px;align-items:center;gap:4px;">
            ⬇️ 最新
          </button>
          ${codeChangesPanel}
          <div id="chat-files-${reqId}" class="chat-files-list" style="display:none;padding:8px 12px;background:#f8f9fa;border-top:1px solid var(--border);max-height:100px;overflow-y:auto;"></div>
          <div class="ws-status" id="ws-status-${reqId}" style="display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:12px;color:#666;background:#f8f9fa;border-top:1px solid var(--border);">
            <span class="ws-dot" id="ws-dot-${reqId}" style="width:8px;height:8px;border-radius:50%;background:#ccc;"></span>
            <span class="ws-text" id="ws-text-${reqId}">未连接</span>
          </div>
          <div class="chat-input-wrapper">
            <div id="work-message-form-${reqId}" style="flex:1;min-width:0;">
              <!-- Dynamic form will be rendered here based on template -->
              <textarea id="chat-input-${reqId}" class="chat-input" placeholder="输入你要告诉 Claude 的内容，按 Enter 发送，或粘贴/拖拽文件上传" onpaste="handleChatPaste(event, '${reqId}')"></textarea>
            </div>
            <input type="file" id="chat-file-${reqId}" style="display:none" onchange="handleChatFileSelect('${reqId}')" multiple>
            <button class="btn btn-ghost" onclick="document.getElementById('chat-file-${reqId}').click()" title="上传文件" style="padding:8px">📎</button>
            <button class="btn btn-primary" id="chat-send-btn-${reqId}" onclick="sendWorkMessage('${reqId}')" style="padding:8px 16px">发送</button>
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
    await loadCollabMessagesForReq(reqId);
    await loadCodeChangesForReq(reqId);
  }
  await loadReqs();

  // Scroll to bottom after DOM is fully rendered
  // Use requestAnimationFrame to ensure browser has painted
  requestAnimationFrame(() => {
    scrollChatToBottom(reqId, false);
    // Multiple fallback scrolls with increasing delays
    [100, 300, 500, 800].forEach((delay, index) => {
      setTimeout(() => {
        scrollChatToBottom(reqId, index === 3);
      }, delay);
    });
  });

  setTimeout(() => {
    const el = document.getElementById(`chat-input-${reqId}`);
    if (el) el.focus();
  }, 100);
}

async function loadCollabMessagesForReq(reqId) {
  if (!currentProject) return;
  try {
    // Get messages where this requirement is the source
    const allMessages = await api('GET', `/api/messages?project_id=${currentProject.id}&direction=both`);
    const relatedMessages = allMessages.filter(m =>
      m.source_requirement_id === reqId || m.target_requirement_id === reqId
    );

    if (!chatHistories[reqId]) chatHistories[reqId] = [];

    // Add collaboration messages as system messages
    for (const msg of relatedMessages) {
      const isOutgoing = msg.source_project_id === currentProject.id;
      const exists = chatHistories[reqId].some(h =>
        h.msgId === `collab-${msg.id}` || h.msgId === `collab-reply-${msg.id}`
      );
      if (exists) continue;

      if (isOutgoing) {
        chatHistories[reqId].push({
          role: 'user',
          text: `[发送给 ${msg.target_project_name || '其他项目'}] ${msg.subject}\n${msg.content}`,
          fullText: msg.content,
          msgId: `collab-${msg.id}`,
          isCollab: true
        });
      } else {
        chatHistories[reqId].push({
          role: 'claude',
          text: `[收到来自 ${msg.source_project_name || '其他项目'}] ${msg.subject}\n${msg.content}`,
          fullText: msg.content,
          msgId: `collab-${msg.id}`,
          isCollab: true
        });
      }

      // Check for replies
      if (msg.reply_to) {
        const replyExists = chatHistories[reqId].some(h => h.msgId === `collab-reply-${msg.id}`);
        if (!replyExists) {
          const replies = allMessages.filter(m => m.reply_to === msg.id);
          for (const reply of replies) {
            chatHistories[reqId].push({
              role: reply.source_project_id === currentProject.id ? 'user' : 'claude',
              text: `[回复] ${reply.content}`,
              fullText: reply.content,
              msgId: `collab-reply-${reply.id}`,
              isCollab: true
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to load collab messages:', e);
  }
}

function closeChat() {
  activeChatReqId = null;
  loadReqs();
}

function appendChatBubble(reqId, role, text, msgId = null) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (!container) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'claude' ? 'claude' : 'user'}`;
  bubble.id = msgId ? `msg-${msgId}` : '';

  // Add resend button for user messages
  const resendBtn = role !== 'claude' && msgId
    ? `<button class="btn btn-ghost" onclick="resendChat('${reqId}', '${msgId}')" style="padding:2px 8px;font-size:12px;margin-left:8px" title="重新发送">🔄</button>`
    : '';

  bubble.innerHTML = `
    <div class="label">${role === 'claude' ? 'Claude' : '你'}${resendBtn}</div>
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
  if (!currentProject || chatLoadingState[reqId]) return;
  const input = document.getElementById(`chat-input-${reqId}`);
  if (!input) return;
  const text = input.value.trim();
  const files = chatFiles[reqId] || [];

  if (!text && files.length === 0) return toast('请输入内容或选择文件');

  // Build message with file contents
  let fullMessage = text;
  let fileDescription = '';

  // Read and include file contents if any
  if (files.length > 0) {
    const fileContents = await Promise.all(files.map(async (file) => {
      try {
        const content = await readFileContent(file);
        return `--- File: ${file.name} ---\n${content}\n--- End of ${file.name} ---`;
      } catch (e) {
        return `--- File: ${file.name} ---\n[无法读取文件内容: ${e.message}]\n--- End of ${file.name} ---`;
      }
    }));

    // Build file description for display
    fileDescription = files.map(f => f.name).join(', ');

    // Combine text and files
    const parts = [];
    if (fullMessage) parts.push(fullMessage);
    parts.push(...fileContents);
    fullMessage = parts.join('\n\n');

    // Clear files after reading
    chatFiles[reqId] = [];
    updateChatFileList(reqId);
  }

  if (!chatHistories[reqId]) chatHistories[reqId] = [];

  // Build display text showing both message and files
  let displayParts = [];
  if (text) displayParts.push(text);
  if (fileDescription) displayParts.push(`[文件: ${fileDescription}]`);
  const displayText = displayParts.join('\n') || '[空消息]';

  // Generate unique message ID for resend functionality
  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  chatHistories[reqId].push({ role: 'user', text: displayText, fullText: fullMessage, msgId: msgId });
  input.value = '';
  chatLoadingState[reqId] = true;

  appendChatBubble(reqId, 'user', displayText, msgId);
  appendLoadingIndicator(reqId);
  scrollChatToBottom(reqId);
  await saveWorklog(reqId);

  setChatControlsEnabled(reqId, false);

  // Use WebSocket for long-running Claude tasks (like terminal)
  // with automatic reconnection support
  let ws = null;
  let pingInterval = null;
  let connectionTimeout = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  let isResolved = false;

  // Create streaming bubble (only once)
  removeLoadingIndicator(reqId);
  const claudeBubble = document.createElement('div');
  claudeBubble.className = 'chat-bubble claude';
  claudeBubble.textContent = '';
  const container = document.getElementById(`chat-history-${reqId}`);
  if (container) container.appendChild(claudeBubble);

  let fullResponse = '';
  let hasReceivedData = false;
  let pendingUpdate = false;
  let pendingScroll = false;

  const updateUI = () => {
    if (pendingUpdate) {
      claudeBubble.textContent = fullResponse;
      pendingUpdate = false;
    }
    if (pendingScroll) {
      scrollChatToBottom(reqId);
      pendingScroll = false;
    }
    if (chatLoadingState[reqId]) {
      requestAnimationFrame(updateUI);
    }
  };
  requestAnimationFrame(updateUI);

  const connectWebSocket = () => new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/agents/ws/chat/${encodeURIComponent(currentProject.id)}/${encodeURIComponent(reqId)}`;

    ws = new WebSocket(wsUrl);
    updateWsStatus(reqId, 'connecting');

    // Connection timeout
    connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      reconnectAttempts = 0; // Reset on successful connection
      updateWsStatus(reqId, 'connected');

      // Start keepalive ping every 25 seconds
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 25000);

      // Send message (with file contents if any)
      ws.send(JSON.stringify({ message: fullMessage }));
    };

    ws.onmessage = (event) => {
      // Handle ping/pong
      if (event.data === 'ping') {
        ws.send('pong');
        return;
      }

      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (data.type === 'ping') {
        return;
      }

      hasReceivedData = true;

      if (data.type === 'partial') {
        fullResponse += data.data;
        pendingUpdate = true;
        pendingScroll = true;
      } else if (data.type === 'done') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        claudeBubble.remove();
        // Add token usage info if available
        let displayText = fullResponse;
        if (data.usage) {
          const usage = data.usage;
          const inputTokens = usage.input_tokens || 0;
          const outputTokens = usage.output_tokens || 0;
          const cacheTokens = usage.cache_read_tokens || 0;
          const cost = usage.total_cost_usd || 0;
          displayText += `\n\n---\n📊 Token消耗: 输入${inputTokens} / 输出${outputTokens} / 缓存${cacheTokens} | 💰 $${cost.toFixed(6)}`;
        }
        chatHistories[reqId].push({ role: 'claude', text: displayText });
        chatLoadingState[reqId] = false;
        appendChatBubble(reqId, 'claude', displayText);
        scrollChatToBottom(reqId);
        setChatControlsEnabled(reqId, true);
        saveWorklog(reqId);
        playCompletionSound();
        ws.close();

        // Trigger agent participation after Claude's response
        triggerAgentParticipation(reqId, fullMessage, fullResponse);

        resolve();
      } else if (data.type === 'error') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        chatLoadingState[reqId] = false;
        reject(new Error(data.message));
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      clearInterval(pingInterval);
      // Don't reject here, let onclose handle reconnection
    };

    ws.onclose = (event) => {
      clearInterval(pingInterval);
      if (isResolved || !chatLoadingState[reqId]) return;

      if (hasReceivedData && fullResponse) {
        // Connection closed but we got data, treat as success
        isResolved = true;
        claudeBubble.remove();
        chatHistories[reqId].push({ role: 'claude', text: fullResponse });
        chatLoadingState[reqId] = false;
        appendChatBubble(reqId, 'claude', fullResponse);
        scrollChatToBottom(reqId);
        setChatControlsEnabled(reqId, true);
        saveWorklog(reqId);
        playCompletionSound();
        updateWsStatus(reqId, 'idle');
        resolve();
      } else if (reconnectAttempts < maxReconnectAttempts) {
        // Try to reconnect with exponential backoff
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
        console.log(`WebSocket closed, reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
        updateWsStatus(reqId, 'reconnecting', reconnectAttempts);
        claudeBubble.textContent = `[连接断开，${delay/1000}秒后尝试重连 (${reconnectAttempts}/${maxReconnectAttempts})...]`;
        setTimeout(() => {
          if (chatLoadingState[reqId]) {
            connectWebSocket().then(resolve).catch(reject);
          }
        }, delay);
      } else {
        // Max reconnection attempts reached, show manual reconnect button
        isResolved = true;
        chatLoadingState[reqId] = false;
        updateWsStatus(reqId, 'disconnected');
        // Store message for manual reconnect
        window.pendingReconnect = { reqId, fullMessage };
        claudeBubble.innerHTML = `
          <div>[连接失败，已达到最大重试次数 (${maxReconnectAttempts}次)]</div>
          <button class="btn btn-primary" id="reconnect-btn-${reqId}" onclick="manualReconnect()" style="margin-top:8px">
            🔄 手动重连
          </button>
        `;
        setChatControlsEnabled(reqId, true);
        resolve();
      }
    };
  });

  try {
    await connectWebSocket();

  } catch (e) {
    console.error('Chat error:', e);
    clearInterval(pingInterval);
    if (ws) ws.close();

    // Fallback to HTTP streaming API if WebSocket fails
    try {
      const response = await fetch('/agents/chat?project_id=' + encodeURIComponent(currentProject.id) + '&requirement_id=' + encodeURIComponent(reqId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fullMessage })
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      removeLoadingIndicator(reqId);
      const claudeBubble = document.createElement('div');
      claudeBubble.className = 'chat-bubble claude';
      claudeBubble.textContent = '';
      const container = document.getElementById(`chat-history-${reqId}`);
      if (container) container.appendChild(claudeBubble);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'stdout' && data.data) {
                fullResponse += data.data;
                claudeBubble.textContent = fullResponse;
                scrollChatToBottom(reqId);
              } else if (data.type === 'done') {
                let displayText = fullResponse;
                if (data.usage) {
                  const usage = data.usage;
                  displayText += `\n\n---\n📊 Token消耗: 输入${usage.input_tokens} / 输出${usage.output_tokens} / 缓存${usage.cache_read_tokens} | 💰 $${usage.total_cost_usd.toFixed(6)}`;
                }
                chatHistories[reqId].push({ role: 'claude', text: displayText });
                claudeBubble.remove();
                appendChatBubble(reqId, 'claude', displayText);
                scrollChatToBottom(reqId);
                saveWorklog(reqId);
                playCompletionSound();
              }
            } catch (e) {}
          }
        }
      }

      chatLoadingState[reqId] = false;
      setChatControlsEnabled(reqId, true);

    } catch (httpError) {
      console.error('HTTP fallback error:', httpError);
      updateWsStatus(reqId, 'disconnected');
      const errorMsg = '出错了: ' + (httpError.message || '连接失败');
      chatHistories[reqId].push({ role: 'claude', text: errorMsg });
      chatLoadingState[reqId] = false;
      removeLoadingIndicator(reqId);
      appendChatBubble(reqId, 'claude', errorMsg);
      scrollChatToBottom(reqId);
      setChatControlsEnabled(reqId, true);
      saveWorklog(reqId);
    }
  }
}

function scrollChatToBottom(reqId, smooth = false) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }
  // Hide the scroll-to-bottom button
  const btn = document.getElementById(`scroll-to-bottom-btn-${reqId}`);
  if (btn) btn.style.display = 'none';
}

// Handle chat scroll to show/hide scroll-to-bottom button
function handleChatScroll(reqId) {
  const container = document.getElementById(`chat-history-${reqId}`);
  const btn = document.getElementById(`scroll-to-bottom-btn-${reqId}`);
  if (!container || !btn) return;

  // Show button if scrolled up more than 100px from bottom
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  btn.style.display = isNearBottom ? 'none' : 'flex';
}

window.handleChatScroll = handleChatScroll;

function setChatControlsEnabled(reqId, enabled) {
  const input = document.getElementById(`chat-input-${reqId}`);
  const sendBtn = document.getElementById(`chat-send-btn-${reqId}`);
  const fileBtn = input?.parentElement?.querySelector('.btn-ghost');

  if (input) {
    input.disabled = !enabled;
    input.style.opacity = enabled ? '1' : '0.5';
    if (!enabled) {
      input.placeholder = 'Claude 回复中...';
    } else {
      input.placeholder = '输入你要告诉 Claude 的内容，按 Enter 发送';
    }
  }

  if (sendBtn) {
    sendBtn.textContent = enabled ? '发送' : '回复中...';
    sendBtn.disabled = !enabled;
    sendBtn.style.opacity = enabled ? '1' : '0.7';
  }

  if (fileBtn) {
    fileBtn.disabled = !enabled;
    fileBtn.style.opacity = enabled ? '1' : '0.5';
  }
}

// Update WebSocket connection status UI
function updateWsStatus(reqId, status, reconnectAttempt = 0) {
  const dot = document.getElementById(`ws-dot-${reqId}`);
  const text = document.getElementById(`ws-text-${reqId}`);
  if (!dot || !text) return;

  const statusConfig = {
    'connected': { color: '#16a34a', text: '已连接', bg: '#dcfce7' },
    'connecting': { color: '#d97706', text: '连接中...', bg: '#fef3c7' },
    'reconnecting': { color: '#ea580c', text: `重连中 (${reconnectAttempt}/10)...`, bg: '#ffedd5' },
    'disconnected': { color: '#dc2626', text: '已断开', bg: '#fee2e2' },
    'idle': { color: '#6b7280', text: '未连接', bg: 'transparent' }
  };

  const config = statusConfig[status] || statusConfig['idle'];
  dot.style.background = config.color;
  dot.style.boxShadow = `0 0 4px ${config.color}`;
  text.textContent = config.text;
  text.style.color = config.color;
}

// Handle file selection for chat

function handleChatFileSelect(reqId) {
  const fileInput = document.getElementById(`chat-file-${reqId}`);
  const files = fileInput?.files;
  if (!files || files.length === 0) return;

  chatFiles[reqId] = chatFiles[reqId] || [];
  for (const file of files) {
    chatFiles[reqId].push(file);
  }

  // Update file list display
  updateChatFileList(reqId);

  toast(`已选择 ${files.length} 个文件`);
}

function updateChatFileList(reqId) {
  const filesList = document.getElementById(`chat-files-${reqId}`);
  const files = chatFiles[reqId] || [];

  if (files.length === 0) {
    filesList.style.display = 'none';
    filesList.innerHTML = '';
    return;
  }

  filesList.style.display = 'block';
  filesList.innerHTML = files.map((file, index) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:13px;">
      <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;">
        📄 ${file.name} (${formatFileSize(file.size)})
      </span>
      <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;" onclick="removeChatFile('${reqId}', ${index})" title="删除">
        ✕
      </button>
    </div>
  `).join('');
}

function removeChatFile(reqId, index) {
  if (chatFiles[reqId]) {
    chatFiles[reqId].splice(index, 1);
    updateChatFileList(reqId);
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Read file content as text
async function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
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
    // Load project skills
    await renderProjectSkills();
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

function connectTerminal() {
  if (!currentProject) return;

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


async function _doConnectTerminal() {
  document.getElementById('terminal-path').textContent = currentProject.path;

  // Load environment config and update display
  const project = await api('GET', '/projects/' + currentProject.id);
  const envName = project.active_environment || 'default';
  const environments = project.environments || [];
  const env = environments.find(e => e.name === envName) || {};

  // Update terminal environment display
  document.getElementById('term-current-env').textContent = envName === 'default' ? '默认环境' : envName;
  const runtimes = env.runtime_versions || [];
  const runtimeText = runtimes.map(rv => {
    const icons = { node: '🟢', python: '🐍', java: '☕' };
    return `${icons[rv.runtime] || ''} ${rv.runtime} ${rv.version}`;
  }).join(' | ');
  document.getElementById('term-env-runtimes').textContent = runtimeText ? `(${runtimeText})` : '';

  // Set runtime selects based on environment
  runtimes.forEach(rv => {
    if (rv.runtime === 'node' && document.getElementById('term-node')) {
      document.getElementById('term-node').value = rv.version;
    } else if (rv.runtime === 'java' && document.getElementById('term-java')) {
      document.getElementById('term-java').value = rv.version;
    } else if (rv.runtime === 'python' && document.getElementById('term-python')) {
      document.getElementById('term-python').value = rv.version;
    }
  });

  if (terminalSocket) {
    terminalSocket.close();
  }

  const javaVer = document.getElementById('term-java').value || '';
  const nodeVer = document.getElementById('term-node').value || '';
  const pythonVer = document.getElementById('term-python')?.value || '';
  const qs = [];
  if (javaVer) qs.push('java_version=' + encodeURIComponent(javaVer));
  if (pythonVer) qs.push('python_version=' + encodeURIComponent(pythonVer));

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
        <button class="btn btn-ghost" onclick="moveTerminalScriptUp(${idx})" style="padding:4px 8px;font-size:12px" title="上移" ${idx === 0 ? 'disabled style="padding:4px 8px;font-size:12px;opacity:0.3;cursor:not-allowed"' : ''}>↑</button>
        <button class="btn btn-ghost" onclick="moveTerminalScriptDown(${idx})" style="padding:4px 8px;font-size:12px" title="下移" ${idx === scripts.length - 1 ? 'disabled style="padding:4px 8px;font-size:12px;opacity:0.3;cursor:not-allowed"' : ''}>↓</button>
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

async function moveTerminalScriptUp(idx) {
  if (!currentProject) return;
  const scripts = currentProject.scripts || [];
  if (idx <= 0 || idx >= scripts.length) return;
  // Swap with previous item
  [scripts[idx - 1], scripts[idx]] = [scripts[idx], scripts[idx - 1]];
  await saveTerminalScripts(scripts);
  renderTerminalScripts();
}

async function moveTerminalScriptDown(idx) {
  if (!currentProject) return;
  const scripts = currentProject.scripts || [];
  if (idx < 0 || idx >= scripts.length - 1) return;
  // Swap with next item
  [scripts[idx], scripts[idx + 1]] = [scripts[idx + 1], scripts[idx]];
  await saveTerminalScripts(scripts);
  renderTerminalScripts();
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


document.getElementById('term-java').addEventListener('change', () => {
  if (!document.getElementById('panel-terminal').classList.contains('hidden')) connectTerminal();
});
document.getElementById('term-node').addEventListener('change', () => {
  if (!document.getElementById('panel-terminal').classList.contains('hidden')) connectTerminal();
});

// init
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
    const url = `/files/shared?path=${encodeURIComponent(path)}`;
    console.log('[DEBUG] Loading shared tree from:', url);
    const data = await api('GET', url);
    console.log('[DEBUG] Shared tree response:', JSON.stringify(data));
    console.log('[DEBUG] Response type:', typeof data, 'data.type:', data?.type, 'data.items:', data?.items);
    if (data && data.type === 'directory' && Array.isArray(data.items)) {
      console.log('[DEBUG] Rendering', data.items.length, 'items');
      renderSharedTreeItems(data.items, path);
    } else {
      console.error('[DEBUG] Shared tree response format invalid:', data);
      toast('加载共享目录失败: 响应格式错误 - 期望 type=directory');
    }
  } catch (e) {
    console.error('[DEBUG] 加载共享目录失败:', e);
    toast('加载共享目录失败: ' + e.message);
  }
}

function renderSharedTreeItems(items, parentPath) {
  console.log('[DEBUG] Rendering shared tree items:', items?.length || 0, 'items, parentPath:', parentPath);
  const container = document.getElementById('shared-tree');
  if (!container) {
    console.error('[DEBUG] Shared tree container not found!');
    return;
  }
  if (!items || !items.length) {
    console.log('[DEBUG] No items to render, showing empty state');
    container.innerHTML = '<div class="empty" style="padding:20px 0">空目录</div>';
    return;
  }
  console.log('[DEBUG] Building HTML for', items.length, 'items');
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

// Skills Management
let skillsCache = [];
let projectSkillsCache = {}; // projectId -> [skill bindings]

// Load skills list
async function loadSkills() {
  try {
    skillsCache = await api('GET', '/skills');
  } catch (e) {
    skillsCache = [];
  }
}

// Get project skills
async function loadProjectSkills(projectId) {
  try {
    const data = await api('GET', `/skills/project/${projectId}`);
    projectSkillsCache[projectId] = data;
  } catch (e) {
    projectSkillsCache[projectId] = [];
  }
}

// Render project skills in settings panel
async function renderProjectSkills() {
  if (!currentProject) return;

  const container = document.getElementById('project-skills-list');
  if (!container) return;

  await loadProjectSkills(currentProject.id);
  const bindings = projectSkillsCache[currentProject.id] || [];

  if (bindings.length === 0) {
    container.innerHTML = `
      <p class="meta" style="font-size:13px;color:var(--text-muted)">
        暂无绑定的技能。
        <button class="btn btn-link" onclick="showSkillsManager()">浏览技能库</button>
      </p>
    `;
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  for (const item of bindings) {
    const skill = item.skill;
    const binding = item.binding;
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <strong style="font-size:14px">${escapeHtml(skill.name)}</strong>
            <span class="badge" style="font-size:11px;padding:2px 8px;background:var(--primary-light);color:var(--primary);border-radius:4px">${skill.category}</span>
            <span style="font-size:11px;color:var(--text-muted)">优先级: ${binding.priority}/10</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(skill.description || '暂无描述')}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-left:12px">
          <label class="switch" style="position:relative;display:inline-block;width:40px;height:20px">
            <input type="checkbox" ${binding.enabled ? 'checked' : ''} onchange="toggleProjectSkill('${skill.id}', this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${binding.enabled ? 'var(--primary)' : '#ccc'};border-radius:20px;transition:.3s"></span>
          </label>
          <button class="btn btn-ghost" onclick="showSkillsManager('${skill.id}')" style="padding:4px 8px;font-size:12px">编辑</button>
          <button class="btn btn-danger" onclick="unbindSkillFromProject('${skill.id}')" style="padding:4px 8px;font-size:12px">解绑</button>
        </div>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

// Toggle skill enabled state
async function toggleProjectSkill(skillId, enabled) {
  if (!currentProject) return;
  try {
    await api('PATCH', `/skills/bind/${currentProject.id}/${skillId}?enabled=${enabled}`);
    toast(enabled ? '技能已启用' : '技能已禁用');
    await renderProjectSkills();
  } catch (e) {
    toast('操作失败: ' + e.message);
  }
}

// Unbind skill from project
async function unbindSkillFromProject(skillId) {
  if (!currentProject) return;
  if (!confirm('确定要解绑这个技能吗？')) return;
  try {
    await api('DELETE', `/skills/bind/${currentProject.id}/${skillId}`);
    toast('技能已解绑');
    await renderProjectSkills();
  } catch (e) {
    toast('解绑失败: ' + e.message);
  }
}

// Show skills manager modal
async function showSkillsManager(editSkillId = null) {
  document.getElementById('skills-modal').classList.add('show');
  await loadSkills();
  renderSkillsList();

  if (editSkillId) {
    editSkill(editSkillId);
  }
}

function closeSkillsModal() {
  document.getElementById('skills-modal').classList.remove('show');
}

// Filter skills
function filterSkills() {
  renderSkillsList();
}

// Render skills list in modal
function renderSkillsList() {
  const container = document.getElementById('skills-list');
  const searchTerm = document.getElementById('skill-search').value.toLowerCase();
  const categoryFilter = document.getElementById('skill-category-filter').value;

  let filtered = skillsCache;

  if (searchTerm) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(searchTerm) ||
      (s.description || '').toLowerCase().includes(searchTerm) ||
      s.tags.some(t => t.toLowerCase().includes(searchTerm))
    );
  }

  if (categoryFilter) {
    filtered = filtered.filter(s => s.category === categoryFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="meta" style="text-align:center;padding:40px 0">没有找到匹配的技能</p>';
    return;
  }

  // Get currently bound skill IDs for this project
  const boundSkillIds = new Set();
  if (currentProject && projectSkillsCache[currentProject.id]) {
    for (const item of projectSkillsCache[currentProject.id]) {
      boundSkillIds.add(item.skill.id);
    }
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  for (const skill of filtered) {
    const isBound = boundSkillIds.has(skill.id);
    html += `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <strong style="font-size:14px">${escapeHtml(skill.name)}</strong>
            <span class="badge" style="font-size:11px;padding:2px 8px;background:var(--primary-light);color:var(--primary);border-radius:4px">${skill.category}</span>
            ${skill.tags.map(t => `<span style="font-size:11px;color:var(--text-muted)">#${escapeHtml(t)}</span>`).join(' ')}
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px 0">${escapeHtml(skill.description || '暂无描述')}</p>
          <div style="font-size:11px;color:var(--text-muted)">ID: ${skill.id}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${isBound ?
            `<button class="btn btn-secondary" onclick="editSkillPriority('${skill.id}')">调整优先级</button>
             <button class="btn btn-danger" onclick="unbindSkillFromProject('${skill.id}');closeSkillsModal();">解绑</button>` :
            `<button class="btn btn-primary" onclick="bindSkillToProject('${skill.id}')">绑定</button>`
          }
          <button class="btn btn-ghost" onclick="editSkill('${skill.id}')">编辑</button>
        </div>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

// Bind skill to current project
async function bindSkillToProject(skillId) {
  if (!currentProject) {
    toast('请先选择一个项目');
    return;
  }
  try {
    await api('POST', `/skills/bind/${currentProject.id}/${skillId}`);
    toast('技能已绑定');
    await loadProjectSkills(currentProject.id);
    renderSkillsList();
    renderProjectSkills();
  } catch (e) {
    toast('绑定失败: ' + e.message);
  }
}

// Edit skill priority
async function editSkillPriority(skillId) {
  const priority = prompt('设置优先级 (1-10, 数字越大优先级越高):', '5');
  if (priority === null) return;
  const p = parseInt(priority);
  if (isNaN(p) || p < 1 || p > 10) {
    toast('请输入 1-10 之间的数字');
    return;
  }
  try {
    await api('PATCH', `/skills/bind/${currentProject.id}/${skillId}?priority=${p}`);
    toast('优先级已更新');
    await loadProjectSkills(currentProject.id);
    renderSkillsList();
    renderProjectSkills();
  } catch (e) {
    toast('更新失败: ' + e.message);
  }
}

// Show create skill form
function showCreateSkillForm() {
  document.getElementById('skill-form-title').textContent = '新建技能';
  document.getElementById('skill-id').value = '';
  document.getElementById('skill-name').value = '';
  document.getElementById('skill-category').value = 'coding';
  document.getElementById('skill-tags').value = '';
  document.getElementById('skill-description').value = '';
  document.getElementById('skill-content').value = '';
  document.getElementById('skill-delete-btn').style.display = 'none';
  document.getElementById('skill-form-modal').classList.add('show');
}

// Edit skill
function editSkill(skillId) {
  const skill = skillsCache.find(s => s.id === skillId);
  if (!skill) return;

  document.getElementById('skill-form-title').textContent = '编辑技能';
  document.getElementById('skill-id').value = skill.id;
  document.getElementById('skill-name').value = skill.name;
  document.getElementById('skill-category').value = skill.category || 'coding';
  document.getElementById('skill-tags').value = (skill.tags || []).join(', ');
  document.getElementById('skill-description').value = skill.description || '';
  document.getElementById('skill-content').value = skill.content || '';
  document.getElementById('skill-delete-btn').style.display = 'inline-block';
  document.getElementById('skill-form-modal').classList.add('show');
}

function closeSkillFormModal() {
  document.getElementById('skill-form-modal').classList.remove('show');
}

// Save skill (create or update)
async function saveSkill() {
  const id = document.getElementById('skill-id').value;
  const name = document.getElementById('skill-name').value.trim();
  const category = document.getElementById('skill-category').value;
  const tags = document.getElementById('skill-tags').value;
  const description = document.getElementById('skill-description').value.trim();
  const content = document.getElementById('skill-content').value.trim();

  if (!name) return toast('请输入技能名称');
  if (!content) return toast('请输入技能内容');

  try {
    if (id) {
      // Update
      await api('PATCH', `/skills/${id}?name=${encodeURIComponent(name)}&category=${category}&tags=${encodeURIComponent(tags)}&description=${encodeURIComponent(description)}&content=${encodeURIComponent(content)}`);
      toast('技能已更新');
    } else {
      // Create
      await api('POST', `/skills?name=${encodeURIComponent(name)}&category=${category}&tags=${encodeURIComponent(tags)}&description=${encodeURIComponent(description)}&content=${encodeURIComponent(content)}`);
      toast('技能已创建');
    }
    closeSkillFormModal();
    await loadSkills();
    renderSkillsList();
    renderProjectSkills();
  } catch (e) {
    toast('保存失败: ' + e.message);
  }
}

// Delete skill
async function deleteSkill() {
  const id = document.getElementById('skill-id').value;
  if (!id) return;
  if (!confirm('确定要删除这个技能吗？这将同时解除所有项目的绑定。')) return;

  try {
    await api('DELETE', `/skills/${id}`);
    toast('技能已删除');
    closeSkillFormModal();
    await loadSkills();
    renderSkillsList();
    renderProjectSkills();
  } catch (e) {
    toast('删除失败: ' + e.message);
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

// Resend a chat message by its ID
async function resendChat(reqId, msgId) {
  if (!currentProject || chatLoadingState[reqId]) return;

  // Find the message in history
  const history = chatHistories[reqId] || [];
  const msgIndex = history.findIndex(m => m.msgId === msgId);
  if (msgIndex === -1) return toast('找不到消息');

  const msg = history[msgIndex];
  if (!msg.fullText) return toast('无法重发此消息');

  // Remove the original message bubble and all subsequent messages
  const msgEl = document.getElementById(`msg-${msgId}`);
  if (msgEl) {
    let el = msgEl;
    while (el) {
      const nextEl = el.nextElementSibling;
      el.remove();
      el = nextEl;
    }
  }

  // Remove from history
  chatHistories[reqId] = history.slice(0, msgIndex);

  // Re-append the message with new ID
  const newMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  chatHistories[reqId].push({ role: 'user', text: msg.text, fullText: msg.fullText, msgId: newMsgId });

  chatLoadingState[reqId] = true;
  appendChatBubble(reqId, 'user', msg.text, newMsgId);
  appendLoadingIndicator(reqId);
  scrollChatToBottom(reqId);
  await saveWorklog(reqId);
  setChatControlsEnabled(reqId, false);

  // WebSocket with auto-reconnect
  let ws = null;
  let pingInterval = null;
  let connectionTimeout = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  let isResolved = false;
  let fullResponse = '';
  let hasReceivedData = false;
  let pendingUpdate = false;
  let pendingScroll = false;

  const connectWebSocket = () => new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/agents/ws/chat/${encodeURIComponent(currentProject.id)}/${encodeURIComponent(reqId)}`;

    ws = new WebSocket(wsUrl);
    updateWsStatus(reqId, 'connecting');

    connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      reconnectAttempts = 0;
      updateWsStatus(reqId, 'connected');
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
      ws.send(JSON.stringify({ message: msg.fullText }));
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.type === 'ping') return;
      hasReceivedData = true;

      if (data.type === 'partial') {
        fullResponse += data.data;
        pendingUpdate = true;
        pendingScroll = true;
      } else if (data.type === 'done') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        removeLoadingIndicator(reqId);
        let displayText = fullResponse;
        if (data.usage) {
          const usage = data.usage;
          displayText += `\n\n---\n📊 Token消耗: 输入${usage.input_tokens} / 输出${usage.output_tokens} / 缓存${usage.cache_read_tokens} | 💰 $${usage.total_cost_usd.toFixed(6)}`;
        }
        chatHistories[reqId].push({ role: 'claude', text: displayText });
        appendChatBubble(reqId, 'claude', displayText);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        ws.close();
        resolve();
      } else if (data.type === 'error') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        chatLoadingState[reqId] = false;
        removeLoadingIndicator(reqId);
        const errorMsg = `[错误: ${data.message || 'Unknown error'}]`;
        chatHistories[reqId].push({ role: 'claude', text: errorMsg });
        appendChatBubble(reqId, 'claude', errorMsg);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        ws.close();
      }
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      if (isResolved || !chatLoadingState[reqId]) return;

      if (hasReceivedData && fullResponse) {
        isResolved = true;
        removeLoadingIndicator(reqId);
        chatHistories[reqId].push({ role: 'claude', text: fullResponse });
        chatLoadingState[reqId] = false;
        appendChatBubble(reqId, 'claude', fullResponse);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        updateWsStatus(reqId, 'idle');
        setChatControlsEnabled(reqId, true);
        resolve();
      } else if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
        updateWsStatus(reqId, 'reconnecting', reconnectAttempts);
        const loadingEl = document.getElementById(`chat-loading-${reqId}`);
        if (loadingEl) {
          const textEl = loadingEl.querySelector('.text');
          if (textEl) textEl.textContent = `[连接断开，${delay/1000}秒后尝试重连 (${reconnectAttempts}/${maxReconnectAttempts})...]`;
        }
        setTimeout(() => {
          if (chatLoadingState[reqId]) {
            connectWebSocket().then(resolve).catch(reject);
          }
        }, delay);
      } else {
        isResolved = true;
        chatLoadingState[reqId] = false;
        updateWsStatus(reqId, 'disconnected');
        removeLoadingIndicator(reqId);
        window.pendingReconnect = { reqId, fullMessage: msg.fullText };
        const errorMsg = `[连接失败，已达到最大重试次数 (${maxReconnectAttempts}次)]`;
        const bubbleHtml = errorMsg + '\n\n<button class="btn btn-primary" onclick="manualReconnect()" style="margin-top:8px">🔄 手动重连</button>';
        chatHistories[reqId].push({ role: 'claude', text: errorMsg });
        appendChatBubble(reqId, 'claude', bubbleHtml);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        resolve();
      }
    };

    ws.onerror = () => {
      clearInterval(pingInterval);
    };
  });

  try {
    await connectWebSocket();
  } catch (e) {
    if (!isResolved) {
      isResolved = true;
      removeLoadingIndicator(reqId);
      const errorMsg = `[错误: ${e.message}]`;
      chatHistories[reqId].push({ role: 'claude', text: errorMsg });
      chatLoadingState[reqId] = false;
      appendChatBubble(reqId, 'claude', errorMsg);
      scrollChatToBottom(reqId);
      saveWorklog(reqId);
      setChatControlsEnabled(reqId, true);
    }
  }
}

// Project Links & Cross-Project Collaboration
let projectLinksCache = [];
let crossProjectMessagesCache = [];
let currentMessageId = null;

// Show project network modal
async function showProjectNetworkModal() {
  if (!currentProject) {
    toast('请先选择一个项目');
    return;
  }
  document.getElementById('project-network-modal').classList.add('show');
  await loadProjectLinks();
  await loadCrossProjectMessages();
  renderProjectLinks();
  renderCrossProjectMessages();
  loadProjectOptionsForLink();
}

function closeProjectNetworkModal() {
  document.getElementById('project-network-modal').classList.remove('show');
}

// Load project links
async function loadProjectLinks() {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/api/${currentProject.id}/linked-projects`);
    projectLinksCache = data || [];
  } catch (e) {
    projectLinksCache = [];
  }
}

// Render project links
function renderProjectLinks() {
  const container = document.getElementById('project-links-list');
  if (!container) return;

  if (projectLinksCache.length === 0) {
    container.innerHTML = '<p class="meta" style="font-size:13px">暂无链接的项目</p>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  for (const item of projectLinksCache) {
    const link = item.link;
    const project = item.project;
    const typeLabels = {
      'related': '相关',
      'depends_on': '依赖于',
      'dependency_of': '被依赖',
      'parent': '父项目',
      'child': '子项目',
      'collaborates': '协作'
    };
    html += `
      <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-size:13px">${escapeHtml(project.name)}</strong>
          <span class="badge" style="font-size:11px;padding:2px 8px;background:var(--primary-light);color:var(--primary);border-radius:4px">${typeLabels[link.link_type] || link.link_type}</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px 0">${escapeHtml(link.description || '暂无描述')}</p>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="sendMessageToLinkedProject('${project.id}')">发消息</button>
          <button class="btn btn-danger" style="padding:4px 10px;font-size:12px" onclick="deleteProjectLink('${link.id}')">删除链接</button>
        </div>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

// Load project options for link creation
function loadProjectOptionsForLink() {
  const select = document.getElementById('link-target-project');
  const messageSelect = document.getElementById('message-target-project');
  if (!select) return;

  let html = '<option value="">选择项目...</option>';
  for (const project of projectsCache) {
    if (project.id !== currentProject?.id) {
      html += `<option value="${project.id}">${escapeHtml(project.name)}</option>`;
    }
  }
  select.innerHTML = html;
  if (messageSelect) messageSelect.innerHTML = html;
}

// Show create link form
function showCreateLinkForm() {
  if (!currentProject) return;
  loadProjectOptionsForLink();
  document.getElementById('create-link-modal').classList.add('show');
}

function closeCreateLinkModal() {
  document.getElementById('create-link-modal').classList.remove('show');
}

// Create project link
async function createProjectLink() {
  if (!currentProject) return;

  const targetId = document.getElementById('link-target-project').value;
  const linkType = document.getElementById('link-type').value;
  const description = document.getElementById('link-description').value;
  const autoRoute = document.getElementById('link-auto-route').checked;

  if (!targetId) return toast('请选择目标项目');

  try {
    await api('POST', `/api/links?source_project_id=${currentProject.id}&target_project_id=${targetId}&link_type=${linkType}&description=${encodeURIComponent(description)}&auto_route_messages=${autoRoute}`);
    toast('项目链接创建成功');
    closeCreateLinkModal();
    await loadProjectLinks();
    renderProjectLinks();
  } catch (e) {
    toast('创建失败: ' + e.message);
  }
}

// Delete project link
async function deleteProjectLink(linkId) {
  if (!confirm('确定要删除这个链接吗？')) return;
  try {
    await api('DELETE', `/api/links/${linkId}`);
    toast('链接已删除');
    await loadProjectLinks();
    renderProjectLinks();
  } catch (e) {
    toast('删除失败: ' + e.message);
  }
}

// Load cross-project messages
async function loadCrossProjectMessages() {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/api/messages?project_id=${currentProject.id}&direction=both`);
    crossProjectMessagesCache = data || [];
  } catch (e) {
    crossProjectMessagesCache = [];
  }
}

// Render cross-project messages
function renderCrossProjectMessages() {
  const container = document.getElementById('cross-project-messages');
  if (!container) return;

  if (crossProjectMessagesCache.length === 0) {
    container.innerHTML = '<p class="meta" style="font-size:13px;text-align:center;padding:40px 0">暂无跨项目消息</p>';
    return;
  }

  const typeLabels = {
    'request': '请求',
    'response': '回复',
    'notify': '通知',
    'delegate': '委派',
    'question': '问题'
  };

  const statusLabels = {
    'pending': '待处理',
    'delivered': '已送达',
    'read': '已读',
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败'
  };

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  for (const msg of crossProjectMessagesCache.slice(0, 20)) {
    const isIncoming = msg.target_project_id === currentProject?.id;
    const otherProject = isIncoming ? msg.source_project_id : msg.target_project_id;
    const otherProjectName = projectsCache.find(p => p.id === otherProject)?.name || otherProject;

    html += `
      <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;cursor:pointer" onclick="showMessageDetail('${msg.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;padding:2px 8px;border-radius:4px;background:${isIncoming ? '#dcfce7' : '#e0e7ff'};color:${isIncoming ? '#166534' : '#3730a3'}">${isIncoming ? '收件' : '发件'}</span>
            <span class="badge" style="font-size:11px;padding:2px 8px;background:var(--primary-light);color:var(--primary);border-radius:4px">${typeLabels[msg.message_type] || msg.message_type}</span>
            <strong style="font-size:13px">${escapeHtml(msg.subject)}</strong>
          </div>
          <span style="font-size:11px;color:var(--text-muted)">${statusLabels[msg.status] || msg.status}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:var(--text-muted)">${isIncoming ? '来自' : '发送至'}: ${escapeHtml(otherProjectName)} | 发送者: ${escapeHtml(msg.sender)}</span>
          <span style="font-size:11px;color:var(--text-muted)">${new Date(msg.created_at).toLocaleString()}</span>
        </div>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

// Show create message form
function showCreateMessageForm(targetProjectId = null) {
  if (!currentProject) {
    toast('请先选择一个项目');
    return;
  }
  loadProjectOptionsForLink();
  if (targetProjectId) {
    document.getElementById('message-target-project').value = targetProjectId;
    loadTargetProjectRequirements();
  }
  document.getElementById('create-message-modal').classList.add('show');
}

function closeCreateMessageModal() {
  document.getElementById('create-message-modal').classList.remove('show');
}

// Load target project requirements
async function loadTargetProjectRequirements() {
  const projectId = document.getElementById('message-target-project').value;
  const select = document.getElementById('message-target-requirement');
  if (!projectId || !select) return;

  select.innerHTML = '<option value="">不关联特定需求</option>';
  try {
    const reqs = await api('GET', `/requirements/${projectId}`);
    for (const req of reqs) {
      select.innerHTML += `<option value="${req.id}">${escapeHtml(req.title)}</option>`;
    }
  } catch (e) {
    // ignore
  }
}

// Send cross-project message
async function sendCrossProjectMessage() {
  if (!currentProject) return;

  const targetId = document.getElementById('message-target-project').value;
  const targetReqId = document.getElementById('message-target-requirement').value;
  const msgType = document.getElementById('message-type').value;
  const subject = document.getElementById('message-subject').value;
  const content = document.getElementById('message-content').value;

  if (!targetId) return toast('请选择目标项目');
  if (!subject) return toast('请输入主题');
  if (!content) return toast('请输入内容');

  try {
    await api('POST', `/api/messages?source_project_id=${currentProject.id}&target_project_id=${targetId}&sender=${encodeURIComponent(currentProject.name)}&message_type=${msgType}&subject=${encodeURIComponent(subject)}&content=${encodeURIComponent(content)}&target_requirement_id=${targetReqId}`);
    toast('消息发送成功');
    closeCreateMessageModal();
    await loadCrossProjectMessages();
    renderCrossProjectMessages();
  } catch (e) {
    toast('发送失败: ' + e.message);
  }
}

// Send message to linked project
function sendMessageToLinkedProject(projectId) {
  showCreateMessageForm(projectId);
}

// Show message detail
async function showMessageDetail(messageId) {
  const msg = crossProjectMessagesCache.find(m => m.id === messageId);
  if (!msg) return;

  currentMessageId = messageId;
  document.getElementById('message-detail-subject').textContent = msg.subject;

  const typeLabels = {
    'request': '请求',
    'response': '回复',
    'notify': '通知',
    'delegate': '委派',
    'question': '问题'
  };

  const otherProject = msg.target_project_id === currentProject?.id ? msg.source_project_id : msg.target_project_id;
  const otherProjectName = projectsCache.find(p => p.id === otherProject)?.name || otherProject;

  document.getElementById('message-detail-content').innerHTML = `
    <div style="margin-bottom:12px">
      <span class="badge" style="font-size:12px;padding:4px 12px;background:var(--primary-light);color:var(--primary);border-radius:4px">${typeLabels[msg.message_type] || msg.message_type}</span>
      <span style="font-size:13px;color:var(--text-muted);margin-left:8px">${msg.target_project_id === currentProject?.id ? '来自' : '发送至'}: ${escapeHtml(otherProjectName)}</span>
    </div>
    <div style="background:var(--bg);padding:16px;border-radius:8px;border:1px solid var(--border);font-family:monospace;white-space:pre-wrap">${escapeHtml(msg.content)}</div>
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">
      发送者: ${escapeHtml(msg.sender)} | 时间: ${new Date(msg.created_at).toLocaleString()}
    </div>
  `;

  // Show/hide reply section based on if it's an incoming message
  const replySection = document.getElementById('message-reply-section');
  if (msg.target_project_id === currentProject?.id && msg.status !== 'completed') {
    replySection.style.display = 'block';
  } else {
    replySection.style.display = 'none';
  }

  document.getElementById('message-detail-modal').classList.add('show');
}

function closeMessageDetailModal() {
  document.getElementById('message-detail-modal').classList.remove('show');
  currentMessageId = null;
}

// Reply to message
async function replyToMessage() {
  if (!currentMessageId) return;

  const content = document.getElementById('message-reply-content').value;
  if (!content) return toast('请输入回复内容');

  try {
    await api('POST', `/api/messages/${currentMessageId}/reply?sender=${encodeURIComponent(currentProject?.name || 'Unknown')}&content=${encodeURIComponent(content)}`);
    toast('回复已发送');
    closeMessageDetailModal();
    await loadCrossProjectMessages();
    renderCrossProjectMessages();
  } catch (e) {
    toast('发送失败: ' + e.message);
  }
}

// Collaboration message from workspace
let currentCollabReqId = null;

function showCollaborationModal(reqId) {
  currentCollabReqId = reqId;
  document.getElementById('collab-message-modal').classList.add('show');
  loadCollabTargetProjects();
  // Auto-fill subject with requirement info
  const req = currentReqs.find(r => r.id === reqId);
  if (req) {
    document.getElementById('collab-message-subject').value = `关于需求: ${req.title}`;
  }
}

function closeCollabMessageModal() {
  document.getElementById('collab-message-modal').classList.remove('show');
  currentCollabReqId = null;
  // Reset form
  document.getElementById('collab-target-project').innerHTML = '<option value="">选择要协作的项目...</option>';
  document.getElementById('collab-message-subject').value = '';
  document.getElementById('collab-message-content').value = '';
  document.getElementById('collab-message-error').style.display = 'none';
}

async function loadCollabTargetProjects() {
  try {
    // Get all projects except current
    const projects = await api('GET', '/projects');
    const select = document.getElementById('collab-target-project');
    select.innerHTML = '<option value="">选择要协作的项目...</option>';

    // Also get linked projects first
    let linkedProjectIds = new Set();
    try {
      const linked = await api('GET', `/api/${currentProject.id}/linked-projects`);
      linked.forEach(l => {
        linkedProjectIds.add(l.project.id);
        // Add linked projects at top
        const option = document.createElement('option');
        option.value = l.project.id;
        option.textContent = `[已链接] ${l.project.name} (${l.project.type})`;
        select.appendChild(option);
      });
    } catch (e) {
      // No linked projects
    }

    // Add other projects
    projects.filter(p => p.id !== currentProject.id && !linkedProjectIds.has(p.id)).forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} (${p.type})`;
      select.appendChild(option);
    });
  } catch (e) {
    console.error('Failed to load projects:', e);
  }
}

async function sendCollabMessage() {
  if (!currentCollabReqId || !currentProject) return;

  const targetId = document.getElementById('collab-target-project').value;
  const msgType = document.getElementById('collab-message-type').value;
  const subject = document.getElementById('collab-message-subject').value.trim();
  const content = document.getElementById('collab-message-content').value.trim();
  const errorEl = document.getElementById('collab-message-error');

  if (!targetId) {
    errorEl.textContent = '请选择目标项目';
    errorEl.style.display = 'block';
    return;
  }
  if (!subject) {
    errorEl.textContent = '请填写主题';
    errorEl.style.display = 'block';
    return;
  }
  if (!content) {
    errorEl.textContent = '请填写详细内容';
    errorEl.style.display = 'block';
    return;
  }

  try {
    await api('POST', `/api/messages?source_project_id=${currentProject.id}&target_project_id=${targetId}&sender=${encodeURIComponent(currentProject.name)}&message_type=${msgType}&subject=${encodeURIComponent(subject)}&content=${encodeURIComponent(content)}&source_requirement_id=${currentCollabReqId}`);

    toast('协作消息已发送');
    closeCollabMessageModal();

    // Add to chat history
    const req = currentReqs.find(r => r.id === currentCollabReqId);
    const targetSelect = document.getElementById('collab-target-project');
    const targetName = targetSelect.options[targetSelect.selectedIndex].textContent;

    // Add system message to chat
    if (!chatHistories[currentCollabReqId]) chatHistories[currentCollabReqId] = [];
    chatHistories[currentCollabReqId].push({
      role: 'user',
      text: `[协作消息已发送给 ${targetName}]\n主题: ${subject}\n内容: ${content}`,
      fullText: `[协作消息已发送给 ${targetName}]\n主题: ${subject}\n内容: ${content}`,
      msgId: Date.now().toString()
    });
    loadReqs();
  } catch (e) {
    errorEl.textContent = '发送失败: ' + e.message;
    errorEl.style.display = 'block';
  }
}

// Filter functions
function showInbox() {
  loadAndRenderMessages('in');
}

function showOutbox() {
  loadAndRenderMessages('out');
}

async function loadAndRenderMessages(direction) {
  if (!currentProject) return;
  try {
    const data = await api('GET', `/api/messages?project_id=${currentProject.id}&direction=${direction}`);
    crossProjectMessagesCache = data || [];
    renderCrossProjectMessages();
  } catch (e) {
    toast('加载失败: ' + e.message);
  }
}

// Manual reconnect function
async function manualReconnect() {
  const pending = window.pendingReconnect;
  if (!pending) return toast('没有待重连的消息');

  const { reqId, fullMessage } = pending;
  if (!currentProject || chatLoadingState[reqId]) return;

  // Find the error message with reconnect button and remove it
  const history = chatHistories[reqId] || [];
  const lastIdx = history.length - 1;
  if (lastIdx >= 0 && history[lastIdx].role === 'claude' && history[lastIdx].text.includes('连接失败')) {
    chatHistories[reqId] = history.slice(0, lastIdx);
    // Remove the last bubble from DOM
    const container = document.getElementById(`chat-history-${reqId}`);
    if (container && container.lastElementChild) {
      container.lastElementChild.remove();
    }
  }

  chatLoadingState[reqId] = true;
  appendLoadingIndicator(reqId);
  scrollChatToBottom(reqId);
  setChatControlsEnabled(reqId, false);

  // Try WebSocket connection again
  let ws = null;
  let pingInterval = null;
  let connectionTimeout = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  let isResolved = false;
  let fullResponse = '';
  let hasReceivedData = false;

  const connectWebSocket = () => new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/agents/ws/chat/${encodeURIComponent(currentProject.id)}/${encodeURIComponent(reqId)}`;

    ws = new WebSocket(wsUrl);
    updateWsStatus(reqId, 'connecting');

    connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      reconnectAttempts = 0;
      updateWsStatus(reqId, 'connected');
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
      ws.send(JSON.stringify({ message: fullMessage }));
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.type === 'ping') return;
      hasReceivedData = true;

      if (data.type === 'partial') {
        fullResponse += data.data;
      } else if (data.type === 'done') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        removeLoadingIndicator(reqId);
        let displayText = fullResponse;
        if (data.usage) {
          const usage = data.usage;
          displayText += `\n\n---\n📊 Token消耗: 输入${usage.input_tokens} / 输出${usage.output_tokens} / 缓存${usage.cache_read_tokens} | 💰 $${usage.total_cost_usd.toFixed(6)}`;
        }
        chatHistories[reqId].push({ role: 'claude', text: displayText });
        appendChatBubble(reqId, 'claude', displayText);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        ws.close();
        resolve();
      } else if (data.type === 'error') {
        if (isResolved) return;
        isResolved = true;
        clearInterval(pingInterval);
        chatLoadingState[reqId] = false;
        removeLoadingIndicator(reqId);
        const errorMsg = `[错误: ${data.message}]`;
        chatHistories[reqId].push({ role: 'claude', text: errorMsg });
        appendChatBubble(reqId, 'claude', errorMsg);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        ws.close();
      }
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      if (isResolved || !chatLoadingState[reqId]) return;

      if (hasReceivedData && fullResponse) {
        isResolved = true;
        removeLoadingIndicator(reqId);
        chatHistories[reqId].push({ role: 'claude', text: fullResponse });
        chatLoadingState[reqId] = false;
        appendChatBubble(reqId, 'claude', fullResponse);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        updateWsStatus(reqId, 'idle');
        setChatControlsEnabled(reqId, true);
        resolve();
      } else if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
        updateWsStatus(reqId, 'reconnecting', reconnectAttempts);
        setTimeout(() => {
          if (chatLoadingState[reqId]) {
            connectWebSocket().then(resolve).catch(reject);
          }
        }, delay);
      } else {
        isResolved = true;
        chatLoadingState[reqId] = false;
        updateWsStatus(reqId, 'disconnected');
        removeLoadingIndicator(reqId);
        const errorMsg = `[连接失败，已达到最大重试次数 (${maxReconnectAttempts}次)]`;
        const bubbleHtml = errorMsg + '\n\n<button class="btn btn-primary" onclick="manualReconnect()" style="margin-top:8px">🔄 手动重连</button>';
        chatHistories[reqId].push({ role: 'claude', text: errorMsg });
        appendChatBubble(reqId, 'claude', bubbleHtml);
        scrollChatToBottom(reqId);
        saveWorklog(reqId);
        setChatControlsEnabled(reqId, true);
        resolve();
      }
    };

    ws.onerror = () => {
      clearInterval(pingInterval);
    };
  });

  try {
    await connectWebSocket();
  } catch (e) {
    if (!isResolved) {
      isResolved = true;
      removeLoadingIndicator(reqId);
      const errorMsg = `[错误: ${e.message}]`;
      chatHistories[reqId].push({ role: 'claude', text: errorMsg });
      chatLoadingState[reqId] = false;
      appendChatBubble(reqId, 'claude', errorMsg);
      scrollChatToBottom(reqId);
      saveWorklog(reqId);
      setChatControlsEnabled(reqId, true);
    }
  }
}
// ============================================
// Database Management
// ============================================

let dbConnections = [];
let currentDbConnection = null;
let currentDbDatabase = '';
let currentDbTable = '';

// Load database connections
async function loadDbConnections() {
  try {
    dbConnections = await api('GET', '/db/connections?project_id=' + (currentProject?.id || ''));
    renderDbConnections();
  } catch (e) {
    console.error('Failed to load DB connections:', e);
    dbConnections = [];
    renderDbConnections();
  }
}

function renderDbConnections() {
  const container = document.getElementById('db-connections-list');
  if (!container) return;

  if (!dbConnections.length) {
    container.innerHTML = '<p class="meta" style="font-size:13px">暂无数据库连接，点击"新建连接"添加</p>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  dbConnections.forEach(conn => {
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:14px;margin-bottom:4px">${escapeHtml(conn.name)}</div>
          <div class="meta" style="font-size:12px;color:var(--text-muted)">
            ${conn.host}:${conn.port}/${conn.database || '(no db)'} · ${escapeHtml(conn.username)}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-secondary" onclick="selectDbConnection('${conn.id}')" style="padding:4px 10px;font-size:12px">连接</button>
          <button class="btn btn-ghost" onclick="testDbConnectionById('${conn.id}')" style="padding:4px 10px;font-size:12px">测试</button>
          <button class="btn btn-ghost" onclick="deleteDbConnection('${conn.id}')" style="padding:4px 10px;font-size:12px;color:#dc2626">删除</button>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// Show create DB connection modal
function showCreateDbConnectionModal() {
  document.getElementById('db-conn-id').value = '';
  document.getElementById('db-conn-name').value = '';
  document.getElementById('db-conn-host').value = 'localhost';
  document.getElementById('db-conn-port').value = '3306';
  document.getElementById('db-conn-database').value = '';
  document.getElementById('db-conn-username').value = '';
  document.getElementById('db-conn-password').value = '';
  document.getElementById('db-conn-error').style.display = 'none';
  document.getElementById('db-connection-modal').classList.add('show');
}

function closeDbConnectionModal() {
  document.getElementById('db-connection-modal').classList.remove('show');
}

// Save DB connection
async function saveDbConnection() {
  const id = document.getElementById('db-conn-id').value;
  const name = document.getElementById('db-conn-name').value.trim();
  const host = document.getElementById('db-conn-host').value.trim() || 'localhost';
  const port = parseInt(document.getElementById('db-conn-port').value) || 3306;
  const database = document.getElementById('db-conn-database').value.trim();
  const username = document.getElementById('db-conn-username').value.trim();
  const password = document.getElementById('db-conn-password').value;

  const errorEl = document.getElementById('db-conn-error');

  if (!name) {
    errorEl.textContent = '请输入连接名称';
    errorEl.style.display = 'block';
    return;
  }
  if (!username) {
    errorEl.textContent = '请输入用户名';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const body = {
      name, host, port, database, username, password,
      project_id: currentProject?.id || null
    };

    if (id) {
      await api('PATCH', '/db/connections/' + id, body);
    } else {
      await api('POST', '/db/connections', body);
    }

    closeDbConnectionModal();
    await loadDbConnections();
    toast('连接已保存');
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = 'block';
  }
}

// Test DB connection
async function testDbConnection() {
  const host = document.getElementById('db-conn-host').value.trim() || 'localhost';
  const port = parseInt(document.getElementById('db-conn-port').value) || 3306;
  const database = document.getElementById('db-conn-database').value.trim();
  const username = document.getElementById('db-conn-username').value.trim();
  const password = document.getElementById('db-conn-password').value;
  const errorEl = document.getElementById('db-conn-error');

  if (!username) {
    errorEl.textContent = '请输入用户名';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const body = {
      name: 'temp',
      host, port, database, username, password,
      project_id: currentProject?.id || null
    };
    const result = await api('POST', '/db/connections', body);
    await api('DELETE', '/db/connections/' + result.id);
    errorEl.textContent = '连接成功！';
    errorEl.style.color = '#16a34a';
    errorEl.style.display = 'block';
    setTimeout(() => {
      errorEl.style.display = 'none';
      errorEl.style.color = '#dc2626';
    }, 2000);
  } catch (e) {
    errorEl.textContent = '连接失败: ' + e.message;
    errorEl.style.display = 'block';
  }
}

async function testDbConnectionById(connId) {
  try {
    const result = await api('POST', '/db/connections/' + connId + '/test');
    if (result.success) {
      toast(`连接成功！MySQL ${result.version}`);
    } else {
      toast('连接失败: ' + result.message);
    }
  } catch (e) {
    toast('测试失败: ' + e.message);
  }
}

// Delete DB connection
async function deleteDbConnection(connId) {
  if (!confirm('确定要删除这个连接吗？')) return;
  try {
    await api('DELETE', '/db/connections/' + connId);
    if (currentDbConnection === connId) {
      currentDbConnection = null;
      currentDbDatabase = '';
      document.getElementById('db-query-panel').classList.add('hidden');
    }
    await loadDbConnections();
    toast('连接已删除');
  } catch (e) {
    toast('删除失败: ' + e.message);
  }
}

// Select DB connection for querying
async function selectDbConnection(connId) {
  currentDbConnection = connId;
  const conn = dbConnections.find(c => c.id === connId);
  if (!conn) return;

  document.getElementById('db-current-connection').textContent = `当前连接: ${conn.name} (${conn.host}:${conn.port})`;
  document.getElementById('db-query-panel').classList.remove('hidden');

  await loadDbDatabases();

  if (conn.database) {
    currentDbDatabase = conn.database;
    document.getElementById('db-database-select').value = conn.database;
    await loadDbTables();
  }
}

// Load databases for current connection
async function loadDbDatabases() {
  if (!currentDbConnection) return;

  try {
    const databases = await api('GET', '/db/connections/' + currentDbConnection + '/databases');
    const select = document.getElementById('db-database-select');
    let html = '<option value="">选择数据库...</option>';
    databases.forEach(db => {
      if (db !== 'information_schema' && db !== 'mysql' && db !== 'performance_schema' && db !== 'sys') {
        html += `<option value="${escapeHtml(db)}" ${db === currentDbDatabase ? 'selected' : ''}>${escapeHtml(db)}</option>`;
      }
    });
    select.innerHTML = html;
  } catch (e) {
    console.error('Failed to load databases:', e);
  }
}

function onDbDatabaseChange() {
  currentDbDatabase = document.getElementById('db-database-select').value;
  loadDbTables();
}

// Load tables for current database
async function loadDbTables() {
  if (!currentDbConnection || !currentDbDatabase) {
    document.getElementById('db-tables-list').innerHTML = '<p class="meta" style="font-size:13px">请选择数据库</p>';
    return;
  }

  try {
    const tables = await api('GET', '/db/connections/' + currentDbConnection + '/tables?database=' + encodeURIComponent(currentDbDatabase));
    renderDbTables(tables);
  } catch (e) {
    document.getElementById('db-tables-list').innerHTML = '<p class="meta" style="font-size:13px;color:#dc2626">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

async function refreshDbTables() {
  await loadDbTables();
  toast('表列表已刷新');
}

function renderDbTables(tables) {
  const container = document.getElementById('db-tables-list');
  if (!tables || !tables.length) {
    container.innerHTML = '<p class="meta" style="font-size:13px">数据库为空</p>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:4px">';
  tables.forEach(table => {
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--surface)"
           onmouseover="this.style.background='var(--surface-hover)'" onmouseout="this.style.background='var(--surface)'"
           onclick="showDbTableStructure('${table.name}')"
           title="点击查看表结构">
        <span style="font-size:13px">${escapeHtml(table.name)}</span>
        <button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" onclick="event.stopPropagation();generateSelectSql('${table.name}')"
                title="生成 SELECT 语句">SELECT</button>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// Generate SELECT SQL for a table
function generateSelectSql(tableName) {
  const sql = `SELECT * FROM \`${tableName}\` LIMIT 100;`;
  document.getElementById('db-sql-input').value = sql;
}

// Show table structure modal
async function showDbTableStructure(tableName) {
  currentDbTable = tableName;
  document.getElementById('db-table-modal-title').textContent = '表结构: ' + tableName;

  try {
    const info = await api('GET', `/db/connections/${currentDbConnection}/tables/${tableName}?database=${encodeURIComponent(currentDbDatabase)}`);

    const infoHtml = `
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <span><strong>引擎:</strong> ${escapeHtml(info.engine || 'Unknown')}</span>
        <span><strong>行数:</strong> ${info.row_count || 'Unknown'}</span>
        <span><strong>字符集:</strong> ${escapeHtml(info.charset || 'Unknown')}</span>
      </div>
    `;
    document.getElementById('db-table-info').innerHTML = infoHtml;

    const columnsHtml = info.columns.map(col => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid var(--border);font-weight:500">${escapeHtml(col.Field)}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(col.Type)}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border)">${col.Null === 'YES' ? '是' : '否'}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(col.Key || '-')}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(col.Default !== null ? col.Default : 'NULL')}</td>
        <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(col.Extra || '-')}</td>
      </tr>
    `).join('');
    document.getElementById('db-table-columns').querySelector('tbody').innerHTML = columnsHtml;

    if (info.indexes && info.indexes.length) {
      const indexGroups = {};
      info.indexes.forEach(idx => {
        if (!indexGroups[idx.Key_name]) {
          indexGroups[idx.Key_name] = { unique: !idx.Non_unique, columns: [] };
        }
        indexGroups[idx.Key_name].columns.push(idx.Column_name);
      });

      const indexesHtml = Object.entries(indexGroups).map(([name, data]) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(name)}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${escapeHtml(data.columns.join(', '))}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${data.unique ? 'BTREE' : 'BTREE'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${data.unique ? '是' : '否'}</td>
        </tr>
      `).join('');
      document.getElementById('db-table-indexes').querySelector('tbody').innerHTML = indexesHtml;
    } else {
      document.getElementById('db-table-indexes').querySelector('tbody').innerHTML = '<tr><td colspan="4" style="padding:8px;text-align:center">无索引</td></tr>';
    }

    document.getElementById('db-table-modal').classList.add('show');
  } catch (e) {
    toast('加载表结构失败: ' + e.message);
  }
}

function closeDbTableModal() {
  document.getElementById('db-table-modal').classList.remove('show');
}

// Execute SQL query
async function executeDbQuery() {
  const sql = document.getElementById('db-sql-input').value.trim();
  if (!sql) {
    toast('请输入 SQL 查询');
    return;
  }
  if (!currentDbConnection) {
    toast('请先选择数据库连接');
    return;
  }

  const statusEl = document.getElementById('db-query-status');
  const resultsTable = document.getElementById('db-query-results');

  statusEl.style.display = 'block';
  statusEl.innerHTML = '<span style="color:var(--text-muted)">执行中...</span>';

  try {
    const result = await api('POST', '/db/connections/' + currentDbConnection + '/query', { sql, limit: 1000 });

    statusEl.innerHTML = `
      <span style="color:#16a34a">✓</span>
      ${result.row_count} 行,
      ${result.execution_time_ms}ms
    `;

    if (result.columns && result.columns.length) {
      const headerHtml = result.columns.map(col => `<th style="padding:8px;border-bottom:2px solid var(--border);white-space:nowrap;font-weight:600">${escapeHtml(col)}</th>`).join('');
      resultsTable.querySelector('thead').innerHTML = '<tr>' + headerHtml + '</tr>';

      const rowsHtml = result.rows.map(row => {
        const cells = result.columns.map(col => {
          const val = row[col];
          const display = val === null ? '<span style="color:var(--text-muted);font-style:italic">NULL</span>' : escapeHtml(String(val));
          return `<td style="padding:8px;border-bottom:1px solid var(--border);max-width:300px;overflow:hidden;text-overflow:ellipsis">${display}</td>`;
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      resultsTable.querySelector('tbody').innerHTML = rowsHtml;
    } else {
      resultsTable.querySelector('thead').innerHTML = '<tr><th>查询成功 (无返回数据)</th></tr>';
      resultsTable.querySelector('tbody').innerHTML = '';
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:#dc2626">✗ ${escapeHtml(e.message)}</span>`;
    resultsTable.querySelector('thead').innerHTML = '<tr><th>查询失败</th></tr>';
    resultsTable.querySelector('tbody').innerHTML = '';
  }
}

// Update showProjectTab to include database tab
const originalShowProjectTab = showProjectTab;
showProjectTab = function(name) {
  if (name === 'database') {
    loadDbConnections();
  }
  return originalShowProjectTab(name);
};
// ============================================
// Agent Messages - Display AI agent communications
// ============================================

// Load agent messages for a requirement
async function loadAgentMessages(reqId) {
  if (!currentProject) return;

  const container = document.getElementById(`agent-messages-list-${reqId}`);
  const countEl = document.getElementById(`agent-msg-count-${reqId}`);

  if (!container || !countEl) return;

  try {
    const messages = await api('GET', `/agents/messages?project_id=${currentProject.id}&requirement_id=${reqId}&limit=50`);

    countEl.textContent = `${messages.length} 条消息`;

    if (!messages || !messages.length) {
      container.innerHTML = '<p class="meta" style="font-size:12px;color:var(--text-muted)">暂无智能体消息</p>';
      return;
    }

    // Sort by created_at ascending (oldest first)
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let html = '<div style="display:flex;flex-direction:column;gap:8px;">';

    messages.forEach(msg => {
      const typeColors = {
        review: { bg: '#fef3c7', border: '#f59e0b', icon: '🔍' },
        communication: { bg: '#dbeafe', border: '#3b82f6', icon: '💬' },
        decision: { bg: '#d1fae5', border: '#10b981', icon: '✓' },
        alert: { bg: '#fee2e2', border: '#ef4444', icon: '⚠️' },
        summary: { bg: '#f3e8ff', border: '#a855f7', icon: '📝' }
      };

      const style = typeColors[msg.message_type] || typeColors.communication;
      const time = new Date(msg.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      html += `
        <div style="padding:10px 12px;background:${style.bg};border:1px solid ${style.border};border-radius:8px;font-size:12px;"
             onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span>${style.icon}</span>
              <strong style="color:#374151">${escapeHtml(msg.sender)}</strong>
              ${msg.receiver ? `<span style="color:#6b7280">→ ${escapeHtml(msg.receiver)}</span>` : ''}
            </div>
            <span style="color:#9ca3af;font-size:11px">${time}</span>
          </div>
          <div style="font-weight:500;color:#1f2937;margin-bottom:4px;">${escapeHtml(msg.subject)}</div>
          <div style="color:#4b5563;white-space:pre-wrap;line-height:1.5;">${escapeHtml(msg.content)}</div>
          ${renderAgentMessageContext(msg)}
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Scroll to bottom to show latest
    const panel = document.getElementById(`agent-messages-${reqId}`);
    if (panel) panel.scrollTop = panel.scrollHeight;

  } catch (e) {
    console.error('Failed to load agent messages:', e);
    container.innerHTML = '<p class="meta" style="font-size:12px;color:#dc2626">加载失败: ' + escapeHtml(e.message) + '</p>';
  }
}

// Render context (files, issues, etc.)
function renderAgentMessageContext(msg) {
  if (!msg.context || Object.keys(msg.context).length === 0) return '';

  let html = '';

  // Files reviewed
  if (msg.context.files_reviewed && msg.context.files_reviewed.length) {
    html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.1);">';
    html += '<span style="color:#6b7280;font-size:11px;">审核文件:</span> ';
    html += msg.context.files_reviewed.map(f => `<span style="background:rgba(0,0,0,0.05);padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(f)}</span>`).join(' ');
    html += '</div>';
  }

  // Verdict
  if (msg.context.verdict) {
    const verdictColors = {
      approved: { bg: '#d1fae5', color: '#065f46' },
      needs_fix: { bg: '#fef3c7', color: '#92400e' },
      rejected: { bg: '#fee2e2', color: '#991b1b' }
    };
    const v = verdictColors[msg.context.verdict] || verdictColors.needs_fix;
    html += `<div style="margin-top:6px;display:inline-block;padding:3px 10px;background:${v.bg};color:${v.color};border-radius:4px;font-size:11px;font-weight:500;">`;
    html += msg.context.verdict === 'approved' ? '✓ 审核通过' :
            msg.context.verdict === 'rejected' ? '✗ 审核未通过' : '⚠ 需要修改';
    html += '</div>';
  }

  // Issues found
  if (msg.context.issues_found && msg.context.issues_found.length) {
    html += '<div style="margin-top:8px;padding:8px;background:rgba(239,68,68,0.05);border-radius:6px;">';
    html += '<div style="color:#991b1b;font-size:11px;font-weight:500;margin-bottom:4px;">发现的问题:</div>';
    html += '<ul style="margin:0;padding-left:16px;color:#7f1d1d;font-size:11px;">';
    msg.context.issues_found.forEach(issue => {
      html += `<li>${escapeHtml(issue.description || JSON.stringify(issue))}</li>`;
    });
    html += '</ul></div>';
  }

  // Related files
  if (msg.context.related_files && msg.context.related_files.length) {
    html += '<div style="margin-top:8px;">';
    html += '<span style="color:#6b7280;font-size:11px;">相关文件:</span> ';
    html += msg.context.related_files.map(f => `<span style="font-size:11px;color:#4b5563;">${escapeHtml(f)}</span>`).join(', ');
    html += '</div>';
  }

  return html;
}

// Create a review message programmatically (for testing/demo)
async function createAgentReviewMessage(reqId, reviewData) {
  if (!currentProject) return;

  try {
    await api('POST', '/agents/messages/review', {
      project_id: currentProject.id,
      requirement_id: reqId,
      reviewer: reviewData.reviewer || 'PM Agent',
      subject: reviewData.subject || '代码审核报告',
      review_content: reviewData.content,
      files_reviewed: reviewData.files || [],
      issues_found: reviewData.issues || [],
      verdict: reviewData.verdict || 'needs_fix'
    });

    // Reload messages
    await loadAgentMessages(reqId);
  } catch (e) {
    console.error('Failed to create review message:', e);
  }
}

// Poll for new agent messages
let agentMessageIntervals = {};

function startAgentMessagePolling(reqId) {
  // Stop existing polling
  if (agentMessageIntervals[reqId]) {
    clearInterval(agentMessageIntervals[reqId]);
  }

  // Load immediately
  loadAgentMessages(reqId);

  // Poll every 10 seconds
  agentMessageIntervals[reqId] = setInterval(() => {
    if (activeChatReqId === reqId) {
      loadAgentMessages(reqId);
    }
  }, 10000);
}

function stopAgentMessagePolling(reqId) {
  if (agentMessageIntervals[reqId]) {
    clearInterval(agentMessageIntervals[reqId]);
    delete agentMessageIntervals[reqId];
  }
}

// Hook into toggleChat to load agent messages
const originalToggleChat = toggleChat;
toggleChat = async function(reqId) {
  const wasOpen = activeChatReqId === reqId;

  // Call original
  const result = await originalToggleChat(reqId);

  // Start or stop polling
  if (!wasOpen) {
    startAgentMessagePolling(reqId);
  } else {
    stopAgentMessagePolling(reqId);
  }

  return result;
};

// Also load on initial render
const originalRenderChatRow = renderChatRow;
renderChatRow = function(reqId) {
  // Start polling when chat row is rendered open
  if (activeChatReqId === reqId) {
    startAgentMessagePolling(reqId);
  }
  return originalRenderChatRow(reqId);
};
// ============================================
// SQL Editor with Ace Editor and Smart Hints
// ============================================

let dbSqlEditor = null;
let dbTableCompletions = [];

function initDbSqlEditor() {
  if (dbSqlEditor || !window.ace) return;

  const editorDiv = document.getElementById('db-sql-editor');
  if (!editorDiv) return;

  dbSqlEditor = ace.edit('db-sql-editor');
  dbSqlEditor.setTheme('ace/theme/chrome');
  dbSqlEditor.session.setMode('ace/mode/mysql');

  dbSqlEditor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    showPrintMargin: false,
    highlightActiveLine: true,
    highlightGutterLine: true,
    fontSize: 13,
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
    minLines: 5,
    maxLines: 20,
  });

  const mysqlKeywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
    'DROP', 'ALTER', 'INDEX', 'VIEW', 'DATABASE', 'SHOW', 'DESCRIBE', 'DESC',
    'EXPLAIN', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS',
    'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING',
    'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'LIKE', 'BETWEEN',
    'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'IF', 'IFNULL', 'COALESCE', 'CAST', 'CONVERT',
    'NOW', 'CURDATE', 'CURTIME', 'DATE_FORMAT', 'STR_TO_DATE',
    'CONCAT', 'SUBSTRING', 'LENGTH', 'TRIM', 'UPPER', 'LOWER',
    'ABS', 'ROUND', 'CEILING', 'FLOOR', 'MOD',
    'AUTO_INCREMENT', 'PRIMARY', 'KEY', 'UNIQUE', 'FOREIGN', 'REFERENCES',
    'DEFAULT', 'COMMENT', 'ENGINE', 'CHARSET', 'COLLATE'
  ];

  const sqlSnippets = [
    { caption: 'SELECT', snippet: 'SELECT * FROM ${1:table} WHERE ${2:condition};', meta: 'snippet' },
    { caption: 'SELECT COUNT', snippet: 'SELECT COUNT(*) FROM ${1:table};', meta: 'snippet' },
    { caption: 'INSERT', snippet: 'INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values});', meta: 'snippet' },
    { caption: 'UPDATE', snippet: 'UPDATE ${1:table} SET ${2:column} = ${3:value} WHERE ${4:condition};', meta: 'snippet' },
    { caption: 'DELETE', snippet: 'DELETE FROM ${1:table} WHERE ${2:condition};', meta: 'snippet' },
    { caption: 'JOIN', snippet: 'SELECT * FROM ${1:table1} t1 JOIN ${2:table2} t2 ON t1.${3:col} = t2.${4:col};', meta: 'snippet' },
    { caption: 'LEFT JOIN', snippet: 'SELECT * FROM ${1:table1} t1 LEFT JOIN ${2:table2} t2 ON t1.${3:col} = t2.${4:col};', meta: 'snippet' },
    { caption: 'GROUP BY', snippet: 'SELECT ${1:col}, COUNT(*) FROM ${2:table} GROUP BY ${1:col};', meta: 'snippet' },
    { caption: 'ORDER BY', snippet: 'SELECT * FROM ${1:table} ORDER BY ${2:col} DESC;', meta: 'snippet' },
    { caption: 'LIMIT', snippet: 'SELECT * FROM ${1:table} LIMIT ${2:10};', meta: 'snippet' },
    { caption: 'CREATE TABLE', snippet: 'CREATE TABLE ${1:table} (\n  id INT PRIMARY KEY AUTO_INCREMENT,\n  ${2:name} VARCHAR(255),\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', meta: 'snippet' },
    { caption: 'ALTER TABLE', snippet: 'ALTER TABLE ${1:table} ADD COLUMN ${2:column} ${3:TYPE};', meta: 'snippet' },
    { caption: 'CREATE INDEX', snippet: 'CREATE INDEX idx_${1:name} ON ${2:table}(${3:column});', meta: 'snippet' },
    { caption: 'DROP TABLE', snippet: 'DROP TABLE IF EXISTS ${1:table};', meta: 'snippet' },
    { caption: 'SHOW TABLES', snippet: 'SHOW TABLES;', meta: 'snippet' },
    { caption: 'DESCRIBE', snippet: 'DESCRIBE ${1:table};', meta: 'snippet' },
    { caption: 'EXPLAIN', snippet: 'EXPLAIN SELECT * FROM ${1:table};', meta: 'snippet' },
  ];

  const customCompleter = {
    getCompletions: function(editor, session, pos, prefix, callback) {
      const completions = [];

      mysqlKeywords.forEach(kw => {
        completions.push({
          caption: kw,
          value: kw,
          meta: 'keyword',
          score: 100
        });
      });

      sqlSnippets.forEach(s => {
        completions.push({
          caption: s.caption,
          snippet: s.snippet,
          meta: s.meta,
          score: 90
        });
      });

      dbTableCompletions.forEach(item => {
        completions.push({
          caption: item.name,
          value: item.name,
          meta: item.type,
          score: 80,
          docText: item.doc || ''
        });
      });

      callback(null, completions);
    }
  };

  const langTools = ace.require('ace/ext/language_tools');
  if (langTools) {
    langTools.addCompleter(customCompleter);
  }

  dbSqlEditor.commands.addCommand({
    name: 'executeQuery',
    bindKey: { win: 'Ctrl-Enter', mac: 'Cmd-Enter' },
    exec: function(editor) {
      executeDbQuery();
    }
  });

  dbSqlEditor.commands.addCommand({
    name: 'formatQuery',
    bindKey: { win: 'Ctrl-Shift-F', mac: 'Cmd-Shift-F' },
    exec: function(editor) {
      formatSqlQuery();
    }
  });

  window.addEventListener('resize', () => {
    if (dbSqlEditor) dbSqlEditor.resize();
  });
}

async function updateDbCompletions() {
  if (!currentDbConnection || !currentDbDatabase) {
    dbTableCompletions = [];
    return;
  }

  try {
    const completions = [];
    const tables = await api('GET', `/db/connections/${currentDbConnection}/tables?database=${encodeURIComponent(currentDbDatabase)}`);

    tables.forEach(t => {
      completions.push({
        name: t.name,
        type: 'table',
        doc: `Table: ${t.name}`
      });

      api('GET', `/db/connections/${currentDbConnection}/tables/${t.name}?database=${encodeURIComponent(currentDbDatabase)}`)
        .then(info => {
          if (info.columns) {
            info.columns.forEach(col => {
              completions.push({
                name: `${t.name}.${col.Field}`,
                type: 'column',
                doc: `${t.name}.${col.Field} - ${col.Type}${col.Key === 'PRI' ? ' (PK)' : ''}${col.Key === 'MUL' ? ' (Index)' : ''}`
              });
              if (!completions.find(c => c.name === col.Field)) {
                completions.push({
                  name: col.Field,
                  type: 'column',
                  doc: `Column: ${col.Field} (${col.Type})`
                });
              }
            });
            dbTableCompletions = completions;
          }
        })
        .catch(() => {});
    });

    dbTableCompletions = completions;
  } catch (e) {
    console.error('Failed to update completions:', e);
  }
}

function formatSqlQuery() {
  if (!dbSqlEditor) return;

  let sql = dbSqlEditor.getValue();
  const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM'];

  sql = sql.replace(/\s+/g, ' ').trim();

  keywords.forEach(kw => {
    const regex = new RegExp(`\\s*\\b${kw}\\b`, 'gi');
    sql = sql.replace(regex, `\n${kw}`);
  });

  const lines = sql.split('\n');
  let inSelect = false;
  const formatted = lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return '';

    if (trimmed.match(/^SELECT\b/i)) {
      inSelect = true;
      return trimmed;
    }
    if (trimmed.match(/^(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|JOIN|LEFT|RIGHT|INNER|OUTER)\b/i)) {
      inSelect = false;
      return trimmed;
    }
    if (inSelect && trimmed.match(/^\w+\s*,?$/)) {
      return '    ' + trimmed;
    }
    return trimmed;
  }).filter(l => l).join('\n');

  dbSqlEditor.setValue(formatted, -1);
  dbSqlEditor.clearSelection();
}

const originalExecuteDbQuery = executeDbQuery;
executeDbQuery = async function() {
  if (!dbSqlEditor) {
    return originalExecuteDbQuery();
  }

  const sql = dbSqlEditor.getValue().trim();
  if (!sql) {
    toast('请输入 SQL 查询');
    return;
  }
  if (!currentDbConnection) {
    toast('请先选择数据库连接');
    return;
  }

  const statusEl = document.getElementById('db-query-status');
  const resultsTable = document.getElementById('db-query-results');

  statusEl.style.display = 'block';
  statusEl.innerHTML = '<span style="color:var(--text-muted)">执行中...</span>';

  try {
    const result = await api('POST', '/db/connections/' + currentDbConnection + '/query', { sql, limit: 1000 });

    statusEl.innerHTML = `
      <span style="color:#16a34a">✓</span>
      ${result.row_count} 行,
      ${result.execution_time_ms}ms
    `;

    if (result.columns && result.columns.length) {
      const headerHtml = result.columns.map(col => `<th style="padding:8px;border-bottom:2px solid var(--border);white-space:nowrap;font-weight:600">${escapeHtml(col)}</th>`).join('');
      resultsTable.querySelector('thead').innerHTML = '<tr>' + headerHtml + '</tr>';

      const rowsHtml = result.rows.map(row => {
        const cells = result.columns.map(col => {
          const val = row[col];
          const display = val === null ? '<span style="color:var(--text-muted);font-style:italic">NULL</span>' : escapeHtml(String(val));
          return `<td style="padding:8px;border-bottom:1px solid var(--border);max-width:300px;overflow:hidden;text-overflow:ellipsis">${display}</td>`;
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      resultsTable.querySelector('tbody').innerHTML = rowsHtml;
    } else {
      resultsTable.querySelector('thead').innerHTML = '<tr><th>查询成功 (无返回数据)</th></tr>';
      resultsTable.querySelector('tbody').innerHTML = '';
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:#dc2626">✗ ${escapeHtml(e.message)}</span>`;
    resultsTable.querySelector('thead').innerHTML = '<tr><th>查询失败</th></tr>';
    resultsTable.querySelector('tbody').innerHTML = '';
  }
};

const originalGenerateSelectSql = generateSelectSql;
generateSelectSql = function(tableName) {
  if (!dbSqlEditor) {
    const sql = `SELECT * FROM \`${tableName}\` LIMIT 100;`;
    alert('SQL: ' + sql + '\n\n(编辑器尚未初始化)');
    return;
  }
  const sql = `SELECT * FROM \`${tableName}\` LIMIT 100;`;
  dbSqlEditor.setValue(sql, -1);
  dbSqlEditor.focus();
  dbSqlEditor.clearSelection();
};

const originalSelectDbConnection = selectDbConnection;
selectDbConnection = async function(connId) {
  await originalSelectDbConnection(connId);
  setTimeout(() => {
    initDbSqlEditor();
    updateDbCompletions();
  }, 100);
};

const originalOnDbDatabaseChange = onDbDatabaseChange;
onDbDatabaseChange = function() {
  originalOnDbDatabaseChange();
  updateDbCompletions();
};

const originalRenderDbTables = renderDbTables;
renderDbTables = function(tables) {
  originalRenderDbTables(tables);
  updateDbCompletions();
};

// ============================================
// Chat File Upload - Drag & Drop + Paste
// ============================================

// Drag over handler - show visual feedback
function handleChatDragOver(e, reqId) {
  e.preventDefault();
  e.stopPropagation();

  const chatArea = document.getElementById(`chat-area-${reqId}`);
  if (chatArea && !chatArea.classList.contains('drag-over')) {
    chatArea.classList.add('drag-over');
    chatArea.style.border = '2px dashed var(--primary)';
    chatArea.style.background = 'rgba(99, 102, 241, 0.05)';

    // Add drop indicator if not exists
    let indicator = document.getElementById(`drop-indicator-${reqId}`);
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = `drop-indicator-${reqId}`;
      indicator.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--primary);
        color: white;
        padding: 20px 40px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 500;
        z-index: 100;
        pointer-events: none;
        box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
      `;
      indicator.innerHTML = '📁 释放文件以上传';
      chatArea.appendChild(indicator);
    }
  }
}

// Drag leave handler - remove visual feedback
function handleChatDragLeave(e, reqId) {
  e.preventDefault();
  e.stopPropagation();

  const chatArea = document.getElementById(`chat-area-${reqId}`);
  if (chatArea) {
    const rect = chatArea.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      chatArea.classList.remove('drag-over');
      chatArea.style.border = '';
      chatArea.style.background = '';

      const indicator = document.getElementById(`drop-indicator-${reqId}`);
      if (indicator) {
        indicator.remove();
      }
    }
  }
}

// Drop handler - process dropped files
function handleChatDrop(e, reqId) {
  e.preventDefault();
  e.stopPropagation();

  const chatArea = document.getElementById(`chat-area-${reqId}`);
  if (chatArea) {
    chatArea.classList.remove('drag-over');
    chatArea.style.border = '';
    chatArea.style.background = '';

    const indicator = document.getElementById(`drop-indicator-${reqId}`);
    if (indicator) {
      indicator.remove();
    }
  }

  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    addFilesToChat(reqId, files);
  }
}

// Paste handler - process pasted files or images
function handleChatPaste(e, reqId) {
  const items = e.clipboardData.items;
  const files = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        if (file.name === 'image.png' || file.name === '') {
          const ext = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
          const newFile = new File([file], `pasted-image-${timestamp}.${ext}`, { type: file.type });
          files.push(newFile);
        } else {
          files.push(file);
        }
      }
    }
  }

  if (files.length > 0) {
    e.preventDefault();
    addFilesToChat(reqId, files);
    toast(`已粘贴 ${files.length} 个文件`);
  }
}

// Add files to chat
function addFilesToChat(reqId, files) {
  chatFiles[reqId] = chatFiles[reqId] || [];

  for (const file of files) {
    chatFiles[reqId].push(file);
  }

  updateChatFileList(reqId);
  toast(`已添加 ${files.length} 个文件，共 ${chatFiles[reqId].length} 个`);
}

// Enhanced updateChatFileList with better preview
const originalUpdateChatFileList = updateChatFileList;
updateChatFileList = function(reqId) {
  const filesList = document.getElementById(`chat-files-${reqId}`);
  const files = chatFiles[reqId] || [];

  if (files.length === 0) {
    filesList.style.display = 'none';
    filesList.innerHTML = '';
    return;
  }

  filesList.style.display = 'block';
  filesList.innerHTML = files.map((file, index) => {
    let icon = '📄';
    if (file.type.startsWith('image/')) icon = '🖼️';
    else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|html|css|json|yaml|yml|sql)$/i)) icon = '📝';
    else if (file.type.startsWith('video/')) icon = '🎬';
    else if (file.type.startsWith('audio/')) icon = '🎵';
    else if (file.name.match(/\.(zip|rar|7z|tar|gz)$/i)) icon = '📦';

    let preview = '';
    if (file.type.startsWith('image/') && file.size < 5 * 1024 * 1024) {
      const url = URL.createObjectURL(file);
      preview = `<img src="${url}" style="max-width:60px;max-height:60px;border-radius:4px;margin-right:8px;object-fit:cover;" />`;
    }

    return `
      <div style="display:flex;align-items:center;padding:6px 0;font-size:13px;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='rgba(0,0,0,0.02)'" onmouseleave="this.style.background=''">
        ${preview}
        <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px;">
          ${icon} ${file.name} <span style="color:var(--text-muted);">(${formatFileSize(file.size)})</span>
        </span>
        <button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;flex-shrink:0;" onclick="removeChatFile('${reqId}', ${index})" title="删除">
          ✕
        </button>
      </div>
    `;
  }).join('');
};

// ============================================
// Project Message Template Management
// ============================================

let currentMessageTemplate = { fields: [] };

// Load message template for current project
async function loadMessageTemplate() {
  if (!currentProject) return;

  try {
    const template = await api('GET', `/messages/templates/${currentProject.id}`);
    // Ensure template has valid fields array
    if (template && Array.isArray(template.fields) && template.fields.length > 0) {
      currentMessageTemplate = template;
    } else {
      // Use default if API returns empty template
      currentMessageTemplate = { fields: getDefaultMessageFields() };
    }
    renderMessageTemplateFields();
    // Re-render work message form if chat is open
    if (activeChatReqId) {
      renderWorkMessageForm(activeChatReqId);
    }
  } catch (e) {
    console.error('Failed to load message template:', e);
    currentMessageTemplate = { fields: getDefaultMessageFields() };
    renderMessageTemplateFields();
    // Re-render work message form if chat is open
    if (activeChatReqId) {
      renderWorkMessageForm(activeChatReqId);
    }
  }
}

function getDefaultMessageFields() {
  return [
    {
      name: 'docking_doc',
      label: '对接文档',
      type: 'file',
      required: false,
      placeholder: '上传对接文档或从共享文档选择',
      options: []
    },
    {
      name: 'shared_docs',
      label: '共享文档',
      type: 'file',
      required: false,
      placeholder: '从共享目录选择文档',
      options: []
    },
    {
      name: 'route_id',
      label: '路由ID',
      type: 'text',
      required: false,
      placeholder: '例如: /api/users',
      options: []
    },
    {
      name: 'requirement',
      label: '需求',
      type: 'textarea',
      required: true,
      placeholder: '描述具体需求...',
      options: []
    }
  ];
}

function renderMessageTemplateFields() {
  const container = document.getElementById('message-template-fields');
  if (!container) return;

  const fields = currentMessageTemplate.fields || [];

  if (fields.length === 0) {
    container.innerHTML = '<p class="meta" style="font-size:13px;color:var(--text-muted)">暂无字段配置</p>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';

  fields.forEach((field, index) => {
    const typeLabels = {
      text: '单行文本',
      textarea: '多行文本',
      file: '文件上传',
      select: '下拉选择',
      number: '数字'
    };

    html += `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;"
           onmouseenter="this.style.background='var(--surface-hover)'" onmouseleave="this.style.background='var(--surface)'">
        <div style="flex:0 0 30px;text-align:center;color:var(--text-muted);font-size:12px;">${index + 1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;font-size:14px;color:var(--text);">${escapeHtml(field.label)}</div>
          <div style="font-size:12px;color:var(--text-muted);">
            ${escapeHtml(field.name)} · ${typeLabels[field.type] || field.type} ${field.required ? '· 必填' : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost" onclick="moveMessageTemplateField(${index}, -1)" ${index === 0 ? 'disabled' : ''} style="padding:4px 8px;font-size:12px;">↑</button>
          <button class="btn btn-ghost" onclick="moveMessageTemplateField(${index}, 1)" ${index === fields.length - 1 ? 'disabled' : ''} style="padding:4px 8px;font-size:12px;">↓</button>
          <button class="btn btn-ghost" onclick="deleteMessageTemplateField(${index})" style="padding:4px 8px;font-size:12px;color:#dc2626;">删除</button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

function addMessageTemplateField() {
  const nameInput = document.getElementById('new-field-name');
  const labelInput = document.getElementById('new-field-label');
  const typeSelect = document.getElementById('new-field-type');
  const requiredCheckbox = document.getElementById('new-field-required');

  const name = nameInput.value.trim();
  const label = labelInput.value.trim();
  const type = typeSelect.value;
  const required = requiredCheckbox.checked;

  if (!name || !label) {
    toast('请输入字段标识和显示名称');
    return;
  }

  // Validate name (only alphanumeric and underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    toast('字段标识只能包含字母、数字和下划线，且不能以数字开头');
    return;
  }

  // Check for duplicate names
  if (currentMessageTemplate.fields.some(f => f.name === name)) {
    toast('字段标识已存在');
    return;
  }

  currentMessageTemplate.fields.push({
    name,
    label,
    type,
    required,
    placeholder: '',
    options: type === 'select' ? ['选项1', '选项2'] : []
  });

  // Clear inputs
  nameInput.value = '';
  labelInput.value = '';
  typeSelect.value = 'text';
  requiredCheckbox.checked = false;

  renderMessageTemplateFields();
  saveMessageTemplate();
}

function deleteMessageTemplateField(index) {
  if (!confirm('确定要删除这个字段吗？')) return;
  currentMessageTemplate.fields.splice(index, 1);
  renderMessageTemplateFields();
  saveMessageTemplate();
}

function moveMessageTemplateField(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= currentMessageTemplate.fields.length) return;

  const temp = currentMessageTemplate.fields[index];
  currentMessageTemplate.fields[index] = currentMessageTemplate.fields[newIndex];
  currentMessageTemplate.fields[newIndex] = temp;

  renderMessageTemplateFields();
  saveMessageTemplate();
}

async function saveMessageTemplate() {
  if (!currentProject) return;

  try {
    await api('PUT', `/messages/templates/${currentProject.id}`, {
      fields: currentMessageTemplate.fields
    });
    toast('消息字段配置已保存');
    // Re-render work message form if chat is open
    if (activeChatReqId) {
      renderWorkMessageForm(activeChatReqId);
    }
  } catch (e) {
    toast('保存失败: ' + e.message);
  }
}

function resetMessageTemplate() {
  if (!confirm('确定要恢复默认配置吗？当前配置将被覆盖。')) return;

  currentMessageTemplate.fields = getDefaultMessageFields();
  renderMessageTemplateFields();
  saveMessageTemplate();
  // Re-render work message form if chat is open
  if (activeChatReqId) {
    renderWorkMessageForm(activeChatReqId);
  }
}

// Hook into loadProjectSettings to also load message template
const originalLoadProjectSettings = loadProjectSettings;
loadProjectSettings = async function() {
  await originalLoadProjectSettings();
  await loadMessageTemplate();
};

// ============================================
// Dynamic Work Message Form based on Template
// ============================================

let currentWorkMessageData = {}; // Store form data
let currentWorkMessageFiles = {}; // Store files for each field

// Render work message form based on template
function renderWorkMessageForm(reqId) {
  const container = document.getElementById(`work-message-form-${reqId}`);
  if (!container) {
    console.log('renderWorkMessageForm: container not found for reqId', reqId);
    return;
  }

  // Get template fields - ensure we have the latest
  let fields = (currentMessageTemplate && currentMessageTemplate.fields) || [];

  // Use default fields if empty
  if (fields.length === 0) {
    fields = getDefaultMessageFields();
    currentMessageTemplate = { fields: fields };
    console.log('renderWorkMessageForm: using default fields', fields.length);
  }

  console.log('renderWorkMessageForm: rendering', fields.length, 'fields for reqId', reqId);

  // Build form based on template
  let html = '<div style="display:flex;flex-direction:column;gap:10px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">';

  fields.forEach(field => {
    const value = currentWorkMessageData[field.name] || '';
    const requiredAttr = field.required ? 'required' : '';
    const placeholder = field.placeholder || '';

    html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
    html += `<label style="font-size:13px;font-weight:500;color:var(--text);">${escapeHtml(field.label)}${field.required ? '<span style="color:#dc2626;">*</span>' : ''}</label>`;

    switch (field.type) {
      case 'text':
        html += `<input type="text" id="work-field-${reqId}-${field.name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${requiredAttr} onchange="updateWorkMessageData('${field.name}', this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;">`;
        break;

      case 'textarea':
        html += `<textarea id="work-field-${reqId}-${field.name}" placeholder="${escapeHtml(placeholder)}" ${requiredAttr} onchange="updateWorkMessageData('${field.name}', this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;min-height:80px;resize:vertical;">${escapeHtml(value)}</textarea>`;
        break;

      case 'number':
        html += `<input type="number" id="work-field-${reqId}-${field.name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${requiredAttr} onchange="updateWorkMessageData('${field.name}', this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;">`;
        break;

      case 'select':
        html += `<select id="work-field-${reqId}-${field.name}" ${requiredAttr} onchange="updateWorkMessageData('${field.name}', this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);">`;
        html += `<option value="">请选择...</option>`;
        (field.options || []).forEach(opt => {
          const selected = value === opt ? 'selected' : '';
          html += `<option value="${escapeHtml(opt)}" ${selected}>${escapeHtml(opt)}</option>`;
        });
        html += `</select>`;
        break;

      case 'file': {
        const files = currentWorkMessageFiles[field.name] || [];
        const sharedContent = currentWorkMessageData[field.name] || '';
        html += `<div style="display:flex;flex-direction:column;gap:8px;">`;
        html += `<input type="file" id="work-field-${reqId}-${field.name}-input" style="display:none;" onchange="handleWorkMessageFileSelect('${reqId}', '${field.name}', this.files)">`;
        html += `<div style="display:flex;gap:8px;">`;
        html += `<button type="button" class="btn btn-secondary" onclick="document.getElementById('work-field-${reqId}-${field.name}-input').click()" style="align-self:flex-start;padding:6px 12px;font-size:12px;">📎 选择文件</button>`;
        html += `<button type="button" class="btn btn-secondary" onclick="showSharedDocSelector('${field.name.replace(/'/g, "\\'")}', '${reqId.replace(/'/g, "\\'")}')" style="padding:6px 12px;font-size:12px;">📂 从共享文档选择</button>`;
        html += `</div>`;

        if (files.length > 0) {
          html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
          files.forEach((file, idx) => {
            html += `<span style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:11px;">`;
            html += `📄 ${escapeHtml(file.name)} (${formatFileSize(file.size)})`;
            html += `<button type="button" onclick="removeWorkMessageFile('${field.name}', ${idx})" style="background:none;border:none;cursor:pointer;padding:0 2px;color:#dc2626;">✕</button>`;
            html += `</span>`;
          });
          html += `</div>`;
        }

        // Show shared docs paths if any (with delete button)
        if (sharedContent) {
          const sharedDocPaths = sharedContent.split('\n').filter(p => p.trim());
          if (sharedDocPaths.length > 0) {
            html += `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">`;
            html += `<span style="font-size:11px;color:var(--text-muted);font-weight:500;">已选共享文档路径:</span>`;
            html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
            sharedDocPaths.forEach(path => {
              const fileName = path.split('/').pop() || path;
              html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:12px;">`;
              html += `<span style="color:var(--text);word-break:break-all;" title="${escapeHtml(path)}">📄 ${escapeHtml(path)}</span>`;
              html += `<button type="button" onclick="removeSharedDoc('${field.name.replace(/'/g, "\\'")}', '${escapeHtml(path).replace(/'/g, "\\'")}')" style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:2px 6px;color:#dc2626;font-size:14px;line-height:1;" title="删除">✕</button>`;
              html += `</div>`;
            });
            html += `</div>`;
            html += `</div>`;
          }
        }

        html += `</div>`;
        break;
      }
    }

    html += `</div>`;
  });

  html += '</div>';
  // Add hidden textarea for sendWorkMessage to use
  html += `<textarea id="chat-input-${reqId}" style="display:none;"></textarea>`;
  container.innerHTML = html;
}

// Update form data when field changes
function updateWorkMessageData(fieldName, value) {
  currentWorkMessageData[fieldName] = value;
}

// Handle file selection for work message
function handleWorkMessageFileSelect(reqId, fieldName, files) {
  if (!files || files.length === 0) return;

  currentWorkMessageFiles[fieldName] = currentWorkMessageFiles[fieldName] || [];
  for (const file of files) {
    currentWorkMessageFiles[fieldName].push(file);
  }

  // Re-render to show files
  renderWorkMessageForm(reqId);
}

// Remove file from work message
function removeWorkMessageFile(fieldName, index) {
  if (currentWorkMessageFiles[fieldName]) {
    currentWorkMessageFiles[fieldName].splice(index, 1);
    const reqId = activeChatReqId;
    if (reqId) renderWorkMessageForm(reqId);
  }
}

// Compose message from form data
function composeWorkMessage() {
  let fields = (currentMessageTemplate && currentMessageTemplate.fields) || [];
  // Use default fields if empty
  if (fields.length === 0) {
    fields = getDefaultMessageFields();
  }

  let message = '';
  fields.forEach(field => {
    const value = currentWorkMessageData[field.name];
    const files = currentWorkMessageFiles[field.name] || [];

    if (field.type === 'file') {
      // Add local files info
      if (files.length > 0) {
        message += `${field.label} (本地文件):\n`;
        files.forEach(f => {
          message += `- ${f.name} (${formatFileSize(f.size)})\n`;
        });
        message += '\n';
      }
      // Add shared docs content (loaded when sending)
      const sharedContent = currentWorkMessageData[`${field.name}_content`];
      if (sharedContent) {
        message += `${field.label} (共享文档):\n${sharedContent}\n\n`;
      } else if (value && value.trim()) {
        // Fallback: show paths if content not loaded yet
        const paths = value.split('\n').filter(p => p.trim());
        if (paths.length > 0) {
          message += `${field.label} (共享文档路径):\n`;
          paths.forEach(p => {
            message += `- ${p}\n`;
          });
          message += '\n';
        }
      }
    } else if (value) {
      message += `${field.label}: ${value}\n\n`;
    }
  });

  return message.trim();
}

// Clear work message form
function clearWorkMessageForm() {
  currentWorkMessageData = {};
  currentWorkMessageFiles = {};
}

// Check if form is valid
function isWorkMessageFormValid() {
  let fields = (currentMessageTemplate && currentMessageTemplate.fields) || [];
  // Use default fields if empty
  if (fields.length === 0) {
    fields = getDefaultMessageFields();
  }

  return fields.every(field => {
    if (!field.required) return true;

    if (field.type === 'file') {
      const files = currentWorkMessageFiles[field.name] || [];
      return files.length > 0;
    } else {
      const value = currentWorkMessageData[field.name];
      return value && value.trim() !== '';
    }
  });
}

// Hook into toggleChat to render form
const originalToggleChatForTemplate = toggleChat;
toggleChat = async function(reqId) {
  const wasOpen = activeChatReqId === reqId;

  // Call original first (this creates the DOM)
  const result = await originalToggleChatForTemplate(reqId);

  // Load template and render form if opening
  if (!wasOpen) {
    // Always reload template to get latest config
    await loadMessageTemplate();
    // Wait for DOM to be fully ready using multiple checks
    const tryRender = (attempts = 0) => {
      const container = document.getElementById(`work-message-form-${reqId}`);
      if (container) {
        renderWorkMessageForm(reqId);
        loadAgentPresence(reqId);
      } else if (attempts < 50) {
        // Try again in 10ms, up to 500ms total
        setTimeout(() => tryRender(attempts + 1), 10);
      }
    };
    tryRender();
  } else {
    // Clear form data when closing
    clearWorkMessageForm();
  }

  return result;
};


// ============================================
// Send Work Message with Template
// ============================================

async function sendWorkMessage(reqId) {
  let fields = (currentMessageTemplate && currentMessageTemplate.fields) || [];
  // Use default fields if empty
  if (fields.length === 0) {
    fields = getDefaultMessageFields();
  }

  // Always use form-based message composition
  if (!isWorkMessageFormValid()) {
    toast('请填写所有必填字段');
    return;
  }

  // Load shared docs content before composing message
  await loadSharedDocsContentForSending(fields);

  const message = composeWorkMessage();
  if (!message) {
    toast('请填写消息内容');
    return;
  }

  const allFiles = [];
  fields.forEach(field => {
    if (field.type === 'file') {
      const files = currentWorkMessageFiles[field.name] || [];
      allFiles.push(...files);
    }
  });

  chatFiles[reqId] = allFiles;

  const textarea = document.getElementById(`chat-input-${reqId}`);
  if (textarea) {
    textarea.value = message;
  }

  await sendChat(reqId);

  clearWorkMessageForm();
  selectedSharedDocs = {}; // Clear selected shared docs
  // Use setTimeout to avoid race condition with toggleChat
  setTimeout(() => renderWorkMessageForm(reqId), 0);
}

// Load shared docs content for sending
async function loadSharedDocsContentForSending(fields) {
  for (const field of fields) {
    if (field.type === 'file') {
      const pathsStr = currentWorkMessageData[field.name] || '';
      const paths = pathsStr.split('\n').filter(p => p.trim());

      if (paths.length > 0) {
        const fileContents = [];
        for (const path of paths) {
          try {
            const data = await api('GET', `/files/shared?path=${encodeURIComponent(path)}`);
            if (data.type === 'file' && data.readable) {
              fileContents.push({
                path: path,
                name: data.name,
                content: data.content
              });
            }
          } catch (e) {
            console.error('Failed to load shared file:', path, e);
            fileContents.push({
              path: path,
              name: path.split('/').pop() || path,
              content: `[无法加载文件内容: ${e.message}]`
            });
          }
        }

        // Store content in a separate key for sending
        currentWorkMessageData[`${field.name}_content`] = fileContents.map(f =>
          `${f.name}:\n\`\`\`\n${f.content.substring(0, 5000)}${f.content.length > 5000 ? '\n...(truncated)' : ''}\n\`\`\``
        ).join('\n\n');
      }
    }
  }
}

// ============================================
// Shared Document Support for Work Messages
// ============================================

let sharedDocsCache = [];
let selectedSharedDocs = {}; // fieldName -> [file paths]

// Load shared documents list
async function loadSharedDocsList(path = '') {
  try {
    const data = await api('GET', `/files/shared?path=${encodeURIComponent(path)}`);
    if (data.type === 'directory') {
      sharedDocsCache = data.items || [];
      return data.items || [];
    }
    return [];
  } catch (e) {
    console.error('Failed to load shared docs:', e);
    return [];
  }
}

// Show shared document selector modal
async function showSharedDocSelector(fieldName, reqId) {
  selectedSharedDocs[fieldName] = selectedSharedDocs[fieldName] || [];

  // Create modal if not exists
  let modal = document.getElementById('shared-doc-selector-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shared-doc-selector-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:9999;';
    modal.innerHTML = `
      <div class="modal" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);max-width:700px;width:90%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;padding:0;box-shadow:var(--shadow);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:20px;border-bottom:1px solid var(--border);">
          <h3 style="margin:0;">选择共享文档</h3>
          <button class="btn btn-ghost" onclick="closeSharedDocSelector()" style="padding:4px 10px;">关闭</button>
        </div>
        <div id="shared-doc-selector-content" style="flex:1;overflow-y:auto;padding:20px;">
          <!-- Content will be loaded here -->
        </div>
        <div style="padding:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <span id="shared-doc-selected-count" style="font-size:13px;color:var(--text-muted);">已选择 0 个</span>
          <button class="btn btn-primary" onclick="confirmSharedDocSelection()">确认选择</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSharedDocSelector();
    });
  }

  modal.dataset.fieldName = fieldName;
  modal.dataset.reqId = reqId;
  modal.style.display = 'flex';

  // Load and render shared docs
  await renderSharedDocSelectorContent('');
}

// Render shared document selector content
async function renderSharedDocSelectorContent(currentPath) {
  const container = document.getElementById('shared-doc-selector-content');
  if (!container) {
    console.error('shared-doc-selector-content container not found');
    return;
  }

  const items = await loadSharedDocsList(currentPath);

  let html = '';

  // Breadcrumb
  const paths = currentPath.split('/').filter(p => p);
  html += '<div style="margin-bottom:16px;padding:10px 12px;background:var(--surface);border-radius:8px;font-size:13px;">';
  html += '<span style="cursor:pointer;color:var(--primary);" onclick="renderSharedDocSelectorContent(\'\')">根目录</span>';
  let accumPath = '';
  paths.forEach((p, i) => {
    accumPath += '/' + p;
    html += ' / ';
    html += `<span style="cursor:pointer;color:var(--primary);" onclick="renderSharedDocSelectorContent('${accumPath.substring(1)}')">${escapeHtml(p)}</span>`;
  });
  html += '</div>';

  if (items.length === 0) {
    html += '<p class="meta" style="text-align:center;padding:40px;">共享目录为空</p>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';

    // Directories first
    items.filter(item => item.is_dir).forEach(dir => {
      html += `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border-radius:8px;cursor:pointer;"
             onclick="renderSharedDocSelectorContent('${dir.path}')"
             onmouseenter="this.style.background='var(--surface-hover)'" onmouseleave="this.style.background='var(--surface)'">
          <span style="font-size:20px;">📁</span>
          <span style="flex:1;font-weight:500;">${escapeHtml(dir.name)}</span>
          <span style="color:var(--text-muted);font-size:12px;">打开</span>
        </div>
      `;
    });

    // Then files
    items.filter(item => !item.is_dir).forEach(file => {
      const isSelected = selectedSharedDocs[document.getElementById('shared-doc-selector-modal').dataset.fieldName]?.includes(file.path);
      const icon = getFileIconByName(file.name);
      html += `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border-radius:8px;cursor:pointer;"
             onclick="const cb = this.querySelector('input[type=checkbox]'); cb.checked = !cb.checked; toggleSharedDocSelection('${file.path}', cb.checked);"
             onmouseenter="this.style.background='var(--surface-hover)'" onmouseleave="this.style.background='var(--surface)'">
          <span style="font-size:20px;">${icon}</span>
          <span style="flex:1;pointer-events:none;">
            <div style="font-weight:500;">${escapeHtml(file.name)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${formatFileSize(file.size)}</div>
          </span>
          <input type="checkbox" ${isSelected ? 'checked' : ''}
                 onclick="event.stopPropagation(); toggleSharedDocSelection('${file.path}', this.checked);"
                 style="width:18px;height:18px;cursor:pointer;">
        </div>
      `;
    });

    html += '</div>';
  }

  container.innerHTML = html;
  updateSharedDocSelectedCount();
}

// Get file icon by name
function getFileIconByName(filename) {
  if (filename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return '🖼️';
  if (filename.match(/\.(txt|md)$/i)) return '📝';
  if (filename.match(/\.(js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|html|css|json|yaml|yml|sql)$/i)) return '💻';
  if (filename.match(/\.(pdf)$/i)) return '📕';
  if (filename.match(/\.(doc|docx)$/i)) return '📘';
  if (filename.match(/\.(xls|xlsx)$/i)) return '📗';
  if (filename.match(/\.(zip|rar|7z|tar|gz)$/i)) return '📦';
  return '📄';
}

// Toggle shared document selection
function toggleSharedDocSelection(path, selected) {
  const modal = document.getElementById('shared-doc-selector-modal');
  if (!modal) return;
  const fieldName = modal.dataset.fieldName;

  selectedSharedDocs[fieldName] = selectedSharedDocs[fieldName] || [];

  if (selected) {
    if (!selectedSharedDocs[fieldName].includes(path)) {
      selectedSharedDocs[fieldName].push(path);
    }
  } else {
    selectedSharedDocs[fieldName] = selectedSharedDocs[fieldName].filter(p => p !== path);
  }

  updateSharedDocSelectedCount();
}

// Update selected count display
function updateSharedDocSelectedCount() {
  const modal = document.getElementById('shared-doc-selector-modal');
  if (!modal) return;

  const fieldName = modal.dataset.fieldName;
  const count = (selectedSharedDocs[fieldName] || []).length;
  document.getElementById('shared-doc-selected-count').textContent = `已选择 ${count} 个`;
}

// Close shared document selector
function closeSharedDocSelector() {
  const modal = document.getElementById('shared-doc-selector-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Confirm shared document selection
async function confirmSharedDocSelection() {
  const modal = document.getElementById('shared-doc-selector-modal');
  const fieldName = modal.dataset.fieldName;
  const reqId = modal.dataset.reqId;

  const selectedPaths = selectedSharedDocs[fieldName] || [];

  // Store only file paths (not content) for display
  // Content will be loaded when sending the message
  currentWorkMessageData[fieldName] = selectedPaths.join('\n');

  // Update UI
  renderWorkMessageForm(reqId);

  closeSharedDocSelector();
  toast(`已选择 ${selectedPaths.length} 个共享文档`);
}

// Remove a shared doc from selection
function removeSharedDoc(fieldName, path) {
  if (selectedSharedDocs[fieldName]) {
    selectedSharedDocs[fieldName] = selectedSharedDocs[fieldName].filter(p => p !== path);
    // Update the stored paths
    currentWorkMessageData[fieldName] = selectedSharedDocs[fieldName].join('\n');
    const reqId = activeChatReqId;
    if (reqId) renderWorkMessageForm(reqId);
  }
}

// Also make shared doc functions available globally
window.renderSharedDocSelectorContent = renderSharedDocSelectorContent;
window.toggleSharedDocSelection = toggleSharedDocSelection;
window.confirmSharedDocSelection = confirmSharedDocSelection;
window.closeSharedDocSelector = closeSharedDocSelector;
window.showSharedDocSelector = showSharedDocSelector;
window.removeSharedDoc = removeSharedDoc;
window.loadSharedDocsContentForSending = loadSharedDocsContentForSending;

// ============================================
// Agent Participation (PM, CodeReviewer, Architect)
// ============================================

// Track agent participation state
let agentParticipationState = {}; // reqId -> { lastPmParticipated: timestamp, count: number }

// Trigger agent participation after user conversation
async function triggerAgentParticipation(reqId, userMessage, claudeResponse) {
  // Get active agents
  try {
    const agents = await api('GET', '/agents/presence');
    if (!agents || agents.length === 0) return;

    // Check for code changes in the response
    const hasCodeChanges = claudeResponse.includes('```') ||
                           claudeResponse.includes('git diff') ||
                           claudeResponse.includes('modified:') ||
                           claudeResponse.includes('diff --git') ||
                           claudeResponse.includes('@@ ') ||
                           /\.(py|js|ts|java|go|rs|cpp|c|h|jsx|tsx|vue|php|rb)\b/.test(claudeResponse) ||
                           claudeResponse.includes('class ') ||
                           claudeResponse.includes('function ') ||
                           claudeResponse.includes('def ') ||
                           claudeResponse.includes('const ') ||
                           claudeResponse.includes('let ') ||
                           claudeResponse.includes('var ');

    console.log('[Agent Participation] hasCodeChanges:', hasCodeChanges, 'response length:', claudeResponse.length);

    // Determine which agents should participate
    const participatingAgents = [];

    // CodeReviewer ALWAYS participates if there are code changes (no frequency limit)
    if (hasCodeChanges) {
      const reviewerAgent = agents.find(a => a.agent_name.includes('CodeReviewer') || a.agent_name.includes('代码审核'));
      if (reviewerAgent) {
        participatingAgents.push({ ...reviewerAgent, role: 'reviewer', priority: 1 });
      }
    }

    // Check if PM should participate (every 3 messages or 5 minutes)
    const now = Date.now();
    const state = agentParticipationState[reqId] || { lastPmParticipated: 0, count: 0 };
    state.count++;

    const pmAgent = agents.find(a => a.agent_name.includes('PM') || a.agent_name.includes('项目经理'));
    if (pmAgent && (state.count % 3 === 0 || now - state.lastPmParticipated >= 300000)) {
      participatingAgents.push({ ...pmAgent, role: 'pm', priority: 2 });
      state.lastPmParticipated = now;
    }
    agentParticipationState[reqId] = state;

    // Architect participates for design/architecture discussions
    const hasArchitectureDiscussion = userMessage.includes('设计') ||
                                       userMessage.includes('架构') ||
                                       userMessage.includes('design') ||
                                       userMessage.includes('architecture') ||
                                       claudeResponse.includes('设计') ||
                                       claudeResponse.includes('架构');
    if (hasArchitectureDiscussion) {
      const architectAgent = agents.find(a => a.agent_name.includes('Architect') || a.agent_name.includes('架构师'));
      if (architectAgent) {
        participatingAgents.push({ ...architectAgent, role: 'architect', priority: 3 });
      }
    }

    console.log('[Agent Participation] Triggering agents:', participatingAgents.map(a => a.agent_name));

    // Trigger each participating agent with a delay
    for (const agent of participatingAgents.sort((a, b) => a.priority - b.priority)) {
      setTimeout(() => {
        console.log(`[Agent Participation] Starting ${agent.agent_name} (${agent.role})...`);
        requestAgentParticipation(reqId, agent, userMessage, claudeResponse);
      }, agent.priority * 2000); // 2s delay between agents
    }
  } catch (e) {
    console.error('Failed to trigger agent participation:', e);
  }
}

// Request a specific agent to participate
async function requestAgentParticipation(reqId, agent, userMessage, claudeResponse) {
  try {
    // Update agent status to working
    await api('POST', '/agents/presence', {
      agent_name: agent.agent_name,
      project_id: currentProject?.id,
      status: 'working',
      current_req: reqId
    });

    // Build agent-specific prompt
    let agentPrompt = '';
    let agentTitle = '';

    switch (agent.role) {
      case 'pm':
        agentTitle = 'PM (项目经理)';
        agentPrompt = `你现在是项目经理(PM)，请 review 以下开发对话，提供你的专业意见。

Review 要点：
1. 需求理解是否正确？
2. 实现方案是否合理？
3. 是否有遗漏的风险或注意事项？
4. 下一步建议

【用户原始需求】: ${userMessage.substring(0, 500)}${userMessage.length > 500 ? '\n...(截断)' : ''}

【Claude 的回复】: ${claudeResponse.substring(0, 1000)}${claudeResponse.length > 1000 ? '\n...(截断)' : ''}

【重要】你必须回复 review 意见，格式如下：
📋 PM Review:
- 需求理解: [评估]
- 方案评价: [评估]
- 风险提醒: [风险点]
- 下一步: [建议]

请用中文回复。`;
        break;

      case 'reviewer':
        agentTitle = 'CodeReviewer (代码审核)';
        agentPrompt = `你现在是代码审核员(CodeReviewer)，必须对以下代码变更进行审核并给出报告。

审核要点：
1. 代码质量评估 - 代码是否清晰、可维护
2. 潜在问题或 bug - 是否有明显错误
3. 性能考虑 - 是否有性能隐患
4. 最佳实践建议 - 是否符合语言/框架规范

【代码变更内容】:
${claudeResponse.substring(0, 3000)}${claudeResponse.length > 3000 ? '\n\n...(内容已截断)' : ''}

【重要】你必须回复审核报告，格式如下：
🔍 Code Review 报告:
- 审核结果: [通过/需要修改]
- 发现问题: [列出发现的问题，如果没有则写"无"]
- 改进建议: [具体改进建议]
- 风险等级: [低/中/高]

请用中文回复。`;
        break;

      case 'architect':
        agentTitle = 'Architect (架构师)';
        agentPrompt = `你现在是架构师(Architect)，请评估以下设计方案。

评估要点：
1. 架构合理性 - 是否符合设计原则
2. 可扩展性考虑 - 是否能应对未来需求
3. 技术选型建议 - 技术栈是否合适
4. 潜在技术债务 - 是否有遗留问题

【设计讨论内容】: ${claudeResponse.substring(0, 2000)}${claudeResponse.length > 2000 ? '\n\n...(内容已截断)' : ''}

【重要】你必须回复架构评估报告，格式如下：
🏗️ Architecture 评估:
- 架构评价: [评估]
- 可扩展性: [评估]
- 技术选型: [建议]
- 技术债务: [风险提示]

请用中文回复。`;
        break;
    }

    // Show agent is thinking
    appendAgentThinkingBubble(reqId, agentTitle);
    scrollChatToBottom(reqId);

    // Call API to get agent response (handle SSE streaming)
    // Use a unique requirement ID for each agent to avoid session conflicts
    const agentReqId = reqId + '_agent_' + agent.role;
    const response = await fetch('/agents/chat?project_id=' + encodeURIComponent(currentProject.id) + '&requirement_id=' + encodeURIComponent(agentReqId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: agentPrompt })
    });

    if (!response.ok) {
      throw new Error('Agent API error: ' + response.status);
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let agentResponse = '';
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'stdout' && data.data) {
              agentResponse += data.data;
            } else if (data.type === 'done') {
              done = true;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    // Remove thinking bubble
    removeAgentThinkingBubble(reqId, agentTitle);

    console.log(`[Agent Participation] ${agentTitle} response:`, agentResponse ? agentResponse.substring(0, 200) + '...' : 'EMPTY');

    // Add agent response to chat
    if (agentResponse && agentResponse.trim()) {
      chatHistories[reqId].push({
        role: 'agent',
        agent_name: agentTitle,
        text: agentResponse
      });
      appendAgentChatBubble(reqId, agentTitle, agentResponse);
      scrollChatToBottom(reqId);
      saveWorklog(reqId);
    } else {
      // If no response, show a minimal feedback
      console.warn(`[Agent Participation] ${agentTitle} returned empty response`);
      const emptyResponseMsg = `[${agentTitle} 已完成审核，但未返回详细报告]`;
      appendAgentChatBubble(reqId, agentTitle, emptyResponseMsg);
      scrollChatToBottom(reqId);
    }

    // Update agent status back to idle
    await api('POST', '/agents/presence', {
      agent_name: agent.agent_name,
      project_id: currentProject?.id,
      status: 'idle'
    });

    // Refresh agent presence display
    loadAgentPresence(reqId);

  } catch (e) {
    console.error(`Agent ${agent.agent_name} participation failed:`, e);
    removeAgentThinkingBubble(reqId, agent.agent_name);

    // Reset agent status on error
    try {
      await api('POST', '/agents/presence', {
        agent_name: agent.agent_name,
        project_id: currentProject?.id,
        status: 'idle'
      });
    } catch (err) {
      // Ignore
    }
  }
}

// Append agent thinking bubble
function appendAgentThinkingBubble(reqId, agentName) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.id = `agent-thinking-${reqId}-${agentName.replace(/\s+/g, '-')}`;
  bubble.className = 'chat-bubble agent-thinking';
  bubble.style.cssText = 'background:#fef3c7;border-left:3px solid #f59e0b;';
  bubble.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;color:#92400e;font-size:13px;">
      <span class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></span>
      <span><strong>${escapeHtml(agentName)}</strong> 正在思考...</span>
    </div>
  `;
  container.appendChild(bubble);
}

// Remove agent thinking bubble
function removeAgentThinkingBubble(reqId, agentName) {
  const bubble = document.getElementById(`agent-thinking-${reqId}-${agentName.replace(/\s+/g, '-')}`);
  if (bubble) bubble.remove();
}

// Append agent chat bubble
function appendAgentChatBubble(reqId, agentName, text) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble agent';

  // Color code by agent type
  let borderColor = '#6b7280';
  let bgColor = '#f3f4f6';
  if (agentName.includes('PM')) { borderColor = '#22c55e'; bgColor = '#f0fdf4'; }
  else if (agentName.includes('CodeReviewer')) { borderColor = '#3b82f6'; bgColor = '#eff6ff'; }
  else if (agentName.includes('Architect')) { borderColor = '#a855f7'; bgColor = '#faf5ff'; }

  bubble.style.cssText = `background:${bgColor};border-left:3px solid ${borderColor};`;
  bubble.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:${borderColor};margin-bottom:4px;">${escapeHtml(agentName)}</div>
    <div style="color:#374151;white-space:pre-wrap;">${escapeHtml(text)}</div>
  `;
  container.appendChild(bubble);
}

window.triggerAgentParticipation = triggerAgentParticipation;
window.requestAgentParticipation = requestAgentParticipation;

// ============================================
// Agent Presence Management
// ============================================

async function loadAgentPresence(reqId) {
  try {
    const agents = await api('GET', '/agents/presence');
    renderAgentPresence(reqId, agents);
  } catch (e) {
    console.error('Failed to load agent presence:', e);
  }
}

function renderAgentPresence(reqId, agents) {
  const container = document.getElementById(`active-agents-${reqId}`);
  const listContainer = document.getElementById(`active-agents-list-${reqId}`);
  if (!container || !listContainer) return;

  // Always show the panel
  container.style.display = 'block';

  if (!agents || agents.length === 0) {
    listContainer.innerHTML = '<p style="font-size:12px;color:#6b7280;margin:0;">暂无智能体，点击"初始化"按钮注册默认智能体（PM、CodeReviewer、Architect）</p>';
    return;
  }

  let html = '';
  agents.forEach(agent => {
    const statusMap = {
      'idle': { color: '#22c55e', text: '空闲' },
      'working': { color: '#f59e0b', text: '工作中' },
      'done': { color: '#3b82f6', text: '已完成' },
      'error': { color: '#ef4444', text: '错误' }
    };
    const status = statusMap[agent.status] || { color: '#6b7280', text: '未知' };
    html += `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:#fff;border:1px solid #bbf7d0;border-radius:16px;font-size:12px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${status.color};"></span>
        <span style="font-weight:500;color:#166534;">${escapeHtml(agent.agent_name)}</span>
        <span style="color:#6b7280;font-size:11px;">${status.text}</span>
      </div>
    `;
  });

  listContainer.innerHTML = html;
}

async function refreshAgentPresence(reqId) {
  await loadAgentPresence(reqId);
  toast('智能体列表已刷新');
}

window.refreshAgentPresence = refreshAgentPresence;

async function registerDefaultAgents() {
  try {
    const result = await api('POST', '/agents/presence/register-default?project_id=' + encodeURIComponent(currentProject?.id || ''));
    toast(`已注册 ${result.registered} 个默认智能体`);
    return result;
  } catch (e) {
    console.error('Failed to register default agents:', e);
  }
}

window.registerDefaultAgents = registerDefaultAgents;
console.log('App version: 1775642879');

// ============================================
// Auto-render forms when DOM changes
// ============================================

const formRenderObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Check if this is a work message form container
        if (node.id && node.id.startsWith('work-message-form-')) {
          const reqId = node.id.replace('work-message-form-', '');
          if (reqId) {
            console.log('MutationObserver: rendering form for', reqId);
            renderWorkMessageForm(reqId);
            loadAgentPresence(reqId);
          }
        }
        // Also check children
        const forms = node.querySelectorAll ? node.querySelectorAll('[id^="work-message-form-"]') : [];
        forms.forEach(form => {
          const reqId = form.id.replace('work-message-form-', '');
          if (reqId) {
            console.log('MutationObserver: rendering form for', reqId);
            renderWorkMessageForm(reqId);
            loadAgentPresence(reqId);
          }
        });
      }
    }
  }
});

// Start observing when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    formRenderObserver.observe(document.body, { childList: true, subtree: true });
  });
} else {
  formRenderObserver.observe(document.body, { childList: true, subtree: true });
}

// ============================================
// Environment Configuration Functions
// ============================================

let currentEnvironment = 'default';
let projectEnvironments = {};

// Load environment configuration
async function loadEnvironmentConfig() {
  if (!currentProject) return;

  try {
    const project = await api('GET', '/projects/' + currentProject.id);
    projectEnvironments = {};

    // Parse environments from project
    if (project.environments) {
      project.environments.forEach(env => {
        projectEnvironments[env.name] = env;
      });
    }

    // Always have default environment
    if (!projectEnvironments['default']) {
      projectEnvironments['default'] = {
        name: 'default',
        runtime_versions: [],
        env_vars: {},
        build_dir: '',
        build_commands: [],
        active: true
      };
    }

    currentEnvironment = project.active_environment || 'default';

    renderEnvironmentSelector();
    renderEnvironmentForm(projectEnvironments[currentEnvironment]);
  } catch (e) {
    console.error('Failed to load environment config:', e);
    toast('加载环境配置失败');
  }
}

// Render environment selector dropdown
function renderEnvironmentSelector() {
  const selector = document.getElementById('env-selector');
  if (!selector) return;

  selector.innerHTML = Object.keys(projectEnvironments).map(name =>
    `\u003coption value="${name}" ${name === currentEnvironment ? 'selected' : ''}\u003e${name === 'default' ? '默认环境' : name}\u003c/option\u003e`
  ).join('');
}

// Render environment form
function renderEnvironmentForm(env) {
  if (!env) return;

  // Reset all fields
  document.getElementById('env-node-version').value = '';
  document.getElementById('env-python-version').value = '';
  document.getElementById('env-java-version').value = '';
  document.getElementById('env-node-default').checked = false;
  document.getElementById('env-python-default').checked = false;
  document.getElementById('env-java-default').checked = false;
  document.getElementById('env-build-dir').value = env.build_dir || '';

  // Set runtime versions
  if (env.runtime_versions) {
    env.runtime_versions.forEach(rv => {
      if (rv.runtime === 'node') {
        document.getElementById('env-node-version').value = rv.version;
        document.getElementById('env-node-default').checked = rv.default;
      } else if (rv.runtime === 'python') {
        document.getElementById('env-python-version').value = rv.version;
        document.getElementById('env-python-default').checked = rv.default;
      } else if (rv.runtime === 'java') {
        document.getElementById('env-java-version').value = rv.version;
        document.getElementById('env-java-default').checked = rv.default;
      }
    });
  }

  // Render build commands
  const buildCommandsContainer = document.getElementById('env-build-commands');
  if (buildCommandsContainer) {
    if (env.build_commands && env.build_commands.length > 0) {
      buildCommandsContainer.innerHTML = env.build_commands.map(cmd => `
        \u003cdiv class="form-row"\u003e
          \u003cinput type="text" value="${escapeHtml(cmd)}" placeholder="构建命令" style="flex:1"\u003e
          \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
        \u003c/div\u003e
      `).join('');
    } else {
      buildCommandsContainer.innerHTML = `
        \u003cdiv class="form-row"\u003e
          \u003cinput type="text" placeholder="构建命令 (例如: npm run build)" style="flex:1"\u003e
          \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
        \u003c/div\u003e
      `;
    }
  }

  // Render environment variables
  const envVarsContainer = document.getElementById('env-vars-list');
  if (envVarsContainer) {
    const envVars = env.env_vars || {};
    const entries = Object.entries(envVars);
    if (entries.length > 0) {
      envVarsContainer.innerHTML = entries.map(([key, value]) => `
        \u003cdiv class="form-row"\u003e
          \u003cinput type="text" value="${escapeHtml(key)}" placeholder="变量名 (KEY)" style="width:200px"\u003e
          \u003cinput type="text" value="${escapeHtml(value)}" placeholder="变量值 (VALUE)" style="flex:1"\u003e
          \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
        \u003c/div\u003e
      `).join('');
    } else {
      envVarsContainer.innerHTML = `
        \u003cdiv class="form-row"\u003e
          \u003cinput type="text" placeholder="变量名 (KEY)" style="width:200px"\u003e
          \u003cinput type="text" placeholder="变量值 (VALUE)" style="flex:1"\u003e
          \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
        \u003c/div\u003e
      `;
    }
  }

  // Show/hide delete button
  const deleteBtn = document.getElementById('btn-delete-env');
  if (deleteBtn) {
    deleteBtn.style.display = currentEnvironment === 'default' ? 'none' : 'inline-block';
  }
}

// Switch to a different environment
function switchEnvironment() {
  const selector = document.getElementById('env-selector');
  currentEnvironment = selector.value;
  renderEnvironmentForm(projectEnvironments[currentEnvironment]);
}

// Add new environment
function addNewEnvironment() {
  const name = prompt('输入新环境名称 (例如: staging, production):');
  if (!name || name.trim() === '') return;

  const trimmedName = name.trim();
  if (projectEnvironments[trimmedName]) {
    alert('环境名称已存在');
    return;
  }

  projectEnvironments[trimmedName] = {
    name: trimmedName,
    runtime_versions: [],
    env_vars: {},
    build_dir: '',
    build_commands: [],
    active: true
  };

  currentEnvironment = trimmedName;
  renderEnvironmentSelector();
  renderEnvironmentForm(projectEnvironments[trimmedName]);
  toast(`已创建环境: ${trimmedName}`);
}

// Delete current environment
async function deleteCurrentEnvironment() {
  if (currentEnvironment === 'default') {
    alert('不能删除默认环境');
    return;
  }

  if (!confirm(`确定要删除环境 "${currentEnvironment}" 吗？`)) return;

  try {
    await api('DELETE', `/projects/${currentProject.id}/environments/${currentEnvironment}`);
    delete projectEnvironments[currentEnvironment];
    currentEnvironment = 'default';
    renderEnvironmentSelector();
    renderEnvironmentForm(projectEnvironments['default']);
    toast('环境已删除');
  } catch (e) {
    console.error('Failed to delete environment:', e);
    toast('删除环境失败');
  }
}

// Set default runtime
function setDefaultRuntime(runtime) {
  // Uncheck other runtimes
  ['node', 'python', 'java'].forEach(r => {
    if (r !== runtime) {
      document.getElementById(`env-${r}-default`).checked = false;
    }
  });
}

// Add build command
function addBuildCommand() {
  const container = document.getElementById('env-build-commands');
  const div = document.createElement('div');
  div.className = 'form-row';
  div.innerHTML = `
    \u003cinput type="text" placeholder="构建命令" style="flex:1"\u003e
    \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
  `;
  container.appendChild(div);
}

// Add environment variable
function addEnvVar() {
  const container = document.getElementById('env-vars-list');
  const div = document.createElement('div');
  div.className = 'form-row';
  div.innerHTML = `
    \u003cinput type="text" placeholder="变量名 (KEY)" style="width:200px"\u003e
    \u003cinput type="text" placeholder="变量值 (VALUE)" style="flex:1"\u003e
    \u003cbutton class="btn btn-ghost" onclick="this.parentElement.remove()" style="color:#dc2626"\u003e删除\u003c/button\u003e
  `;
  container.appendChild(div);
}

// Browse build directory
function browseBuildDir() {
  const currentDir = document.getElementById('env-build-dir').value;
  const newDir = prompt('输入构建目录路径 (相对于项目根目录):', currentDir);
  if (newDir !== null) {
    document.getElementById('env-build-dir').value = newDir.trim();
  }
}

// Save environment configuration
async function saveEnvironmentConfig() {
  if (!currentProject) return;

  try {
    // Collect runtime versions
    const runtimeVersions = [];

    const nodeVersion = document.getElementById('env-node-version').value;
    if (nodeVersion) {
      runtimeVersions.push({
        runtime: 'node',
        version: nodeVersion,
        default: document.getElementById('env-node-default').checked
      });
    }

    const pythonVersion = document.getElementById('env-python-version').value;
    if (pythonVersion) {
      runtimeVersions.push({
        runtime: 'python',
        version: pythonVersion,
        default: document.getElementById('env-python-default').checked
      });
    }

    const javaVersion = document.getElementById('env-java-version').value;
    if (javaVersion) {
      runtimeVersions.push({
        runtime: 'java',
        version: javaVersion,
        default: document.getElementById('env-java-default').checked
      });
    }

    // Collect build commands
    const buildCommands = [];
    document.querySelectorAll('#env-build-commands .form-row input').forEach(input => {
      if (input.value.trim()) buildCommands.push(input.value.trim());
    });

    // Collect environment variables
    const envVars = {};
    document.querySelectorAll('#env-vars-list .form-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      if (inputs[0].value.trim()) {
        envVars[inputs[0].value.trim()] = inputs[1].value;
      }
    });

    // Build environment object
    const environment = {
      name: currentEnvironment,
      runtime_versions: runtimeVersions,
      env_vars: envVars,
      build_dir: document.getElementById('env-build-dir').value.trim(),
      build_commands: buildCommands,
      active: true
    };

    // Save to server
    await api('POST', `/projects/${currentProject.id}/environments`, environment);

    // Update active environment
    if (currentEnvironment !== 'default') {
      await api('POST', `/projects/${currentProject.id}/environments/${currentEnvironment}/activate`);
    }

    // Update local cache
    projectEnvironments[currentEnvironment] = environment;
    currentProject.environments = Object.values(projectEnvironments);
    currentProject.active_environment = currentEnvironment;

    toast('环境配置已保存');
  } catch (e) {
    console.error('Failed to save environment config:', e);
    toast('保存环境配置失败: ' + (e.message || '未知错误'));
  }
}

// Make functions available globally
window.loadEnvironmentConfig = loadEnvironmentConfig;
window.switchEnvironment = switchEnvironment;
window.addNewEnvironment = addNewEnvironment;
window.deleteCurrentEnvironment = deleteCurrentEnvironment;
window.setDefaultRuntime = setDefaultRuntime;
window.addBuildCommand = addBuildCommand;
window.addEnvVar = addEnvVar;
window.browseBuildDir = browseBuildDir;
window.saveEnvironmentConfig = saveEnvironmentConfig;
    
    const content = response.content || '{}\n';
    
    // Initialize Ace editor if not already
    if (!globalSettingsEditor) {
      const editorEl = document.getElementById('global-settings-editor');
      if (!editorEl) {
        throw new Error('Editor element not found');
      }
      
      globalSettingsEditor = ace.edit('global-settings-editor');
      globalSettingsEditor.setTheme('ace/theme/textmate');
      globalSettingsEditor.session.setMode('ace/mode/json');
      globalSettingsEditor.setOptions({
        fontSize: 14,
        showPrintMargin: false,
        tabSize: 2,
        useSoftTabs: true,
        minLines: 20,
        maxLines: 50
      });
    }
    
    globalSettingsEditor.setValue(content, -1);
    globalSettingsEditor.clearSelection();
    errorEl.style.display = 'none';
  } catch (e) {
    console.error('Failed to load global settings:', e);
    errorEl.textContent = '加载配置失败: ' + (e.message || '未知错误');
    errorEl.style.display = 'block';
  }
}

async function saveGlobalSettings() {
  if (!globalSettingsEditor) return;
  
  const content = globalSettingsEditor.getValue();
  const errorEl = document.getElementById('global-settings-error');
  
  // Validate JSON
  try {
    JSON.parse(content);
  } catch (e) {
    errorEl.textContent = 'JSON 格式错误: ' + e.message;
    errorEl.style.display = 'block';
    return;
  }
  
  try {
    const response = await api('POST', '/global-settings', { content });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    errorEl.style.display = 'none';
    toast('全局配置已保存到 ~/.claude/settings.json');
    closeGlobalSettingsModal();
  } catch (e) {
    console.error('Failed to save global settings:', e);
    errorEl.textContent = '保存失败: ' + (e.message || '未知错误');
    errorEl.style.display = 'block';
  }
}

// Make functions available globally
window.openGlobalSettingsModal = openGlobalSettingsModal;
window.closeGlobalSettingsModal = closeGlobalSettingsModal;
window.loadGlobalSettings = loadGlobalSettings;
window.saveGlobalSettings = saveGlobalSettings;
