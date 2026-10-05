import { describe, expect, it } from "@effect/vitest";

import {
  normalizeUserInputAnswer,
  validateUserInputAnswers,
  type UserInputValidationQuestion,
} from "./userInputValidation.ts";

const question = (
  overrides: Partial<UserInputValidationQuestion> = {},
): UserInputValidationQuestion => ({ id: "field", ...overrides });

describe("validateUserInputAnswers", () => {
  it("treats missing answers as errors unless the question is optional", () => {
    expect(validateUserInputAnswers([question()], {})).toEqual({
      ok: false,
      questionId: "field",
      message: "Answer this question.",
    });
    expect(validateUserInputAnswers([question({ required: false })], {})).toEqual({ ok: true });
    expect(validateUserInputAnswers([question()], { field: null })).toEqual({
      ok: false,
      questionId: "field",
      message: "Answer this question.",
    });
  });

  it("accepts answers that satisfy every constraint", () => {
    expect(
      validateUserInputAnswers(
        [
          question({ valueType: "integer", minimum: 1, maximum: 10 }),
          question({ id: "name", valueType: "string", minLength: 2 }),
        ],
        { field: "5", name: "ok" },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects constraint violations with the failing question id", () => {
    expect(
      validateUserInputAnswers([question({ valueType: "number", maximum: 50 })], {
        field: "100",
      }),
    ).toEqual({ ok: false, questionId: "field", message: "Enter a value of at most 50." });
    expect(
      validateUserInputAnswers([question({ valueType: "array", minItems: 2 })], {
        field: ["one"],
      }),
    ).toEqual({ ok: false, questionId: "field", message: "Select at least 2 options." });
  });
});

describe("normalizeUserInputAnswer", () => {
  it("parses numbers and enforces integer, inclusive, and exclusive bounds", () => {
    expect(normalizeUserInputAnswer(question({ valueType: "integer" }), "8080")).toEqual({
      ok: true,
      value: 8080,
    });
    expect(normalizeUserInputAnswer(question({ valueType: "integer" }), "3.5")).toEqual({
      ok: false,
      message: "Enter a whole number.",
    });
    expect(normalizeUserInputAnswer(question({ valueType: "number", minimum: 5 }), "4")).toEqual({
      ok: false,
      message: "Enter a value of at least 5.",
    });
    expect(
      normalizeUserInputAnswer(question({ valueType: "number", exclusiveMinimum: 0 }), "0"),
    ).toEqual({ ok: false, message: "Enter a value greater than 0." });
    expect(
      normalizeUserInputAnswer(question({ valueType: "number", exclusiveMaximum: 10 }), "10"),
    ).toEqual({ ok: false, message: "Enter a value less than 10." });
    expect(normalizeUserInputAnswer(question({ valueType: "number" }), "NaN")).toEqual({
      ok: false,
      message: "Enter a number.",
    });
  });

  it("coerces booleans and rejects other values", () => {
    expect(normalizeUserInputAnswer(question({ valueType: "boolean" }), "true")).toEqual({
      ok: true,
      value: true,
    });
    expect(normalizeUserInputAnswer(question({ valueType: "boolean" }), ["false"])).toEqual({
      ok: true,
      value: false,
    });
    expect(normalizeUserInputAnswer(question({ valueType: "boolean" }), "yes")).toEqual({
      ok: false,
      message: "Choose Yes or No.",
    });
  });

  it("keeps empty strings as answers and enforces string constraints", () => {
    expect(normalizeUserInputAnswer(question({ valueType: "string" }), "")).toEqual({
      ok: true,
      value: "",
    });
    expect(normalizeUserInputAnswer(question({ valueType: "string", minLength: 3 }), "ab")).toEqual(
      { ok: false, message: "Enter at least 3 characters." },
    );
    expect(
      normalizeUserInputAnswer(question({ valueType: "string", maxLength: 2 }), "abc"),
    ).toEqual({ ok: false, message: "Enter at most 2 characters." });
    expect(
      normalizeUserInputAnswer(question({ valueType: "string", pattern: "^[a-z]+$" }), "Nope"),
    ).toEqual({ ok: false, message: "Enter a value in the expected format." });
  });

  it("ignores malformed constraints instead of guessing", () => {
    expect(
      normalizeUserInputAnswer(question({ valueType: "string", pattern: "([" }), "anything"),
    ).toEqual({ ok: true, value: "anything" });
    expect(
      normalizeUserInputAnswer(
        question({ valueType: "number", minimum: "10" as unknown as number }),
        "5",
      ),
    ).toEqual({ ok: true, value: 5 });
  });

  it("normalizes array answers and enforces item counts", () => {
    expect(normalizeUserInputAnswer(question({ valueType: "array" }), "single")).toEqual({
      ok: true,
      value: ["single"],
    });
    expect(normalizeUserInputAnswer(question({ valueType: "array" }), ["a", "b"])).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(
      normalizeUserInputAnswer(question({ valueType: "array", maxItems: 1 }), ["a", "b"]),
    ).toEqual({ ok: false, message: "Select at most 1 option." });
  });

  it("falls back gracefully for untyped questions", () => {
    expect(normalizeUserInputAnswer(question(), "value")).toEqual({ ok: true, value: "value" });
    expect(normalizeUserInputAnswer(question(), ["first", "second"])).toEqual({
      ok: true,
      value: ["first", "second"],
    });
    expect(normalizeUserInputAnswer(question(), { nope: true })).toEqual({
      ok: false,
      message: "Enter a valid value.",
    });
  });
});
