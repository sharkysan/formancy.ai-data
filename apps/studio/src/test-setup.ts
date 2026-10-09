import { configure } from '@testing-library/react'

/**
 * How long a `findBy` waits for the studio to show what the server answered.
 *
 * Every answer in this suite comes from the real data server in the same
 * process: discovery, generation, drift and regeneration over captured
 * snapshots. Testing Library's default is one second. Measured on 2026-10-09:
 * on a Windows 11 workstation a regeneration shows in well under one second;
 * on CI's hosted runner, sharing two CPUs with every other package's suite,
 * both databases and coverage instrumentation, the regeneration panel had not
 * appeared after one second and the test failed (PR #29), though it passed on
 * the same code in the run before. Fifteen seconds is the host page's figure
 * for the same kind of wait, and stays inside the sixty-second test timeout.
 */
configure({ asyncUtilTimeout: 15_000 })
