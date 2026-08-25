# Lexical source exclusions — v0.2.0

## NTU Chinese Wordnet 2.0

Official site: https://lopentu.github.io/CwnWeb/

The resource is linguistically relevant and directly supports Traditional Chinese open-class POS, glosses, examples, and semantic relations. It is not selected for the Halo Learning product release because the official terms state academic-research-only use, prohibit commercial use, and prohibit reproduction without permission.

This is a license boundary, not a quality judgment. A future explicit permission or separately licensed release could justify a new source record and ADR; v0.2.0 does not assume that permission.

## Chinese Open Wordnet

Project page: https://bond-lab.github.io/cow/

Chinese Open Wordnet is permissively available and POS-bearing, but its public downloadable release is a Mandarin synset-lemma mapping rather than a direct Traditional-Chinese learner dictionary with local glosses. Supporting it would require a separate script-conversion and cross-resource provenance design. That is not needed to satisfy the narrow v0.2.0 EN/Traditional importer gate, so it remains unselected rather than silently converted.
