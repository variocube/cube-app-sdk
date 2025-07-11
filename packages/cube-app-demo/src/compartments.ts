import {connect} from "@variocube/cube-app-sdk";

// Connect to the cube
const cube = connect();

// Retrieve compartments of the cube
const compartments = cube.getCompartments();
for (const compartment of compartments) {
    console.log(`Compartment ${compartment.number} is ${compartment.enabled ? "enabled" : "disabled"}`);
}