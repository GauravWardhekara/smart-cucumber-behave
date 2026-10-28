/**
 * Formats a selected snippet of execution logs into a structured prompt
 * for AI / Agent Chat.
 */
export function formatAgentChatPrompt(logSnippet: string): string {
  const trimmed = logSnippet.trim();
  return [
    "Here is a selected section from my Cucumber-Behave execution log:",
    "",
    "```log",
    trimmed,
    "```",
    "",
    "Please analyze this execution log section, diagnose any errors, failures, or unexpected behaviors, and suggest fixes or next steps."
  ].join("\n");
}

