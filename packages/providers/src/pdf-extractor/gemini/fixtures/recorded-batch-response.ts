// A recorded Gemini 2.5 Flash-Lite batch response - the raw text returned for a
// 3-page slice (absolute pages 40-42) of a born-digital non-fiction book,
// captured with the adapter's own prompt (`temperature: 0`, thinking disabled).
// The sentinels are slice-local (`1`..`3`); the adapter maps them back to the
// absolute pages it asked for. Kept verbatim so the parser/assembler is locked
// against the real wire shape: the leading blank line, the sentinel style, a
// mid-page heading, a footnote marker, and a hard-wrapped paragraph the model
// does not re-flow.
export const RECORDED_BATCH_RESPONSE = `
<!-- page 1 -->
the dependency graph. When a change ripples further than the author expected,
that is the graph telling you the module boundary is in the wrong place.

## 3.4 Coupling and Cohesion

Two modules are *coupled* when a change to one forces a change to the other.
The goal is not zero coupling - a system of parts that never interact does
nothing - but coupling that follows the design rather than fighting it.[^1]

[^1]: Parnas, D. L. (1972). "On the Criteria To Be Used in Decomposing
Systems into Modules."

<!-- page 2 -->
Cohesion is the other half of the pair: how strongly the responsibilities of a
single module belong together. A module you can describe in one sentence
without using the word "and" is usually cohesive.

Consider a \`Report\` class that formats a document, writes it to disk, and
emails it. Three reasons to change, three audiences, one class. Splitting it
into \`ReportFormatter\`, \`ReportWriter\`, and \`ReportMailer\` gives each a
single reason to change.

<!-- page 3 -->
### Exercises

1. Take a class from your current project and list its reasons to change.
2. For each pair of modules that import each other, decide which direction the
   dependency should really flow.

> A design is finished not when there is nothing left to add, but when there is
> nothing left to take away.
`;
