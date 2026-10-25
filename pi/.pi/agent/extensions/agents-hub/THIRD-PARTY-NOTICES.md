# Agents Hub third-party notice

`delivery.ts` adapts batching, immutable-notification snapshot, and idle-coalescing concepts from `src/completion-outbox.ts` in [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents), reviewed at commit `ca93a5247e72e7053fcd10bea7125d6c4205f949`.

The local implementation adds a durable journal, revision/event identities, explicit holds, bounded delivery, failure/unknown states, and reconciliation. The reference package and its dependencies are not installed or executed by this extension. This notice retains the reference's complete license; it does not assert that the entire reference package was adopted or audited.

## Original MIT license

MIT License

Copyright (c) 2026 tintinweb

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
