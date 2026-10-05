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

  it("stringifies primitive entries in untyped arrays and drops the rest", () => {
    expect(normalizeUserInputAnswer(question(), ["a", 1, true])).toEqual({
      ok: true,
      value: ["a", "1", "true"],
    });
    expect(normalizeUserInputAnswer(question(), ["a", { nope: true }, null, "b"])).toEqual({
      ok: true,
      value: ["a", "b"],
    });
  });

  it("rejects answers outside a fixed option list", () => {
    const fixed = question({
      allowCustomAnswer: false,
      options: [
        { label: "Server", value: "srv" },
        { label: "Web", value: "web" },
      ],
    });
    expect(normalizeUserInputAnswer(fixed, "srv")).toEqual({ ok: true, value: "srv" });
    expect(normalizeUserInputAnswer(fixed, "bogus")).toEqual({
      ok: false,
      message: "Choose from the provided options.",
    });
    expect(
      normalizeUserInputAnswer(question({ ...fixed, valueType: "array" }), ["srv", "bogus"]),
    ).toEqual({ ok: false, message: "Choose from the provided options." });
    expect(
      normalizeUserInputAnswer(question({ ...fixed, valueType: "array" }), ["srv", "web"]),
    ).toEqual({ ok: true, value: ["srv", "web"] });
  });

  it("rejects a boolean answer outside a narrowed boolean domain", () => {
    const onlyTrue = question({
      valueType: "boolean",
      allowCustomAnswer: false,
      options: [{ label: "true", value: "true" }],
    });
    expect(normalizeUserInputAnswer(onlyTrue, "true")).toEqual({ ok: true, value: true });
    expect(normalizeUserInputAnswer(onlyTrue, "false")).toEqual({
      ok: false,
      message: "Choose from the provided options.",
    });
  });

  it("matches valueless options by label and leaves custom-answer questions open", () => {
    const byLabel = question({
      allowCustomAnswer: false,
      options: [{ label: "Server" }, { label: "Web" }],
    });
    expect(normalizeUserInputAnswer(byLabel, "Web")).toEqual({ ok: true, value: "Web" });
    expect(normalizeUserInputAnswer(byLabel, "Other")).toEqual({
      ok: false,
      message: "Choose from the provided options.",
    });
    const open = question({
      options: [{ label: "Server" }],
    });
    expect(normalizeUserInputAnswer(open, "Anything")).toEqual({ ok: true, value: "Anything" });
  });

  it("ignores patterns that could backtrack catastrophically", () => {
    const dangerous = [
      "^(a+)+$",
      "^(a|aa)+$",
      "^(\\w+\\s?)*$",
      "^((a+)b)*$",
      ".*a.*b.*c.*d.*",
      "(a)\\1",
      "(?<=x)a",
      "a{1,99999}",
    ];
    for (const pattern of dangerous) {
      expect(
        normalizeUserInputAnswer(question({ valueType: "string", pattern }), "anything"),
      ).toEqual({
        ok: true,
        value: "anything",
      });
    }
  });

  it("still enforces patterns that pass the safety screen", () => {
    expect(
      normalizeUserInputAnswer(question({ valueType: "string", pattern: "^[a-z]+$" }), "Nope"),
    ).toEqual({ ok: false, message: "Enter a value in the expected format." });
    expect(
      normalizeUserInputAnswer(
        question({ valueType: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" }),
        "1.2.3",
      ),
    ).toEqual({ ok: true, value: "1.2.3" });
    expect(
      normalizeUserInputAnswer(
        question({ valueType: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" }),
        "1.2.x",
      ),
    ).toEqual({ ok: false, message: "Enter a value in the expected format." });
  });

  it("skips pattern checks for answers beyond the length cap", () => {
    const longAnswer = "a".repeat(300);
    expect(
      normalizeUserInputAnswer(question({ valueType: "string", pattern: "^[a-z]+$" }), longAnswer),
    ).toEqual({ ok: true, value: longAnswer });
  });
});
