import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { notesFor, FALLBACK } = createRequire(import.meta.url)('../scripts/release-notes.js');

const markdown = `# Release notes

Intro text.

## [2.0.0] - 2026-02-01

### Features

- New thing

## [1.5.0] - 2026-01-01

### Bug Fixes

- Fixed thing

## [1.0.0] - 2025-12-01
`;

describe('release notes', () => {
  it('returns only the requested version\'s section, without the heading', () => {
    assert.equal(notesFor('2.0.0', markdown), '### Features\n\n- New thing');
    assert.equal(notesFor('1.5.0', markdown), '### Bug Fixes\n\n- Fixed thing');
  });

  it('does not match a version that merely shares a prefix', () => {
    assert.equal(notesFor('2.0', markdown), FALLBACK);
    assert.equal(notesFor('1.5.00', markdown), FALLBACK);
  });

  it('falls back to a maintenance line when a version has no section or an empty one', () => {
    assert.equal(notesFor('3.0.0', markdown), FALLBACK);
    assert.equal(notesFor('1.0.0', markdown), FALLBACK);
    assert.equal(notesFor('1.0.0', ''), FALLBACK);
  });
});
