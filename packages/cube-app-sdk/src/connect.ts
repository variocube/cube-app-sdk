import {Cube} from "./types";
import {CubeImpl} from "./cube";

/**
 * Connects to the Variocube locker.
 * @return The cube which can be used to interface with the Variocube locker.
 */
export function connect(): Cube {
    return new CubeImpl();
}