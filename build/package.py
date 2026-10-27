#!/usr/bin/env python3
"""Build a Mattermost upload bundle using only manifest-listed executables."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'plugin.json').read_text())
out = root / 'dist'
out.mkdir(exist_ok=True)
for platform, relative in manifest['server']['executables'].items():
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    goos, goarch = platform.split('-', 1)
    env = dict(os.environ, GOOS=goos, GOARCH=goarch, CGO_ENABLED='0')
    subprocess.run(['go', 'build', '-buildvcs=false', '-trimpath', '-ldflags=-s -w', '-o', str(target), './server'], cwd=root, env=env, check=True)
    target.chmod(0o755)
subprocess.run(['npm', 'run', 'build'], cwd=root / 'webapp', check=True)
filename = f"{manifest['id']}-{manifest['version']}.tar.gz"
bundle = out / filename
files = ['plugin.json', 'LICENSE', 'NOTICE', manifest['webapp']['bundle_path'], *manifest['server']['executables'].values()]
with tarfile.open(bundle, 'w:gz') as archive:
    for relative in files:
        archive.add(root / relative, arcname=f"{manifest['id']}/{relative}")
with tarfile.open(bundle, 'r:gz') as archive:
    names = set(archive.getnames())
    expected = {f"{manifest['id']}/{relative}" for relative in files}
    assert names == expected, (names, expected)
    for member in archive.getmembers():
        assert not member.issym() and not member.islnk() and '..' not in Path(member.name).parts
checksum = hashlib.sha256(bundle.read_bytes()).hexdigest()
(out / 'SHA256SUMS').write_text(f'{checksum}  {filename}\n')
print(f'{bundle}\nSHA256 {checksum}')
