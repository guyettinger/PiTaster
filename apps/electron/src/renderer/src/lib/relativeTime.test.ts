/**
 * Tests for the day buckets the chat list groups by.
 *
 * Bucketing is by calendar day, not elapsed hours — the first version divided
 * elapsed milliseconds and filed 10pm-yesterday under "Today" for most of the
 * following morning.
 */

import { describe, expect, test } from 'bun:test'
import { dayBucketOf, formatCompactTime } from './relativeTime'

/**
 * An ISO timestamp a number of days back, at a given hour of that day.
 * @param daysAgo - Calendar days before today
 * @param hour - Hour of that day, local time
 * @returns The ISO timestamp
 */
function at(daysAgo: number, hour: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

describe('dayBucketOf', () => {
  test('files this morning under Today', () => {
    expect(dayBucketOf(at(0, 1))).toBe('Today')
  })

  test('files late yesterday under Yesterday, not Today', () => {
    // The case the elapsed-hours version got wrong: 11pm yesterday is under a day
    // ago for most of the morning after.
    expect(dayBucketOf(at(1, 23))).toBe('Yesterday')
  })

  test('files early yesterday under Yesterday', () => {
    expect(dayBucketOf(at(1, 1))).toBe('Yesterday')
  })

  test('files three days back under Previous 7 days', () => {
    expect(dayBucketOf(at(3, 12))).toBe('Previous 7 days')
  })

  test('files a week back under Earlier', () => {
    expect(dayBucketOf(at(9, 12))).toBe('Earlier')
  })

  test('files a future timestamp under Today rather than dropping it', () => {
    expect(dayBucketOf(new Date(Date.now() + 3_600_000).toISOString())).toBe('Today')
  })

  test('files an unparseable timestamp under Earlier rather than throwing', () => {
    expect(dayBucketOf('not a date')).toBe('Earlier')
  })
})

describe('formatCompactTime', () => {
  test('reads as now within the minute', () => {
    expect(formatCompactTime(new Date().toISOString())).toBe('now')
  })

  test('drops the "ago" the day heading already implies', () => {
    expect(formatCompactTime(new Date(Date.now() - 2 * 3_600_000).toISOString())).toBe('2h')
  })
})
