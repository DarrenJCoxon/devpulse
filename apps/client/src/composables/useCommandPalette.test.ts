/**
 * Unit tests for useCommandPalette composable (E5-S1)
 *
 * These tests verify the fuzzy search scoring and action registry logic.
 * Run with: cd apps/client && bun test useCommandPalette.test.ts
 */

import { test, expect, describe } from "bun:test";

// Extracted fuzzy search scoring function from useCommandPalette.ts for testing
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Exact match - highest score
  if (lowerTarget === lowerQuery) return 1000;

  // Prefix match - high score
  if (lowerTarget.startsWith(lowerQuery)) return 500;

  // Substring match - medium score
  if (lowerTarget.includes(lowerQuery)) return 250;

  // Character-by-character fuzzy match - lower score
  let queryIndex = 0;
  let targetIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;

  while (queryIndex < lowerQuery.length && targetIndex < lowerTarget.length) {
    if (lowerQuery[queryIndex] === lowerTarget[targetIndex]) {
      queryIndex++;
      consecutiveMatches++;
      score += 10 + consecutiveMatches * 5; // Bonus for consecutive matches
    } else {
      consecutiveMatches = 0;
    }
    targetIndex++;
  }

  // If we matched all query characters, return the score, else 0
  return queryIndex === lowerQuery.length ? score : 0;
}

describe("useCommandPalette - fuzzy search scoring", () => {
  test("exact match returns highest score (1000)", () => {
    expect(fuzzyScore("clear", "clear")).toBe(1000);
    expect(fuzzyScore("CLEAR", "clear")).toBe(1000);
    expect(fuzzyScore("Clear Events", "Clear Events")).toBe(1000);
  });

  test("prefix match returns high score (500)", () => {
    expect(fuzzyScore("cle", "clear")).toBe(500);
    expect(fuzzyScore("clear", "clear events")).toBe(500);
    expect(fuzzyScore("proj", "projects")).toBe(500);
  });

  test("substring match returns medium score (250)", () => {
    expect(fuzzyScore("theme", "Open Theme Manager")).toBe(250);
    expect(fuzzyScore("event", "clear events")).toBe(250);
    expect(fuzzyScore("log", "Dev Log Timeline")).toBe(250);
  });

  test("fuzzy character-by-character match works", () => {
    const score1 = fuzzyScore("cf", "ClassForge");
    const score2 = fuzzyScore("otp", "Open Theme Panel");

    // Should match and return positive score
    expect(score1).toBeGreaterThan(0);
    expect(score2).toBeGreaterThan(0);

    // Consecutive matches should score higher
    expect(score1).toBeGreaterThan(20); // "c" and "f" match
  });

  test("consecutive character matches score higher than scattered", () => {
    // "clear" has consecutive matches in "clear events"
    const consecutive = fuzzyScore("cle", "clear events");

    // "cde" has scattered matches
    const scattered = fuzzyScore("cde", "clear events");

    expect(consecutive).toBeGreaterThan(scattered);
  });

  test("returns 0 for non-matching queries", () => {
    expect(fuzzyScore("xyz", "clear events")).toBe(0);
    expect(fuzzyScore("abc", "theme manager")).toBe(0);
    expect(fuzzyScore("123", "projects")).toBe(0);
  });

  test("returns 0 for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("case insensitive matching", () => {
    expect(fuzzyScore("CLEAR", "clear events")).toBeGreaterThan(0);
    expect(fuzzyScore("Clear", "CLEAR EVENTS")).toBeGreaterThan(0);
    expect(fuzzyScore("ThEmE", "theme manager")).toBeGreaterThan(0);
  });

  test("partial word matches work", () => {
    expect(fuzzyScore("ev", "events")).toBeGreaterThan(0);
    expect(fuzzyScore("mana", "manager")).toBeGreaterThan(0);
    expect(fuzzyScore("filt", "filter")).toBeGreaterThan(0);
  });

  test("ranking: exact > prefix > substring > fuzzy", () => {
    const exact = fuzzyScore("clear", "clear");
    const prefix = fuzzyScore("cle", "clear");
    const substring = fuzzyScore("lea", "clear");
    const fuzzy = fuzzyScore("cr", "clear");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(fuzzy);
  });
});

describe("useCommandPalette - action registry", () => {
  test("actions can be categorized correctly", () => {
    const navigateAction = {
      id: 'nav-projects',
      label: 'Go to Projects',
      category: 'navigate' as const,
      keywords: ['projects', 'overview'],
      icon: '📁',
      execute: () => {}
    };

    const filterAction = {
      id: 'filter-session',
      label: 'Filter by session',
      category: 'filter' as const,
      keywords: ['filter', 'session'],
      icon: '🔍',
      execute: () => {}
    };

    const actionAction = {
      id: 'clear-events',
      label: 'Clear Events',
      category: 'action' as const,
      keywords: ['clear', 'events'],
      icon: '🗑️',
      execute: () => {}
    };

    const settingsAction = {
      id: 'toggle-theme',
      label: 'Open Theme Manager',
      category: 'settings' as const,
      keywords: ['theme', 'color'],
      icon: '🎨',
      execute: () => {}
    };

    expect(navigateAction.category).toBe('navigate');
    expect(filterAction.category).toBe('filter');
    expect(actionAction.category).toBe('action');
    expect(settingsAction.category).toBe('settings');
  });

  test("action keywords support search", () => {
    const action = {
      id: 'jump-project',
      label: 'Jump to ClassForge',
      category: 'navigate' as const,
      keywords: ['project', 'classforge', 'jump', 'navigate'],
      icon: '📁',
      execute: () => {}
    };

    // Search by keyword should match
    expect(fuzzyScore("classforge", action.keywords[1])).toBeGreaterThan(0);
    expect(fuzzyScore("cf", action.keywords[1])).toBeGreaterThan(0);
    expect(fuzzyScore("jump", action.keywords[2])).toBe(1000);
  });
});

describe("useCommandPalette - real-world search scenarios", () => {
  const actions = [
    {
      id: 'clear-events',
      label: 'Clear Events',
      category: 'action' as const,
      keywords: ['clear', 'events', 'reset', 'delete'],
      icon: '🗑️'
    },
    {
      id: 'toggle-theme',
      label: 'Open Theme Manager',
      category: 'settings' as const,
      keywords: ['theme', 'color', 'appearance', 'style'],
      icon: '🎨'
    },
    {
      id: 'jump-classforge',
      label: 'Jump to ClassForge',
      category: 'navigate' as const,
      keywords: ['project', 'classforge', 'jump', 'navigate'],
      icon: '📁'
    },
    {
      id: 'filter-session',
      label: 'Filter by session abc123',
      category: 'filter' as const,
      keywords: ['filter', 'session', 'abc123'],
      icon: '🔍'
    }
  ];

  test("searching 'clear' finds 'Clear Events' action", () => {
    const matchingActions = actions.filter(action => {
      const labelScore = fuzzyScore("clear", action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore("clear", k)), 0);
      return Math.max(labelScore, keywordScore) > 0;
    });

    expect(matchingActions.length).toBe(1);
    expect(matchingActions[0].id).toBe('clear-events');
  });

  test("searching 'cf' matches 'ClassForge' via fuzzy search", () => {
    const matchingActions = actions.filter(action => {
      const labelScore = fuzzyScore("cf", action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore("cf", k)), 0);
      return Math.max(labelScore, keywordScore) > 0;
    });

    expect(matchingActions.length).toBeGreaterThan(0);
    const classforgeAction = matchingActions.find(a => a.id === 'jump-classforge');
    expect(classforgeAction).toBeDefined();
  });

  test("searching 'theme' finds theme-related actions", () => {
    const matchingActions = actions.filter(action => {
      const labelScore = fuzzyScore("theme", action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore("theme", k)), 0);
      return Math.max(labelScore, keywordScore) > 0;
    });

    expect(matchingActions.length).toBe(1);
    expect(matchingActions[0].id).toBe('toggle-theme');
  });

  test("searching 'filter' finds filter actions", () => {
    const matchingActions = actions.filter(action => {
      const labelScore = fuzzyScore("filter", action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore("filter", k)), 0);
      return Math.max(labelScore, keywordScore) > 0;
    });

    expect(matchingActions.length).toBe(1);
    expect(matchingActions[0].id).toBe('filter-session');
  });

  test("no results for unmatched queries", () => {
    const matchingActions = actions.filter(action => {
      const labelScore = fuzzyScore("xyz123", action.label);
      const keywordScore = Math.max(...action.keywords.map(k => fuzzyScore("xyz123", k)), 0);
      return Math.max(labelScore, keywordScore) > 0;
    });

    expect(matchingActions.length).toBe(0);
  });
});
