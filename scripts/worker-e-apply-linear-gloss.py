from pathlib import Path


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return source.replace(old, new, 1)


path = Path('apps/extension/src/shared/runtime-shard-browser.js')
source = path.read_text(encoding='utf-8')

if 'function assertCanonicalUtf8Strings(name, values)' not in source:
    old = """  function assertCanonicalRows(name, values) {
    if (values.length < 2) return;
    let previous = bytesFor(canonicalJson(values[0]));
    for (let index = 1; index < values.length; index += 1) {
      const current = bytesFor(canonicalJson(values[index]));
      if (compareBytes(previous, current) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
      previous = current;
    }
  }
"""
    new = old + """
  function assertCanonicalUtf8Strings(name, values) {
    if (values.length < 2) return;
    let previous = bytesFor(values[0]);
    for (let index = 1; index < values.length; index += 1) {
      const current = bytesFor(values[index]);
      if (compareBytes(previous, current) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
      previous = current;
    }
  }
"""
    source = replace_once(source, old, new, 'linear gloss helper')

    old = "    assertCanonical('shard glosses', raw.glosses, compareUtf8);"
    new = "    assertCanonicalUtf8Strings('shard glosses', raw.glosses);"
    source = replace_once(source, old, new, 'linear gloss validator use')

path.write_text(source, encoding='utf-8', newline='\n')
