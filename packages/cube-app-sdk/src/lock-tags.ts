import type {LockEvent} from "./types.js";

/**
 * The `LockEvent.actor` of a lock event the controller caused itself rather than an app or a user. Together with
 * `LockEvent.action` it tells what the controller did; see `isReopenedLockEvent` and `isAllowedCloseLockEvent`.
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
 * not the status. A close without this tag is not necessarily refused; see `LockEvent.action`.
 */
export function isAllowedCloseLockEvent(event: Pick<LockEvent, "actor" | "action">): boolean {
	return event.actor === LOCK_EVENT_ACTOR_CONTROLLER && event.action === LOCK_EVENT_ACTION_ALLOW_CLOSE;
}
