import {connect} from "../src";

// Connect to the cube
const cube = connect();

// Add an event listener for lock events
cube.addEventListener("lock", ({compartmentNumber, status}) => {
    console.log(`Compartment ${compartmentNumber} is now ${status}`);
});

// Open box 1
await cube.openCompartment("1");
