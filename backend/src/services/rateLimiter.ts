import { HOUR_MS } from '../config';
import { redis } from '../redis';

/**
 * Atomic "take one slot" for (sender, clock-hour window).
 * Runs inside Redis as a Lua script so it is safe across any number of workers/instances:
 * INCR, compare to the limit, roll back if over. Never lets the counter exceed the limit.
 */
const TAKE_SLOT_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if c > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

export const hourWindow = (now = Date.now()): number => Math.floor(now / HOUR_MS);
export const nextWindowStart = (now = Date.now()): number => (hourWindow(now) + 1) * HOUR_MS;

const counterKey = (senderId: string, window: number) => `rl:count:${senderId}:${window}`;

export async function tryTakeSlot(senderId: string, limit: number, now = Date.now()): Promise<boolean> {
  const res = (await redis.eval(
    TAKE_SLOT_LUA,
    1,
    counterKey(senderId, hourWindow(now)),
    String(limit),
    String((HOUR_MS / 1000) * 2),
  )) as number;
  return res === 1;
}

/** Give a slot back (e.g. the send failed before leaving the building). */
export async function releaseSlot(senderId: string, now = Date.now()): Promise<void> {
  await redis.decr(counterKey(senderId, hourWindow(now)));
}

/**
 * True only for the first caller per (sender, window) so Slack is pinged once per limit hit,
 * not once per deferred job.
 */
export async function markNotified(senderId: string, now = Date.now()): Promise<boolean> {
  const res = await redis.set(`rl:notified:${senderId}:${hourWindow(now)}`, '1', 'EX', (HOUR_MS / 1000) * 2, 'NX');
  return res === 'OK';
}
