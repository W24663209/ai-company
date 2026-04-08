# AI Company - 多智能体协作开发平台

基于 Claude Code 的多项目 AI 智能体协作平台，支持智能体间通信、代码审核、工作消息管理等功能。

## 核心特性

### 项目管理
- **多项目管理**：创建和管理多个软件项目，支持 Java/Node 等不同类型
- **需求管理**：每个项目可跟踪多条需求，支持状态（待办/进行中/已完成）和优先级设置
- **项目链接**：支持项目间关联，方便跨项目协作

### 智能体协作
- **多智能体展示**：工作区显示 PM（项目经理）、CodeReviewer（代码审核）、Architect（架构师）等智能体在线状态
- **智能体通信**：跨项目智能体通过共享目录（inbox/outbox）进行消息传递
- **代码审核**：支持发起代码审核请求，记录审核结果

### 工作消息系统
- **可配置表单**：支持自定义工作消息字段（文本、多行文本、文件、下拉选择、数字）
- **共享文档选择器**：从共享目录选择文件作为工作消息附件
- **文件上传**：支持本地文件上传到工作消息

### 实时通信
- **WebSocket 聊天**：与 Claude 实时对话，支持断线重连
- **Token 使用统计**：显示每次对话的输入/输出 token 数量和成本
- **流式响应**：防止网关超时，支持 SSE 流式输出

### 构建支持
- **Java 项目**：支持 JDK 11/17 + Maven 构建
- **Node 项目**：支持 npm/pnpm 构建

## 快速开始

### 1. 安装依赖

```bash
source .venv/bin/activate
pip install -e "."
```

### 2. 启动服务

```bash
# 使用 Docker Compose 启动完整环境
docker-compose up -d

# 或本地启动 API 服务
uvicorn ai_company.api.server:app --reload --port 8080
```

访问 `http://localhost:8080` 打开 Web 界面。

### 3. CLI 使用

```bash
python main.py --help

# 创建项目
python main.py project create demo --type java

# 查看项目列表
python main.py project list

# 添加需求
python main.py req add --project demo --title "初始化 Maven 项目"

# 查看需求列表
python main.py req list --project demo

# 执行构建
python main.py build java demo --jdk 17

# 启动 Claude 会话
python main.py agent run --project demo --requirement REQ_ID

# 发送/接收智能体消息
python main.py agent send --sender my_agent --msg '{"status":"done"}' --project demo
python main.py agent read --project demo
```

## 项目结构

```
ai_company/
├── core/          # 配置、模型、异常定义
├── cli/           # Typer 命令行接口
├── api/           # FastAPI 服务和路由
│   └── routers/   # 各模块路由（agents, projects, requirements, files, git 等）
├── services/      # 业务逻辑层
│   ├── claude_service.py          # Claude Code 集成
│   ├── project_message_template_service.py  # 工作消息模板
│   ├── agent_message_service.py   # 智能体消息
│   └── ...
└── adapters/      # 构建适配器（Java、Node）

frontend/          # Web 前端
├── app.js         # 主应用逻辑
└── index.html     # 页面模板
```

## 主要功能详解

### 工作区（Workspace）
工作区是主要的智能体协作界面：
- **智能体列表**：显示当前项目的在线智能体（PM、CodeReviewer、Architect 等）
- **需求卡片**：展示需求详情，点击进入聊天
- **工作消息表单**：根据项目配置动态生成的消息表单

### 工作消息配置
每个项目可独立配置工作消息字段：
1. 进入项目设置 → 工作消息配置
2. 添加字段：文本、多行文本、文件、下拉选择、数字
3. 设置字段是否必填
4. 保存后工作区自动生效

### 共享文档
- 共享目录位于 `data/shared/`
- 支持目录浏览和文件选择
- 可将共享文件作为工作消息附件

### 代码审核流程
1. Claude 完成代码修改后自动进行自查
2. 通过 API 提交审核记录
3. PM/CodeReviewer 智能体可查看审核结果

## 环境配置

复制 `.env.example` 为 `.env` 并调整配置：

```bash
# API 配置
ANTHROPIC_API_KEY=your_api_key
ANTHROPIC_BASE_URL=https://api.anthropic.com

# 或 OpenRouter
OPENROUTER_API_KEY=your_key

# 路径配置
AI_COMPANY_DATA_DIR=./data
```

## 系统要求

- Python >= 3.12
- Java 17（可选 Java 11）
- Maven
- Node.js + npm
- Claude Code CLI (`claude`)

## Docker 部署

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f api

# 重启服务
docker-compose restart
```

## 开发计划

- [x] 基础项目管理和需求跟踪
- [x] Claude Code 集成
- [x] WebSocket 实时聊天
- [x] 工作消息系统
- [x] 智能体在线显示
- [x] 代码审核功能
- [ ] 智能体自动调度
- [ ] 项目进度看板
- [ ] 多语言支持

## License

MIT
