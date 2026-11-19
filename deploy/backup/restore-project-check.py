#!/usr/bin/env python3
"""Restore a trusted project archive into a NEW private test directory; execute nothing."""
import gzip, json, os, pathlib, shutil, sys, tarfile

def restore(archive, destination):
    root = pathlib.Path(destination)
    if root.exists():
        raise ValueError('Destination must be new')
    root.mkdir(mode=0o700)
    expanded = 0
    with gzip.open(archive, 'rb') as compressed:
        while True:
            block = compressed.read(65536)
            if not block: break
            expanded += len(block)
            if expanded > 600 * 1024 * 1024:
                raise ValueError('Expanded archive too large')
    total = count = entries = 0
    required = set()
    with tarfile.open(archive, 'r:gz') as source:
        for item in source:
            entries += 1
            if entries > 50000:
                raise ValueError('Too many entries')
            name = pathlib.PurePosixPath(item.name)
            if name.is_absolute() or '..' in name.parts or '\\' in item.name or '\x00' in item.name:
                raise ValueError('Unsafe archive path')
            target = root.joinpath(*name.parts)
            if item.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            if not item.isfile() or item.size < 0 or item.size > 64 * 1024 * 1024:
                raise ValueError('Unsupported archive entry')
            total += item.size
            if total > 512 * 1024 * 1024:
                raise ValueError('Project archive too large')
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as out, source.extractfile(item) as incoming:
                shutil.copyfileobj(incoming, out, length=65536)
            if target.stat().st_size != item.size:
                raise ValueError('Truncated archive entry')
            count += 1
            if name.name == 'package.json': required.add('package')
            if len(name.parts) >= 2 and name.parts[-2:] == ('prisma', 'schema.prisma'): required.add('schema')
    if required != {'package', 'schema'}:
        raise ValueError('Backend project files are missing')
    return {'projectFilesRestored': count, 'projectBytesRestored': total}

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3: raise ValueError('Expected archive and new destination')
        print(json.dumps(restore(sys.argv[1], sys.argv[2])))
    except Exception:
        print('Project restoration failed; no source or environment file was executed.', file=sys.stderr)
        sys.exit(1)
