# Settings notes

Retry policy lives in `config/settings.json`. The key was renamed from
`max_retries` to `maxRetries`; nothing should still use the old spelling.

<!-- GUARD PROBE (read by fixtureIntegrity.test.ts): this file exists only to
     keep the legacy spelling somewhere the tests never look. The suite stays
     green; the no-legacy-key guard is the only thing that can fail this tree,
     so removing that guard turns the integrity test red. -->
