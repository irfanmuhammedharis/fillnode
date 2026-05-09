#!/bin/bash
set -e

echo "=== Fillnode Setup Script ==="

FILLNODE_DIR="$HOME/Documents/webapplication/fillnode ai/fillnode"

# --- System packages ---
echo "[1/7] Installing system packages..."
sudo apt-get update
sudo apt-get install -y libffi-dev libyaml-dev libssl-dev zlib1g-dev build-essential \
  libreadline-dev libgdbm-dev libncurses-dev libpq-dev libsqlite3-dev \
  postgresql postgresql-client redis-server

# --- Start services ---
echo "[2/7] Starting PostgreSQL and Redis..."
sudo systemctl start postgresql || true
sudo systemctl start redis-server || true
sudo systemctl enable postgresql || true
sudo systemctl enable redis-server || true

# --- Create PostgreSQL user ---
echo "[3/7] Creating PostgreSQL user..."
sudo -u postgres psql -c "CREATE ROLE $(whoami) WITH SUPERUSER LOGIN;" 2>/dev/null || echo "User already exists or postgres not available"

# --- Install rbenv + Ruby ---
echo "[4/7] Installing Ruby 3.4.4..."
if [ ! -d "$HOME/.rbenv" ]; then
  git clone https://github.com/rbenv/rbenv.git ~/.rbenv
fi
if [ ! -d "$HOME/.rbenv/plugins/ruby-build" ]; then
  git clone https://github.com/rbenv/ruby-build.git ~/.rbenv/plugins/ruby-build
fi
export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"
rbenv install 3.4.4 --skip-existing
rbenv global 3.4.4

# --- Install nvm + Node.js ---
echo "[5/7] Installing Node.js 24.13.0..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24.13.0
nvm use 24.13.0
nvm alias default 24.13.0

# --- Install pnpm ---
echo "[6/7] Installing pnpm..."
npm install -g pnpm

# --- Install bundler + project dependencies ---
echo "[7/7] Installing project dependencies..."
cd "$FILLNODE_DIR"
gem install bundler
bundle install
pnpm install

# --- Setup .env and database ---
echo "=== Setting up database ==="
cp .env.example .env
RAILS_ENV=development bundle exec rails db:prepare

echo ""
echo "=== Setup complete! ==="
echo "Run: cd \"$FILLNODE_DIR\" && overmind start -f Procfile.dev"
echo "Or:  cd \"$FILLNODE_DIR\" && pnpm dev"
