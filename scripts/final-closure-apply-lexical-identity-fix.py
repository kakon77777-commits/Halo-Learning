#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one old block, found {count}')
    return text.replace(old, new, 1)


sw_path = Path('apps/extension/src/service-worker.js')
sw = sw_path.read_text(encoding='utf-8')
if "const lexicalVersion = context && context.lexicalVersion;" not in sw:
    sw = replace_once(
        sw,
        "        analysisKey: value.analysisKey,\n        phase,",
        "        analysisKey: Progressive.createAnalysisKey({\n          text: value.text,\n          languageMode: value.languageMode,\n          semanticVersion: value.semanticVersion,\n          grammarVersion: value.grammarVersion,\n          profileRevision: value.profileRevision,\n          lexicalVersion\n        }),\n        phase,",
        'service-worker truthful analysis key'
    )
    sw = replace_once(
        sw,
        "      if (message.type === 'HALO_DICTIONARY_STATUS') {\n        return statusWithNetworkActivity((await getContext()).status());\n      }",
        "      if (message.type === 'HALO_DICTIONARY_STATUS') {\n        const context = await getContext();\n        const lexicalVersion = context && context.lexicalVersion;\n        if (typeof lexicalVersion !== 'string' || lexicalVersion.length < 1 || lexicalVersion.length > 256 ||\n            !/^[A-Za-z0-9._:@-]+$/u.test(lexicalVersion)) {\n          throw new TypeError('lexical runtime identity is invalid');\n        }\n        return deepFreeze({\n          ...statusWithNetworkActivity(context.status()),\n          lexicalVersion\n        });\n      }",
        'service-worker dictionary identity status'
    )
    sw_path.write_text(sw, encoding='utf-8')

content_path = Path('apps/extension/src/content.js')
content = content_path.read_text(encoding='utf-8')
if "function lexicalVersionFromDictionaryStatus" not in content:
    anchor = "  function validateEnrichmentResponse(response, request, Contracts) {"
    helper = "  function lexicalVersionFromDictionaryStatus(status) {\n    const value = status && status.lexicalVersion;\n    if (typeof value !== 'string' || value.length < 1 || value.length > 256 ||\n        !/^[A-Za-z0-9._:@-]+$/u.test(value)) return null;\n    return value;\n  }\n\n  function resolveProgressiveAnalysisKeyModule(Progressive) {\n    if (Progressive && typeof Progressive.createAnalysisKey === 'function') return Progressive;\n    if (root.HaloProgressiveRuntime && typeof root.HaloProgressiveRuntime.createAnalysisKey === 'function') {\n      return root.HaloProgressiveRuntime;\n    }\n    if (typeof require === 'function') {\n      try {\n        const required = require('./shared/progressive-runtime');\n        if (required && typeof required.createAnalysisKey === 'function') return required;\n      } catch (_error) {}\n    }\n    return null;\n  }\n\n"
    content = replace_once(content, anchor, helper + "  function validateEnrichmentResponse(response, request, Contracts, Progressive) {", 'content identity helper/signature')
    content = replace_once(
        content,
        "    const schemaVersion = Contracts.SEMANTIC_SCHEMA_VERSION;\n    if (!response || typeof response !== 'object' || response.error ||",
        "    const keyModule = resolveProgressiveAnalysisKeyModule(Progressive);\n    if (!keyModule) throw new TypeError('canonical progressive analysis key module is required');\n    const schemaVersion = Contracts.SEMANTIC_SCHEMA_VERSION;\n    if (!response || typeof response !== 'object' || response.error ||",
        'content progressive validator requirement'
    )
    old = """        if (!expected || result.requestId !== request.requestId ||
            result.pageEpoch !== request.pageEpoch || result.rootRevision !== expected.rootRevision ||
            result.analysisKey !== expected.analysisKey || !['bootstrap', 'lexical'].includes(result.phase) ||
            result.lexicalVersion !== expected.lexicalVersion || typeof result.generatedAt !== 'string') return null;
"""
    new = """        if (!expected || result.requestId !== request.requestId ||
            result.pageEpoch !== request.pageEpoch || result.rootRevision !== expected.rootRevision ||
            !['bootstrap', 'lexical'].includes(result.phase) || typeof result.generatedAt !== 'string' ||
            typeof result.lexicalVersion !== 'string' || result.lexicalVersion.length < 1 ||
            result.lexicalVersion.length > 256 || !/^[A-Za-z0-9._:@-]+$/u.test(result.lexicalVersion)) return null;
        let expectedAnalysisKey = expected.analysisKey;
        if (result.phase === 'lexical') {
          if (result.lexicalVersion !== expected.lexicalVersion) return null;
        } else {
          expectedAnalysisKey = keyModule.createAnalysisKey({
            text: expected.text,
            languageMode: expected.languageMode,
            semanticVersion: expected.semanticVersion,
            grammarVersion: expected.grammarVersion,
            profileRevision: expected.profileRevision,
            lexicalVersion: result.lexicalVersion
          });
        }
        if (result.analysisKey !== expectedAnalysisKey) return null;
"""
    content = replace_once(content, old, new, 'content truthful bootstrap transition validation')
    content = replace_once(
        content,
        "        const validated = validateEnrichmentResponse(response, request, modules.Contracts);",
        "        const validated = validateEnrichmentResponse(response, request, modules.Contracts, modules.Progressive);",
        'content response validator call'
    )
    content = replace_once(
        content,
        "      const provider = Dictionary.createBootstrapDictionaryProvider();\n      const lexicalVersion = `${provider.id}@${provider.version}`;",
        "      const provider = Dictionary.createBootstrapDictionaryProvider();\n      let lexicalVersion = `${provider.id}@${provider.version}`;\n      const installedRuntime = root.chrome && root.chrome.runtime &&\n        typeof root.chrome.runtime.id === 'string' && root.chrome.runtime.id.length > 0;\n      if (installedRuntime) {\n        const dictionaryStatus = await root.chrome.runtime.sendMessage({ type: 'HALO_DICTIONARY_STATUS' });\n        const canonicalLexicalVersion = lexicalVersionFromDictionaryStatus(dictionaryStatus);\n        if (!canonicalLexicalVersion) throw new Error('Canonical lexical runtime identity is unavailable');\n        lexicalVersion = canonicalLexicalVersion;\n      }",
        'content lexical identity handshake'
    )
    content = replace_once(
        content,
        "    buildEnrichmentItems,\n    validateEnrichmentResponse,",
        "    buildEnrichmentItems,\n    lexicalVersionFromDictionaryStatus,\n    validateEnrichmentResponse,",
        'content identity helper export'
    )
    content_path.write_text(content, encoding='utf-8')

print('lexical identity patch applied or already present')
