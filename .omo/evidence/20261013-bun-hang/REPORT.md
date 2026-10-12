# Bun test CPU hang investigation

The reproduced failure is microtask starvation, not an idle process waiting for a child handle. The archived suite stopped after the skipped failed-install test, immediately before the installer timeout test. That test replaced global setTimeout with a callback that executes inline and kept the replacement active while dynamically importing code.

The earlier v2 view-poller tests had not disposed their pollers. createViewPoller.tick() schedules its next poll in finally. Its fixture readView resolves immediately. If a previously scheduled native timer fires during the installer test's override, the chain becomes read -> promise continuation -> inline schedule -> read repeatedly, without yielding to the event loop. Native timeout handling and the pending import cannot advance.

A two-second externally supervised reproduction against the real createViewPoller consumed 87.3% CPU and printed BEFORE_IMPORT without AFTER_IMPORT. Disposing the poller before the override exited normally. Keeping the poller alive while restoring the native scheduler before awaiting also completed normally; the live poller read eighteen times during the delayed import rather than spinning.

The fix changes only two tests: all poller fixtures are disposed in afterEach, and the installer captures its own native sixty-second timer callback while invoking the already imported function synchronously. It restores the spy before awaiting and invokes only that callback. The timeout result and single child kill assertions remain. Production implementation and default timeout are unchanged.

Focused verification: 11 passed, 1 existing skipped, 0 failed. OpenCode-package and script typechecks passed. An earlier bounded combined background-agent/installer run passed 856 tests, demonstrating that the historical race is timing dependent. Source hashes accompany this report.

Limits: the archived native sample has unsymbolicated JIT addresses, so it cannot identify the historical JavaScript frame conclusively. The controlled starvation mechanism and its two preventive fixes are proven; other possible Bun hangs are not ruled out. Root will run the complete suite once without concurrent full-suite load. All diagnostic children exited; only owned process groups were terminated. No provider requests or user database writes occurred.
