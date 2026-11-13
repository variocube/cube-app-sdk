import type {LockEvent} from "./types.js";

/**
 * The `LockEvent.actor` of a lock event the controller caused itself rather than an app or a user. Together with
 * `LockEvent.action` it tells what the controller did; see `isReopenedLockEvent`, `isAllowedCloseLockEvent` and
 * `isKeptCloseLockEvent`.
 */
export const LOCK_EVENT_ACTOR_CONTROLLER = "controller";

/**
 * The `LockEvent.action` of a lock the controller opened again by itself, because the door was closed without an
 * open shortly before (see `Cube.preventCloseAfterOpenSeconds`) or was closed on a compartment that is not
 * occupied. It arrives with actor `LOCK_EVENT_ACTOR_CONTROLLER` on status `OPEN` or `BLOCKED`, never on `CLOSED`.
 * Use `isReopenedLockEvent` to test for it.
 */
export const LOCK_EVENT_ACTION_REOPEN = "reopen";

/**
 * The `LockEvent.action` of a close the controller kept because an open shortly before allowed it (see
 * `Cube.preventCloseAfterOpenSeconds`). It arrives with actor `LOCK_EVENT_ACTOR_CONTROLLER` on status `CLOSED`.
 * Use `isAllowedCloseLockEvent` to test for it.
 */
export const LOCK_EVENT_ACTION_ALLOW_CLOSE = "allow close";

/**
 * The `LockEvent.action` of a close the controller kept although no open allowed it, while
 * `Cube.preventCloseAfterOpenSeconds` is set: the compartment is out of service (disabled or in maintenance), or
 * the controller gave up reopening on the third close of the lock within 3 seconds. The event does not tell which.
 * It arrives with actor `LOCK_EVENT_ACTOR_CONTROLLER` on status `CLOSED`. Use `isKeptCloseLockEvent` to test for it.
 */
export const LOCK_EVENT_ACTION_KEEP_CLOSE = "keep close";

/**
 * Whether the lock event reports the controller's own reopen: actor `LOCK_EVENT_ACTOR_CONTROLLER` with action
 * `LOCK_EVENT_ACTION_REOPEN`. Only actor and action are checked, not the status.
 *
 * Nobody opened the compartment: write no audit entry, count no opening and send no notification for it.
 *
 * A reopen does not allow a close. The next close is refused again unless a new open command is sent first, so
 * offer opening again (`openCompartment` or `openLock`, which also works on the already open lock) rather than
 * asking the user to close the door.
 */
export function isReopenedLockEvent(event: Pick<LockEvent, "actor" | "action">): boolean {
	return event.actor === LOCK_EVENT_ACTOR_CONTROLLER && event.action === LOCK_EVENT_ACTION_REOPEN;
}

/**
 * Whether the lock event reports a close the controller kept because an open shortly before allowed it: actor
 * `LOCK_EVENT_ACTOR_CONTROLLER` with action `LOCK_EVENT_ACTION_ALLOW_CLOSE`. Only actor and action are checked,
 * not the status. A close the controller keeps for another reason is not an allowed one; see
 * `isKeptCloseLockEvent`.
 */
export function isAllowedCloseLockEvent(event: Pick<LockEvent, "actor" | "action">): boolean {
	return event.actor === LOCK_EVENT_ACTOR_CONTROLLER && event.action === LOCK_EVENT_ACTION_ALLOW_CLOSE;
}

/**
 * Whether the lock event reports a close the controller kept although no open allowed it: actor
 * `LOCK_EVENT_ACTOR_CONTROLLER` with action `LOCK_EVENT_ACTION_KEEP_CLOSE`. Only actor and action are checked, not
 * the status. The compartment is out of service (disabled or in maintenance), or the controller gave up reopening
 * on the third close of the lock within 3 seconds; the event does not tell which.
 *
 * While `Cube.preventCloseAfterOpenSeconds` is set, a `CLOSED` of a compartment's lock that is allowed or kept
 * normally stands, and one with neither tag is normally followed by the controller's reopen. Neither is guaranteed:
 * wait only a bounded time for a reopen and then go by the lock status. A controller that does not know this tag
 * yet leaves these kept closes untagged and does not reopen them.
 */
export function isKeptCloseLockEvent(event: Pick<LockEvent, "actor" | "action">): boolean {
	return event.actor === LOCK_EVENT_ACTOR_CONTROLLER && event.action === LOCK_EVENT_ACTION_KEEP_CLOSE;
}
