from pathlib import Path


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return source.replace(old, new, 1)


path = Path('apps/extension/src/shared/runtime-shard-browser.js')
source = path.read_text(encoding='utf-8')

if 'function assertCanonicalRows(name, values)' not in source:
    old = """  function assertCanonical(name, values, comparator) {
    for (let index = 1; index < values.length; index += 1) {
      if (comparator(values[index - 1], values[index]) > 0) {
        fail('NON_CANONICAL_ORDER', `${name} is not canonical`);
      }
    }
  }
"""
    new = old + """
  function compareBytes(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  }

  function assertCanonicalRows(name, values) {
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
    source = replace_once(source, old, new, 'linear row validator helper')

    old = """    assertCanonical('shard glosses', raw.glosses, compareUtf8);
    assertCanonical('shard lexical rows', raw.lexicalRows, compareRows);
    assertCanonical('shard morphology rows', raw.morphologyRows, compareRows);
"""
    new = """    assertCanonical('shard glosses', raw.glosses, compareUtf8);
    assertCanonicalRows('shard lexical rows', raw.lexicalRows);
    assertCanonicalRows('shard morphology rows', raw.morphologyRows);
"""
    source = replace_once(source, old, new, 'linear row validator use')

path.write_text(source, encoding='utf-8', newline='\n')
