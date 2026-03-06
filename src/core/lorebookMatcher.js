export function matchLorebookEntries(entries, recentMessages) {
  const corpus = recentMessages.map((m) => m.content || "").join("\n");

  const active = [];
  for (const entry of entries || []) {
    if (entry.enabled === false) {
      continue;
    }
    if (entry.constant === true) {
      active.push(entry);
      continue;
    }

    const content = entry.case_sensitive ? corpus : corpus.toLowerCase();
    const keys = (entry.keys || []).map((k) => (entry.case_sensitive ? String(k) : String(k).toLowerCase()));
    const secondaries = (entry.secondary_keys || []).map((k) => (entry.case_sensitive ? String(k) : String(k).toLowerCase()));

    const primaryMatched = keys.length > 0 && keys.some((k) => content.includes(k));
    if (!primaryMatched) {
      continue;
    }

    if (entry.selective === true) {
      const secondaryMatched = secondaries.length > 0 && secondaries.some((k) => content.includes(k));
      if (!secondaryMatched) {
        continue;
      }
    }

    active.push(entry);
  }

  active.sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) {
      return (b.priority || 0) - (a.priority || 0);
    }
    return (a.insertion_order || 0) - (b.insertion_order || 0);
  });

  return active;
}
