import ts from "typescript";

const semanticColorFamilies = [
  { family: "action", pattern: /^--color-action(?:-|$)/u },
  { family: "analysis", pattern: /^--color-analysis-/u },
  { family: "member-sequence", pattern: /^--color-member-sequence-/u },
  { family: "play-order", pattern: /^--color-play-order-/u },
  { family: "rank", pattern: /^--color-rank-/u },
  { family: "series", pattern: /^--color-series-/u },
  {
    family: "status",
    pattern: /^--color-(?:(?:danger|review|success|warning)(?:-|$)|status-)/u,
  },
];

const sharedActionPrimitiveFiles = new Set([
  "shared/ui/actions/Button.tsx",
  "shared/ui/actions/IconButton.tsx",
  "shared/ui/actions/IconLink.tsx",
  "shared/ui/actions/LinkButton.tsx",
]);

function violationId(rule, path, subject) {
  return `${rule}:${path}:${subject}`;
}

/**
 * Temporary migration debt that already exists in production source.
 *
 * Entries are narrower than file-level exemptions. When matching source is
 * removed, the entry becomes stale and the checker requires its removal.
 */
export const currentUiPolicyBaseline = Object.freeze([]);

function makeViolation({ line = 1, message, path, rule, subject }) {
  return {
    id: violationId(rule, path, subject),
    line,
    message,
    path,
    rule,
    subject,
  };
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function semanticColorFamily(name) {
  return semanticColorFamilies.find(({ pattern }) => pattern.test(name))?.family;
}

function isAllowedFourPlayerSequenceAlias(left, right) {
  const families = new Set([left.family, right.family]);
  if (!families.has("member-sequence") || !families.has("play-order")) return false;

  const leftSequence = /-([1-4])$/u.exec(left.name)?.[1];
  const rightSequence = /-([1-4])$/u.exec(right.name)?.[1];
  return leftSequence !== undefined && leftSequence === rightSequence;
}

function parseCustomProperties(styles) {
  const declarations = new Map();
  for (const match of styles.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    const name = match[1];
    const value = match[2];
    if (!name || value === undefined) continue;
    declarations.set(name, {
      line: lineNumberAt(styles, match.index),
      name,
      value,
    });
  }
  return declarations;
}

function referencedVariables(value) {
  return [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/giu)]
    .map((match) => match[1])
    .filter((name) => name !== undefined);
}

function resolveReferenceLeaves(tokenName, declarations, stack = []) {
  const cycleStart = stack.indexOf(tokenName);
  if (cycleStart >= 0) {
    return {
      issues: [
        {
          kind: "cycle",
          tokens: [...stack.slice(cycleStart), tokenName],
        },
      ],
      leaves: new Set(),
    };
  }

  const declaration = declarations.get(tokenName);
  if (!declaration) {
    return {
      issues: [{ kind: "undefined", token: tokenName }],
      leaves: new Set(),
    };
  }

  const references = referencedVariables(declaration.value);
  if (references.length === 0) {
    return { issues: [], leaves: new Set([tokenName]) };
  }

  const issues = [];
  const leaves = new Set();
  for (const reference of references) {
    const resolved = resolveReferenceLeaves(reference, declarations, [...stack, tokenName]);
    issues.push(...resolved.issues);
    for (const leaf of resolved.leaves) leaves.add(leaf);
  }
  return { issues, leaves };
}

function normalizeConcreteColorValue(value) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/\s*([(),/])\s*/gu, "$1");
}

function equalReferenceValuePairs(leftLeaves, rightLeaves, declarations) {
  const equalValuePairs = [];
  for (const leftLeaf of leftLeaves) {
    const leftValue = declarations.get(leftLeaf)?.value;
    if (leftValue === undefined) continue;
    for (const rightLeaf of rightLeaves) {
      if (leftLeaf === rightLeaf) continue;
      const rightValue = declarations.get(rightLeaf)?.value;
      if (
        rightValue !== undefined &&
        normalizeConcreteColorValue(leftValue) === normalizeConcreteColorValue(rightValue)
      ) {
        equalValuePairs.push([leftLeaf, rightLeaf].toSorted().join("="));
      }
    }
  }
  return [...new Set(equalValuePairs)].toSorted();
}

function collectSemanticColorViolations(sources) {
  const path = "styles.css";
  const styles = sources.get(path) ?? "";
  const declarations = parseCustomProperties(styles);
  const semanticTokens = [];
  for (const declaration of declarations.values()) {
    const family = semanticColorFamily(declaration.name);
    if (family) semanticTokens.push({ ...declaration, family });
  }
  const resolutions = new Map();
  const violations = [];

  for (const token of semanticTokens) {
    const resolution = resolveReferenceLeaves(token.name, declarations);
    resolutions.set(token.name, resolution);
    for (const issue of resolution.issues) {
      if (issue.kind === "undefined") {
        violations.push(
          makeViolation({
            line: token.line,
            message: `semantic color token ${token.name} references undefined token ${issue.token}`,
            path,
            rule: "semantic-color-unresolved-reference",
            subject: `${token.name}->${issue.token}`,
          }),
        );
      } else {
        const cycle = issue.tokens.join("->");
        violations.push(
          makeViolation({
            line: token.line,
            message: `semantic color token ${token.name} contains an alias cycle (${issue.tokens.join(" -> ")})`,
            path,
            rule: "semantic-color-alias-cycle",
            subject: `${token.name}@${cycle}`,
          }),
        );
      }
    }
  }

  for (let leftIndex = 0; leftIndex < semanticTokens.length; leftIndex += 1) {
    const left = semanticTokens[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < semanticTokens.length; rightIndex += 1) {
      const right = semanticTokens[rightIndex];
      if (!right || left.family === right.family) continue;
      if (isAllowedFourPlayerSequenceAlias(left, right)) continue;
      const leftLeaves = resolutions.get(left.name)?.leaves ?? new Set();
      const rightLeaves = resolutions.get(right.name)?.leaves ?? new Set();
      const sharedLeaves = [...leftLeaves].filter((leaf) => rightLeaves.has(leaf)).toSorted();
      const tokenPair = [left.name, right.name].toSorted();
      if (sharedLeaves.length > 0) {
        const subject = `${tokenPair.join("|")}@${sharedLeaves.join(",")}`;
        violations.push(
          makeViolation({
            line: Math.min(left.line, right.line),
            message: `${tokenPair.join(" and ")} cross semantic color families through ${sharedLeaves.join(", ")}; use family-specific reference tokens`,
            path,
            rule: "semantic-color-cross-family",
            subject,
          }),
        );
      }

      const distinctEqualValuePairs = equalReferenceValuePairs(
        leftLeaves,
        rightLeaves,
        declarations,
      );
      if (distinctEqualValuePairs.length > 0) {
        violations.push(
          makeViolation({
            line: Math.min(left.line, right.line),
            message: `${tokenPair.join(" and ")} resolve to equal color values through ${distinctEqualValuePairs.join(", ")}; assign perceptually distinct family references`,
            path,
            rule: "semantic-color-cross-family-value",
            subject: `${tokenPair.join("|")}@${distinctEqualValuePairs.join(",")}`,
          }),
        );
      }
    }
  }

  return violations;
}

function collectLegacyPlayerTokenViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    for (const match of source.matchAll(/--color-player-(?:[a-z0-9-]+)?/giu)) {
      const subject = match[0];
      violations.push(
        makeViolation({
          line: lineNumberAt(source, match.index),
          message: `${subject} is a legacy ambiguous identity token; use a member-sequence, play-order, or series token through its shared presentation API`,
          path,
          rule: "legacy-player-token",
          subject,
        }),
      );
    }
  }
  return violations;
}

function collectDataVizPlayOrderViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.startsWith("shared/ui/dataViz/")) continue;
    for (const match of source.matchAll(/--color-play-order-(?:[a-z0-9-]+)?/giu)) {
      const subject = match[0];
      violations.push(
        makeViolation({
          line: lineNumberAt(source, match.index),
          message: "data visualization series must not consume play-order identity tokens",
          path,
          rule: "data-viz-play-order-token",
          subject,
        }),
      );
    }
  }
  return violations;
}

function collectFeatureBoundaryViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.startsWith("features/")) continue;

    for (const match of source.matchAll(/["']([^"']*shared\/ui\/forms\/controlStyles)["']/gu)) {
      const subject = match[1];
      if (!subject) continue;
      violations.push(
        makeViolation({
          line: lineNumberAt(source, match.index),
          message: `feature code must use a shared form control component instead of importing ${subject}`,
          path,
          rule: "feature-control-styles-import",
          subject,
        }),
      );
    }

    for (const match of source.matchAll(/<input\b[\s\S]*?>/giu)) {
      const type = /\btype\s*=\s*["'](checkbox|radio)["']/iu.exec(match[0])?.[1]?.toLowerCase();
      if (!type) continue;
      violations.push(
        makeViolation({
          line: lineNumberAt(source, match.index),
          message: `feature code must use the shared ${type} operation component instead of a raw input`,
          path,
          rule: "feature-raw-choice-input",
          subject: type,
        }),
      );
    }
  }
  return violations;
}

function collectAmbiguousMemberOrderViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (path === "shared/domain/members.ts") continue;

    for (const match of source.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*["']@\/shared\/domain\/members["']/gu,
    )) {
      const imports = match[1] ?? "";
      if (!/\bfixedMembers\b/u.test(imports)) continue;
      violations.push(
        makeViolation({
          line: lineNumberAt(source, match.index),
          message:
            "choose workspaceInputMembers, canonicalResultMembers, or orderFixedMembers explicitly instead of the ambiguous compatibility collection",
          path,
          rule: "ambiguous-member-order-import",
          subject: "fixedMembers",
        }),
      );
    }
  }
  return violations;
}

function hasTouchTargetContract(openingTag) {
  if (/\b(?:buttonClassName|buttonClasses)\b/u.test(openingTag)) return true;

  const qualifyingUtilities = new Set();
  for (const match of openingTag.matchAll(
    /(?:^|[\s"'`])(size|min-h|min-w)-(\d+(?:\.\d+)?)(?=$|[\s"'`])/gu,
  )) {
    const utility = match[1];
    const scale = Number(match[2]);
    if (utility && scale >= 11) qualifyingUtilities.add(utility);
  }
  return (
    qualifyingUtilities.has("size") ||
    (qualifyingUtilities.has("min-h") && qualifyingUtilities.has("min-w"))
  );
}

function jsxOpeningText(node, sourceFile) {
  return ts.isJsxElement(node) ? node.openingElement.getText(sourceFile) : node.getText(sourceFile);
}

function jsxElementIsVisuallyHidden(node, sourceFile) {
  const openingText = jsxOpeningText(node, sourceFile);
  return (
    /\baria-hidden(?:\s*=\s*(?:["']true["']|\{true\}))?/u.test(openingText) ||
    /\bsr-only\b/u.test(openingText)
  );
}

function expressionHasVisibleText(expression, sourceFile) {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return true;
  }
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return false;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return expressionHasVisibleText(expression.expression, sourceFile);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionHasVisibleText(expression.whenTrue, sourceFile) ||
      expressionHasVisibleText(expression.whenFalse, sourceFile)
    );
  }
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
    return jsxNodeHasVisibleText(expression, sourceFile);
  }
  if (ts.isJsxFragment(expression)) {
    return expression.children.some((child) => jsxChildHasVisibleText(child, sourceFile));
  }

  // An arbitrary expression may render user-visible text. Do not classify it as icon-only.
  return true;
}

function jsxChildHasVisibleText(child, sourceFile) {
  if (ts.isJsxText(child)) return child.text.trim().length > 0;
  if (ts.isJsxExpression(child)) {
    return child.expression ? expressionHasVisibleText(child.expression, sourceFile) : false;
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    return jsxNodeHasVisibleText(child, sourceFile);
  }
  return false;
}

function jsxNodeHasVisibleText(node, sourceFile, honorOwnVisibility = true) {
  if (honorOwnVisibility && jsxElementIsVisuallyHidden(node, sourceFile)) return false;
  if (ts.isJsxSelfClosingElement(node)) return false;

  const tagName = node.openingElement.tagName.getText(sourceFile);
  if (tagName === "title" || tagName === "desc") return false;
  return node.children.some((child) => jsxChildHasVisibleText(child, sourceFile));
}

function collectInteractiveTargetViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.endsWith(".tsx") || sharedActionPrimitiveFiles.has(path)) continue;

    // The canonical rule requires 44px targets for icon-only actions and mobile primary
    // actions. "Primary" is a feature-level meaning that cannot be inferred reliably from
    // JSX, so Button/LinkButton own that contract. This checker only enforces raw controls
    // whose lack of visible text makes their icon-only presentation deterministic.
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const openingElement = ts.isJsxElement(node) ? node.openingElement : node;
        const tagName = openingElement.tagName.getText(sourceFile);
        if (
          (tagName === "button" ||
            tagName === "Link" ||
            tagName === "NavLink" ||
            tagName === "a") &&
          !jsxNodeHasVisibleText(node, sourceFile, false)
        ) {
          const openingTag = openingElement.getText(sourceFile);
          if (!hasTouchTargetContract(openingTag)) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            violations.push(
              makeViolation({
                line,
                message:
                  "icon-only action must expose a 44px square mobile touch target or use the shared icon action primitive",
                path,
                rule: "interactive-touch-target",
                subject: `${tagName}@${line}`,
              }),
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

function deduplicateViolations(violations) {
  return [...new Map(violations.map((violation) => [violation.id, violation])).values()];
}

export function collectUiPolicyViolations(sources) {
  return deduplicateViolations([
    ...collectSemanticColorViolations(sources),
    ...collectLegacyPlayerTokenViolations(sources),
    ...collectDataVizPlayOrderViolations(sources),
    ...collectFeatureBoundaryViolations(sources),
    ...collectAmbiguousMemberOrderViolations(sources),
    ...collectInteractiveTargetViolations(sources),
  ]);
}

export function applyUiPolicyBaseline(violations, baseline = []) {
  const baselineById = new Map();
  const configurationViolations = [];
  for (const entry of baseline) {
    if (!entry.reason?.trim()) {
      configurationViolations.push(
        makeViolation({
          message: `baseline entry ${entry.id} must include a migration reason`,
          path: "scripts/ui-consistency-policy.mjs",
          rule: "ui-policy-baseline-configuration",
          subject: entry.id,
        }),
      );
      continue;
    }
    if (baselineById.has(entry.id)) {
      configurationViolations.push(
        makeViolation({
          message: `baseline entry ${entry.id} is duplicated`,
          path: "scripts/ui-consistency-policy.mjs",
          rule: "ui-policy-baseline-configuration",
          subject: entry.id,
        }),
      );
      continue;
    }
    baselineById.set(entry.id, entry);
  }

  const matchedBaselineIds = new Set();
  const unbaselined = violations.filter((violation) => {
    if (!baselineById.has(violation.id)) return true;
    matchedBaselineIds.add(violation.id);
    return false;
  });
  const staleEntries = [...baselineById.values()]
    .filter((entry) => !matchedBaselineIds.has(entry.id))
    .map((entry) =>
      makeViolation({
        message: `baseline entry ${entry.id} no longer matches production source; remove it`,
        path: "scripts/ui-consistency-policy.mjs",
        rule: "ui-policy-stale-baseline",
        subject: entry.id,
      }),
    );

  return deduplicateViolations([...configurationViolations, ...unbaselined, ...staleEntries]);
}

export function formatUiPolicyViolation(violation) {
  return `${violation.path}:${violation.line} ${violation.message}`;
}
