type ErrorLike = {
  message?: string | null;
  error_description?: string | null;
  details?: string | null;
  hint?: string | null;
};

export function toDisplayError(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message);
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  if (error && typeof error === "object") {
    const value = error as ErrorLike;
    const parts = [value.message, value.error_description, value.details]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    if (typeof value.hint === "string" && value.hint.trim()) {
      parts.push(`Hint: ${value.hint.trim()}`);
    }

    if (parts.length > 0) {
      return new Error(parts.join(" "));
    }
  }

  return new Error(fallback);
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return toDisplayError(error, fallback).message;
}
