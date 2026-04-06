const API = '';

let projectsCache = [];
let currentProject = null;
let currentReqs = [];
let activeChatReqId = null;
let chatHistories = {}; // reqId -> [{role, text}]
let chatLoadingState = {}; // reqId -> boolean

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
        <td class="actions" style="padding-right:24px;width:200px">
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
      return `
        <div class="chat-bubble ${h.role === 'claude' ? 'claude' : 'user'}">
          <div class="label">${h.role === 'claude' ? 'Claude' : '你'}</div>
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
  return `
    <tr class="chat-panel-row">
      <td colspan="6" style="padding:0;border-bottom:none">
        <div class="chat-area" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;max-width:800px;margin:0 auto">
          <div class="chat-header">
            <strong>需求工作区</strong>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-secondary" onclick="showCollaborationModal('${reqId}')" style="font-size:12px;padding:4px 10px">协作消息</button>
              <button class="btn btn-ghost" onclick="closeChat()">收起</button>
            </div>
          </div>
          <div id="chat-history-${reqId}" class="chat-messages">
            ${bubbles}
            ${loadingBubble}
          </div>
          <div id="chat-files-${reqId}" class="chat-files-list" style="display:none;padding:8px 12px;background:#f8f9fa;border-top:1px solid var(--border);max-height:100px;overflow-y:auto;"></div>
          <div class="ws-status" id="ws-status-${reqId}" style="display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:12px;color:#666;background:#f8f9fa;border-top:1px solid var(--border);">
            <span class="ws-dot" id="ws-dot-${reqId}" style="width:8px;height:8px;border-radius:50%;background:#ccc;"></span>
            <span class="ws-text" id="ws-text-${reqId}">未连接</span>
          </div>
          <div class="chat-input-wrapper">
            <textarea id="chat-input-${reqId}" class="chat-input" placeholder="输入你要告诉 Claude 的内容，按 Enter 发送"></textarea>
            <input type="file" id="chat-file-${reqId}" style="display:none" onchange="handleChatFileSelect('${reqId}')" multiple>
            <button class="btn btn-ghost" onclick="document.getElementById('chat-file-${reqId}').click()" title="上传文件">📎</button>
            <button class="btn btn-primary" id="chat-send-btn-${reqId}" onclick="sendChat('${reqId}')">发送</button>
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
  }
  loadReqs();
  setTimeout(() => {
    const el = document.getElementById(`chat-input-${reqId}`);
    if (el) el.focus();
    // Auto scroll to bottom (latest message)
    scrollChatToBottom(reqId);
  }, 50);
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
        ws.close();
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

function scrollChatToBottom(reqId) {
  const container = document.getElementById(`chat-history-${reqId}`);
  if (container) container.scrollTop = container.scrollHeight;
}

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
let chatFiles = {}; // reqId -> [files]

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


function _doConnectTerminal() {
  document.getElementById('terminal-path').textContent = currentProject.path;

  if (terminalSocket) {
    terminalSocket.close();
  }

  const javaVer = document.getElementById('term-java').value || '';
  const nodeVer = document.getElementById('term-node').value || '';
  const qs = [];
  if (javaVer) qs.push('java_version=' + encodeURIComponent(javaVer));

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
    renderReqs();
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
