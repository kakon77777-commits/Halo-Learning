# Halo Learning × MNVP Integration Notes — Basic MVP v0.1.0

The attached MNVP 1.0 baseline distinguishes source semantics, projection context, Visual Profile, perceptual artifact and fidelity reporting. Halo Learning Basic adopts the same separation as an architectural principle without importing MNVP numerical-object semantics into language tokens.

## Mapping

```text
Halo SemanticToken
  -> user MarkingProfile
  -> projection plan
  -> label/color channels
  -> reversible page artifact
```

- `SemanticToken.pos` is semantic state.
- `posLabels`, `posColors`, `density`, `labelPosition` are projection/profile state.
- `RenderToken` is a projection decision, not canonical language truth.
- Color is redundant enhancement; the textual POS label remains independently available.
- Low-confidence/unknown semantics can be omitted from the visible projection rather than promoted to false certainty.

## Current profile surface

```json
{
  "languageMode": "both",
  "posLabels": true,
  "posColors": true,
  "density": 0.65,
  "minConfidence": 0.6,
  "labelPosition": "top-right"
}
```

Later Halo profiles can add grammar-role, tense/aspect, mastery, target status, gloss, chunk boundary or accessibility channels while keeping the same semantic/projection boundary.
