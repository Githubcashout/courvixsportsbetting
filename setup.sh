#!/usr/bin/env bash
# Courvix — one-command setup. macOS or Linux.
#
#   bash setup.sh
#
# Creates the GitHub repo, pushes this project, runs the iOS build, waits for
# it, and prints your AltStore source URL. Re-run it any time to ship an update.
#
# You log in to GitHub yourself in a browser window — no credentials pass
# through this script.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; OFF=$'\033[0m'
say()  { printf "%s\n" "$*"; }
step() { printf "\n${BOLD}%s${OFF}\n" "$*"; }
good() { printf "  ${GRN}✓${OFF} %s\n" "$*"; }
warn() { printf "  ${YEL}!${OFF} %s\n" "$*"; }
die()  { printf "\n  ${RED}✗ %s${OFF}\n\n" "$*"; exit 1; }

REPO_NAME="${1:-courvix}"

# ── 1. prerequisites ───────────────────────────────────────────────────────
step "1/6  Checking tools"

if ! command -v git >/dev/null 2>&1; then
  die "git is not installed.
     macOS:  xcode-select --install
     Linux:  sudo apt install git"
fi
good "git $(git --version | awk '{print $3}')"

if ! command -v gh >/dev/null 2>&1; then
  die "The GitHub CLI (gh) is not installed. It does the repo work for you.
     macOS:  brew install gh
     Linux:  see https://github.com/cli/cli#installation
   Then run this script again."
fi
good "gh $(gh --version | head -1 | awk '{print $3}')"

if [ ! -f .github/workflows/ios.yml ]; then
  die "Can't find .github/workflows/ios.yml — run this from inside the
   courvix-network folder, and make sure the hidden .github folder was unzipped.
   macOS: press Cmd Shift . in Finder to reveal hidden files."
fi
good "project files present (including .github)"

# ── 2. github auth ─────────────────────────────────────────────────────────
step "2/6  GitHub account"
if gh auth status >/dev/null 2>&1; then
  good "signed in as $(gh api user --jq .login 2>/dev/null || echo 'unknown')"
else
  say "  A browser window will open so you can sign in to GitHub."
  say "  ${DIM}Your credentials go to GitHub, not to this script.${OFF}"
  gh auth login --web --git-protocol https --scopes repo,workflow || die "GitHub sign-in was cancelled."
  good "signed in as $(gh api user --jq .login)"
fi
USER_LOGIN="$(gh api user --jq .login)"

# ── 3. local git ───────────────────────────────────────────────────────────
step "3/6  Preparing the repository"
if [ ! -d .git ]; then
  git init -q
  git branch -M main
  good "initialised a git repository"
fi

cat > .gitignore <<'EOF'
node_modules/
ios/build/
ios/Payload/
ios/*.ipa
ios/Courvix.xcodeproj/
.DS_Store
EOF

git add -A
if git diff --cached --quiet 2>/dev/null && git rev-parse HEAD >/dev/null 2>&1; then
  good "no changes to commit"
else
  git -c user.name="${GIT_AUTHOR_NAME:-Courvix Setup}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-setup@courvix.local}" \
      commit -qm "Courvix $(date +%Y-%m-%d)" || true
  good "committed $(git rev-list --count HEAD) revision(s)"
fi

# ── 4. remote ──────────────────────────────────────────────────────────────
step "4/6  Publishing to GitHub"
if gh repo view "$USER_LOGIN/$REPO_NAME" >/dev/null 2>&1; then
  good "repo $USER_LOGIN/$REPO_NAME already exists"
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/$USER_LOGIN/$REPO_NAME.git"
  git push -q -u origin main --force-with-lease 2>/dev/null \
    || git push -q -u origin main \
    || die "Push failed. Try: git push -u origin main"
  good "pushed the latest code"
else
  say "  Creating ${BOLD}$USER_LOGIN/$REPO_NAME${OFF} as a ${BOLD}public${OFF} repo."
  say "  ${DIM}Public is required: AltStore downloads without credentials, so it"
  say "  cannot read a private repo. There are no secrets in this code.${OFF}"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push \
    || die "Couldn't create the repo. If the name is taken, run: bash setup.sh some-other-name"
  good "created and pushed"
fi

# make sure the repo really is public — the source URL depends on it
VIS="$(gh repo view "$USER_LOGIN/$REPO_NAME" --json visibility --jq .visibility 2>/dev/null || echo UNKNOWN)"
if [ "$VIS" != "PUBLIC" ]; then
  warn "repo is $VIS — AltStore will not be able to download from it."
  warn "fix with: gh repo edit $USER_LOGIN/$REPO_NAME --visibility public --accept-visibility-change-consequences"
fi

# ── 5. build ───────────────────────────────────────────────────────────────
step "5/6  Building the iOS app on GitHub's macOS runners"
sleep 3   # give GitHub a moment to register the workflow on a fresh repo
if ! gh workflow run "Build iOS IPA" --repo "$USER_LOGIN/$REPO_NAME" 2>/dev/null; then
  warn "couldn't start the workflow automatically."
  say  "  Open this and press ${BOLD}Run workflow${OFF}:"
  say  "  https://github.com/$USER_LOGIN/$REPO_NAME/actions/workflows/ios.yml"
  say  ""
  read -r -p "  Press Enter once you've started it… " _
else
  good "build started"
fi

say "  Waiting for the build (about 5 minutes). Ctrl-C is safe — it keeps running."
sleep 8
RUN_ID="$(gh run list --repo "$USER_LOGIN/$REPO_NAME" --workflow=ios.yml --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
if [ -n "${RUN_ID:-}" ]; then
  gh run watch "$RUN_ID" --repo "$USER_LOGIN/$REPO_NAME" --exit-status
  BUILD_OK=$?
else
  warn "couldn't find the run to watch; check Actions in your browser."
  BUILD_OK=1
fi

# ── 6. result ──────────────────────────────────────────────────────────────
step "6/6  Result"
SRC="https://raw.githubusercontent.com/$USER_LOGIN/$REPO_NAME/gh-pages/altstore-source.json"

if [ "${BUILD_OK:-1}" -eq 0 ]; then
  printf "\n  ${GRN}${BOLD}Build succeeded.${OFF}\n\n"
  printf "  ${BOLD}Your AltStore source URL${OFF}\n"
  printf "  ${BOLD}%s${OFF}\n\n" "$SRC"
  command -v pbcopy >/dev/null 2>&1 && printf "%s" "$SRC" | pbcopy && good "copied to your clipboard"
  say "  On your iPhone:"
  say "    AltStore → Browse → Sources → +  → paste → Add Source"
  say "    Open ${BOLD}Courvix Network${OFF} → tap ${BOLD}FREE${OFF}"
  say ""
  say "  ${DIM}Prefer the file? Download it here, unzip, and open with AltStore:${OFF}"
  say "  https://github.com/$USER_LOGIN/$REPO_NAME/releases/latest"
else
  printf "\n  ${RED}${BOLD}The build failed.${OFF}\n\n"
  say "  See what went wrong:"
  say "    gh run view --repo $USER_LOGIN/$REPO_NAME --log-failed"
  say ""
  say "  Or open it in a browser:"
  say "  https://github.com/$USER_LOGIN/$REPO_NAME/actions"
  say ""
  say "  Copy the red lines and send them to me — the Swift compile is the one"
  say "  step that couldn't be tested before you ran it."
  exit 1
fi

say ""
say "  ${DIM}To ship an update later: change what you like, then run this again.${OFF}"
say ""
