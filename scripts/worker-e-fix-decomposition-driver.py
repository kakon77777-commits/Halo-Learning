from pathlib import Path

path = Path('scripts/worker-e-apply-decomposition.py')
source = path.read_text(encoding='utf-8')
old = '''    old = """  selectShardCandidate,
  verifyBrowserRuntimeProfile,
"""
    new = """  selectShardCandidate,
  summarizeShardColdDecomposition,
  verifyBrowserRuntimeProfile,
"""
'''
new = '''    old = """  selectShardCandidate,
  verifyBrowserShardComparison,
  writeShardSelectionAdr,
  verifyBrowserRuntimeProfile
"""
    new = """  selectShardCandidate,
  summarizeShardColdDecomposition,
  verifyBrowserShardComparison,
  writeShardSelectionAdr,
  verifyBrowserRuntimeProfile
"""
'''
if old in source:
    source = source.replace(old, new, 1)
elif 'summarizeShardColdDecomposition,' not in source:
    raise SystemExit('decomposition driver export anchor not found')
path.write_text(source, encoding='utf-8', newline='\n')
