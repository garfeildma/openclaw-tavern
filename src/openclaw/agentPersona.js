import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { replacePlaceholders, stripHtml } from "../utils/textCleaner.js";

const MANAGED_SOUL_BEGIN = "<!-- openclaw-rp-plugin:soul:begin -->";
const MANAGED_SOUL_END = "<!-- openclaw-rp-plugin:soul:end -->";
const DEFAULT_AGENT_ID = "main";

function compactText(value, { charName, userName } = {}) {
  const replaced = replacePlaceholders(stripHtml(value || ""), { charName, userName });
  return replaced.replace(/\s+/g, " ").trim();
}

export function buildManagedSoulOverride({ cardDetail, cardName, userName }) {
  const charName = cardDetail?.name || cardName || "Character";
  const description = compactText(cardDetail?.description, { charName, userName });
  const personality = compactText(cardDetail?.personality, { charName, userName });
  const scenario = compactText(cardDetail?.scenario, { charName, userName });
  const systemPrompt = compactText(cardDetail?.system_prompt, { charName, userName });

  const lines = [
    "# Active RP Persona Override",
    "",
    "Treat the following role as the active OpenClaw persona.",
    "When it conflicts with any generic assistant tone, prioritize this RP persona.",
    "",
    `Character: ${charName}`,
  ];

  if (description) {
    lines.push(`Description: ${description}`);
  }
  if (personality) {
    lines.push(`Personality: ${personality}`);
  }
  if (scenario) {
    lines.push(`Scenario: ${scenario}`);
  }
  if (systemPrompt) {
    lines.push(`Role Instruction: ${systemPrompt}`);
  }

  lines.push("", "Stay in character and answer as this character during RP.");
  return lines.join("\n").trim();
}

export function mergeManagedSoulOverride(existingContent, managedContent) {
  const managedBlock = `${MANAGED_SOUL_BEGIN}\n${managedContent.trim()}\n${MANAGED_SOUL_END}`;
  const existing = String(existingContent || "");

  if (existing.includes(MANAGED_SOUL_BEGIN) && existing.includes(MANAGED_SOUL_END)) {
    return existing.replace(
      new RegExp(`${MANAGED_SOUL_BEGIN}[\\s\\S]*?${MANAGED_SOUL_END}`, "m"),
      managedBlock,
    );
  }

  const trimmed = existing.trim();
  if (!trimmed) {
    return `${managedBlock}\n`;
  }

  return `${managedBlock}\n\n${trimmed}\n`;
}

export function removeManagedSoulOverride(existingContent) {
  const existing = String(existingContent || "");
  if (!existing.includes(MANAGED_SOUL_BEGIN) || !existing.includes(MANAGED_SOUL_END)) {
    return { content: existing, removed: false };
  }
  const cleaned = existing
    .replace(
      new RegExp(`${MANAGED_SOUL_BEGIN}[\\s\\S]*?${MANAGED_SOUL_END}`, "m"),
      "",
    )
    .replace(/^\n{2,}/, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content: cleaned ? `${cleaned}\n` : "", removed: true };
}

export async function syncManagedSoulOverride({ workspaceDir, managedContent }) {
  if (!workspaceDir || !managedContent) {
    return { updated: false, soulPath: null };
  }

  const soulPath = path.join(workspaceDir, "SOUL.md");
  let existing = "";
  try {
    existing = await readFile(soulPath, "utf8");
  } catch {
    existing = "";
  }

  const next = mergeManagedSoulOverride(existing, managedContent);
  if (next === existing) {
    return { updated: false, soulPath };
  }

  await writeFile(soulPath, next, "utf8");
  return { updated: true, soulPath };
}

export async function restoreSoul({ workspaceDir }) {
  if (!workspaceDir) {
    return { restored: false, soulPath: null };
  }

  const soulPath = path.join(workspaceDir, "SOUL.md");
  let existing = "";
  try {
    existing = await readFile(soulPath, "utf8");
  } catch {
    return { restored: false, soulPath, reason: "file_not_found" };
  }

  const { content, removed } = removeManagedSoulOverride(existing);
  if (!removed) {
    return { restored: false, soulPath, reason: "no_managed_block" };
  }

  await writeFile(soulPath, content, "utf8");
  return { restored: true, soulPath };
}

function resolveDefaultAgentWorkspaceDir(env = process.env, homedir = os.homedir) {
  const home = String(env.HOME || homedir() || "").trim();
  const profile = String(env.OPENCLAW_PROFILE || "").trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".openclaw", `workspace-${profile}`);
  }
  return path.join(home, ".openclaw", "workspace");
}

function normalizeAgentId(value) {
  return String(value || "").trim() || DEFAULT_AGENT_ID;
}

export function resolvePersonaWorkspaceDir({ workspaceDir, apiConfig, env = process.env }) {
  if (workspaceDir) {
    return path.resolve(String(workspaceDir));
  }

  const agents = Array.isArray(apiConfig?.agents?.list) ? apiConfig.agents.list : [];
  const defaultAgent = agents.find((entry) => entry?.default) || agents[0] || null;
  const defaultAgentId = normalizeAgentId(defaultAgent?.id);
  const agentWorkspace = String(defaultAgent?.workspace || "").trim();
  if (agentWorkspace) {
    return path.resolve(agentWorkspace);
  }

  const defaultWorkspace = String(apiConfig?.agents?.defaults?.workspace || "").trim();
  if (defaultWorkspace) {
    return path.resolve(defaultWorkspace);
  }

  if (defaultAgentId !== DEFAULT_AGENT_ID) {
    const stateDir = String(env.OPENCLAW_STATE_DIR || path.join(String(env.HOME || ""), ".openclaw")).trim();
    return path.resolve(path.join(stateDir, `workspace-${defaultAgentId}`));
  }

  return path.resolve(resolveDefaultAgentWorkspaceDir(env));
}
