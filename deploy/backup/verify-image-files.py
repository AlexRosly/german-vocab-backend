#!/usr/bin/env python3
"""Verify image references from a restored database against its restored project. Execute nothing."""
import hashlib, json, pathlib, re, sys

def verify(root, rows):
    root=pathlib.Path(root)
    if not root.is_dir() or not isinstance(rows,list) or len(rows)>50000: raise ValueError('Invalid image references')
    files={}
    for p in root.rglob('*.webp'):
        if p.parts[-3:-1] != ('storage','word-images'): continue
        files.setdefault(p.name,[]).append(p)
    for row in rows:
        key=row.get('key','');size=row.get('bytes');digest=row.get('sha256','')
        if not re.fullmatch(r'[a-f0-9-]{36}\.webp',key) or not re.fullmatch(r'[a-f0-9]{64}',digest) or type(size) is not int or not 0<size<=98304: raise ValueError('Invalid image reference')
        found=files.get(key,[])
        if len(found)!=1: raise ValueError('Referenced image missing or ambiguous')
        p=found[0]
        if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root.resolve()) or p.stat().st_size!=size: raise ValueError('Invalid stored image')
        if hashlib.sha256(p.read_bytes()).hexdigest()!=digest: raise ValueError('Image checksum mismatch')
    return {'imageFilesVerified':len(rows)}

if __name__=='__main__':
    try:
        if len(sys.argv)!=2: raise ValueError('Expected restored project directory')
        print(json.dumps(verify(sys.argv[1],json.load(sys.stdin))))
    except Exception:
        print('Image restoration verification failed; inspect the paired project/database backup.',file=sys.stderr)
        sys.exit(1)
