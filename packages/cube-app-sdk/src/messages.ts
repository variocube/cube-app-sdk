import {VcmpMessage} from "@variocube/vcmp";
import {Compartment, LockEvent} from "./types";

export interface OpenLockMessage extends VcmpMessage {
  "@type": 'openLock';
  lockId: string;
}

export interface LockMessage extends VcmpMessage, LockEvent {
  "@type": 'lock';
}

export interface CompartmentsMessage extends VcmpMessage {
  "@type": 'compartments';
  compartments: Compartment[];
}