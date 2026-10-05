/**
 * Shared validation for user input questions.
 *
 * Constraint fields travel on the question model so the server can reject an answer at dispatch
 * time while the form is still open for correction, and so clients can validate before submitting.
 * `normalizeUserInputAnswer` is also the adapter's final coercion step; a value that fails here is
 * dropped there only as a backstop.
 *
 * A missing answer means the key is absent, `undefined`, or `null`. An empty string is *not*
 * missing: clients send it when attachments carry the answer, and the elicitation content keeps it.
 * Malformed provider constraints (non-numeric bounds, invalid regular expressions) are ignored
 * rather than guessed at.
 *
 * A question with `allowCustomAnswer: false` treats its option list as the declared value
 * domain: any answer outside it is rejected. Provider-supplied `pattern`s run on shared event
 * loops, so only patterns whose backtracking is provably bounded are executed — anything else
 * is ignored like a malformed pattern, and pattern checking is advisory (a skipped pattern
 * never blocks submission).
 */

export interface UserInputValidationQuestion {
  readonly id: string;
  readonly required?: boolean | undefined;
  readonly valueType?: "string" | "number" | "integer" | "boolean" | "array" | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly exclusiveMinimum?: number | undefined;
  readonly exclusiveMaximum?: number | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly pattern?: string | undefined;
  readonly minItems?: number | undefined;
  readonly maxItems?: number | undefined;
  readonly allowCustomAnswer?: boolean | undefined;
  readonly options?:
    | ReadonlyArray<{
        readonly label: string;
        readonly value?: string | undefined;
      }>
    | undefined;
}

export type UserInputAnswerValue = string | number | boolean | ReadonlyArray<string>;

export type UserInputAnswerNormalization =
  | { readonly ok: true; readonly value: UserInputAnswerValue }
  | { readonly ok: false; readonly message: string };

export type UserInputAnswersValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly questionId: string; readonly message: string };

function isMissingUserInputAnswer(rawAnswer: unknown): boolean {
  return rawAnswer === undefined || rawAnswer === null;
}

// Only primitives stringified by clients are accepted into array answers; anything else
// (objects, null) is dropped rather than stringified into "[object Object]".
const isAnswerPrimitive = (entry: unknown): entry is string | number | boolean =>
  typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean";

function normalizeBooleanAnswer(rawAnswer: unknown): UserInputAnswerNormalization {
  const first = Array.isArray(rawAnswer) ? rawAnswer[0] : rawAnswer;
  if (typeof first === "boolean") return { ok: true, value: first };
  if (first === "true") return { ok: true, value: true };
  if (first === "false") return { ok: true, value: false };
  return { ok: false, message: "Choose Yes or No." };
}

function normalizeNumberAnswer(
  question: UserInputValidationQuestion,
  rawAnswer: unknown,
): UserInputAnswerNormalization {
  const first = Array.isArray(rawAnswer) ? rawAnswer[0] : rawAnswer;
  const num =
    typeof first === "number"
      ? first
      : typeof first === "string" && first.trim().length > 0
        ? Number(first)
        : Number.NaN;
  if (!Number.isFinite(num)) return { ok: false, message: "Enter a number." };
  if (question.valueType === "integer" && !Number.isInteger(num)) {
    return { ok: false, message: "Enter a whole number." };
  }
  if (typeof question.minimum === "number" && num < question.minimum) {
    return { ok: false, message: `Enter a value of at least ${question.minimum}.` };
  }
  if (typeof question.maximum === "number" && num > question.maximum) {
    return { ok: false, message: `Enter a value of at most ${question.maximum}.` };
  }
  if (typeof question.exclusiveMinimum === "number" && num <= question.exclusiveMinimum) {
    return { ok: false, message: `Enter a value greater than ${question.exclusiveMinimum}.` };
  }
  if (typeof question.exclusiveMaximum === "number" && num >= question.exclusiveMaximum) {
    return { ok: false, message: `Enter a value less than ${question.exclusiveMaximum}.` };
  }
  return { ok: true, value: num };
}

// Provider-supplied patterns execute on shared event loops (the server orchestrator and the
// clients), where a catastrophic-backtracking regex would hang the whole app. Only patterns
// whose backtracking is provably bounded are executed: no lookarounds or backreferences, no
// quantified group containing a quantifier or alternation (the exponential shape, at any
// nesting depth), at most three unbounded quantifiers, and no large bounded repeats. With the
// answer-length cap, a screened match costs at most ~256^3 character comparisons — a few
// milliseconds, never a hang. Patterns that fail the screen are ignored like malformed ones;
// pattern checking is advisory and never blocks submission.
const PATTERN_MAX_LENGTH = 200;
const PATTERN_MAX_ANSWER_LENGTH = 256;
const PATTERN_MAX_UNBOUNDED_QUANTIFIERS = 3;
const PATTERN_MAX_REPEAT = 512;

function isSafeUserInputPattern(pattern: string): boolean {
  if (pattern.length > PATTERN_MAX_LENGTH) return false;
  let unboundedQuantifiers = 0;
  let lastClosedGroupRisky = false;
  let inCharClass = false;
  const groupRiskStack: boolean[] = [];
  const markCurrentGroupRisky = () => {
    if (groupRiskStack.length > 0) {
      groupRiskStack[groupRiskStack.length - 1] = true;
    }
  };
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (inCharClass) {
      if (char === "\\") index++;
      else if (char === "]") inCharClass = false;
      continue;
    }
    if (char === "\\") {
      // Backreferences make matching NP-hard and defeat the bounded-backtracking proof.
      const next = pattern[index + 1];
      if (next !== undefined && next >= "1" && next <= "9") return false;
      index++;
      lastClosedGroupRisky = false;
      continue;
    }
    if (char === "[") {
      inCharClass = true;
      lastClosedGroupRisky = false;
      continue;
    }
    if (char === "(") {
      if (pattern[index + 1] === "?") {
        const after = pattern[index + 2];
        if (after === "=" || after === "!") return false;
        if (after === "<") {
          const behind = pattern[index + 3];
          if (behind === "=" || behind === "!") return false;
        }
      }
      groupRiskStack.push(false);
      lastClosedGroupRisky = false;
      continue;
    }
    if (char === ")") {
      const risky = groupRiskStack.pop() ?? false;
      if (risky) markCurrentGroupRisky();
      lastClosedGroupRisky = risky;
      continue;
    }
    if (char === "|") {
      markCurrentGroupRisky();
      lastClosedGroupRisky = false;
      continue;
    }
    const isStarOrPlus = char === "*" || char === "+";
    const isBrace = char === "{";
    if (!isStarOrPlus && !isBrace && char !== "?") {
      lastClosedGroupRisky = false;
      continue;
    }
    // Quantifier tokens. Repeating a group that itself contains a quantifier or an
    // alternation is the classic exponential shape; `?` cannot repeat, so it is exempt.
    if (char !== "?" && lastClosedGroupRisky) return false;
    markCurrentGroupRisky();
    lastClosedGroupRisky = false;
    if (isStarOrPlus) {
      unboundedQuantifiers++;
      if (unboundedQuantifiers > PATTERN_MAX_UNBOUNDED_QUANTIFIERS) return false;
      continue;
    }
    if (isBrace) {
      const close = pattern.indexOf("}", index);
      const bounds = close === -1 ? undefined : pattern.slice(index + 1, close);
      const match = bounds?.match(/^(\d+)(?:,(\d*))?$/);
      if (bounds !== undefined && match) {
        const isOpenEnded = bounds.includes(",") && (match[2] ?? "").length === 0;
        if (isOpenEnded) {
          unboundedQuantifiers++;
          if (unboundedQuantifiers > PATTERN_MAX_UNBOUNDED_QUANTIFIERS) return false;
        }
        if (Number(match[1]) > PATTERN_MAX_REPEAT) return false;
        if (
          match[2] !== undefined &&
          match[2].length > 0 &&
          Number(match[2]) > PATTERN_MAX_REPEAT
        ) {
          return false;
        }
        index = close;
      }
      // A `{` that does not parse as a quantifier is a literal brace; the RegExp
      // constructor reports genuinely malformed patterns.
    }
  }
  return true;
}

function normalizeStringAnswer(
  question: UserInputValidationQuestion,
  rawAnswer: unknown,
): UserInputAnswerNormalization {
  let value: string;
  if (typeof rawAnswer === "string") {
    value = rawAnswer;
  } else if (typeof rawAnswer === "number" || typeof rawAnswer === "boolean") {
    value = String(rawAnswer);
  } else if (Array.isArray(rawAnswer) && rawAnswer.length > 0) {
    value = String(rawAnswer[0]);
  } else {
    return { ok: false, message: "Enter a value." };
  }
  if (typeof question.minLength === "number" && value.length < question.minLength) {
    return { ok: false, message: `Enter at least ${question.minLength} characters.` };
  }
  if (typeof question.maxLength === "number" && value.length > question.maxLength) {
    return { ok: false, message: `Enter at most ${question.maxLength} characters.` };
  }
  if (
    typeof question.pattern === "string" &&
    question.pattern.length > 0 &&
    value.length <= PATTERN_MAX_ANSWER_LENGTH &&
    isSafeUserInputPattern(question.pattern)
  ) {
    try {
      if (!new RegExp(question.pattern).test(value)) {
        return { ok: false, message: "Enter a value in the expected format." };
      }
    } catch {
      // A malformed provider pattern is ignored rather than guessed at.
    }
  }
  return { ok: true, value };
}

function normalizeArrayAnswer(
  question: UserInputValidationQuestion,
  rawAnswer: unknown,
): UserInputAnswerNormalization {
  let items: string[];
  if (Array.isArray(rawAnswer)) {
    items = rawAnswer.filter(isAnswerPrimitive).map(String);
  } else if (typeof rawAnswer === "string" && rawAnswer.length > 0) {
    items = [rawAnswer];
  } else if (typeof rawAnswer === "number" || typeof rawAnswer === "boolean") {
    items = [String(rawAnswer)];
  } else {
    items = [];
  }
  if (typeof question.minItems === "number" && items.length < question.minItems) {
    return {
      ok: false,
      message: `Select at least ${question.minItems} option${question.minItems === 1 ? "" : "s"}.`,
    };
  }
  if (typeof question.maxItems === "number" && items.length > question.maxItems) {
    return {
      ok: false,
      message: `Select at most ${question.maxItems} option${question.maxItems === 1 ? "" : "s"}.`,
    };
  }
  return { ok: true, value: items };
}

function normalizeUntypedAnswer(rawAnswer: unknown): UserInputAnswerNormalization {
  if (typeof rawAnswer === "string" || typeof rawAnswer === "boolean") {
    return { ok: true, value: rawAnswer };
  }
  if (typeof rawAnswer === "number") {
    return Number.isFinite(rawAnswer)
      ? { ok: true, value: rawAnswer }
      : { ok: false, message: "Enter a valid value." };
  }
  if (Array.isArray(rawAnswer)) {
    // Untyped arrays are stringified like the typed array path instead of silently
    // dropping entries, so a numeric answer list survives the fallback path intact.
    return { ok: true, value: rawAnswer.filter(isAnswerPrimitive).map(String) };
  }
  return { ok: false, message: "Enter a valid value." };
}

// A fixed option list (`allowCustomAnswer: false`) is the declared value domain of the
// provider's schema, so an answer outside it is rejected rather than sent to the agent.
// Boolean and numeric options store stringified values, which `String()` reproduces from
// the coerced scalar.
function enforceAllowedOptions(
  question: UserInputValidationQuestion,
  value: UserInputAnswerValue,
): UserInputAnswerNormalization {
  if (
    question.allowCustomAnswer !== false ||
    question.options === undefined ||
    question.options.length === 0
  ) {
    return { ok: true, value };
  }
  const allowed = new Set(question.options.map((option) => option.value ?? option.label));
  const entries = Array.isArray(value) ? value : [String(value)];
  return entries.every((entry) => allowed.has(entry))
    ? { ok: true, value }
    : { ok: false, message: "Choose from the provided options." };
}

export function normalizeUserInputAnswer(
  question: UserInputValidationQuestion,
  rawAnswer: unknown,
): UserInputAnswerNormalization {
  if (isMissingUserInputAnswer(rawAnswer)) {
    return { ok: false, message: "Answer this question." };
  }
  const normalized = ((): UserInputAnswerNormalization => {
    switch (question.valueType) {
      case "boolean":
        return normalizeBooleanAnswer(rawAnswer);
      case "integer":
      case "number":
        return normalizeNumberAnswer(question, rawAnswer);
      case "array":
        return normalizeArrayAnswer(question, rawAnswer);
      case "string":
        return normalizeStringAnswer(question, rawAnswer);
      default:
        return normalizeUntypedAnswer(rawAnswer);
    }
  })();
  if (!normalized.ok) return normalized;
  return enforceAllowedOptions(question, normalized.value);
}

export function validateUserInputAnswers(
  questions: ReadonlyArray<UserInputValidationQuestion>,
  answers: Readonly<Record<string, unknown>>,
): UserInputAnswersValidation {
  for (const question of questions) {
    const rawAnswer = Object.prototype.hasOwnProperty.call(answers, question.id)
      ? answers[question.id]
      : undefined;
    if (isMissingUserInputAnswer(rawAnswer)) {
      if (question.required === false) continue;
      return { ok: false, questionId: question.id, message: "Answer this question." };
    }
    const normalized = normalizeUserInputAnswer(question, rawAnswer);
    if (!normalized.ok) {
      return { ok: false, questionId: question.id, message: normalized.message };
    }
  }
  return { ok: true };
}
