/**
 * Utility functions for cleaning and formatting text in RP outputs.
 */

/**
 * Strip HTML tags and convert basic HTML entities to plain text.
 * Preserves line breaks from <br>, <p>, <div> tags.
 */
export function stripHtml(input) {
    if (typeof input !== "string") return input;
    let text = input;
    // Replace block-level tags with line breaks
    text = text.replace(/<\s*(br|BR)\s*\/?>/gi, "\n");
    text = text.replace(/<\s*\/?\s*(p|div|blockquote|h[1-6]|li|tr)\s*[^>]*>/gi, "\n");
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, "");
    // Decode common HTML entities
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#x27;/g, "'");
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
    // Collapse excessive blank lines
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}

/**
 * Replace SillyTavern placeholders like {{char}}, {{user}},
 * {{Char}}, {{User}} in text.
 */
export function replacePlaceholders(text, { charName, userName } = {}) {
    if (typeof text !== "string") return text;
    let result = text;
    if (charName) {
        result = result.replace(/\{\{char\}\}/gi, charName);
    }
    if (userName) {
        result = result.replace(/\{\{user\}\}/gi, userName);
    }
    return result;
}

/**
 * Clean a card field: strip HTML + replace placeholders.
 */
export function cleanCardText(text, { charName, userName } = {}) {
    if (typeof text !== "string") return text;
    return replacePlaceholders(stripHtml(text), { charName, userName });
}
