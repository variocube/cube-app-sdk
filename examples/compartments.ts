import {connect} from "../src";

// Connect to the cube
const cube = connect();

// Retrieve compartments of the cube
const compartments = await cube.getCompartments();
for (const compartment of compartments) {
    console.log(`Compartment ${compartment.number} is ${compartment.enabled ? "enabled" : "disabled"}`);
}