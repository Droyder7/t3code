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
}

export type UserInputAnswerValue = string | number | boolean | ReadonlyArray<string>;

export type UserInputAnswerNormalization =
  | { readonly ok: true; readonly value: UserInputAnswerValue }
  | { readonly ok: false; readonly message: string };

export type UserInputAnswersValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly questionId: string; readonly message: string };

export function isMissingUserInputAnswer(rawAnswer: unknown): boolean {
  return rawAnswer === undefined || rawAnswer === null;
}

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
  if (typeof question.pattern === "string" && question.pattern.length > 0) {
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
    items = rawAnswer
      .filter((entry): entry is string | number | boolean => entry !== null && entry !== undefined)
      .map(String);
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
    return {
      ok: true,
      value: rawAnswer.filter((entry): entry is string => typeof entry === "string"),
    };
  }
  return { ok: false, message: "Enter a valid value." };
}

export function normalizeUserInputAnswer(
  question: UserInputValidationQuestion,
  rawAnswer: unknown,
): UserInputAnswerNormalization {
  if (isMissingUserInputAnswer(rawAnswer)) {
    return { ok: false, message: "Answer this question." };
  }
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
