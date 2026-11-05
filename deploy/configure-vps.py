from datetime import datetime, timezone
from pathlib import Path
import os
import re
import shutil
import subprocess
import time
import urllib.request


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)


api_env = Path('/opt/horm/api/.env')
tunnel_config = Path('/etc/cloudflared/config.yml')
backup = Path('/var/backups') / ('homr-faucet-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
shutil.copy2(api_env, backup / 'api.env')
shutil.copy2(tunnel_config, backup / 'cloudflared.yml')
os.chmod(backup / 'api.env', 0o600)

env_text = api_env.read_text()
match = re.search(r'^CORS_ORIGIN=(.*)$', env_text, re.MULTILINE)
old_origins = match.group(1).strip().strip('\"\'').split(',') if match else []
origins = list(dict.fromkeys([origin.strip().rstrip('/') for origin in old_origins if origin.strip()]
                           + ['https://homr.web.id', 'https://www.homr.web.id']))
setting = 'CORS_ORIGIN=' + ','.join(origins)
new_env = env_text[:match.start()] + setting + env_text[match.end():] if match else env_text.rstrip() + '\n' + setting + '\n'

tunnel_text = tunnel_config.read_text()
host = re.search(r'^(\s*)- hostname: api\.homr\.web\.id\s*$', tunnel_text, re.MULTILINE)
if not host:
    raise RuntimeError('The existing HOMR tunnel route was not found; no configuration was changed.')
new_tunnel = tunnel_text
if 'path: ^/faucet/.*$' not in tunnel_text:
    indent = host.group(1)
    route = f'{indent}- hostname: api.homr.web.id\n{indent}  path: ^/faucet/.*$\n{indent}  service: http://127.0.0.1:3001\n'
    new_tunnel = tunnel_text[:host.start()] + route + tunnel_text[host.start():]

try:
    api_env.write_text(new_env)
    os.chmod(api_env, 0o600)
    tunnel_config.write_text(new_tunnel)
    run('cloudflared', 'tunnel', 'ingress', 'validate')
    run('docker', 'restart', 'homr-api')
    for attempt in range(15):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4000/health', timeout=2) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError('API health check failed after restart.')
    run('systemctl', 'restart', 'cloudflared')
    run('systemctl', 'is-active', '--quiet', 'cloudflared')
except Exception:
    api_env.write_text(env_text)
    tunnel_config.write_text(tunnel_text)
    run('docker', 'restart', 'homr-api')
    run('systemctl', 'restart', 'cloudflared')
    raise RuntimeError(f'Configuration update failed and was rolled back. Backup: {backup}') from None

print(f'HOMR API CORS and faucet tunnel route updated. Backup: {backup}')
