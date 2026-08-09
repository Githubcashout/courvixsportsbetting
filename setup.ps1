# Courvix - one-command setup. Windows PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#
# Creates the GitHub repo, pushes this project, runs the iOS build, waits for
# it, and prints your AltStore source URL. Re-run any time to ship an update.
#
# You sign in to GitHub yourself in a browser - no credentials pass through
# this script.

param([string]$RepoName = "courvix")
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($m) { Write-Host ""; Write-Host $m -ForegroundColor White }
function Good($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host ""; Write-Host "  [x] $m" -ForegroundColor Red; Write-Host ""; exit 1 }

# 1. prerequisites
Step "1/6  Checking tools"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "git is not installed.  winget install --id Git.Git"
}
Good "git found"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Die "The GitHub CLI is not installed. It does the repo work for you.
     winget install --id GitHub.cli
   Close and reopen PowerShell, then run this again."
}
Good "gh found"
if (-not (Test-Path ".github/workflows/ios.yml")) {
  Die "Can't find .github\workflows\ios.yml - run this from inside the
   courvix-network folder, and make sure hidden files were unzipped
   (File Explorer > View > Hidden items)."
}
Good "project files present (including .github)"

# 2. github auth
Step "2/6  GitHub account"
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  A browser window will open so you can sign in to GitHub."
  Write-Host "  Your credentials go to GitHub, not to this script." -ForegroundColor DarkGray
  gh auth login --web --git-protocol https --scopes repo,workflow
  if ($LASTEXITCODE -ne 0) { Die "GitHub sign-in was cancelled." }
}
$User = (gh api user --jq .login).Trim()
Good "signed in as $User"

# 3. local git
Step "3/6  Preparing the repository"
if (-not (Test-Path ".git")) { git init -q; git branch -M main; Good "initialised a git repository" }
@"
node_modules/
ios/build/
ios/Payload/
ios/*.ipa
ios/Courvix.xcodeproj/
.DS_Store
"@ | Set-Content -Path ".gitignore" -Encoding UTF8
git add -A
git -c user.name="Courvix Setup" -c user.email="setup@courvix.local" commit -qm "Courvix $(Get-Date -Format yyyy-MM-dd)" 2>$null | Out-Null
Good "committed"

# 4. remote
Step "4/6  Publishing to GitHub"
gh repo view "$User/$RepoName" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Good "repo $User/$RepoName already exists"
  git remote get-url origin 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$User/$RepoName.git" }
  git push -q -u origin main
  if ($LASTEXITCODE -ne 0) { Die "Push failed. Try: git push -u origin main" }
  Good "pushed the latest code"
} else {
  Write-Host "  Creating $User/$RepoName as a PUBLIC repo."
  Write-Host "  Public is required: AltStore downloads without credentials, so it" -ForegroundColor DarkGray
  Write-Host "  cannot read a private repo. There are no secrets in this code." -ForegroundColor DarkGray
  gh repo create $RepoName --public --source=. --remote=origin --push
  if ($LASTEXITCODE -ne 0) { Die "Couldn't create the repo. If the name is taken: .\setup.ps1 -RepoName other-name" }
  Good "created and pushed"
}

$Vis = (gh repo view "$User/$RepoName" --json visibility --jq .visibility).Trim()
if ($Vis -ne "PUBLIC") {
  Warn "repo is $Vis - AltStore will not be able to download from it."
  Warn "fix: gh repo edit $User/$RepoName --visibility public --accept-visibility-change-consequences"
}

# 5. build
Step "5/6  Building the iOS app on GitHub's macOS runners"
Start-Sleep -Seconds 3
gh workflow run "Build iOS IPA" --repo "$User/$RepoName" 2>$null
if ($LASTEXITCODE -ne 0) {
  Warn "couldn't start the workflow automatically."
  Write-Host "  Open this and press Run workflow:"
  Write-Host "  https://github.com/$User/$RepoName/actions/workflows/ios.yml"
  Read-Host "  Press Enter once you've started it"
} else { Good "build started" }

Write-Host "  Waiting for the build (about 5 minutes). Ctrl-C is safe - it keeps running."
Start-Sleep -Seconds 8
$RunId = (gh run list --repo "$User/$RepoName" --workflow=ios.yml --limit 1 --json databaseId --jq '.[0].databaseId').Trim()
$BuildOk = $false
if ($RunId) {
  gh run watch $RunId --repo "$User/$RepoName" --exit-status
  $BuildOk = ($LASTEXITCODE -eq 0)
} else { Warn "couldn't find the run to watch; check Actions in your browser." }

# 6. result
Step "6/6  Result"
$Src = "https://raw.githubusercontent.com/$User/$RepoName/gh-pages/altstore-source.json"
if ($BuildOk) {
  Write-Host ""
  Write-Host "  Build succeeded." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Your AltStore source URL"
  Write-Host "  $Src" -ForegroundColor Cyan
  Write-Host ""
  try { Set-Clipboard -Value $Src; Good "copied to your clipboard" } catch {}
  Write-Host "  On your iPhone:"
  Write-Host "    AltStore > Browse > Sources > +  > paste > Add Source"
  Write-Host "    Open Courvix Network > tap FREE"
  Write-Host ""
  Write-Host "  Prefer the file? Download, unzip, open with AltStore:" -ForegroundColor DarkGray
  Write-Host "  https://github.com/$User/$RepoName/releases/latest"
} else {
  Write-Host ""
  Write-Host "  The build failed." -ForegroundColor Red
  Write-Host ""
  Write-Host "  See what went wrong:"
  Write-Host "    gh run view --repo $User/$RepoName --log-failed"
  Write-Host ""
  Write-Host "  Copy the red lines and send them to me - the Swift compile is the"
  Write-Host "  one step that couldn't be tested before you ran it."
  exit 1
}
Write-Host ""
Write-Host "  To ship an update later: change what you like, then run this again." -ForegroundColor DarkGray
Write-Host ""
