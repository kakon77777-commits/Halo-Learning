from pathlib import Path
import subprocess

BASE_SHA = 'b6cd8ccfd705563bad7dcea87900d50fa8ca0b80'
PATH = 'tests/browser-harness.test.js'

source = subprocess.check_output(
    ['git', 'show', f'{BASE_SHA}:{PATH}'],
    text=True,
    encoding='utf-8'
)
old = "measurements: { coldRequiredShardsP95Ms: 10, warmLookupP95Ms: 1, longTaskMaxMs: 0 },"
new = """measurements: {
        coldRequiredShardsP50Ms: 10,
        coldRequiredShardsP95Ms: 10,
        coldRequiredShardsMaxMs: 10,
        warmLookupP50Ms: 1,
        warmLookupP95Ms: 1,
        warmLookupMaxMs: 1,
        longTaskP50Ms: 0,
        longTaskP95Ms: 0,
        longTaskMaxMs: 0
      },"""
count = source.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one legacy measurement fixture, found {count}')
Path(PATH).write_text(source.replace(old, new, 1), encoding='utf-8', newline='\n')
