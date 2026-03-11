function compactText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const NEGATIVE_PATTERNS = [
  /(不要|不用|别|无需|不需要).{0,8}(图|图片|照片|自拍|风景|穿搭|样子|look|photo|picture|selfie)/i,
  /(别|不要).{0,8}(发|生成|来).{0,8}(图|图片|照片|自拍|photo|picture|selfie)/i,
];

const VOICE_NEGATIVE_PATTERNS = [
  /(不要|不用|别|无需|不需要).{0,8}(语音|声音|音频|朗读|念|说给我听|voice|audio)/i,
  /(别|不要).{0,8}(发|来|生成).{0,8}(语音|声音|音频|voice|audio)/i,
];

const POSITIVE_PATTERNS = [
  /给我看看.{0,12}(样子|长相|模样|照片|图片|自拍|look)/i,
  /(看看|看下|瞅瞅).{0,12}(你的样子|你长什么样|今天的穿搭|穿搭|周围的风景|周围|风景|照片|图片|自拍)/i,
  /(站起来|起身|转个圈|靠近点|走近点|让我仔细看看|给我仔细看看|抬头).{0,12}(你|你的样子|全身|脸|模样)?/i,
  /(来|发|整).{0,6}(一张|张|个)?\s*(照片|图片|自拍|look|photo|picture|selfie|风景照|全身照)/i,
  /(show me|let me see).{0,30}(what you look like|your outfit|the scenery|around you|a photo|a picture|a selfie)/i,
  /(send|share).{0,20}(a |one )?(photo|picture|selfie).{0,20}(of you|your outfit|around you|the scenery)/i,
  /(发|来).{0,8}(自拍|照片|图片)/i,
];

const OUTFIT_PATTERNS = [
  /穿搭|衣服|ootd|outfit|look/i,
];

const SCENERY_PATTERNS = [
  /风景|周围|附近|环境|窗外|景色|view|scenery|surroundings|around you/i,
];

const PORTRAIT_PATTERNS = [
  /样子|长相|模样|自拍|照片|图片|portrait|selfie|face|look like/i,
];

const VOICE_POSITIVE_PATTERNS = [
  /(说句话给我听|说给我听|读给我听|念给我听|发个语音|来段语音|语音回复|用语音|你的声音|听听你的声音)/i,
  /(send|share).{0,20}(a )?(voice|voice note|audio).{0,20}(to me|reply|message)/i,
  /(let me hear|i want to hear).{0,20}(your voice|you speak)/i,
];

const MODEL_FALLBACK_PATTERNS = [
  /(看|看看|看下|瞅瞅|仔细看看|观察|欣赏).{0,12}(你|你的|全身|脸|模样|打扮|周围|环境|风景)?/i,
  /(站起来|起身|转个圈|靠近点|走近点|抬头|让我看清楚)/i,
  /(听|听听|说|念|读).{0,12}(你|你的|声音|说话)?/i,
];

function normalizePhotoStyleHint(normalized) {
  if (matchesAny(normalized, OUTFIT_PATTERNS)) {
    return "outfit photo";
  }

  if (matchesAny(normalized, SCENERY_PATTERNS)) {
    return "scenery photo";
  }

  if (matchesAny(normalized, PORTRAIT_PATTERNS)) {
    return "portrait photo";
  }

  return "photo snapshot";
}

function hasNegativeMediaSignal(normalized) {
  return (
    matchesAny(normalized, NEGATIVE_PATTERNS) ||
    matchesAny(normalized, VOICE_NEGATIVE_PATTERNS)
  );
}

export function detectPhotoRequestIntent(text) {
  const normalized = compactText(text);
  if (!normalized) {
    return null;
  }

  if (matchesAny(normalized, NEGATIVE_PATTERNS)) {
    return null;
  }

  if (!matchesAny(normalized, POSITIVE_PATTERNS)) {
    return null;
  }

  const styleHint = normalizePhotoStyleHint(normalized);
  return {
    type:
      styleHint === "outfit photo"
        ? "outfit"
        : styleHint === "scenery photo"
          ? "scenery"
          : styleHint === "portrait photo"
            ? "portrait"
            : "photo",
    styleHint,
  };
}

export function detectVoiceRequestIntent(text) {
  const normalized = compactText(text);
  if (!normalized) {
    return null;
  }

  if (matchesAny(normalized, VOICE_NEGATIVE_PATTERNS)) {
    return null;
  }

  if (!matchesAny(normalized, VOICE_POSITIVE_PATTERNS)) {
    return null;
  }

  return {
    type: "voice",
  };
}

export function shouldClassifyMediaIntent(text) {
  const normalized = compactText(text);
  if (!normalized) {
    return false;
  }
  if (hasNegativeMediaSignal(normalized)) {
    return false;
  }
  if (detectPhotoRequestIntent(normalized) || detectVoiceRequestIntent(normalized)) {
    return false;
  }
  return matchesAny(normalized, MODEL_FALLBACK_PATTERNS);
}

export function inferPhotoStyleHint(text) {
  const normalized = compactText(text);
  if (!normalized) {
    return "photo snapshot";
  }
  return normalizePhotoStyleHint(normalized);
}

export async function classifyMediaIntentWithModel({
  modelProvider,
  text,
  allowImage = true,
  allowVoice = true,
  timeoutMs = 5000,
}) {
  if (!modelProvider?.generate || !text || (!allowImage && !allowVoice)) {
    return { image: false, voice: false };
  }

  const allowedLabel =
    allowImage && allowVoice
      ? "NONE, IMAGE, VOICE, BOTH"
      : allowImage
        ? "NONE, IMAGE"
        : "NONE, VOICE";

  const messages = [
    {
      role: "system",
      content: [
        "Classify the user's latest message.",
        "Decide whether they are asking for an automatically generated IMAGE, a VOICE reply, BOTH, or NONE.",
        "IMAGE means they want to see the assistant, outfit, pose, surroundings, or scenery.",
        "VOICE means they want to hear the assistant speak or send audio.",
        `Reply with exactly one label: ${allowedLabel}.`,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        "Examples:",
        "- 你站起来让我仔细看看你 => IMAGE",
        "- 说句话给我听 => VOICE",
        "- 给我看看你再说句话给我听 => BOTH",
        "- 继续聊 => NONE",
        "",
        `Message: ${String(text)}`,
      ].join("\n"),
    },
  ];

  let timeoutId = null;
  const timer = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("media intent classification timeout"));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      modelProvider.generate({
        prompt: { messages },
        modelConfig: { temperature: 0 },
      }),
      timer,
    ]);
    const raw = String(result?.content || "")
      .trim()
      .toUpperCase();

    const label = raw.match(/\b(BOTH|IMAGE|VOICE|NONE)\b/)?.[1] || "NONE";
    return {
      image: label === "IMAGE" || label === "BOTH",
      voice: label === "VOICE" || label === "BOTH",
    };
  } catch {
    return { image: false, voice: false };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
