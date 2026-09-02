/*
 * Context-Aware Suggestion Generator for ONEE.
 *
 * Instead of showing a static list of hardcoded chips like "Mock attendance",
 * we build suggestions directly from the verified attendance table.
 *
 * For example:
 * - If CSE330 is the student's lowest course at 76%, we suggest:
 *   "How many can I miss in CSE330?" and "Which subject is closest to 75%?".
 * - If all courses are comfortably above 85%, we suggest:
 *   "Show my safest subjects" or "Which subject has the smallest buffer?".
 * - If the student just asked about their lowest subject, we suggest:
 *   "How many can I miss?" and "Compare my lowest two subjects".
 */

import { AttendanceSummary } from '../shared/types';

export function generateContextualSuggestions(
  attendance: AttendanceSummary | null,
  lastQuery?: string | null
): string[] {
  // If we don't have verified attendance data yet, suggest starting points
  if (!attendance || !attendance.courses || attendance.courses.length === 0) {
    return [
      'Check my attendance',
      'Which subject is lowest?',
      'How many classes can I miss?',
      'Show attendance summary'
    ];
  }

  const courses = [...attendance.courses];
  courses.sort((a, b) => a.percentage - b.percentage);

  const lowest = courses[0];
  const secondLowest = courses[1];
  const queryLower = (lastQuery || '').toLowerCase();

  const suggestions: string[] = [];

  /*
   * Condition 1: Student just asked about their lowest subject.
   * Offer immediate next logical steps like calculating skip allowance or comparing.
   */
  if (queryLower.includes('lowest') || queryLower.includes('minimum')) {
    if (lowest) {
      suggestions.push(`How many can I miss in ${lowest.code}?`);
    }
    if (secondLowest) {
      suggestions.push(`Compare ${lowest.code} with ${secondLowest.code}`);
    }
    suggestions.push('Show subjects below 90%');
    suggestions.push("What's my overall attendance?");
    return suggestions;
  }

  /*
   * Condition 2: Student just asked about bunking or missing classes.
   * Offer to check other subjects or view the safe buffer.
   */
  if (queryLower.includes('bunk') || queryLower.includes('miss') || queryLower.includes('skip')) {
    if (secondLowest) {
      suggestions.push(`Can I miss classes in ${secondLowest.code}?`);
    }
    suggestions.push('Which is closest to 75%?');
    suggestions.push('Show all course percentages');
    suggestions.push('Which subject has the highest buffer?');
    return suggestions;
  }

  /*
   * Default Condition: Build suggestions reflecting current student standing.
   */
  if (lowest) {
    suggestions.push('Which subject is lowest?');
    suggestions.push(`How many can I miss in ${lowest.code}?`);
  }

  const atRisk = courses.find((c) => c.percentage < 75);
  if (atRisk) {
    suggestions.push(`How many to reach 75% in ${atRisk.code}?`);
  } else {
    suggestions.push('Which is closest to 75%?');
  }

  const below90 = courses.filter((c) => c.percentage < 90);
  if (below90.length > 0 && below90.length < courses.length) {
    suggestions.push('Show subjects below 90%');
  }

  suggestions.push('Compare my subjects');
  suggestions.push("What's my safest course?");

  return suggestions;
}
