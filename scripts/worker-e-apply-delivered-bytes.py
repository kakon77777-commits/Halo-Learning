from pathlib import Path

path = Path('apps/extension/src/shared/runtime-shard-browser.js')
source = path.read_text(encoding='utf-8')
old = "    const descriptorBytes = bytesFor(canonicalJson(raw)).length;"
new = "    const descriptorBytes = typeof serialized === 'string'\n      ? bytesFor(serialized.trim()).length\n      : bytesFor(canonicalJson(raw)).length;"
if new not in source:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'descriptor byte anchor: expected one, found {count}')
    source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8', newline='\n')
