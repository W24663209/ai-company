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

# Create non-root user for Claude Code
RUN useradd -m -s /bin/bash -u 1000 claudeuser && \
    chown -R claudeuser:claudeuser /app

# Setup SSH directory for non-root user
RUN mkdir -p /home/claudeuser/.ssh && \
    chown -R claudeuser:claudeuser /home/claudeuser/.ssh && \
    chmod 700 /home/claudeuser/.ssh

# Ensure persistent directories exist with proper permissions
RUN mkdir -p /app/data /app/workspace /app/shared /root/.claude && \
    chown -R claudeuser:claudeuser /app/data /app/workspace /app/shared

EXPOSE 8080

# Create entrypoint script to switch to non-root user
RUN echo '#!/bin/bash\n\
# Copy .claude config to claudeuser if exists\n\
if [ -d /root/.claude ] && [ ! -d /home/claudeuser/.claude ]; then\n\
    cp -r /root/.claude /home/claudeuser/\n\
    chown -R claudeuser:claudeuser /home/claudeuser/.claude\n\
fi\n\
# Copy .nvm to claudeuser if needed\n\
if [ -d /root/.nvm ] && [ ! -d /home/claudeuser/.nvm ]; then\n\
    cp -r /root/.nvm /home/claudeuser/\n\
    chown -R claudeuser:claudeuser /home/claudeuser/.nvm\n\
fi\n\
# Copy .sdkman to claudeuser if needed\n\
if [ -d /root/.sdkman ] && [ ! -d /home/claudeuser/.sdkman ]; then\n\
    cp -r /root/.sdkman /home/claudeuser/\n\
    chown -R claudeuser:claudeuser /home/claudeuser/.sdkman\n\
fi\n\
# Ensure PATH is set\n\
export PATH="/home/claudeuser/.nvm/versions/node/v24.14.1/bin:/home/claudeuser/.sdkman/candidates/java/current/bin:/usr/local/bin:/usr/bin:/bin"\n\
# Run as claudeuser\n\
exec su - claudeuser -c "cd /app && PATH=$PATH uvicorn ai_company.api.server:app --host 0.0.0.0 --port 8080"\n\
' > /entrypoint.sh && chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
