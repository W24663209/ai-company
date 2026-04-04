#!/usr/bin/env python3
import os
import shutil

bash_profile = '''export NVM_DIR="/home/claudeuser/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export SDKMAN_DIR="/home/claudeuser/.sdkman"
[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ] && . "$SDKMAN_DIR/bin/sdkman-init.sh"
export PATH="$HOME/.local/bin:/home/claudeuser/.nvm/versions/node/v24.14.1/bin:/home/claudeuser/.sdkman/candidates/java/current/bin:/usr/local/bin:/usr/bin:/bin"
[ -f "/home/claudeuser/.bashrc" ] && . "/home/claudeuser/.bashrc"
'''

zprofile = '''export NVM_DIR="/home/claudeuser/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export SDKMAN_DIR="/home/claudeuser/.sdkman"
[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ] && . "$SDKMAN_DIR/bin/sdkman-init.sh"
export PATH="$HOME/.local/bin:/home/claudeuser/.nvm/versions/node/v24.14.1/bin:/home/claudeuser/.sdkman/candidates/java/current/bin:/usr/local/bin:/usr/bin:/bin"
'''

with open('/home/claudeuser/.bash_profile', 'w') as f:
    f.write(bash_profile)

with open('/home/claudeuser/.zprofile', 'w') as f:
    f.write(zprofile)

os.chown('/home/claudeuser/.bash_profile', 1000, 1000)
os.chown('/home/claudeuser/.zprofile', 1000, 1000)

shutil.copy('/home/claudeuser/.zprofile', '/home/claudeuser/.zshrc')
os.chown('/home/claudeuser/.zshrc', 1000, 1000)

# Create ~/.local/bin for quick commands
os.makedirs('/home/claudeuser/.local/bin', exist_ok=True)
os.chown('/home/claudeuser/.local', 1000, 1000)
os.chown('/home/claudeuser/.local/bin', 1000, 1000)

print("Shell config files created successfully")
