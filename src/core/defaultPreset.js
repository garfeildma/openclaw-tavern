/**
 * Default SillyTavern OpenAI preset.
 * Based on https://github.com/SillyTavern/SillyTavern/blob/release/default/content/presets/openai/Default.json
 */
export const DEFAULT_PRESET = {
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 1,
    top_k: 0,
    repetition_penalty: 1,
    max_tokens: 300,
    stop_sequences_json: JSON.stringify([]),
    prompt_template_json: JSON.stringify({
        prompts: [
            {
                name: "Main Prompt",
                system_prompt: true,
                role: "system",
                content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
                identifier: "main",
            },
            {
                name: "Auxiliary Prompt",
                system_prompt: true,
                role: "system",
                content: "",
                identifier: "nsfw",
            },
            {
                identifier: "dialogueExamples",
                name: "Chat Examples",
                system_prompt: true,
                marker: true,
            },
            {
                name: "Post-History Instructions",
                system_prompt: true,
                role: "system",
                content: "",
                identifier: "jailbreak",
            },
            {
                identifier: "chatHistory",
                name: "Chat History",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "worldInfoAfter",
                name: "World Info (after)",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "worldInfoBefore",
                name: "World Info (before)",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "enhanceDefinitions",
                role: "system",
                name: "Enhance Definitions",
                content:
                    "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
                system_prompt: true,
                marker: false,
            },
            {
                identifier: "charDescription",
                name: "Char Description",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "charPersonality",
                name: "Char Personality",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "scenario",
                name: "Scenario",
                system_prompt: true,
                marker: true,
            },
            {
                identifier: "personaDescription",
                name: "Persona Description",
                system_prompt: true,
                marker: true,
            },
        ],
    }),
};

export const DEFAULT_PRESET_NAME = "Default";
