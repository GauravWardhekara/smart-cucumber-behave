import * as vscode from "vscode";
import { LOG } from "../log";
import { formatAgentChatPrompt } from "./agentChatPrompt";

export { formatAgentChatPrompt };

/**
 * Sends the selected execution log section to Agent Chat.
 *
 * 1. Formats the prompt with execution log context.
 * 2. Writes the prompt to the system clipboard for immediate availability and fallback.
 * 3. Inspects registered VS Code commands to find and trigger the active Chat provider
 *    (e.g., standard VS Code Chat `workbench.action.chat.open`, Antigravity agent chat,
 *    Copilot Chat, or quick chat).
 * 4. Displays user feedback on status.
 */
export async function sendExecutionLogToAgentChat(rawText: string): Promise<boolean> {
  const text = (rawText || "").trim();
  if (!text) {
    void vscode.window.showWarningMessage(
      "No execution log text was selected to send to Agent Chat."
    );
    return false;
  }

  const prompt = formatAgentChatPrompt(text);

  // Always copy to clipboard as an immediate convenience and fallback
  try {
    await vscode.env.clipboard.writeText(prompt);
  } catch (err) {
    LOG.warn("Failed to copy execution log to clipboard:", err);
  }

  let availableCommands: Set<string>;
  try {
    availableCommands = new Set(await vscode.commands.getCommands(true));
  } catch {
    availableCommands = new Set();
  }

  // Known candidate chat commands across VS Code, Antigravity, Copilot, and Cursor
  const chatCandidates: Array<{ id: string; args?: unknown }> = [
    { id: "workbench.action.chat.open", args: { query: prompt } },
    { id: "workbench.action.chat.open", args: prompt },
    { id: "antigravity.openChat", args: { query: prompt } },
    { id: "antigravity.openChat", args: prompt },
    { id: "antigravity.chat.open", args: { query: prompt } },
    { id: "antigravity.chat.open", args: prompt },
    { id: "antigravity.action.chat.open", args: { query: prompt } },
    { id: "gemini.chat.open", args: { query: prompt } },
    { id: "workbench.action.quickchat.open", args: { query: prompt } },
    { id: "workbench.action.quickchat.open", args: prompt },
    { id: "workbench.panel.chat.view.copilot.focus" },
    { id: "workbench.action.chat.newChat" }
  ];

  let opened = false;
  for (const candidate of chatCandidates) {
    if (availableCommands.has(candidate.id)) {
      try {
        if (candidate.args !== undefined) {
          await vscode.commands.executeCommand(candidate.id, candidate.args);
        } else {
          await vscode.commands.executeCommand(candidate.id);
        }
        opened = true;
        break;
      } catch (cmdErr) {
        LOG.warn(`Chat command ${candidate.id} invocation failed:`, cmdErr);
      }
    }
  }

  if (opened) {
    void vscode.window.showInformationMessage(
      "Execution log sent to Agent Chat (also copied to clipboard)."
    );
    return true;
  }

  // Dynamic fallback: look for any command that resembles a chat open command
  for (const cmd of availableCommands) {
    if (cmd.includes("chat") && (cmd.includes("open") || cmd.includes("focus"))) {
      try {
        await vscode.commands.executeCommand(cmd, { query: prompt });
        opened = true;
        break;
      } catch {
        try {
          await vscode.commands.executeCommand(cmd);
          opened = true;
          break;
        } catch {
          // ignore
        }
      }
    }
  }

  if (opened) {
    void vscode.window.showInformationMessage(
      "Execution log sent to Agent Chat (also copied to clipboard)."
    );
    return true;
  }

  void vscode.window.showInformationMessage(
    "Execution log copied to clipboard. Paste it into your Agent Chat to continue."
  );
  return false;
}

