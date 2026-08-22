import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const ROUTE_SURFACES = ["public", "member", "moderator", "private", "internal", "not-found"];
export const APP_ROUTE_MATRIX_LIMITS = Object.freeze({
  bytes: 131_072,
  nextConfigBytes: 262_144,
  routes: 512,
  redirects: 512,
  fieldCharacters: 512,
  failures: 64,
  diagnosticCharacters: 512,
});

const ROUTE_FILE_PATTERN = /^(page|route)\.(js|jsx|ts|tsx)$/;
const INTERCEPTING_ROUTE_PATTERN = /^\((?:\.|\.\.|\.\.\.)(?:\.\.)?\)/;
const NEXT_CONFIG_REDIRECT_SKELETON_MARKER = "\n/* app-route-inventory: validated literal redirects body */\n";
const ROUTE_MATRIX_INPUT_FAILURE = "route matrix could not be read or parsed [ROUTE_MATRIX_INPUT]";
const APP_ROUTER_INPUT_FAILURE = "App Router filesystem could not be inventoried [APP_ROUTER_INPUT]";

export const NEXT_CONFIG_REDIRECT_SKELETON_SHA256 = "3F59F1EC20F34AADB3AEB884122264BC6A76740C3B1D79944A40AEF070DF3FED";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function boundedDiagnostic(value) {
  const message = value instanceof Error ? value.message : String(value);
  if (message.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters) return message;
  return `${message.slice(0, APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters - 3)}...`;
}

function createFailureCollector() {
  const failures = [];
  let limitReported = false;

  return {
    failures,
    add(value) {
      if (failures.length < APP_ROUTE_MATRIX_LIMITS.failures) {
        failures.push(boundedDiagnostic(value));
        return;
      }
      if (!limitReported) {
        failures[APP_ROUTE_MATRIX_LIMITS.failures - 1] = `failure limit reached (${APP_ROUTE_MATRIX_LIMITS.failures}); additional diagnostics omitted`;
        limitReported = true;
      }
    },
  };
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "break",
  "case",
  "continue",
  "debugger",
  "delete",
  "do",
  "else",
  "extends",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const REGEX_STATEMENT_PAREN_KEYWORDS = new Set([
  "catch",
  "for",
  "if",
  "switch",
  "while",
  "with",
]);

const REGEX_STATEMENT_BLOCK_KEYWORDS = new Set(["do", "else", "finally", "try"]);

const JAVASCRIPT_IDENTIFIER_START_PATTERN = /^[$_\p{ID_Start}]$/u;
const JAVASCRIPT_IDENTIFIER_CONTINUE_PATTERN = /^[$\u200c\u200d\p{ID_Continue}]$/u;

function isJavaScriptIdentifierStart(value) {
  return JAVASCRIPT_IDENTIFIER_START_PATTERN.test(value);
}

function isJavaScriptIdentifierContinue(value) {
  return JAVASCRIPT_IDENTIFIER_CONTINUE_PATTERN.test(value);
}

function javaScriptCodePointBefore(source, index) {
  const trailingIndex = index - 1;
  if (trailingIndex < 0) return "";
  const trailingCodeUnit = source.charCodeAt(trailingIndex);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && trailingIndex > 0) {
    const leadingCodeUnit = source.charCodeAt(trailingIndex - 1);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return source.slice(trailingIndex - 1, index);
    }
  }
  return source[trailingIndex];
}

function javaScriptCodePointAt(source, index) {
  if (index < 0 || index >= source.length) return "";
  return String.fromCodePoint(source.codePointAt(index));
}

function previousNonTriviaCharacter(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  return source[cursor] || "";
}

function maskedText(value) {
  return value.replace(/[^\r\n\u2028\u2029]/g, " ");
}

function isJavaScriptLineTerminator(value) {
  return value === "\r" || value === "\n" || value === "\u2028" || value === "\u2029";
}

function isRouteGroupSegment(segment) {
  return segment.startsWith("(") && segment.endsWith(")");
}

function lineCommentEnd(source, start) {
  let index = start;
  while (index < source.length && !isJavaScriptLineTerminator(source[index])) index += 1;
  return index;
}

function regularExpressionEnd(source, start) {
  let inCharacterClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (isJavaScriptLineTerminator(character)) return null;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]") {
      inCharacterClass = false;
      continue;
    }
    if (character !== "/" || inCharacterClass) continue;

    let end = index + 1;
    while (/[dgimsuvy]/.test(source[end] || "")) end += 1;
    return end;
  }
  return null;
}

function quotedStringEnd(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function templateLiteralEnd(source, start, { rejectTemplateExpressions = false } = {}) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") return index + 1;
    if (source[index] === "$" && source[index + 1] === "{") {
      if (rejectTemplateExpressions) {
        throw new Error("next.config.ts template interpolation is unsupported because it can hide live redirect mutations");
      }
      index = templateExpressionEnd(source, index + 2);
      continue;
    }
    index += 1;
  }
  return source.length;
}

function templateExpressionEnd(source, start) {
  let index = start;
  let braces = 1;
  let canStartRegex = true;
  let moduleSpecifierLineEnd = false;
  let pendingStatementParenthesis = null;
  let pendingBraceContext = null;
  let pendingFunctionParenthesis = false;
  let previousIdentifier = null;
  let restrictedStatementLineEnd = false;
  let ambiguousSlashContext = false;
  let pendingMemberProperty = false;
  const parenthesisContexts = [];
  const braceContexts = [];

  function applyLineTerminator(value) {
    if (!/[\r\n\u2028\u2029]/.test(value)) return;
    if (moduleSpecifierLineEnd || restrictedStatementLineEnd) canStartRegex = true;
    else if (!canStartRegex) ambiguousSlashContext = true;
    moduleSpecifierLineEnd = false;
    restrictedStatementLineEnd = false;
  }

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1] || "";

    if (/\s/.test(character)) {
      applyLineTerminator(character);
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      index = lineCommentEnd(source, index + 2);
      continue;
    }

    if (character === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      const stop = closing === -1 ? source.length : closing + 2;
      applyLineTerminator(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (character === "'" || character === '"') {
      index = quotedStringEnd(source, index, character);
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = previousIdentifier === "from" || previousIdentifier === "import";
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      continue;
    }

    if (character === "`") {
      index = templateLiteralEnd(source, index);
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = previousIdentifier === "from" || previousIdentifier === "import";
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      continue;
    }

    if (character === "/" && ambiguousSlashContext) {
      const possibleRegexEnd = regularExpressionEnd(source, index);
      if (possibleRegexEnd !== null) {
        throw unsupportedRouteHandlerExport();
      }
    }

    if (character === "/" && canStartRegex) {
      const stop = regularExpressionEnd(source, index);
      if (stop !== null) {
        index = stop;
        canStartRegex = false;
        ambiguousSlashContext = false;
        pendingMemberProperty = false;
        moduleSpecifierLineEnd = false;
        pendingStatementParenthesis = null;
        pendingBraceContext = null;
        previousIdentifier = null;
        restrictedStatementLineEnd = false;
        continue;
      }
    }

    const identifierName = readJavaScriptIdentifierName(source, index);
    if (identifierName) {
      const atExpressionStart = canStartRegex;
      const followsExport = previousIdentifier === "export";
      const memberProperty = pendingMemberProperty;
      const identifier = identifierName.value;
      index = identifierName.end;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      if (REGEX_STATEMENT_PAREN_KEYWORDS.has(identifier) && atExpressionStart) {
        pendingStatementParenthesis = identifier;
      } else if (!(pendingStatementParenthesis === "for" && identifier === "await")) {
        pendingStatementParenthesis = null;
      }
      if (memberProperty) {
        canStartRegex = false;
      } else if (identifier === "of") {
        canStartRegex = false;
        ambiguousSlashContext = !atExpressionStart;
      } else {
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(identifier) || (identifier === "default" && followsExport);
      }
      if (!memberProperty && identifier === "function") pendingFunctionParenthesis = true;
      pendingBraceContext = !memberProperty && REGEX_STATEMENT_BLOCK_KEYWORDS.has(identifier) ? "statement" : null;
      if (!memberProperty && ["break", "continue", "debugger"].includes(identifier)) restrictedStatementLineEnd = true;
      previousIdentifier = identifier;
      continue;
    }

    if (/[0-9]/.test(character)) {
      let stop = index + 1;
      while (/[A-Za-z0-9._]/.test(source[stop] || "")) stop += 1;
      index = stop;
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    if ((character === "+" || character === "-") && next === character) {
      index += 2;
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    if (source.startsWith("...", index)) {
      index += 3;
      canStartRegex = true;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    const priorCanStartRegex = canStartRegex;
    const priorAmbiguousSlashContext = ambiguousSlashContext;
    index += 1;
    ambiguousSlashContext = false;
    pendingMemberProperty = false;
    moduleSpecifierLineEnd = false;
    previousIdentifier = null;
    if (character === "{") {
      braces += 1;
      braceContexts.push(pendingBraceContext || "expression");
      canStartRegex = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "}") {
      braces -= 1;
      if (braces === 0) return index;
      const braceContext = braceContexts.pop();
      canStartRegex = braceContext === "statement";
      ambiguousSlashContext = braceContext !== "statement";
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "(") {
      parenthesisContexts.push(pendingFunctionParenthesis
        ? "function"
        : pendingStatementParenthesis === null ? "expression" : "statement");
      pendingFunctionParenthesis = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      canStartRegex = true;
    } else if (character === ")") {
      const context = parenthesisContexts.pop();
      canStartRegex = context === "statement";
      pendingBraceContext = context === "statement" || context === "function" ? context : null;
      pendingStatementParenthesis = null;
    } else if (character === "]") {
      canStartRegex = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "." || character === "#") {
      canStartRegex = false;
      pendingMemberProperty = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "!" && next !== "=") {
      if (!priorCanStartRegex || priorAmbiguousSlashContext) {
        canStartRegex = false;
        ambiguousSlashContext = true;
      } else {
        canStartRegex = true;
      }
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === ">" && next !== "=") {
      canStartRegex = true;
      ambiguousSlashContext = priorAmbiguousSlashContext || !priorCanStartRegex;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else {
      canStartRegex = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    }
    if (character === ";") {
      pendingFunctionParenthesis = false;
      restrictedStatementLineEnd = false;
    }
  }

  return source.length;
}

function maskCommentsAndStrings(source, { rejectTemplateExpressions = false } = {}) {
  let result = "";
  let index = 0;
  let canStartRegex = true;
  let moduleSpecifierLineEnd = false;
  let pendingStatementParenthesis = null;
  let pendingBraceContext = null;
  let pendingFunctionParenthesis = false;
  let previousIdentifier = null;
  let restrictedStatementLineEnd = false;
  let ambiguousSlashContext = false;
  let pendingMemberProperty = false;
  const parenthesisContexts = [];
  const braceContexts = [];

  function applyLineTerminator(value) {
    if (!/[\r\n\u2028\u2029]/.test(value)) return;
    if (moduleSpecifierLineEnd || restrictedStatementLineEnd) canStartRegex = true;
    else if (!canStartRegex) ambiguousSlashContext = true;
    moduleSpecifierLineEnd = false;
    restrictedStatementLineEnd = false;
  }

  const hashbangStart = source.startsWith("\uFEFF") ? 1 : 0;
  if (source.startsWith("#!", hashbangStart)) {
    const stop = lineCommentEnd(source, hashbangStart + 2);
    result += maskedText(source.slice(0, stop));
    index = stop;
  }

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1] || "";

    if (/\s/.test(character)) {
      result += character;
      applyLineTerminator(character);
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      const stop = lineCommentEnd(source, index + 2);
      result += maskedText(source.slice(index, stop));
      index = stop;
      continue;
    }

    if (character === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      const stop = closing === -1 ? source.length : closing + 2;
      const comment = source.slice(index, stop);
      result += maskedText(comment);
      applyLineTerminator(comment);
      index = stop;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      const stop = quote === "`"
        ? templateLiteralEnd(source, index, { rejectTemplateExpressions })
        : quotedStringEnd(source, index, quote);
      const masked = maskedText(source.slice(index, stop));
      result += `${quote}${masked.slice(1)}`;
      index = stop;
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = previousIdentifier === "from" || previousIdentifier === "import";
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      continue;
    }

    if (character === "/" && ambiguousSlashContext) {
      const possibleRegexEnd = regularExpressionEnd(source, index);
      if (possibleRegexEnd !== null) {
        throw unsupportedRouteHandlerExport();
      }
    }

    if (character === "/" && canStartRegex) {
      const stop = regularExpressionEnd(source, index);
      if (stop !== null) {
        result += maskedText(source.slice(index, stop));
        index = stop;
        canStartRegex = false;
        ambiguousSlashContext = false;
        pendingMemberProperty = false;
        moduleSpecifierLineEnd = false;
        pendingStatementParenthesis = null;
        pendingBraceContext = null;
        previousIdentifier = null;
        restrictedStatementLineEnd = false;
        continue;
      }
    }

    const identifierName = readJavaScriptIdentifierName(source, index);
    if (identifierName) {
      const atExpressionStart = canStartRegex;
      const followsExport = previousIdentifier === "export";
      const memberProperty = pendingMemberProperty;
      const identifier = identifierName.value;
      result += source.slice(index, identifierName.end);
      index = identifierName.end;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      if (REGEX_STATEMENT_PAREN_KEYWORDS.has(identifier) && atExpressionStart) {
        pendingStatementParenthesis = identifier;
      } else if (!(pendingStatementParenthesis === "for" && identifier === "await")) {
        pendingStatementParenthesis = null;
      }
      if (memberProperty) {
        canStartRegex = false;
      } else if (identifier === "of") {
        canStartRegex = false;
        ambiguousSlashContext = !atExpressionStart;
      } else {
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(identifier) || (identifier === "default" && followsExport);
      }
      if (!memberProperty && identifier === "function") pendingFunctionParenthesis = true;
      pendingBraceContext = !memberProperty && REGEX_STATEMENT_BLOCK_KEYWORDS.has(identifier) ? "statement" : null;
      if (!memberProperty && ["break", "continue", "debugger"].includes(identifier)) restrictedStatementLineEnd = true;
      previousIdentifier = identifier;
      continue;
    }

    if (/[0-9]/.test(character)) {
      let stop = index + 1;
      while (/[A-Za-z0-9._]/.test(source[stop] || "")) stop += 1;
      result += source.slice(index, stop);
      index = stop;
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    if ((character === "+" || character === "-") && next === character) {
      result += `${character}${next}`;
      index += 2;
      canStartRegex = false;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    if (source.startsWith("...", index)) {
      result += "...";
      index += 3;
      canStartRegex = true;
      ambiguousSlashContext = false;
      pendingMemberProperty = false;
      moduleSpecifierLineEnd = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      previousIdentifier = null;
      restrictedStatementLineEnd = false;
      continue;
    }

    const priorCanStartRegex = canStartRegex;
    const priorAmbiguousSlashContext = ambiguousSlashContext;
    result += character;
    index += 1;
    ambiguousSlashContext = false;
    pendingMemberProperty = false;
    moduleSpecifierLineEnd = false;
    previousIdentifier = null;
    if (character === "{") {
      braceContexts.push(pendingBraceContext || "expression");
      canStartRegex = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "}") {
      const braceContext = braceContexts.pop();
      canStartRegex = braceContext === "statement";
      ambiguousSlashContext = braceContext !== "statement";
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "(") {
      parenthesisContexts.push(pendingFunctionParenthesis
        ? "function"
        : pendingStatementParenthesis === null ? "expression" : "statement");
      pendingFunctionParenthesis = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
      canStartRegex = true;
    } else if (character === ")") {
      const context = parenthesisContexts.pop();
      canStartRegex = context === "statement";
      pendingBraceContext = context === "statement" || context === "function" ? context : null;
      pendingStatementParenthesis = null;
    } else if (character === "]") {
      canStartRegex = false;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "." || character === "#") {
      canStartRegex = false;
      pendingMemberProperty = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === "!" && next !== "=") {
      if (!priorCanStartRegex || priorAmbiguousSlashContext) {
        canStartRegex = false;
        ambiguousSlashContext = true;
      } else {
        canStartRegex = true;
      }
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else if (character === ">" && next !== "=") {
      canStartRegex = true;
      ambiguousSlashContext = priorAmbiguousSlashContext || !priorCanStartRegex;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    } else {
      canStartRegex = true;
      pendingStatementParenthesis = null;
      pendingBraceContext = null;
    }
    if (character === ";") {
      pendingFunctionParenthesis = false;
      restrictedStatementLineEnd = false;
    }
  }

  return result;
}

function isRootRelativePath(value) {
  if (typeof value !== "string"
    || value.length > APP_ROUTE_MATRIX_LIMITS.fieldCharacters
    || !value.startsWith("/")
    || value.startsWith("//")
    || /[\\%?#\s\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  if (value === "/") return true;
  return value.slice(1).split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isRouteSource(value) {
  return typeof value === "string"
    && value.length <= APP_ROUTE_MATRIX_LIMITS.fieldCharacters
    && /^(?:app\/(?:.+\/)?(?:page|route)\.(?:js|jsx|ts|tsx))$/.test(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function formatMethods(value) {
  return Array.isArray(value) ? value.join(", ") || "no methods" : "invalid methods";
}

function routePathFromSegments(segments) {
  const routeSegments = [];
  for (const segment of segments) {
    if (segment.startsWith("_")) return null;
    if (isRouteGroupSegment(segment)) continue;
    if (segment.startsWith("@") || INTERCEPTING_ROUTE_PATTERN.test(segment)) {
      throw new Error(`unsupported App Router segment ${segment}; inventory support must be added before introducing this route`);
    }
    routeSegments.push(segment);
  }
  return routeSegments.length ? `/${routeSegments.join("/")}` : "/";
}

function readJavaScriptIdentifierCodePoint(source, start) {
  if (source[start] === "\\" && source[start + 1] === "u") {
    const escape = source.slice(start).match(/^\\u(?:\{([0-9A-Fa-f]{1,6})\}|([0-9A-Fa-f]{4}))/);
    if (!escape) return null;
    const codePoint = Number.parseInt(escape[1] || escape[2], 16);
    if (codePoint > 0x10FFFF) return null;
    return { value: String.fromCodePoint(codePoint), end: start + escape[0].length };
  }
  const codePoint = source.codePointAt(start);
  if (codePoint === undefined) return null;
  const value = String.fromCodePoint(codePoint);
  return { value, end: start + value.length };
}

function readJavaScriptIdentifierName(source, start) {
  let cursor = start;
  let value = "";
  let first = true;
  while (cursor < source.length) {
    const part = readJavaScriptIdentifierCodePoint(source, cursor);
    if (!part || !(first ? isJavaScriptIdentifierStart(part.value) : isJavaScriptIdentifierContinue(part.value))) break;
    value += part.value;
    cursor = part.end;
    first = false;
  }
  return first ? null : { value, end: cursor };
}

function readModuleExportName(source, start) {
  if (source[start] !== '"' && source[start] !== "'") return readJavaScriptIdentifierName(source, start);
  const quote = source[start];
  const end = quotedStringEnd(source, start, quote);
  const raw = source.slice(start, end);
  let value = null;
  if (quote === '"') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  } else if (!raw.slice(1, -1).includes("\\")) {
    value = raw.slice(1, -1);
  }
  return typeof value === "string" ? { value, end } : null;
}

function exportedNameFromSpecifier(source, start, end) {
  let cursor = skipJavaScriptTrivia(source, start, "route handler export");
  const local = readModuleExportName(source, cursor);
  if (!local || local.end > end) return null;
  cursor = skipJavaScriptTrivia(source, local.end, "route handler export");
  if (cursor === end) return local.value;

  const separator = readJavaScriptIdentifierName(source, cursor);
  if (!separator || source.slice(cursor, separator.end) !== "as") return null;
  cursor = skipJavaScriptTrivia(source, separator.end, "route handler export");
  const exported = readModuleExportName(source, cursor);
  if (!exported || exported.end > end) return null;
  cursor = skipJavaScriptTrivia(source, exported.end, "route handler export");
  return cursor === end ? exported.value : null;
}

function unsupportedRouteHandlerExport() {
  return new Error("unsupported route handler export declaration; use a single-line simple binding or add inventory support");
}

function directExportedMethods(source, code) {
  const methods = new Set();
  const prefix = code.match(/^export\s+(?:async\s+)?(function|const|let|var)\s*/);
  if (!prefix) return null;

  let cursor = prefix[0].length;
  if (prefix[1] === "function") {
    const identifier = readJavaScriptIdentifierName(source, cursor);
    if (!identifier) throw unsupportedRouteHandlerExport();
    if (HTTP_METHODS.includes(identifier.value)) methods.add(identifier.value);
    return methods;
  }
  if (/[\r\n\u2028\u2029]/.test(prefix[0])) throw unsupportedRouteHandlerExport();

  let expectBinding = true;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  while (cursor < code.length) {
    while (/\s/.test(code[cursor] || "")) {
      if (braces === 0 && brackets === 0 && parentheses === 0
        && isJavaScriptLineTerminator(code[cursor])) {
        throw unsupportedRouteHandlerExport();
      }
      cursor += 1;
    }
    if (expectBinding) {
      const identifier = readJavaScriptIdentifierName(source, cursor);
      if (!identifier) throw unsupportedRouteHandlerExport();
      if (HTTP_METHODS.includes(identifier.value)) methods.add(identifier.value);
      cursor = identifier.end;
      expectBinding = false;
      continue;
    }

    const character = code[cursor];
    if (braces === 0 && brackets === 0 && parentheses === 0) {
      if (character === ";") return methods;
      if (character === "<") throw unsupportedRouteHandlerExport();
      if (character === ",") {
        cursor += 1;
        expectBinding = true;
        continue;
      }
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    cursor += 1;
  }
  throw unsupportedRouteHandlerExport();
}

function explicitHandlerMethods(source) {
  const code = maskCommentsAndStrings(source);
  const found = new Set();
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    const identifier = readJavaScriptIdentifierName(code, index);
    if (identifier) {
      const literalIdentifier = code.slice(index, identifier.end);
      if (braces === 0 && brackets === 0 && parentheses === 0
        && identifier.value === "export"
        && literalIdentifier === "export"
        && !isJavaScriptIdentifierContinue(javaScriptCodePointBefore(code, index))
        && !isJavaScriptIdentifierContinue(javaScriptCodePointAt(code, identifier.end))) {
        if (previousNonTriviaCharacter(code, index) === ".") throw unsupportedRouteHandlerExport();
        const candidate = code.slice(index);
        const sourceCandidate = source.slice(index);
        const direct = directExportedMethods(sourceCandidate, candidate);
        if (direct !== null) {
          for (const method of direct) found.add(method);
        }

        const named = candidate.match(/^export\s*\{([^}]*)\}/);
        if (named) {
          const open = named[0].indexOf("{");
          const close = named[0].lastIndexOf("}");
          let partStart = open + 1;
          for (let cursor = partStart; cursor <= close; cursor += 1) {
            if (cursor !== close && candidate[cursor] !== ",") continue;
            const exported = exportedNameFromSpecifier(sourceCandidate, partStart, cursor);
            if (exported === null && candidate.slice(partStart, cursor).trim() !== "") {
              throw unsupportedRouteHandlerExport();
            }
            if (HTTP_METHODS.includes(exported)) found.add(exported);
            partStart = cursor + 1;
          }
        }
        if (direct === null && !named && !/^export\s+(?:default|type|interface|declare)\b/.test(candidate)) {
          throw unsupportedRouteHandlerExport();
        }
      }
      index = identifier.end - 1;
      continue;
    }

    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
  }

  return HTTP_METHODS.filter((method) => found.has(method));
}

export function discoverAppRouterEntries(appDirectory) {
  const entries = [];
  const root = lstatSync(appDirectory);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new Error("App Router root must be a non-symbolic directory");
  }

  function visit(directory, segments = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      if (entry.isSymbolicLink()) {
        const linkedSource = normalizeRelativePath(path.relative(appDirectory, path.join(directory, entry.name)));
        throw new Error(`symbolic links are unsupported inside App Router source (${linkedSource}); inventory support must be added before introducing this route`);
      }
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) visit(path.join(directory, entry.name), [...segments, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;

      const match = entry.name.match(ROUTE_FILE_PATTERN);
      if (!match) continue;
      const routePath = routePathFromSegments(segments);
      if (!routePath) continue;

      const kind = match[1] === "page" ? "page" : "handler";
      const source = normalizeRelativePath(path.relative(path.dirname(appDirectory), path.join(directory, entry.name)));
      const discovered = { path: routePath, kind, source };
      if (kind === "handler") {
        if (match[2] !== "ts") {
          throw new Error(`unsupported App Router handler extension .${match[2]}; inventory support must be added before introducing this route`);
        }
        discovered.methods = explicitHandlerMethods(readFileSync(path.join(directory, entry.name), "utf8"));
      }
      entries.push(discovered);
    }
  }

  visit(appDirectory);
  return entries.sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
}

export function readAppRouteMatrix(matrixPath) {
  const source = lstatSync(matrixPath);
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new Error("route matrix must be a regular non-symbolic file");
  }
  if (source.size > APP_ROUTE_MATRIX_LIMITS.bytes) {
    throw new Error(`route matrix exceeds the ${APP_ROUTE_MATRIX_LIMITS.bytes}-byte source limit`);
  }
  return JSON.parse(readFileSync(matrixPath, "utf8"));
}

export function readNextConfigSource(nextConfigPath) {
  const source = lstatSync(nextConfigPath);
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new Error("next.config.ts must be a regular non-symbolic file");
  }
  if (source.size > APP_ROUTE_MATRIX_LIMITS.nextConfigBytes) {
    throw new Error(`next.config.ts exceeds the ${APP_ROUTE_MATRIX_LIMITS.nextConfigBytes}-byte source limit`);
  }
  return readFileSync(nextConfigPath, "utf8");
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function validateAppRouteMatrix({ appDirectory, matrixPath }) {
  const collector = createFailureCollector();
  const { failures } = collector;
  const fail = (message) => collector.add(message);
  let matrix;
  let discovered;

  try {
    matrix = readAppRouteMatrix(matrixPath);
  } catch {
    fail(ROUTE_MATRIX_INPUT_FAILURE);
    return { failures, matrix: null, discovered: [] };
  }

  try {
    discovered = discoverAppRouterEntries(appDirectory);
  } catch {
    fail(APP_ROUTER_INPUT_FAILURE);
    return { failures, matrix, discovered: [] };
  }

  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    fail("route matrix root must be an object");
    return { failures, matrix, discovered };
  }
  if (!exactKeys(matrix, ["schemaVersion", "publicSafe", "routes", "redirects"])) {
    fail("route matrix root must contain only schemaVersion, publicSafe, routes, and redirects");
  }
  if (matrix.schemaVersion !== 1) fail("route matrix schemaVersion must be 1");
  if (matrix.publicSafe !== true) fail("route matrix must declare publicSafe=true");
  if (!Array.isArray(matrix.routes)) fail("route matrix routes must be an array");
  if (!Array.isArray(matrix.redirects)) fail("route matrix redirects must be an array");
  if (failures.length) return { failures, matrix, discovered };

  if (matrix.routes.length > APP_ROUTE_MATRIX_LIMITS.routes) {
    fail(`route matrix routes exceed the ${APP_ROUTE_MATRIX_LIMITS.routes}-row limit`);
  }
  if (matrix.redirects.length > APP_ROUTE_MATRIX_LIMITS.redirects) {
    fail(`route matrix redirects exceed the ${APP_ROUTE_MATRIX_LIMITS.redirects}-row limit`);
  }
  if (discovered.length > APP_ROUTE_MATRIX_LIMITS.routes) {
    fail(`App Router filesystem exceeds the ${APP_ROUTE_MATRIX_LIMITS.routes}-entry limit`);
  }

  const routeRows = matrix.routes.slice(0, APP_ROUTE_MATRIX_LIMITS.routes);
  const redirectRows = matrix.redirects.slice(0, APP_ROUTE_MATRIX_LIMITS.redirects);
  const discoveredRows = discovered.slice(0, APP_ROUTE_MATRIX_LIMITS.routes);
  const routeKeys = new Set();
  const routePaths = new Set();
  const sources = new Set();
  for (const [index, route] of routeRows.entries()) {
    const label = `routes[${index}]`;
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      fail(`${label} must be an object`);
      continue;
    }

    const expectedKeys = route.kind === "handler"
      ? ["path", "kind", "source", "surface", "productionSmoke", "methods"]
      : ["path", "kind", "source", "surface", "productionSmoke"];
    const validKind = route.kind === "page" || route.kind === "handler";
    const validPath = isRootRelativePath(route.path);
    const validSource = isRouteSource(route.source);
    if (!exactKeys(route, expectedKeys)) fail(`${label} has unsupported or missing fields`);
    if (!validKind) fail(`${label}.kind must be page or handler`);
    if (!validPath) fail(`${label}.path must be a bounded root-relative route without query or fragment`);
    if (!validSource) fail(`${label}.source must be a bounded App Router page or handler path relative to apps/web`);
    if (route.kind === "handler" && typeof route.source === "string" && /(?:^|\/)route\.(?:js|jsx|tsx)$/.test(route.source)) {
      fail(`${label}.source uses an unsupported JSX-capable handler extension`);
    }
    if (!ROUTE_SURFACES.includes(route.surface)) fail(`${label}.surface is not recognized`);
    if (typeof route.productionSmoke !== "boolean") fail(`${label}.productionSmoke must be boolean`);
    if (route.productionSmoke && (route.kind !== "page" || typeof route.path !== "string" || route.path.includes("["))) {
      fail(`${label} enables production smoke for a handler or dynamic route`);
    }
    if (route.productionSmoke === true && ["private", "internal", "not-found"].includes(route.surface)) {
      fail(`${label} enables production smoke for the ${route.surface} surface`);
    }

    if (route.kind === "handler") {
      if (!Array.isArray(route.methods) || route.methods.length === 0) {
        fail(`${label}.methods must list at least one explicit handler export`);
      } else if (route.methods.length > HTTP_METHODS.length) {
        fail(`${label}.methods exceeds the ${HTTP_METHODS.length}-method limit`);
      } else {
        const canonicalMethods = HTTP_METHODS.filter((method) => route.methods.includes(method));
        if (route.methods.some((method) => !HTTP_METHODS.includes(method)) || !sameStringArray(route.methods, canonicalMethods)) {
          fail(`${label}.methods must be unique and ordered as ${HTTP_METHODS.join(", ")}`);
        }
      }
    }

    if (validKind && validPath) {
      const key = `${route.kind}:${route.path}`;
      if (routeKeys.has(key)) fail(`${label} duplicates ${key}`);
      routeKeys.add(key);
      if (routePaths.has(route.path)) fail(`${label} conflicts with another route kind at ${route.path}`);
      routePaths.add(route.path);
    }
    if (validSource) {
      if (sources.has(route.source)) fail(`${label} duplicates source ${route.source}`);
      sources.add(route.source);
    }
  }

  const sortableRoutes = routeRows.every((route) => route && typeof route === "object" && !Array.isArray(route)
    && isRootRelativePath(route.path) && typeof route.kind === "string" && route.kind.length <= APP_ROUTE_MATRIX_LIMITS.fieldCharacters);
  if (sortableRoutes) {
    const canonicalRoutes = [...routeRows].sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
    if (routeRows.some((route, index) => route !== canonicalRoutes[index])) {
      fail("route matrix routes must be ordered by path, then kind");
    }
  }

  const comparableRoutes = routeRows.filter((route) => route && typeof route === "object" && !Array.isArray(route)
    && (route.kind === "page" || route.kind === "handler")
    && isRootRelativePath(route.path)
    && isRouteSource(route.source));
  const expectedByKey = new Map(comparableRoutes.map((route) => [`${route.kind}:${route.path}`, route]));
  const discoveredByKey = new Map();
  const discoveredPaths = new Set();
  for (const route of discoveredRows) {
    const key = `${route.kind}:${route.path}`;
    if (discoveredByKey.has(key)) fail(`filesystem contains duplicate ${key}`);
    if (discoveredPaths.has(route.path)) fail(`filesystem defines both a page and handler at ${route.path}`);
    discoveredByKey.set(key, route);
    discoveredPaths.add(route.path);
  }
  for (const [key, route] of discoveredByKey) {
    const expected = expectedByKey.get(key);
    if (!expected) {
      fail(`undocumented App Router ${route.kind} ${route.path} at ${route.source}`);
      continue;
    }
    if (expected.source !== route.source) fail(`${key} source is ${route.source}; matrix records ${expected.source}`);
    if (route.kind === "handler" && !sameStringArray(expected.methods, route.methods)) {
      fail(`${key} exports ${formatMethods(route.methods)}; matrix records ${formatMethods(expected.methods)}`);
    }
  }
  for (const [key, route] of expectedByKey) {
    if (!discoveredByKey.has(key)) fail(`documented ${key} has no filesystem route at ${route.source}`);
  }

  const pagePaths = new Set(comparableRoutes.filter((route) => route.kind === "page").map((route) => route.path));
  const redirectSources = new Set();
  for (const [index, redirect] of redirectRows.entries()) {
    const label = `redirects[${index}]`;
    if (!redirect || typeof redirect !== "object" || Array.isArray(redirect) || !exactKeys(redirect, ["source", "destination", "permanent"])) {
      fail(`${label} must contain only source, destination, and permanent`);
      continue;
    }
    const validSource = isRootRelativePath(redirect.source);
    const validDestination = isRootRelativePath(redirect.destination);
    if (!validSource) fail(`${label}.source must be a bounded root-relative path without query or fragment`);
    if (!validDestination || !pagePaths.has(redirect.destination)) {
      fail(`${label}.destination must reference a documented bounded page route`);
    }
    if (redirect.permanent !== true) fail(`${label}.permanent must be true for the legacy route contract`);
    if (validSource) {
      if (redirectSources.has(redirect.source)) fail(`${label} duplicates source ${redirect.source}`);
      if (routePaths.has(redirect.source)) fail(`${label}.source conflicts with a documented route`);
      redirectSources.add(redirect.source);
    }
  }
  const sortableRedirects = redirectRows.every((redirect) => redirect && typeof redirect === "object" && !Array.isArray(redirect)
    && isRootRelativePath(redirect.source));
  if (sortableRedirects) {
    const canonicalRedirects = [...redirectRows].sort((left, right) => compareText(left.source, right.source));
    if (redirectRows.some((redirect, index) => redirect !== canonicalRedirects[index])) {
      fail("route matrix redirects must be ordered by source");
    }
  }

  return { failures, matrix, discovered };
}

function skipJavaScriptTrivia(source, start, label = "redirects()") {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "/") {
      index = lineCommentEnd(source, index + 2);
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error(`${label} contains an unterminated block comment`);
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readRedirectPathLiteral(source, start) {
  if (source[start] !== '"') throw new Error("redirect entries must use plain double-quoted paths");
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\\" || isJavaScriptLineTerminator(source[index])) {
      throw new Error("redirect path literals must not contain escapes or line breaks");
    }
    index += 1;
  }
  if (index >= source.length) throw new Error("redirects() contains an unterminated path literal");
  const value = source.slice(start + 1, index);
  if (value.length > APP_ROUTE_MATRIX_LIMITS.fieldCharacters) {
    throw new Error(`redirect path exceeds the ${APP_ROUTE_MATRIX_LIMITS.fieldCharacters}-character limit`);
  }
  return { value, end: index + 1 };
}

function expectRedirectToken(source, start, token) {
  const index = skipJavaScriptTrivia(source, start);
  if (!source.startsWith(token, index)) throw new Error(`redirects() expected ${token}`);
  return index + token.length;
}

function matchingDelimiterEnd(source, start, open, close, label) {
  if (source[start] !== open) throw new Error(`${label} opening delimiter was not found`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] !== close) continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`${label} closing delimiter was not found`);
}

function hasTopLevelObjectSpread(source, start, end) {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = start; index <= end; index += 1) {
    if (source.startsWith("...", index) && braces === 1 && brackets === 0 && parentheses === 0) return true;
    if (source[index] === "{") braces += 1;
    else if (source[index] === "}") braces -= 1;
    else if (source[index] === "[") brackets += 1;
    else if (source[index] === "]") brackets -= 1;
    else if (source[index] === "(") parentheses += 1;
    else if (source[index] === ")") parentheses -= 1;
  }
  return false;
}

function hasTopLevelComputedMember(source, start, end) {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let inPropertyValue = false;
  for (let index = start; index <= end; index += 1) {
    const character = source[index];
    if (character === "[" && braces === 1 && brackets === 0 && parentheses === 0 && !inPropertyValue) {
      return true;
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (braces === 1 && brackets === 0 && parentheses === 0) {
      if (character === ":") inPropertyValue = true;
      else if (character === ",") inPropertyValue = false;
    }
  }
  return false;
}

function hasTopLevelQuotedMember(source, start, end) {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let inPropertyValue = false;
  for (let index = start; index <= end; index += 1) {
    const character = source[index];
    if ((character === "\"" || character === "'")
      && braces === 1 && brackets === 0 && parentheses === 0 && !inPropertyValue) {
      return true;
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (braces === 1 && brackets === 0 && parentheses === 0) {
      if (character === ":") inPropertyValue = true;
      else if (character === ",") inPropertyValue = false;
    }
  }
  return false;
}

function topLevelIdentifierOffsets(source, identifier) {
  const offsets = [];
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (braces === 1 && brackets === 0 && parentheses === 0
      && source.startsWith(identifier, index)
      && source[index - 1] !== "\\"
      && source[index + identifier.length] !== "\\"
      && !isJavaScriptIdentifierContinue(javaScriptCodePointBefore(source, index))
      && !isJavaScriptIdentifierContinue(javaScriptCodePointAt(source, index + identifier.length))) {
      offsets.push(index);
    }
    if (source[index] === "{") braces += 1;
    else if (source[index] === "}") braces -= 1;
    else if (source[index] === "[") brackets += 1;
    else if (source[index] === "]") brackets -= 1;
    else if (source[index] === "(") parentheses += 1;
    else if (source[index] === ")") parentheses -= 1;
  }

  return offsets;
}

function topLevelPatternMatches(source, expression) {
  const matches = [];
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (braces === 1 && brackets === 0 && parentheses === 0) {
      expression.lastIndex = index;
      const match = expression.exec(source);
      if (match?.index === index) matches.push(match);
    }
    if (source[index] === "{") braces += 1;
    else if (source[index] === "}") braces -= 1;
    else if (source[index] === "[") brackets += 1;
    else if (source[index] === "]") brackets -= 1;
    else if (source[index] === "(") parentheses += 1;
    else if (source[index] === ")") parentheses -= 1;
  }

  return matches;
}

function assertNoRedirectRuntimeMutation(source, code) {
  const memberMutation = /(?:\.[A-Za-z_$][\w$]*|\])\s*(?:\*\*=|&&=|\|\|=|\?\?=|\+=|-=|\*=|\/=|%=|=(?!=|>)|\+\+|--)/;
  const memberDelete = /\bdelete\s+(?:[A-Za-z_$][\w$]*\s*)?(?:\.|\[)/;
  const mutatorCall = /\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf|freeze|seal|preventExtensions)|Reflect\s*\.\s*(?:set|defineProperty|setPrototypeOf)|Function)\b/;
  const indirectConstructor = /\.\s*constructor\s*\(/;
  const legacyMutator = /\.\s*__define(?:Getter|Setter)__\s*\(/;
  const quotedPrototypeAccess = /\[\s*["'](?:prototype|__proto__)["']\s*\]/i;
  const computedMemberAccess = /(?:\b(?!return\b)[A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.\s*)?\[/;
  const forbiddenMutationPrimitive = /\b(?:Object|Reflect|Function|globalThis|prototype|__proto__|constructor|__defineGetter__|__defineSetter__)\b/i;
  const optionalChain = /\?\./;

  if (forbiddenMutationPrimitive.test(code)
    || memberMutation.test(code)
    || memberDelete.test(code)
    || mutatorCall.test(code)
    || indirectConstructor.test(code)
    || legacyMutator.test(code)
    || computedMemberAccess.test(code)
    || optionalChain.test(code)
    || quotedPrototypeAccess.test(source)) {
    throw new Error("next.config.ts contains a live mutation construct that can alter redirects() runtime semantics");
  }
}

function parseNextConfigLegacyRedirectsInternal(source, enforceReviewedSkeleton) {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > APP_ROUTE_MATRIX_LIMITS.nextConfigBytes) {
    throw new Error(`next.config.ts exceeds the ${APP_ROUTE_MATRIX_LIMITS.nextConfigBytes}-byte source limit`);
  }

  const code = maskCommentsAndStrings(source, { rejectTemplateExpressions: true });
  if (code.includes("\\")) {
    throw new Error("next.config.ts live code escapes are unsupported because they can hide redirect identifiers");
  }
  if (/\beval\b/.test(code)) {
    throw new Error("next.config.ts must not use eval because it can hide live redirect mutations");
  }
  assertNoRedirectRuntimeMutation(source, code);
  const configDeclarations = [...code.matchAll(/\bconst\s+nextConfig\s*:\s*NextConfig\s*=\s*\{/g)];
  if (configDeclarations.length !== 1) {
    throw new Error("next.config.ts must contain exactly one live typed nextConfig object");
  }
  const configDeclaration = configDeclarations[0];
  const configOpen = configDeclaration.index + configDeclaration[0].lastIndexOf("{");
  const configClose = matchingDelimiterEnd(code, configOpen, "{", "}", "nextConfig object");
  const configTerminator = skipJavaScriptTrivia(source, configClose + 1);
  if (source[configTerminator] !== ";") throw new Error("nextConfig object must end with a semicolon");

  const defaultExports = [...code.matchAll(/\bexport\s+default\s+nextConfig\s*;/g)];
  if (defaultExports.length !== 1) throw new Error("next.config.ts must directly export default nextConfig exactly once");
  const defaultExport = defaultExports[0];
  if (defaultExport.index <= configTerminator
    || code.slice(configTerminator + 1, defaultExport.index).trim()
    || code.slice(defaultExport.index + defaultExport[0].length).trim()) {
    throw new Error("nextConfig must be exported directly without intervening or trailing live code");
  }
  if ([...code.matchAll(/\bnextConfig\b/g)].length !== 2) {
    throw new Error("nextConfig must be referenced only by its typed declaration and direct default export");
  }

  const configCode = code.slice(configOpen, configClose + 1);
  if (hasTopLevelObjectSpread(configCode, 0, configCode.length - 1)) {
    throw new Error("nextConfig must not use a top-level object spread that can override redirects()");
  }
  if (hasTopLevelComputedMember(configCode, 0, configCode.length - 1)) {
    throw new Error("nextConfig must not use top-level computed members that can override redirects()");
  }
  if (hasTopLevelQuotedMember(configCode, 0, configCode.length - 1)) {
    throw new Error("nextConfig must not use top-level quoted members that can override redirects()");
  }
  const redirectMembers = topLevelIdentifierOffsets(configCode, "redirects");
  const canonicalMethods = topLevelPatternMatches(configCode, /async\s+redirects\s*\(\s*\)\s*\{/y);
  if (redirectMembers.length !== 1 || canonicalMethods.length !== 1) {
    throw new Error("exported nextConfig must contain exactly one depth-one async redirects() method");
  }

  const method = canonicalMethods[0];
  const methodOpen = method.index + method[0].lastIndexOf("{");
  const methodClose = matchingDelimiterEnd(configCode, methodOpen, "{", "}", "redirects() method");
  const absoluteMethodOpen = configOpen + methodOpen;
  const absoluteMethodClose = configOpen + methodClose;
  if (enforceReviewedSkeleton) {
    const skeleton = `${source.slice(0, absoluteMethodOpen + 1)}${NEXT_CONFIG_REDIRECT_SKELETON_MARKER}${source.slice(absoluteMethodClose)}`;
    const skeletonDigest = createHash("sha256").update(skeleton, "utf8").digest("hex").toUpperCase();
    if (skeletonDigest !== NEXT_CONFIG_REDIRECT_SKELETON_SHA256) {
      throw new Error("next.config.ts non-redirect skeleton does not match the reviewed contract");
    }
  }

  let cursor = absoluteMethodOpen + 1;
  cursor = expectRedirectToken(source, cursor, "return");
  const arrayStart = skipJavaScriptTrivia(source, cursor);
  if (/[\r\n\u2028\u2029]/.test(source.slice(cursor, arrayStart))) {
    throw new Error("redirects() return and its literal array must remain on the same line");
  }
  cursor = expectRedirectToken(source, cursor, "[");
  const redirects = [];

  while (cursor < source.length) {
    cursor = skipJavaScriptTrivia(source, cursor);
    if (source[cursor] === "]") {
      cursor += 1;
      break;
    }
    if (redirects.length >= APP_ROUTE_MATRIX_LIMITS.redirects) {
      throw new Error(`redirects() exceeds the ${APP_ROUTE_MATRIX_LIMITS.redirects}-row limit`);
    }

    cursor = expectRedirectToken(source, cursor, "{");
    cursor = expectRedirectToken(source, cursor, "source");
    cursor = expectRedirectToken(source, cursor, ":");
    cursor = skipJavaScriptTrivia(source, cursor);
    const from = readRedirectPathLiteral(source, cursor);
    cursor = expectRedirectToken(source, from.end, ",");
    cursor = expectRedirectToken(source, cursor, "destination");
    cursor = expectRedirectToken(source, cursor, ":");
    cursor = skipJavaScriptTrivia(source, cursor);
    const to = readRedirectPathLiteral(source, cursor);
    cursor = expectRedirectToken(source, to.end, ",");
    cursor = expectRedirectToken(source, cursor, "permanent");
    cursor = expectRedirectToken(source, cursor, ":");
    cursor = expectRedirectToken(source, cursor, "true");
    cursor = skipJavaScriptTrivia(source, cursor);
    if (source[cursor] === ",") cursor += 1;
    cursor = expectRedirectToken(source, cursor, "}");
    redirects.push({ source: from.value, destination: to.value, permanent: true });

    cursor = skipJavaScriptTrivia(source, cursor);
    if (source[cursor] === ",") {
      cursor += 1;
    } else if (source[cursor] !== "]") {
      throw new Error("redirect entries must be separated by commas");
    }
  }

  if (!redirects.length) throw new Error("redirects() did not contain any redirect entries");
  cursor = expectRedirectToken(source, cursor, ";");
  cursor = skipJavaScriptTrivia(source, cursor);
  if (cursor !== configOpen + methodClose) {
    throw new Error("redirects() must directly return only the literal redirect array");
  }
  return redirects.sort((left, right) => compareText(left.source, right.source));
}

export function parseNextConfigLegacyRedirects(source) {
  return parseNextConfigLegacyRedirectsInternal(source, true);
}

export function parseNextConfigLegacyRedirectsUnpinnedForTest(source) {
  return parseNextConfigLegacyRedirectsInternal(source, false);
}

export function compareRedirectContracts(expected, actual) {
  const collector = createFailureCollector();
  const { failures } = collector;
  const fail = (message) => collector.add(message);
  if (!Array.isArray(expected) || !Array.isArray(actual)) {
    fail("redirect contracts must both be arrays");
    return failures;
  }
  if (expected.length > APP_ROUTE_MATRIX_LIMITS.redirects) fail(`route matrix redirects exceed the ${APP_ROUTE_MATRIX_LIMITS.redirects}-row limit`);
  if (actual.length > APP_ROUTE_MATRIX_LIMITS.redirects) fail(`next.config.ts redirects exceed the ${APP_ROUTE_MATRIX_LIMITS.redirects}-row limit`);

  const expectedBySource = new Map();
  const actualBySource = new Map();
  for (const entry of expected.slice(0, APP_ROUTE_MATRIX_LIMITS.redirects)) {
    if (!entry || typeof entry !== "object" || !isRootRelativePath(entry.source) || !isRootRelativePath(entry.destination)) {
      fail("route matrix contains an invalid redirect contract");
      continue;
    }
    if (expectedBySource.has(entry.source)) fail(`route matrix duplicates redirect source ${entry.source}`);
    expectedBySource.set(entry.source, entry);
  }
  for (const entry of actual.slice(0, APP_ROUTE_MATRIX_LIMITS.redirects)) {
    if (!entry || typeof entry !== "object" || typeof entry.source !== "string" || typeof entry.destination !== "string") {
      fail("next.config.ts contains an invalid redirect contract");
      continue;
    }
    if (actualBySource.has(entry.source)) fail("next.config.ts contains a duplicate redirect source");
    actualBySource.set(entry.source, entry);
  }
  for (const [source, redirect] of actualBySource) {
    const documented = expectedBySource.get(source);
    if (!documented) fail("next.config.ts contains an undocumented redirect");
    else if (documented.destination !== redirect.destination || documented.permanent !== redirect.permanent) {
      fail(`Next redirect ${source} does not match the route matrix`);
    }
  }
  for (const [source, redirect] of expectedBySource) {
    if (!actualBySource.has(source)) fail(`documented redirect ${source} -> ${redirect.destination} is absent from next.config.ts`);
  }
  return failures;
}
