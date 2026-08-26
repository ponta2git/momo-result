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

const designTokenNamePattern =
  /^--(?:color|ease|font|motion|radius|shadow|z)-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

const directTailwindPalettePattern =
  /\b(?:bg|border|fill|outline|ring|stroke|text)-(?:(?:black|white)(?:\/\d+)?\b|(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-)/gu;

const rawColorValuePattern =
  /#[0-9a-f]{3,8}\b|(?:color|hsla?|lab|lch|oklab|oklch|rgba?)\([^)]*\)/giu;

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
      end: match.index + match[0].length,
      line: lineNumberAt(styles, match.index),
      name,
      start: match.index,
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

function collectPatternViolations(sources, { message, pattern, rule }) {
  const violations = [];
  for (const [path, source] of sources) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const line = lineNumberAt(source, match.index);
      violations.push(
        makeViolation({
          line,
          message,
          path,
          rule,
          subject: `${match[0]}@${line}`,
        }),
      );
    }
  }
  return violations;
}

function collectUtilityContractViolations(sources) {
  return [
    ...collectPatternViolations(sources, {
      message: "use a semantic shadow token instead of a raw Tailwind shadow",
      pattern: /\bshadow-(?:2xl|lg|md|sm|xl)\b/gu,
      rule: "raw-tailwind-shadow",
    }),
    ...collectPatternViolations(sources, {
      message: "use a semantic motion duration token instead of a numeric duration class",
      pattern: /\bduration-[0-9]+\b/gu,
      rule: "numeric-motion-duration",
    }),
    ...collectPatternViolations(sources, {
      message: "transition only the properties that visibly change",
      pattern: /\btransition-all\b/gu,
      rule: "transition-all",
    }),
    ...collectPatternViolations(sources, {
      message: "use a semantic z-index token",
      pattern: /\bz-(?:0|[1-9][0-9]*)\b|\bz-\[calc\(/gu,
      rule: "numeric-z-index",
    }),
    ...collectPatternViolations(sources, {
      message: "structural spacing must use the 4px spacing scale",
      pattern: /\b(?:gap(?:-[xy])?|[mp][trblxy]?|bottom|left|right|top)-(?:1\.5|2\.5)\b/gu,
      rule: "nonconforming-spacing-scale",
    }),
    ...collectPatternViolations(sources, {
      message: "structural spacing must use a design-system spacing token",
      pattern:
        /\b(?:bottom|gap(?:-[xy])?|inset(?:-[xy])?|left|[mp][trblxy]?|right|space-[xy]|top)-\[-?(?:\d+(?:\.\d+)?|\.\d+)px\]/gu,
      rule: "arbitrary-pixel-spacing",
    }),
    ...collectPatternViolations(sources, {
      message: "use a semantic color token instead of a direct palette color",
      pattern: directTailwindPalettePattern,
      rule: "direct-tailwind-palette",
    }),
  ];
}

function collectUndefinedDesignTokenViolations(sources) {
  const declarations = parseCustomProperties(sources.get("styles.css") ?? "");
  const violations = [];

  for (const [path, source] of sources) {
    for (const match of source.matchAll(/var\(\s*(--[a-z0-9-]+)/giu)) {
      const token = match[1];
      if (!token || !designTokenNamePattern.test(token) || declarations.has(token)) continue;
      const line = lineNumberAt(source, match.index);
      violations.push(
        makeViolation({
          line,
          message: `references undefined design token ${token}`,
          path,
          rule: "undefined-design-token-reference",
          subject: `${token}@${line}`,
        }),
      );
    }
  }

  return violations;
}

function indexIsInRange(index, range) {
  return index >= range.start && index < range.end;
}

function collectRawColorViolations(sources) {
  const violations = [];
  const styles = sources.get("styles.css") ?? "";
  const declarations = [...parseCustomProperties(styles).values()];
  const exemptDeclarationRanges = declarations.filter(
    ({ name }) => name.startsWith("--ref-") || name.startsWith("--shadow-"),
  );
  const commentRanges = [...styles.matchAll(/\/\*[\s\S]*?\*\//gu)].map((match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));

  rawColorValuePattern.lastIndex = 0;
  for (const match of styles.matchAll(rawColorValuePattern)) {
    if (
      exemptDeclarationRanges.some((range) => indexIsInRange(match.index, range)) ||
      commentRanges.some((range) => indexIsInRange(match.index, range))
    ) {
      continue;
    }
    const line = lineNumberAt(styles, match.index);
    violations.push(
      makeViolation({
        line,
        message: "declare raw colors once as reference tokens and consume semantic color tokens",
        path: "styles.css",
        rule: "raw-arbitrary-color",
        subject: `${match[0]}@${line}`,
      }),
    );
  }

  const arbitraryColorUtilityPattern =
    /\b(?:bg|border|fill|outline|ring|stroke|text)-\[(?:#[0-9a-f]{3,8}|(?:color|hsla?|lab|lch|oklab|oklch|rgba?)\([^\]\r\n]+\))\]/giu;
  const literalPresentationColorPattern =
    /\b(?:background(?:Color)?|border(?:Bottom|Left|Right|Top)?Color|color|fill|outlineColor|stroke)\s*:\s*["'`](#[0-9a-f]{3,8}\b|(?:color|hsla?|lab|lch|oklab|oklch|rgba?)\([^"'`]+\))["'`]/giu;
  const literalSvgColorPattern =
    /\b(?:fill|stroke)\s*=\s*["'](#[0-9a-f]{3,8}\b|(?:color|hsla?|lab|lch|oklab|oklch|rgba?)\([^"']+\))["']/giu;

  for (const [path, source] of sources) {
    if (path === "styles.css") continue;
    for (const pattern of [
      arbitraryColorUtilityPattern,
      literalPresentationColorPattern,
      literalSvgColorPattern,
    ]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const line = lineNumberAt(source, match.index);
        violations.push(
          makeViolation({
            line,
            message: "use a semantic color token instead of an arbitrary literal color",
            path,
            rule: "raw-arbitrary-color",
            subject: `${match[0]}@${line}`,
          }),
        );
      }
    }
  }

  return violations;
}

function collectClassStringCandidates(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const candidates = [];
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === "className" &&
      node.initializer
    ) {
      candidates.push({
        start: node.initializer.getStart(sourceFile),
        text: node.initializer.getText(sourceFile),
      });
      return;
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      candidates.push({ start: node.getStart(sourceFile), text: node.getText(sourceFile) });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function collectReducedMotionViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.endsWith(".tsx")) continue;
    for (const candidate of collectClassStringCandidates(path, source)) {
      for (const match of candidate.text.matchAll(/\banimate-(?:bounce|ping|pulse|spin)\b/gu)) {
        if (candidate.text.includes("motion-reduce:animate-none")) continue;
        const line = lineNumberAt(source, candidate.start + match.index);
        violations.push(
          makeViolation({
            line,
            message: "looping animation must include motion-reduce:animate-none",
            path,
            rule: "reduced-motion-loop",
            subject: `${match[0]}@${line}`,
          }),
        );
      }
      for (const match of candidate.text.matchAll(
        /\btransition-(?:colors|opacity|transform)\b/gu,
      )) {
        if (candidate.text.includes("motion-reduce:transition-none")) continue;
        const line = lineNumberAt(source, candidate.start + match.index);
        violations.push(
          makeViolation({
            line,
            message: "CSS transition must include motion-reduce:transition-none",
            path,
            rule: "reduced-motion-transition",
            subject: `${match[0]}@${line}`,
          }),
        );
      }
    }
  }
  return violations;
}

function collectMotionTokenDurationViolations(sources) {
  const path = "styles.css";
  const styles = sources.get(path) ?? "";
  const violations = [];
  for (const match of styles.matchAll(/--motion-[a-z0-9-]+\s*:\s*([0-9]+)ms/gu)) {
    if (Number(match[1]) <= 200) continue;
    const line = lineNumberAt(styles, match.index);
    violations.push(
      makeViolation({
        line,
        message: "motion token must not exceed 200ms",
        path,
        rule: "motion-token-duration-limit",
        subject: `${match[0]}@${line}`,
      }),
    );
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

function collectRawTableCellAlignmentViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.endsWith(".tsx")) continue;

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
        if (tagName === "td" || tagName === "th") {
          const openingTag = openingElement.getText(sourceFile);
          const hasAlignmentContract =
            /\balign-(?:baseline|bottom|middle|top)\b/u.test(openingTag) ||
            /\bdataTable(?:Body|Header)CellClassName\b/u.test(openingTag);
          if (!hasAlignmentContract) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            violations.push(
              makeViolation({
                line,
                message:
                  "raw table cells must declare top, middle, bottom, or baseline alignment explicitly",
                path,
                rule: "raw-table-cell-alignment",
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

function collectGlobalFontShorthandViolations(sources) {
  const violations = [];
  for (const [path, source] of sources) {
    if (!path.endsWith("styles.css")) continue;
    for (const match of source.matchAll(/\bfont\s*:/gu)) {
      const line = lineNumberAt(source, match.index);
      violations.push(
        makeViolation({
          line,
          message:
            "global styles must not use the font shorthand because it overrides component font size and line-height contracts",
          path,
          rule: "global-font-shorthand",
          subject: `font@${line}`,
        }),
      );
    }
  }
  return violations;
}

function deduplicateViolations(violations) {
  return [...new Map(violations.map((violation) => [violation.id, violation])).values()];
}

export function collectUiPolicyViolations(sources) {
  return deduplicateViolations([
    ...collectSemanticColorViolations(sources),
    ...collectUtilityContractViolations(sources),
    ...collectUndefinedDesignTokenViolations(sources),
    ...collectRawColorViolations(sources),
    ...collectReducedMotionViolations(sources),
    ...collectMotionTokenDurationViolations(sources),
    ...collectLegacyPlayerTokenViolations(sources),
    ...collectDataVizPlayOrderViolations(sources),
    ...collectFeatureBoundaryViolations(sources),
    ...collectAmbiguousMemberOrderViolations(sources),
    ...collectInteractiveTargetViolations(sources),
    ...collectRawTableCellAlignmentViolations(sources),
    ...collectGlobalFontShorthandViolations(sources),
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
