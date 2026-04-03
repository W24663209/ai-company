FROM python:3.14-slim

WORKDIR /app

# Install base system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    ca-certificates \
    unzip \
    zip \
    maven \
    && rm -rf /var/lib/apt/lists/*

# ------------------
# SDKMAN + JDK 11 & 17
# ------------------
ENV SDKMAN_DIR="/root/.sdkman"
RUN curl -s "https://get.sdkman.io" | bash
SHELL ["/bin/bash", "-c"]
RUN source "$SDKMAN_DIR/bin/sdkman-init.sh" \
    && sdk install java 11.0.25-tem \
    && sdk install java 17.0.13-tem
# Set default Java to 17
ENV JAVA_HOME="/root/.sdkman/candidates/java/current"
ENV PATH="$JAVA_HOME/bin:$PATH"

# ------------------
# NVM + Node 18/20/22/24
# ------------------
ENV NVM_DIR="/root/.nvm"
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN source "$NVM_DIR/nvm.sh" \
    && nvm install 18 \
    && nvm install 20 \
    && nvm install 22 \
    && nvm install 24 \
    && nvm alias default 24

# Expose default node binaries to PATH for non-bash processes (uvicorn etc.)
RUN NODE_VERSION=$(source "$NVM_DIR/nvm.sh" && nvm version 24) \
    && ln -s "$NVM_DIR/versions/node/$NODE_VERSION/bin/node" /usr/local/bin/node \
    && ln -s "$NVM_DIR/versions/node/$NODE_VERSION/bin/npm" /usr/local/bin/npm \
    && ln -s "$NVM_DIR/versions/node/$NODE_VERSION/bin/npx" /usr/local/bin/npx

# Enable corepack pnpm for every installed Node version so pnpm survives nvm switches
RUN bash -c 'source "$NVM_DIR/nvm.sh"; for v in 18 20 22 24; do nvm use "$v" && corepack enable; done'

# Install Claude Code CLI globally (use default Node) and symlink to /usr/local/bin
RUN source "$NVM_DIR/nvm.sh" \
    && npm install -g @anthropic-ai/claude-code \
    && CLAUDE_BIN=$(which claude) \
    && ln -sf "$CLAUDE_BIN" /usr/local/bin/claude

# Copy full application
COPY . .

# Install Python dependencies and the local package
RUN pip install --no-cache-dir -e "."

# Ensure persistent directories exist
RUN mkdir -p /app/data /app/workspace /app/shared /root/.claude

EXPOSE 8080

CMD ["uvicorn", "ai_company.api.server:app", "--host", "0.0.0.0", "--port", "8080"]
