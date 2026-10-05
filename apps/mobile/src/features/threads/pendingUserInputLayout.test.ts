import { describe, expect, it } from "vite-plus/test";

import {
  derivePendingUserInputMaxHeight,
  pendingUserInputKeyboardType,
} from "./pendingUserInputLayout";

describe("pendingUserInputKeyboardType", () => {
  it("keeps the number-pad for nonnegative integer questions", () => {
    expect(pendingUserInputKeyboardType({ valueType: "integer", minimum: 0 })).toBe("number-pad");
    expect(pendingUserInputKeyboardType({ valueType: "integer", minimum: 1024 })).toBe(
      "number-pad",
    );
  });

  it("uses a punctuation layout when integers can be negative", () => {
    expect(pendingUserInputKeyboardType({ valueType: "integer" })).toBe("numbers-and-punctuation");
    expect(pendingUserInputKeyboardType({ valueType: "integer", minimum: -10 })).toBe(
      "numbers-and-punctuation",
    );
  });

  it("preserves decimal-pad for numbers and default for everything else", () => {
    expect(pendingUserInputKeyboardType({ valueType: "number" })).toBe("decimal-pad");
    expect(pendingUserInputKeyboardType({ valueType: "string" })).toBe("default");
    expect(pendingUserInputKeyboardType({})).toBe("default");
  });
});

describe("derivePendingUserInputMaxHeight", () => {
  it("caps a tall portrait viewport", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 932,
        keyboardHeight: 0,
        navigationHeaderHeight: 103,
        composerOverlapHeight: 94,
      }),
    ).toBe(560);
  });

  it("subtracts the keyboard while editing a custom answer", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 932,
        keyboardHeight: 336,
        navigationHeaderHeight: 103,
        composerOverlapHeight: 94,
      }),
    ).toBe(387);
  });

  it("keeps the fixed action area usable in a short keyboard-open viewport", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 375,
        keyboardHeight: 240,
        navigationHeaderHeight: 44,
        composerOverlapHeight: 94,
      }),
    ).toBe(160);
  });
});
