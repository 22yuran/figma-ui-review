#!/bin/zsh
set -euo pipefail
service_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
jev_node="$(command -v node || true)"
if [[ -z "$jev_node" ]]; then
  print '需要安装 Node.js 18 或更新版本。'
  exit 1
fi
"$jev_node" -e 'if (Number(process.versions.node.split(".")[0]) < 18) { console.error("需要 Node.js 18 或更新版本。"); process.exit(1); }'
python3 - "$service_dir" "$jev_node" <<'PY'
import os, pathlib, plistlib, shutil, sys
source, node = sys.argv[1:]
home = pathlib.Path.home()
target = home / 'Library/Application Support/UI Review'
target.mkdir(parents=True, exist_ok=True)
os.chmod(target, 0o700)
shutil.copyfile(pathlib.Path(source) / 'jev-review-server.cjs', target / 'jev-review-server.cjs')
os.chmod(target / 'jev-review-server.cjs', 0o600)
agents = home / 'Library/LaunchAgents'
agents.mkdir(parents=True, exist_ok=True)
plist = agents / 'local.ui-review.jev.plist'
with plist.open('wb') as f:
    plistlib.dump({'Label':'local.ui-review.jev',
        'ProgramArguments':[str(pathlib.Path(node).resolve()), str(target / 'jev-review-server.cjs')],
        'WorkingDirectory':str(target), 'RunAtLoad':True, 'KeepAlive':True,
        'ThrottleInterval':10,
        'StandardOutPath':str(target / 'jev-service.log'),
        'StandardErrorPath':str(target / 'jev-service-error.log')}, f)
os.chmod(plist, 0o600)
print('本机服务已安装，凭证配置保留在本机私有目录。')
PY
jev_user="$(id -u)"
if launchctl print "gui/$jev_user/local.ui-review.jev" >/dev/null 2>&1; then
  # Restart the registered service in place: bootout followed immediately by
  # bootstrap can race with launchd unloading the old registration.
  launchctl kickstart -k "gui/$jev_user/local.ui-review.jev"
else
  launchctl bootstrap "gui/$jev_user" "$HOME/Library/LaunchAgents/local.ui-review.jev.plist"
fi
"$jev_node" - <<'JS'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const r = await fetch('http://127.0.0.1:4320/health', { signal: AbortSignal.timeout(500) });
      const health = await r.json();
      if (r.ok && health.provider === 'jev') return;
    } catch (_) {}
    await delay(500);
  }
  console.error('Jev 服务尚未就绪，请检查本机服务日志。');
  process.exitCode = 1;
})();
JS
print 'Jev 服务已启动，并会在登录时自动启动。重新加载走查插件即可。'
