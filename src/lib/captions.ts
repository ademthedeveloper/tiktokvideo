import type {
  CaptionStyle,
  CaptionVariant,
  Settings,
  TikTokVideo,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  handle: "",
  creditPrefix: "cr:",
  creditMode: "username",
  creditPlacement: "bottom",
  defaultStyle: "verbatim",
  includeOriginal: true,
  keepOriginalHashtags: true,
  stripMentions: false,
  stripBoilerplate: true,
  emojiMode: "keep",
  packs: ["relatable", "funny"],
  extraHashtags: [],
  blockedHashtags: [],
  maxHashtags: 6,
  maxCaptionLength: 2200,
  footer: "",
  defaultRegion: "US",
  autoSave: false,
};

export const STYLE_META: Record<CaptionStyle, { label: string; blurb: string }> =
  {
    verbatim: {
      label: "Original + credit",
      blurb: "Keeps the creator's caption exactly, adds your credit line.",
    },
    relatable: {
      label: "Relatable hook",
      blurb: "Adds a short 'this is literally me' hook above the caption.",
    },
    pov: {
      label: "POV frame",
      blurb: "Rewraps the caption as a POV line. Very repostable.",
    },
    question: {
      label: "Comment bait",
      blurb: "Ends with a question to farm comments and re-shares.",
    },
    shoutout: {
      label: "Credit first",
      blurb: "Credit at the top so nobody misses it, caption below.",
    },
    minimal: {
      label: "Minimal",
      blurb: "First line only + credit + tags. Clean and short.",
    },
  };

export const STYLE_ORDER: CaptionStyle[] = [
  "verbatim",
  "relatable",
  "pov",
  "question",
  "shoutout",
  "minimal",
];

export const HASHTAG_PACKS: Record<string, { label: string; tags: string[] }> = {
  relatable: {
    label: "Relatable core",
    tags: [
      "relatable",
      "relatablememes",
      "relatablecontent",
      "fyp",
      "foryoupage",
      "viral",
      "trending",
    ],
  },
  funny: {
    label: "Funny / memes",
    tags: ["funny", "comedy", "memes", "funnymemes", "lol", "humor", "meme"],
  },
  school: {
    label: "School",
    tags: ["school", "schoolmemes", "highschool", "student", "exam", "teacher"],
  },
  work: {
    label: "Work / 9-5",
    tags: ["work", "workmemes", "office", "job", "9to5", "coworker", "boss"],
  },
  gym: {
    label: "Gym",
    tags: ["gym", "gymmemes", "gymrat", "fitness", "workout", "legday"],
  },
  love: {
    label: "Relationships",
    tags: ["relationship", "couple", "dating", "crush", "love", "couplegoals"],
  },
  home: {
    label: "Family / home",
    tags: ["family", "mom", "dad", "siblings", "parents", "home"],
  },
  pets: {
    label: "Pets",
    tags: ["cat", "dog", "pets", "catsoftiktok", "dogsoftiktok", "funnycat"],
  },
  gaming: {
    label: "Gaming",
    tags: ["gaming", "gamer", "minecraft", "roblox", "fortnite", "gamingmemes"],
  },
  nightowl: {
    label: "Late night",
    tags: ["latenight", "3am", "sleep", "insomnia", "nightowl", "tired"],
  },
  food: {
    label: "Food",
    tags: ["food", "foodie", "snack", "cooking", "foodtiktok"],
  },
  money: {
    label: "Money / adulting",
    tags: ["adulting", "money", "broke", "budget", "payday", "responsibility"],
  },
};

const NICHE_HINTS: { pack: keyof typeof HASHTAG_PACKS; words: string[] }[] = [
  { pack: "school", words: ["school", "exam", "teacher", "class", "homework", "college", "university", "student", "math", "test"] },
  { pack: "work", words: ["work", "boss", "office", "shift", "job", "coworker", "meeting", "9 to 5", "salary", "manager"] },
  { pack: "gym", words: ["gym", "workout", "leg day", "protein", "squat", "bench", "trainer", "fitness"] },
  { pack: "love", words: ["boyfriend", "girlfriend", "crush", "date", "dating", "relationship", "ex", "marriage", "wife", "husband"] },
  { pack: "home", words: ["mom", "dad", "mother", "father", "sister", "brother", "family", "parents", "grandma", "grandpa"] },
  { pack: "pets", words: ["cat", "dog", "puppy", "kitten", "pet", "hamster", "bird"] },
  { pack: "gaming", words: ["game", "gaming", "minecraft", "roblox", "fortnite", "xbox", "playstation", "steam", "ranked"] },
  { pack: "nightowl", words: ["3am", "sleep", "bed", "tired", "insomnia", "late night", "awake", "nap"] },
  { pack: "food", words: ["food", "eat", "snack", "cook", "recipe", "hungry", "pizza", "coffee"] },
  { pack: "money", words: ["money", "broke", "rent", "payday", "bill", "budget", "adulting", "salary", "bank"] },
];

const HOOKS: Record<string, string[]> = {
  relatable: [
    "why is this literally me 💀",
    "i felt this in my soul",
    "not me seeing myself in this",
    "this is way too accurate",
    "someone leaked my life 😭",
    "real ones will understand",
    "i don't make the rules, this is just us",
    "tell me you're the same without telling me",
  ],
  question: [
    "am i the only one?",
    "tell me i'm not alone in this",
    "does anyone else do this?",
    "tag someone who is exactly like this",
    "why does nobody talk about this?",
    "be honest, is this you too?",
  ],
  pov: [
    "POV:",
    "pov:",
    "POV —",
  ],
  shoutout: [
    "found this gem on my fyp",
    "had to repost this one",
    "this deserved more views",
    "saving this forever",
  ],
};

const BOOST_EMOJI: { words: string[]; emoji: string }[] = [
  { words: ["sad", "cry", "crying", "depressed", "lonely", "miss"], emoji: "😭" },
  { words: ["funny", "laugh", "lmao", "dead", "haha", "joke"], emoji: "💀" },
  { words: ["love", "crush", "boyfriend", "girlfriend", "cute"], emoji: "🥺" },
  { words: ["angry", "mad", "annoying", "hate"], emoji: "😤" },
  { words: ["tired", "sleep", "exhausted", "work"], emoji: "😮‍💨" },
  { words: ["food", "eat", "hungry", "snack"], emoji: "🍽️" },
  { words: ["school", "exam", "test", "homework"], emoji: "📚" },
  { words: ["gym", "workout"], emoji: "💪" },
];

const BOILERPLATE: RegExp[] = [
  /check out .*?on tiktok.*/gi,
  /check out tiktok'?s? .*?community.*?today!?.*/gi,
  /tiktok\W+s .*?community today!?/gi,
  /watch .*? on tiktok.*/gi,
  /♫.*$/gu,
  /\(original sound\)/gi,
  /original sound\s*[-–]\s*\S+/gi,
];

export const TIKTOK_CAPTION_LIMIT = 4000;
export const VISIBLE_BEFORE_MORE = 92;

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;

function stripEmoji(input: string): string {
  return input.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

export function extractHashtags(caption: string): string[] {
  const found = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (!seen.has(key) && tag.length > 1) {
      seen.add(key);
      out.push(tag.slice(1));
    }
  }
  return out;
}

export function extractMentions(caption: string): string[] {
  return caption.match(/@[A-Za-z0-9_.]+/g) ?? [];
}

/** Clean a raw TikTok caption into something safe to repost. */
export function cleanCaption(raw: string, settings: Settings): string {
  let text = (raw ?? "").replace(/\r/g, "");
  if (settings.stripBoilerplate) {
    for (const pattern of BOILERPLATE) text = text.replace(pattern, " ");
  }
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/vm\.tiktok\.com\/\S+/gi, " ");
  if (settings.stripMentions) text = text.replace(/@[A-Za-z0-9_.]+/g, " ");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => line.length > 0 || index === 0 || index === all.length - 1)
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (settings.emojiMode === "strip") text = stripEmoji(text);
  return text;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ?? "";
}

function detectPacks(body: string, hashtags: string[]): string[] {
  const haystack = `${body} ${hashtags.join(" ")}`.toLowerCase();
  const detected: string[] = [];
  for (const hint of NICHE_HINTS) {
    if (hint.words.some((word) => haystack.includes(word))) detected.push(hint.pack);
  }
  return detected.slice(0, 2);
}

function boostEmoji(body: string): string {
  const lower = body.toLowerCase();
  const match = BOOST_EMOJI.find((entry) => entry.words.some((w) => lower.includes(w)));
  const emoji = match?.emoji ?? "😭";
  if (body.includes(emoji)) return body;
  return `${body} ${emoji}`;
}

function buildCredit(video: TikTokVideo, settings: Settings): string {
  const prefix = (settings.creditPrefix || "cr:").trim();
  const user = video.authorUsername || "unknown";
  const nick = video.authorNickname || user;
  let who = `@${user}`;
  if (settings.creditMode === "nickname") who = nick;
  if (settings.creditMode === "both") who = `@${user} (${nick})`;
  return prefix.endsWith(":") || prefix.endsWith(" ") ? `${prefix} ${who}`.trim() : `${prefix} ${who}`.trim();
}

function assembleTags(
  video: TikTokVideo,
  body: string,
  settings: Settings,
): string[] {
  const originalTags = extractHashtags(video.caption ?? "");
  const detected = detectPacks(body, originalTags);
  const ordered: string[] = [];
  const push = (tag: string) => {
    const clean = tag.replace(/^#/, "").trim().toLowerCase();
    if (!clean || clean.length > 40) return;
    if (settings.blockedHashtags.some((b) => b.toLowerCase() === clean)) return;
    if (!ordered.some((t) => t.toLowerCase() === clean)) ordered.push(clean);
  };

  if (settings.keepOriginalHashtags) originalTags.forEach(push);
  for (const pack of settings.packs) HASHTAG_PACKS[pack]?.tags.forEach(push);
  for (const pack of detected) HASHTAG_PACKS[pack]?.tags.slice(0, 3).forEach(push);
  settings.extraHashtags.forEach(push);

  const max = Math.max(0, Math.min(20, settings.maxHashtags));
  return ordered.slice(0, max);
}

function visibleLine(text: string): string {
  const line = firstLine(text);
  if (line.length <= VISIBLE_BEFORE_MORE) return line;
  return `${line.slice(0, VISIBLE_BEFORE_MORE - 1).trimEnd()}… more`;
}

function compose(
  style: CaptionStyle,
  video: TikTokVideo,
  settings: Settings,
  seed: number,
): CaptionVariant {
  const warnings: string[] = [];
  const cleaned = cleanCaption(video.caption ?? "", settings);
  const lead = firstLine(cleaned);
  const base = settings.includeOriginal
    ? cleaned || "(the creator posted this with no caption)"
    : "";
  const credit = buildCredit(video, settings);

  const pick = (list: string[]) => list[seed % list.length];

  let bodyText = base;
  switch (style) {
    case "verbatim":
      bodyText = base;
      break;
    case "relatable":
      bodyText = `${pick(HOOKS.relatable)}\n\n${base}`.trim();
      break;
    case "pov": {
      const line = lead.toLowerCase().startsWith("pov") ? lead.slice(3).replace(/^[:\-—]\s*/, "") : lead;
      const rest = cleaned.split("\n").slice(1).join("\n").trim();
      bodyText = `POV: ${line || base}${rest ? `\n\n${rest}` : ""}`;
      break;
    }
    case "question":
      bodyText = `${base}\n\n${pick(HOOKS.question)}`.trim();
      break;
    case "shoutout":
      bodyText = `${pick(HOOKS.shoutout)} 👇\n\n${base}`.trim();
      break;
    case "minimal":
      bodyText = lead || base;
      break;
  }

  if (settings.emojiMode === "boost") bodyText = boostEmoji(bodyText);

  const tags = assembleTags(video, bodyText, settings);
  const tagLine = tags.map((t) => `#${t}`).join(" ");
  const footer = (settings.footer || "").trim();

  const blocks: string[] = [];
  if (settings.creditPlacement === "top") blocks.push(credit);
  if (bodyText) blocks.push(bodyText);
  if (settings.creditPlacement === "inline" && bodyText) {
    const last = blocks.length - 1;
    blocks[last] = `${blocks[last]} — ${credit}`;
  } else if (settings.creditPlacement === "bottom") {
    blocks.push(credit);
  }
  if (settings.creditPlacement === "top" && !bodyText) blocks.push(credit);
  if (footer) blocks.push(footer);
  if (tagLine) blocks.push(tagLine);

  let text = blocks.filter(Boolean).join("\n\n");

  const limit = Math.max(120, settings.maxCaptionLength);
  if (text.length > limit) {
    warnings.push(`Trimmed from ${text.length} to ${limit} chars`);
    const keep = Math.max(20, limit - tagLine.length - credit.length - 8);
    text = `${bodyText.slice(0, keep).trimEnd()}…\n\n${
      settings.creditPlacement === "top" ? `${credit}\n\n` : ""
    }${credit}\n\n${tagLine}`.trim();
    if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
  }
  if (text.length > TIKTOK_CAPTION_LIMIT) warnings.push("Over TikTok's 4000 char limit");
  if (!cleaned) warnings.push("Source video has no caption — credit line carries it");
  if (video.authorUsername && /unknown/i.test(video.authorUsername))
    warnings.push("Creator handle could not be resolved");

  return {
    style,
    label: STYLE_META[style].label,
    text,
    body: bodyText,
    credit,
    tags,
    length: text.length,
    visibleLine: visibleLine(text),
    warnings,
  };
}

/** Generate every style for one clip, user's default style first. */
export function buildVariants(
  video: TikTokVideo,
  settings: Settings,
  seed = 0,
): CaptionVariant[] {
  const rest = STYLE_ORDER.filter((s) => s !== settings.defaultStyle);
  const order = [settings.defaultStyle, ...rest];
  return order.map((style, index) => compose(style, video, settings, seed + index));
}

export function buildVariant(
  video: TikTokVideo,
  settings: Settings,
  style: CaptionStyle,
  seed = 0,
): CaptionVariant {
  return compose(style, video, settings, seed);
}

export function creditLine(video: TikTokVideo, settings: Settings): string {
  return buildCredit(video, settings);
}

export function parseList(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^#/, "").replace(/^@/, "").trim())
    .filter(Boolean);
}

export function settingsFromRow(row: Record<string, unknown>): Settings {
  const list = (value: unknown) =>
    typeof value === "string" ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
  return {
    ...DEFAULT_SETTINGS,
    handle: String(row.handle ?? ""),
    creditPrefix: String(row.creditPrefix ?? "cr:"),
    creditMode: (row.creditMode as Settings["creditMode"]) ?? "username",
    creditPlacement: (row.creditPlacement as Settings["creditPlacement"]) ?? "bottom",
    defaultStyle: (row.defaultStyle as Settings["defaultStyle"]) ?? "verbatim",
    includeOriginal: Boolean(row.includeOriginal),
    keepOriginalHashtags: Boolean(row.keepOriginalHashtags),
    stripMentions: Boolean(row.stripMentions),
    stripBoilerplate: Boolean(row.stripBoilerplate),
    emojiMode: (row.emojiMode as Settings["emojiMode"]) ?? "keep",
    packs: list(row.packs),
    extraHashtags: list(row.extraHashtags),
    blockedHashtags: list(row.blockedHashtags),
    maxHashtags: Number(row.maxHashtags ?? 6),
    maxCaptionLength: Number(row.maxCaptionLength ?? 2200),
    footer: String(row.footer ?? ""),
    defaultRegion: String(row.defaultRegion ?? "US"),
    autoSave: Boolean(row.autoSave),
  };
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
