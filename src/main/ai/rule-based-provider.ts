import type { PageCategory, PageMetadata, ProviderPrediction } from '../../shared/classification.js';
import type { ClassificationProvider } from './provider.js';

type Lexicon = Partial<Record<Exclude<PageCategory, 'other'>, string[]>>;

/** Keyword lexicon. Multi-word phrases are matched as phrases. */
const LEXICON: Lexicon = {
  study: [
    'tutorial', 'course', 'lecture', 'lesson', 'learn', 'learning', 'exam', 'homework', 'assignment', 'syllabus',
    'university', 'college', 'research', 'paper', 'theorem', 'algorithm', 'practice problems', 'quiz', 'textbook',
    'study', 'notes', 'curriculum', 'mooc', 'calculus', 'physics', 'chemistry', 'biology', 'programming',
    'data structures', 'leetcode', 'khan academy', 'arxiv', 'education', 'educational', 'science & technology', 'howto',
    'explained', 'course lecture', 'tutorial for beginners', 'crash course', 'full course', 'one shot', 'in one shot',
    'java', 'python', 'javascript', 'c++', 'dsa', 'sql', 'machine learning', 'react js', 'web development', 'coding',
    'mathematics', 'maths', 'math', 'algebra', 'geometry', 'statistics', 'economics', 'accountancy', 'history notes',
    'jee', 'neet', 'upsc', 'gate exam', 'ncert', 'cbse', 'class 10', 'class 11', 'class 12', 'board exam', 'revision',
    'physics wallah', 'unacademy', 'nptel', 'mit opencourseware', 'freecodecamp', 'lecture series', 'chapter'
  ],
  reference: [
    'wikipedia', 'encyclopedia', 'dictionary', 'definition', 'documentation', 'docs', 'reference', 'manual',
    'api reference', 'glossary', 'specification', 'handbook', 'wiki'
  ],
  productivity: [
    'calendar', 'inbox', 'email', 'mail', 'spreadsheet', 'todo', 'to-do', 'tasks', 'project management', 'kanban',
    'workspace', 'notion', 'drive', 'meeting', 'docs editor'
  ],
  news: ['news', 'breaking', 'headlines', 'politics', 'election', 'opinion', 'editorial', 'reporter', 'latest news', 'live updates'],
  social: [
    'followers', 'following', 'feed', 'tweet', 'retweet', 'post', 'posts', 'profile', 'friends', 'social network',
    'community', 'subreddit', 'comments', 'like and share', 'stories', 'reels', 'dm', 'messenger'
  ],
  entertainment: [
    'watch', 'video', 'videos', 'movie', 'movies', 'film', 'episode', 'season', 'series', 'streaming', 'music',
    'song', 'playlist', 'trailer', 'celebrity', 'meme', 'memes', 'funny', 'anime', 'tv show', 'shorts', 'vlog',
    'comedy', 'entertainment', 'film & animation', 'people & blogs', 'prank', 'reaction', 'compilation', '#shorts'
  ],
  shopping: [
    'buy', 'cart', 'add to cart', 'price', 'shop', 'store', 'deal', 'deals', 'sale', 'discount', 'checkout',
    'order', 'free shipping', 'product', 'products', 'coupon'
  ],
  sports: [
    'cricket', 'highlights', 'match highlights', 'innings', 'wickets', 'runs', 'ipl', 'odi', 't20', 'test match', 'asia cup',
    'world cup', 'football', 'soccer', 'premier league', 'la liga', 'champions league', 'goals', 'nba', 'nfl', 'fifa',
    'tennis', 'grand slam', 'formula 1', 'f1', 'motogp', 'wwe', 'ufc', 'boxing', 'live score', 'scorecard', 'sports',
    'tournament', 'league'
  ],
  gaming: [
    'game', 'games', 'gaming', 'play now', 'multiplayer', 'esports', 'gamer', 'walkthrough', 'speedrun', 'twitch',
    'console', 'playstation', 'xbox', 'nintendo', 'steam'
  ]
};

const FIELD_WEIGHTS = {
  // Platform genre (YouTube "Education", "Comedy"...) is the strongest single signal.
  genre: 5,
  host: 3,
  title: 3,
  siteName: 2,
  description: 2,
  keywords: 2,
  headings: 2,
  ogType: 1,
  textSample: 1
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATTERNS = Object.entries(LEXICON).map(([category, terms]) => ({
  category: category as PageCategory,
  patterns: (terms ?? []).map((term) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, 'i'))
}));

function countMatches(text: string, patterns: RegExp[]): number {
  if (!text) {
    return 0;
  }
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

/**
 * Deterministic, offline keyword classifier. It is the default provider (no
 * page data leaves the machine) and the fallback when another provider fails.
 */
export function classifyByRules(metadata: PageMetadata): ProviderPrediction {
  const fields: Record<keyof typeof FIELD_WEIGHTS, string> = {
    genre: metadata.genre ?? '',
    host: metadata.host.replace(/[.-]/g, ' '),
    title: metadata.title,
    siteName: metadata.siteName,
    description: metadata.description,
    keywords: metadata.keywords.join(' '),
    headings: metadata.headings.join(' '),
    ogType: metadata.ogType,
    textSample: metadata.textSample
  };

  const scores = PATTERNS.map(({ category, patterns }) => ({
    category,
    score: (Object.keys(FIELD_WEIGHTS) as Array<keyof typeof FIELD_WEIGHTS>).reduce(
      (total, field) => total + countMatches(fields[field], patterns) * FIELD_WEIGHTS[field],
      0
    )
  })).sort((a, b) => b.score - a.score);

  const [top, second] = scores;
  const total = scores.reduce((sum, entry) => sum + entry.score, 0);

  if (!top || top.score < 3) {
    return { category: 'other', confidence: 0.3, rationale: 'Too few signals to classify confidently.' };
  }

  // Confidence grows with the winning share and the margin over the runner-up.
  const share = top.score / total;
  const margin = (top.score - (second?.score ?? 0)) / top.score;
  const strength = Math.min(1, top.score / 12);
  const confidence = Math.min(0.95, 0.35 + 0.3 * share + 0.15 * margin + 0.15 * strength);

  return {
    category: top.category,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `Keyword signals favour ${top.category}.`
  };
}

export class RuleBasedProvider implements ClassificationProvider {
  readonly id = 'rule-based';
  readonly label = 'Built-in keyword rules (offline)';

  isAvailable(): boolean {
    return true;
  }

  async classify(metadata: PageMetadata): Promise<ProviderPrediction> {
    return classifyByRules(metadata);
  }
}
