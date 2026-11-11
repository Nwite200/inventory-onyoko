import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES, t, type Key, type Lang } from './i18n';

const en = DICTIONARIES.en as Record<Key, string>;
const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');

describe('translations', () => {
  for (const lang of Object.keys(LANGUAGES).filter((l) => l !== 'en') as Lang[]) {
    const d = DICTIONARIES[lang] as Record<Key, string>;
    it(`${LANGUAGES[lang]} has every phrase, no leftovers, and keeps the {placeholders}`, () => {
      expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as Key[]) {
        expect(d[key].trim(), `${lang}:${key} is empty`).not.toBe('');
        expect(placeholders(d[key]), `${lang}:${key} placeholders`).toBe(placeholders(en[key]));
      }
    });
    it(`${LANGUAGES[lang]} is really translated (most phrases differ from English)`, () => {
      const same = (Object.keys(en) as Key[]).filter((k) => d[k] === en[k]).length;
      // Pidgin legitimately shares many words with English (Sell, Settings, Cash...); the others should not
      expect(same / Object.keys(en).length).toBeLessThan(lang === 'pcm' ? 0.6 : 0.1);
    });
  }
  it('fills in values, and falls back to English for an unknown language', () => {
    expect(t('pos.charge', { amount: '₦5,000' }, 'en')).toBe('Charge ₦5,000');
    expect(t('pos.charge', { amount: '₦5,000' }, 'ha')).toBe('Karɓi ₦5,000');
    expect(t('status.waiting', { n: 3 }, 'xx')).toBe('3 waiting');
  });
});
