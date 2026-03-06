import { estimateTokens, trimToTokens } from "../utils/tokenEstimator.js";
import { stripHtml, replacePlaceholders } from "../utils/textCleaner.js";

function toSystem(content) {
  return { role: "system", content };
}

function buildCardText(cardDetail, charName, userName) {
  const clean = (text) => replacePlaceholders(stripHtml(text || ""), { charName, userName });
  return [
    `Character Name: ${charName}`,
    `Description: ${clean(cardDetail.description)}`,
    `Personality: ${clean(cardDetail.personality)}`,
    `Scenario: ${clean(cardDetail.scenario)}`,
  ].join("\n");
}

function buildLoreText(entries, charName, userName) {
  if (!entries || entries.length === 0) return "";
  return entries
    .map((e) => {
      const content = replacePlaceholders(e.content || "", { charName, userName });
      return `[${e.comment || e.uid || "lore"}] ${content}`;
    })
    .join("\n\n");
}

function buildMemoryText(memories, charName, userName, maxCharsPerItem = 320) {
  if (!Array.isArray(memories) || memories.length === 0) return "";
  const hardLimit = Math.max(80, Number(maxCharsPerItem) || 320);
  return memories
    .map((m) => {
      const role = m.role === "assistant" ? charName || "Character" : "User";
      const score = Number.isFinite(Number(m.score)) ? Number(m.score).toFixed(2) : "?";
      const raw = replacePlaceholders(m.content || "", { charName, userName });
      const compact = raw.replace(/\s+/g, " ").trim();
      const clipped = compact.length > hardLimit ? `${compact.slice(0, hardLimit - 1)}…` : compact;
      return `[turn ${m.turn_index}, role=${role}, score=${score}] ${clipped}`;
    })
    .join("\n");
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildPrompt({
  card,
  lorebookEntries,
  summary,
  recentTurns,
  retrievedMemories,
  userName,
  maxPromptTokens = 8000,
  tokenEstimator = estimateTokens,
  budget = {},
  memoryMaxCharsPerItem = 320,
}) {
  const budgets = {
    lorebook: 2000,
    example: 1000,
    summary: 1000,
    memory: 900,
    ...(budget || {}),
  };

  const cardDetail = card?.detail || {};
  const charName = cardDetail.name || card?.name || "";

  // Helper to clean and replace placeholders in any text field
  const rp = (text) => replacePlaceholders(text || "", { charName, userName });

  const rawSystemPrompt = cardDetail.system_prompt || "You are a roleplay assistant.";
  const fixedSystem = rp(rawSystemPrompt);
  const fixedCharacter = buildCardText(cardDetail, charName, userName);
  const fixedPostHistory = rp(cardDetail.post_history_instructions || "");

  let remaining = maxPromptTokens;
  const messages = [];

  const keepFixed = [toSystem(fixedSystem), toSystem(fixedCharacter)].filter((m) => m.content);
  if (fixedPostHistory) {
    keepFixed.push(toSystem(fixedPostHistory));
  }

  const fixedTokens = keepFixed.reduce((acc, m) => acc + tokenEstimator(m.content), 0);
  remaining -= fixedTokens;
  if (remaining < 0) {
    remaining = 0;
  }

  const loreText = trimToTokens(
    buildLoreText(lorebookEntries, charName, userName),
    Math.min(budgets.lorebook, remaining),
  );
  remaining -= tokenEstimator(loreText);

  const rawExample = rp(cardDetail.example_dialogue || "");
  const exampleText = trimToTokens(rawExample, Math.min(budgets.example, remaining));
  remaining -= tokenEstimator(exampleText);

  const summaryText = trimToTokens(summary?.summary_text || "", Math.min(budgets.summary, remaining));
  remaining -= tokenEstimator(summaryText);

  const memoryText = trimToTokens(
    buildMemoryText(retrievedMemories, charName, userName, memoryMaxCharsPerItem),
    Math.min(budgets.memory, remaining),
  );
  remaining -= tokenEstimator(memoryText);

  const recent = [];
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const t = recentTurns[i];
    // Replace placeholders in turn content (in case stored with raw placeholders)
    const content = rp(t.content || "");
    const tokenCost = tokenEstimator(content);
    if (tokenCost <= remaining) {
      recent.unshift({ role: t.role, content });
      remaining -= tokenCost;
    }
  }

  messages.push(toSystem(fixedSystem));
  messages.push(toSystem(fixedCharacter));
  if (loreText) {
    messages.push(toSystem(`Lorebook Entries:\n${loreText}`));
  }
  if (exampleText) {
    messages.push(toSystem(`Example Dialogue:\n${exampleText}`));
  }
  if (summaryText) {
    messages.push(toSystem(`Conversation Summary:\n${summaryText}`));
  }
  if (memoryText) {
    messages.push(toSystem(`Relevant Memory Recall:\n${memoryText}`));
  }
  messages.push(...recent);
  if (fixedPostHistory) {
    messages.push(toSystem(fixedPostHistory));
  }

  return {
    messages,
    tokenCount: messages.reduce((acc, msg) => acc + tokenEstimator(msg.content), 0),
    alternateGreetings: parseJsonArray(cardDetail.alternate_greetings_json),
  };
}
